/**
 * Flexión de lámina DKMQ (Discrete Kirchhoff–Mindlin Quadrilateral), Katili (IJNME 36, 1993).
 *
 * Portada de `Quad3D.ke_b`, `B_b`, `B_s`, `fer`, `moment` y `shear` de PyNite 3.2.0
 * (Pynite/Quad3D.py, MIT, © 2018 D. Craig Brinck; ver NOTICE). PyNite es el oráculo bit a bit
 * de este fichero (criterio 1 del spike E0, fixture `__fixtures__/dkmq-pynite.json`).
 *
 * Convenios de este fichero (ejes locales del elemento, z normal a la lámina):
 * - GDL por nudo, en el orden de la API: [w, θx, θy], con θ según la regla de la mano derecha.
 *   Internamente la DKMQ trabaja con los giros de la normal de Batoz, βx = θy y βy = −θx.
 * - Esfuerzos con el convenio del motor (tipo CSI, H02): Mx produce σx y es positivo con
 *   tracción en la cara −z (momento de vano positivo con z hacia arriba); Mxy = −∫ z·τxy dz;
 *   Qx, Qy = ∫ τxz dz, ∫ τyz dz. Respecto a PyNite: Mx, My y Mxy cambian de signo; Qx y Qy no.
 * - Matrices densas por filas en `Float64Array`.
 *
 * Material isótropo en el spike. La anisotropía de D3 (multiplicadores m11, m22, m12, v13, v23)
 * entra en E3 sustituyendo `Db`, `Ds` y la φₖ anisótropa de Katili (2018).
 */

export interface MaterialLamina {
  /** Módulo de elasticidad, kN/m². */
  E: number;
  /** Coeficiente de Poisson. */
  nu: number;
  /** Espesor, m. */
  t: number;
}

/** Coordenadas locales (x, y) de los 4 nudos: [x1, y1, x2, y2, x3, y3, x4, y4], en sentido antihorario. */
export type CoordenadasLocales = ArrayLike<number>;

const GP = 1 / Math.sqrt(3);
/** Puntos de Gauss 2×2 en el orden de PyNite. */
export const PUNTOS_GAUSS: readonly (readonly [number, number])[] = [
  [-GP, -GP],
  [GP, -GP],
  [GP, GP],
  [-GP, GP],
];
const KAPPA = 5 / 6;

interface Jacobiano {
  /** Inversa del jacobiano: [∂/∂x, ∂/∂y] = Jinv · [∂/∂ξ, ∂/∂η]. */
  i11: number;
  i12: number;
  i21: number;
  i22: number;
  det: number;
}

export function jacobiano(xy: CoordenadasLocales, xi: number, eta: number): Jacobiano {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = [xy[0]!, xy[1]!, xy[2]!, xy[3]!, xy[4]!, xy[5]!, xy[6]!, xy[7]!];
  const j11 = 0.25 * (x1 * (eta - 1) - x2 * (eta - 1) + x3 * (eta + 1) - x4 * (eta + 1));
  const j12 = 0.25 * (y1 * (eta - 1) - y2 * (eta - 1) + y3 * (eta + 1) - y4 * (eta + 1));
  const j21 = 0.25 * (x1 * (xi - 1) - x2 * (xi + 1) + x3 * (xi + 1) - x4 * (xi - 1));
  const j22 = 0.25 * (y1 * (xi - 1) - y2 * (xi + 1) + y3 * (xi + 1) - y4 * (xi - 1));
  const det = j11 * j22 - j12 * j21;
  return { i11: j22 / det, i12: -j12 / det, i21: -j21 / det, i22: j11 / det, det };
}

/** Datos de los lados k = 5..8 (1→2, 2→3, 3→4, 4→1): longitud, cosenos y φₖ. */
interface Lados {
  L: Float64Array;
  C: Float64Array;
  S: Float64Array;
  phi: Float64Array;
}

