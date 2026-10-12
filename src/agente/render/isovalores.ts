/**
 * Isovalores en bandas (A4): un campo lineal por triángulos, partido en bandas entre unos límites, y
 * las bandas iguales fundidas en un solo contorno por banda (sin las costuras del antialias entre
 * triángulos vecinos); las isolíneas de los límites, y dónde rotularlas.
 *
 * - Los triángulos de una lámina salen de subdividir su cuadrilátero con la interpolación bilineal
 *   de los valores de sus nudos (`triangulosCuadrilatero`): partido en dos por una diagonal fija, el
 *   campo dibujado tenía un serrado del tamaño de la malla, siempre orientado igual.
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
import { TEXTO_MINIMO, type Texto, type Vec2 } from "./escena.ts";

export interface Triangulo {
  p: readonly [Vec2, Vec2, Vec2];
  v: readonly [number, number, number];
}

// ─── Subdivisión de una lámina ──────────────────────────────────────────────────────────────────

/**
 * Niveles de subdivisión de una lámina: 0, en 4 triángulos por su centro; 1, en 2×2 cuadriláteros y
 * cada uno en 4 (16). Con 1, la escena de un mapa del edificio objetivo tardaba 3 veces más, y a la
 * escala de la planta entera no se distingue.
 */
export const SUBDIVISION = 0;

/** Punto y valor medios de un lado: la suma es conmutativa, así que dos láminas que lo comparten dan los mismos bits. */
const medio = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * Triángulos de una lámina de 4 nudos para dibujar el campo bilineal de los valores de sus nudos:
 * `niveles` veces partida en 2×2 por los puntos medios de sus lados y su centro (el bilineal de un
 * subcuadrilátero es el de sus esquinas, así que los puntos son exactos), y cada parte, en 4
 * triángulos por su centro, con la media de sus 4 valores (el bilineal en el centro). Sin diagonal,
 * no hay dirección preferida. Los puntos de un lado sólo dependen de sus extremos, así que las
 * láminas vecinas casan bit a bit.
 */
export function triangulosCuadrilatero(p: readonly Vec2[], v: readonly number[], niveles = SUBDIVISION): Triangulo[] {
  const r: Triangulo[] = [];
  const partir = (q: readonly Vec2[], w: readonly number[], k: number) => {
    const c: Vec2 = [(q[0]![0] + q[1]![0] + q[2]![0] + q[3]![0]) / 4, (q[0]![1] + q[1]![1] + q[2]![1] + q[3]![1]) / 4];
    const wc = (w[0]! + w[1]! + w[2]! + w[3]!) / 4;
    if (k === 0) {
      for (let i = 0; i < 4; i++) r.push({ p: [q[i]!, q[(i + 1) % 4]!, c], v: [w[i]!, w[(i + 1) % 4]!, wc] });
      return;
    }
    const m = [0, 1, 2, 3].map((i) => medio(q[i]!, q[(i + 1) % 4]!));
    const wm = [0, 1, 2, 3].map((i) => (w[i]! + w[(i + 1) % 4]!) / 2);
    for (let i = 0; i < 4; i++) {
      const j = (i + 3) % 4;
      partir([q[i]!, m[i]!, c, m[j]!], [w[i]!, wm[i]!, wc, wm[j]!], k - 1);
    }
  };
  if (p.length === 4) partir(p, v, niveles);
  else if (p.length === 3) r.push({ p: [p[0]!, p[1]!, p[2]!], v: [v[0]!, v[1]!, v[2]!] });
  return r;
}

/** Valor en q del campo lineal de un triángulo, o null si q no está en él (con una tolerancia relativa). */
export function valorEnTriangulo(t: Triangulo, q: Vec2): number | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = t.p;
  const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (det === 0) return null;
  const l0 = ((y1 - y2) * (q[0] - x2) + (x2 - x1) * (q[1] - y2)) / det;
  const l1 = ((y2 - y0) * (q[0] - x2) + (x0 - x2) * (q[1] - y2)) / det;
  const l2 = 1 - l0 - l1;
  const eps = -1e-9;
  if (l0 < eps || l1 < eps || l2 < eps) return null;
  return l0 * t.v[0] + l1 * t.v[1] + l2 * t.v[2];
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

// ─── Escala de un mapa ──────────────────────────────────────────────────────────────────────────

