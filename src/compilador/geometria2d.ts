/**
 * Geometría en planta del compilador: huellas de pilares, proyecciones, cortes de rectas y una
 * rejilla hash para buscar vecinos (H28: no hace falta un R-tree).
 *
 * Sólo `Math.sqrt` y aritmética, nunca `Math.hypot` ni trigonometría para situar nudos: así las
 * coordenadas son las mismas bit a bit en V8 y en JavaScriptCore (COM-12). El único seno y coseno
 * es el del giro de la sección de un pilar, que sólo orienta su huella.
 */
import type { Vec2 } from "./fisico.ts";
import type { FormaHuella } from "./secciones.ts";

/**
 * Cuanto de las coordenadas en la numeración canónica de nudos y láminas, m: dos coordenadas que
 * sólo difieren en un ulp (el seno de un giro difiere entre V8 y JSC, COM-12) ordenan igual.
 */
export const CUANTO_ORDEN = 1e-9;

export const dist = (a: Vec2, b: Vec2): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

/** Huella de un pilar colocada en planta: centro, ejes (z = canto, y = ancho) y forma. */
export interface Huella {
  c: Vec2;
  /** Dirección del canto h (z local) y del ancho b (y local), unitarias. */
  ez: Vec2;
  ey: Vec2;
  forma: FormaHuella | null;
}

/** Giro en grados → ejes de la huella: z = (cos α, sin α), y = z × (+Z) = (sin α, −cos α). */
export function huellaPilar(x: number, y: number, giro: number, forma: FormaHuella | null): Huella {
  // Los giros múltiplos de 90° son exactos (los más habituales)
  const g = (((giro % 360) + 360) % 360) / 90;
  let c: number;
  let s: number;
  if (Number.isInteger(g)) [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][g]! as [number, number];
  else [c, s] = [Math.cos((giro * Math.PI) / 180), Math.sin((giro * Math.PI) / 180)];
  return { c: [x, y], ez: [c, s], ey: [s, -c], forma };
}

/** Distancia de un punto a la huella (0 dentro). Sin forma, la distancia al eje. */
export function distanciaAHuella(p: Vec2, h: Huella): number {
  const dx = p[0] - h.c[0];
  const dy = p[1] - h.c[1];
  const f = h.forma;
  if (!f) return Math.sqrt(dx * dx + dy * dy);
  if (f.tipo === "circulo") return Math.max(0, Math.sqrt(dx * dx + dy * dy) - f.D / 2);
  const u = Math.max(0, Math.abs(dx * h.ez[0] + dy * h.ez[1]) - f.h / 2);
  const v = Math.max(0, Math.abs(dx * h.ey[0] + dy * h.ey[1]) - f.b / 2);
  return Math.sqrt(u * u + v * v);
}

/** Radio de la circunferencia que contiene la huella (0 sin forma). */
export function radioHuella(h: Huella): number {
  const f = h.forma;
  if (!f) return 0;
  return f.tipo === "circulo" ? f.D / 2 : Math.sqrt(f.b * f.b + f.h * f.h) / 2;
}

/**
 * Cuerda de la recta P(σ) = A + σ·u (u unitario) dentro de la huella: [σ entrada, σ salida], o
 * null si no la corta (o no hay forma).
 */
export function cuerdaHuella(A: Vec2, u: Vec2, h: Huella): [number, number] | null {
  const f = h.forma;
  if (!f) return null;
  const ax = A[0] - h.c[0];
  const ay = A[1] - h.c[1];
  if (f.tipo === "circulo") {
    // |a + σu|² = r²  →  σ² + 2(a·u)σ + |a|² − r² = 0
    const b = ax * u[0] + ay * u[1];
    const c = ax * ax + ay * ay - (f.D * f.D) / 4;
    const disc = b * b - c;
    if (!(disc > 0)) return null;
    const r = Math.sqrt(disc);
    return [-b - r, -b + r];
  }
  // Losas de las dos direcciones de la huella (método de Kay–Kajiya)
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [e, semi] of [
    [h.ez, f.h / 2],
    [h.ey, f.b / 2],
  ] as const) {
    const p = ax * e[0] + ay * e[1];
    const d = u[0] * e[0] + u[1] * e[1];
    if (Math.abs(d) < 1e-15) {
      if (Math.abs(p) >= semi) return null;
      continue;
    }
    let a = (-semi - p) / d;
    let b = (semi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** Tramo recto A→B con su dirección unitaria y su longitud. */
export interface Tramo2D {
  A: Vec2;
  B: Vec2;
  u: Vec2;
  len: number;
}

export function tramo(A: Vec2, B: Vec2): Tramo2D {
  const len = dist(A, B);
  return { A, B, u: [(B[0] - A[0]) / len, (B[1] - A[1]) / len], len };
}

/** Proyección de P sobre la recta del tramo: σ (desde A) y distancia a la recta. */
export function proyectar(P: Vec2, t: Tramo2D): { sigma: number; d: number } {
  const px = P[0] - t.A[0];
  const py = P[1] - t.A[1];
  const sigma = px * t.u[0] + py * t.u[1];
  const d = Math.abs(px * t.u[1] - py * t.u[0]);
  return { sigma, d };
}

export const puntoEn = (t: Tramo2D, sigma: number): Vec2 => [t.A[0] + sigma * t.u[0], t.A[1] + sigma * t.u[1]];

/**
 * Corte de dos tramos: σ en cada uno, o null si son paralelos (|sen| < 1e-12) o si se cortan
 * fuera de alguno. El punto se calcula sobre el primero.
 */
export function cortarTramos(p: Tramo2D, q: Tramo2D): { sp: number; sq: number } | null {
  const den = p.u[0] * q.u[1] - p.u[1] * q.u[0];
  if (Math.abs(den) < 1e-12) return null;
  const wx = q.A[0] - p.A[0];
  const wy = q.A[1] - p.A[1];
  const sp = (wx * q.u[1] - wy * q.u[0]) / den;
  const sq = (wx * p.u[1] - wy * p.u[0]) / den;
  return { sp, sq };
}

/** Rejilla hash de cajas en planta: devuelve candidatos (sin duplicados, ordenados). */
export class RejillaHash {
  private readonly celdas = new Map<string, number[]>();
  private readonly lado: number;

  constructor(lado: number) {
    this.lado = lado;
  }

  private rango(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const l = this.lado;
    return [Math.floor(x0 / l), Math.floor(y0 / l), Math.floor(x1 / l), Math.floor(y1 / l)];
  }

  insertar(id: number, x0: number, y0: number, x1: number, y1: number): void {
    const [i0, j0, i1, j1] = this.rango(x0, y0, x1, y1);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = `${i},${j}`;
        let c = this.celdas.get(k);
        if (!c) this.celdas.set(k, (c = []));
        c.push(id);
      }
    }
  }

  buscar(x0: number, y0: number, x1: number, y1: number): number[] {
    const [i0, j0, i1, j1] = this.rango(x0, y0, x1, y1);
    const vistos = new Set<number>();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const id of this.celdas.get(`${i},${j}`) ?? []) vistos.add(id);
    return [...vistos].sort((a, b) => a - b);
  }
}
