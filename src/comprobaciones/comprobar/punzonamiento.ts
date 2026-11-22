/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): comprobar el punzonamiento de una losa junto a un
 * pilar, con el armado de la losa y, si la lleva, su armadura de punzonamiento.
 *
 * El juez es el módulo de punzonamiento de Concreta (`calcPunching`, copiado sin tocar en
 * `../concreta/`): CE Anejo 19 §6.4, con el perímetro crítico a 2·d, vRd,c, vRd,max en la cara del
 * pilar y vRd,cs con cercos verticales (≤ 1,5·vRd,c). El módulo conoce tres posiciones (interior,
 * borde y esquina, con el pilar enrasado) y un β; lo que le falta va aquí:
 *
 *  - **La cara que tracciona.** Si la losa cuelga del pilar (Fz < 0 sobre el pilar), la superior
 *    (modo «pilar», con el tramo de debajo como área cargada); si el pilar carga sobre la losa (un
 *    pilar apeado, una losa de cimentación), la inferior (modo «carga puntual», con el tramo de
 *    encima). Cada combinación va a la suya, y cada cara con combinaciones se comprueba.
 *  - **La posición, de la geometría.** Una cara del área está libre si el borde del forjado queda a
 *    menos de c∥/2 + π·d de ella (c∥, la dimensión paralela al borde): entonces el perímetro que
 *    muere en el borde es más corto que el cerrado (CE A19 §6.4.2(4)). Ninguna libre, interior; una,
 *    borde; dos contiguas, esquina. Dos opuestas o tres y un pilar circular que no es interior no los
 *    conoce el módulo: pendiente. Con un borde que no es paralelo a la cara, la menor de sus
 *    distancias (el perímetro más corto).
 *  - **El pilar retranqueado** una distancia a del borde se le da como enrasado con el área cargada
 *    prolongada hasta el borde (c⊥ + a): es el perímetro de la figura A19.6.15 (y si la cara queda
 *    fuera de la losa, a < 0, sólo cuenta lo que hay dentro).
 *  - **Los huecos** a menos de 6·d del área quitan del perímetro lo que queda entre sus tangentes
 *    desde el centro del área (§6.4.2(3)); y lo que el perímetro tenga fuera del forjado (una esquina
 *    entrante del contorno, un borde oblicuo) tampoco cuenta, como si fuera un hueco; si es más de
 *    la mitad, pendiente. Como el módulo calcula su u1, la reducción entra por β (β·u1/u1,ef): vEd
 *    en u1 sale exacta, y en la cara del pilar (u0), del lado seguro.
 *  - **β, de la fórmula general** (§6.4.3) con los momentos que la losa pasa al pilar en cada
 *    combinación, respecto al centro del área: interior, 1 + k·e·u1/W1 en cada dirección (sumadas);
 *    circular, 1 + 0,6·π·e/(D + 4d); borde, u1/u1* + k·e∥·u1/W1; esquina, u1/u1*. La excentricidad
 *    perpendicular a un borde hacia fuera (no la cubre u1/u1*) se suma como en un pilar interior. Con
 *    el sismo del programa, cada componente con su peor signo (VS-o). Manda el mayor β·VEd.
 *  - **La armadura de flexión:** la de la cara que tracciona, en las dos direcciones (la base, o la
 *    parrilla de los ábacos de un reticular, más los refuerzos que cubren el centro del área), como
 *    una malla igual de cuantía √(ρx·ρy) con el mayor de sus diámetros; d, la media de los dos cantos
 *    útiles (la Y, por dentro de la X, CO3-e).
 *  - **En un reticular,** el perímetro crítico tiene que caber en el ábaco (fila propia, `abaco-u1`)
 *    y, si hace falta armadura de punzonamiento, también el perímetro uout a partir del que ya no
 *    hace falta (`abaco-uout`). Los nervios a la salida del ábaco los comprueba CO3.
 *  - **En una losa de cimentación** no se descuenta la reacción del terreno dentro del perímetro (del
 *    lado seguro).
 *
 * Lo que no se comprueba no sale nunca como «cumple»: va a `pendientes`.
 */