function lados(xy: CoordenadasLocales, mat: MaterialLamina): Lados {
  const L = new Float64Array(4);
  const C = new Float64Array(4);
  const S = new Float64Array(4);
  const phi = new Float64Array(4);
  for (let k = 0; k < 4; k++) {
    const i = k;
    const j = (k + 1) % 4;
    const dx = xy[2 * j]! - xy[2 * i]!;
    const dy = xy[2 * j + 1]! - xy[2 * i + 1]!;
    const l = Math.sqrt(dx * dx + dy * dy);
    L[k] = l;
    C[k] = dx / l;
    S[k] = dy / l;
    // Katili (1993), ec. 74: φₖ = 2/(κ(1−ν))·(t/Lₖ)²  (= 12·D/(κ·G·t·Lₖ²))
    phi[k] = (2 / (KAPPA * (1 - mat.nu))) * (mat.t / l) ** 2;
  }
  return { L, C, S, phi };
}

/** [A_u] (4×12, por filas) en GDL de Batoz [w, βx, βy]. */
function matrizAu(ld: Lados): Float64Array {
  const A = new Float64Array(48);
  for (let k = 0; k < 4; k++) {
    const i = k;
    const j = (k + 1) % 4;
    const L = ld.L[k]!;
    const C = ld.C[k]!;
    const S = ld.S[k]!;
    A[12 * k + 3 * i] = 0.5 * (-2 / L);
    A[12 * k + 3 * i + 1] = 0.5 * C;
    A[12 * k + 3 * i + 2] = 0.5 * S;
    A[12 * k + 3 * j] = 0.5 * (2 / L);
    A[12 * k + 3 * j + 1] = 0.5 * C;
    A[12 * k + 3 * j + 2] = 0.5 * S;
  }
  return A;
}

/**
 * [B_b] (3×12) y [B_s] (2×12) en (ξ, η), GDL de Batoz [w, βx, βy] por nudo.
 * B_b = B_bβ + B_bΔβ·A_Δ⁻¹·A_u;  B_s = J⁻¹·N_γ·A_γ·A_φΔ·A_u  (Katili 1993).
 */
function matricesB(
  xy: CoordenadasLocales,
  ld: Lados,
  Au: Float64Array,
  xi: number,
  eta: number,
): { Bb: Float64Array; Bs: Float64Array; det: number } {
  const J = jacobiano(xy, xi, eta);
  const Bb = new Float64Array(36);

  // B_bβ: derivadas de las funciones bilineales
  const Nxi = [0.25 * (eta - 1), -0.25 * (eta - 1), 0.25 * (eta + 1), -0.25 * (eta + 1)];
  const Neta = [0.25 * (xi - 1), -0.25 * (xi + 1), 0.25 * (xi + 1), -0.25 * (xi - 1)];
  for (let a = 0; a < 4; a++) {
    const Nx = J.i11 * Nxi[a]! + J.i12 * Neta[a]!;
    const Ny = J.i21 * Nxi[a]! + J.i22 * Neta[a]!;
    Bb[3 * a + 1] = Nx; // fila 0: βx,x
    Bb[12 + 3 * a + 2] = Ny; // fila 1: βy,y
    Bb[24 + 3 * a + 1] = Ny; // fila 2: βx,y + βy,x
    Bb[24 + 3 * a + 2] = Nx;
  }

  // B_bΔβ (3×4): derivadas de las funciones cuadráticas de lado Pₖ
  const Pxi = [xi * (eta - 1), -0.5 * (eta - 1) * (eta + 1), -xi * (eta + 1), 0.5 * (eta - 1) * (eta + 1)];
  const Peta = [0.5 * (xi - 1) * (xi + 1), -eta * (xi + 1), -0.5 * (xi - 1) * (xi + 1), eta * (xi - 1)];
  const BD = new Float64Array(12);
  for (let k = 0; k < 4; k++) {
    const Px = J.i11 * Pxi[k]! + J.i12 * Peta[k]!;
    const Py = J.i21 * Pxi[k]! + J.i22 * Peta[k]!;
    const C = ld.C[k]!;
    const S = ld.S[k]!;
    // multiplicado ya por A_Δ⁻¹ = diag(−3/2/(1+φₖ))
    const f = -1.5 / (1 + ld.phi[k]!);
    BD[k] = f * Px * C;
    BD[4 + k] = f * Py * S;
    BD[8 + k] = f * (Py * C + Px * S);
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 12; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += BD[4 * r + k]! * Au[12 * k + c]!;
      Bb[12 * r + c]! += s;
    }
  }

  // B_s: J⁻¹ · N_γ · A_γ · A_φΔ · A_u
  const Ng = [0.5 * (1 - eta), 0, 0.5 * (1 + eta), 0, 0, 0.5 * (1 + xi), 0, 0.5 * (1 - xi)];
  const Ag = [ld.L[0]! / 2, ld.L[1]! / 2, -ld.L[2]! / 2, -ld.L[3]! / 2];
  const G2 = new Float64Array(8); // (J⁻¹·N_γ·A_γ·A_φΔ), 2×4
  for (let k = 0; k < 4; k++) {
    const d = Ag[k]! * (ld.phi[k]! / (1 + ld.phi[k]!));
    const n0 = Ng[k]! * d;
    const n1 = Ng[4 + k]! * d;
    G2[k] = J.i11 * n0 + J.i12 * n1;
    G2[4 + k] = J.i21 * n0 + J.i22 * n1;
  }
  const Bs = new Float64Array(24);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 12; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += G2[4 * r + k]! * Au[12 * k + c]!;
      Bs[12 * r + c] = s;
    }
  }
  return { Bb, Bs, det: J.det };
}

