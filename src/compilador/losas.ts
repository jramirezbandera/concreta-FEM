/**
 * Paso 2b del compilador (C2 y C3): las losas y los muros, mallados y unidos a lo que los rodea.
 * Corre tras la topología de C1 y añade a `topo.nudos` los nudos de las mallas.
 *
 * 1. Por planta con losas o muros:
 *    - comprueba C2-c y C3-b: ningún borde de losa corre dentro del ancho de una viga o del espesor
 *      de un muro sin ir por su eje;
 *    - monta el arreglo plano (`arreglo.ts`) por prioridad: los nudos de C1 (fijos), los vértices
 *      de los muros (ya ajustados, `muros.ts`), los ejes de las vigas, las huellas de los pilares,
 *      los ejes de los muros, los contornos y huecos de las losas, las bandas, las zonas y líneas de
 *      carga, los apoyos lineales y los puntos (cargas y apoyos que C1 no ha colocado).
 * 2. Estaciones de los muros, las mismas en todas sus plantas (`muros.ts`): sus lados quedan
 *    sembrados. Lo que se ha movido más de ε_geom al unirse se avisa (C2-b, C3-b).
 * 3. Por planta: malla las losas (`mallado.ts`, con la rejilla alineada de `rejilla.ts` en las zonas
 *    regulares) y lleva los problemas del validador a diagnósticos
 *    con la losa. Crea los nudos de la cota de la planta sobre los ejes de los muros, donde el muro
 *    los necesita, y une todo:
 *    - los nudos de la malla que son nudos de C1 se reutilizan; los demás son nudos nuevos;
 *    - huellas (C2-d): los nudos de la malla y de los muros en la huella de un pilar, o a ≤ ε_snap
 *      de ella, son esclavos de un enlace rígido con maestro en el nudo del pilar;
 *    - vigas embebidas (C2-e, C3-e): sus tramos se parten en los nudos de la malla o de los muros
 *      sobre su eje, salvo en los de las huellas;
 *    - apoyos lineales, cargas lineales, zonas y puntos: los nudos, aristas o láminas que les tocan.
 * 4. La rejilla de los muros (`muros.ts`).
 *
 * Las láminas de las losas salen en orden canónico (cota, centroide x, y, losa), y las de los muros,
 * por muro, tramo, planta (de abajo arriba), columna y fila: sus índices ya son los del modelo
 * analítico (primero las losas).
 */
import { Diagnosticos } from "../motor/diagnosticos.ts";
import { Arreglo, type Trazo, type TipoTrazo } from "./arreglo.ts";
import { CUANTO_ORDEN } from "./geometria2d.ts";
import type { CargaFisica, Vec2 } from "./fisico.ts";
import { mallarPlanta, type LosaMallar, type ResultadoMalla } from "./mallado.ts";
import { estacionesBanda, ladoEstacion } from "./estaciones.ts";
import { estacionesComunes, huellasVigas, mallarMuros, planMuros, unificarEstaciones, type HuellaViga, type LaminaMuro, type MallaMuros, type PlanMuros, type PlantaMuros, type TrazoMuro } from "./muros.ts";
import { areaConSigno, distanciaABorde, momentosRegion, puntoEnPoligono, type Region } from "./poligonos.ts";
import { distanciaARegion, ordenarCadena, type NudoT, type Topologia, type TramoViga } from "./topologia.ts";
import type { PanosU } from "./unidireccional.ts";
import type { Contexto } from "./validar.ts";

export interface LaminaL {
  /** Nudos de la topología, antihorario (normal +Z). */
  nudos: [number, number, number, number];
  /** Índice de la losa en `ctx.losas`. */
  losa: number;
  k: number;
  /** Lámina de un ábaco de un reticular (C4): maciza, sin multiplicadores. */
  abaco?: true;
}

export interface HuellaL {
  pilar: string;
  k: number;
  maestro: number;
  esclavos: number[];
  /** Espesor de la losa más gruesa de la huella (para la zona rígida de la cabeza del pilar, C2-e). */
  espesor: number;
}

export interface Losas {
  laminas: LaminaL[];
  huellas: HuellaL[];
  /** Nudos de cada apoyo lineal. */
  apoyosLineales: Map<string, number[]>;
  /** Nudo de cada apoyo puntual que C1 no ha colocado (cae en una losa). */
  apoyosPuntuales: Map<string, number>;
  /** Por carga lineal: sus aristas (pares de nudos) a lo largo de la polilínea unida. */
  lineas: Map<string, [number, number][]>;
  /**
   * Por carga lineal de una planta con paños (C4): los lados de la polilínea unida que no van sobre
   * la malla ni sobre un muro. Los reparten los paños; lo que no cubran es un error.
   */
  lineasFuera: Map<string, [Vec2, Vec2][]>;
  /** Polilínea unida de cada carga lineal (la geometría física tras unir, C2-b). */
  lineasUnidas: Map<string, Vec2[]>;
  /** Por carga de superficie: las láminas que cubre. */
  superficies: Map<string, number[]>;
  /** Zona unida de cada carga de superficie con zona. */
  zonasUnidas: Map<string, Vec2[]>;
  /** Nudo de cada carga puntual que cae en una losa. */
  puntos: Map<string, number>;
  /** Región unida de cada losa (por índice en `ctx.losas`). */
  regiones: Region[];
  /** Nudos que entran en el diafragma de su planta (C2-f), por planta. */
  diafragma: Map<number, number[]>;
  /** Estadísticas de la malla. */
  malla: { nudos: number; laminas: number; jacobianoMin: number; bajos: number; laminasRejilla: number; plantillas: number };
  /** C3: láminas de los muros (van tras las de las losas en el modelo analítico). */
  muros: LaminaMuro[];
  /** Nudos de la base de cada muro con vínculo. */
  apoyosMuros: Map<string, number[]>;
  /** Barras auxiliares de C3-e. */
  auxiliares: MallaMuros["auxiliares"];
  /** Plan de los muros (paños, filas, huecos y empujes unidos), o null sin muros. */
  planMuros: PlanMuros | null;
  /**
   * Lados de los ejes de los muros en la cota de cada planta, donde hay muro debajo o encima: sus
   * nudos (extremo, punto medio, extremo), su muro y tramo, sus extremos en planta y qué muro hay.
   */
  ladosMuros: { k: number; w: number; i: number; nudos: [number, number, number]; A: Vec2; B: Vec2; debajo: boolean; encima: boolean }[];
  /** Relación de aspecto de los elementos de muro. */
  aspectoMuros: { max: number; altos: number };
  /** Huellas de las vigas que acaban en un muro fuera de su plano (C3-i). */
  huellasVigas: HuellaViga[];
  /** Ábacos de cada losa reticular (por índice en `ctx.losas`), con su geometría ya unida (C4). */
  abacosUnidos: Map<number, Vec2[][]>;
}

