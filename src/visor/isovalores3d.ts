/**
 * Isovalores de las losas y los muros en el 3D del visor (I4, `docs/fem3d/interfaz.md` §7 y §15):
 * los mapas de `vistaCampo` (A4) sobre las láminas en su sitio, con bandas de color sin interpolar
 * (H43).
 *
 * - Los valores son los de `valoresCampo` (uz de los nudos; M11…V23 y F11…F12 del SPR en los nudos
 *   de cada lámina, en sus ejes), con los mismos triángulos de cada lámina, los mismos límites
 *   (`limitesMapa`, con la escala pedida) y los mismos colores (`coloresBandas`) que la planta.
 * - Superficies: las losas (por defecto), los muros o las dos, con una escala común. Las láminas de
 *   un muro van con la planta de su cabeza (la cota de su centro, entre la planta de debajo y ella);
 *   sus ejes: 1 a lo largo del eje del muro desde su primer punto, 2 hacia arriba y 3 a su derecha.
 * - Con una planta y sólo las losas, la combinación, los límites y los colores son los de su planta,
 *   así que el 3D y la planta se leen igual. Sin planta, todas, con una escala común y la
 *   combinación del mayor |valor| en todo lo que se ve (la misma regla que en una planta).
 * - Cada lámina se lleva a su plano (x, y en las losas; a lo largo del muro y z en los muros), sus
 *   triángulos se parten por los límites (`trozosTriangulo`, los trozos que la planta funde en
 *   bandas) y cada trozo se sube a su sitio; las isolíneas, triángulo a triángulo. Cada triángulo
 *   lleva su lámina, para el valor bajo el cursor (`valorEnLamina`).
 * - Las láminas sin mapa (las rígidas de las huellas de los pilares) van en gris.
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { area, rotulo, type EntradaLeyenda, type EscalaDibujada, type Vec2 } from "../agente/render/escena.ts";
import { AVISO_PICOS, CAMPO_NULO, COLOR_NULO, coloresBandas, FRACCION_PICOS, LIMITES_NULO, limitesMapa, rangoSinPicos, triangulosCuadrilatero, trozosTriangulo, valorEnTriangulo, type EscalaMapa, type LimitesMapa, type Triangulo } from "../agente/render/isovalores.ts";
import { NOTA_MEMBRANA, UNIDADES_CAMPO, valoresCampo, type Campo, type ResultadosRender, type SuperficieMapa } from "../agente/render/resultados.ts";

type V3 = [number, number, number];

/** Qué superficies lleva un mapa en el 3D. */
export type SuperficiesMapa = "losas" | "muros" | "todas";

export interface ExtremoIsovalores {
  que: "máximo" | "mínimo";
  valor: number;
  /** La losa o el muro. */
  objeto: string;
  /** El nudo (m, globales). */
  punto: V3;
}

export interface Isovalores3D {
  campo: Campo;
  unidad: string;
  origen: [number, number, number];
  superficies: SuperficiesMapa;
  /** Las plantas que se dibujan. */
  plantas: string[];
  /** La combinación dibujada, y de qué conjunto sale. */
  combinacion: { nombre: string; etiqueta: string } | null;
  conjunto: { descripcion: string; n: number };
  /** Triángulos de las bandas (x, y, z de sus vértices respecto al origen), la banda y la lámina de cada uno. */
  triangulos: Float32Array;
  banda: Uint16Array;
  lamina: Int32Array;
  /** El color de cada banda. */
  colores: string[];
  /** Triángulos de las láminas sin mapa. */
  sinMapa: Float32Array;
  /** Segmentos de las isolíneas de los límites; los del 0, aparte. */
  isolineas: Float32Array;
  ceros: Float32Array;
  extremos: ExtremoIsovalores[];
  mapa?: EscalaDibujada;
  leyenda: EntradaLeyenda[];
  notas: string[];
}

/** Un grupo de láminas que se evalúa junto: las losas de una planta o sus muros. */
interface Grupo {
  planta: string;
  de: SuperficieMapa;
}

const gruposDe = (s: SuperficiesMapa): SuperficieMapa[] => (s === "todas" ? ["losas", "muros"] : [s]);

/**
 * El plano de una lámina: sus coordenadas 2D (x, y en una losa; a lo largo del muro y z en un muro)
 * y la vuelta a 3D de un punto de ese plano (en una losa, con la z interpolada en sus triángulos).
 */
export interface PlanoLamina {
  pts: [Vec2, Vec2, Vec2, Vec2];
  a2D: (p: readonly number[]) => Vec2;
  a3D: (q: Vec2) => V3;
}