function rigidecesSeccion(mat: MaterialLamina): { D: number; nu: number; Ds: number } {
  const D = (mat.E * mat.t ** 3) / (12 * (1 - mat.nu ** 2));
  const G = mat.E / (2 * (1 + mat.nu));
  return { D, nu: mat.nu, Ds: KAPPA * G * mat.t };
}

/** Pasa una matriz 12×12 de GDL de Batoz [w, βx, βy] a los de la API [w, θx, θy]. */
function deBatoz(kb: Float64Array): Float64Array {
  // d_Batoz = Q·d con, por nudo, w = w, βx = θy, βy = −θx  →  k = Qᵀ·kb·Q
  const col = (c: number): [number, number] => {
    const a = Math.floor(c / 3);
    const l = c % 3;
    if (l === 0) return [3 * a, 1];
    if (l === 1) return [3 * a + 2, -1]; // θx ← −βy
    return [3 * a + 1, 1]; // θy ← βx
  };
  const k = new Float64Array(144);
  for (let r = 0; r < 12; r++) {
    const [rb, sr] = col(r);
    for (let c = 0; c < 12; c++) {
      const [cb, sc] = col(c);
      k[12 * r + c] = sr * sc * kb[12 * rb + cb]!;
    }
  }
  return k;
}

/** Rigidez de flexión 12×12 en ejes locales, GDL [w, θx, θy] por nudo. */
export function rigidezDkmq(xy: CoordenadasLocales, mat: MaterialLamina): Float64Array {
  const ld = lados(xy, mat);
  const Au = matrizAu(ld);
  const { D, nu, Ds } = rigidecesSeccion(mat);
  const Hb = [D, D * nu, 0, D * nu, D, 0, 0, 0, (D * (1 - nu)) / 2];
  const kb = new Float64Array(144);
  const HB = new Float64Array(36);
  for (const [xi, eta] of PUNTOS_GAUSS) {
    const { Bb, Bs, det } = matricesB(xy, ld, Au, xi, eta);
    // flexión: Bbᵀ·Hb·Bb·det
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        HB[12 * r + c] = Hb[3 * r]! * Bb[c]! + Hb[3 * r + 1]! * Bb[12 + c]! + Hb[3 * r + 2]! * Bb[24 + c]!;
      }
    }
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        kb[12 * i + j]! += (Bb[i]! * HB[j]! + Bb[12 + i]! * HB[12 + j]! + Bb[24 + i]! * HB[24 + j]!) * det;
      }
    }
    // cortante: Bsᵀ·(Ds·I)·Bs·det
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        kb[12 * i + j]! += Ds * (Bs[i]! * Bs[j]! + Bs[12 + i]! * Bs[12 + j]!) * det;
      }
    }
  }
  return deBatoz(kb);
}

