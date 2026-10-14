/**
 * El 3D sólido del modelo físico (I3, `docs/fem3d/interfaz.md` §6 y §16): cada pieza con su sección
 * extruida, como caras planas convexas con la normal hacia fuera, sus aristas y el objeto físico de
 * cada triángulo.
 *
 * Convenio de cotas, el del alzado de I2: la cota de una planta es la cara superior de su forjado.
 * - Losa: su región (contorno menos huecos) de c − e a c. Un reticular, la capa de compresión, los
 *   ábacos y los nervios en las dos direcciones a su intereje (su sitio es ilustrativo: el cálculo
 *   usa multiplicadores, D3), con los de la segunda dirección partidos en los cruces.
 * - Paño: sus viguetas, las del compilador (C4-a), con su sección y la cara superior en c, y macizo
 *   del canto de la vigueta lo que no cae en la banda de un intereje de ninguna (junto a una viga
 *   o un muro paralelos, donde el compilador no pone vigueta, o el sobrante del ancho). Sin
 *   compilar, una placa del canto de la vigueta (y una nota).
 * - Viga: su sección a lo largo de cada tramo, con la cara superior en c y los tramos rectos unidos
 *   a inglete. Bajo una losa o un paño se dibuja sólo lo que queda bajo su cara inferior (C2-g): las
 *   rectangulares, por la parte de su huella que cubre la losa (como el peso de A3); las demás, por
 *   su eje.
 * - Pilar: la huella de su sección (la de cada tramo, con su giro) de la cota de su base a la de su
 *   cabeza, menos lo que ocupa la losa o el paño de su cabeza (por su huella).
 * - Muro: el eje con su espesor (a inglete en los quiebros), de forjado a forjado, sin sus huecos y
 *   menos la losa de la cabeza de cada tramo.
 * - Apoyo: un símbolo (una pirámide invertida de 0,3 m), no una zapata.
 *
 * Las secciones se dibujan con su área: la circular, como un polígono de 32 lados de la misma área;
 * el perfil en I, con el alma ensanchada para que dé el A del catálogo (sin los acuerdos). Una
 * `general` con b y h es un rectángulo b×h; sin ellos, una barra fina de 5 cm marcada «sin forma».
 *
 * Cómo: cada prisma vertical sale de una descomposición en trapecios de su huella con las regiones
 * de las losas de la planta como capas (`descomponer`), y cada celda lleva sus intervalos de cota;
 * las paredes entre celdas son la diferencia de sus intervalos. Así la superficie es cerrada, sin
 * caras dentro (salvo donde se tocan prismas distintos de un reticular) y su volumen es exacto. Las
 * aristas son las de la unión de las caras de cada pieza: los bordes de cada plano que no cubre otra
 * cara del mismo plano, menos los quiebros de menos de 30° (los lados de un círculo).
 *
 * Coordenadas en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../compilador/cotas.ts";
import type { Mapeo } from "../compilador/mapeo.ts";
import { puntoEnPoligono, puntoEnRegion, trozosSegmento } from "../compilador/poligonos.ts";
import type { Material, ModeloFisico, Seccion, Vec2 } from "../compilador/fisico.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";

export type Vec3 = [number, number, number];

/** Cara plana y convexa, con sus vértices en sentido antihorario visto desde fuera. */
export interface Cara {
  p: Vec3[];
}

export const TIPOS_SOLIDO = ["pilar", "viga", "losa", "pano", "muro", "apoyo"] as const;
export type TipoSolido = (typeof TIPOS_SOLIDO)[number];
export type MaterialSolido = Material["tipo"];

/** Una pieza física en una planta (un tramo de pilar o de muro, la de su cabeza). */
export interface PiezaSolida {
  id: string;
  tipo: TipoSolido;
  /** Índice de la planta. */
  planta: number;
  material: MaterialSolido | null;
  seccion: string | null;
  caras: Cara[];
  /** Sección sin forma conocida (una `general` sin b ni h): dibujada como barra fina. */
  sinForma?: true;
  /**
   * Líneas que se dibujan con las aristas sin serlo: en la cara superior de un reticular, los ejes de
   * sus nervios y el contorno de sus ábacos, que desde arriba quedan bajo la capa (como las rayas de
   * las viguetas de un paño). No son geometría: no cuentan en el volumen.
   */
  marcas?: [Vec3, Vec3][];
}

/** Lo que el sólido necesita de la compilación: las viguetas de los paños. */
export type CompiladoSolido = { modelo: Pick<ModeloAnalitico, "nudos" | "barras">; mapeo: Pick<Mapeo, "panos" | "piezas"> };

export interface Solido {
  origen: [number, number, number];
  /** x, y, z de los tres vértices de cada triángulo, respecto al origen, en sentido antihorario visto desde fuera. */
  triangulos: Float32Array;
  /** Índice en `objetos` y planta de cada triángulo. */
  objeto: Uint32Array;
  planta: Uint16Array;
  /** Las aristas (dos extremos), con su objeto y su planta. */
  aristas: Float32Array;
  objetoArista: Uint32Array;
  plantaArista: Uint16Array;
  objetos: { id: string; tipo: TipoSolido; material: MaterialSolido | null; seccion: string | null }[];
  plantas: string[];
  /** Caja de lo dibujado, en coordenadas del modelo: [xmin, ymin, zmin, xmax, ymax, zmax]. */
  caja: [number, number, number, number, number, number];
  notas: string[];
}

/** Lados del polígono de una sección circular. */
export const LADOS_CIRCULO = 32;
/** Lado de la barra fina de una sección sin forma, m. */
export const LADO_SIN_FORMA = 0.05;
/** Un quiebro de menos de este ángulo entre dos caras no es arista (los lados de un círculo). */
const SENO_SUAVE = Math.cos((30 * Math.PI) / 180);
const EPS = 1e-9;

// ─── Intervalos de cota ─────────────────────────────────────────────────────────────────────────

type Iv = [number, number][];

function normalizarIv(iv: Iv): Iv {
  const a = iv.filter(([x, y]) => y - x > EPS).sort((p, q) => p[0] - q[0]);
  const r: Iv = [];
  for (const [x, y] of a) {
    const u = r[r.length - 1];
    if (u && x <= u[1] + EPS) u[1] = Math.max(u[1], y);
    else r.push([x, y]);
  }
  return r;
}

function restarIv(a: Iv, b: Iv): Iv {
  let r = a.map((x) => [...x] as [number, number]);
  for (const [b0, b1] of b) {
    const s: Iv = [];
    for (const [x, y] of r) {
      if (b1 <= x + EPS || b0 >= y - EPS) s.push([x, y]);
      else {
        if (b0 > x + EPS) s.push([x, b0]);
        if (b1 < y - EPS) s.push([b1, y]);
      }
    }
    r = s;
  }
  return r;
}

// ─── Descomposición en trapecios ────────────────────────────────────────────────────────────────

/** Una franja de una columna: entre dos aristas, con sus y en los dos lados (inferior, superior). */
export interface Franja {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  /** Dentro de la huella P (par-impar). */
  enP: boolean;
  /** Dentro de cada capa (par-impar). */
  capas: boolean[];
}