import { punchingDefaults, type PunchingInputs, type PunchingPosition } from "../concreta/data/defaults.ts";
import { getBarArea } from "../concreta/data/rebar.ts";
import { calcPunching, type PunchingResult } from "../concreta/lib/calculations/punching.ts";
import { distanciaDePerimetro, filasDeCercos, perimetroADistancia, type AreaCargada as AreaModulo } from "../concreta/lib/calculations/punchingGeometria.ts";
import type { CheckRow, CheckStatus } from "../concreta/lib/calculations/types.ts";
import type { Vec2 } from "../../compilador/fisico.ts";
import { puntoEnPoligono } from "../../compilador/poligonos.ts";
import { areaBarrasForjado, DATOS_ARMADO, type ArmadoForjado, type ArmaduraForjado, type ArmaduraPunzonamiento, type DatosArmado } from "../armado.ts";
import type { AreaCargada, DemandaPunzonamiento } from "../demandas/punzonamiento.ts";

/** Por debajo de esto (kN), el forjado no carga al pilar: no hay punzonamiento que comprobar. */
export const V_MINIMO = 1;
/** Un hueco a más de estos cantos útiles del área cargada no cuenta (CE A19 §6.4.2(3)). */
export const CANTOS_HUECO = 6;
/** Parte del perímetro crítico que puede quedar fuera del forjado (no cuenta) sin dejar la comprobación pendiente. */
export const FUERA_ADMISIBLE = 0.5;
/** Parte del perímetro que tiene que quedar tras quitar los huecos. */
const EFICAZ_MINIMO = 0.25;

export type CaraPunzonamiento = "superior" | "inferior";

/** Lo que hay que cambiar si una fila falla: la armadura de punzonamiento, la sección (canto, pilar, ábaco) o la armadura de flexión de la losa. */
export type GrupoPunzonamiento = "cercos" | "seccion" | "losa";

export interface FilaPunzonamiento {
  /** `<cara>/<fila del módulo>` o `<cara>/abaco-…`. */
  id: string;
  cara: CaraPunzonamiento;
  descripcion: string;
  articulo: string;
  /** El del módulo; infinito si falla sin cociente. */
  aprovechamiento: number;
  estado: CheckStatus;
  /** La combinación de la demanda (las reglas de armado no tienen). */
  comb?: string;
  grupo: GrupoPunzonamiento;
  /** vEd ≤ vRd,c con armadura de punzonamiento: no decide (mandan vRd,cs y vRd,max). */
  informativa?: true;
  /** La fila del módulo, entera (las propias no la llevan). */
  fila?: CheckRow;
}

/** La comprobación de una cara: la geometría que se le da al módulo, la demanda que manda y lo que sale. */
export interface CasoPunzonamiento {
  cara: CaraPunzonamiento;
  tramo: "inferior" | "superior";
  posicion: PunchingPosition;
  circular: boolean;
  /** El área cargada que se le da al módulo (prolongada hasta el borde, si está retranqueada), mm. */
  cx: number;
  cy: number;
  /** Canto útil, mm. */
  d: number;
  /** Perímetro crítico del módulo y el eficaz (sin lo que quitan los huecos), mm. */
  u1: number;
  u1Eficaz: number;
  /** El β de la fórmula general (sin la reducción de los huecos) y el que se le da al módulo. */
  beta: number;
  betaModulo: number;
  /** La demanda que manda (la de mayor β·VEd): VEd, kN; y, como información, lo que en esa combinación le pasan las vigas planas (no cuenta). */
  VEd: number;
  vigasPlanas: number;
  comb: string;
  /** Cuantía de la cara que tracciona en cada dirección de armado, mm²/m. */
  as: [number, number];
  /** Lo del módulo. */
  resultado: PunchingResult;
  /** Con armadura de punzonamiento: los perímetros de cercos que pide uout y hasta dónde llegan desde la cara, mm. */
  perimetros?: number;
  alcance?: number;
  entrada: PunchingInputs;
}

export interface ComprobacionPunzonamiento {
  pilar: string;
  planta: string;
  losa: string;
  filas: FilaPunzonamiento[];
  casos: CasoPunzonamiento[];
  /** El mayor de las filas de agotamiento (0 sin ninguna; infinito si alguna falla sin cociente). */
  aprovechamiento: number;
  /** vEd/vRd,c, el mayor de sus caras: por encima de 1 hace falta armadura de punzonamiento. */
  sinArmadura: number;
  pendientes: { motivo: string }[];
  /** Ninguna fila falla y nada queda pendiente. */
  cumple: boolean;
  /** Llamadas al módulo. */
  llamadas: number;
}

