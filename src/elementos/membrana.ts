/**
 * Membrana cuadrilátera con giro de perforación (drilling) real.
 *
 * Formulación de Ibrahimbegovic, Taylor y Wilson (IJNME 30, 1990), sobre el funcional de
 * Hughes y Brezzi (CMAME 72, 1989) en su forma de desplazamientos:
 *
 *   Π = ½∫ εᵀ·C·ε dA + ½·γt·∫ (ω − ψ)² dA − W,   ω = ½(∂uy/∂x − ∂ux/∂y)
 *
 * - Desplazamientos tipo Allman: u = Σ Nₐ·uₐ + Σₖ Pₖ·(lᵢⱼ/8)·(ψⱼ − ψᵢ)·nᵢⱼ, con Nₐ bilineales,
 *   Pₖ las funciones de lado de la serendípita de 8 nudos y nᵢⱼ la normal exterior del lado i→j.
 * - Giro independiente bilineal ψ = Σ Nₐ·ψₐ, que es el GDL de drilling del nudo (θz local).
 * - Todo integrado con Gauss 2×2 y el hourglass de ψ estabilizado (abajo).
 *
 * Elegida en el spike E0 (spike/e0/membrana/explorar.ts → out_explorar.txt) entre cinco variantes:
 * la integración reducida del drilling no aporta nada y los modos incompatibles mejoran MacNeal–
 * Harder pero hacen el elemento muy sensible a γ (muro 2×6: +167 % con γ = G/1000).
 *
 * Con γ > 0 el giro alrededor de la normal tiene rigidez física (no es un muelle a tierra, H05)
 * y ΣM cierra. GDL por nudo, en ejes locales: [ux, uy, θz]. Matrices densas por filas.
 *
 * Sección general (E3): C (3×3, kN/m) cualquiera, simétrica y definida positiva, en los ejes del
 * elemento: [Nx, Ny, Nxy] = C·[εx, εy, γxy]. Así entran los multiplicadores f11, f22 y f12 de D3.
 * El parámetro del drilling es γt = (γ/G)·C₃₃: con la sección isótropa, γ·t con γ = G por defecto.
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

/** Rigidez de membrana de la sección: C (3×3 por filas, kN/m) y γt del drilling (kN/m). */
export interface SeccionMembrana {
  C: ArrayLike<number>;
  gt: number;
  /** Fracción de γt·A de la estabilización del hourglass de ψ. */
  estabilizacion: number;
}

/** C = E·t/(1−ν²)·[[1, ν, 0], [ν, 1, 0], [0, 0, (1−ν)/2]] y γt = γ·G·t. */
export function seccionMembranaIsotropa(mat: MaterialLamina, op: OpcionesMembrana = {}): SeccionMembrana {
  const f = (mat.E * mat.t) / (1 - mat.nu ** 2);
  const G = mat.E / (2 * (1 + mat.nu));
  return {
    C: [f, f * mat.nu, 0, f * mat.nu, f, 0, 0, 0, (f * (1 - mat.nu)) / 2],
    gt: (op.gamma ?? 1) * G * mat.t,
    estabilizacion: op.estabilizacion ?? 1e-2,
  };
}

// ---------------------------------------------------------------------------------------------
// Núcleo: búferes del módulo

/** B (3×12: εx, εy, γxy) y g (1×12: ω − ψ) en el punto de Gauss actual. */
const B = new Float64Array(36);
const G = new Float64Array(12);
const CB = new Float64Array(36);
const NN = new Float64Array(4);
const NX = new Float64Array(4);
const NY = new Float64Array(4);
const PX = new Float64Array(4);
const PY = new Float64Array(4);
const DX = new Float64Array(4);
const DY = new Float64Array(4);

