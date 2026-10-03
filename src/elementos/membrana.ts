/**
 * Membrana cuadrilátera con giro de perforación (drilling) real.
 *
 * Formulación de Ibrahimbegovic, Taylor y Wilson (IJNME 30, 1990), sobre el funcional de
 * Hughes y Brezzi (CMAME 72, 1989) en su forma de desplazamientos:
 *
 *   Π = ½∫ εᵀ·C·ε·t dA + ½·γ·t·∫ (ω − ψ)² dA − W,   ω = ½(∂uy/∂x − ∂ux/∂y)
 *
 * - Desplazamientos tipo Allman: u = Σ Nₐ·uₐ + Σₖ Pₖ·(lᵢⱼ/8)·(ψⱼ − ψᵢ)·nᵢⱼ, con Nₐ bilineales,
 *   Pₖ las funciones de lado de la serendípita de 8 nudos y nᵢⱼ la normal exterior del lado i→j.
 * - Giro independiente bilineal ψ = Σ Nₐ·ψₐ, que es el GDL de drilling del nudo (θz local).
 * - Todo integrado con Gauss 2×2, γ = G por defecto y el hourglass de ψ estabilizado (abajo).
 *
 * Elegida en el spike E0 (spike/e0/membrana/explorar.ts → out_explorar.txt) entre cinco variantes:
 * la integración reducida del drilling no aporta nada y los modos incompatibles mejoran MacNeal–
 * Harder pero hacen el elemento muy sensible a γ (muro 2×6: +167 % con γ = G/1000).
 *
 * Con γ > 0 el giro alrededor de la normal tiene rigidez física (no es un muelle a tierra, H05)
 * y ΣM cierra. GDL por nudo, en ejes locales: [ux, uy, θz]. Matrices densas por filas.
 */
import { jacobiano, PUNTOS_GAUSS, type CoordenadasLocales, type MaterialLamina } from "./dkmq.ts";

export interface OpcionesMembrana {
  /** γ / G del término de drilling (Hughes–Brezzi). Por defecto 1; los resultados apenas dependen de él. */
  gamma?: number;
  /**
   * Estabilización del modo espurio de los paralelogramos (hourglass del giro ψ, ver abajo), como
   * fracción de γ·t·A. Por defecto 1e-2 (los resultados no cambian entre 1e-3 y 1e-1).
   */
  estabilizacion?: number;
}

/** Derivadas de las funciones del elemento en (ξ, η) respecto a x, y. */
interface Derivadas {
  /** Nₐ (4). */
  N: number[];
  /** ∂Nₐ/∂x, ∂Nₐ/∂y (4 + 4). */
  Nx: number[];
  Ny: number[];
  /** Funciones de Allman del GDL ψₐ para ux (Mx) y uy (My), y sus derivadas. */
  Mxx: number[];
  Mxy: number[];
  Myx: number[];
  Myy: number[];
  det: number;
}

function derivadas(xy: CoordenadasLocales, xi: number, eta: number): Derivadas {
  const J = jacobiano(xy, xi, eta);
  const dx = (dxi: number, deta: number) => J.i11 * dxi + J.i12 * deta;
  const dy = (dxi: number, deta: number) => J.i21 * dxi + J.i22 * deta;
  const N = [0.25 * (1 - xi) * (1 - eta), 0.25 * (1 + xi) * (1 - eta), 0.25 * (1 + xi) * (1 + eta), 0.25 * (1 - xi) * (1 + eta)];
  const Nxi = [0.25 * (eta - 1), -0.25 * (eta - 1), 0.25 * (eta + 1), -0.25 * (eta + 1)];
  const Neta = [0.25 * (xi - 1), -0.25 * (xi + 1), 0.25 * (xi + 1), -0.25 * (xi - 1)];
  // Funciones de lado Pₖ (lado k: nudo k → nudo k+1) y sus derivadas
  const Pxi = [xi * (eta - 1), -0.5 * (eta - 1) * (eta + 1), -xi * (eta + 1), 0.5 * (eta - 1) * (eta + 1)];
  const Peta = [0.5 * (xi - 1) * (xi + 1), -eta * (xi + 1), -0.5 * (xi - 1) * (xi + 1), eta * (xi - 1)];
  const Px = [0, 1, 2, 3].map((k) => dx(Pxi[k]!, Peta[k]!));
  const Py = [0, 1, 2, 3].map((k) => dy(Pxi[k]!, Peta[k]!));
  const Dx = [0, 1, 2, 3].map((k) => xy[2 * ((k + 1) % 4)]! - xy[2 * k]!);
  const Dy = [0, 1, 2, 3].map((k) => xy[2 * ((k + 1) % 4) + 1]! - xy[2 * k + 1]!);
  const d: Derivadas = {
    N,
    Nx: [0, 1, 2, 3].map((a) => dx(Nxi[a]!, Neta[a]!)),
    Ny: [0, 1, 2, 3].map((a) => dy(Nxi[a]!, Neta[a]!)),
    Mxx: [],
    Mxy: [],
    Myx: [],
    Myy: [],
    det: J.det,
  };
  for (let a = 0; a < 4; a++) {
    const kin = (a + 3) % 4; // lado que llega al nudo a (a es su nudo final)
    const kout = a; // lado que sale del nudo a (a es su nudo inicial)
    // ux: (P_kin·Δy_kin − P_kout·Δy_kout)/8 ;  uy: (−P_kin·Δx_kin + P_kout·Δx_kout)/8
    d.Mxx.push((Px[kin]! * Dy[kin]! - Px[kout]! * Dy[kout]!) / 8);
    d.Mxy.push((Py[kin]! * Dy[kin]! - Py[kout]! * Dy[kout]!) / 8);
    d.Myx.push((-Px[kin]! * Dx[kin]! + Px[kout]! * Dx[kout]!) / 8);
    d.Myy.push((-Py[kin]! * Dx[kin]! + Py[kout]! * Dx[kout]!) / 8);
  }
  return d;
}