export function planoLamina(r: ResultadosRender, l: number): PlanoLamina {
  const c = r.c;
  const lam = c.modelo.laminas![l]!;
  const P = lam.nudos.map((n): V3 => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y, c.modelo.nudos[n]!.z]);
  if (c.mapeo.laminas?.[l]?.muro && lam.eje1) {
    const o = P[0]!;
    const [ex, ey] = [lam.eje1[0], lam.eje1[1]];
    const a2D = (p: readonly number[]): Vec2 => [(p[0]! - o[0]) * ex + (p[1]! - o[1]) * ey, p[2]!];
    return { pts: P.map(a2D) as [Vec2, Vec2, Vec2, Vec2], a2D, a3D: (q) => [o[0] + q[0] * ex, o[1] + q[0] * ey, q[1]] };
  }
  const pts = P.map((p) => [p[0], p[1]] as Vec2) as [Vec2, Vec2, Vec2, Vec2];
  const tz = triangulosCuadrilatero(pts, P.map((p) => p[2]));
  const zMedia = (P[0]![2] + P[1]![2] + P[2]![2] + P[3]![2]) / 4;
  return {
    pts,
    a2D: (p) => [p[0]!, p[1]!],
    a3D: (q) => {
      for (const t of tz) {
        const z = valorEnTriangulo(t, q);
        if (z !== null) return [q[0], q[1], z];
      }
      return [q[0], q[1], zMedia];
    },
  };
}

export interface OpcionesIsovalores3D {
  planta: string | null;
  superficies?: SuperficiesMapa;
  escala?: EscalaMapa;
}