/** Llena B y G en (ξ, η) y devuelve det J. */
function filasB(xy: CoordenadasLocales, xi: number, eta: number): number {
  const J = jacobiano(xy, xi, eta);
  const { i11, i12, i21, i22 } = J;
  NN[0] = 0.25 * (1 - xi) * (1 - eta);
  NN[1] = 0.25 * (1 + xi) * (1 - eta);
  NN[2] = 0.25 * (1 + xi) * (1 + eta);
  NN[3] = 0.25 * (1 - xi) * (1 + eta);
  const nxi0 = 0.25 * (eta - 1), nxi1 = -0.25 * (eta - 1), nxi2 = 0.25 * (eta + 1), nxi3 = -0.25 * (eta + 1);
  const net0 = 0.25 * (xi - 1), net1 = -0.25 * (xi + 1), net2 = 0.25 * (xi + 1), net3 = -0.25 * (xi - 1);
  NX[0] = i11 * nxi0 + i12 * net0;
  NX[1] = i11 * nxi1 + i12 * net1;
  NX[2] = i11 * nxi2 + i12 * net2;
  NX[3] = i11 * nxi3 + i12 * net3;
  NY[0] = i21 * nxi0 + i22 * net0;
  NY[1] = i21 * nxi1 + i22 * net1;
  NY[2] = i21 * nxi2 + i22 * net2;
  NY[3] = i21 * nxi3 + i22 * net3;
  // Funciones de lado Pₖ (lado k: nudo k → nudo k+1) y sus derivadas
  const pxi0 = xi * (eta - 1), pxi1 = -0.5 * (eta - 1) * (eta + 1), pxi2 = -xi * (eta + 1), pxi3 = 0.5 * (eta - 1) * (eta + 1);
  const pet0 = 0.5 * (xi - 1) * (xi + 1), pet1 = -eta * (xi + 1), pet2 = -0.5 * (xi - 1) * (xi + 1), pet3 = eta * (xi - 1);
  PX[0] = i11 * pxi0 + i12 * pet0;
  PX[1] = i11 * pxi1 + i12 * pet1;
  PX[2] = i11 * pxi2 + i12 * pet2;
  PX[3] = i11 * pxi3 + i12 * pet3;
  PY[0] = i21 * pxi0 + i22 * pet0;
  PY[1] = i21 * pxi1 + i22 * pet1;
  PY[2] = i21 * pxi2 + i22 * pet2;
  PY[3] = i21 * pxi3 + i22 * pet3;
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) & 3;
    DX[k] = xy[2 * j]! - xy[2 * k]!;
    DY[k] = xy[2 * j + 1]! - xy[2 * k + 1]!;
  }
  for (let a = 0; a < 4; a++) {
    const kin = (a + 3) & 3; // lado que llega al nudo a (a es su nudo final)
    const kout = a; // lado que sale del nudo a (a es su nudo inicial)
    // Funciones de Allman del GDL ψₐ: ux = (P_kin·Δy_kin − P_kout·Δy_kout)/8, uy = (−P_kin·Δx_kin + P_kout·Δx_kout)/8
    const Mxx = (PX[kin]! * DY[kin]! - PX[kout]! * DY[kout]!) / 8;
    const Mxy = (PY[kin]! * DY[kin]! - PY[kout]! * DY[kout]!) / 8;
    const Myx = (-PX[kin]! * DX[kin]! + PX[kout]! * DX[kout]!) / 8;
    const Myy = (-PY[kin]! * DX[kin]! + PY[kout]! * DX[kout]!) / 8;
    const c = 3 * a;
    const nx = NX[a]!;
    const ny = NY[a]!;
    B[c] = nx;
    B[c + 1] = 0;
    B[c + 2] = Mxx;
    B[12 + c] = 0;
    B[12 + c + 1] = ny;
    B[12 + c + 2] = Myy;
    B[24 + c] = ny;
    B[24 + c + 1] = nx;
    B[24 + c + 2] = Mxy + Myx;
    G[c] = -0.5 * ny;
    G[c + 1] = 0.5 * nx;
    G[c + 2] = 0.5 * (Myx - Mxy) - NN[a]!;
  }
  return J.det;
}

/**
 * Rigidez de membrana 12×12 en ejes locales, GDL [ux, uy, θz] por nudo, con una sección general.
 * `out` (144) se sobrescribe; por defecto, uno nuevo.
 */
export function rigidezMembranaSeccion(xy: CoordenadasLocales, sec: SeccionMembrana, out: Float64Array = new Float64Array(144)): Float64Array {
  const C = sec.C;
  out.fill(0);
  for (const [xi, eta] of PUNTOS_GAUSS) {
    const det = filasB(xy, xi, eta);
    for (let r = 0; r < 3; r++) {
      const c0 = C[3 * r]! * det, c1 = C[3 * r + 1]! * det, c2 = C[3 * r + 2]! * det;
      for (let c = 0; c < 12; c++) CB[12 * r + c] = c0 * B[c]! + c1 * B[12 + c]! + c2 * B[24 + c]!;
    }
    const w = sec.gt * det;
    for (let i = 0; i < 12; i++) {
      const b0 = B[i]!, b1 = B[12 + i]!, b2 = B[24 + i]!, gi = G[i]! * w;
      const o = 12 * i;
      for (let j = i; j < 12; j++) out[o + j] += b0 * CB[j]! + b1 * CB[12 + j]! + b2 * CB[24 + j]! + gi * G[j]!;
    }
  }
  for (let i = 0; i < 12; i++) for (let j = 0; j < i; j++) out[12 * i + j] = out[12 * j + i]!;
  estabilizarHourglass(out, xy, sec.estabilizacion * sec.gt);
  return out;
}

