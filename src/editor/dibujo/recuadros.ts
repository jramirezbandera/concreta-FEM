/**
 * El recuadro cerrado alrededor de un punto (V2c-2, `docs/fem3d/dibujo.md` §2.4 y V2c-c): lo que en
 * CYPECAD es «un clic dentro del recuadro» para meter un paño. El contorno va por los ejes de las
 * vigas, muros y apoyos lineales de la planta que lo cierran y por los bordes de los forjados que ya
 * hay (los enrasados).
 *
 * - Las piezas se cortan en sus cruces (con `cruce` de `enganches.ts`: un extremo que cae en otra
 *   pieza es ese extremo, y con rectas paralelas a X o a Y el cruce tiene sus números) y donde un
 *   extremo cae en otra pieza colineal; los extremos de las piezas son nudos con sus números, bit a
 *   bit, y un cruce calculado a menos de 1e-9 m de un nudo es ese nudo.
 * - Lo que cuelga (un tramo que no cierra nada) se quita, y cada cara acotada del grafo plano es un
 *   recuadro: su contorno exterior recorrido con la cara a la izquierda (antihorario).
 * - El recuadro de un punto es el menor que lo contiene. Un contorno que pasa dos veces por un nudo
 *   (una pieza suelta dentro unida al borde por otra) no es un polígono simple y no vale.
 * - El contorno empieza en el vértice más cercano al punto (en un paño unidireccional, las viguetas
 *   empiezan en el lado más cercano a su primer vértice, C4-a.1) y sin vértices colineales.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { PlantaFisica } from "../../agente/render/modelo.ts";
import { cruce } from "./enganches.ts";

/** Lo que une dos puntos calculados (un cruce) con un nudo, m. */
const UNIR = 1e-9;

export interface Recuadro {
  /** Contorno antihorario, sin repetir el primero. */
  anillo: Vec2[];
  area: number;
  /** Caja [x0, y0, x1, y1], para descartar rápido. */
  caja: readonly [number, number, number, number];
  /** El contorno pasa dos veces por algún nudo: no es un polígono simple. */
  simple: boolean;
}

const areaFirmada = (p: readonly Vec2[]) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j]![0] * p[i]![1] - p[i]![0] * p[j]![1];
  return a / 2;
};