const cm = (d: number) => `${(d * 100).toFixed(1)} cm`;

/**
 * Polígono de la huella de un pilar: rectángulo, u octógono inscrito en el círculo. El octógono va
 * en los ejes de la huella (los de su `giro`), para que gire con el pilar.
 */
function poligonoHuella(nd: NudoT): Vec2[] | null {
  const h = nd.pilar?.huella;
  const f = h?.forma;
  if (!h || !f) return null;
  const [cx, cy] = h.c;
  if (f.tipo === "circulo") {
    const r = f.D / 2;
    const q = Math.SQRT1_2;
    const [zx, zy] = h.ez;
    const [yx, yy] = h.ey;
    return [
      [1, 0],
      [q, q],
      [0, 1],
      [-q, q],
      [-1, 0],
      [-q, -q],
      [0, -1],
      [q, -q],
    ].map(([a, b]) => [cx + r * (a! * zx + b! * yx), cy + r * (a! * zy + b! * yy)] as Vec2);
  }
  const [zx, zy] = [(h.ez[0] * f.h) / 2, (h.ez[1] * f.h) / 2];
  const [yx, yy] = [(h.ey[0] * f.b) / 2, (h.ey[1] * f.b) / 2];
  return [
    [cx - zx - yx, cy - zy - yy],
    [cx + zx - yx, cy + zy - yy],
    [cx + zx + yx, cy + zy + yy],
    [cx - zx + yx, cy - zy + yy],
  ];
}

/**
 * Partes del segmento AB (en t ∈ [0, 1]) fuera de unos polígonos convexos (Cyrus–Beck): lo que de
 * un eje de viga queda fuera de las huellas de sus pilares.
 */
function fueraDeHuellas(A: Vec2, B: Vec2, polis: readonly (readonly Vec2[])[]): [number, number][] {
  const dentro: [number, number][] = [];
  const d: Vec2 = [B[0] - A[0], B[1] - A[1]];
  for (const p of polis) {
    const s = Math.sign(areaConSigno(p));
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < p.length && t0 < t1; i++) {
      const [P, Q] = [p[i]!, p[(i + 1) % p.length]!];
      const e: Vec2 = [Q[0] - P[0], Q[1] - P[1]];
      // Interior: s·(e × (X − P)) > 0, con X = A + t·d: num + t·den > 0
      const num = s * (e[0] * (A[1] - P[1]) - e[1] * (A[0] - P[0]));
      const den = s * (e[0] * d[1] - e[1] * d[0]);
      if (den === 0) {
        if (num <= 0) t1 = -1;
      } else if (den > 0) t0 = Math.max(t0, -num / den);
      else t1 = Math.min(t1, -num / den);
    }
    if (t1 > t0) dentro.push([t0, t1]);
  }
  dentro.sort((x, y) => x[0] - y[0]);
  const fuera: [number, number][] = [];
  let t = 0;
  for (const [a, b] of dentro) {
    if (a > t) fuera.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < 1) fuera.push([t, 1]);
  return fuera;
}

/** Rectángulo de una banda: eje desde → hasta y ancho. */
function rectanguloBanda(d: Vec2, h: Vec2, ancho: number): Vec2[] {
  const L = Math.sqrt((h[0] - d[0]) * (h[0] - d[0]) + (h[1] - d[1]) * (h[1] - d[1]));
  const [nx, ny] = [(-(h[1] - d[1]) / L) * (ancho / 2), ((h[0] - d[0]) / L) * (ancho / 2)];
  return [
    [d[0] - nx, d[1] - ny],
    [h[0] - nx, h[1] - ny],
    [h[0] + nx, h[1] + ny],
    [d[0] + nx, d[1] + ny],
  ];
}