export interface Columna {
  xa: number;
  xb: number;
  /** Las franjas no degeneradas, de abajo arriba. */
  franjas: Franja[];
}

interface AristaL {
  xl: number;
  yl: number;
  xr: number;
  yr: number;
  capa: number;
}

const yEn = (e: AristaL, x: number): number => (x <= e.xl ? e.yl : x >= e.xr ? e.yr : e.yl + ((x - e.xl) * (e.yr - e.yl)) / (e.xr - e.xl));

/**
 * Descompone la huella P (anillos, par-impar) en trapecios, en el sistema (x, y) con x según `d`
 * (unitario) e y a su izquierda: columnas entre las abscisas de los vértices de P y de las capas,
 * de sus cruces y de los `cortes`; en cada una, las franjas entre aristas, con si están dentro de P
 * y de cada capa. Sirve igual para un polígono no convexo y para una región con huecos.
 */
export function descomponer(P: readonly (readonly Vec2[])[], capas: readonly (readonly (readonly Vec2[])[])[], d: Vec2, cortes: readonly number[] = []): Columna[] {
  const n: Vec2 = [-d[1], d[0]];
  const loc = (p: Vec2): Vec2 => [p[0] * d[0] + p[1] * d[1], p[0] * n[0] + p[1] * n[1]];
  const aristas: AristaL[] = [];
  const caja = [Infinity, Infinity, -Infinity, -Infinity];
  const poner = (anillos: readonly (readonly Vec2[])[], capa: number) => {
    for (const r of anillos) {
      const q = r.map(loc);
      for (let i = 0; i < q.length; i++) {
        const [a, b] = [q[i]!, q[(i + 1) % q.length]!];
        if (Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS) continue;
        const [l, r2] = a[0] <= b[0] ? [a, b] : [b, a];
        aristas.push({ xl: l[0], yl: l[1], xr: r2[0], yr: r2[1], capa });
        if (capa < 0) {
          caja[0] = Math.min(caja[0]!, l[0]);
          caja[2] = Math.max(caja[2]!, r2[0]);
          caja[1] = Math.min(caja[1]!, l[1], r2[1]);
          caja[3] = Math.max(caja[3]!, l[1], r2[1]);
        }
      }
    }
  };
  poner(P, -1);
  if (!Number.isFinite(caja[0])) return [];
  const [xmin, xmax] = [caja[0]!, caja[2]!];
  capas.forEach((c, k) => poner(c, k));
  // Sólo las aristas de las capas que pasan por las abscisas de P (también las de debajo: cuentan para la paridad)
  const utiles = aristas.filter((e) => e.capa < 0 || (e.xr >= xmin - EPS && e.xl <= xmax + EPS));
  const xs: number[] = [xmin, xmax];
  for (const e of utiles) for (const x of [e.xl, e.xr]) if (x > xmin && x < xmax) xs.push(x);
  for (const x of cortes) if (x > xmin && x < xmax) xs.push(x);
  // Cruces entre aristas: por orden de su menor y en las abscisas de P, sólo las que se solapan en y
  const rango = utiles.map((e) => {
    const [x0, x1] = [Math.max(e.xl, xmin), Math.min(e.xr, xmax)];
    const [y0, y1] = [yEn(e, x0), yEn(e, x1)];
    return { e, lo: Math.min(y0, y1) - EPS, hi: Math.max(y0, y1) + EPS };
  });
  rango.sort((a, b) => a.lo - b.lo);
  for (let i = 0; i < rango.length; i++) {
    const { e: a, hi } = rango[i]!;
    for (let j = i + 1; j < rango.length && rango[j]!.lo <= hi; j++) {
      const b = rango[j]!.e;
      if (a.capa === b.capa && a.capa < 0) continue;
      if (b.xl > a.xr || a.xl > b.xr) continue;
      const [rx, ry, sx, sy] = [a.xr - a.xl, a.yr - a.yl, b.xr - b.xl, b.yr - b.yl];
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-14) continue;
      const [qx, qy] = [b.xl - a.xl, b.yl - a.yl];
      const t = (qx * sy - qy * sx) / den;
      const u = (qx * ry - qy * rx) / den;
      if (t <= 0 || t >= 1 || u < 0 || u > 1) continue;
      const x = a.xl + t * rx;
      if (x > xmin && x < xmax) xs.push(x);
    }
  }
  xs.sort((p, q) => p - q);
  const cols: number[] = [];
  for (const x of xs) if (!cols.length || x - cols[cols.length - 1]! > EPS) cols.push(x);
  const r: Columna[] = [];
  for (let c = 1; c < cols.length; c++) {
    const [xa, xb] = [cols[c - 1]!, cols[c]!];
    const xm = (xa + xb) / 2;
    const en = utiles.filter((e) => e.xl < xm && e.xr > xm);
    const ys = en.map((e) => ({ e, a: yEn(e, xa), b: yEn(e, xb), m: yEn(e, xm) })).sort((p, q) => p.m - q.m || p.a - q.a || p.b - q.b);
    let enP = false;
    const dentro = capas.map(() => false);
    const franjas: Franja[] = [];
    for (let i = 0; i < ys.length - 1; i++) {
      const e = ys[i]!.e;
      if (e.capa < 0) enP = !enP;
      else dentro[e.capa] = !dentro[e.capa];
      const [lo, hi] = [ys[i]!, ys[i + 1]!];
      if (hi.a - lo.a <= EPS && hi.b - lo.b <= EPS) continue;
      franjas.push({ a0: lo.a, a1: hi.a, b0: lo.b, b1: hi.b, enP, capas: [...dentro] });
    }
    r.push({ xa, xb, franjas });
  }
  return r;
}

/**
 * Las caras de los prismas verticales de una descomposición: cada franja de P con sus intervalos de
 * cota (`iv`); tapas arriba y abajo de cada intervalo y paredes donde el vecino no tiene esa cota.
 */
