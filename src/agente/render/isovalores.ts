/**
 * Isovalores en bandas (A4): un campo lineal por triángulos, partido en bandas entre unos límites, y
 * las bandas iguales fundidas en un solo contorno por banda (sin las costuras del antialias entre
 * triángulos vecinos).
 *
 * - En un triángulo, el campo es lineal, así que la parte entre dos límites es un polígono convexo
 *   cuyos vértices son los del triángulo con el valor dentro y los cortes de sus lados con los dos
 *   límites, en el orden del contorno.
 * - Un corte se calcula siempre desde los dos extremos del lado ordenados, así que dos triángulos
 *   que comparten el lado (con los mismos valores en sus nudos) dan el mismo punto, bit a bit.
 * - Fusión: los lados que aparecen dos veces en sentidos opuestos (entre dos trozos de la misma
 *   banda) se cancelan, y los que quedan se encadenan en anillos. Con todos los trozos en sentido
 *   antihorario, la regla «nonzero» rellena justo la unión.
 *
 * Puro: sin IO.
 */
import type { Vec2 } from "./escena.ts";

export interface Triangulo {
  p: readonly [Vec2, Vec2, Vec2];
  v: readonly [number, number, number];
}

/**
 * Límites redondos (1, 2, 2,5 o 5 × 10ᵏ) que cubren [min, max] en `n` bandas como mucho; si `cero`,
 * el 0 es uno de ellos (para una paleta divergente).
 */
export function limitesRedondos(min: number, max: number, n = 10, cero = true): number[] {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return [0, 1];
  if (cero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (max - min < 1e-300 || max === min) {
    const m = Math.abs(max) || 1;
    return [min - m * 0.05, max + m * 0.05];
  }
  for (let k = Math.floor(Math.log10((max - min) / n)) - 1; ; k++)
    for (const m of [1, 2, 2.5, 5]) {
      const paso = m * 10 ** k;
      const a = Math.floor(min / paso + 1e-9);
      const b = Math.ceil(max / paso - 1e-9);
      if (b - a <= n) return Array.from({ length: b - a + 1 }, (_, i) => Number(((a + i) * paso).toPrecision(12)));
    }
}

/** Banda de un valor (índice del intervalo [L_i, L_i+1]; los de fuera, a la primera o la última). */
export function bandaDe(v: number, L: readonly number[]): number {
  let i = 0;
  while (i < L.length - 2 && v >= L[i + 1]!) i++;
  return i;
}

/** Punto del lado (a, b) donde el campo vale L: desde los extremos ordenados, para que sea canónico. */
function corte(pa: Vec2, va: number, pb: Vec2, vb: number, L: number): Vec2 {
  const menor = pa[0] < pb[0] || (pa[0] === pb[0] && pa[1] < pb[1]);
  const [p, q, u, w] = menor ? [pa, pb, va, vb] : [pb, pa, vb, va];
  const t = (L - u) / (w - u);
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}

const clave = (p: Vec2) => `${p[0]},${p[1]}`;

/**
 * Trozos de cada banda en un triángulo (antihorarios). Los valores fuera de [L₀, Lₙ] van a la banda
 * del extremo, como si los límites extremos fueran ±∞.
 */
export function trozosTriangulo(t: Triangulo, L: readonly number[]): Map<number, Vec2[]> {
  const nb = L.length - 1;
  // Contorno: cada vértice y los cortes de su lado con los límites interiores, en orden
  const contorno: { p: Vec2; v: number }[] = [];
  let [p0, p1, p2] = t.p;
  let [v0, v1, v2] = t.v;
  const a2 = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  if (a2 === 0) return new Map();
  if (a2 < 0) [p1, p2, v1, v2] = [p2, p1, v2, v1];
  const P = [p0, p1, p2];
  const V = [v0, v1, v2];
  const interiores = L.slice(1, -1);
  for (let i = 0; i < 3; i++) {
    const [pa, pb, va, vb] = [P[i]!, P[(i + 1) % 3]!, V[i]!, V[(i + 1) % 3]!];
    contorno.push({ p: pa, v: va });
    const cortes = interiores.filter((l) => (va < l && l < vb) || (vb < l && l < va));
    if (vb < va) cortes.reverse();
    for (const l of cortes) contorno.push({ p: corte(pa, va, pb, vb, l), v: l });
  }
  const r = new Map<number, Vec2[]>();
  const b0 = bandaDe(Math.min(...V), L);
  const b1 = bandaDe(Math.max(...V), L);
  for (let b = b0; b <= b1; b++) {
    const lo = b === 0 ? -Infinity : L[b]!;
    const hi = b === nb - 1 ? Infinity : L[b + 1]!;
    const pts = contorno.filter((x) => x.v >= lo && x.v <= hi).map((x) => x.p);
    // Sin duplicados seguidos (un vértice en un límite)
    const q = pts.filter((x, i) => clave(x) !== clave(pts[(i + pts.length - 1) % pts.length]!));
    if (q.length >= 3 && Math.abs(areaAnillo(q)) > 0) r.set(b, q);
  }
  return r;
}

function areaAnillo(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]![0] - p[i]![0]) * (p[j]![1] + p[i]![1]);
  return a / 2;
}