/** Dirección del eje 1 de una losa: exacta en los múltiplos de 90°. */
export function direccionEje1(grados: number): Vec2 {
  const g = (((grados % 360) + 360) % 360) / 90;
  const ejes: Vec2[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  if (Number.isInteger(g)) return ejes[g]!;
  return [Math.cos((grados * Math.PI) / 180), Math.sin((grados * Math.PI) / 180)];
}

/**
 * C2-c: lo que un lado PQ corre a lo largo de una viga (su avance según el eje, σ) por dentro de su
 * ancho (a más de ε_snap de su eje y a ≤ b/2), dentro de su tramo. Un lado que sólo cruza la viga
 * de través (el de un hueco o del contorno que acaba en su eje) no avanza a lo largo de ella y no
 * cuenta (R-9: un hueco dibujado a ejes entre vigas sumaba b/2 en cada cruce y llegaba al umbral).
 */
function dentroDelAncho(P: Vec2, Q: Vec2, A: Vec2, u: Vec2, len: number, b: number, eps: number): number {
  const s = (X: Vec2) => (X[0] - A[0]) * u[1] - (X[1] - A[1]) * u[0]; // distancia con signo a la recta
  const sg = (X: Vec2) => (X[0] - A[0]) * u[0] + (X[1] - A[1]) * u[1]; // σ a lo largo del tramo
  const [s0, s1, g0, g1] = [s(P), s(Q), sg(P), sg(Q)];
  // Intervalo de t ∈ [0, 1] con σ ∈ [0, len]
  let lo = 0;
  let hi = 1;
  const recortar = (a0: number, a1: number, min: number, max: number) => {
    if (a0 === a1) {
      if (a0 < min || a0 > max) hi = -1;
      return;
    }
    let ta = (min - a0) / (a1 - a0);
    let tb = (max - a0) / (a1 - a0);
    if (ta > tb) [ta, tb] = [tb, ta];
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
  };
  recortar(g0, g1, 0, len);
  if (!(hi > lo)) return 0;
  // Dentro de ese intervalo, la parte con eps < |s| ≤ b/2 (s es lineal en t), medida por su avance
  // a lo largo del eje de la viga (σ también es lineal en t)
  const L = Math.abs(g1 - g0);
  let r = 0;
  for (const signo of [1, -1]) {
    let a = lo;
    let c = hi;
    const sa = (t: number) => signo * (s0 + (s1 - s0) * t);
    // eps < sa(t) ≤ b/2
    const corte = (min: number, max: number) => {
      const v0 = sa(0);
      const v1 = sa(1);
      if (v0 === v1) {
        if (!(v0 > min && v0 <= max)) c = -1;
        return;
      }
      let ta = (min - v0) / (v1 - v0);
      let tb = (max - v0) / (v1 - v0);
      if (ta > tb) [ta, tb] = [tb, ta];
      a = Math.max(a, ta);
      c = Math.min(c, tb);
    };
    corte(eps, b / 2);
    if (c > a) r += (c - a) * L;
  }
  return r;
}

/** Estado de una planta entre las fases de `construirLosas`. */
interface PlantaL extends PlantaMuros {
  idPlanta: string;
  nudosK: number[];
  tramosK: TramoViga[];
  huellasK: Map<number, Vec2[]>;
  mallar: LosaMallar[];
  losaDeMallar: number[];
  trazoCarga: Map<string, Trazo>;
  trazoApoyo: Map<string, Trazo>;
  puntoDe: Map<string, { i: number; Q: Vec2 }>;
  /** Trazos de los ábacos de cada losa reticular de la planta (C4). */
  trazoAbaco: Map<number, Trazo[]>;
}

/**
 * `puntosMuros`: los vértices de los muros ya ajustados (`ajustarMuros`, antes de las viguetas de
 * C4, para que sus nudos no los muevan). `panos`: los paños unidireccionales de C4; sus cargas
 * puntuales y los lados de las lineales que caen en ellos los reparten ellos.
 */
export function construirLosas(ctx: Contexto, topo: Topologia, cargas: readonly CargaFisica[], diag: Diagnosticos, puntosMuros: readonly Vec2[][], panos: PanosU | null = null): Losas {
  const { epsGeom, epsSnap, tamanoMalla: h, rejilla } = ctx.op;
  const r: Losas = {
    laminas: [],
    huellas: [],
    apoyosLineales: new Map(),
    apoyosPuntuales: new Map(),
    lineas: new Map(),
    lineasFuera: new Map(),
    lineasUnidas: new Map(),
    superficies: new Map(),
    zonasUnidas: new Map(),
    puntos: new Map(),
    regiones: ctx.losas.map((l) => l.region),
    diafragma: new Map(),
    malla: { nudos: 0, laminas: 0, jacobianoMin: 1, bajos: 0, laminasRejilla: 0, plantillas: 0 },
    muros: [],
    apoyosMuros: new Map(),
    auxiliares: [],
    planMuros: null,
    ladosMuros: [],
    aspectoMuros: { max: 1, altos: 0 },
    huellasVigas: [],
    abacosUnidos: new Map(),
  };
  const nudosAntes = topo.nudos.length;
  const indiceLosa = new Map(ctx.losas.map((l, i) => [l.losa.id, i] as const));
  const enPano = (k: number, Q: Vec2) => (panos?.regiones ?? []).some((reg, i) => ctx.panos[i]!.k === k && panos!.porPano[i]!.length > 0 && distanciaARegion(Q, reg) <= 1e-9);
  const ks = new Set(ctx.losas.map((l) => ctx.planta.get(l.losa.planta)!));
  for (const m of ctx.muros) for (let k = m.kh; k <= m.kb; k++) ks.add(k);
  const plantas = [...ks].sort((a, b) => b - a);
  const laminasSinOrden: (LaminaL & { c: Vec2 })[] = [];

  // 1. C2-c y C3-b, y el arreglo plano de cada planta
  for (const k of plantas) {
    const idPlanta = ctx.plantas[k]!.id;
    const losasK = ctx.losas.map((l, i) => ({ l, i })).filter(({ l }) => l.losa.planta === idPlanta);
    const tramosK = topo.tramos.filter((tv) => tv.k === k);
    const murosK = ctx.muros.map((m, w) => ({ m, w })).filter(({ m }) => k >= m.kh && k <= m.kb);

    // C2-c y C3-b: bordes de losa dentro del ancho de una viga o del espesor de un muro
    for (const { l } of losasK) {
      const polis = [l.region.contorno, ...l.region.huecos];
      for (const tv of tramosK) {
        const f = ctx.secciones.get(tv.viga.seccion)!.huella;
        const b = !f ? 0 : f.tipo === "rectangulo" ? f.b : f.D;
        if (!(b / 2 > epsSnap)) continue;
        let largo = 0;
        for (const p of polis) for (let i = 0; i < p.length; i++) largo += dentroDelAncho(p[i]!, p[(i + 1) % p.length]!, tv.t.A, tv.t.u, tv.t.len, b, epsSnap);
        if (largo > Math.max(2 * b, 4 * epsSnap))
          diag.error(
            "losa/borde-en-viga",
            `El borde de la losa ${l.losa.id} corre ${largo.toFixed(2)} m dentro del ancho de la viga ${tv.viga.id} sin ir por su eje (C2-c): la losa quedaría suelta de la viga. Dibuje el borde sobre el eje de la viga.`,
            [l.losa.id, tv.viga.id],
          );
      }
      for (const { m, w } of murosK) {
        const b = m.material.t;
        if (!(b / 2 > epsSnap)) continue;
        // Tramo a tramo, como las vigas: junto a una esquina del muro, el borde perpendicular de la
        // losa entra t/2 en su espesor sin ser un error
        const p = puntosMuros[w]!;
        let largo = 0;
        for (let i = 0; i + 1 < p.length; i++) {
          const [A, B] = [p[i]!, p[i + 1]!];
          const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
          const u: Vec2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
          let tramo = 0;
          for (const q of polis) for (let j = 0; j < q.length; j++) tramo += dentroDelAncho(q[j]!, q[(j + 1) % q.length]!, A, u, L, b, epsSnap);
          largo = Math.max(largo, tramo);
        }
        if (largo > Math.max(2 * b, 4 * epsSnap))
          diag.error(
            "losa/borde-en-muro",
            `El borde de la losa ${l.losa.id} corre ${largo.toFixed(2)} m dentro del espesor del muro ${m.muro.id} sin ir por su eje (C3-b): la losa quedaría suelta del muro. Dibuje el borde sobre el eje del muro.`,
            [l.losa.id, m.muro.id],
          );
      }
    }
  }
  if (diag.hayErrores) return r;

  /** Arreglo plano de la planta k, con los puntos `fijos` (las estaciones comunes de los muros). */
  const montar = (k: number, fijos: readonly Vec2[], diag: Diagnosticos): PlantaL | null => {
    const idPlanta = ctx.plantas[k]!.id;
    const losasK = ctx.losas.map((l, i) => ({ l, i })).filter(({ l }) => l.losa.planta === idPlanta);
    const tramosK = topo.tramos.filter((tv) => tv.k === k);
    const murosK = ctx.muros.map((m, w) => ({ m, w })).filter(({ m }) => k >= m.kh && k <= m.kb);
    // Dentro de una huella todo es rígido: ni el nudo del pilar (el maestro de su
    // enlace) ni los ejes de las vigas que le llegan hacen falta en la malla, y la partirían en
    // triángulos diminutos.
    const a = new Arreglo(epsGeom, epsSnap);
    const nudosK = topo.nudos.map((_, n) => n).filter((n) => topo.nudos[n]!.k === k);
    const huellasK = new Map<number, Vec2[]>();
    for (const n of nudosK) {
      const poli = poligonoHuella(topo.nudos[n]!);
      if (poli) huellasK.set(n, poli);
    }
    for (const n of nudosK) if (!huellasK.has(n)) a.fijo(topo.nudos[n]!.x, topo.nudos[n]!.y, n);
    for (const { w } of murosK) for (const P of puntosMuros[w]!) a.fijoMuro(P);
    for (const P of fijos) a.fijoMuro(P);
    for (const tv of tramosK) {
      const polis = tv.cadena.flatMap((c) => (huellasK.has(c.nudo) ? [huellasK.get(c.nudo)!] : []));
      const { A, B } = tv.t;
      for (const [t0, t1] of fueraDeHuellas(A, B, polis)) {
        if (!((t1 - t0) * tv.t.len > epsGeom)) continue;
        const P = (t: number): Vec2 => (t === 0 ? A : t === 1 ? B : [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
        a.trazo(tv.viga.id, "viga", tv.id, [P(t0), P(t1)], false);
      }
    }
    for (const [n, poli] of huellasK) a.trazo(topo.nudos[n]!.pilar!.pilares[0]!, "huella", n, poli, true);
    const muros: TrazoMuro[] = [];
    for (const { m, w } of murosK) {
      const t = a.trazo(m.muro.id, "muro", w, puntosMuros[w]!, false);
      if (!t || t.puntos.length !== puntosMuros[w]!.length) {
        diag.error("muro/degenerado", `El eje del muro ${m.muro.id} se queda sin longitud en la planta ${idPlanta} al unir sus puntos a lo cercano.`, [m.muro.id]);
        continue;
      }
      muros.push({ w, trazo: t, vertices: [...t.puntos] });
    }
    const mallar: LosaMallar[] = [];
    const losaDeMallar: number[] = [];
    for (const { l, i } of losasK) {
      const contorno = a.trazo(l.losa.id, "losa", -1, l.region.contorno, true);
      const huecos = l.region.huecos.map((hh, j) => a.trazo(l.losa.id, "hueco", j, hh, true));
      if (!contorno || huecos.some((x) => !x)) {
        diag.error("losa/degenerada", `La losa ${l.losa.id} (o uno de sus huecos) se queda sin área al unir sus vértices a lo cercano (tolerancia ${cm(epsSnap)}).`, [l.losa.id]);
        continue;
      }
      mallar.push({ id: l.losa.id, contorno, huecos: huecos as Trazo[], eje1: direccionEje1(l.losa.eje1 ?? 0) });
      losaDeMallar.push(i);
    }
    // Ábacos de los reticulares (C4): sus lados se siembran en la malla
    const trazoAbaco = new Map<number, Trazo[]>();
    for (const { l, i } of losasK) {
      if (!l.reticular) continue;
      const ts: Trazo[] = [];
      l.reticular.abacos.forEach((ab, j) => {
        const t = a.trazo(l.losa.id, "abaco", j, ab, true);
        if (t) ts.push(t);
        else diag.error("losa/degenerada", `El ábaco ${j + 1} de la losa ${l.losa.id} se queda sin área al unir sus vértices a lo cercano (tolerancia ${cm(epsSnap)}).`, [l.losa.id]);
      });
      trazoAbaco.set(i, ts);
    }
    for (const b of ctx.bandas) {
      if (b.planta !== idPlanta) continue;
      a.trazo(b.id, "banda", -1, rectanguloBanda(b.desde, b.hasta, b.ancho), true);
      // Las caras de sus apoyos, a lo ancho (C5.2): sus cortes por fuerzas nodales son exactos
      for (const e of estacionesBanda(b, epsGeom)) if (e.tipo === "cara") a.trazo(b.id, "banda", -1, ladoEstacion(b, e.s), false);
    }
    const trazoCarga = new Map<string, Trazo>();
    for (const c of cargas) {
      if (c.tipo === "superficie" && c.planta === idPlanta && c.zona) {
        const t = a.trazo(c.id, "zona", -1, c.zona, true);
        if (t) trazoCarga.set(c.id, t);
        else diag.error("carga/degenerada", `La zona de la carga ${c.id} se queda sin área al unir sus vértices a lo cercano.`, [c.id]);
      } else if (c.tipo === "lineal" && c.planta === idPlanta) {
        const t = a.trazo(c.id, "linea", -1, c.puntos, false);
        if (t) trazoCarga.set(c.id, t);
        else diag.error("carga/degenerada", `La carga lineal ${c.id} se queda sin longitud al unir sus vértices a lo cercano.`, [c.id]);
      }
    }
    const trazoApoyo = new Map<string, Trazo>();
    for (const ap of ctx.apoyosLineales) {
      if (ap.planta !== idPlanta) continue;
      const t = a.trazo(ap.id, "apoyo-lineal", -1, ap.puntos, false);
      if (t) trazoApoyo.set(ap.id, t);
      else diag.error("apoyo/degenerado", `El apoyo lineal ${ap.id} se queda sin longitud al unir sus vértices a lo cercano.`, [ap.id]);
    }
    const puntoDe = new Map<string, { i: number; Q: Vec2 }>();
    for (const c of cargas) {
      if (c.tipo !== "puntual" || c.planta !== idPlanta || topo.localizar(k, [c.x, c.y]) || enPano(k, [c.x, c.y])) continue;
      puntoDe.set(c.id, { i: a.punto([c.x, c.y], c.id, "punto", "su punto"), Q: [c.x, c.y] });
    }
    for (const ap of ctx.apoyos) {
      if (ap.planta !== idPlanta || topo.apoyoEn.has(ap.id)) continue;
      puntoDe.set(ap.id, { i: a.punto([ap.x, ap.y], ap.id, "punto", "su punto"), Q: [ap.x, ap.y] });
    }
    if (diag.hayErrores) return null;
    if (!a.resolver()) {
      diag.error("malla/arreglo", `No se ha podido ordenar la geometría de la planta ${idPlanta} para mallarla: hay rasgos más pequeños que ${cm(epsSnap)} que se cruzan entre sí.`, [idPlanta, ...losasK.map(({ l }) => l.losa.id)]);
      return null;
    }
    return { k, a, muros, idPlanta, nudosK, tramosK, huellasK, mallar, losaDeMallar, trazoCarga, trazoApoyo, puntoDe, trazoAbaco };
  };
  const montarTodas = (fijos: ReadonlyMap<number, Vec2[]>, d: Diagnosticos): Map<number, PlantaL> => {
    const e = new Map<number, PlantaL>();
    for (const k of plantas) {
      const p = montar(k, fijos.get(k) ?? [], d);
      if (p) e.set(k, p);
    }
    return e;
  };
  // Con muros, una primera pasada da sus estaciones en cada planta; las cercanas de plantas
  // distintas se unen en una sola (`estacionesComunes`) y la segunda pasada las lleva ya fijas, para
  // que cada planta resuelva igual los «casi encuentros» con el eje del muro
  let estado: Map<number, PlantaL>;
  if (ctx.muros.length) {
    const previa = montarTodas(new Map(), new Diagnosticos());
    estado = montarTodas(previa.size === plantas.length ? estacionesComunes(ctx, previa, puntosMuros) : new Map(), diag);
  } else estado = montarTodas(new Map(), diag);
  if (diag.hayErrores) return r;

  // 2. Estaciones de los muros, iguales en todas sus plantas (C3)
  const est = ctx.muros.length ? unificarEstaciones(ctx, estado, puntosMuros, diag) : null;
  if (ctx.muros.length && !est) return r;
  if (est) r.planMuros = planMuros(ctx, estado, puntosMuros, est, diag);
  const plan = r.planMuros;

  // 3. Malla y uniones de cada planta
  const nudosCadena = new Map<string, number[]>();
  const esclavosTodos = new Set<number>();
  for (const k of plantas) {
    const e = estado.get(k)!;
    const { a, idPlanta, mallar, losaDeMallar, huellasK, nudosK } = e;
    const defecto = a.defecto();
    if (defecto) {
      diag.error("malla/arreglo", `La geometría de la planta ${idPlanta} no se ha podido preparar para mallarla (${defecto}). Es un fallo del compilador.`, [idPlanta]);
      continue;
    }
    // Avisos de lo que se ha movido (el mayor por objeto; los ábacos, aparte de su losa)
    const mov = new Map<string, { id: string; tipo: TipoTrazo | "punto"; d: number }>();
    for (const mv of a.movimientos) {
      const clave = mv.tipo === "abaco" ? `${mv.id}|abaco` : mv.id;
      if ((mov.get(clave)?.d ?? 0) < mv.distancia) mov.set(clave, { id: mv.id, tipo: mv.tipo, d: mv.distancia });
    }
    for (const [, mv] of [...mov].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const id = mv.id;
      if (mv.tipo === "huella") continue;
      if (mv.tipo === "abaco") {
        diag.aviso("losa/ajuste", `Un ábaco de la losa ${id} se ajusta a lo que lo rodea: su borde se mueve hasta ${cm(mv.d)} (C2-b).`, [id], { distancia: mv.d });
        continue;
      }
      if (mv.tipo === "losa" || mv.tipo === "hueco") {
        const li = indiceLosa.get(id)!;
        const t = mallar.find((x) => x.id === id);
        const antes = momentosRegion(ctx.losas[li]!.region).A;
        const despues = t ? Math.abs(areaConSigno(t.contorno.puntos.map((p) => [a.puntos[p]!.x, a.puntos[p]!.y] as Vec2))) - t.huecos.reduce((s, hh) => s + Math.abs(areaConSigno(hh.puntos.map((p) => [a.puntos[p]!.x, a.puntos[p]!.y] as Vec2))), 0) : antes;
        diag.aviso("losa/ajuste", `La losa ${id} se ajusta a lo que la rodea: su borde se mueve hasta ${cm(mv.d)} y su área cambia ${(despues - antes).toFixed(4)} m² (C2-b).`, [id], { distancia: mv.d, area: despues - antes });
      } else if (mv.tipo === "muro") diag.aviso("muro/ajuste", `El eje del muro ${id} se dobla hasta ${cm(mv.d)} en la planta ${idPlanta} para pasar por lo cercano (C3-b).`, [id], { distancia: mv.d });
      else diag.aviso("losa/ajuste", `${mv.tipo === "punto" ? "El punto de" : "La geometría de"} ${id} se mueve hasta ${cm(mv.d)} para unirse a lo cercano (C2-b).`, [id], { distancia: mv.d });
    }

    // Malla de las losas (los lados de los muros ya van sembrados)
    let m: Extract<ResultadoMalla, { ok: true }> | null = null;
    if (mallar.length) {
      const res = mallarPlanta(a, mallar, h, epsGeom, est?.presembrados.get(k), rejilla);
      if (!res.ok) {
        diag.error("malla/triangulacion", `La triangulación de la planta ${idPlanta} ha fallado (${res.mensaje}). Es un fallo del compilador.`, [idPlanta, ...mallar.map((x) => x.id)]);
        continue;
      }
      for (const p of res.problemas) {
        const ids = p.losa >= 0 ? [mallar[p.losa]!.id] : mallar.map((x) => x.id);
        if (p.severidad === "error") diag.error(p.codigo, p.mensaje, ids);
        else diag.aviso(p.codigo, p.mensaje, ids);
      }
      r.malla.jacobianoMin = Math.min(r.malla.jacobianoMin, res.calidad.jacobianoMin);
      r.malla.bajos += res.calidad.bajos;
      r.malla.laminasRejilla += res.rejilla.quads;
      r.malla.plantillas += res.rejilla.plantillas;
      if (res.problemas.some((p) => p.severidad === "error")) continue;
      mallar.forEach((_, j) => (r.regiones[losaDeMallar[j]!] = res.regiones[j]!));
      m = res;
    }

    // Nudos de la malla → nudos de la topología
    const nudoT = (m?.nudos ?? []).map((nm) => {
      const p = nm.punto >= 0 ? a.puntos[nm.punto]! : null;
      if (p && p.nudo >= 0) return p.nudo;
      topo.nudos.push({ k, x: nm.x, y: nm.y, fisicos: new Set(), pilar: null });
      return topo.nudos.length - 1;
    });
    // Ábacos unidos (C4): una lámina es de un ábaco si el centroide de su pieza cae en él (sus lados
    // están sembrados, así que cada pieza está entera dentro o fuera)
    const xyA = (p: number): Vec2 => [a.puntos[p]!.x, a.puntos[p]!.y];
    for (const [li, ts] of e.trazoAbaco) r.abacosUnidos.set(li, ts.map((t) => t.puntos.map(xyA)));
    for (const q of m?.quads ?? []) {
      const li = losaDeMallar[q.losa]!;
      const ns = q.nudos.map((n) => nudoT[n]!) as [number, number, number, number];
      for (const n of ns) topo.nudos[n]!.fisicos.add(ctx.losas[li]!.losa.id);
      const c: Vec2 = [(topo.nudos[ns[0]]!.x + topo.nudos[ns[1]]!.x + topo.nudos[ns[2]]!.x + topo.nudos[ns[3]]!.x) / 4, (topo.nudos[ns[0]]!.y + topo.nudos[ns[1]]!.y + topo.nudos[ns[2]]!.y + topo.nudos[ns[3]]!.y) / 4];
      const abacos = r.abacosUnidos.get(li);
      const abaco = abacos?.some((ab) => puntoEnPoligono(m!.piezas[q.pieza]!.c, ab)) ?? false;
      laminasSinOrden.push({ nudos: ns, losa: li, k, c, ...(abaco ? { abaco: true as const } : {}) });
    }
    const nudosMalla = [...new Set((m?.quads ?? []).flatMap((q) => q.nudos.map((n) => nudoT[n]!)))].sort((x, y) => x - y);
    const usado = new Map((m?.nudos ?? []).map((nm, i) => [nm.punto, i] as const).filter(([p]) => p >= 0));
    // Nudos a lo largo de cada lado del arreglo (de su punto menor al mayor): los de la malla y los
    // de los ejes de los muros
    const lados = m ? m.lados : a.lados();
    const ladoNodos = new Map<string, number[]>();
    if (m) lados.forEach((l, i) => m.nudosLado[i]!.length && ladoNodos.set(`${l.a},${l.b}`, m.nudosLado[i]!.map((n) => nudoT[n]!)));
    const nodoPunto = new Map<number, number>();
    const nodoDePunto = (p: number): number => {
      const nm = usado.get(p);
      if (nm !== undefined) return nudoT[nm]!;
      let n = nodoPunto.get(p);
      if (n === undefined) {
        const q = a.puntos[p]!;
        if (q.nudo >= 0) n = q.nudo;
        else {
          topo.nudos.push({ k, x: q.x, y: q.y, fisicos: new Set(), pilar: null });
          n = topo.nudos.length - 1;
        }
        nodoPunto.set(p, n);
      }
      return n;
    };
    const nodoMedio = (p: number, q: number): number => {
      const kk = p < q ? `${p},${q}` : `${q},${p}`;
      const c = ladoNodos.get(kk);
      if (c) return c[1]!;
      const [A, B] = [a.puntos[p]!, a.puntos[q]!];
      topo.nudos.push({ k, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, fisicos: new Set(), pilar: null });
      const n = topo.nudos.length - 1;
      ladoNodos.set(kk, p < q ? [nodoDePunto(p), n, nodoDePunto(q)] : [nodoDePunto(q), n, nodoDePunto(p)]);
      return n;
    };
    // Nudos de los ejes de los muros en la cota de la planta: sólo donde hay muro debajo o encima
    const nudosMuros = new Set<number>();
    const apoyados = new Set<number>();
    if (plan && est) {
      for (const { w } of e.muros) {
        const mw = ctx.muros[w]!;
        for (let i = 0; i + 1 < puntosMuros[w]!.length; i++) {
          const c = est.cadena(k, w, i);
          const pr = c.slice(1).map((_, j) => plan.presente(k, w, i, j));
          const nec = pr.map((x) => x.debajo || x.encima);
          const lista: number[] = [];
          for (let j = 0; j < c.length; j++) {
            lista.push((j > 0 && nec[j - 1]) || (j < nec.length && nec[j]) ? nodoDePunto(c[j]!) : -1);
            if (j < nec.length) lista.push(nec[j] ? nodoMedio(c[j]!, c[j + 1]!) : -1);
          }
          nudosCadena.set(`${k}:${w}:${i}`, lista);
          for (const n of lista) {
            if (n < 0) continue;
            topo.nudos[n]!.fisicos.add(mw.muro.id);
            nudosMuros.add(n);
            if (k === mw.kb && (mw.muro.base ?? "empotrado") !== "ninguno") apoyados.add(n);
          }
          for (let j = 0; j < nec.length; j++) {
            if (!nec[j]) continue;
            const [A, B] = [a.puntos[c[j]!]!, a.puntos[c[j + 1]!]!];
            r.ladosMuros.push({ k, w, i, nudos: [lista[2 * j]!, lista[2 * j + 1]!, lista[2 * j + 2]!], A: [A.x, A.y], B: [B.x, B.y], debajo: pr[j]!.debajo, encima: pr[j]!.encima });
          }
        }
      }
    }

    // Huellas (C2-d): nudos de la malla y de los muros (salvo los de una base con vínculo)
    const candidatos = [...new Set([...nudosMalla, ...nudosMuros])].filter((n) => !apoyados.has(n)).sort((x, y) => x - y);
    const esclavoDe = new Map<number, string>();
    const huellasPlanta: HuellaL[] = [];
    for (const [n, poli] of huellasK) {
      const pilar = topo.nudos[n]!.pilar!.pilares[0]!;
      const esclavos = candidatos.filter((x) => {
        if (x === n) return false;
        const q: Vec2 = [topo.nudos[x]!.x, topo.nudos[x]!.y];
        return puntoEnPoligono(q, poli) || distanciaABorde(q, poli) <= epsSnap;
      });
      if (!esclavos.length) continue;
      const dobles = esclavos.filter((x) => esclavoDe.has(x));
      if (dobles.length) {
        diag.error("losa/huellas-solapadas", `Las huellas de los pilares ${esclavoDe.get(dobles[0]!)} y ${pilar} se solapan (o quedan a menos de ${cm(epsSnap)}) en la losa de la planta ${idPlanta}.`, [esclavoDe.get(dobles[0]!)!, pilar]);
        continue;
      }
      for (const x of esclavos) {
        esclavoDe.set(x, pilar);
        esclavosTodos.add(x);
      }
      const espesor = Math.max(
        0,
        ...(m?.quads ?? []).filter((q) => q.nudos.some((nn) => esclavos.includes(nudoT[nn]!))).map((q) => ctx.losas[losaDeMallar[q.losa]!]!.material.t),
      );
      huellasPlanta.push({ pilar, k, maestro: n, esclavos, espesor });
    }
    // Pilares unidos a la losa en un punto (sin huella)
    for (const n of nudosK) {
      const nd = topo.nudos[n]!;
      if (nd.pilar && !huellasK.has(n) && nudosMalla.includes(n))
        diag.aviso("losa/union-puntual", `El pilar ${nd.pilar.pilares[0]} no tiene dimensiones y se une a la losa en un punto: el momento de la losa en su nudo no converge al refinar (H09). Dé su sección con b y h.`, [nd.pilar.pilares[0]!]);
    }
    r.huellas.push(...huellasPlanta);

    // Vigas embebidas (C2-e, C3-e): se parten en los nudos de la malla o de los muros sobre su eje
    const ladosDe = (pred: (t: Trazo) => boolean) => lados.filter((l) => l.trazos.some((t) => pred(a.trazos[t]!)));
    for (const tv of e.tramosK) {
      const nuevos = new Set<number>();
      for (const l of ladosDe((t) => t.tipo === "viga" && t.ref === tv.id)) for (const n of ladoNodos.get(`${l.a},${l.b}`) ?? []) if (!esclavoDe.has(n)) nuevos.add(n);
      const antes = new Set([tv.ini, tv.fin, ...tv.partes]);
      const add = [...nuevos].filter((n) => !antes.has(n));
      if (!add.length) continue;
      tv.partes.push(...add);
      ordenarCadena(ctx, topo.nudos, tv, diag);
      for (const n of add) {
        let s = topo.vigasEn.get(n);
        if (!s) topo.vigasEn.set(n, (s = new Set()));
        s.add(tv.viga.id);
      }
    }

    // Apoyos lineales y cargas lineales: nudos y aristas a lo largo de sus lados
    const recorrer = (t: Trazo): { aristas: [number, number][]; fuera: boolean; lados: [Vec2, Vec2][] } => {
      const aristas: [number, number][] = [];
      const lados: [Vec2, Vec2][] = [];
      let fuera = false;
      const n = t.puntos.length;
      for (let i = 0; i < (t.cerrado ? n : n - 1); i++) {
        const [pa, pb] = [t.puntos[i]!, t.puntos[(i + 1) % n]!];
        const c = ladoNodos.get(pa < pb ? `${pa},${pb}` : `${pb},${pa}`) ?? [];
        if (!c.length) {
          fuera = true;
          lados.push([
            [a.puntos[pa]!.x, a.puntos[pa]!.y],
            [a.puntos[pb]!.x, a.puntos[pb]!.y],
          ]);
          continue;
        }
        const ordenada = pa < pb ? c : [...c].reverse();
        for (let j = 0; j + 1 < ordenada.length; j++) aristas.push([ordenada[j]!, ordenada[j + 1]!]);
      }
      return { aristas, fuera, lados };
    };
    const conPanos = ctx.panos.some((p) => p.k === k);
    for (const [id, t] of e.trazoApoyo) {
      const { aristas, fuera } = recorrer(t);
      if (fuera) diag.error("apoyo/fuera-de-losa", `El apoyo lineal ${id} no va entero sobre las losas o los ejes de los muros de la planta ${idPlanta}.`, [id]);
      r.apoyosLineales.set(id, [...new Set(aristas.flat())]);
    }
    for (const [id, t] of e.trazoCarga) {
      const xy = (p: number): Vec2 => [a.puntos[p]!.x, a.puntos[p]!.y];
      if (t.tipo === "linea") {
        const { aristas, fuera, lados } = recorrer(t);
        // Con paños (C4), lo que no va sobre la malla lo reparten ellos (y lo que no cubran, error)
        if (fuera && conPanos) r.lineasFuera.set(id, lados);
        else if (fuera) diag.error("carga/fuera-de-losa", `La carga lineal ${id} no va entera sobre las losas o los ejes de los muros de la planta ${idPlanta}: lo que cae fuera se perdería.`, [id]);
        r.lineas.set(id, aristas);
        r.lineasUnidas.set(id, t.puntos.map(xy));
      } else r.zonasUnidas.set(id, t.puntos.map(xy));
    }
    // Cargas de superficie: láminas cuya pieza (triángulo o celda de la rejilla) cae en la zona (y en
    // su losa, si la da)
    if (m) {
      for (const c of cargas) {
        if (c.tipo !== "superficie" || c.planta !== idPlanta || c.pano !== undefined) continue;
        const zona = r.zonasUnidas.get(c.id);
        const li = c.losa !== undefined ? indiceLosa.get(c.losa) : undefined;
        const piezas = new Set<number>();
        m.piezas.forEach((t, ti) => {
          if (li !== undefined && losaDeMallar[t.losa] !== li) return;
          if (zona && !puntoEnPoligono(t.c, zona)) return;
          piezas.add(ti);
        });
        const base = r.laminas.length + laminasSinOrden.length - m.quads.length;
        r.superficies.set(
          c.id,
          m.quads.flatMap((q, qi) => (piezas.has(q.pieza) ? [base + qi] : [])),
        );
      }
    }
    // Puntos sueltos: en un vértice de la malla o en una estación de un muro
    for (const [id, { i }] of e.puntoDe) {
      const nm = usado.get(i);
      const n = nm !== undefined ? nudoT[nm]! : nodoPunto.get(i);
      const esApoyo = ctx.apoyos.some((x) => x.id === id);
      if (n === undefined) {
        diag.error(esApoyo ? "apoyo/sin-destino" : "carga/sin-destino", `${esApoyo ? "El apoyo" : "La carga"} ${id} no cae sobre ningún pilar, nudo, viga, losa ni muro de la planta ${idPlanta} (tolerancia ${cm(epsSnap)}).`, [id]);
        continue;
      }
      if (esApoyo) {
        r.apoyosPuntuales.set(id, n);
        topo.nudos[n]!.fisicos.add(id);
      } else r.puntos.set(id, n);
    }

    // Diafragma (C2-f): con losas, los nudos de la malla que no son esclavos de una huella y los
    // maestros; sin ellas, todos los de la cota de la planta salvo los esclavos (C1-e)
    const maestros = huellasPlanta.map((x) => x.maestro);
    const enDiafragma = m ? nudosMalla : topo.nudos.flatMap((nd, n) => (nd.k === k && nd.z === undefined ? [n] : []));
    r.diafragma.set(k, [...new Set([...enDiafragma.filter((n) => !esclavoDe.has(n)), ...maestros])].sort((x, y) => x - y));
  }
  if (diag.hayErrores) return r;

  // 4. Rejilla de los muros
  if (plan) {
    const mm = mallarMuros(ctx, topo, plan, (k, w, i) => nudosCadena.get(`${k}:${w}:${i}`)!, esclavosTodos, (k) => [...(estado.get(k)?.huellasK.values() ?? [])], diag);
    r.muros = mm.laminas;
    r.apoyosMuros = mm.apoyos;
    r.auxiliares = mm.auxiliares;
    r.aspectoMuros = mm.aspecto;
    r.huellasVigas = huellasVigas(ctx, topo, (k, w, i) => nudosCadena.get(`${k}:${w}:${i}`)!, esclavosTodos);
  }

  // Orden canónico de las láminas de las losas: cota, centroide x, y (cuantizados, como los nudos), losa
  const q = (v: number) => Math.round(v / CUANTO_ORDEN);
  const orden = laminasSinOrden.map((_, i) => i).sort((x, y) => {
    const [a, b] = [laminasSinOrden[x]!, laminasSinOrden[y]!];
    return ctx.cotas[a.k]! - ctx.cotas[b.k]! || q(a.c[0]) - q(b.c[0]) || q(a.c[1]) - q(b.c[1]) || a.losa - b.losa || a.c[0] - b.c[0] || a.c[1] - b.c[1] || x - y;
  });
  const nuevo = new Int32Array(orden.length);
  orden.forEach((v, i) => (nuevo[v] = i));
  r.laminas = orden.map((i) => {
    const { nudos, losa, k, abaco } = laminasSinOrden[i]!;
    return { nudos, losa, k, ...(abaco ? { abaco } : {}) };
  });
  for (const [id, l] of r.superficies) r.superficies.set(id, l.map((i) => nuevo[i]!).sort((x, y) => x - y));
  r.malla.nudos = topo.nudos.length - nudosAntes;
  r.malla.laminas = r.laminas.length;
  return r;
}