export function prismas(cols: readonly Columna[], d: Vec2, iv: (f: Franja, col: Columna) => Iv, caras: Cara[]): void {
  const n: Vec2 = [-d[1], d[0]];
  const g = (x: number, y: number, z: number): Vec3 => [x * d[0] + y * n[0], x * d[1] + y * n[1], z];
  const pared = (ax: number, ay: number, bx: number, by: number, I: Iv) => {
    if (Math.abs(ax - bx) <= EPS && Math.abs(ay - by) <= EPS) return;
    for (const [z0, z1] of I) caras.push({ p: [g(ax, ay, z0), g(bx, by, z0), g(bx, by, z1), g(ax, ay, z1)] });
  };
  let previa: { col: Columna; ivs: Iv[] } | null = null;
  const lateral = (x: number, L: { col: Columna; ivs: Iv[] } | null, R: { col: Columna; ivs: Iv[] } | null) => {
    const ys: number[] = [];
    L?.col.franjas.forEach((f, j) => L.ivs[j]!.length && ys.push(f.b0, f.b1));
    R?.col.franjas.forEach((f, j) => R.ivs[j]!.length && ys.push(f.a0, f.a1));
    ys.sort((p, q) => p - q);
    const u: number[] = [];
    for (const y of ys) if (!u.length || y - u[u.length - 1]! > EPS) u.push(y);
    const buscar = (s: { col: Columna; ivs: Iv[] } | null, m: number, lado: "a" | "b"): Iv => {
      if (!s) return [];
      const j = s.col.franjas.findIndex((f) => (lado === "a" ? f.a0 <= m && m <= f.a1 : f.b0 <= m && m <= f.b1));
      return j < 0 ? [] : s.ivs[j]!;
    };
    for (let k = 1; k < u.length; k++) {
      const [y0, y1] = [u[k - 1]!, u[k]!];
      const m = (y0 + y1) / 2;
      const [il, ir] = [buscar(L, m, "b"), buscar(R, m, "a")];
      pared(x, y0, x, y1, restarIv(il, ir));
      pared(x, y1, x, y0, restarIv(ir, il));
    }
  };
  for (const col of cols) {
    const ivs = col.franjas.map((f) => (f.enP ? normalizarIv(iv(f, col)) : []));
    const { xa, xb } = col;
    col.franjas.forEach((f, j) => {
      const I = ivs[j]!;
      if (!I.length) return;
      const plano: [number, number][] = [[xa, f.a0], [xb, f.b0]];
      if (f.b1 - f.b0 > EPS) plano.push([xb, f.b1]);
      if (f.a1 - f.a0 > EPS) plano.push([xa, f.a1]);
      if (plano.length >= 3)
        for (const [z0, z1] of I) {
          caras.push({ p: plano.map(([x, y]) => g(x, y, z1)) });
          caras.push({ p: plano.map(([x, y]) => g(x, y, z0)).reverse() });
        }
      // Paredes con la franja de debajo y la de encima (o el vacío)
      pared(xa, f.a0, xb, f.b0, restarIv(I, j > 0 ? ivs[j - 1]! : []));
      pared(xb, f.b1, xa, f.a1, restarIv(I, j < ivs.length - 1 ? ivs[j + 1]! : []));
    });
    const actual = { col, ivs };
    lateral(xa, previa && Math.abs(previa.col.xb - xa) <= EPS ? previa : null, actual);
    if (previa && Math.abs(previa.col.xb - xa) > EPS) lateral(previa.col.xb, previa, null);
    previa = actual;
  }
  if (previa) lateral(previa.col.xb, previa, null);
}

// ─── Secciones ──────────────────────────────────────────────────────────────────────────────────

/**
 * Polígono de una sección (antihorario) en (v, u): v según el ancho b, u según el canto h, con su
 * caja centrada en el origen. Con el área de la sección (cabecera); null si no se puede dibujar.
 */
export function formaSeccion(s: Seccion): { poligono: Vec2[]; h: number; b: number; sinForma: boolean } | null {
  const rect = (b: number, h: number): Vec2[] => [
    [-b / 2, -h / 2],
    [b / 2, -h / 2],
    [b / 2, h / 2],
    [-b / 2, h / 2],
  ];
  switch (s.forma) {
    case "rectangular":
      return s.b > 0 && s.h > 0 ? { poligono: rect(s.b, s.h), h: s.h, b: s.b, sinForma: false } : null;
    case "circular": {
      if (!(s.D > 0)) return null;
      const n = LADOS_CIRCULO;
      const r = (s.D / 2) * Math.sqrt(Math.PI / ((n / 2) * Math.sin((2 * Math.PI) / n)));
      return { poligono: Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Vec2), h: s.D, b: s.D, sinForma: false };
    }
    case "I": {
      const [h, b, tf] = [s.perfil.h * 1e-3, s.perfil.b * 1e-3, s.perfil.tf * 1e-3];
      if (!(h > 2 * tf && b > 0 && tf > 0)) return null;
      // El alma que da el área del catálogo (sin acuerdos)
      const twA = (s.perfil.A * 1e-4 - 2 * b * tf) / (h - 2 * tf);
      const tw = twA > 0 && twA <= b ? twA : s.perfil.tw * 1e-3;
      const [B, H, w] = [b / 2, h / 2, tw / 2];
      return {
        poligono: [
          [-B, -H],
          [B, -H],
          [B, -H + tf],
          [w, -H + tf],
          [w, H - tf],
          [B, H - tf],
          [B, H],
          [-B, H],
          [-B, H - tf],
          [-w, H - tf],
          [-w, -H + tf],
          [-B, -H + tf],
        ],
        h,
        b,
        sinForma: false,
      };
    }
    case "T": {
      const { bf, hf, bw, h } = s;
      if (!(bf > 0 && hf > 0 && bw > 0 && h > hf)) return null;
      const H = h / 2;
      return {
        poligono: [
          [-bw / 2, -H],
          [bw / 2, -H],
          [bw / 2, H - hf],
          [bf / 2, H - hf],
          [bf / 2, H],
          [-bf / 2, H],
          [-bf / 2, H - hf],
          [-bw / 2, H - hf],
        ],
        h,
        b: bf,
        sinForma: false,
      };
    }
    case "general":
      if (s.b !== undefined && s.h !== undefined && s.b > 0 && s.h > 0) return { poligono: rect(s.b, s.h), h: s.h, b: s.b, sinForma: false };
      return { poligono: rect(LADO_SIN_FORMA, LADO_SIN_FORMA), h: LADO_SIN_FORMA, b: LADO_SIN_FORMA, sinForma: true };
  }
}

/** Una sección con forma de prisma en planta (rectangular o general con b y h, o sin forma). */
const esRectangular = (s: Seccion) => s.forma === "rectangular" || s.forma === "general";

/** Recorta un polígono a la banda u ∈ [u0, u1] (Sutherland–Hodgman con dos semiplanos). */
export function recortarBanda(S: readonly Vec2[], u0: number, u1: number): Vec2[] {
  const corte = (P: Vec2[], dentro: (q: Vec2) => boolean, u: number): Vec2[] => {
    const r: Vec2[] = [];
    for (let i = 0; i < P.length; i++) {
      const [a, b] = [P[i]!, P[(i + 1) % P.length]!];
      const [ia, ib] = [dentro(a), dentro(b)];
      if (ia) r.push(a);
      if (ia !== ib) {
        const t = (u - a[1]) / (b[1] - a[1]);
        r.push([a[0] + t * (b[0] - a[0]), u]);
      }
    }
    return r;
  };
  let P = corte([...S], (q) => q[1] >= u0, u0);
  if (P.length >= 3) P = corte(P, (q) => q[1] <= u1, u1);
  return P.length >= 3 ? P : [];
}

const areaConSigno = (p: readonly Vec2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * a[1], 0) / 2;

/**
 * Las caras de una barra horizontal de sección S (antihoraria en (v, u), con u ≤ 0 y la cara
 * superior en u = 0) a lo largo de A + s·d, s ∈ [0, L], a la cota zc: por tramos de s, cada uno con
 * la sección recortada a u ≤ techo (0 entero); tapas en los extremos y donde cambia el techo.
 */
