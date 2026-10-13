/**
 * Tramos, picos y zonas de refuerzo de las franjas de armado (fase AB, `docs/fem3d/armado.md`
 * §2.2 y §2.6), de la demanda de Wood–Armer de una armadura (kN·m/m) que da `fem consultar franja`.
 *
 * - **Tramo:** lo que colorea una estación válida de una franja: de la mitad hasta la estación
 *   anterior a la mitad hasta la siguiente, y no más de un paso (junto a un hueco). Las dos de una
 *   línea de apoyo, cada una hacia su lado; entre las caras de un pilar no hay estaciones, así que ese
 *   tramo lo cubren las de las caras (fase F, `armado.ts`).
 * - **Pico:** un máximo local de la demanda a lo largo de una franja con prominencia ≥ 5 % del mayor
 *   de la planta (AB-a).
 * - **Zona de refuerzo:** una componente conexa de los tramos de una losa que superan su base (AB-b):
 *   dos tramos seguidos de una franja, o de dos franjas vecinas que se solapan en s más de 1 mm. Su
 *   extensión es la de sus tramos (AB-d, ±Δs/2), sin anclajes ni solapes.
 *
 * Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "./combinaciones.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import { PASO_ESTACIONES, type Franja } from "../compilador/franjas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { ARMADURAS, baseDe, type ArmadoProyecto, type Armadura } from "./armaduraBase.ts";

export { ARMADURAS, type Armadura };

/** Un tramo coloreado de una franja: su extensión, su rectángulo en planta y su demanda. */
export interface TramoArmado {
  franja: string;
  losa: string;
  /** La estación que lo colorea: su índice en la franja y su s (a lo largo, m). */
  estacion: number;
  s: number;
  /** Extensión a lo largo [a, b] y en transversal [t0, t1] (la de la franja), m. */
  a: number;
  b: number;
  t0: number;
  t1: number;
  /** Demanda de Wood–Armer de la armadura (kN·m/m) y la combinación que la da. */
  v: number;
  comb: string;
  rectangulo: Vec2[];
}

/** Las franjas de una losa en la dirección de la armadura, con sus tramos (en orden de t y de s). */
export interface FranjaTramos {
  franja: Franja;
  tramos: TramoArmado[];
}

export const direccionDe = (a: Armadura): 1 | 2 => (a[0] === "x" ? 1 : 2);
export const caraDe = (a: Armadura): "inferior" | "superior" => (a.endsWith("inf") ? "inferior" : "superior");

const ok = <T>(valor: T, diagnosticos: Diagnostico[] = []) => ({ valido: true as const, valor, diagnosticos });
type Resp<T> = { valido: true; valor: T; diagnosticos: Diagnostico[] } | { valido: false; diagnosticos: Diagnostico[] };

/** Las losas que se piden: las de una planta, una o todas (en el orden del modelo). */
export function losasDe(q: Consultas, o: { planta?: string; losa?: string }): string[] {
  return (q.fisico.losas ?? []).filter((l) => (o.losa === undefined || l.id === o.losa) && (o.planta === undefined || l.planta === o.planta)).map((l) => l.id);
}

/** Los tramos de las franjas de unas losas en una armadura, con su demanda (los valores de «fem consultar franja»). */
export function franjasTramos(q: Consultas, losas: readonly string[], armadura: Armadura, conjunto: ConjuntoCombinaciones): Resp<FranjaTramos[]> {
  const direccion = direccionDe(armadura);
  const cara = caraDe(armadura);
  const r: FranjaTramos[] = [];
  for (const losa of losas) {
    const fs = q.franjas(losa);
    if (!fs.valido) return fs;
    for (const f of fs.valor) {
      if (f.direccion !== direccion) continue;
      const g = q.franja(f.id);
      if (!g.valido) return g;
      const w = q.armadoFranja(f.id, conjunto.factores);
      if (!w.valido) return w;
      const es = g.valor.estaciones;
      const P = (s: number, t: number): Vec2 => [s * f.d[0] + t * f.n[0], s * f.d[1] + t * f.n[1]];
      const tramos: TramoArmado[] = [];
      es.forEach((e, i) => {
        if (!e.valido) return;
        // Hasta la mitad de sus vecinas, y no más de un paso (junto a un hueco, la vecina no vale)
        const a = Math.max(i > 0 ? (es[i - 1]!.s + e.s) / 2 : f.s0, e.s - PASO_ESTACIONES);
        const b = Math.min(i + 1 < es.length ? (e.s + es[i + 1]!.s) / 2 : f.s1, e.s + PASO_ESTACIONES);
        if (!(b > a)) return;
        const x = w.valor[i]!;
        const v = cara === "inferior" ? x.inferior : x.superior;
        const c = cara === "inferior" ? x.combInferior : x.combSuperior;
        tramos.push({ franja: f.id, losa, estacion: i, s: e.s, a, b, t0: f.t0, t1: f.t1, v, comb: c >= 0 ? conjunto.nombres[c]! : "", rectangulo: [P(a, f.t0), P(b, f.t0), P(b, f.t1), P(a, f.t1)] });
      });
      r.push({ franja: f, tramos });
    }
  }
  return ok(r);
}

