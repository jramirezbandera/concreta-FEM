/**
 * Flexión de lámina DKMQ (Discrete Kirchhoff–Mindlin Quadrilateral), Katili (IJNME 36, 1993).
 *
 * Portada de `Quad3D.ke_b`, `B_b`, `B_s`, `fer`, `moment` y `shear` de PyNite 3.2.0
 * (Pynite/Quad3D.py, MIT, © 2018 D. Craig Brinck; ver NOTICE). PyNite es el oráculo bit a bit
 * de este fichero en el caso isótropo (criterio 1 del spike E0, `__fixtures__/dkmq-pynite.json`).
 *
 * Convenios de este fichero (ejes locales del elemento, z normal a la lámina):
 * - GDL por nudo, en el orden de la API: [w, θx, θy], con θ según la regla de la mano derecha.
 *   Internamente la DKMQ trabaja con los giros de la normal de Batoz, βx = θy y βy = −θx.
 * - Esfuerzos con el convenio del motor (tipo CSI, H02): Mx produce σx y es positivo con
 *   tracción en la cara −z (momento de vano positivo con z hacia arriba); Mxy = −∫ z·τxy dz;
 *   Qx, Qy = ∫ τxz dz, ∫ τyz dz. Respecto a PyNite: Mx, My y Mxy cambian de signo; Qx y Qy no.
 * - Matrices densas por filas en `Float64Array`.
 *
 * Sección general (E3): Hb (3×3) y Hs (2×2) cualesquiera, simétricas y definidas positivas, en
 * los ejes del elemento. Así entran los multiplicadores de D3 (m11, m22, m12, v13, v23). La φₖ de
 * cada lado es la anisótropa (Katili et al., Compos. Struct. 202, 2018): el cociente entre la
 * rigidez a flexión y a cortante de la «viga de Timoshenko» del lado k,
 *
 *   φₖ = 12·D_bk / (D_sk·Lₖ²),  D_bk = vₖᵀ·Hb·vₖ,  vₖ = [Cₖ², Sₖ², 2·Cₖ·Sₖ],  D_sk = [Cₖ, Sₖ]·Hs·[Cₖ, Sₖ]ᵀ,
 *
 * con (Cₖ, Sₖ) los cosenos del lado: D_bk es el momento según el lado por unidad de curvatura
 * cilíndrica según el lado. En el caso isótropo, D_bk = D y D_sk = κ·G·t, y φₖ es la de Katili
 * (1993), ec. 74: 2/(κ(1−ν))·(t/Lₖ)².
 *
 * Rendimiento (E1-6): las funciones del núcleo trabajan sobre búferes del módulo que se reutilizan
 * en cada llamada (el motor corre en un solo hilo por worker) y no reservan memoria salvo la salida.
 */

export interface MaterialLamina {
  /** Módulo de elasticidad, kN/m². */
  E: number;
  /** Coeficiente de Poisson. */
  nu: number;
  /** Espesor, m. */
  t: number;
}

/**
 * Rigideces de sección de la flexión en los ejes del elemento, por filas:
 * - `Hb` (3×3, kN·m): [Mx, My, Mxy] de Batoz (∫ z·σ) frente a [βx,x, βy,y, βx,y + βy,x];
 * - `Hs` (2×2, kN/m): [Qx, Qy] frente a [γxz, γyz].
 */