function barrido(S: readonly Vec2[], A: Vec2, d: Vec2, zc: number, tramos: readonly { s0: number; s1: number; techo: number }[], caras: Cara[]): void {
  const n: Vec2 = [-d[1], d[0]];
  const g = (s: number, v: number, u: number): Vec3 => [A[0] + s * d[0] + v * n[0], A[1] + s * d[1] + v * n[1], zc + u];
  const tapa = (s: number, Q: Vec2[], fuera: boolean) => {
    if (Q.length < 3 || Math.abs(areaConSigno(Q)) <= EPS * EPS) return;
    for (const col of descomponer([Q], [], [1, 0]))
      for (const f of col.franjas) {
        if (!f.enP) continue;
        const pl: Vec2[] = [[col.xa, f.a0], [col.xb, f.b0]];
        if (f.b1 - f.b0 > EPS) pl.push([col.xb, f.b1]);
        if (f.a1 - f.a0 > EPS) pl.push([col.xa, f.a1]);
        if (pl.length < 3) continue;
        const p = pl.map(([v, u]) => g(s, v, u));
        caras.push({ p: fuera ? p : p.reverse() });
      }
  };
  const vivos = tramos.filter((t) => t.s1 - t.s0 > EPS);
  vivos.forEach((t, i) => {
    const Q = t.techo >= 0 ? [...S] : recortarBanda(S, -Infinity, t.techo);
    if (Q.length >= 3)
      for (let k = 0; k < Q.length; k++) {
        const [p, q] = [Q[k]!, Q[(k + 1) % Q.length]!];
        if (Math.abs(p[0] - q[0]) <= EPS && Math.abs(p[1] - q[1]) <= EPS) continue;
        caras.push({ p: [g(t.s0, p[0], p[1]), g(t.s0, q[0], q[1]), g(t.s1, q[0], q[1]), g(t.s1, p[0], p[1])] });
      }
    // Tapas: lo de este tramo que no tiene el de al lado (las secciones son S hasta su techo)
    const tA = i > 0 ? vivos[i - 1]!.techo : -Infinity;
    const tB = i < vivos.length - 1 ? vivos[i + 1]!.techo : -Infinity;
    if (t.techo > tA) tapa(t.s0, recortarBanda(S, tA, Math.min(0, t.techo)), false);
    if (t.techo > tB) tapa(t.s1, recortarBanda(S, tB, Math.min(0, t.techo)), true);
  });
}

// ─── Geometría en planta ────────────────────────────────────────────────────────────────────────

export type Tramo = { A: Vec2; B: Vec2; L: number; d: Vec2; s0: number };

export function tramosDe(p: readonly Vec2[]): Tramo[] {
  const r: Tramo[] = [];
  let s = 0;
  for (let i = 1; i < p.length; i++) {
    const [A, B] = [p[i - 1]!, p[i]!];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L > EPS) r.push({ A, B, L, d: [(B[0] - A[0]) / L, (B[1] - A[1]) / L], s0: s });
    s += L;
  }
  return r;
}

/**
 * Huellas a inglete de los tramos de una polilínea de ancho b: en cada quiebro, la bisectriz (si
 * el giro es de menos de 120°; si no, a escuadra). El área de cada una es b·L. Un muro cerrado
 * (el último punto, el primero) se une también en ese punto.
 */
export function huellasInglete(t: readonly Tramo[], b: number, cerrada: boolean): Vec2[][] {
  const w = b / 2;
  const nor = (d: Vec2): Vec2 => [-d[1], d[0]];
  const inglete = (a: Tramo | undefined, c: Tramo): Vec2 => {
    const nc = nor(c.d);
    if (!a) return nc;
    const na = nor(a.d);
    const m: Vec2 = [na[0] + nc[0], na[1] + nc[1]];
    const l = Math.hypot(m[0], m[1]);
    // Un giro de más de 120° (o vuelta atrás): a escuadra
    if (l < 1 || a.d[0] * c.d[0] + a.d[1] * c.d[1] < -0.5) return nc;
    const u: Vec2 = [m[0] / l, m[1] / l];
    const k = u[0] * nc[0] + u[1] * nc[1];
    return [u[0] / k, u[1] / k];
  };
  return t.map((c, i) => {
    const prev = i > 0 ? t[i - 1] : cerrada ? t[t.length - 1] : undefined;
    const next = i < t.length - 1 ? t[i + 1] : cerrada ? t[0] : undefined;
    const mA = inglete(prev, c);
    const mBraw = next ? inglete(c, next) : nor(c.d);
    // En B, el inglete se mide con la normal de c: el mismo vector sirve para los dos lados
    const ncB = nor(c.d);
    const kB = mBraw[0] * ncB[0] + mBraw[1] * ncB[1];
    const mB: Vec2 = next && kB > 0 ? [mBraw[0] / kB, mBraw[1] / kB] : ncB;
    return [
      [c.A[0] - w * mA[0], c.A[1] - w * mA[1]],
      [c.B[0] - w * mB[0], c.B[1] - w * mB[1]],
      [c.B[0] + w * mB[0], c.B[1] + w * mB[1]],
      [c.A[0] + w * mA[0], c.A[1] + w * mA[1]],
    ] as Vec2[];
  });
}

/** Lo que tapa una pieza en una planta: losas y paños, con su región y lo que ocupan bajo la cota. */
interface Tapa {
  id: string;
  anillos: Vec2[][];
  e: number;
}

function cajaAnillos(an: readonly (readonly Vec2[])[]): [number, number, number, number] {
  const c: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of an)
    for (const q of r) {
      c[0] = Math.min(c[0], q[0]);
      c[1] = Math.min(c[1], q[1]);
      c[2] = Math.max(c[2], q[0]);
      c[3] = Math.max(c[3], q[1]);
    }
  return c;
}
const tocan = (a: readonly number[], b: readonly number[]) => a[0]! <= b[2]! + EPS && b[0]! <= a[2]! + EPS && a[1]! <= b[3]! + EPS && b[1]! <= a[3]! + EPS;