/** Fracción del mayor de la planta que tiene que tener la prominencia de un pico para rotularlo (AB-a). */
export const PROMINENCIA_PICOS = 0.05;

/**
 * Los picos de la demanda a lo largo de una franja: los máximos locales (de una meseta, el primero)
 * con v > 0 y prominencia ≥ `minima`. La prominencia es lo que baja hasta un punto más alto (o hasta
 * el final): v − el mayor de los mínimos de cada lado.
 */
export function picos(tramos: readonly TramoArmado[], minima: number): TramoArmado[] {
  const n = tramos.length;
  const r: TramoArmado[] = [];
  for (let i = 0; i < n; i++) {
    const v = tramos[i]!.v;
    if (!(v > 0)) continue;
    if (i > 0 && tramos[i - 1]!.v >= v) continue;
    let j = i + 1;
    while (j < n && tramos[j]!.v === v) j++;
    if (j < n && tramos[j]!.v > v) continue;
    let izq = v;
    for (let k = i - 1; k >= 0 && tramos[k]!.v <= v; k--) izq = Math.min(izq, tramos[k]!.v);
    let der = v;
    for (let k = j; k < n && tramos[k]!.v <= v; k++) der = Math.min(der, tramos[k]!.v);
    if (i === 0) izq = Math.min(izq, 0);
    if (j === n) der = Math.min(der, 0);
    if (v - Math.max(izq, der) >= minima) r.push(tramos[i]!);
  }
  return r;
}

/** Una zona de refuerzo: lo que supera la base, conexo, en una losa y armadura. */
export interface ZonaRefuerzo {
  /** `<losa>:<armadura>:R<i>`, numeradas por su primer s y después por su primer t. */
  id: string;
  losa: string;
  armadura: Armadura;
  /** La base de la losa en la armadura, kN·m/m. */
  base: number;
  /** Sus franjas, de menor a mayor t. */
  franjas: string[];
  /** Extensión a lo largo [s0, s1] y en transversal [t0, t1], m, y su longitud (s1 − s0). */
  s: [number, number];
  t: [number, number];
  longitud: number;
  /** Área de sus tramos, m². */
  area: number;
  /** La mayor demanda (kN·m/m): su franja, su estación, su combinación y el exceso sobre la base. */
  maximo: { v: number; franja: string; s: number; comb: string; exceso: number };
  /** Sus tramos, en orden de franja y de s. */
  tramos: TramoArmado[];
  /** Su contorno en planta: segmentos sueltos (los bordes de sus tramos que no comparte). */
  contorno: [Vec2, Vec2][];
}

const SOLAPE_MINIMO = 1e-3;
const JUNTO = 1e-9;

/** Las zonas de refuerzo de las franjas de una losa (las de `franjasTramos`) con su base. */
export function zonasRefuerzo(losa: string, armadura: Armadura, base: number, fs: readonly FranjaTramos[]): ZonaRefuerzo[] {
  const franjas = fs.filter((f) => f.franja.losa === losa).sort((x, y) => x.franja.t0 - y.franja.t0);
  // Los tramos que superan la base, por franja, con un índice global
  const sobre: TramoArmado[][] = franjas.map((f) => f.tramos.filter((t) => t.v > base));
  const todos = sobre.flat();
  const id = new Map<TramoArmado, number>(todos.map((t, i) => [t, i]));
  const padre = todos.map((_, i) => i);
  const raiz = (i: number): number => {
    while (padre[i] !== i) i = padre[i] = padre[padre[i]!]!;
    return i;
  };
  const unir = (a: number, b: number) => {
    const [x, y] = [raiz(a), raiz(b)];
    if (x !== y) padre[Math.max(x, y)] = Math.min(x, y);
  };
  sobre.forEach((ts, k) => {
    // Seguidos en la franja
    for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i]!.a - ts[i - 1]!.b) <= JUNTO) unir(id.get(ts[i - 1]!)!, id.get(ts[i]!)!);
    // Con la franja vecina (la de t mayor), si se tocan y se solapan en s
    const sig = sobre[k + 1];
    if (!sig || Math.abs(franjas[k + 1]!.franja.t0 - franjas[k]!.franja.t1) > JUNTO) return;
    let j = 0;
    for (const t of ts) {
      while (j < sig.length && sig[j]!.b <= t.a + SOLAPE_MINIMO) j++;
      for (let m = j; m < sig.length && sig[m]!.a < t.b - SOLAPE_MINIMO; m++) if (Math.min(t.b, sig[m]!.b) - Math.max(t.a, sig[m]!.a) > SOLAPE_MINIMO) unir(id.get(t)!, id.get(sig[m]!)!);
    }
  });
  const grupos = new Map<number, TramoArmado[]>();
  for (const t of todos) {
    const r = raiz(id.get(t)!);
    (grupos.get(r) ?? grupos.set(r, []).get(r)!).push(t);
  }
  const f0 = franjas[0]?.franja;
  const zonas = [...grupos.values()].map((ts) => {
    const s0 = Math.min(...ts.map((t) => t.a));
    const s1 = Math.max(...ts.map((t) => t.b));
    const t0 = Math.min(...ts.map((t) => t.t0));
    const t1 = Math.max(...ts.map((t) => t.t1));
    let m = ts[0]!;
    for (const t of ts) if (t.v > m.v) m = t;
    return {
      losa,
      armadura,
      base,
      franjas: [...new Set(ts.map((t) => t.franja))],
      s: [s0, s1] as [number, number],
      t: [t0, t1] as [number, number],
      longitud: s1 - s0,
      area: ts.reduce((x, t) => x + (t.b - t.a) * (t.t1 - t.t0), 0),
      maximo: { v: m.v, franja: m.franja, s: m.s, comb: m.comb, exceso: m.v - base },
      tramos: ts,
      contorno: f0 ? contornoZona(ts, f0.d, f0.n) : [],
    };
  });
  zonas.sort((x, y) => x.s[0] - y.s[0] || x.t[0] - y.t[0]);
  return zonas.map((z, i) => ({ id: `${losa}:${armadura}:R${i + 1}`, ...z }));
}

