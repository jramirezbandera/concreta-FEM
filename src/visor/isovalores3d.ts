/**
 * Isovalores de las losas en el 3D del visor (I4, `docs/fem3d/interfaz.md` §7): los mapas de
 * `vistaCampo` (A4) sobre las láminas en su sitio, con bandas de color sin interpolar (H43).
 *
 * - Los valores son los de `valoresCampo` (uz de los nudos; M11…V23 del SPR en los nudos de cada
 *   lámina, en los ejes de su losa), con los mismos triángulos de cada lámina, los mismos límites
 *   (`limitesMapa`, con la escala pedida) y los mismos colores (`coloresBandas`) que la planta.
 * - Con una planta, la combinación, los límites y los colores son los de su planta, así que el 3D y
 *   la planta se leen igual. Sin planta, todas las que tienen losas, con una escala común y la
 *   combinación del mayor |valor| en todas (la misma regla que en una planta).
 * - Cada triángulo se parte por los límites (`trozosTriangulo`, los trozos que la planta funde en
 *   bandas) y cada trozo se sube a la cota de su lámina; las isolíneas, triángulo a triángulo.
 * - Las láminas sin mapa (las rígidas de las huellas de los pilares) van en gris. Los muros, de
 *   momento, no tienen mapa.
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { area, rotulo, type EntradaLeyenda, type EscalaDibujada, type Vec2 } from "../agente/render/escena.ts";
import { AVISO_PICOS, coloresBandas, FRACCION_PICOS, limitesMapa, rangoSinPicos, triangulosCuadrilatero, trozosTriangulo, valorEnTriangulo, type EscalaMapa, type LimitesMapa, type Triangulo } from "../agente/render/isovalores.ts";
import { UNIDADES_CAMPO, valoresCampo, type Campo, type ResultadosRender } from "../agente/render/resultados.ts";

type V3 = [number, number, number];

export interface ExtremoIsovalores {
  que: "máximo" | "mínimo";
  valor: number;
  losa: string;
  /** El nudo (m, globales). */
  punto: V3;
}

export interface Isovalores3D {
  campo: Campo;
  unidad: string;
  origen: [number, number, number];
  /** Las plantas que se dibujan. */
  plantas: string[];
  /** La combinación dibujada. */
  combinacion: { nombre: string; etiqueta: string } | null;
  /** Triángulos de las bandas (x, y, z de sus vértices respecto al origen) y la banda de cada uno. */
  triangulos: Float32Array;
  banda: Uint16Array;
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

export function isovalores3D(r: ResultadosRender, origen: [number, number, number], campo: Campo, conjunto: ConjuntoCombinaciones, planta: string | null, escala: EscalaMapa = {}): Isovalores3D {
  const c = r.c;
  const todas = r.q.fisico.plantas.map((p) => p.id);
  const plantas = (planta === null ? todas : todas.filter((p) => p === planta)).filter((p) => r.laminas(p).laminas.length > 0);
  // La combinación que gobierna en lo que se ve: la del mayor |valor| (como `vistaCampo` en una planta)
  let mejor: { k: number; m: number; por: { laminas: number[]; v: Float64Array }[] } = { k: 0, m: -1, por: [] };
  conjunto.factores.forEach((f, k) => {
    const por = plantas.map((p) => valoresCampo(r, p, campo, f));
    let m = 0;
    for (const x of por) for (const y of x.v) if (Math.abs(y) > m) m = Math.abs(y);
    if (m > mejor.m) mejor = { k, m, por };
  });
  const nudo = (n: number): V3 => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y, c.modelo.nudos[n]!.z];
  const rel = (q: V3, a: number[]) => a.push(q[0] - origen[0], q[1] - origen[1], q[2] - origen[2]);