/** Cos y sen de un ángulo en grados, exactos en los múltiplos de 90°. */
function cosSen(grados: number): Vec2 {
  const g = ((grados % 360) + 360) % 360;
  const q = g / 90;
  return Number.isInteger(q) ? (([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[q] as Vec2) : [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
}

/** ¿Está q dentro de los anillos (par-impar)? */
function dentroAnillos(q: Vec2, an: readonly (readonly Vec2[])[]): boolean {
  let c = false;
  for (const p of an)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [a, b] = [p[i]!, p[j]!];
      if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
  return c;
}

/**
 * La huella en planta de un pilar con el polígono de su sección: el canto h según ez (girado `giro`
 * desde +X) y el ancho b según ey = ez × X (cabecera de `fisico.ts`).
 */
export function huellaPilarSolido(p: { x: number; y: number; giro?: number }, poligono: readonly Vec2[]): Vec2[] {
  const [c, s] = cosSen(p.giro ?? 0);
  const ez: Vec2 = [c, s];
  const ey: Vec2 = [s, -c];
  return poligono.map(([v, u]) => [p.x + v * ey[0] + u * ez[0], p.y + v * ey[1] + u * ez[1]] as Vec2);
}

// ─── Piezas ─────────────────────────────────────────────────────────────────────────────────────

const porId = <T extends { id: string }>(xs: readonly T[] | undefined): T[] => [...(xs ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** El canto de las viguetas de un paño (el de su sección), o null. */
function cantoPano(f: ModeloFisico, seccion: string): number | null {
  const s = f.secciones.find((x) => x.id === seccion);
  const fs = s ? formaSeccion(s) : null;
  return fs && !fs.sinForma ? fs.h : null;
}

/**
 * Las piezas del sólido, con sus caras en coordenadas del modelo (Float64). Con `compilado`, los
 * paños con sus viguetas; sin él, como placas.
 */
export function piezasSolido(f: ModeloFisico, compilado?: CompiladoSolido | null): { piezas: PiezaSolida[]; notas: string[] } {
  const plantas = (f.plantas ?? []).map((p) => p.id);
  const indice = new Map(plantas.map((p, i) => [p, i]));
  const cotas = cotasPlantas(f.plantas ?? []);
  const cota = (k: number | undefined) => (k === undefined ? null : (cotas[k] ?? null));
  const seccion = new Map(f.secciones.map((s) => [s.id, s]));
  const material = new Map(f.materiales.map((m) => [m.id, m]));
  const matSec = (id: string): MaterialSolido | null => material.get(seccion.get(id)?.material ?? "")?.tipo ?? null;
  const piezas: PiezaSolida[] = [];
  const notas: string[] = [];
  const sinForma = new Set<string>();

  // Lo que tapa cada planta
  const tapas = new Map<number, Tapa[]>();
  for (const l of porId(f.losas)) {
    const k = indice.get(l.planta);
    if (k === undefined || !(l.espesor > 0)) continue;
    tapas.set(k, [...(tapas.get(k) ?? []), { id: l.id, anillos: [l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])], e: l.espesor }]);
  }
  for (const p of porId(f.panos)) {
    const k = indice.get(p.planta);
    const e = cantoPano(f, p.seccion);
    if (k === undefined || e === null) continue;
    tapas.set(k, [...(tapas.get(k) ?? []), { id: p.id, anillos: [p.contorno as Vec2[], ...((p.huecos ?? []) as Vec2[][])], e }]);
  }
  const tapasCerca = (k: number, an: readonly (readonly Vec2[])[]): Tapa[] => {
    const c = cajaAnillos(an);
    return (tapas.get(k) ?? []).filter((t) => tocan(cajaAnillos(t.anillos), c));
  };
  /** La primera tapa en la que está una franja (las losas no se solapan). */
  const tapaDe = (ts: readonly Tapa[], fr: Franja): Tapa | null => {
    const i = fr.capas.findIndex((x) => x);
    return i < 0 ? null : ts[i]!;
  };
  /** Tramos de un vertical: [k de la cabeza, cota de la base, cota de la cabeza]. */
  const tramosVertical = (desde: string, hasta: string): [number, number, number][] => {
    const [a, b] = [indice.get(desde), indice.get(hasta)];
    if (a === undefined || b === undefined || b >= a) return [];
    const r: [number, number, number][] = [];
    for (let k = b; k < a; k++) {
      const [z0, z1] = [cota(k + 1), cota(k)];
      if (z0 !== null && z1 !== null) r.push([k, z0, z1]);
    }
    return r;
  };

  // Pilares: la huella de cada tramo, de la cota de su base a la de su cabeza menos su losa
  for (const p of porId(f.pilares)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const ez = cosSen(p.giro ?? 0);
    for (const [k, z0, z1] of tramosVertical(p.desde, p.hasta)) {
      const sid = p.tramos?.find((t) => t.planta === plantas[k])?.seccion ?? p.seccion;
      const sec = seccion.get(sid);
      const fs = sec ? formaSeccion(sec) : null;
      if (!fs) continue;
      if (fs.sinForma) sinForma.add(p.id);
      const huella = huellaPilarSolido(p, fs.poligono);
      const ts = tapasCerca(k, [huella]);
      const caras: Cara[] = [];
      prismas(
        descomponer([huella], ts.map((t) => t.anillos), ez),
        ez,
        (fr) => {
          const t = tapaDe(ts, fr);
          return [[z0, t ? z1 - t.e : z1]];
        },
        caras,
      );
      piezas.push({ id: p.id, tipo: "pilar", planta: k, material: matSec(sid), seccion: sid, caras, ...(fs.sinForma ? { sinForma: true as const } : {}) });
    }
  }

  // Vigas: con la cara superior en la cota; bajo una losa o un paño, sólo lo que queda debajo
  for (const v of porId(f.vigas)) {
    const k = indice.get(v.planta);
    const zc = cota(k);
    const sec = seccion.get(v.seccion);
    const fs = sec ? formaSeccion(sec) : null;
    if (k === undefined || zc === null || !sec || !fs) continue;
    if (fs.sinForma) sinForma.add(v.id);
    const tr = tramosDe(v.puntos);
    const caras: Cara[] = [];
    const S = fs.poligono.map(([x, u]) => [x, u - fs.h / 2] as Vec2);
    if (esRectangular(sec)) {
      const hs = huellasInglete(tr, fs.b, false);
      tr.forEach((t, i) => {
        const ts = tapasCerca(k, [hs[i]!]);
        prismas(
          descomponer([hs[i]!], ts.map((x) => x.anillos), t.d),
          t.d,
          (fr) => {
            const x = tapaDe(ts, fr);
            return [[zc - fs.h, x ? zc - x.e : zc]];
          },
          caras,
        );
      });
    } else
      for (const t of tr) {
        // Por el eje: los cruces con los bordes de lo que tapa la planta
        const ts = tapasCerca(k, [[t.A, t.B]]);
        const ss = [0, t.L];
        for (const x of ts)
          for (const r of x.anillos)
            for (let i = 0; i < r.length; i++) {
              const [a, b] = [r[i]!, r[(i + 1) % r.length]!];
              const [rx, ry, sx, sy] = [t.B[0] - t.A[0], t.B[1] - t.A[1], b[0] - a[0], b[1] - a[1]];
              const den = rx * sy - ry * sx;
              if (Math.abs(den) < 1e-14) continue;
              const [qx, qy] = [a[0] - t.A[0], a[1] - t.A[1]];
              const tt = (qx * sy - qy * sx) / den;
              const uu = (qx * ry - qy * rx) / den;
              if (tt > 0 && tt < 1 && uu >= 0 && uu <= 1) ss.push(tt * t.L);
            }
        ss.sort((p, q) => p - q);
        const tramos: { s0: number; s1: number; techo: number }[] = [];
        for (let i = 1; i < ss.length; i++) {
          const [s0, s1] = [ss[i - 1]!, ss[i]!];
          if (s1 - s0 <= EPS) continue;
          const m = (s0 + s1) / 2;
          const q: Vec2 = [t.A[0] + m * t.d[0], t.A[1] + m * t.d[1]];
          const x = ts.find((y) => dentroAnillos(q, y.anillos));
          const techo = x ? -x.e : 0;
          const u = tramos[tramos.length - 1];
          if (u && u.techo === techo) u.s1 = s1;
          else tramos.push({ s0, s1, techo });
        }
        barrido(S, t.A, t.d, zc, tramos, caras);
      }
    piezas.push({ id: v.id, tipo: "viga", planta: k, material: matSec(v.seccion), seccion: v.seccion, caras, ...(fs.sinForma ? { sinForma: true as const } : {}) });
  }

  // Losas: maciza o reticular
  for (const l of porId(f.losas)) {
    const k = indice.get(l.planta);
    const zc = cota(k);
    if (k === undefined || zc === null || !(l.espesor > 0)) continue;
    const region = [l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])];
    const d = cosSen(l.eje1 ?? 0);
    const n: Vec2 = [-d[1], d[0]];
    const caras: Cara[] = [];
    const marcas: [Vec3, Vec3][] = [];
    const ret = l.reticular;
    const e = l.espesor;
    if (!ret || !(ret.capa > 0 && ret.capa < e && ret.nervio > 0 && ret.intereje > ret.nervio)) {
      prismas(descomponer(region, [], d), d, () => [[zc - e, zc]], caras);
    } else {
      const { intereje: s, nervio: bw, capa: hf } = ret;
      const abacos = (ret.abacos ?? []) as Vec2[][];
      // Capa de compresión
      prismas(descomponer(region, [], d), d, () => [[zc - hf, zc]], caras);
      // Ábacos, dentro de la losa
      for (const ab of abacos) prismas(descomponer([ab], [region], d), d, (fr) => (fr.capas[0] ? [[zc - e, zc - hf]] : []), caras);
      // Nervios: según d (y' = j·s) y según n (x' = i·s), en la losa y fuera de los ábacos
      const loc = region.flat().map((q) => [q[0] * d[0] + q[1] * d[1], q[0] * n[0] + q[1] * n[1]]);
      const [x0, x1] = [Math.min(...loc.map((q) => q[0]!)), Math.max(...loc.map((q) => q[0]!))];
      const [y0, y1] = [Math.min(...loc.map((q) => q[1]!)), Math.max(...loc.map((q) => q[1]!))];
      const g = (x: number, y: number): Vec2 => [x * d[0] + y * n[0], x * d[1] + y * n[1]];
      const franja = (a0: number, a1: number, b0: number, b1: number): Vec2[] => [g(a0, b0), g(a1, b0), g(a1, b1), g(a0, b1)];
      const dir1: Vec2[][] = [];
      for (let j = Math.ceil((y0 - bw / 2) / s); j * s - bw / 2 < y1; j++) dir1.push(franja(x0 - 1, x1 + 1, j * s - bw / 2, j * s + bw / 2));
      for (const fr1 of dir1) prismas(descomponer([fr1], [region, abacos], d), d, (fr) => (fr.capas[0] && !fr.capas[1] ? [[zc - e, zc - hf]] : []), caras);
      for (let i = Math.ceil((x0 - bw / 2) / s); i * s - bw / 2 < x1; i++) {
        const fr2 = franja(i * s - bw / 2, i * s + bw / 2, y0 - 1, y1 + 1);
        prismas(descomponer([fr2], [region, abacos, dir1], n), n, (fr) => (fr.capas[0] && !fr.capas[1] && !fr.capas[2] ? [[zc - e, zc - hf]] : []), caras);
      }
      // Marcas en la cara superior: los ejes de los nervios (en la losa y fuera de los ábacos) y el contorno de los ábacos
      const R = { contorno: l.contorno as Vec2[], huecos: (l.huecos ?? []) as Vec2[][] };
      const enLosa = (q: Vec2) => puntoEnRegion(q, R);
      const marca = (a: Vec2, b: Vec2) => marcas.push([[a[0], a[1], zc], [b[0], b[1], zc]]);
      const todos = [...region, ...abacos];
      const fuera = (q: Vec2) => enLosa(q) && !abacos.some((ab) => puntoEnPoligono(q, ab));
      for (let j = Math.ceil(y0 / s); j * s < y1; j++) for (const [a, b] of trozosSegmento(g(x0, j * s), g(x1, j * s), todos, fuera)) marca(a, b);
      for (let i = Math.ceil(x0 / s); i * s < x1; i++) for (const [a, b] of trozosSegmento(g(i * s, y0), g(i * s, y1), todos, fuera)) marca(a, b);
      for (const ab of abacos) for (let i = 0; i < ab.length; i++) for (const [a, b] of trozosSegmento(ab[i]!, ab[(i + 1) % ab.length]!, region, enLosa)) marca(a, b);
    }
    piezas.push({ id: l.id, tipo: "losa", planta: k, material: material.get(l.material)?.tipo ?? null, seccion: null, caras, ...(marcas.length ? { marcas } : {}) });
  }
  if ((f.losas ?? []).some((l) => l.reticular)) notas.push("Los nervios de los reticulares se dibujan a su intereje desde el origen de coordenadas, en la dirección de su eje 1 y la perpendicular: su sitio es ilustrativo, porque el cálculo usa multiplicadores (D3).");

  // Paños: las viguetas del compilador; sin él, una placa del canto de la vigueta
  let sinViguetas = false;
  for (const p of porId(f.panos)) {
    const k = indice.get(p.planta);
    const zc = cota(k);
    const sec = seccion.get(p.seccion);
    const fs = sec ? formaSeccion(sec) : null;
    if (k === undefined || zc === null || !fs) continue;
    const caras: Cara[] = [];
    const ids = compilado?.mapeo.panos?.[p.id];
    if (ids && compilado) {
      const S = fs.poligono.map(([x, u]) => [x, u - fs.h / 2] as Vec2);
      const nudos = compilado.modelo.nudos;
      const barras = compilado.modelo.barras ?? [];
      const bandas: Vec2[][] = [];
      for (const id of ids) {
        const bs = compilado.mapeo.piezas[id] ?? [];
        if (!bs.length) continue;
        // Su eje es el del tramo flexible (i'→j'): la que pasa por una huella de pilar cuelga de su
        // nudo con un offset rígido, y por los nudos saldría corrida hasta el centro del pilar
        const ext: Vec2[] = bs.flatMap((b) => {
          const br = barras[b]!;
          const o = [br.offsets?.i, br.offsets?.j];
          return br.nudos.map((nn, i): Vec2 => [nudos[nn]!.x + (o[i]?.[0] ?? 0), nudos[nn]!.y + (o[i]?.[1] ?? 0)]);
        });
        const pts: Vec2[] = [...ext, ...bs.flatMap((b) => barras[b]!.nudos.map((nn): Vec2 => [nudos[nn]!.x, nudos[nn]!.y]))];
        // Sus extremos: los puntos más alejados a lo largo de ella (también los nudos: llega a su apoyo)
        const [a, b] = [ext[0]!, ext[ext.length - 1]!];
        const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L0 <= EPS) continue;
        const dv: Vec2 = [(b[0] - a[0]) / L0, (b[1] - a[1]) / L0];
        const ss = pts.map((q) => (q[0] - a[0]) * dv[0] + (q[1] - a[1]) * dv[1]);
        const [s0, s1] = [Math.min(...ss), Math.max(...ss)];
        const A: Vec2 = [a[0] + s0 * dv[0], a[1] + s0 * dv[1]];
        barrido(S, A, dv, zc, [{ s0: 0, s1: s1 - s0, techo: 0 }], caras);
        const [L, m] = [s1 - s0, p.intereje / 2];
        const nv: Vec2 = [-dv[1] * m, dv[0] * m];
        bandas.push([
          [A[0] - nv[0], A[1] - nv[1]],
          [A[0] + L * dv[0] - nv[0], A[1] + L * dv[1] - nv[1]],
          [A[0] + L * dv[0] + nv[0], A[1] + L * dv[1] + nv[1]],
          [A[0] + nv[0], A[1] + nv[1]],
        ]);
      }
      // Lo que no cubre la banda de ninguna vigueta (junto a una viga o un muro paralelos, o el
      // sobrante del ancho que no llega a un intereje), macizo con el canto de la vigueta
      if (!fs.sinForma && p.intereje > 0) {
        const d = cosSen(p.direccion);
        prismas(descomponer([p.contorno as Vec2[], ...((p.huecos ?? []) as Vec2[][])], [bandas], d), d, (fr) => (fr.capas[0] ? [] : [[zc - fs.h, zc]]), caras);
      }
    } else {
      sinViguetas = true;
      prismas(descomponer([p.contorno as Vec2[], ...((p.huecos ?? []) as Vec2[][])], [], cosSen(p.direccion)), cosSen(p.direccion), () => [[zc - fs.h, zc]], caras);
    }
    piezas.push({ id: p.id, tipo: "pano", planta: k, material: matSec(p.seccion), seccion: p.seccion, caras });
  }
  if (sinViguetas) notas.push("Sin compilar, los paños unidireccionales se dibujan como placas del canto de su vigueta: sus viguetas las sitúa el compilador.");

  // Muros: por tramos de planta, sin huecos y menos la losa de la cabeza
  for (const m of porId(f.muros)) {
    if (!(m.espesor > 0) || m.puntos.length < 2) continue;
    const t = tramosDe(m.puntos);
    if (!t.length) continue;
    const ult = m.puntos[m.puntos.length - 1]!;
    const cerrado = m.puntos.length > 2 && Math.abs(ult[0] - m.puntos[0]![0]) <= EPS && Math.abs(ult[1] - m.puntos[0]![1]) <= EPS;
    const hs = huellasInglete(t, m.espesor, cerrado);
    const tv = tramosVertical(m.desde, m.hasta);
    const zb = cota(indice.get(m.desde));
    if (zb === null) continue;
    for (const [k, z0, z1] of tv) {
      const caras: Cara[] = [];
      t.forEach((tr, i) => {
        const ox = tr.A[0] * tr.d[0] + tr.A[1] * tr.d[1];
        const huecos = (m.huecos ?? []).filter((h) => h.hasta > tr.s0 + EPS && h.desde < tr.s0 + tr.L - EPS);
        const cortes = huecos.flatMap((h) => [ox + h.desde - tr.s0, ox + h.hasta - tr.s0]);
        const ts = tapasCerca(k, [hs[i]!]);
        prismas(
          descomponer([hs[i]!], ts.map((x) => x.anillos), tr.d, cortes),
          tr.d,
          (fr, col) => {
            const x = tapaDe(ts, fr);
            const sm = (col.xa + col.xb) / 2 - ox + tr.s0;
            const quitar: Iv = huecos.filter((h) => h.desde < sm && sm < h.hasta).map((h) => [zb + h.z0, zb + h.z1]);
            return restarIv([[z0, x ? z1 - x.e : z1]], normalizarIv(quitar));
          },
          caras,
        );
      });
      piezas.push({ id: m.id, tipo: "muro", planta: k, material: material.get(m.material)?.tipo ?? null, seccion: null, caras });
    }
  }

  // Apoyos: una pirámide invertida con el vértice en el punto
  for (const a of porId(f.apoyos)) {
    const k = indice.get(a.planta);
    const z = cota(k);
    if (k === undefined || z === null) continue;
    const [x, y] = [a.x, a.y];
    const [w, h] = [0.15, 0.3];
    const V: Vec3 = [x, y, z];
    const B: Vec3[] = [
      [x - w, y - w, z - h],
      [x + w, y - w, z - h],
      [x + w, y + w, z - h],
      [x - w, y + w, z - h],
    ];
    const caras: Cara[] = [{ p: [B[3]!, B[2]!, B[1]!, B[0]!] }];
    for (let i = 0; i < 4; i++) caras.push({ p: [B[i]!, B[(i + 1) % 4]!, V] });
    piezas.push({ id: a.id, tipo: "apoyo", planta: k, material: null, seccion: null, caras });
  }

  if (sinForma.size) notas.push(`Sin forma (sección general sin b ni h), dibujadas como barras de ${LADO_SIN_FORMA * 100} cm: ${[...sinForma].sort().join(", ")}.`);
  return { piezas, notas };
}