/** Tramos seguidos de una franja, fundidos: [a, b]. */
function corridas(iv: readonly [number, number][]): [number, number][] {
  const r: [number, number][] = [];
  for (const [a, b] of iv) {
    const u = r[r.length - 1];
    if (u && Math.abs(a - u[1]) <= JUNTO) u[1] = b;
    else r.push([a, b]);
  }
  return r;
}

/** [a, b] menos unos intervalos ordenados y disjuntos. */
function menos(a: number, b: number, quitar: readonly [number, number][]): [number, number][] {
  const r: [number, number][] = [];
  let x = a;
  for (const [p, q] of quitar) {
    if (q <= x || p >= b) continue;
    if (p > x) r.push([x, p]);
    x = Math.max(x, q);
  }
  if (b > x) r.push([x, b]);
  return r.filter(([p, q]) => q - p > JUNTO);
}

/** El contorno de una zona: los bordes de sus corridas que no comparte con la franja vecina. */
function contornoZona(ts: readonly TramoArmado[], d: Vec2, n: Vec2): [Vec2, Vec2][] {
  const P = (s: number, t: number): Vec2 => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
  const porFranja = new Map<string, { t0: number; t1: number; c: [number, number][] }>();
  for (const t of ts) {
    const x = porFranja.get(t.franja);
    if (x) x.c.push([t.a, t.b]);
    else porFranja.set(t.franja, { t0: t.t0, t1: t.t1, c: [[t.a, t.b]] });
  }
  const fs = [...porFranja.values()].sort((x, y) => x.t0 - y.t0);
  for (const f of fs) f.c = corridas(f.c.sort((x, y) => x[0] - y[0]));
  const r: [Vec2, Vec2][] = [];
  fs.forEach((f, k) => {
    const ant = k > 0 && Math.abs(fs[k - 1]!.t1 - f.t0) <= JUNTO ? fs[k - 1]!.c : [];
    const sig = k + 1 < fs.length && Math.abs(fs[k + 1]!.t0 - f.t1) <= JUNTO ? fs[k + 1]!.c : [];
    for (const [a, b] of f.c) {
      r.push([P(a, f.t0), P(a, f.t1)], [P(b, f.t0), P(b, f.t1)]);
      for (const [p, q] of menos(a, b, ant)) r.push([P(p, f.t0), P(q, f.t0)]);
      for (const [p, q] of menos(a, b, sig)) r.push([P(p, f.t1), P(q, f.t1)]);
    }
  });
  return r;
}

/** Las zonas de refuerzo de unas losas en una armadura, con las bases del proyecto (las losas sin base, ninguna). */
export function refuerzosDe(q: Consultas, losas: readonly string[], armadura: Armadura, conjunto: ConjuntoCombinaciones, armado: ArmadoProyecto | undefined): Resp<{ zonas: ZonaRefuerzo[]; sinBase: string[] }> {
  const conBase = losas.filter((l) => baseDe(armado, l, armadura) !== null);
  const fs = franjasTramos(q, conBase, armadura, conjunto);
  if (!fs.valido) return fs;
  const zonas = conBase.flatMap((l) => zonasRefuerzo(l, armadura, baseDe(armado, l, armadura)!, fs.valor));
  return ok({ zonas, sinBase: losas.filter((l) => !conBase.includes(l)) });
}