/** El armado de la losa con los datos de la obra: lo que se le da a la comprobación. */
export interface ArmadoPunzonamiento {
  /** El armado en barras de la losa. */
  losa: ArmadoForjado;
  /** La armadura de punzonamiento junto al pilar, si la lleva. */
  cercos?: ArmaduraPunzonamiento;
  recubrimiento: number;
  fyk: number;
}

export function armadoPunzonamiento(losa: ArmadoForjado, cercos: ArmaduraPunzonamiento | undefined, d?: DatosArmado): ArmadoPunzonamiento {
  return { losa, ...(cercos ? { cercos } : {}), recubrimiento: d?.recubrimiento ?? DATOS_ARMADO.recubrimiento, fyk: d?.fyk ?? DATOS_ARMADO.fyk };
}

const punto = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/** k de la tabla A19.6.1 (c1/c2: 0,5 → 0,45; 1 → 0,6; 2 → 0,7; 3 → 0,8), interpolada. */
export function kExcentricidad(r: number): number {
  const t: [number, number][] = [[0.5, 0.45], [1, 0.6], [2, 0.7], [3, 0.8]];
  if (!(r > t[0]![0])) return t[0]![1];
  for (let i = 1; i < t.length; i++) if (r <= t[i]![0]) return t[i - 1]![1] + ((t[i]![1] - t[i - 1]![1]) * (r - t[i - 1]![0])) / (t[i]![0] - t[i - 1]![0]);
  return t[t.length - 1]![1];
}

/** W1 del perímetro crítico de un pilar interior rectangular (6.41): c1, la dimensión paralela a la excentricidad. mm². */
export const w1Interior = (c1: number, c2: number, d: number): number => (c1 * c1) / 2 + c1 * c2 + 4 * c2 * d + 16 * d * d + 2 * Math.PI * d * c1;
/** W1 de un pilar de borde con la excentricidad paralela al borde (6.45): c1, la dimensión perpendicular al borde. mm². */
export const w1Borde = (c1: number, c2: number, d: number): number => (c2 * c2) / 4 + c1 * c2 + 4 * c1 * d + 8 * d * d + Math.PI * d * c2;

/** La geometría de una cara: lo que se le da al módulo y lo que hace falta para β. */
interface Geometria {
  posicion: PunchingPosition;
  circular: boolean;
  cx: number;
  cy: number;
  u1: number;
  u1Eficaz: number;
  /** Las normales hacia fuera de las caras libres, con su dimensión perpendicular (prolongada) y la paralela, mm. */
  libres: { n: Vec2; t: Vec2; c1: number; c2: number }[];
  /** Qué caras del área están libres, en su orden [+ez, −ez, +ey, −ey]. */
  libre: boolean[];
  /** Dimensiones del área según ez y ey, mm (interior). */
  h: number;
  b: number;
}