export function isovalores3D(r: ResultadosRender, origen: [number, number, number], campo: Campo, conjunto: ConjuntoCombinaciones, op: OpcionesIsovalores3D): Isovalores3D {
  const c = r.c;
  const superficies = op.superficies ?? "losas";
  const escala = op.escala ?? {};
  const todas = r.q.fisico.plantas.map((p) => p.id);
  const grupos: Grupo[] = [];
  for (const planta of op.planta === null ? todas : todas.filter((p) => p === op.planta)) for (const de of gruposDe(superficies)) if (r.laminas(planta, de).laminas.length) grupos.push({ planta, de });
  const plantas = todas.filter((p) => grupos.some((g) => g.planta === p));
  // La combinación que gobierna en lo que se ve: la del mayor |valor| (como `vistaCampo` en una planta)
  let mejor: { k: number; m: number; por: { laminas: number[]; v: Float64Array }[] } = { k: 0, m: -1, por: [] };
  conjunto.factores.forEach((f, k) => {
    const por = grupos.map((g) => valoresCampo(r, g.planta, campo, f, g.de));
    let m = 0;
    for (const x of por) for (const y of x.v) if (Math.abs(y) > m) m = Math.abs(y);
    if (m > mejor.m) mejor = { k, m, por };
  });
  const rel = (q: readonly number[], a: number[]) => a.push(q[0]! - origen[0], q[1]! - origen[1], q[2]! - origen[2]);

  // Triángulos (los de la planta, en el plano de su lámina), su lámina, extremos y pesos
  const tris: Triangulo[] = [];
  const triLamina: number[] = [];
  const planos: PlanoLamina[] = [];
  const sinMapa: number[] = [];
  const valoresNudos: number[] = [];
  const pesos: number[] = [];
  let [vmin, vmax] = [Infinity, -Infinity];
  let emin: ExtremoIsovalores | null = null;
  let emax: ExtremoIsovalores | null = null;
  let [nSin, nMuros] = [0, 0];
  for (const { laminas, v } of mejor.por)
    laminas.forEach((l, i) => {
      const ns = c.modelo.laminas![l]!.nudos;
      const P = ns.map((n): V3 => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y, c.modelo.nudos[n]!.z]);
      const w = [0, 1, 2, 3].map((a) => v[4 * i + a]!);
      if (w.some(Number.isNaN)) {
        for (const a of [0, 1, 2, 0, 2, 3]) rel(P[a]!, sinMapa);
        nSin++;
        return;
      }
      const m = c.mapeo.laminas![l]!;
      if (m.muro) nMuros++;
      const objeto = m.losa ?? m.muro ?? "";
      w.forEach((x, a) => {
        if (x < vmin) [vmin, emin] = [x, { que: "mínimo", valor: x, objeto, punto: P[a]! }];
        if (x > vmax) [vmax, emax] = [x, { que: "máximo", valor: x, objeto, punto: P[a]! }];
      });
      const pl = planoLamina(r, l);
      const k = planos.length;
      planos.push(pl);
      for (const t of triangulosCuadrilatero(pl.pts, w)) {
        tris.push(t);
        triLamina.push(k, l);
      }
      const a4 = Math.abs(area(pl.pts)) / 4;
      for (const x of w) {
        valoresNudos.push(x);
        pesos.push(a4);
      }
    });

  const unidad = UNIDADES_CAMPO[campo];
  const notas: string[] = [];
  const leyenda: EntradaLeyenda[] = [];
  const tri: number[] = [];
  const banda: number[] = [];
  const lamina: number[] = [];
  const iso: number[] = [];
  const ceros: number[] = [];
  let colores: string[] = [];
  let mapa: EscalaDibujada | undefined;
  // Un campo nulo (ruido de redondeo): una sola banda neutra, sin extremos (como la planta)
  const nulo = tris.length > 0 && Math.max(Math.abs(vmin), Math.abs(vmax)) < CAMPO_NULO;
  if (tris.length) {
    const robusto = nulo ? null : rangoSinPicos(valoresNudos, pesos);
    let lm = nulo ? { L: [...LIMITES_NULO], fueraAbajo: false, fueraArriba: false, paso: 2 * CAMPO_NULO } : limitesMapa(vmin, vmax, escala, robusto);
    if ("error" in lm) {
      notas.push(`Escala no válida (${lm.error}): se dibuja la completa.`);
      lm = limitesMapa(vmin, vmax) as LimitesMapa;
    }
    const { L, fueraAbajo, fueraArriba } = lm;
    colores = nulo ? [COLOR_NULO] : coloresBandas(L, { abajo: fueraAbajo, arriba: fueraArriba });
    const nb = L.length - 1;
    const interiores = L.slice(1, -1);
    tris.forEach((t, i) => {
      const pl = planos[triLamina[2 * i]!]!;
      const l = triLamina[2 * i + 1]!;
      for (const [b, q] of trozosTriangulo(t, L)) {
        const Q = q.map(pl.a3D);
        for (let j = 1; j + 1 < Q.length; j++) {
          for (const p of [Q[0]!, Q[j]!, Q[j + 1]!]) rel(p, tri);
          banda.push(b);
          lamina.push(l);
        }
      }
      // Isolíneas: el segmento de cada límite que cruza el triángulo («encima» es ≥ l, como en la planta)
      for (const lim of interiores) {
        const enc = t.v.map((x) => x >= lim);
        if (enc[0] === enc[1] && enc[1] === enc[2]) continue;
        const pts: Vec2[] = [];
        for (let a = 0; a < 3; a++) {
          const e = (a + 1) % 3;
          if (enc[a] === enc[e]) continue;
          const f = t.v[a] === lim ? 0 : t.v[e] === lim ? 1 : (lim - t.v[a]!) / (t.v[e]! - t.v[a]!);
          pts.push([t.p[a]![0] + f * (t.p[e]![0] - t.p[a]![0]), t.p[a]![1] + f * (t.p[e]![1] - t.p[a]![1])]);
        }
        if (pts.length !== 2) continue;
        for (const p of pts) rel(pl.a3D(p), lim === 0 ? ceros : iso);
      }
    });
    if (nulo) leyenda.push({ relleno: COLOR_NULO, texto: `0: campo nulo (|valor| < ${CAMPO_NULO})` });
    else for (let b = nb - 1; b >= 0; b--) {
      const texto = fueraArriba && b === nb - 1 ? `más de ${rotulo(L[b]!, 4)} (fuera de la escala)` : fueraAbajo && b === 0 ? `menos de ${rotulo(L[1]!, 4)} (fuera de la escala)` : `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}`;
      leyenda.push({ relleno: colores[b]!, texto });
    }
    if (!nulo) leyenda.push({ estilo: "isolinea", texto: "Isolínea en cada límite" });
    if (ceros.length) leyenda.push({ estilo: "isolinea-cero", texto: "Isolínea de valor 0" });
    const dentro = L.slice(fueraAbajo ? 1 : 0, fueraArriba ? nb : nb + 1);
    if (fueraAbajo || fueraArriba) notas.push(`Escala de ${rotulo(dentro[0]!, 4)} a ${rotulo(dentro[dentro.length - 1]!, 4)} ${unidad}${escala.modo === "sin-picos" ? `, sin picos (sin el ${rotulo(FRACCION_PICOS * 100)} % del área por cada lado)` : ""}. Los extremos rotulados son los reales.`);
    const picos = !!robusto && !(fueraAbajo || fueraArriba) && Math.max(Math.abs(vmin), Math.abs(vmax)) > AVISO_PICOS * Math.max(Math.abs(robusto[0]), Math.abs(robusto[1]));
    if (picos) notas.push(`La escala la marcan picos en menos del ${rotulo(2 * FRACCION_PICOS * 100)} % del área; sin ellos, el campo va de ${rotulo(robusto![0])} a ${rotulo(robusto![1])} ${unidad} (escala «sin picos»).`);
    mapa = { limites: dentro, paso: lm.paso, fueraAbajo, fueraArriba, picos, minimo: vmin, maximo: vmax, ...(robusto ? { sinPicos: robusto } : {}), ...(nulo ? { nulo: true as const } : {}), combinacion: conjunto.nombres[mejor.k] ?? "" };
    if (nulo) notas.push(`El campo es nulo en lo que se ve: su mayor |valor| es ${Math.max(Math.abs(vmin), Math.abs(vmax)).toExponential(1)} ${unidad}, ruido de redondeo. No se rotulan extremos.`);
  }
  const que = superficies === "losas" ? "con losas" : superficies === "muros" ? "con muros" : "con losas o muros";
  notas.push(op.planta === null ? `Todas las plantas ${que} (${plantas.length}), con una escala común.` : superficies === "losas" ? `Planta ${op.planta}: la misma escala y la misma combinación que su vista en planta.` : `Planta ${op.planta}${superficies === "muros" ? ": sus muros" : ": sus losas y sus muros, con una escala común"} (los muros, de la planta de debajo a ella).`);
  if (conjunto.factores.length > 1) notas.push(`Combinación ${conjunto.nombres[mejor.k] ?? ""}: la del mayor |valor| de las ${conjunto.factores.length} de ${conjunto.descripcion}.`);
  if (nSin) notas.push(`${nSin} láminas sin mapa (gris): las rígidas de las huellas de los pilares.`);
  if (campo === "uz") notas.push(`uz de los nudos de las láminas${nMuros ? " (en los muros, su desplazamiento vertical)" : ""}, sobre la geometría sin deformar.`);
  else if (campo.startsWith("f")) notas.push(NOTA_MEMBRANA);
  else notas.push("Campos recuperados por SPR (E5) en los ejes de cada losa.");
  if (nMuros) notas.push("En los muros, sus ejes: 1 a lo largo de su eje desde su primer punto, 2 hacia arriba y 3 a su derecha; un momento positivo tracciona su cara izquierda (−3) y F22 es su axil vertical por metro.");
  if (!grupos.length) notas.push(superficies === "losas" ? "No hay losas que dibujar." : superficies === "muros" ? "No hay muros que dibujar." : "No hay losas ni muros que dibujar.");
  return {
    campo,
    unidad,
    origen,
    superficies,
    plantas,
    combinacion: tris.length || nSin ? { nombre: conjunto.nombres[mejor.k] ?? "", etiqueta: conjunto.etiquetas[mejor.k] ?? "" } : null,
    conjunto: { descripcion: conjunto.descripcion, n: conjunto.factores.length },
    triangulos: Float32Array.from(tri),
    banda: Uint16Array.from(banda),
    lamina: Int32Array.from(lamina),
    colores,
    sinMapa: Float32Array.from(sinMapa),
    isolineas: Float32Array.from(iso),
    ceros: Float32Array.from(ceros),
    extremos: nulo ? [] : ([emax, emin] as (ExtremoIsovalores | null)[]).filter((x): x is ExtremoIsovalores => x !== null),
    ...(mapa ? { mapa } : {}),
    leyenda,
    notas,
  };
}