/** Rigidez de membrana 12×12 de una lámina isótropa, GDL [ux, uy, θz] por nudo. */
export function rigidezMembrana(xy: CoordenadasLocales, mat: MaterialLamina, op: OpcionesMembrana = {}): Float64Array {
  return rigidezMembranaSeccion(xy, seccionMembranaIsotropa(mat, op));
}

/**
 * En un paralelogramo, la membrana tipo Allman con el término de Hughes–Brezzi integrado 2×2 tiene
 * un modo de energía nula: ψ en hourglass (+1, −1, +1, −1) con un campo de desplazamientos asociado.
 * Se penaliza la componente hourglass de ψ con el vector de Flanagan–Belytschko (IJNME 17, 1981),
 * ortogonal a los campos lineales: no toca los modos rígidos ni los estados de deformación
 * constante (patch test), en los que ψ es constante.
 */
function estabilizarHourglass(k: Float64Array, xy: CoordenadasLocales, gtA: number): void {
  const J0 = jacobiano(xy, 0, 0);
  // Derivadas de las funciones bilineales en el centro y vector hourglass h = (+1, −1, +1, −1)
  const bx0 = J0.i11 * -0.25 + J0.i12 * -0.25, bx1 = J0.i11 * 0.25 + J0.i12 * -0.25, bx2 = J0.i11 * 0.25 + J0.i12 * 0.25, bx3 = J0.i11 * -0.25 + J0.i12 * 0.25;
  const by0 = J0.i21 * -0.25 + J0.i22 * -0.25, by1 = J0.i21 * 0.25 + J0.i22 * -0.25, by2 = J0.i21 * 0.25 + J0.i22 * 0.25, by3 = J0.i21 * -0.25 + J0.i22 * 0.25;
  const hx = xy[0]! - xy[2]! + xy[4]! - xy[6]!;
  const hy = xy[1]! - xy[3]! + xy[5]! - xy[7]!;
  const g0 = (1 - hx * bx0 - hy * by0) / 4;
  const g1 = (-1 - hx * bx1 - hy * by1) / 4;
  const g2 = (1 - hx * bx2 - hy * by2) / 4;
  const g3 = (-1 - hx * bx3 - hy * by3) / 4;
  const g = [g0, g1, g2, g3];
  const f = gtA * 4 * J0.det;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) k[12 * (3 * a + 2) + 3 * b + 2] += f * g[a]! * g[b]!;
}

/**
 * Operador de esfuerzos de membrana en los 4 puntos de Gauss: por punto, 3 filas de 12 (GDL
 * [ux, uy, θz] × 4) que dan [Nx, Ny, Nxy] (kN/m, tracción positiva). `out` (144).
 */
export function operadorMembrana(xy: CoordenadasLocales, sec: SeccionMembrana, out: Float64Array = new Float64Array(144)): Float64Array {
  const C = sec.C;
  PUNTOS_GAUSS.forEach(([xi, eta], g) => {
    filasB(xy, xi, eta);
    for (let r = 0; r < 3; r++) {
      const c0 = C[3 * r]!, c1 = C[3 * r + 1]!, c2 = C[3 * r + 2]!;
      for (let c = 0; c < 12; c++) out[36 * g + 12 * r + c] = c0 * B[c]! + c1 * B[12 + c]! + c2 * B[24 + c]!;
    }
  });
  return out;
}

/**
 * Esfuerzos de membrana [Nx, Ny, Nxy] (kN/m, tracción positiva) en los 4 puntos de Gauss, a partir
 * de los desplazamientos locales [ux, uy, θz] × 4.
 */
export function esfuerzosMembrana(xy: CoordenadasLocales, mat: MaterialLamina, u: ArrayLike<number>): Float64Array {
  const op = operadorMembrana(xy, seccionMembranaIsotropa(mat));
  const out = new Float64Array(12);
  for (let r = 0; r < 12; r++) {
    let s = 0;
    for (let c = 0; c < 12; c++) s += op[12 * r + c]! * u[c]!;
    out[r] = s;
  }
  return out;
}
