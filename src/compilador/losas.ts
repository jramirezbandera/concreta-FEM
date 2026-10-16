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
 *      de ella, son esclavos de un enlace rígido con maestro en el nudo del pilar. Con LV2
 *      (`refinoEsquinas`, LV2-f), en un pilar que atraviesa el ancho de una viga, sólo los de la
 *      huella o su borde: lo que asoma de la viga deja junto al pilar nudos a unos centímetros de
 *      la huella, y hacerlos rígidos rigidizaba la losa junto a él (la viga en su cara, hasta un
 *      21 % alta, y las franjas, hasta un 78 % bajas; `validacion/lv2/asoma.ts`). Y con LV2, lo
 *      que siembra la malla junto a los anchos sigue sus caras (LV-8): el ancho es un trazo
 *      exacto, lo que la huella sembrada tiene a ≤ ε_snap de una cara va sobre ella y los ejes de
 *      las vigas se cortan en esa huella sembrada, la cara de franja de una huella tapada acaba
 *      en la cara del ancho, y lo que asoma más de ε_snap llega a la rejilla en tiras
 *      (`mallado.ts`, `rejilla.ts` §9). Lo rígido sigue siendo la huella de verdad;
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
import { mallarPlanta, type AnchoMallar, type LosaMallar, type ResultadoMalla, type RefinoCaras } from "./mallado.ts";
import { anchoMasCercano, anchosPlanta, anchoUnion, sigmaEnAncho, type AnchoViga } from "./anchosVigas.ts";
import { estacionesBanda, ladoEstacion } from "./estaciones.ts";
import { carasFranjas, ejesArmado, segmentosCara, type CaraFranja } from "./franjas.ts";
import { estacionesComunes, huellasVigas, mallarMuros, planMuros, unificarEstaciones, type HuellaViga, type LaminaMuro, type MallaMuros, type PlanMuros, type PlantaMuros, type TrazoMuro } from "./muros.ts";
import { areaConSigno, distanciaABorde, momentosRegion, puntoEnPoligono, type Region } from "./poligonos.ts";
import { cuerdaEnTramo, distanciaARegion, ordenarCadena, type NudoT, type Topologia, type TramoViga } from "./topologia.ts";
import type { PanosU } from "./unidireccional.ts";
import { diafragmaDe } from "./piezas.ts";
import type { Contexto } from "./validar.ts";

/**
 * ¿Va la carga al diafragma de su planta, sin nudo propio en la losa (SP-5)? Una puntual sólo
 * horizontal (Fz, Mx y My nulos) que cae en una losa de una planta con diafragma rígido: ux, uy y rz
 * de todos los nudos de la losa dependen del maestro, así que en cualquiera de ellos, con su momento
 * de transporte, da al maestro la misma carga que en su punto. Sembrar el punto sacaba la rejilla de
 * su alrededor y llenaba de triángulos el vano (las del viento y el sismo en el centro de masas).
 */