/** Los sectores (desde el centro del área) que tapan los huecos a menos de `alcance`: [desde, hasta] en radianes, hasta ≥ desde. */
function sectoresHuecos(a: AreaCargada, h: number, b: number, huecos: readonly (readonly Vec2[])[], alcance: number): [number, number][] | { motivo: string } {
  const local = (p: Vec2): Vec2 => [punto([p[0] - a.c[0], p[1] - a.c[1]], a.ez), punto([p[0] - a.c[0], p[1] - a.c[1]], a.ey)];
  const aRect = (p: Vec2) => Math.hypot(Math.max(0, Math.abs(p[0]) - h / 2), Math.max(0, Math.abs(p[1]) - b / 2));
  const aSegmento = (p: Vec2, s0: Vec2, s1: Vec2) => {
    const [ex, ey] = [s1[0] - s0[0], s1[1] - s0[1]];
    const L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - s0[0]) * ex + (p[1] - s0[1]) * ey) / L2)) : 0;
    return Math.hypot(p[0] - s0[0] - t * ex, p[1] - s0[1] - t * ey);
  };
  const esquinas: Vec2[] = [[h / 2, b / 2], [-h / 2, b / 2], [-h / 2, -b / 2], [h / 2, -b / 2]];
  const r: [number, number][] = [];
  for (const hueco of huecos) {
    if (puntoEnPoligono(a.c, hueco)) return { motivo: "el centro del pilar cae en un hueco de la losa" };
    const ps = hueco.map(local);
    let dist = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const [p0, p1] = [ps[i]!, ps[(i + 1) % ps.length]!];
      // (el tramo, por puntos cada pocos centímetros: basta para saber si está a menos de 6·d)
      const n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 0.05));
      for (let k = 0; k <= n; k++) dist = Math.min(dist, aRect([p0[0] + ((p1[0] - p0[0]) * k) / n, p0[1] + ((p1[1] - p0[1]) * k) / n]));
      for (const e of esquinas) dist = Math.min(dist, aSegmento(e, p0, p1));
    }
    if (dist > alcance) continue;
    // El ángulo que abarca visto desde el centro: se acumula a lo largo del contorno (no contiene al centro)
    let ang = Math.atan2(ps[0]![1], ps[0]![0]);
    let [mn, mx] = [ang, ang];
    for (let i = 1; i <= ps.length; i++) {
      const [p0, p1] = [ps[i - 1]!, ps[i % ps.length]!];
      ang += Math.atan2(p0[0] * p1[1] - p0[1] * p1[0], p0[0] * p1[0] + p0[1] * p1[1]);
      mn = Math.min(mn, ang);
      mx = Math.max(mx, ang);
    }
    r.push([mn, mx]);
  }
  return r;
}

/**
 * La posición y el perímetro de un área cargada con el canto útil d (m): lo que se le da al módulo, o
 * por qué no se puede.
 */