export function puntoEnPoligono(q: Vec2, p: readonly Vec2[]): boolean {
  let dentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Las piezas que cierran recuadros en una planta: ejes de vigas, muros y apoyos lineales, y bordes de losas y paños. */
export function piezasRecuadro(m: ModeloFisico, planta: string): [Vec2, Vec2][] {
  const pl = new PlantaFisica(m, planta);
  const r: [Vec2, Vec2][] = [];
  const tramos = (ps: readonly Vec2[], cerrado: boolean) => {
    const n = ps.length;
    for (let i = 0; i < (cerrado ? n : n - 1); i++) {
      const a = ps[i]!;
      const b = ps[(i + 1) % n]!;
      if (a[0] !== b[0] || a[1] !== b[1]) r.push([a, b]);
    }
  };
  for (const v of pl.enPlanta(m.vigas)) tramos(v.puntos, false);
  for (const { m: w } of pl.muros()) tramos(w.puntos, false);
  for (const a of pl.enPlanta(m.apoyosLineales)) tramos(a.puntos, false);
  for (const l of [...pl.enPlanta(m.losas), ...pl.enPlanta(m.panos)]) for (const h of [l.contorno, ...(l.huecos ?? [])]) tramos(h, true);
  return r;
}

/** Los recuadros de unas piezas, de menor a mayor área. */
export function recuadrosDe(piezas: readonly (readonly [Vec2, Vec2])[]): Recuadro[] {
  // Nudos: primero los extremos (con sus números); los cruces, unidos a un nudo a menos de UNIR
  const nudos: Vec2[] = [];
  const exactos = new Map<string, number>();
  const rejilla = new Map<string, number[]>();
  const celda = (x: number) => Math.floor(x / 1e-6);
  const nudo = (p: Vec2, unir: boolean): number => {
    const k = `${p[0]} ${p[1]}`;
    const e = exactos.get(k);
    if (e !== undefined) return e;
    const [cx, cy] = [celda(p[0]), celda(p[1])];
    if (unir)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const i of rejilla.get(`${cx + dx} ${cy + dy}`) ?? []) if (Math.hypot(nudos[i]![0] - p[0], nudos[i]![1] - p[1]) <= UNIR) return i;
    const i = nudos.length;
    nudos.push(p);
    exactos.set(k, i);
    const kc = `${cx} ${cy}`;
    rejilla.set(kc, [...(rejilla.get(kc) ?? []), i]);
    return i;
  };
  const cortes = piezas.map(([a, b]) => [
    { t: 0, n: nudo(a, false) },
    { t: 1, n: nudo(b, false) },
  ]);
  const parametro = (q: Vec2, [a, b]: readonly [Vec2, Vec2]) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    return ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy);
  };
  /** ¿Cae q en el tramo s (sin contar sus extremos)? */
  const sobre = (q: Vec2, s: readonly [Vec2, Vec2]) => {
    const t = parametro(q, s);
    if (!(t > 0 && t < 1)) return null;
    const [a, b] = s;
    const p: Vec2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) <= UNIR ? t : null;
  };
  for (let i = 0; i < piezas.length; i++) {
    const s = piezas[i]!;
    const [xi0, xi1] = [Math.min(s[0][0], s[1][0]), Math.max(s[0][0], s[1][0])];
    const [yi0, yi1] = [Math.min(s[0][1], s[1][1]), Math.max(s[0][1], s[1][1])];
    for (let j = i + 1; j < piezas.length; j++) {
      const r = piezas[j]!;
      if (Math.max(r[0][0], r[1][0]) < xi0 - UNIR || Math.min(r[0][0], r[1][0]) > xi1 + UNIR || Math.max(r[0][1], r[1][1]) < yi0 - UNIR || Math.min(r[0][1], r[1][1]) > yi1 + UNIR) continue;
      const c = cruce(s[0], s[1], r[0], r[1]);
      if (c) {
        const n = nudo(c, true);
        cortes[i]!.push({ t: parametro(nudos[n]!, s), n });
        cortes[j]!.push({ t: parametro(nudos[n]!, r), n });
        continue;
      }
      // Paralelas: los extremos de una que caen en la otra (piezas colineales que se solapan)
      for (const q of r) {
        const t = sobre(q, s);
        if (t !== null) cortes[i]!.push({ t, n: nudo(q, false) });
      }
      for (const q of s) {
        const t = sobre(q, r);
        if (t !== null) cortes[j]!.push({ t, n: nudo(q, false) });
      }
    }
  }
  // Aristas entre nudos consecutivos de cada pieza, sin repetir
  const vecinos = new Map<number, Set<number>>();
  const unir = (a: number, b: number) => {
    if (a === b) return;
    (vecinos.get(a) ?? vecinos.set(a, new Set()).get(a)!).add(b);
    (vecinos.get(b) ?? vecinos.set(b, new Set()).get(b)!).add(a);
  };
  for (const cs of cortes) {
    cs.sort((a, b) => a.t - b.t);
    for (let k = 1; k < cs.length; k++) unir(cs[k - 1]!.n, cs[k]!.n);
  }
  // Lo que cuelga no cierra nada
  const pila = [...vecinos.keys()].filter((n) => vecinos.get(n)!.size < 2);
  while (pila.length) {
    const n = pila.pop()!;
    const vs = vecinos.get(n);
    if (!vs) continue;
    vecinos.delete(n);
    for (const v of vs) {
      const w = vecinos.get(v);
      if (!w) continue;
      w.delete(n);
      if (w.size < 2) pila.push(v);
    }
  }
  // Vecinos por ángulo creciente
  const orden = new Map<number, number[]>();
  for (const [n, vs] of vecinos) {
    const p = nudos[n]!;
    orden.set(
      n,
      [...vs].sort((a, b) => Math.atan2(nudos[a]![1] - p[1], nudos[a]![0] - p[0]) - Math.atan2(nudos[b]![1] - p[1], nudos[b]![0] - p[0])),
    );
  }
  // Cada arista dirigida, en una sola cara: la de su izquierda. En v, desde u, el vecino siguiente en sentido horario
  const vistas = new Set<string>();
  const r: Recuadro[] = [];
  for (const [u0, vs] of orden)
    for (const v0 of vs) {
      if (vistas.has(`${u0} ${v0}`)) continue;
      const ciclo: number[] = [];
      let [u, v] = [u0, v0];
      for (let paso = 0; paso <= 4 * nudos.length; paso++) {
        vistas.add(`${u} ${v}`);
        ciclo.push(u);
        const o = orden.get(v)!;
        const w = o[(o.indexOf(u) - 1 + o.length) % o.length]!;
        [u, v] = [v, w];
        if (u === u0 && v === v0) break;
      }
      const anillo = ciclo.map((i) => nudos[i]!);
      const area = areaFirmada(anillo);
      if (!(area > 0)) continue;
      const xs = anillo.map((p) => p[0]);
      const ys = anillo.map((p) => p[1]);
      r.push({ anillo, area, caja: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], simple: new Set(ciclo).size === ciclo.length });
    }
  return r.sort((a, b) => a.area - b.area);
}

/** El menor recuadro que contiene q, o null si q no está dentro de ninguno. */
export function recuadroEn(rs: readonly Recuadro[], q: Vec2): Recuadro | null {
  for (const x of rs) {
    const [x0, y0, x1, y1] = x.caja;
    if (q[0] < x0 || q[0] > x1 || q[1] < y0 || q[1] > y1) continue;
    if (puntoEnPoligono(q, x.anillo)) return x;
  }
  return null;
}

/** El contorno sin los vértices colineales con sus vecinos, empezando en el más cercano a q. */
export function contornoDesde(anillo: readonly Vec2[], q: Vec2): Vec2[] {
  let ps = [...anillo];
  for (let cambio = true; cambio && ps.length > 3; ) {
    cambio = false;
    for (let i = 0; i < ps.length && ps.length > 3; i++) {
      const a = ps[(i - 1 + ps.length) % ps.length]!;
      const b = ps[i]!;
      const c = ps[(i + 1) % ps.length]!;
      const [ux, uy, vx, vy] = [b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]];
      const x = ux * vy - uy * vx;
      if (Math.abs(x) <= 1e-12 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy > 0) {
        ps = [...ps.slice(0, i), ...ps.slice(i + 1)];
        cambio = true;
        i--;
      }
    }
  }
  let k = 0;
  for (let i = 1; i < ps.length; i++) if (Math.hypot(ps[i]![0] - q[0], ps[i]![1] - q[1]) < Math.hypot(ps[k]![0] - q[0], ps[k]![1] - q[1])) k = i;
  return [...ps.slice(k), ...ps.slice(0, k)];
}

/** Cache por índice de enganches (se rehace con el modelo): los recuadros de la planta. */
const cache = new WeakMap<object, Recuadro[]>();
export function recuadrosPlanta(m: ModeloFisico, planta: string, clave: object): Recuadro[] {
  let r = cache.get(clave);
  if (!r) {
    r = recuadrosDe(piezasRecuadro(m, planta));
    cache.set(clave, r);
  }
  return r;
}
