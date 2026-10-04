/**
 * Utilidades de prueba del compilador: comparar un modelo compilado con uno hecho a mano y cargas
 * nodales equivalentes escritas de forma independiente. No es código del compilador.
 */
import { calcular } from "../motor/calcular.ts";
import type { CargaNodal, ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
import { casosValidos, errorPorGrupos } from "./comparar.ts";

const clave = (x: number, y: number, z: number) => `${Math.round(x * 1e7)},${Math.round(y * 1e7)},${Math.round(z * 1e7)}`;

export interface Comparacion {
  /** Peor error relativo por grupos (traslaciones/giros) de los nudos emparejados. */
  u: number;
  reacciones: number;
  /** Peor error relativo por grupos (fuerzas/momentos) de los esfuerzos de extremo de las barras. */
  barras: number;
  nudos: number;
  nBarras: number;
  /** Errores de cada caso, para los mensajes. */
  porCaso: string[];
}

/**
 * Calcula los dos modelos con el solver de perfil y compara caso a caso. Se emparejan los nudos
 * con barras por coordenadas (a 1e-7 m), y las barras por las coordenadas de sus nudos; los
 * maestros de diafragma no cuentan (pueden estar en otro sitio, o encima de un nudo). Los dos
 * modelos tienen que tener los mismos nudos con barras y las mismas barras.
 */
export function compararModelos(a: ModeloAnalitico, b: ModeloAnalitico): Comparacion {
  const ra = casosValidos(calcular(a, { solver: "perfil" }));
  const rb = casosValidos(calcular(b, { solver: "perfil" }));
  const conBarras = (m: ModeloAnalitico) => new Set((m.barras ?? []).flatMap((br) => [...br.nudos]));
  const idxB = new Map<string, number>();
  for (const i of conBarras(b)) idxB.set(clave(b.nudos[i]!.x, b.nudos[i]!.y, b.nudos[i]!.z), i);
  const pares: [number, number][] = [];
  for (const i of [...conBarras(a)].sort((x, y) => x - y)) {
    const n = a.nudos[i]!;
    const j = idxB.get(clave(n.x, n.y, n.z));
    if (j === undefined) throw new Error(`el nudo ${n.id} (${n.x}, ${n.y}, ${n.z}) no está en el modelo de referencia`);
    pares.push([i, j]);
  }
  if (pares.length !== idxB.size) throw new Error(`número de nudos con barras distinto: ${pares.length} frente a ${idxB.size}`);
  const barraB = new Map<string, number>();
  (b.barras ?? []).forEach((br, k) => {
    const [ni, nj] = br.nudos.map((n) => b.nudos[n]!);
    barraB.set(`${clave(ni!.x, ni!.y, ni!.z)}|${clave(nj!.x, nj!.y, nj!.z)}`, k);
  });
  const paresBarras: [number, number][] = (a.barras ?? []).map((br, k) => {
    const [ni, nj] = br.nudos.map((n) => a.nudos[n]!);
    const kb = barraB.get(`${clave(ni!.x, ni!.y, ni!.z)}|${clave(nj!.x, nj!.y, nj!.z)}`);
    if (kb === undefined) throw new Error(`la barra ${br.id} no está en el modelo de referencia`);
    return [k, kb];
  });
  if (paresBarras.length !== (b.barras ?? []).length) throw new Error(`número de barras distinto: ${paresBarras.length} frente a ${(b.barras ?? []).length}`);
  let u = 0;
  let reacciones = 0;
  let barras = 0;
  const reunir = (casos: ResultadoCaso[], c: number, campo: "u" | "reacciones", lado: 0 | 1) => {
    const out = new Float64Array(6 * pares.length);
    pares.forEach((p, k) => out.set(casos[c]![campo].subarray(6 * p[lado], 6 * p[lado] + 6), 6 * k));
    return out;
  };
  const reunirBarras = (casos: ResultadoCaso[], c: number, lado: 0 | 1) => {
    const out = new Float64Array(12 * paresBarras.length);
    paresBarras.forEach((p, k) => out.set(casos[c]!.esfuerzosBarras.subarray(12 * p[lado], 12 * p[lado] + 12), 12 * k));
    return out;
  };
  const peores: string[] = [];
  a.casos.forEach((caso, c) => {
    const cb = b.casos.findIndex((x) => x.id === caso.id);
    if (cb < 0) throw new Error(`el caso ${caso.id} no está en el modelo de referencia`);
    const eu = errorPorGrupos(reunir(ra, c, "u", 0), reunir(rb, cb, "u", 1));
    const er = errorPorGrupos(reunir(ra, c, "reacciones", 0), reunir(rb, cb, "reacciones", 1));
    const eb = errorPorGrupos(reunirBarras(ra, c, 0), reunirBarras(rb, cb, 1));
    peores.push(`${caso.id}: u ${eu.toExponential(1)}, reacciones ${er.toExponential(1)}, barras ${eb.toExponential(1)}`);
    u = Math.max(u, eu);
    reacciones = Math.max(reacciones, er);
    barras = Math.max(barras, eb);
  });
  return { u, reacciones, barras, nudos: pares.length, nBarras: paresBarras.length, porCaso: peores };
}

const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Carga nodal equivalente a una carga uniforme q (kN/m, global) entre P1 y P2, llevada al nudo X:
 * F = q·|P2 − P1| y M = (centro del tramo − X) × F.
 */
export function uniformeANudo(nudo: number, X: Vec3, P1: Vec3, P2: Vec3, q: Vec3): CargaNodal {
  const L = Math.sqrt((P2[0] - P1[0]) ** 2 + (P2[1] - P1[1]) ** 2 + (P2[2] - P1[2]) ** 2);
  const F: Vec3 = [q[0] * L, q[1] * L, q[2] * L];
  const r: Vec3 = [(P1[0] + P2[0]) / 2 - X[0], (P1[1] + P2[1]) / 2 - X[1], (P1[2] + P2[2]) / 2 - X[2]];
  return { nudo, f: [...F, ...cruz(r, F)] };
}

/** Fuerza F aplicada en Q, llevada al nudo X: M = (Q − X) × F (+ M propio). */
export function puntualANudo(nudo: number, X: Vec3, Q: Vec3, F: Vec3, M: Vec3 = [0, 0, 0]): CargaNodal {
  const m = cruz([Q[0] - X[0], Q[1] - X[1], Q[2] - X[2]], F);
  return { nudo, f: [...F, m[0] + M[0], m[1] + M[1], m[2] + M[2]] };
}