export function geometria(D: Pick<DemandaPunzonamiento, "contornos" | "huecos">, a: AreaCargada, d: number): Geometria | { motivo: string } {
  if (!a.forma) return { motivo: `la sección ${a.seccion} del pilar no es rectangular ni circular` };
  if (!a.dentro) return { motivo: "el centro del pilar cae fuera de la losa" };
  const circular = a.forma.tipo === "circulo";
  const [h, b] = a.forma.tipo === "circulo" ? [a.forma.D, a.forma.D] : [a.forma.h, a.forma.b];
  // Las caras libres: el perímetro que muere en el borde es más corto que el cerrado
  const paralela = [b, b, h, h];
  const libre = a.caras.map((c, i) => c.distancia < paralela[i]! / 2 + Math.PI * d);
  const n = libre.filter(Boolean).length;
  if (n > 0 && circular) return { motivo: "un pilar circular junto a un borde: el módulo sólo conoce el circular interior" };
  if (n > 2 || (libre[0] && libre[1]) || (libre[2] && libre[3])) return { motivo: "el pilar tiene borde libre en dos caras opuestas o en más de dos: una posición que el módulo no conoce" };
  // El área prolongada hasta los bordes, en los ejes del área (u según ez, v según ey), m
  const dist = a.caras.map((c, i) => (libre[i] ? c.distancia : 0));
  const [u0, u1, v0, v1] = [-h / 2 - dist[1]!, h / 2 + dist[0]!, -b / 2 - dist[3]!, b / 2 + dist[2]!];
  if (!(u1 - u0 > 1e-6 && v1 - v0 > 1e-6)) return { motivo: "el pilar queda fuera de la losa" };
  const menos = (v: Vec2): Vec2 => [-v[0], -v[1]];
  const normales: Vec2[] = [a.ez, menos(a.ez), a.ey, menos(a.ey)];
  const libres = normales.flatMap((nn, i) => (libre[i] ? [{ n: nn, t: i < 2 ? a.ey : a.ez, c1: 1000 * (i < 2 ? u1 - u0 : v1 - v0), c2: 1000 * (i < 2 ? v1 - v0 : u1 - u0) }] : []));
  const posicion: PunchingPosition = n === 0 ? "interior" : n === 1 ? "borde" : "esquina";
  // Lo del módulo: en borde, cx es la dimensión paralela al borde; en esquina, da igual
  const [cx, cy] = posicion === "borde" ? [libres[0]!.c2, libres[0]!.c1] : [1000 * (v1 - v0), 1000 * (u1 - u0)];
  const modulo: AreaModulo = { cx, cy: circular ? cx : cy, circular, position: posicion };
  const pu1 = perimetroADistancia(modulo, 2000 * d);
  // El perímetro, por puntos: lo que cae fuera del contorno y lo que tapan los huecos
  const sectores = sectoresHuecos(a, h, b, D.huecos, CANTOS_HUECO * d);
  if ("motivo" in sectores) return sectores;
  const r = 2 * d;
  const muestras: { u: number; v: number; ds: number }[] = [];
  const N = 48;
  if (circular) {
    const R = h / 2 + r;
    for (let i = 0; i < 4 * N; i++) {
      const th = ((i + 0.5) * 2 * Math.PI) / (4 * N);
      muestras.push({ u: R * Math.cos(th), v: R * Math.sin(th), ds: (R * 2 * Math.PI) / (4 * N) });
    }
  } else {
    const lado = (p: Vec2, q: Vec2) => {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let i = 0; i < N; i++) muestras.push({ u: p[0] + ((q[0] - p[0]) * (i + 0.5)) / N, v: p[1] + ((q[1] - p[1]) * (i + 0.5)) / N, ds: L / N });
    };
    const arco = (c: Vec2, desde: number) => {
      for (let i = 0; i < N; i++) {
        const th = desde + ((i + 0.5) * Math.PI) / (2 * N);
        muestras.push({ u: c[0] + r * Math.cos(th), v: c[1] + r * Math.sin(th), ds: (r * Math.PI) / (2 * N) });
      }
    };
    lado([u1 + r, v0], [u1 + r, v1]);
    arco([u1, v1], 0);
    lado([u1, v1 + r], [u0, v1 + r]);
    arco([u0, v1], Math.PI / 2);
    lado([u0 - r, v1], [u0 - r, v0]);
    arco([u0, v0], Math.PI);
    lado([u0, v0 - r], [u1, v0 - r]);
    arco([u1, v0], (3 * Math.PI) / 2);
  }
  // Lo que queda más allá de un borde libre no es perímetro
  const tol = 1e-9;
  const dentroBordes = (m: { u: number; v: number }) => !(libre[0] && m.u > u1 + tol) && !(libre[1] && m.u < u0 - tol) && !(libre[2] && m.v > v1 + tol) && !(libre[3] && m.v < v0 - tol);
  let [total, fuera, tapado] = [0, 0, 0];
  for (const m of muestras) {
    if (!dentroBordes(m)) continue;
    total += m.ds;
    const p: Vec2 = [a.c[0] + m.u * a.ez[0] + m.v * a.ey[0], a.c[1] + m.u * a.ez[1] + m.v * a.ey[1]];
    if (!D.contornos.some((c) => puntoEnPoligono(p, c))) {
      fuera += m.ds;
      continue;
    }
    const th = Math.atan2(m.v, m.u);
    if (sectores.some(([s0, s1]) => th - s0 - 2 * Math.PI * Math.floor((th - s0) / (2 * Math.PI)) <= s1 - s0)) tapado += m.ds;
  }
  if (fuera > FUERA_ADMISIBLE * total) return { motivo: `el ${Math.round((100 * fuera) / total)} % del perímetro crítico cae fuera del forjado (un borde que no es paralelo a las caras del pilar): una posición que el módulo no conoce` };
  const eficaz = 1 - (fuera + tapado) / total;
  if (eficaz < EFICAZ_MINIMO) return { motivo: "los huecos junto al pilar tapan casi todo el perímetro crítico" };
  return { posicion, circular, cx, cy: circular ? cx : cy, u1: pu1, u1Eficaz: pu1 * eficaz, libres, libre, h: 1000 * h, b: 1000 * b };
}