export interface BandaFundida {
  banda: number;
  anillos: Vec2[][];
  /** Área de los trozos (antes de fundir), para el criterio 1 de A4. */
  area: number;
}

/** Las bandas de unos triángulos, cada una fundida en sus anillos. */
export function bandas(triangulos: readonly Triangulo[], L: readonly number[]): BandaFundida[] {
  const lados = new Map<number, Map<string, { a: Vec2; b: Vec2; n: number }>>();
  const areas = new Map<number, number>();
  for (const t of triangulos)
    for (const [b, q] of trozosTriangulo(t, L)) {
      let m = lados.get(b);
      if (!m) lados.set(b, (m = new Map()));
      areas.set(b, (areas.get(b) ?? 0) + areaAnillo(q));
      for (let i = 0; i < q.length; i++) {
        const [a, c] = [q[i]!, q[(i + 1) % q.length]!];
        const [ka, kc] = [clave(a), clave(c)];
        const inverso = m.get(`${kc}|${ka}`);
        if (inverso) {
          if (--inverso.n === 0) m.delete(`${kc}|${ka}`);
          continue;
        }
        const k = `${ka}|${kc}`;
        const x = m.get(k);
        if (x) x.n++;
        else m.set(k, { a, b: c, n: 1 });
      }
    }
  const r: BandaFundida[] = [];
  for (const b of [...lados.keys()].sort((x, y) => x - y)) {
    const m = lados.get(b)!;
    // Encadenar: de cada punto, sus lados de salida en el orden en que aparecieron
    const salida = new Map<string, { a: Vec2; b: Vec2 }[]>();
    for (const e of m.values())
      for (let i = 0; i < e.n; i++) {
        const k = clave(e.a);
        let l = salida.get(k);
        if (!l) salida.set(k, (l = []));
        l.push(e);
      }
    const anillos: Vec2[][] = [];
    for (const e0 of m.values()) {
      const inicio = clave(e0.a);
      while (salida.get(inicio)?.length) {
        const anillo: Vec2[] = [];
        let k = inicio;
        for (let guarda = 0; guarda < 1e7; guarda++) {
          const l = salida.get(k);
          if (!l?.length) break;
          const e = l.shift()!;
          anillo.push(e.a);
          k = clave(e.b);
          if (k === inicio) break;
        }
        if (anillo.length >= 3) anillos.push(simplificar(anillo));
      }
    }
    r.push({ banda: b, anillos, area: areas.get(b) ?? 0 });
  }
  return r;
}

/** Quita los vértices alineados con sus vecinos (los de los lados partidos entre triángulos). */
function simplificar(p: Vec2[]): Vec2[] {
  if (p.length <= 3) return p;
  const r: Vec2[] = [];
  for (let i = 0; i < p.length; i++) {
    const [a, b, c] = [p[(i + p.length - 1) % p.length]!, p[i]!, p[(i + 1) % p.length]!];
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const escala = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (Math.abs(cruz) > 1e-12 * escala) r.push(b);
  }
  return r.length >= 3 ? r : p;
}

// ─── Paletas ────────────────────────────────────────────────────────────────────────────────────

/** Divergente (ColorBrewer RdBu, Apache-2.0): del más claro al más oscuro, para los positivos (rojos) y los negativos (azules). */
const ROJOS = ["#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f"];
const AZULES = ["#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** Color de la rampa en t ∈ [0, 1], interpolado entre sus colores. */
function enRampa(rampa: readonly string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (rampa.length - 1);
  const i = Math.min(rampa.length - 2, Math.floor(x));
  const [a, b] = [hex(rampa[i]!), hex(rampa[i + 1]!)];
  return `#${a.map((v, k) => Math.round(v + (b[k]! - v) * (x - i)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Color de cada banda en una paleta divergente centrada en 0 (los límites incluyen el 0): rojos los
 * positivos y azules los negativos, más oscuros cuanto más se aleja del 0 el límite exterior de la
 * banda respecto al mayor |límite|. Dos bandas distintas nunca tienen el mismo color.
 */
export function coloresBandas(L: readonly number[]): string[] {
  const m = Math.max(Math.abs(L[0]!), Math.abs(L[L.length - 1]!)) || 1;
  return L.slice(0, -1).map((l, i) => {
    const h = L[i + 1]!;
    const positiva = l + h >= 0;
    const exterior = positiva ? h : -l;
    return enRampa(positiva ? ROJOS : AZULES, exterior / m);
  });
}