// ─── Volumen, aristas y búferes ─────────────────────────────────────────────────────────────────

/**
 * Volumen encerrado por unas caras (teorema de la divergencia, en abanico desde `o`). Con una
 * superficie cerrada no depende de `o`: con dos orígenes distintos, la diferencia mide lo abierta
 * que está.
 */
export function volumen(caras: readonly Cara[], o: Vec3 = [0, 0, 0]): number {
  let v = 0;
  for (const { p } of caras) {
    const a = [p[0]![0] - o[0], p[0]![1] - o[1], p[0]![2] - o[2]];
    for (let i = 1; i < p.length - 1; i++) {
      const b = [p[i]![0] - o[0], p[i]![1] - o[1], p[i]![2] - o[2]];
      const c = [p[i + 1]![0] - o[0], p[i + 1]![1] - o[1], p[i + 1]![2] - o[2]];
      v += a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) + a[1]! * (b[2]! * c[0]! - b[0]! * c[2]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
    }
  }
  return v / 6;
}

/** Normal (unitaria) de una cara por Newell, o null si no tiene área. */
export function normalCara(p: readonly Vec3[]): Vec3 | null {
  let [x, y, z] = [0, 0, 0];
  for (let i = 0; i < p.length; i++) {
    const [a, b] = [p[i]!, p[(i + 1) % p.length]!];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l > 1e-14 ? [x / l, y / l, z / l] : null;
}

const Q = 1e6;
const qk = (x: number) => Math.round(x * Q);
/** El vector con su primera componente no nula positiva, y el signo que se le cambió. */
function canonico(v: Vec3): [Vec3, number] {
  for (const c of v) {
    if (Math.abs(c) > 1e-9) return c > 0 ? [v, 1] : [[-v[0], -v[1], -v[2]], -1];
  }
  return [v, 1];
}

/** Índices de tuplas de enteros (claves de planos y de líneas) por un hash numérico. */
class Claves {
  private readonly cubos = new Map<number, number[]>();
  private readonly datos: number[] = [];
  private n = 0;
  private readonly ancho: number;
  constructor(ancho: number) {
    this.ancho = ancho;
  }
  indice(c: readonly number[]): number {
    let h = 0;
    for (const x of c) h = (Math.imul(h, 31) + (x | 0) + Math.imul((x / 4294967296) | 0, 7)) | 0;
    let cubo = this.cubos.get(h);
    if (cubo)
      for (const i of cubo) {
        let igual = true;
        for (let j = 0; j < this.ancho && igual; j++) igual = this.datos[i * this.ancho + j] === c[j];
        if (igual) return i;
      }
    else this.cubos.set(h, (cubo = []));
    cubo.push(this.n);
    for (const x of c) this.datos.push(x);
    return this.n++;
  }
}

/**
 * Las aristas de una pieza: en cada plano (sin orientar), el borde de la suma con signo de sus
 * caras (las que miran a un lado suman y las del otro restan, así que dos caras que se tapan no
 * dejan borde); y, de esos bordes, los que separan dos planos que se cortan con más de 30°.
 */
export function aristasDe(caras: readonly Cara[]): [Vec3, Vec3][] {
  interface Trozo {
    t0: number;
    t1: number;
    w: number;
    plano: number;
    n: Vec3;
  }
  const planosT = new Claves(4);
  const lineasT = new Claves(6);
  const lineas: { u: Vec3; o: Vec3; trozos: Trozo[] }[] = [];
  for (const { p } of caras) {
    const nn = normalCara(p);
    if (!nn) continue;
    const [n, sn] = canonico(nn);
    const off = n[0] * p[0]![0] + n[1] * p[0]![1] + n[2] * p[0]![2];
    const plano = planosT.indice([qk(n[0]), qk(n[1]), qk(n[2]), qk(off)]);
    for (let i = 0; i < p.length; i++) {
      const [a, b] = [p[i]!, p[(i + 1) % p.length]!];
      const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l <= EPS) continue;
      const [u, su] = canonico([dx / l, dy / l, dz / l]);
      const ta = a[0] * u[0] + a[1] * u[1] + a[2] * u[2];
      const tb = b[0] * u[0] + b[1] * u[1] + b[2] * u[2];
      const o: Vec3 = [a[0] - ta * u[0], a[1] - ta * u[1], a[2] - ta * u[2]];
      const k = lineasT.indice([qk(u[0]), qk(u[1]), qk(u[2]), qk(o[0]), qk(o[1]), qk(o[2])]);
      if (k === lineas.length) lineas.push({ u, o, trozos: [] });
      lineas[k]!.trozos.push({ t0: Math.min(ta, tb), t1: Math.max(ta, tb), w: sn * su, plano, n });
    }
  }
  const r: [Vec3, Vec3][] = [];
  for (const { u, o, trozos } of lineas) {
    // Barrido a lo largo de la línea: en cada t, la suma con signo de cada plano que la cubre
    const planos: number[] = [];
    const normales: Vec3[] = [];
    const ev: { t: number; k: number; w: number }[] = [];
    for (const x of trozos) {
      let k = planos.indexOf(x.plano);
      if (k < 0) {
        k = planos.length;
        planos.push(x.plano);
        normales.push(x.n);
      }
      ev.push({ t: x.t0, k, w: x.w }, { t: x.t1, k, w: -x.w });
    }
    ev.sort((a, b) => a.t - b.t);
    const suma = new Array<number>(planos.length).fill(0);
    let abierta: number | null = null;
    const cerrar = (hasta: number) => {
      if (abierta === null) return;
      r.push([
        [o[0] + abierta * u[0], o[1] + abierta * u[1], o[2] + abierta * u[2]],
        [o[0] + hasta * u[0], o[1] + hasta * u[1], o[2] + hasta * u[2]],
      ]);
      abierta = null;
    };
    let i = 0;
    while (i < ev.length) {
      const t0 = ev[i]!.t;
      while (i < ev.length && ev[i]!.t - t0 <= EPS) {
        suma[ev[i]!.k]! += ev[i]!.w;
        i++;
      }
      if (i >= ev.length) {
        cerrar(t0);
        break;
      }
      let nb = 0;
      let a: Vec3 | null = null;
      let b: Vec3 | null = null;
      for (let k = 0; k < suma.length; k++)
        if (suma[k] !== 0) {
          nb++;
          if (nb === 1) a = normales[k]!;
          else b = normales[k]!;
        }
      const suave = nb === 2 && Math.abs(a![0] * b![0] + a![1] * b![1] + a![2] * b![2]) >= SENO_SUAVE;
      if (nb && !suave) abierta ??= t0;
      else cerrar(t0);
    }
  }
  return r;
}