  // Triángulos (los de la planta) y su cota, extremos y pesos
  const tris: Triangulo[] = [];
  const trisZ: Triangulo[] = [];
  const sinMapa: number[] = [];
  const valoresNudos: number[] = [];
  const pesos: number[] = [];
  let [vmin, vmax] = [Infinity, -Infinity];
  let emin: ExtremoIsovalores | null = null;
  let emax: ExtremoIsovalores | null = null;
  let nSin = 0;
  for (const { laminas, v } of mejor.por)
    laminas.forEach((l, i) => {
      const ns = c.modelo.laminas![l]!.nudos;
      const P = ns.map(nudo);
      const pts = P.map((p) => [p[0], p[1]] as Vec2);
      const w = [0, 1, 2, 3].map((a) => v[4 * i + a]!);
      if (w.some(Number.isNaN)) {
        for (const a of [0, 1, 2, 0, 2, 3]) rel(P[a]!, sinMapa);
        nSin++;
        return;
      }
      const losa = c.mapeo.laminas![l]!.losa ?? "";
      w.forEach((x, a) => {
        if (x < vmin) [vmin, emin] = [x, { que: "mínimo", valor: x, losa, punto: P[a]! }];
        if (x > vmax) [vmax, emax] = [x, { que: "máximo", valor: x, losa, punto: P[a]! }];
      });
      tris.push(...triangulosCuadrilatero(pts, w));
      trisZ.push(...triangulosCuadrilatero(pts, P.map((p) => p[2])));
      const a4 = Math.abs(area(pts)) / 4;
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
  const iso: number[] = [];
  const ceros: number[] = [];
  let colores: string[] = [];
  let mapa: EscalaDibujada | undefined;
  if (tris.length) {
    const robusto = rangoSinPicos(valoresNudos, pesos);
    let lm = limitesMapa(vmin, vmax, escala, robusto);
    if ("error" in lm) {
      notas.push(`Escala no válida (${lm.error}): se dibuja la completa.`);
      lm = limitesMapa(vmin, vmax) as LimitesMapa;
    }
    const { L, fueraAbajo, fueraArriba } = lm;
    colores = coloresBandas(L, { abajo: fueraAbajo, arriba: fueraArriba });
    const nb = L.length - 1;
    const interiores = L.slice(1, -1);
    tris.forEach((t, i) => {
      const tz = trisZ[i]!;
      const zMedia = (tz.v[0] + tz.v[1] + tz.v[2]) / 3;
      const z = (q: Vec2) => valorEnTriangulo(tz, q) ?? zMedia;
      for (const [b, q] of trozosTriangulo(t, L)) {
        const Q = q.map((p) => [p[0], p[1], z(p)] as V3);
        for (let j = 1; j + 1 < Q.length; j++) {
          for (const p of [Q[0]!, Q[j]!, Q[j + 1]!]) rel(p, tri);
          banda.push(b);
        }
      }
      // Isolíneas: el segmento de cada límite que cruza el triángulo («encima» es ≥ l, como en la planta)
      for (const l of interiores) {
        const enc = t.v.map((x) => x >= l);
        if (enc[0] === enc[1] && enc[1] === enc[2]) continue;
        const pts: V3[] = [];
        for (let a = 0; a < 3; a++) {
          const e = (a + 1) % 3;
          if (enc[a] === enc[e]) continue;
          const f = t.v[a] === l ? 0 : t.v[e] === l ? 1 : (l - t.v[a]!) / (t.v[e]! - t.v[a]!);
          pts.push([t.p[a]![0] + f * (t.p[e]![0] - t.p[a]![0]), t.p[a]![1] + f * (t.p[e]![1] - t.p[a]![1]), tz.v[a]! + f * (tz.v[e]! - tz.v[a]!)]);
        }
        if (pts.length !== 2) continue;
        for (const p of pts) rel(p, l === 0 ? ceros : iso);
      }
    });
    for (let b = nb - 1; b >= 0; b--) {
      const texto = fueraArriba && b === nb - 1 ? `más de ${rotulo(L[b]!, 4)} (fuera de la escala)` : fueraAbajo && b === 0 ? `menos de ${rotulo(L[1]!, 4)} (fuera de la escala)` : `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}`;
      leyenda.push({ relleno: colores[b]!, texto });
    }
    leyenda.push({ estilo: "isolinea", texto: "Isolínea en cada límite" });
    if (ceros.length) leyenda.push({ estilo: "isolinea-cero", texto: "Isolínea de valor 0" });
    const dentro = L.slice(fueraAbajo ? 1 : 0, fueraArriba ? nb : nb + 1);
    if (fueraAbajo || fueraArriba) notas.push(`Escala de ${rotulo(dentro[0]!, 4)} a ${rotulo(dentro[dentro.length - 1]!, 4)} ${unidad}${escala.modo === "sin-picos" ? `, sin picos (sin el ${rotulo(FRACCION_PICOS * 100)} % del área por cada lado)` : ""}. Los extremos rotulados son los reales.`);
    const picos = !!robusto && !(fueraAbajo || fueraArriba) && Math.max(Math.abs(vmin), Math.abs(vmax)) > AVISO_PICOS * Math.max(Math.abs(robusto[0]), Math.abs(robusto[1]));
    if (picos) notas.push(`La escala la marcan picos en menos del ${rotulo(2 * FRACCION_PICOS * 100)} % del área; sin ellos, el campo va de ${rotulo(robusto![0])} a ${rotulo(robusto![1])} ${unidad} (escala «sin picos»).`);
    mapa = { limites: dentro, paso: lm.paso, fueraAbajo, fueraArriba, picos, minimo: vmin, maximo: vmax, ...(robusto ? { sinPicos: robusto } : {}) };
  }
  notas.push(planta === null ? `Todas las plantas con losas (${plantas.length}), con una escala común.` : `Planta ${planta}: la misma escala y la misma combinación que su vista en planta.`);
  if (conjunto.factores.length > 1) notas.push(`Combinación ${conjunto.nombres[mejor.k] ?? ""}: la del mayor |valor| de las ${conjunto.factores.length} de ${conjunto.descripcion}.`);
  if (nSin) notas.push(`${nSin} láminas sin mapa (gris): las rígidas de las huellas de los pilares.`);
  notas.push(campo === "uz" ? "uz de los nudos de las láminas, sobre la geometría sin deformar." : "Campos recuperados por SPR (E5) en los ejes de cada losa. Los muros no tienen mapa.");
  if (!plantas.length) notas.push("No hay losas que dibujar.");
  return {
    campo,
    unidad,
    origen,
    plantas,
    combinacion: tris.length || nSin ? { nombre: conjunto.nombres[mejor.k] ?? "", etiqueta: conjunto.etiquetas[mejor.k] ?? "" } : null,
    triangulos: Float32Array.from(tri),
    banda: Uint16Array.from(banda),
    colores,
    sinMapa: Float32Array.from(sinMapa),
    isolineas: Float32Array.from(iso),
    ceros: Float32Array.from(ceros),
    extremos: ([emax, emin] as (ExtremoIsovalores | null)[]).filter((x): x is ExtremoIsovalores => x !== null),
    ...(mapa ? { mapa } : {}),
    leyenda,
    notas,
  };
}