/**
 * Fuerzas nodales equivalentes [Fz, Mx, My] × 4 de una presión uniforme `p` según +z local
 * (funciones bilineales para w y Gauss 2×2, como PyNite: no hay momentos nodales).
 */
export function cargaPresionDkmq(xy: CoordenadasLocales, p: number): Float64Array {
  const f = new Float64Array(12);
  for (const [xi, eta] of PUNTOS_GAUSS) {
    const { det } = jacobiano(xy, xi, eta);
    const N = [(1 - xi) * (1 - eta), (1 + xi) * (1 - eta), (1 + xi) * (1 + eta), (1 - xi) * (1 + eta)];
    for (let a = 0; a < 4; a++) f[3 * a]! += 0.25 * N[a]! * p * det;
  }
  return f;
}

export interface EsfuerzosFlexion {
  /** [Mx, My, Mxy] por punto de Gauss (4×3), kN·m/m, convenio del motor. */
  momentos: Float64Array;
  /** [Qx, Qy] por punto de Gauss (4×2), kN/m. */
  cortantes: Float64Array;
}

/** Esfuerzos de flexión en los 4 puntos de Gauss a partir de los desplazamientos locales [w, θx, θy] × 4. */
export function esfuerzosDkmq(xy: CoordenadasLocales, mat: MaterialLamina, d: ArrayLike<number>): EsfuerzosFlexion {
  const ld = lados(xy, mat);
  const Au = matrizAu(ld);
  const { D, nu, Ds } = rigidecesSeccion(mat);
  // a GDL de Batoz
  const db = new Float64Array(12);
  for (let a = 0; a < 4; a++) {
    db[3 * a] = d[3 * a]!;
    db[3 * a + 1] = d[3 * a + 2]!; // βx = θy
    db[3 * a + 2] = -d[3 * a + 1]!; // βy = −θx
  }
  const momentos = new Float64Array(12);
  const cortantes = new Float64Array(8);
  PUNTOS_GAUSS.forEach(([xi, eta], g) => {
    const { Bb, Bs } = matricesB(xy, ld, Au, xi, eta);
    const k = [0, 0, 0];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) k[r]! += Bb[12 * r + c]! * db[c]!;
    const gs = [0, 0];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 12; c++) gs[r]! += Bs[12 * r + c]! * db[c]!;
    // Momentos de Batoz (∫z·σ) y cambio al convenio del motor (−∫z·σ)
    momentos[3 * g] = -D * (k[0]! + nu * k[1]!);
    momentos[3 * g + 1] = -D * (nu * k[0]! + k[1]!);
    momentos[3 * g + 2] = (-D * (1 - nu) * k[2]!) / 2;
    cortantes[2 * g] = Ds * gs[0]!;
    cortantes[2 * g + 1] = Ds * gs[1]!;
  });
  return { momentos, cortantes };
}

/**
 * Extrapola bilinealmente desde los 4 puntos de Gauss a (ξ, η), como PyNite.
 * En el centroide (0, 0) es la media de los cuatro. `valores`: 4 × `nc` componentes.
 */
export function extrapolarGauss(valores: ArrayLike<number>, nc: number, xi: number, eta: number): Float64Array {
  const r = xi / GP;
  const s = eta / GP;
  const H = [0.25 * (1 - r) * (1 - s), 0.25 * (1 + r) * (1 - s), 0.25 * (1 + r) * (1 + s), 0.25 * (1 - r) * (1 + s)];
  const out = new Float64Array(nc);
  for (let g = 0; g < 4; g++) for (let c = 0; c < nc; c++) out[c]! += H[g]! * valores[nc * g + c]!;
  return out;
}