/**
 * El sólido en búferes: triángulos (en abanico de cada cara) con su objeto y su planta,
 * y las aristas de cada pieza, en Float32 respecto a `origen`.
 */
export function solido(f: ModeloFisico, origen: [number, number, number], compilado?: CompiladoSolido | null): Solido {
  const { piezas, notas } = piezasSolido(f, compilado);
  const objetos: Solido["objetos"] = [];
  const indice = new Map<string, number>();
  let nt = 0;
  for (const p of piezas) for (const c of p.caras) nt += c.p.length - 2;
  const tri = new Float32Array(9 * nt);
  const obj = new Uint32Array(nt);
  const pl = new Uint16Array(nt);
  const ar: number[] = [];
  const oa: number[] = [];
  const pa: number[] = [];
  const caja: Solido["caja"] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let t = 0;
  for (const p of piezas) {
    let k = indice.get(p.id);
    if (k === undefined) {
      k = objetos.length;
      indice.set(p.id, k);
      objetos.push({ id: p.id, tipo: p.tipo, material: p.material, seccion: p.seccion });
    }
    for (const { p: q } of p.caras) {
      for (const v of q)
        for (let a = 0; a < 3; a++) {
          if (v[a]! < caja[a]!) caja[a] = v[a]!;
          if (v[a]! > caja[a + 3]!) caja[a + 3] = v[a]!;
        }
      for (let i = 1; i < q.length - 1; i++) {
        for (const [j, v] of [q[0]!, q[i]!, q[i + 1]!].entries()) for (let a = 0; a < 3; a++) tri[9 * t + 3 * j + a] = v[a]! - origen[a]!;
        obj[t] = k;
        pl[t] = p.planta;
        t++;
      }
    }
    for (const [a, b] of [...aristasDe(p.caras), ...(p.marcas ?? [])]) {
      for (const v of [a, b]) for (let i = 0; i < 3; i++) ar.push(v[i]! - origen[i]!);
      oa.push(k);
      pa.push(p.planta);
    }
  }
  const vacio = !Number.isFinite(caja[0]);
  return {
    origen,
    triangulos: tri,
    objeto: obj,
    planta: pl,
    aristas: Float32Array.from(ar),
    objetoArista: Uint32Array.from(oa),
    plantaArista: Uint16Array.from(pa),
    objetos,
    plantas: (f.plantas ?? []).map((x) => x.id),
    caja: vacio ? [0, 0, 0, 1, 1, 1] : caja,
    notas,
  };
}