/**
 * Escala de un mapa:
 * - `completa` (por defecto): del mínimo al máximo, en límites redondos que incluyen el 0;
 * - `sin-picos`: sin la fracción FRACCION_PICOS del área por cada lado, para que un pico local (la
 *   esquina de un hueco, el borde de un pilar) no deje el resto en una o dos bandas;
 * - `min` y `max` (uno o los dos) fijan el rango, tal cual (la banda del extremo puede quedar más
 *   estrecha que las demás), y `paso` la separación de los límites, en sus múltiplos.
 * Lo que queda fuera del rango va a una banda más por cada lado («menos de…», «más de…»).
 */
export interface EscalaMapa {
  modo?: "completa" | "sin-picos";
  min?: number;
  max?: number;
  paso?: number;
}

/** Fracción del área que se deja fuera por cada lado con `sin-picos`. */
export const FRACCION_PICOS = 0.01;
/** Bandas como mucho con un paso dado. */
export const MAXIMO_BANDAS = 40;
/** Con la escala completa, se avisa de los picos si el mayor |valor| pasa de este múltiplo del de `sin-picos`. */
export const AVISO_PICOS = 2.5;

/** Los valores v de los puntos de pesos w (áreas) entre los que queda todo salvo la fracción f por cada lado. */
export function rangoSinPicos(v: ArrayLike<number>, w: ArrayLike<number>, f = FRACCION_PICOS): [number, number] | null {
  const idx: number[] = [];
  let total = 0;
  for (let i = 0; i < v.length; i++)
    if (Number.isFinite(v[i]!) && w[i]! > 0) {
      idx.push(i);
      total += w[i]!;
    }
  if (!idx.length || !(total > 0)) return null;
  idx.sort((a, b) => v[a]! - v[b]! || a - b);
  const cuantil = (q: number, desde: "abajo" | "arriba") => {
    let acum = 0;
    const orden = desde === "abajo" ? idx : [...idx].reverse();
    for (const i of orden) {
      acum += w[i]!;
      if (acum > q * total) return v[i]!;
    }
    return v[orden[orden.length - 1]!]!;
  };
  return [cuantil(f, "abajo"), cuantil(f, "arriba")];
}

/**
 * Una escala escrita: «completa», «sin-picos» o «mín:máx:paso», con cualquiera de los tres vacío
 * («-40:20:», «::5») y coma o punto decimal.
 */
export function escalaDeTexto(t: string): EscalaMapa | { error: string } {
  const x = t.trim();
  if (x === "" || x === "completa") return {};
  if (x === "sin-picos") return { modo: "sin-picos" };
  const partes = x.split(":");
  if (partes.length !== 3) return { error: `escala «${t}»: completa, sin-picos o mín:máx:paso` };
  const r: EscalaMapa = {};
  const nombres = ["min", "max", "paso"] as const;
  for (let i = 0; i < 3; i++) {
    const p = partes[i]!.trim().replace(",", ".").replace("−", "-");
    if (!p) continue;
    const n = Number(p);
    if (!Number.isFinite(n)) return { error: `escala «${t}»: «${partes[i]}» no es un número` };
    r[nombres[i]!] = n;
  }
  const v = limitesMapa(r.min ?? -1, r.max ?? 1, r);
  return "error" in v ? { error: `escala «${t}»: ${v.error}` } : r;
}

export interface LimitesMapa {
  /** Límites de las bandas; con `fueraAbajo`, L[0] es el mínimo del campo (la banda 0 es la de fuera), y con `fueraArriba`, el último es el máximo. */
  L: number[];
  fueraAbajo: boolean;
  fueraArriba: boolean;
  /** Separación de los límites interiores. */
  paso: number;
}

/**
 * Los límites de un mapa de valores en [vmin, vmax] con una escala (`robusto`: el rango de
 * `rangoSinPicos`). Sin `min` ni `max`, el 0 es uno de los límites (paleta divergente).
 */