export interface SeccionFlexion {
  Hb: ArrayLike<number>;
  Hs: ArrayLike<number>;
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
/** Factor de corrección del cortante. */
export const KAPPA = 5 / 6;

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

/** Rigideces de sección de una lámina isótropa: D·[[1, ν, 0], [ν, 1, 0], [0, 0, (1−ν)/2]] y κ·G·t·I. */
export function seccionFlexionIsotropa(mat: MaterialLamina): SeccionFlexion {
  const D = (mat.E * mat.t ** 3) / (12 * (1 - mat.nu ** 2));
  const Ds = (KAPPA * mat.E * mat.t) / (2 * (1 + mat.nu));
  return { Hb: [D, D * mat.nu, 0, D * mat.nu, D, 0, 0, 0, (D * (1 - mat.nu)) / 2], Hs: [Ds, 0, 0, Ds] };
}

// ---------------------------------------------------------------------------------------------
// Núcleo: búferes del módulo

/** Lados k = 0..3 (1→2, 2→3, 3→4, 4→1): longitud, cosenos y φₖ. */
const LL = new Float64Array(4);
const CC = new Float64Array(4);
const SS = new Float64Array(4);
const PHI = new Float64Array(4);
/** [A_u] (4×12, por filas) en GDL de Batoz [w, βx, βy]. */
const AU = new Float64Array(48);
/** B_b (3×12) y B_s (2×12) en GDL de la API [w, θx, θy], en el punto de Gauss actual. */
const BB = new Float64Array(36);
const BS = new Float64Array(24);
/** Lo mismo en GDL de Batoz, antes de permutar. */
const BBB = new Float64Array(36);
const BSB = new Float64Array(24);
const BD = new Float64Array(12);
const G2 = new Float64Array(8);
const HB = new Float64Array(36);
const HSB = new Float64Array(24);
const NXI = new Float64Array(4);
const NETA = new Float64Array(4);
const PXI = new Float64Array(4);
const PETA = new Float64Array(4);

/** Prepara los lados (L, C, S, φ) y A_u de un elemento. */
function prepararLados(xy: CoordenadasLocales, Hb: ArrayLike<number>, Hs: ArrayLike<number>): void {
  AU.fill(0);
  for (let k = 0; k < 4; k++) {
    const i = k;
    const j = (k + 1) & 3;
    const dx = xy[2 * j]! - xy[2 * i]!;
    const dy = xy[2 * j + 1]! - xy[2 * i + 1]!;
    const l = Math.sqrt(dx * dx + dy * dy);
    const C = dx / l;
    const S = dy / l;
    LL[k] = l;
    CC[k] = C;
    SS[k] = S;
    // φₖ = 12·D_bk/(D_sk·Lₖ²): rigidez a flexión y a cortante de la viga del lado k
    const v0 = C * C;
    const v1 = S * S;
    const v2 = 2 * C * S;
    const Dbk =
      v0 * (Hb[0]! * v0 + Hb[1]! * v1 + Hb[2]! * v2) + v1 * (Hb[3]! * v0 + Hb[4]! * v1 + Hb[5]! * v2) + v2 * (Hb[6]! * v0 + Hb[7]! * v1 + Hb[8]! * v2);
    const Dsk = C * (Hs[0]! * C + Hs[1]! * S) + S * (Hs[2]! * C + Hs[3]! * S);
    PHI[k] = (12 * Dbk) / (Dsk * l * l);
    AU[12 * k + 3 * i] = -1 / l;
    AU[12 * k + 3 * i + 1] = 0.5 * C;
    AU[12 * k + 3 * i + 2] = 0.5 * S;
    AU[12 * k + 3 * j] = 1 / l;
    AU[12 * k + 3 * j + 1] = 0.5 * C;
    AU[12 * k + 3 * j + 2] = 0.5 * S;
  }
}

/**
 * Llena BB (3×12) y BS (2×12) en (ξ, η), en GDL de la API [w, θx, θy], y devuelve det J.
 * B_b = B_bβ + B_bΔβ·A_Δ⁻¹·A_u;  B_s = J⁻¹·N_γ·A_γ·A_φΔ·A_u  (Katili 1993). Requiere prepararLados.
 */
function matricesB(xy: CoordenadasLocales, xi: number, eta: number): number {
  const x1 = xy[0]!, y1 = xy[1]!, x2 = xy[2]!, y2 = xy[3]!, x3 = xy[4]!, y3 = xy[5]!, x4 = xy[6]!, y4 = xy[7]!;
  const j11 = 0.25 * (x1 * (eta - 1) - x2 * (eta - 1) + x3 * (eta + 1) - x4 * (eta + 1));
  const j12 = 0.25 * (y1 * (eta - 1) - y2 * (eta - 1) + y3 * (eta + 1) - y4 * (eta + 1));
  const j21 = 0.25 * (x1 * (xi - 1) - x2 * (xi + 1) + x3 * (xi + 1) - x4 * (xi - 1));
  const j22 = 0.25 * (y1 * (xi - 1) - y2 * (xi + 1) + y3 * (xi + 1) - y4 * (xi - 1));
  const det = j11 * j22 - j12 * j21;
  const i11 = j22 / det;
  const i12 = -j12 / det;
  const i21 = -j21 / det;
  const i22 = j11 / det;

  BBB.fill(0);
  // B_bβ: derivadas de las funciones bilineales
  NXI[0] = 0.25 * (eta - 1);
  NXI[1] = -0.25 * (eta - 1);
  NXI[2] = 0.25 * (eta + 1);
  NXI[3] = -0.25 * (eta + 1);
  NETA[0] = 0.25 * (xi - 1);
  NETA[1] = -0.25 * (xi + 1);
  NETA[2] = 0.25 * (xi + 1);
  NETA[3] = -0.25 * (xi - 1);
  for (let a = 0; a < 4; a++) {
    const Nx = i11 * NXI[a]! + i12 * NETA[a]!;
    const Ny = i21 * NXI[a]! + i22 * NETA[a]!;
    BBB[3 * a + 1] = Nx; // fila 0: βx,x
    BBB[12 + 3 * a + 2] = Ny; // fila 1: βy,y
    BBB[24 + 3 * a + 1] = Ny; // fila 2: βx,y + βy,x
    BBB[24 + 3 * a + 2] = Nx;
  }

  // B_bΔβ (3×4): derivadas de las funciones cuadráticas de lado Pₖ, ya por A_Δ⁻¹ = diag(−3/2/(1+φₖ))
  PXI[0] = xi * (eta - 1);
  PXI[1] = -0.5 * (eta - 1) * (eta + 1);
  PXI[2] = -xi * (eta + 1);
  PXI[3] = 0.5 * (eta - 1) * (eta + 1);
  PETA[0] = 0.5 * (xi - 1) * (xi + 1);
  PETA[1] = -eta * (xi + 1);
  PETA[2] = -0.5 * (xi - 1) * (xi + 1);
  PETA[3] = eta * (xi - 1);
  for (let k = 0; k < 4; k++) {
    const Px = i11 * PXI[k]! + i12 * PETA[k]!;
    const Py = i21 * PXI[k]! + i22 * PETA[k]!;
    const C = CC[k]!;
    const S = SS[k]!;
    const f = -1.5 / (1 + PHI[k]!);
    BD[k] = f * Px * C;
    BD[4 + k] = f * Py * S;
    BD[8 + k] = f * (Py * C + Px * S);
  }
  // B_b += B_bΔβ·A_u (cada fila de A_u tiene 6 términos no nulos: nudos k y k+1)
  for (let k = 0; k < 4; k++) {
    const i = 3 * k;
    const j = 3 * ((k + 1) & 3);
    const a0 = AU[12 * k + i]!, a1 = AU[12 * k + i + 1]!, a2 = AU[12 * k + i + 2]!;
    const b0 = AU[12 * k + j]!, b1 = AU[12 * k + j + 1]!, b2 = AU[12 * k + j + 2]!;
    for (let r = 0; r < 3; r++) {
      const d = BD[4 * r + k]!;
      const o = 12 * r;
      BBB[o + i] += d * a0;
      BBB[o + i + 1] += d * a1;
      BBB[o + i + 2] += d * a2;
      BBB[o + j] += d * b0;
      BBB[o + j + 1] += d * b1;
      BBB[o + j + 2] += d * b2;
    }
  }

  // B_s: J⁻¹ · N_γ · A_γ · A_φΔ · A_u
  // N_γ = [[½(1−η), 0, ½(1+η), 0], [0, ½(1+ξ), 0, ½(1−ξ)]];  A_γ = [L₀, L₁, −L₂, −L₃]/2
  for (let k = 0; k < 4; k++) {
    const ag = (k < 2 ? 0.5 : -0.5) * LL[k]!;
    const d = ag * (PHI[k]! / (1 + PHI[k]!));
    const n0 = (k === 0 ? 0.5 * (1 - eta) : k === 2 ? 0.5 * (1 + eta) : 0) * d;
    const n1 = (k === 1 ? 0.5 * (1 + xi) : k === 3 ? 0.5 * (1 - xi) : 0) * d;
    G2[k] = i11 * n0 + i12 * n1;
    G2[4 + k] = i21 * n0 + i22 * n1;
  }
  BSB.fill(0);
  for (let k = 0; k < 4; k++) {
    const i = 3 * k;
    const j = 3 * ((k + 1) & 3);
    for (let r = 0; r < 2; r++) {
      const g = G2[4 * r + k]!;
      const o = 12 * r;
      BSB[o + i] += g * AU[12 * k + i]!;
      BSB[o + i + 1] += g * AU[12 * k + i + 1]!;
      BSB[o + i + 2] += g * AU[12 * k + i + 2]!;
      BSB[o + j] += g * AU[12 * k + j]!;
      BSB[o + j + 1] += g * AU[12 * k + j + 1]!;
      BSB[o + j + 2] += g * AU[12 * k + j + 2]!;
    }
  }

  // De GDL de Batoz [w, βx, βy] a los de la API [w, θx, θy]: θx = −βy, θy = βx
  for (let r = 0; r < 3; r++) {
    const o = 12 * r;
    for (let a = 0; a < 4; a++) {
      const c = o + 3 * a;
      BB[c] = BBB[c]!;
      BB[c + 1] = -BBB[c + 2]!;
      BB[c + 2] = BBB[c + 1]!;
    }
  }
  for (let r = 0; r < 2; r++) {
    const o = 12 * r;
    for (let a = 0; a < 4; a++) {
      const c = o + 3 * a;
      BS[c] = BSB[c]!;
      BS[c + 1] = -BSB[c + 2]!;
      BS[c + 2] = BSB[c + 1]!;
    }
  }
  return det;
}

/**
 * Rigidez de flexión 12×12 en ejes locales, GDL [w, θx, θy] por nudo, con una sección general.
 * `out` (144) se sobrescribe; por defecto, uno nuevo.
 */
export function rigidezFlexion(xy: CoordenadasLocales, sec: SeccionFlexion, out: Float64Array = new Float64Array(144)): Float64Array {
  const { Hb, Hs } = sec;
  prepararLados(xy, Hb, Hs);
  out.fill(0);
  for (let g = 0; g < 4; g++) {
    const det = matricesB(xy, PUNTOS_GAUSS[g]![0], PUNTOS_GAUSS[g]![1]);
    // HB = Hb·Bb (3×12), HSB = Hs·Bs (2×12)
    for (let r = 0; r < 3; r++) {
      const h0 = Hb[3 * r]! * det, h1 = Hb[3 * r + 1]! * det, h2 = Hb[3 * r + 2]! * det;
      for (let c = 0; c < 12; c++) HB[12 * r + c] = h0 * BB[c]! + h1 * BB[12 + c]! + h2 * BB[24 + c]!;
    }
    for (let r = 0; r < 2; r++) {
      const h0 = Hs[2 * r]! * det, h1 = Hs[2 * r + 1]! * det;
      for (let c = 0; c < 12; c++) HSB[12 * r + c] = h0 * BS[c]! + h1 * BS[12 + c]!;
    }
    // k += Bbᵀ·HB + Bsᵀ·HSB (triángulo superior)
    for (let i = 0; i < 12; i++) {
      const b0 = BB[i]!, b1 = BB[12 + i]!, b2 = BB[24 + i]!, s0 = BS[i]!, s1 = BS[12 + i]!;
      const o = 12 * i;
      for (let j = i; j < 12; j++) out[o + j] += b0 * HB[j]! + b1 * HB[12 + j]! + b2 * HB[24 + j]! + s0 * HSB[j]! + s1 * HSB[12 + j]!;
    }
  }
  for (let i = 0; i < 12; i++) for (let j = 0; j < i; j++) out[12 * i + j] = out[12 * j + i]!;
  return out;
}

/** Rigidez de flexión 12×12 de una lámina isótropa (la de PyNite), GDL [w, θx, θy] por nudo. */
export function rigidezDkmq(xy: CoordenadasLocales, mat: MaterialLamina): Float64Array {
  return rigidezFlexion(xy, seccionFlexionIsotropa(mat));
}

/**
 * Operador de esfuerzos de flexión en los 4 puntos de Gauss: por punto, 5 filas de 12 (GDL
 * [w, θx, θy] × 4) que dan [Mx, My, Mxy, Qx, Qy] con el convenio del motor. `out` (240).
 */
export function operadorFlexion(xy: CoordenadasLocales, sec: SeccionFlexion, out: Float64Array = new Float64Array(240)): Float64Array {
  const { Hb, Hs } = sec;
  prepararLados(xy, Hb, Hs);
  for (let g = 0; g < 4; g++) {
    matricesB(xy, PUNTOS_GAUSS[g]![0], PUNTOS_GAUSS[g]![1]);
    const o = 60 * g;
    // Momentos de Batoz (∫z·σ) y cambio al convenio del motor (−∫z·σ)
    for (let r = 0; r < 3; r++) {
      const h0 = Hb[3 * r]!, h1 = Hb[3 * r + 1]!, h2 = Hb[3 * r + 2]!;
      for (let c = 0; c < 12; c++) out[o + 12 * r + c] = -(h0 * BB[c]! + h1 * BB[12 + c]! + h2 * BB[24 + c]!);
    }
    for (let r = 0; r < 2; r++) {
      const h0 = Hs[2 * r]!, h1 = Hs[2 * r + 1]!;
      for (let c = 0; c < 12; c++) out[o + 36 + 12 * r + c] = h0 * BS[c]! + h1 * BS[12 + c]!;
    }
  }
  return out;
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
export function esfuerzosFlexion(xy: CoordenadasLocales, sec: SeccionFlexion, d: ArrayLike<number>): EsfuerzosFlexion {
  const op = operadorFlexion(xy, sec);
  const momentos = new Float64Array(12);
  const cortantes = new Float64Array(8);
  for (let g = 0; g < 4; g++) {
    for (let r = 0; r < 5; r++) {
      let s = 0;
      for (let c = 0; c < 12; c++) s += op[60 * g + 12 * r + c]! * d[c]!;
      if (r < 3) momentos[3 * g + r] = s;
      else cortantes[2 * g + r - 3] = s;
    }
  }
  return { momentos, cortantes };
}

/** Esfuerzos de flexión de una lámina isótropa en los 4 puntos de Gauss (los de PyNite, con signo del motor). */
export function esfuerzosDkmq(xy: CoordenadasLocales, mat: MaterialLamina, d: ArrayLike<number>): EsfuerzosFlexion {
  return esfuerzosFlexion(xy, seccionFlexionIsotropa(mat), d);
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