/** β·VEd (kN) de una combinación con una geometría: la fórmula general del CE A19 §6.4.3, con cada componente del sismo en su peor signo. */
export function cortanteEficaz(g: Geometria, d: number, V: number, E: Vec2, aE: Vec2, ez: Vec2, ey: Vec2): number {
  const comp = (u: Vec2) => ({ st: punto(E, u), amp: Math.abs(u[0]) * aE[0] + Math.abs(u[1]) * aE[1] });
  const abs = (u: Vec2) => {
    const c = comp(u);
    return Math.abs(c.st) + c.amp;
  };
  const fuera = (u: Vec2) => {
    const c = comp(u);
    return Math.max(0, c.st + c.amp);
  };
  // E en kN·m y las longitudes en mm: k·E·1000·u1/W1, kN
  const termino = (k: number, e: number, W1: number) => (k * e * 1000 * g.u1) / W1;
  if (g.posicion === "interior") {
    if (g.circular) return V + (0.6 * Math.PI * Math.hypot(abs([1, 0]), abs([0, 1])) * 1000) / (g.h + 4 * d);
    return V + termino(kExcentricidad(g.h / g.b), abs(ez), w1Interior(g.h, g.b, d)) + termino(kExcentricidad(g.b / g.h), abs(ey), w1Interior(g.b, g.h, d));
  }
  if (g.posicion === "borde") {
    const l = g.libres[0]!;
    const u1s = l.c2 + 2 * Math.min(1.5 * d, 0.5 * l.c1) + 2 * Math.PI * d;
    return (V * g.u1) / u1s + termino(kExcentricidad(l.c1 / (2 * l.c2)), abs(l.t), w1Borde(l.c1, l.c2, d)) + termino(kExcentricidad(l.c1 / l.c2), fuera(l.n), w1Interior(l.c1, l.c2, d));
  }
  const u1s = Math.min(1.5 * d, 0.5 * g.cx) + Math.min(1.5 * d, 0.5 * g.cy) + Math.PI * d;
  return (V * g.u1) / u1s + g.libres.reduce((s, l) => s + termino(kExcentricidad(l.c1 / l.c2), fuera(l.n), w1Interior(l.c1, l.c2, d)), 0);
}

const ARMADURAS: Record<CaraPunzonamiento, [ArmaduraForjado, ArmaduraForjado]> = { superior: ["x-sup", "y-sup"], inferior: ["x-inf", "y-inf"] };

/** La armadura de flexión de una cara en el centro de un área: mm²/m en cada dirección, sus diámetros de base y el canto útil medio (mm); o por qué no. */
export function flexion(D: Pick<DemandaPunzonamiento, "espesor" | "reticular" | "ejes">, a: ArmadoPunzonamiento, cara: CaraPunzonamiento, c: Vec2): { as: [number, number]; diametro: number; d: number } | { motivo: string } {
  const parrilla = D.reticular ? a.losa.abacos : a.losa.base;
  if (!parrilla) return { motivo: "el armado del reticular no tiene la parrilla de los ábacos" };
  const as: number[] = [];
  const diam: number[] = [];
  ARMADURAS[cara].forEach((k, i) => {
    const b = parrilla[k];
    const { d, n } = D.ejes[(i + 1) as 1 | 2];
    const [s, t] = [punto(c, d), punto(c, n)];
    let A = b ? areaBarrasForjado(b) : 0;
    for (const r of a.losa.refuerzos ?? []) {
      if (r.armadura !== k || (D.reticular ? r.en !== "abacos" : r.en !== undefined)) continue;
      if (s >= r.s[0] - 1e-6 && s <= r.s[1] + 1e-6 && t >= r.t[0] - 1e-6 && t <= r.t[1] + 1e-6) A += areaBarrasForjado(r.barras);
    }
    as.push(A);
    diam.push(b?.diametro ?? 0);
  });
  if (!(as[0]! > 0 && as[1]! > 0 && Number.isFinite(as[0]! + as[1]!))) return { motivo: `la losa no tiene armadura ${cara} en las dos direcciones junto al pilar` };
  // La Y va por dentro de la X (CO3-e): dx = h − r − Øx/2, dy = h − r − Øx − Øy/2
  const h = 1000 * D.espesor;
  const d = h - a.recubrimiento - diam[0]! - diam[1]! / 4 + diam[0]! / 4;
  return { as: [as[0]!, as[1]!], diametro: Math.max(diam[0]!, diam[1]!), d: d };
}