/** Filas de B (3×12: εx, εy, γxy) y de g (1×12: ω − ψ) en GDL [ux, uy, θz] por nudo. */
function filasB(d: Derivadas): { B: Float64Array; g: Float64Array } {
  const B = new Float64Array(36);
  const g = new Float64Array(12);
  for (let a = 0; a < 4; a++) {
    const c = 3 * a;
    B[c] = d.Nx[a]!;
    B[c + 2] = d.Mxx[a]!;
    B[12 + c + 1] = d.Ny[a]!;
    B[12 + c + 2] = d.Myy[a]!;
    B[24 + c] = d.Ny[a]!;
    B[24 + c + 1] = d.Nx[a]!;
    B[24 + c + 2] = d.Mxy[a]! + d.Myx[a]!;
    g[c] = -0.5 * d.Ny[a]!;
    g[c + 1] = 0.5 * d.Nx[a]!;
    g[c + 2] = 0.5 * (d.Myx[a]! - d.Mxy[a]!) - d.N[a]!;
  }
  return { B, g };
}

function matrizC(mat: MaterialLamina): number[] {
  const f = mat.E / (1 - mat.nu ** 2);
  return [f, f * mat.nu, 0, f * mat.nu, f, 0, 0, 0, (f * (1 - mat.nu)) / 2];
}

/** Suma k += Aᵀ·C·A·w (A: r×m por filas, C: r×r). */
function sumarAtCA(k: Float64Array, A: ArrayLike<number>, C: ArrayLike<number>, r: number, m: number, w: number): void {
  const CA = new Float64Array(r * m);
  for (let i = 0; i < r; i++) for (let j = 0; j < m; j++) {
    let s = 0;
    for (let l = 0; l < r; l++) s += C[r * i + l]! * A[m * l + j]!;
    CA[m * i + j] = s;
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    let s = 0;
    for (let l = 0; l < r; l++) s += A[m * l + i]! * CA[m * l + j]!;
    k[m * i + j]! += s * w;
  }
}

/** Rigidez de membrana 12×12 en ejes locales, GDL [ux, uy, θz] por nudo. */
export function rigidezMembrana(xy: CoordenadasLocales, mat: MaterialLamina, op: OpcionesMembrana = {}): Float64Array {
  const C = matrizC(mat).map((v) => v * mat.t);
  const G = mat.E / (2 * (1 + mat.nu));
  const gt = (op.gamma ?? 1) * G * mat.t;
  const k = new Float64Array(144);
  for (const [xi, eta] of PUNTOS_GAUSS) {
    const d = derivadas(xy, xi, eta);
    const { B, g } = filasB(d);
    sumarAtCA(k, B, C, 3, 12, d.det);
    sumarAtCA(k, g, [gt], 1, 12, d.det);
  }
  estabilizarHourglass(k, xy, (op.estabilizacion ?? 1e-2) * gt);
  return k;
}

/**
 * En un paralelogramo, la membrana tipo Allman con el término de Hughes–Brezzi integrado 2×2 tiene
 * un modo de energía nula: ψ en hourglass (+1, −1, +1, −1) con un campo de desplazamientos asociado.
 * Se penaliza la componente hourglass de ψ con el vector de Flanagan–Belytschko (IJNME 17, 1981),
 * ortogonal a los campos lineales: no toca los modos rígidos ni los estados de deformación
 * constante (patch test), en los que ψ es constante.
 */
function estabilizarHourglass(k: Float64Array, xy: CoordenadasLocales, gtA: number): void {
  const h = [1, -1, 1, -1];
  const J0 = jacobiano(xy, 0, 0);
  // Derivadas de las funciones bilineales en el centro y área
  const Nxi = [-0.25, 0.25, 0.25, -0.25];
  const Neta = [-0.25, -0.25, 0.25, 0.25];
  const bx = [0, 1, 2, 3].map((a) => J0.i11 * Nxi[a]! + J0.i12 * Neta[a]!);
  const by = [0, 1, 2, 3].map((a) => J0.i21 * Nxi[a]! + J0.i22 * Neta[a]!);
  let hx = 0;
  let hy = 0;
  for (let a = 0; a < 4; a++) {
    hx += h[a]! * xy[2 * a]!;
    hy += h[a]! * xy[2 * a + 1]!;
  }
  const g = [0, 1, 2, 3].map((a) => (h[a]! - hx * bx[a]! - hy * by[a]!) / 4);
  const area = 4 * J0.det;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) k[12 * (3 * a + 2) + 3 * b + 2]! += gtA * area * g[a]! * g[b]!;
}

/**
 * Esfuerzos de membrana [Nx, Ny, Nxy] (kN/m, tracción positiva) en los 4 puntos de Gauss, a partir
 * de los desplazamientos locales [ux, uy, θz] × 4.
 */
export function esfuerzosMembrana(xy: CoordenadasLocales, mat: MaterialLamina, u: ArrayLike<number>): Float64Array {
  const C = matrizC(mat).map((v) => v * mat.t);
  const out = new Float64Array(12);
  PUNTOS_GAUSS.forEach(([xi, eta], gp) => {
    const { B } = filasB(derivadas(xy, xi, eta));
    for (let r = 0; r < 3; r++) {
      let s = 0;
      for (let c = 0; c < 3; c++) {
        let e = 0;
        for (let j = 0; j < 12; j++) e += B[12 * c + j]! * u[j]!;
        s += C[3 * r + c]! * e;
      }
      out[3 * gp + r] = s;
    }
  });
  return out;
}