/** El grupo de una lámina: las losas de su planta o los muros que llegan a ella (null si no está en ninguno). */
export function grupoDeLamina(r: ResultadosRender, l: number): Grupo | null {
  const m = r.c.mapeo.laminas?.[l];
  if (!m) return null;
  if (m.losa) {
    const losa = (r.q.fisico.losas ?? []).find((x) => x.id === m.losa);
    return losa ? { planta: losa.planta, de: "losas" } : null;
  }
  if (m.muro) for (const p of r.q.fisico.plantas) if (r.laminas(p.id, "muros").laminas.includes(l)) return { planta: p.id, de: "muros" };
  return null;
}

/**
 * El valor de un campo en un punto de una lámina, en una combinación: interpolado como las bandas
 * (en los triángulos de `triangulosCuadrilatero` de la lámina, en su plano, con los valores de
 * `valoresCampo`). null si la lámina no tiene mapa o el punto no cae en ella. En una losa es lo que
 * da `valorEnPunto` en ese (x, y).
 */
export function valorEnLamina(r: ResultadosRender, campo: Campo, f: ArrayLike<number>, l: number, p: readonly number[]): { valor: number; objeto: string; planta: string } | null {
  const g = grupoDeLamina(r, l);
  if (!g) return null;
  const { laminas, v } = valoresCampo(r, g.planta, campo, f, g.de);
  const i = laminas.indexOf(l);
  if (i < 0) return null;
  const w = [0, 1, 2, 3].map((a) => v[4 * i + a]!);
  if (w.some(Number.isNaN)) return null;
  const pl = planoLamina(r, l);
  const q = pl.a2D(p);
  const m = r.c.mapeo.laminas![l]!;
  for (const t of triangulosCuadrilatero(pl.pts, w)) {
    const valor = valorEnTriangulo(t, q);
    if (valor !== null) return { valor, objeto: m.losa ?? m.muro ?? "", planta: g.planta };
  }
  return null;
}