const FILAS_AGOTAMIENTO = new Set(["punz-ved-max", "punz-ved-vrdc", "punz-ved-vrdcs"]);
const GRUPOS: Record<string, GrupoPunzonamiento> = { "punz-rho-min": "losa", "punz-sr-max": "cercos", "punz-ved-max": "seccion", "punz-ved-vrdc": "cercos", "punz-ved-vrdcs": "cercos" };

/** Comprueba el punzonamiento de un pilar en una losa con un armado dado. */
export function comprobarPunzonamiento(D: DemandaPunzonamiento, a: ArmadoPunzonamiento): ComprobacionPunzonamiento {
  const filas: FilaPunzonamiento[] = [];
  const casos: CasoPunzonamiento[] = [];
  const pendientes: { motivo: string }[] = [];
  const pendiente = (motivo: string) => void (pendientes.some((p) => p.motivo === motivo) || pendientes.push({ motivo }));
  let llamadas = 0;
  const fin = (): ComprobacionPunzonamiento => {
    const agot = filas.filter((f) => FILAS_AGOTAMIENTO.has(f.id.split("/")[1]!) && !f.informativa);
    const aprovechamiento = agot.reduce((m, f) => Math.max(m, Number.isFinite(f.aprovechamiento) || f.estado === "fail" ? f.aprovechamiento : 0), 0);
    const sinArmadura = casos.reduce((m, c) => Math.max(m, c.resultado.vEd / c.resultado.vRdc), 0);
    return { pilar: D.pilar, planta: D.planta, losa: D.losa, filas, casos, aprovechamiento, sinArmadura, pendientes, cumple: !pendientes.length && !filas.some((f) => f.estado === "fail"), llamadas };
  };
  if (D.material.tipo !== "hormigon") {
    pendiente(`el material ${D.material.id} de la losa no es hormigón`);
    return fin();
  }
  for (const cara of ["superior", "inferior"] as const) {
    // Las combinaciones de esta cara: el forjado cuelga del pilar (superior) o el pilar carga sobre él (inferior)
    const signo = cara === "superior" ? -1 : 1;
    const suyas = D.combos.filter((c) => signo * c.Fz > 0);
    if (!suyas.some((c) => signo * c.Fz + c.aFz >= V_MINIMO)) continue;
    const area = cara === "superior" ? (D.areas.inferior ?? D.areas.superior) : (D.areas.superior ?? D.areas.inferior);
    if (!area) continue;
    const f = flexion(D, a, cara, area.c);
    if ("motivo" in f) {
      pendiente(f.motivo);
      continue;
    }
    if (!(f.d > 0)) {
      pendiente("el canto útil de la losa no es positivo con ese recubrimiento y esas barras");
      continue;
    }
    if (D.reticular && !area.abaco) {
      pendiente("el pilar no está en un ábaco del reticular");
      continue;
    }
    const g = geometria(D, area, f.d / 1000);
    if ("motivo" in g) {
      pendiente(g.motivo);
      continue;
    }
    // La combinación de mayor β·VEd; los momentos, respecto al centro del área
    const [dx, dy] = [D.punto[0] - area.c[0], D.punto[1] - area.c[1]];
    let mejor: { Vef: number; V: number; planas: number; comb: string } | null = null;
    for (const c of suyas) {
      const V = signo * c.Fz + c.aFz;
      if (!(V >= V_MINIMO)) continue;
      const [Mx, My] = [c.Mx + dy * c.Fz, c.My - dx * c.Fz];
      // E = V·e, con e = (−My/Fz, Mx/Fz)
      const E: Vec2 = [-My * signo, Mx * signo];
      const aE: Vec2 = [c.aMy + Math.abs(dx) * c.aFz, c.aMx + Math.abs(dy) * c.aFz];
      const Vef = cortanteEficaz(g, f.d, V, E, aE, area.ez, area.ey);
      if (!mejor || Vef > mejor.Vef) mejor = { Vef, V, planas: signo * c.FzVigasPlanas, comb: c.nombre };
    }
    if (!mejor) continue;
    const beta = mejor.Vef / mejor.V;
    const betaModulo = (beta * g.u1) / g.u1Eficaz;
    // La malla equivalente: cuantía √(ρx·ρy) con el mayor diámetro
    const asEq = Math.sqrt(f.as[0] * f.as[1]) / 1000;
    const sEq = getBarArea(f.diametro) / asEq;
    const otra = flexion(D, a, cara === "superior" ? "inferior" : "superior", area.c);
    const [dOtra, sOtra] = "motivo" in otra ? [f.diametro, sEq] : [otra.diametro, getBarArea(otra.diametro) / (Math.sqrt(otra.as[0] * otra.as[1]) / 1000)];
    const entrada: PunchingInputs = {
      ...punchingDefaults,
      mode: cara === "superior" ? "pilar" : "carga-puntual",
      cx: g.cx,
      cy: g.cy,
      isCircular: g.circular,
      d: f.d,
      h: 1000 * D.espesor,
      fck: D.material.fck,
      fyk: a.fyk,
      barDiamSup: cara === "superior" ? f.diametro : dOtra,
      sSup: cara === "superior" ? sEq : sOtra,
      barDiamInf: cara === "inferior" ? f.diametro : dOtra,
      sInf: cara === "inferior" ? sEq : sOtra,
      VEd: mejor.V,
      position: g.posicion,
      betaMode: "custom",
      betaManual: betaModulo,
      hasShearReinf: a.cercos !== undefined,
      ...(a.cercos ? { swDiam: a.cercos.diametro, swLegs: a.cercos.ramas, sr: a.cercos.separacion } : {}),
      fywk: a.fyk,
    };
    const r = calcPunching(entrada);
    llamadas++;
    if (r.error) {
      pendiente(`el módulo de punzonamiento rechaza la entrada: ${r.error}`);
      continue;
    }
    const caso: CasoPunzonamiento = { cara, tramo: area.tramo, posicion: g.posicion, circular: g.circular, cx: g.cx, cy: g.cy, d: f.d, u1: g.u1, u1Eficaz: g.u1Eficaz, beta, betaModulo, VEd: mejor.V, vigasPlanas: mejor.planas, comb: mejor.comb, as: f.as, resultado: r, entrada };
    for (const x of r.checks) {
      if (x.neutral || x.status === "neutral") continue;
      filas.push({ id: `${cara}/${x.id}`, cara, descripcion: x.description, articulo: x.article ?? "", aprovechamiento: Number.isFinite(x.utilization) ? x.utilization : Infinity, estado: x.status, ...(FILAS_AGOTAMIENTO.has(x.id) ? { comb: mejor.comb } : {}), grupo: GRUPOS[x.id] ?? "seccion", ...(x.id === "punz-ved-vrdc" && a.cercos ? { informativa: true as const } : {}), fila: x });
    }
    // Con armadura: los perímetros de cercos que pide uout
    const modulo: AreaModulo = { cx: g.cx, cy: g.cy, circular: g.circular, position: g.posicion };
    const aOut = distanciaDePerimetro(modulo, r.uout);
    if (a.cercos) {
      const fs = filasDeCercos(f.d, a.cercos.separacion, aOut);
      caso.perimetros = fs.length;
      caso.alcance = fs[fs.length - 1] ?? 0;
    }
    // En un reticular, el perímetro crítico (y uout, si hay o hace falta armadura) dentro del ábaco
    if (D.reticular && area.abaco) {
      const hasta = 1000 * Math.min(...area.abaco.filter((_, i) => !g.libre[i]));
      const propia = (id: string, descripcion: string, necesita: number, grupo: GrupoPunzonamiento) => {
        const u = necesita / hasta;
        filas.push({ id: `${cara}/${id}`, cara, descripcion: `${descripcion}: ${necesita.toFixed(0)} mm ≤ ${hasta.toFixed(0)} mm (de la cara del pilar al borde del ábaco)`, articulo: "CE Anejo 19 §6.4.2", aprovechamiento: hasta > 0 ? u : Infinity, estado: hasta > 0 && u <= 1 ? "ok" : "fail", grupo });
      };
      propia("abaco-u1", "El perímetro crítico (a 2·d) cabe en el ábaco", 2 * f.d, "seccion");
      if (a.cercos || r.vEd > r.vRdc) propia("abaco-uout", "El perímetro uout, a partir del que no hace falta armadura de punzonamiento, cabe en el ábaco", aOut, "seccion");
    }
    casos.push(caso);
  }
  return fin();
}