export function limitesMapa(vmin: number, vmax: number, escala: EscalaMapa = {}, robusto: [number, number] | null = null): LimitesMapa | { error: string } {
  for (const [k, x] of [["min", escala.min], ["max", escala.max], ["paso", escala.paso]] as const) if (x !== undefined && !Number.isFinite(x)) return { error: `${k} no es un número` };
  if (escala.paso !== undefined && !(escala.paso > 0)) return { error: "el paso tiene que ser mayor que 0" };
  let [a, b] = escala.modo === "sin-picos" && robusto ? robusto : [vmin, vmax];
  if (escala.min !== undefined) a = escala.min;
  if (escala.max !== undefined) b = escala.max;
  if (!(a < b) && (escala.min !== undefined || escala.max !== undefined)) return { error: `el mínimo (${a}) tiene que ser menor que el máximo (${b})` };
  const cero = escala.min === undefined && escala.max === undefined;
  let L: number[];
  if (escala.paso !== undefined) {
    const paso = escala.paso;
    if (cero) [a, b] = [Math.min(a, 0), Math.max(b, 0)];
    const i0 = Math.floor(a / paso + 1e-9);
    let i1 = Math.ceil(b / paso - 1e-9);
    if (i1 <= i0) i1 = i0 + 1;
    if (i1 - i0 > MAXIMO_BANDAS) return { error: `con un paso de ${paso} salen ${i1 - i0} bandas (como mucho ${MAXIMO_BANDAS})` };
    L = [];
    for (let i = i0; i <= i1; i++) L.push(Number((i * paso).toPrecision(12)));
  } else L = limitesRedondos(a, b, 10, cero);
  // Un mínimo o un máximo dados son el borde de la escala, aunque la banda del extremo quede más estrecha
  const eps = 1e-9 * (b - a);
  if (escala.min !== undefined) L = [a, ...L.filter((x) => x > a + eps)];
  if (escala.max !== undefined) L = [...L.filter((x) => x < b - eps), b];
  const fueraAbajo = vmin < L[0]!;
  const fueraArriba = vmax > L[L.length - 1]!;
  // El paso de los límites interiores (los de los extremos pueden estar más cerca)
  const paso = escala.paso ?? (L.length > 2 ? L[2]! - L[1]! : L.length > 1 ? L[1]! - L[0]! : 1);
  if (fueraAbajo) L.unshift(vmin);
  if (fueraArriba) L.push(vmax);
  return { L, fueraAbajo, fueraArriba, paso };
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

const igual = (p: Vec2, q: Vec2) => p[0] === q[0] && p[1] === q[1];

/**
 * Un número por punto, por sus coordenadas exactas (como `${x},${y}`: −0 y 0 son el mismo), sin
 * crear textos: con las claves de texto, fundir las bandas costaba 2,5 veces más.
 */
class Puntos {
  private readonly m = new Map<number, Map<number, number>>();
  readonly p: Vec2[] = [];
  id(q: Vec2): number {
    let f = this.m.get(q[0]);
    if (!f) this.m.set(q[0], (f = new Map()));
    let i = f.get(q[1]);
    if (i === undefined) {
      f.set(q[1], (i = this.p.length));
      this.p.push(q);
    }
    return i;
  }
}

/** Clave de un lado orientado (a, b) por los números de sus puntos. */
const LADO = 2 ** 26;

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
    const q = pts.filter((x, i) => !igual(x, pts[(i + pts.length - 1) % pts.length]!));
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
  const P = new Puntos();
  const lados = new Map<number, Map<number, { a: number; b: number; n: number }>>();
  const areas = new Map<number, number>();
  for (const t of triangulos)
    for (const [b, q] of trozosTriangulo(t, L)) {
      let m = lados.get(b);
      if (!m) lados.set(b, (m = new Map()));
      areas.set(b, (areas.get(b) ?? 0) + areaAnillo(q));
      const ids = q.map((x) => P.id(x));
      for (let i = 0; i < ids.length; i++) {
        const [a, c] = [ids[i]!, ids[(i + 1) % ids.length]!];
        const kInverso = c * LADO + a;
        const inverso = m.get(kInverso);
        if (inverso) {
          if (--inverso.n === 0) m.delete(kInverso);
          continue;
        }
        const k = a * LADO + c;
        const x = m.get(k);
        if (x) x.n++;
        else m.set(k, { a, b: c, n: 1 });
      }
    }
  const r: BandaFundida[] = [];
  for (const b of [...lados.keys()].sort((x, y) => x - y)) {
    const m = lados.get(b)!;
    // Encadenar: de cada punto, sus lados de salida en el orden en que aparecieron
    const salida = new Map<number, { a: number; b: number }[]>();
    for (const e of m.values())
      for (let i = 0; i < e.n; i++) {
        let l = salida.get(e.a);
        if (!l) salida.set(e.a, (l = []));
        l.push(e);
      }
    const anillos: Vec2[][] = [];
    for (const e0 of m.values()) {
      const inicio = e0.a;
      while (salida.get(inicio)?.length) {
        const anillo: Vec2[] = [];
        let k = inicio;
        for (let guarda = 0; guarda < 1e7; guarda++) {
          const l = salida.get(k);
          if (!l?.length) break;
          const e = l.shift()!;
          anillo.push(P.p[e.a]!);
          k = e.b;
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

// ─── Isolíneas ──────────────────────────────────────────────────────────────────────────────────

export interface Isolinea {
  /** Índice del límite en L. */
  limite: number;
  valor: number;
  /** Polilíneas; las cerradas repiten el primer punto al final. */
  lineas: Vec2[][];
}

/**
 * Punto del lado (a, b) donde el campo vale l, con a y b a distinto lado de l («encima» es ≥ l): el
 * extremo mismo si vale l, y si no, el corte canónico de las bandas. Así un trozo de isolínea acaba
 * exactamente en el borde de su banda, y dos triángulos vecinos dan el mismo punto.
 */
function corteNivel(pa: Vec2, va: number, pb: Vec2, vb: number, l: number): Vec2 {
  if (va === l) return pa;
  if (vb === l) return pb;
  return corte(pa, va, pb, vb, l);
}

/**
 * Las isolíneas de los límites interiores de L en unos triángulos (marching triangles): en cada
 * triángulo con vértices a los dos lados del límite, el segmento entre los cortes de sus lados; los
 * repetidos (un lado justo en el límite) una vez, y encadenados en polilíneas. Donde el campo salta
 * (entre regiones), no hay isolínea: el campo no pasa por el límite, salta por encima.
 */
export function isolineas(triangulos: readonly Triangulo[], L: readonly number[]): Isolinea[] {
  const r: Isolinea[] = [];
  for (let k = 1; k < L.length - 1; k++) {
    const l = L[k]!;
    const P = new Puntos();
    const segs = new Map<number, [number, number]>();
    for (const t of triangulos) {
      const enc = t.v.map((x) => x >= l);
      if (enc[0] === enc[1] && enc[1] === enc[2]) continue;
      const pts: Vec2[] = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if (enc[i] !== enc[j]) pts.push(corteNivel(t.p[i]!, t.v[i]!, t.p[j]!, t.v[j]!, l));
      }
      const [a, b] = [P.id(pts[0]!), P.id(pts[1]!)];
      if (a === b) continue;
      segs.set(a < b ? a * LADO + b : b * LADO + a, [a, b]);
    }
    if (segs.size) r.push({ limite: k, valor: l, lineas: encadenar([...segs.values()], P.p) });
  }
  return r;
}

/** Segmentos (por los números de sus puntos) en polilíneas: primero las abiertas (desde un extremo con un solo segmento), después los anillos. */
function encadenar(segs: readonly [number, number][], P: readonly Vec2[]): Vec2[][] {
  const de = new Map<number, number[]>();
  segs.forEach(([a, b], i) => {
    for (const k of [a, b]) {
      const l = de.get(k);
      if (l) l.push(i);
      else de.set(k, [i]);
    }
  });
  const usado = new Uint8Array(segs.length);
  const r: Vec2[][] = [];
  const seguir = (inicio: number) => {
    const linea: Vec2[] = [P[inicio]!];
    let k = inicio;
    for (;;) {
      const i = de.get(k)!.find((x) => !usado[x]);
      if (i === undefined) break;
      usado[i] = 1;
      const [a, b] = segs[i]!;
      k = a === k ? b : a;
      linea.push(P[k]!);
    }
    if (linea.length >= 2) r.push(simplificarLinea(linea));
  };
  for (const [k, l] of de) if (l.length === 1 && !usado[l[0]!]) seguir(k);
  for (let i = 0; i < segs.length; i++) if (!usado[i]) seguir(segs[i]![0]);
  return r;
}

/** Quita los puntos interiores alineados con sus vecinos (conserva los extremos). */
function simplificarLinea(p: Vec2[]): Vec2[] {
  if (p.length <= 2) return p;
  const r: Vec2[] = [p[0]!];
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [r[r.length - 1]!, p[i]!, p[i + 1]!];
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const escala = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (Math.abs(cruz) > 1e-12 * escala) r.push(b);
  }
  r.push(p[p.length - 1]!);
  return r;
}

// ─── Rótulos de las isolíneas ───────────────────────────────────────────────────────────────────

/** Una polilínea con un texto que se repite a lo largo de ella (las isolíneas). */
export interface LineaRotulada {
  puntos: readonly Vec2[];
  texto: string;
}

/** Separación entre los rótulos de una misma línea, px. */
export const SEPARACION_ROTULOS = 240;
/** Prioridad de los rótulos de las isolíneas: detrás de todos los demás. */
export const PRIORIDAD_ISOLINEA = 5;

/**
 * Los rótulos de unas líneas con `escala` px/m, como en CYPECAD: repartidos a lo largo de cada
 * línea, uno por cada SEPARACION_ROTULOS px (al desplazar la vista no se mueven), centrados en ella,
 * girados con ella y derechos, con fondo para que la corten. Sólo donde la línea es casi
 * recta a lo largo del texto (si no, se prueba un poco antes o después); una línea más corta que
 * 3 veces su texto no se rotula. Con `ventana` (m), sólo los que caen en ella. `medir` da el ancho
 * de un texto en px.
 */
export function rotulosLineas(lineas: readonly LineaRotulada[], escala: number, medir: (texto: string, tamano: number) => number, ventana?: readonly [number, number, number, number]): Texto[] {
  const tam = TEXTO_MINIMO;
  const r: Texto[] = [];
  if (!(escala > 0)) return r;
  for (const { puntos: p, texto } of lineas) {
    if (p.length < 2) continue;
    // Longitudes acumuladas, m
    const s: number[] = [0];
    for (let i = 1; i < p.length; i++) s.push(s[i - 1]! + Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]));
    const total = s[s.length - 1]!;
    const w = (medir(texto, tam) + 8) / escala;
    if (total < 3 * w) continue;
    // El primer índice i ≥ 1 con s[i] ≥ x (o el último)
    const tras = (x: number): number => {
      let [a, b] = [1, p.length - 1];
      while (a < b) {
        const m = (a + b) >> 1;
        if (s[m]! < x) a = m + 1;
        else b = m;
      }
      return a;
    };
    const en = (x: number): Vec2 => {
      const i = tras(x);
      const l = s[i]! - s[i - 1]!;
      const t = l > 0 ? Math.max(0, Math.min(1, (x - s[i - 1]!) / l)) : 0;
      return [p[i - 1]![0] + t * (p[i]![0] - p[i - 1]![0]), p[i - 1]![1] + t * (p[i]![1] - p[i - 1]![1])];
    };
    // Recta a lo largo del texto: ningún punto de la línea entre sus extremos se separa de la cuerda más de un tercio de su altura
    const recta = (x: number): { q: Vec2; giro: number } | null => {
      const [x0, x1] = [x - w / 2, x + w / 2];
      if (x0 < 0 || x1 > total) return null;
      const [a, b] = [en(x0), en(x1)];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < 0.8 * w) return null;
      const tol = (0.35 * tam) / escala;
      for (let i = tras(x0); i < p.length && s[i]! < x1; i++) {
        if (s[i]! <= x0) continue;
        const c = p[i]!;
        if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / d > tol) return null;
      }
      // Derecho: en (−80°, 100°], así que los de las líneas casi verticales se leen todos de abajo arriba
      let giro = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (giro > 100) giro -= 180;
      else if (giro <= -80) giro += 180;
      return { q: en(x), giro: Math.round(giro * 10) / 10 };
    };
    const paso = SEPARACION_ROTULOS / escala;
    const n = Math.max(1, Math.floor(total / paso));
    const sep = total / n;
    for (let k = 0; k < n; k++) {
      const x = (k + 0.5) * sep;
      let hallado: { q: Vec2; giro: number } | null = null;
      for (const dx of [0, -0.5, 0.5, -1, 1, -1.5, 1.5]) if ((hallado = recta(x + dx * w))) break;
      if (!hallado) continue;
      const { q, giro } = hallado;
      if (ventana && (q[0] < ventana[0] || q[0] > ventana[2] || q[1] < ventana[1] || q[1] > ventana[3])) continue;
      r.push({ tipo: "texto", p: q, texto, tamano: tam, ancla: "medio", dy: Math.round(0.28 * tam * 10) / 10, giro, prioridad: PRIORIDAD_ISOLINEA, fondo: true, clase: "dato" });
    }
  }
  return r;
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
 *
 * Con bandas fuera de la escala (`fuera`: la primera, la última), éstas llevan el color más oscuro
 * de su signo y las de dentro se reparten hasta el 80 % de la rampa, para que no se confundan.
 */
export function coloresBandas(L: readonly number[], fuera: { abajo?: boolean; arriba?: boolean } = {}): string[] {
  const nb = L.length - 1;
  const [i0, i1] = [fuera.abajo ? 1 : 0, fuera.arriba ? nb - 1 : nb];
  const m = Math.max(Math.abs(L[i0]!), Math.abs(L[i1]!)) || 1;
  const f = fuera.abajo || fuera.arriba ? 0.8 : 1;
  return L.slice(0, -1).map((l, i) => {
    const h = L[i + 1]!;
    const positiva = l + h >= 0;
    if (i < i0 || i >= i1) return enRampa(positiva ? ROJOS : AZULES, 1);
    const exterior = positiva ? h : -l;
    return enRampa(positiva ? ROJOS : AZULES, (f * exterior) / m);
  });
}