export function alDiafragma(ctx: Contexto, k: number, c: CargaFisica): boolean {
  if (c.tipo !== "puntual" || (c.F?.[2] ?? 0) !== 0 || (c.M?.[0] ?? 0) !== 0 || (c.M?.[1] ?? 0) !== 0) return false;
  if (diafragmaDe(ctx, k) !== "rigido") return false;
  return ctx.losas.some((l) => l.losa.planta === c.planta && distanciaARegion([c.x, c.y], l.region) <= 1e-9);
}

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
  malla: { nudos: number; laminas: number; jacobianoMin: number; bajos: number; laminasRejilla: number; plantillas: number; plantillasRefinadas: number };
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
  /** Fase LV: el ancho de las vigas que se unen a la losa por sus caras, de todas las plantas. */
  anchos: AnchoViga[];
  /**
   * Piezas de la malla en el ancho de una viga (índice en `anchos`) y en la región de una losa (en
   * `ctx.losas`): no son láminas, y su carga pasa a la viga. `abaco`: cae en un ábaco de la losa.
   */
  piezasAncho: { ancho: number; losa: number; v: Vec2[]; c: Vec2; area: number; abaco: boolean }[];
  /** Por carga de superficie: las piezas de los anchos que cubre. */
  superficiesAncho: Map<string, number[]>;
  /** Por carga lineal: sus lados en el ancho de una viga (índice en `anchos`). */
  lineasAncho: Map<string, { ancho: number; A: Vec2; B: Vec2 }[]>;
  /** Por carga puntual en el ancho de una viga, fuera de su eje: el ancho. */
  puntosAncho: Map<string, number>;
  /** Enlaces rígidos de las caras de las vigas: los nudos de la losa en ellas, con maestro en el eje. */
  enlacesVigas: { viga: string; k: number; maestro: number; esclavos: number[] }[];
  /**
   * Por apoyo que llega a una viga por su ancho o su cara (fase LV) o a la huella de un pilar: las
   * vigas a cuyo eje pasa y los pilares en cuya huella acaba.
   */
  apoyosAViga: Map<string, { vigas: string[]; pilares: string[]; nudos: number[] }>;
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
  /** Caras de los pilares que se refinan en la malla (F2). */
  refino: RefinoCaras;
  /** Fase LV: los anchos de las vigas de la planta, con su trazo y su índice en `Losas.anchos`. */
  anchos: { a: AnchoViga; t: Trazo; g: number }[];
  /** Cargas puntuales en el ancho de una viga (índice local en `anchos`). */
  puntoAncho: Map<string, number>;
  /** Apoyos puntuales en el ancho de una viga, fuera de su eje (índice local en `anchos`). */
  apoyoAncho: Map<string, number>;
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
    malla: { nudos: 0, laminas: 0, jacobianoMin: 1, bajos: 0, laminasRejilla: 0, plantillas: 0, plantillasRefinadas: 0 },
    muros: [],
    apoyosMuros: new Map(),
    auxiliares: [],
    planMuros: null,
    ladosMuros: [],
    aspectoMuros: { max: 1, altos: 0 },
    huellasVigas: [],
    abacosUnidos: new Map(),
    anchos: [],
    piezasAncho: [],
    superficiesAncho: new Map(),
    lineasAncho: new Map(),
    puntosAncho: new Map(),
    enlacesVigas: [],
    apoyosAViga: new Map(),
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
        // Fase LV: lo que de la losa cae en el ancho de una viga que se une por sus caras no es losa
        if (anchoUnion(ctx, tv.viga) !== null) continue;
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

  // Fase LV: el ancho de las vigas que se unen a la losa por sus caras, en las plantas con losas
  const anchosDe = new Map<number, number[]>();
  for (const k of plantas) {
    // El eje 1 de la primera losa de la planta, el que orienta su rejilla y los empates de su CDT
    const primera = ctx.losas.find((l) => l.losa.planta === ctx.plantas[k]!.id);
    if (!primera) continue;
    const lista: number[] = [];
    for (const x of anchosPlanta(ctx, topo, k, direccionEje1(primera.losa.eje1 ?? 0))) lista.push(r.anchos.push(x) - 1);
    if (lista.length) anchosDe.set(k, lista);
  }

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
    // Fase LV2 (LV-8): las caras de los anchos son trazos exactos (no se doblan), así que lo que
    // la huella sembrada tiene a ≤ ε_snap de una cara (la esquina de un 40 bajo una viga de 30 en
    // la que acaba, o el lado de un 60 × 25 dentro de ella) va a la cara, proyectado: es lo que el
    // arreglo haría con un vértice que llega después (regla 1), y lo que hace `tapada` con lo que
    // asoma ≤ ε_snap. Por las rectas de las caras de los anchos que pasan por el pilar (los de las
    // vigas que lo cruzan o acaban en él), para que los lados de la huella sigan paralelos: en un
    // 40 bajo una viga de 30 que acaba en su centro, las dos esquinas de cada lado van a la cara.
    // Lo rígido sigue siendo la huella de verdad (C2-d, `unirCaras`); la sembrada sólo da la malla,
    // y los ejes de las vigas se cortan en ella, para que acaben en su lado
    const carasAnchoK = (anchosDe.get(k) ?? []).map((g) => {
      const [d0, d1, i1, i0] = r.anchos[g]!.poligono as [Vec2, Vec2, Vec2, Vec2];
      return { poli: r.anchos[g]!.poligono, caras: [[d0, d1] as const, [i0, i1] as const] };
    });
    const aLasCaras = (poli: readonly Vec2[], centro: Vec2): Vec2[] => {
      const rectas = carasAnchoK.filter((x) => puntoEnPoligono(centro, x.poli) || distanciaABorde(centro, x.poli) <= epsSnap).flatMap((x) => x.caras);
      return poli.map((q) => {
        for (const [A, B] of rectas) {
          const [ux, uy] = [B[0] - A[0], B[1] - A[1]];
          const L2 = ux * ux + uy * uy;
          if (!(L2 > 0)) continue;
          const t = ((q[0] - A[0]) * ux + (q[1] - A[1]) * uy) / L2;
          const X: Vec2 = [A[0] + t * ux, A[1] + t * uy];
          const d = Math.hypot(q[0] - X[0], q[1] - X[1]);
          if (d > 10 * epsGeom && d <= epsSnap + 10 * epsGeom) return X;
        }
        return q;
      });
    };
    /** Huella que se siembra de cada pilar: la de verdad, o con lo que tiene a ≤ ε_snap de una cara de ancho sobre ella (LV2). */
    const huellasSembradas = new Map<number, Vec2[]>();
    for (const [n, poli] of huellasK) huellasSembradas.set(n, ctx.op.refinoEsquinas ? aLasCaras(poli, [topo.nudos[n]!.x, topo.nudos[n]!.y]) : poli);
    for (const tv of tramosK) {
      const polis = tv.cadena.flatMap((c) => (huellasSembradas.has(c.nudo) ? [huellasSembradas.get(c.nudo)!] : []));
      const { A, B } = tv.t;
      for (const [t0, t1] of fueraDeHuellas(A, B, polis)) {
        if (!((t1 - t0) * tv.t.len > epsGeom)) continue;
        const P = (t: number): Vec2 => (t === 0 ? A : t === 1 ? B : [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
        a.trazo(tv.viga.id, "viga", tv.id, [P(t0), P(t1)], false);
      }
    }
    // Fase LV: la huella de un pilar que el ancho de sus vigas tapa salvo ≤ ε_snap no se siembra. Lo que
    // asoma (un pilar de 40 con vigas de 30) va con el pilar por C2-d igual, y sus esquinas, sueltas a
    // unos centímetros de las caras, dejaban irregulares todas las celdas de la rejilla junto al pilar
    // (lo que cae fuera de las losas, el lado de fuera de un pilar de borde, tampoco cuenta)
    const polisAnchoK = (anchosDe.get(k) ?? []).map((g) => r.anchos[g]!.poligono);
    const regionesK = losasK.map(({ l }) => l.region);
    const tapada = (poli: readonly Vec2[]) =>
      polisAnchoK.length > 0 &&
      poli.every((P0, i) => {
        const P1 = poli[(i + 1) % poli.length]!;
        return [0, 0.25, 0.5, 0.75].every((t) => {
          const q: Vec2 = [P0[0] + t * (P1[0] - P0[0]), P0[1] + t * (P1[1] - P0[1])];
          if (!regionesK.some((rg) => distanciaARegion(q, rg) <= epsSnap)) return true;
          return polisAnchoK.some((pa) => puntoEnPoligono(q, pa) || distanciaABorde(q, pa) <= epsSnap + 10 * epsGeom);
        });
      });
    /** Huellas tapadas (sin sembrar), por el id de su pilar: su nudo. */
    const tapadas = new Map<string, number>();
    for (const [n, poli] of huellasK) {
      if (tapada(poli)) tapadas.set(topo.nudos[n]!.pilar!.pilares[0]!, n);
      else a.trazo(topo.nudos[n]!.pilar!.pilares[0]!, "huella", n, huellasSembradas.get(n)!, true);
    }
    // Fase LV2 (LV-8): con la huella tapada por el ancho de su viga, la cara de franja que pasa por
    // dentro de ella (la cara común de C5-g) acaba en la cara del ancho, no en la de la huella. Con un
    // pilar más ancho que la viga (un 40 bajo una de 30), su extremo quedaba suelto a lo que asoma
    // (≤ ε_snap) de la cara del ancho, y con uno más estrecho (un 25 × 60 bajo una de 30), un trozo
    // de 2,5 cm dentro del ancho: la triangulación unía los dos con astillas. Lo que gana la cara
    // cae en la huella, rígido con el pilar como su extremo en la cara del ancho (C2-d, `unirCaras`)
    const hastaElAncho = (c: CaraFranja, { d, n }: { d: Vec2; n: Vec2 }) => {
      for (const p of c.pilares) {
        const pn = tapadas.get(p.id);
        if (pn === undefined) continue;
        const q: Vec2 = [topo.nudos[pn]!.x, topo.nudos[pn]!.y];
        for (const g of anchosDe.get(k) ?? []) {
          const x = r.anchos[g]!;
          const { u } = x.tramo.t;
          // Sólo un ancho a lo largo de d, que cruza la recta de la cara (según n) en perpendicular
          if (Math.abs(u[0] * d[0] + u[1] * d[1]) < 1 - 1e-9 || !puntoEnPoligono(q, x.poligono)) continue;
          const tc = q[0] * n[0] + q[1] * n[1];
          const [lo, hi] = [tc - x.b / 2, tc + x.b / 2];
          c.tramos = c.tramos.flatMap(([t0, t1]): [number, number][] => {
            const [a, b] = [Math.abs(t0 - p.t1) <= 1e-9 ? hi : t0, Math.abs(t1 - p.t0) <= 1e-9 ? lo : t1];
            return b - a > 1e-9 ? [[a, b]] : [];
          });
        }
      }
    };
    const muros: TrazoMuro[] = [];
    for (const { m, w } of murosK) {
      const t = a.trazo(m.muro.id, "muro", w, puntosMuros[w]!, false);
      if (!t || t.puntos.length !== puntosMuros[w]!.length) {
        diag.error("muro/degenerado", `El eje del muro ${m.muro.id} se queda sin longitud en la planta ${idPlanta} al unir sus puntos a lo cercano.`, [m.muro.id]);
        continue;
      }
      muros.push({ w, trazo: t, vertices: [...t.puntos] });
    }
    // Fase LV: el ancho de las vigas, después de los muros y antes que las losas, cuyos bordes se unen
    // a sus caras
    const anchos: PlantaL["anchos"] = [];
    // Fase LV2 (LV-8): el trazo del ancho es exacto, para que sus caras no se tuerzan. Si no, el
    // vértice del extremo de un ancho que acaba dentro de la huella de su pilar (una viga que llega
    // a un pilar circular, o a uno más ancho que ella con losa por el otro lado) se unía a lo que
    // tenía a ≤ ε_snap (la huella), y una esquina de huella a 2,5 cm de la cara la doblaba (regla 2):
    // la cara quedaba inclinada hasta 5 cm a lo largo de toda la viga, ni era una línea de la
    // rejilla ni acababan en ella las caras de las franjas. Lo que las huellas tienen a ≤ ε_snap de
    // una cara ya está sobre ella (`aLasCaras`)
    for (const g of anchosDe.get(k) ?? []) {
      const x = r.anchos[g]!;
      const t = a.trazo(x.viga, "ancho", x.tramo.id, x.poligono, true, ctx.op.refinoEsquinas);
      if (t) anchos.push({ a: x, t, g });
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
    // Las caras de los pilares para las franjas de armado (fase F), de lado a lado de la losa:
    // trazos exactos, como las de las bandas (C5-g)
    const caras: { id: string; seg: [Vec2, Vec2] }[] = [];
    // Y las caras que se refinan (F2): por pilar, la normal de su recta y su lado
    const refino = new Map<string, { d: Vec2; lado: -1 | 1 }[]>();
    if (ctx.op.franjas)
      for (const { l } of losasK) {
        const ejes = ejesArmado(l.losa);
        for (const c of carasFranjas(ctx, l)) {
          if (ctx.op.unionLosaViga === "cara" && ctx.op.refinoEsquinas && tapadas.size) hastaElAncho(c, ejes[c.direccion]);
          for (const seg of segmentosCara(c, ejes[c.direccion])) caras.push({ id: l.losa.id, seg });
          if (ctx.op.refinoCaras)
            for (const p of c.pilares) {
              let v = refino.get(p.id);
              if (!v) refino.set(p.id, (v = []));
              v.push({ d: ejes[c.direccion].d, lado: c.lado });
            }
        }
      }
    // Y, en un reticular, las cuatro caras de los pilares que caen en un ábaco (SP-2): sin caras de
    // franja (los de borde y de esquina, y los que atraviesa una viga), su plantilla dejaba el ábaco
    // medianero en 8 láminas, algunas en cuña, sin nudos interiores para el SPR, y las franjas en las
    // caras, bajas (un 26 % en el muestrario; un 12,7 % de media en el edificio reticular)
    if (ctx.op.franjas && ctx.op.refinoCaras)
      for (const { l } of losasK) {
        if (!l.reticular?.abacos.length) continue;
        const ejes = ejesArmado(l.losa);
        for (const n of huellasK.keys()) {
          const nudo = topo.nudos[n]!;
          if (!l.reticular.abacos.some((ab) => puntoEnPoligono([nudo.x, nudo.y], ab))) continue;
          const id = nudo.pilar!.pilares[0]!;
          let v = refino.get(id);
          if (!v) refino.set(id, (v = []));
          for (const k of [1, 2] as const) for (const lado of [-1, 1] as const) v.push({ d: ejes[k].d, lado });
        }
      }
    for (const b of ctx.bandas) {
      if (b.planta !== idPlanta) continue;
      a.trazo(b.id, "banda", -1, rectanguloBanda(b.desde, b.hasta, b.ancho), true);
      // Las caras de sus apoyos, a lo ancho (C5.2): sus cortes por fuerzas nodales son exactos. Son
      // trazos exactos (C5-g): ni se doblan hacia la esquina de un pilar cercano ni la mueven. Con las
      // franjas, sus caras son las de las franjas (las mismas caras comunes de C5-g, de lado a lado):
      // sembrar también las de las bandas, con sus extremos en los bordes de las bandas, rompía la
      // rejilla y la malla dejaba de no depender de una traslación
      if (!ctx.op.franjas) for (const e of estacionesBanda(b, epsGeom)) if (e.tipo === "cara") a.trazo(b.id, "banda", -1, ladoEstacion(b, e.s), false, true);
    }
    for (const { id, seg } of caras) a.trazo(id, "cara", -1, seg, false, true);
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
    // Fase LV: un punto dentro del ancho de una viga (no en su borde) va a la viga
    const anchosPunto = (Q: Vec2) => anchos.flatMap((x, j) => (puntoEnPoligono(Q, x.a.poligono) && distanciaABorde(Q, x.a.poligono) > epsGeom ? [j] : []));
    const puntoAncho = new Map<string, number>();
    for (const c of cargas) {
      if (c.tipo !== "puntual" || c.planta !== idPlanta || topo.localizar(k, [c.x, c.y]) || enPano(k, [c.x, c.y]) || alDiafragma(ctx, k, c)) continue;
      const en = anchos.length ? anchosPunto([c.x, c.y]) : [];
      if (en.length) {
        puntoAncho.set(c.id, anchoMasCercano([c.x, c.y], en, anchos.map((x) => x.a)));
        continue;
      }
      puntoDe.set(c.id, { i: a.punto([c.x, c.y], c.id, "punto", "su punto"), Q: [c.x, c.y] });
    }
    // Y un apoyo, al eje de la viga (en la malla de la planta)
    const apoyoAncho = new Map<string, number>();
    for (const ap of ctx.apoyos) {
      if (ap.planta !== idPlanta || topo.apoyoEn.has(ap.id)) continue;
      const en = anchos.length ? anchosPunto([ap.x, ap.y]) : [];
      if (en.length) {
        apoyoAncho.set(ap.id, anchoMasCercano([ap.x, ap.y], en, anchos.map((y) => y.a)));
        continue;
      }
      puntoDe.set(ap.id, { i: a.punto([ap.x, ap.y], ap.id, "punto", "su punto"), Q: [ap.x, ap.y] });
    }
    if (diag.hayErrores) return null;
    if (!a.resolver()) {
      diag.error("malla/arreglo", `No se ha podido ordenar la geometría de la planta ${idPlanta} para mallarla: hay rasgos más pequeños que ${cm(epsSnap)} que se cruzan entre sí.`, [idPlanta, ...losasK.map(({ l }) => l.losa.id)]);
      return null;
    }
    return { k, a, muros, idPlanta, nudosK, tramosK, huellasK, mallar, losaDeMallar, trazoCarga, trazoApoyo, puntoDe, trazoAbaco, refino: { caras: refino, separacion: 2 * epsSnap, esquinas: ctx.op.unionLosaViga === "cara" && ctx.op.refinoEsquinas, huellas: [...huellasK.values()], idsHuellas: [...huellasK.keys()].map((n) => topo.nudos[n]!.pilar!.pilares[0]!) }, anchos, puntoAncho, apoyoAncho };
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

  /** Fase LV: el nudo de pilar del tramo en cuya zona rígida (C1-a) cae σ, si lo hay. */
  const pilarEnZona = (tv: TramoViga, sg: number) => {
    const f = ctx.op.factorZonaRigida;
    return tv.cadena.find((c) => {
      const pp = topo.nudos[c.nudo]!.pilar;
      const cu = pp ? cuerdaEnTramo(tv, pp) : null;
      return cu !== null && sg >= c.sigma - f * Math.max(0, c.sigma - cu[0]) - epsGeom && sg <= c.sigma + f * Math.max(0, cu[1] - c.sigma) + epsGeom;
    });
  };
  /**
   * Fase LV: el nudo del eje del tramo en σ: el de su cadena a ≤ ε_snap (con la holgura de
   * `unirCaras`) o uno nuevo, que parte la viga.
   */
  const nudoEnEje = (tv: TramoViga, k: number, sg: number): number => {
    const juntas = epsSnap + 10 * epsGeom;
    let n = -1;
    let dm = Infinity;
    for (const c of tv.cadena) {
      const d = Math.abs(c.sigma - sg);
      if (d <= juntas && d < dm) [n, dm] = [c.nudo, d];
    }
    if (n >= 0) return n;
    const { A, u } = tv.t;
    topo.nudos.push({ k, x: A[0] + sg * u[0], y: A[1] + sg * u[1], fisicos: new Set(), pilar: null });
    n = topo.nudos.length - 1;
    tv.partes.push(n);
    ordenarCadena(ctx, topo.nudos, tv, diag);
    let s = topo.vigasEn.get(n);
    if (!s) topo.vigasEn.set(n, (s = new Set()));
    s.add(tv.viga.id);
    return n;
  };

  /**
   * Fase LV (§1.3 de `union-losa-viga.md`): las piezas de la malla en el ancho de las vigas, y la
   * unión de la losa a sus caras. Cada nudo de una lámina sobre un lado del trazo de un ancho va al
   * eje del ancho más cercano, en su proyección, aunque toque la huella de un pilar (salvo que esté
   * dentro de ella): como en CYPECAD, la losa que llega a la cara de una viga va a la viga, y sólo la
   * que llega a la cara del pilar, al pilar. Si la proyección cae en la zona rígida de la viga en un
   * pilar del tramo (C1-a), con la huella del pilar; si no, a un nudo del eje (uno de la cadena a
   * ≤ ε_snap, o uno nuevo en la media de las proyecciones a ≤ ε_snap entre sí, que parte la viga).
   * Devuelve los enlaces con maestro en el eje y los nudos de los ejes que entran en el diafragma.
   */
  const unirCaras = (e: PlantaL, m: Extract<ResultadoMalla, { ok: true }>, nudoT: readonly number[], esclavoDe: Map<number, string>, huellasPlanta: HuellaL[], nudosMuros: ReadonlySet<number>): { enlaces: Losas["enlacesVigas"]; ejes: number[] } => {
    const { a, k } = e;
    // Ni los nudos de los muros (la losa se une a ellos por su eje, C3) ni los de los ejes de las vigas
    const enEje = new Set(e.anchos.flatMap(({ a: x }) => x.tramo.cadena.map((c) => c.nudo)));
    for (const pa of m.piezasAncho) {
      const li = e.losaDeMallar[pa.losa]!;
      const abacos = r.abacosUnidos.get(li);
      r.piezasAncho.push({ ancho: e.anchos[pa.ancho]!.g, losa: li, v: pa.v, c: pa.c, area: pa.area, abaco: abacos?.some((ab) => puntoEnPoligono(pa.c, ab)) ?? false });
    }
    // Nudos de las láminas sobre los lados de los trazos de los anchos, con sus anchos
    const local = new Map(e.anchos.map((x, j) => [x.t, j] as const));
    const cand = new Map<number, number[]>();
    m.lados.forEach((l, i) => {
      const ns = m.nudosLado[i]!;
      if (!ns.length) return;
      const js = l.trazos.flatMap((t) => {
        const j = local.get(a.trazos[t]!);
        return j === undefined ? [] : [j];
      });
      if (!js.length) return;
      for (const nm of ns) {
        const n = nudoT[nm]!;
        if (topo.nudos[n]!.pilar || nudosMuros.has(n) || enEje.has(n)) continue;
        // De una huella, sólo si no está dentro de ella (en su borde o a ≤ ε_snap)
        if (esclavoDe.has(n)) {
          const h = huellasPlanta.find((x) => x.esclavos.includes(n));
          const poli = h ? e.huellasK.get(h.maestro) : undefined;
          const q: Vec2 = [topo.nudos[n]!.x, topo.nudos[n]!.y];
          if (!poli || (puntoEnPoligono(q, poli) && distanciaABorde(q, poli) > epsGeom)) continue;
        }
        let v = cand.get(n);
        if (!v) cand.set(n, (v = []));
        for (const j of js) if (!v.includes(j)) v.push(j);
      }
    });
    const anchosA = e.anchos.map((x) => x.a);
    const porTramo = new Map<TramoViga, { sigma: number; n: number }[]>();
    const aPilar = new Map<number, number[]>();
    for (const n of [...cand.keys()].sort((x, y) => x - y)) {
      const q: Vec2 = [topo.nudos[n]!.x, topo.nudos[n]!.y];
      const x = anchosA[anchoMasCercano(q, cand.get(n)!, anchosA)]!;
      const tv = x.tramo;
      const sg = sigmaEnAncho(q, x);
      // En la zona rígida de la viga en un pilar del tramo (C1-a): con la huella del pilar
      const pilar = pilarEnZona(tv, sg);
      if (pilar) {
        let v = aPilar.get(pilar.nudo);
        if (!v) aPilar.set(pilar.nudo, (v = []));
        v.push(n);
        continue;
      }
      let v = porTramo.get(tv);
      if (!v) porTramo.set(tv, (v = []));
      v.push({ sigma: sg, n });
    }
    // Al eje: las proyecciones a ≤ ε_snap de la siguiente, a un solo nudo (con la holgura del arreglo:
    // a justo ε_snap, siempre, sin que lo decida un redondeo). Los grupos se cortan donde el hueco
    // entre dos seguidas pasa de ε_snap, así que no dependen del sentido de la viga (agrupando desde
    // la primera, sí)
    const juntas = epsSnap + 10 * epsGeom;
    const porMaestro = new Map<number, { viga: string; esclavos: number[] }>();
    const ejes = new Set<number>();
    for (const tv of [...porTramo.keys()].sort((x, y) => x.id - y.id)) {
      const lista = porTramo.get(tv)!.sort((x, y) => x.sigma - y.sigma || x.n - y.n);
      const nuevos: number[] = [];
      for (let i = 0; i < lista.length; ) {
        let j = i + 1;
        while (j < lista.length && lista[j]!.sigma - lista[j - 1]!.sigma <= juntas) j++;
        const sg = (lista[i]!.sigma + lista[j - 1]!.sigma) / 2;
        const ns = lista.slice(i, j).map((x) => x.n);
        i = j;
        let maestro = -1;
        let dm = Infinity;
        for (const c of tv.cadena) {
          const d = Math.abs(c.sigma - sg);
          if (d <= juntas && d < dm) [maestro, dm] = [c.nudo, d];
        }
        if (maestro < 0) {
          const { A, u } = tv.t;
          topo.nudos.push({ k, x: A[0] + sg * u[0], y: A[1] + sg * u[1], fisicos: new Set(), pilar: null });
          maestro = topo.nudos.length - 1;
          nuevos.push(maestro);
        }
        ejes.add(maestro);
        const pm = porMaestro.get(maestro);
        if (pm) pm.esclavos.push(...ns);
        else porMaestro.set(maestro, { viga: tv.viga.id, esclavos: [...ns] });
      }
      if (nuevos.length) {
        tv.partes.push(...nuevos);
        ordenarCadena(ctx, topo.nudos, tv, diag);
        for (const n of nuevos) {
          let v = topo.vigasEn.get(n);
          if (!v) topo.vigasEn.set(n, (v = new Set()));
          v.add(tv.viga.id);
        }
      }
    }
    // Los que eran de una huella y van a la viga, fuera de ella; una huella sin nudos, fuera
    const aViga = new Set([...porMaestro.values()].flatMap((x) => x.esclavos));
    for (const h of huellasPlanta) if (h.esclavos.some((n) => aViga.has(n))) h.esclavos = h.esclavos.filter((n) => !aViga.has(n));
    for (let i = huellasPlanta.length - 1; i >= 0; i--) if (!huellasPlanta[i]!.esclavos.length && !aPilar.has(huellasPlanta[i]!.maestro)) huellasPlanta.splice(i, 1);
    // Los que van con la huella de un pilar
    const espesorNudo = new Map<number, number>();
    if (aPilar.size)
      for (const q of m.quads) {
        const t = ctx.losas[e.losaDeMallar[q.losa]!]!.material.t;
        for (const nn of q.nudos) espesorNudo.set(nudoT[nn]!, Math.max(espesorNudo.get(nudoT[nn]!) ?? 0, t));
      }
    for (const [pn, ns] of [...aPilar].sort((x, y) => x[0] - y[0])) {
      const pilar = topo.nudos[pn]!.pilar!.pilares[0]!;
      let h = huellasPlanta.find((x) => x.maestro === pn);
      if (!h) huellasPlanta.push((h = { pilar, k, maestro: pn, esclavos: [], espesor: 0 }));
      for (const n of ns) {
        if (!h.esclavos.includes(n)) h.esclavos.push(n);
        esclavoDe.set(n, pilar);
        h.espesor = Math.max(h.espesor, espesorNudo.get(n) ?? 0);
      }
      h.esclavos.sort((x, y) => x - y);
    }
    const enlaces: Losas["enlacesVigas"] = [];
    for (const [maestro, { viga, esclavos }] of [...porMaestro].sort((x, y) => x[0] - y[0])) {
      for (const n of esclavos) esclavoDe.set(n, viga);
      enlaces.push({ viga, k, maestro, esclavos: esclavos.sort((x, y) => x - y) });
    }
    // Al diafragma (C2-f): los nudos de los ejes de los anchos que caen en una losa
    const regionesK = e.losaDeMallar.map((li) => r.regiones[li]!);
    for (const { a: x } of e.anchos)
      for (const c of x.tramo.cadena) {
        if (c.sigma < x.desde - epsGeom || c.sigma > x.hasta + epsGeom || esclavoDe.has(c.nudo)) continue;
        const q: Vec2 = [topo.nudos[c.nudo]!.x, topo.nudos[c.nudo]!.y];
        if (regionesK.some((rg) => distanciaARegion(q, rg) <= epsSnap)) ejes.add(c.nudo);
      }
    return { enlaces, ejes: [...ejes].filter((n) => !esclavoDe.has(n)).sort((x, y) => x - y) };
  };

  // 3. Malla y uniones de cada planta
  const nudosCadena = new Map<string, number[]>();
  const esclavosTodos = new Set<number>();
  for (const k of plantas) {
    const e = estado.get(k)!;
    const { a, idPlanta, mallar, losaDeMallar, huellasK, nudosK, refino } = e;
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
      if (mv.tipo === "huella" || mv.tipo === "ancho") continue;
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
      const anchosM: AnchoMallar[] = e.anchos.map(({ a: x, t }) => {
        const { A, u } = x.tramo.t;
        return { trazo: t, A: [A[0] + x.desde * u[0], A[1] + x.desde * u[1]], B: [A[0] + x.hasta * u[0], A[1] + x.hasta * u[1]], b: x.b };
      });
      const res = mallarPlanta(a, mallar, h, epsGeom, est?.presembrados.get(k), rejilla, refino, anchosM);
      if (!res.ok) {
        diag.error("malla/triangulacion", `La triangulación de la planta ${idPlanta} ha fallado (${res.mensaje}). Es un fallo del compilador.`, [idPlanta, ...mallar.map((x) => x.id)]);
        continue;
      }
      for (const p of res.problemas) {
        const ids = [...(p.losa >= 0 ? [mallar[p.losa]!.id] : mallar.map((x) => x.id)), ...(p.objetos ?? [])];
        if (p.severidad === "error") diag.error(p.codigo, p.mensaje, ids);
        else diag.aviso(p.codigo, p.mensaje, ids);
      }
      r.malla.jacobianoMin = Math.min(r.malla.jacobianoMin, res.calidad.jacobianoMin);
      r.malla.bajos += res.calidad.bajos;
      r.malla.laminasRejilla += res.rejilla.quads;
      r.malla.plantillas += res.rejilla.plantillas;
      r.malla.plantillasRefinadas += res.rejilla.refinadas;
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
      const cn: Vec2 = [topo.nudos[n]!.x, topo.nudos[n]!.y];
      // LV2-f: en un pilar con el ancho de una viga sobre su centro (también en su borde: el extremo
      // de la viga, o la losa que acaba en su eje), sólo los de la huella o su borde
      const soloHuella =
        ctx.op.unionLosaViga === "cara" && ctx.op.refinoEsquinas && e.anchos.some(({ a: x }) => puntoEnPoligono(cn, x.poligono) || distanciaABorde(cn, x.poligono) <= 10 * epsGeom);
      const tol = soloHuella ? 10 * epsGeom : epsSnap;
      const esclavos = candidatos.filter((x) => {
        if (x === n) return false;
        const q: Vec2 = [topo.nudos[x]!.x, topo.nudos[x]!.y];
        return puntoEnPoligono(q, poli) || distanciaABorde(q, poli) <= tol;
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
    // Fase LV: las piezas en el ancho de las vigas y la unión de la losa a sus caras
    const caras = e.anchos.length && m ? unirCaras(e, m, nudoT, esclavoDe, huellasPlanta, nudosMuros) : { enlaces: [], ejes: [] };
    for (const h of huellasPlanta) for (const n of h.esclavos) esclavosTodos.add(n);
    for (const x of caras.enlaces) for (const n of x.esclavos) esclavosTodos.add(n);
    r.enlacesVigas.push(...caras.enlaces);

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

    // Apoyos lineales y cargas lineales: nudos y aristas a lo largo de sus lados. Fase LV: un lado
    // dentro del ancho de una viga (su punto medio dentro de su polígono en el arreglo) va a la viga
    const polisAncho = e.anchos.map((x) => x.t.puntos.map((p) => [a.puntos[p]!.x, a.puntos[p]!.y] as Vec2));
    const anchoLado = (A: Vec2, B: Vec2): number => {
      const M: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const en = polisAncho.flatMap((pl, j) => (puntoEnPoligono(M, pl) && distanciaABorde(M, pl) > epsGeom ? [j] : []));
      return en.length ? anchoMasCercano(M, en, e.anchos.map((x) => x.a)) : -1;
    };
    const recorrer = (t: Trazo): { aristas: [number, number][]; fuera: boolean; lados: [Vec2, Vec2][]; enAncho: { ancho: number; A: Vec2; B: Vec2 }[] } => {
      const aristas: [number, number][] = [];
      const lados: [Vec2, Vec2][] = [];
      const enAncho: { ancho: number; A: Vec2; B: Vec2 }[] = [];
      let fuera = false;
      const n = t.puntos.length;
      for (let i = 0; i < (t.cerrado ? n : n - 1); i++) {
        const [pa, pb] = [t.puntos[i]!, t.puntos[(i + 1) % n]!];
        const c = ladoNodos.get(pa < pb ? `${pa},${pb}` : `${pb},${pa}`) ?? [];
        if (!c.length) {
          const [A, B]: [Vec2, Vec2] = [
            [a.puntos[pa]!.x, a.puntos[pa]!.y],
            [a.puntos[pb]!.x, a.puntos[pb]!.y],
          ];
          const j = polisAncho.length ? anchoLado(A, B) : -1;
          if (j >= 0) {
            enAncho.push({ ancho: e.anchos[j]!.g, A, B });
            continue;
          }
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
      return { aristas, fuera, lados, enAncho };
    };
    const conPanos = ctx.panos.some((p) => p.k === k);
    // Fase LV: lo que un apoyo coacciona dentro de una viga (sus lados en el ancho, y los nudos de las
    // caras, que se mueven con ella) va al eje de la viga, con las mismas coacciones: un murete que
    // llega a la viga la apoya en el cruce. Lo que cae en la zona rígida de un pilar del tramo, o en la
    // huella de un pilar, es del pilar: ahí el apoyo acaba (un murete que llega al pilar sostiene la
    // losa, no el pilar)
    const maestroCara = new Map<number, { maestro: number; viga: string }>();
    for (const x of caras.enlaces) for (const n of x.esclavos) maestroCara.set(n, { maestro: x.maestro, viga: x.viga });
    const deHuella = new Map<number, string>();
    for (const hh of huellasPlanta) for (const n of [hh.maestro, ...hh.esclavos]) deHuella.set(n, hh.pilar);
    const regionesK = losaDeMallar.map((li) => r.regiones[li]!);
    const ejesApoyo: number[] = [];
    // El pilar en cuya huella (o en su borde) cae un punto
    const huellaEn = (q: Vec2): number | undefined => {
      for (const [pn, poli] of huellasK) if (puntoEnPoligono(q, poli) || distanciaABorde(q, poli) <= epsGeom) return pn;
      return undefined;
    };
    const dePilar = (pn: number) => ({ nudo: pn, pilar: topo.nudos[pn]!.pilar!.pilares[0]! });
    const alEje = (g: number, sg: number): { nudo: number; viga: string } | { nudo: number; pilar: string } => {
      const x = r.anchos[g]!;
      const p = pilarEnZona(x.tramo, sg);
      if (p) return dePilar(p.nudo);
      const { A, u } = x.tramo.t;
      const ph = huellaEn([A[0] + sg * u[0], A[1] + sg * u[1]]);
      if (ph !== undefined) return dePilar(ph);
      const n = nudoEnEje(x.tramo, k, sg);
      // Al diafragma, como los demás nudos de los ejes de los anchos (`unirCaras`)
      if (!esclavoDe.has(n) && regionesK.some((rg) => distanciaARegion([topo.nudos[n]!.x, topo.nudos[n]!.y], rg) <= epsSnap)) ejesApoyo.push(n);
      return { nudo: n, viga: x.viga };
    };
    const anotar = (id: string, que: "vigas" | "pilares", quien: string, nudo?: number) => {
      let v = r.apoyosAViga.get(id);
      if (!v) r.apoyosAViga.set(id, (v = { vigas: [], pilares: [], nudos: [] }));
      if (!v[que].includes(quien)) v[que].push(quien);
      if (nudo !== undefined && !v.nudos.includes(nudo)) v.nudos.push(nudo);
    };
    for (const [id, t] of e.trazoApoyo) {
      const { aristas, fuera, enAncho } = recorrer(t);
      if (fuera) diag.error("apoyo/fuera-de-losa", `El apoyo lineal ${id} no va entero sobre las losas o los ejes de los muros de la planta ${idPlanta}.`, [id]);
      const nudos = new Set<number>();
      for (const n of new Set(aristas.flat())) {
        const c = maestroCara.get(n);
        const ph = c ? huellaEn([topo.nudos[c.maestro]!.x, topo.nudos[c.maestro]!.y]) : undefined;
        const pilar = deHuella.get(n) ?? (ph !== undefined ? dePilar(ph).pilar : undefined);
        if (pilar !== undefined) anotar(id, "pilares", pilar);
        else if (c) {
          nudos.add(c.maestro);
          anotar(id, "vigas", c.viga, c.maestro);
        } else nudos.add(n);
      }
      // Los lados en el ancho, a los nudos del eje en su proyección: un punto si lo cruzan, y los del
      // trozo que recorren si van a lo largo
      for (const { ancho: g, A, B } of enAncho) {
        const x = r.anchos[g]!;
        const [s0, s1] = [sigmaEnAncho(A, x), sigmaEnAncho(B, x)].sort((p, q) => p - q) as [number, number];
        const puntos = s1 - s0 <= epsSnap ? [(s0 + s1) / 2] : [s0, s1];
        for (const sg of puntos) {
          const d = alEje(g, sg);
          if ("pilar" in d) anotar(id, "pilares", d.pilar);
          else {
            nudos.add(d.nudo);
            anotar(id, "vigas", d.viga, d.nudo);
          }
        }
        if (puntos.length === 2)
          for (const c of [...x.tramo.cadena]) {
            if (c.sigma <= s0 || c.sigma >= s1 || nudos.has(c.nudo)) continue;
            const d = alEje(g, c.sigma);
            if ("pilar" in d) anotar(id, "pilares", d.pilar);
            else {
              nudos.add(d.nudo);
              anotar(id, "vigas", d.viga, d.nudo);
            }
          }
      }
      if (!nudos.size && !fuera) diag.error("apoyo/sin-destino", `El apoyo lineal ${id} no apoya ningún nudo: va entero dentro de la huella de ${r.apoyosAViga.get(id)?.pilares.join(", ") ?? "un pilar"}, que es del pilar.`, [id]);
      r.apoyosLineales.set(id, [...nudos]);
    }
    for (const [id, t] of e.trazoCarga) {
      const xy = (p: number): Vec2 => [a.puntos[p]!.x, a.puntos[p]!.y];
      if (t.tipo === "linea") {
        const { aristas, fuera, lados, enAncho } = recorrer(t);
        if (enAncho.length) r.lineasAncho.set(id, enAncho);
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
        // Fase LV: las piezas del ancho de las vigas en la zona (y en su losa)
        if (m.piezasAncho.length) {
          const baseA = r.piezasAncho.length - m.piezasAncho.length;
          const en = m.piezasAncho.flatMap((pa, j) => ((li === undefined || losaDeMallar[pa.losa] === li) && (!zona || puntoEnPoligono(pa.c, zona)) ? [baseA + j] : []));
          if (en.length) r.superficiesAncho.set(c.id, en);
        }
      }
    }
    // Fase LV: las puntuales en el ancho de una viga
    for (const [id, j] of e.puntoAncho) r.puntosAncho.set(id, e.anchos[j]!.g);
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
        // En la cara de una viga (fase LV): a su eje
        const c = maestroCara.get(n);
        if (c) anotar(id, "vigas", c.viga);
        r.apoyosPuntuales.set(id, c?.maestro ?? n);
        topo.nudos[c?.maestro ?? n]!.fisicos.add(id);
      } else r.puntos.set(id, n);
    }
    // Fase LV: los apoyos puntuales en el ancho de una viga, a su eje (o al pilar, en su zona rígida)
    for (const [id, j] of e.apoyoAncho) {
      const ap = ctx.apoyos.find((x) => x.id === id)!;
      const g = e.anchos[j]!.g;
      const d = alEje(g, sigmaEnAncho([ap.x, ap.y], r.anchos[g]!));
      anotar(id, "pilar" in d ? "pilares" : "vigas", "pilar" in d ? d.pilar : d.viga);
      r.apoyosPuntuales.set(id, d.nudo);
      topo.nudos[d.nudo]!.fisicos.add(id);
    }
    for (const [id, { vigas, pilares }] of r.apoyosAViga) {
      const lineal = e.trazoApoyo.has(id);
      if (!lineal && !e.apoyoAncho.has(id) && !e.puntoDe.has(id)) continue;
      const que = lineal ? "El apoyo lineal" : "El apoyo";
      if (vigas.length)
        diag.info(
          "apoyo/a-viga",
          `${que} ${id} llega a ${vigas.length > 1 ? "las vigas" : "la viga"} ${vigas.join(", ")} por su ${lineal ? "ancho o su cara" : e.apoyoAncho.has(id) ? "ancho" : "cara"}, donde la losa se mueve con la viga (fase LV): ahí apoya el eje de la viga, con sus mismas coacciones. Con sólo uz, la viga gira libre sobre su eje en el apoyo.`,
          [id, ...vigas],
        );
      if (pilares.length)
        diag.info(
          "apoyo/en-pilar",
          lineal
            ? `El apoyo lineal ${id} entra en la huella de ${pilares.length > 1 ? "los pilares" : "el pilar"} ${pilares.join(", ")} (o en la zona rígida de una viga en ${pilares.length > 1 ? "ellos" : "él"}): ahí todo se mueve con el pilar, así que el apoyo acaba en su cara (sostiene la losa, no el pilar).`
            : `El apoyo ${id} cae en el ancho de una viga junto al pilar ${pilares.join(", ")}, en su zona rígida: apoya el pilar.`,
          [id, ...pilares],
        );
    }

    // Diafragma (C2-f): con losas, los nudos de la malla que no son esclavos de una huella y los
    // maestros; sin ellas, todos los de la cota de la planta salvo los esclavos (C1-e)
    const maestros = huellasPlanta.map((x) => x.maestro);
    const enDiafragma = m ? nudosMalla : topo.nudos.flatMap((nd, n) => (nd.k === k && nd.z === undefined ? [n] : []));
    r.diafragma.set(k, [...new Set([...enDiafragma.filter((n) => !esclavoDe.has(n)), ...maestros, ...caras.ejes, ...ejesApoyo])].sort((x, y) => x - y));
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
