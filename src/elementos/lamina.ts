/**
 * Lámina cuadrilátera plana DKMQ24 (Katili, Maknun, Batoz e Ibrahimbegovic, Compos. Struct. 202,
 * 2018): flexión DKMQ (dkmq.ts) + membrana ITW con drilling de Hughes–Brezzi (membrana.ts), de 4
 * nudos y 6 GDL por nudo [ux, uy, uz, rx, ry, rz]. Sin acoplamiento membrana–flexión: el
 * elemento es plano y su plano medio es el de los nudos (se ignora la excentricidad, como en SAP).
 *
 * Ejes de la lámina (ejes de usuario, E3). El elemento se formula directamente en ellos, así que la
 * sección (con sus multiplicadores) y las resultantes van en los mismos ejes:
 * - Eje 3 = normal del plano según el orden de los nudos (regla de la mano derecha): (X₃ − X₁) ×
 *   (X₄ − X₂). Invertir el orden de los nudos invierte la normal y el signo de los momentos (H02).
 * - Eje 1 = la dirección de referencia `eje1` proyectada sobre el plano (la de los nervios de un
 *   reticular, por ejemplo). Sin ella, la regla de CSI (SAP2000/ETABS): el eje 1 es horizontal y
 *   el 2 tiene sentido hacia arriba (+Z); si la lámina es horizontal (seno del ángulo entre el eje
 *   3 y Z menor que 1e-3), el eje 2 es +Y. Una losa con la normal hacia +Z tiene los ejes 1 y 2
 *   según X e Y.
 * - Eje 2 = eje 3 × eje 1.
 *
 * Multiplicadores (D3): f11, f22, f12 (membrana), m11, m22, m12 (flexión) y v13, v23 (cortante),
 * en los ejes 1-2. Se aplican como D' = S·D·S con S = diag(√f11, √f22, √f12) (ídem m y v): conserva
 * la simetría y la definición positiva, y cada multiplicador escala la rigidez de su componente
 * (f11 la de Nx frente a εx…). El acoplamiento de Poisson queda escalado por √(f11·f22). Falta
 * confirmar con un modelo de SAP2000 que su semántica es la misma (S5 #21). El peso no es un
 * multiplicador del motor: el peso propio lo genera el compilador como carga (H24).
 */
import {
  KAPPA,
  operadorFlexion,
  rigidezDkmq,
  rigidezFlexion,
  type CoordenadasLocales,
  type MaterialLamina,
  type SeccionFlexion,
} from "./dkmq.ts";
import {
  operadorMembrana,
  rigidezMembrana,
  rigidezMembranaSeccion,
  seccionMembranaIsotropa,
  type OpcionesMembrana,
  type SeccionMembrana,
} from "./membrana.ts";

export type { CoordenadasLocales };

/** Multiplicadores de rigidez por componente, en los ejes 1-2 de la lámina (D3). Por defecto, 1. */
export interface MultiplicadoresLamina {
  /** Membrana: Nx frente a εx (f11), Ny frente a εy (f22) y Nxy frente a γxy (f12). */
  f11?: number;
  f22?: number;
  f12?: number;
  /** Flexión: Mx (m11), My (m22) y Mxy (m12). */
  m11?: number;
  m22?: number;
  m12?: number;
  /** Cortante transversal: Qx (v13) y Qy (v23). */
  v13?: number;
  v23?: number;
}

/** Rigideces de sección de la lámina, en sus ejes 1-2. */
export interface SeccionLamina {
  membrana: SeccionMembrana;
  flexion: SeccionFlexion;
}

/** D' = S·D·S con S = diag(s) (D 3×3 por filas). */
function escalar3(D: ArrayLike<number>, s: readonly number[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(s[i]! * D[3 * i + j]! * s[j]!);
  return r;
}

/**
 * Sección de una lámina de material isótropo con multiplicadores. El γt del drilling sigue a la
 * rigidez a cortante de la membrana ya multiplicada: γt = (γ/G)·C'₃₃.
 */
export function seccionLamina(mat: MaterialLamina, mult: MultiplicadoresLamina = {}, op: OpcionesMembrana = {}): SeccionLamina {
  const m = seccionMembranaIsotropa(mat, op);
  const C = escalar3(m.C, [Math.sqrt(mult.f11 ?? 1), Math.sqrt(mult.f22 ?? 1), Math.sqrt(mult.f12 ?? 1)]);
  const D = (mat.E * mat.t ** 3) / (12 * (1 - mat.nu ** 2));
  const Hb = escalar3([D, D * mat.nu, 0, D * mat.nu, D, 0, 0, 0, (D * (1 - mat.nu)) / 2], [Math.sqrt(mult.m11 ?? 1), Math.sqrt(mult.m22 ?? 1), Math.sqrt(mult.m12 ?? 1)]);
  const Ds = (KAPPA * mat.E * mat.t) / (2 * (1 + mat.nu));
  return {
    membrana: { C, gt: (op.gamma ?? 1) * C[8]!, estabilizacion: m.estabilizacion },
    flexion: { Hb, Hs: [Ds * (mult.v13 ?? 1), 0, 0, Ds * (mult.v23 ?? 1)] },
  };
}

// ---------------------------------------------------------------------------------------------
// Geometría

export interface MarcoLocal {
  /** Filas: e1, e2, e3 (3×3 por filas). u_local = R·u_global. */
  R: Float64Array;
  /** Coordenadas locales de los 4 nudos [x1, y1, …, x4, y4]. */
  xy: Float64Array;
  /** Distancia máxima de un nudo al plano local (alabeo), m. */
  alabeo: number;
}

const norma3 = (a: ArrayLike<number>) => Math.hypot(a[0]!, a[1]!, a[2]!);
const cruz3 = (a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/**
 * Ejes locales de PyNite (H01): x = 1→2; z = x × (1→3); y = z × x; origen en el nudo 1. Los usan
 * los oráculos y los tests del spike; el motor usa los ejes de usuario (`marcoLamina`).
 * `X`: coordenadas globales de los 4 nudos [X1, Y1, Z1, …, X4, Y4, Z4].
 */
export function marcoLocal(X: ArrayLike<number>): MarcoLocal {
  const v = (a: number) => [X[3 * a]! - X[0]!, X[3 * a + 1]! - X[1]!, X[3 * a + 2]! - X[2]!] as const;
  const v12 = v(1);
  const v13 = v(2);
  const n1 = norma3(v12);
  const e1 = v12.map((c) => c / n1);
  const z = cruz3(e1, v13);
  const nz = norma3(z);
  const e3 = z.map((c) => c / nz);
  const e2 = cruz3(e3, e1);
  const R = Float64Array.of(...e1, ...e2, ...e3);
  const xy = new Float64Array(8);
  let alabeo = 0;
  for (let a = 0; a < 4; a++) {
    const d = v(a);
    xy[2 * a] = d[0] * e1[0]! + d[1] * e1[1]! + d[2] * e1[2]!;
    xy[2 * a + 1] = d[0] * e2[0]! + d[1] * e2[1]! + d[2] * e2[2]!;
    alabeo = Math.max(alabeo, Math.abs(d[0] * e3[0]! + d[1] * e3[1]! + d[2] * e3[2]!));
  }
  return { R, xy, alabeo };
}

/** Seno del ángulo entre el eje 3 y Z por debajo del cual la lámina se toma horizontal (CSI). */
export const SENO_HORIZONTAL = 1e-3;
/** Fracción mínima de `eje1` que tiene que quedar en el plano de la lámina al proyectarlo. */
export const PROYECCION_MINIMA_EJE1 = 1e-3;

/** Ejes de usuario de una lámina, con sus coordenadas locales. */
export interface MarcoLamina extends MarcoLocal {
  /** Origen de las coordenadas locales: el nudo 1 (global). */
  origen: Float64Array;
}

/**
 * Ejes de usuario (cabecera) y coordenadas locales de los 4 nudos, con el origen en el nudo 1.
 * Devuelve un texto con el motivo si no se pueden fijar: normal nula (lámina degenerada) o
 * `eje1` no finito o casi normal al plano. `alabeo`: distancia del nudo 4 al plano de 1, 2 y 3.
 */
export function marcoLamina(X: ArrayLike<number>, eje1?: ArrayLike<number>): MarcoLamina | string {
  const d13 = [X[6]! - X[0]!, X[7]! - X[1]!, X[8]! - X[2]!];
  const d24 = [X[9]! - X[3]!, X[10]! - X[4]!, X[11]! - X[5]!];
  const n = cruz3(d13, d24);
  const nn = norma3(n);
  if (!(nn > 0) || !Number.isFinite(nn)) return "la lámina es degenerada (sus diagonales son paralelas o nulas)";
  const e3 = [n[0] / nn, n[1] / nn, n[2] / nn];
  let e1: number[];
  if (eje1) {
    if (eje1.length !== 3 || !Number.isFinite(eje1[0]!) || !Number.isFinite(eje1[1]!) || !Number.isFinite(eje1[2]!)) return "su eje 1 de referencia no es un vector finito";
    const ne = norma3(eje1);
    const p = eje1[0]! * e3[0]! + eje1[1]! * e3[1]! + eje1[2]! * e3[2]!;
    const v = [eje1[0]! - p * e3[0]!, eje1[1]! - p * e3[1]!, eje1[2]! - p * e3[2]!];
    const nv = norma3(v);
    if (!(ne > 0) || !(nv > PROYECCION_MINIMA_EJE1 * ne)) return "su eje 1 de referencia es (casi) normal al plano de la lámina";
    e1 = [v[0]! / nv, v[1]! / nv, v[2]! / nv];
  } else {
    // Regla de CSI: eje 2 hacia +Z (o +Y si la lámina es horizontal) en el plano; eje 1 = 2 × 3
    const sen = Math.hypot(e3[0]!, e3[1]!);
    const ref = sen < SENO_HORIZONTAL ? [0, 1, 0] : [0, 0, 1];
    const p = ref[0]! * e3[0]! + ref[1]! * e3[1]! + ref[2]! * e3[2]!;
    const v = [ref[0]! - p * e3[0]!, ref[1]! - p * e3[1]!, ref[2]! - p * e3[2]!];
    const nv = norma3(v);
    const e2 = [v[0]! / nv, v[1]! / nv, v[2]! / nv];
    e1 = cruz3(e2, e3);
  }
  const e2 = cruz3(e3, e1);
  const R = Float64Array.of(e1[0]!, e1[1]!, e1[2]!, e2[0], e2[1], e2[2], e3[0]!, e3[1]!, e3[2]!);
  const origen = Float64Array.of(X[0]!, X[1]!, X[2]!);
  const xy = new Float64Array(8);
  for (let a = 0; a < 4; a++) {
    const dx = X[3 * a]! - X[0]!;
    const dy = X[3 * a + 1]! - X[1]!;
    const dz = X[3 * a + 2]! - X[2]!;
    xy[2 * a] = dx * R[0]! + dy * R[1]! + dz * R[2]!;
    xy[2 * a + 1] = dx * R[3]! + dy * R[4]! + dz * R[5]!;
  }
  // Alabeo: distancia del nudo 4 al plano de los nudos 1, 2 y 3 (el criterio de E1)
  const n123 = cruz3([X[3]! - X[0]!, X[4]! - X[1]!, X[5]! - X[2]!], d13);
  const m123 = norma3(n123);
  const d14 = [X[9]! - X[0]!, X[10]! - X[1]!, X[11]! - X[2]!];
  const alabeo = m123 > 0 ? Math.abs(d14[0]! * n123[0] + d14[1]! * n123[1] + d14[2]! * n123[2]) / m123 : Infinity;
  return { R, xy, alabeo, origen };
}

/** Funciones de forma bilineales en (ξ, η), en `out` (4). */
export function funcionesForma(xi: number, eta: number, out: Float64Array = new Float64Array(4)): Float64Array {
  out[0] = 0.25 * (1 - xi) * (1 - eta);
  out[1] = 0.25 * (1 + xi) * (1 - eta);
  out[2] = 0.25 * (1 + xi) * (1 + eta);
  out[3] = 0.25 * (1 - xi) * (1 + eta);
  return out;
}

/**
 * Coordenadas naturales (ξ, η) del punto (x, y) del plano local (inversa de la transformación
 * bilineal, por Newton). Devuelve null si no converge (punto muy fuera del elemento).
 */
export function coordenadasNaturales(xy: CoordenadasLocales, x: number, y: number): [number, number] | null {
  let xi = 0;
  let eta = 0;
  const N = new Float64Array(4);
  for (let it = 0; it < 50; it++) {
    funcionesForma(xi, eta, N);
    let fx = -x;
    let fy = -y;
    for (let a = 0; a < 4; a++) {
      fx += N[a]! * xy[2 * a]!;
      fy += N[a]! * xy[2 * a + 1]!;
    }
    const j11 = 0.25 * (-(1 - eta) * xy[0]! + (1 - eta) * xy[2]! + (1 + eta) * xy[4]! - (1 + eta) * xy[6]!);
    const j12 = 0.25 * (-(1 - xi) * xy[0]! - (1 + xi) * xy[2]! + (1 + xi) * xy[4]! + (1 - xi) * xy[6]!);
    const j21 = 0.25 * (-(1 - eta) * xy[1]! + (1 - eta) * xy[3]! + (1 + eta) * xy[5]! - (1 + eta) * xy[7]!);
    const j22 = 0.25 * (-(1 - xi) * xy[1]! - (1 + xi) * xy[3]! + (1 + xi) * xy[5]! + (1 - xi) * xy[7]!);
    // [x_ξ x_η; y_ξ y_η]·[dξ; dη] = −[fx; fy]
    const det = j11 * j22 - j12 * j21;
    if (!(Math.abs(det) > 0)) return null;
    const dxi = (-fx * j22 + fy * j12) / det;
    const deta = (fx * j21 - fy * j11) / det;
    xi += dxi;
    eta += deta;
    if (!Number.isFinite(xi) || !Number.isFinite(eta) || Math.abs(xi) > 10 || Math.abs(eta) > 10) return null;
    if (Math.abs(dxi) + Math.abs(deta) < 1e-14) return [xi, eta];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rigidez

/** Posiciones de [w, θx, θy] de cada nudo en el vector local de 24. */
export const GDL_FLEXION = [2, 3, 4, 8, 9, 10, 14, 15, 16, 20, 21, 22] as const;
/** Posiciones de [ux, uy, θz] de cada nudo en el vector local de 24. */
export const GDL_MEMBRANA = [0, 1, 5, 6, 7, 11, 12, 13, 17, 18, 19, 23] as const;

/** Coloca una matriz 12×12 en las posiciones `gdl` de una 24×24 (sumando). */
export function expandir(k24: Float64Array, k12: ArrayLike<number>, gdl: readonly number[]): void {
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) k24[24 * gdl[i]! + gdl[j]!] += k12[12 * i + j]!;
}

/** K_global = Tᵀ·K_local·T con T = diag(R, …, R) (8 bloques de 3×3). `out` (576). */
export function rigidezAGlobales(kl: ArrayLike<number>, R: ArrayLike<number>, out: Float64Array = new Float64Array(576)): Float64Array {
  const r0 = R[0]!, r1 = R[1]!, r2 = R[2]!, r3 = R[3]!, r4 = R[4]!, r5 = R[5]!, r6 = R[6]!, r7 = R[7]!, r8 = R[8]!;
  for (let I = 0; I < 8; I++) {
    for (let J = I; J < 8; J++) {
      const o0 = 24 * 3 * I + 3 * J;
      // t = K_IJ·R (3×3)
      const k00 = kl[o0]!, k01 = kl[o0 + 1]!, k02 = kl[o0 + 2]!;
      const k10 = kl[o0 + 24]!, k11 = kl[o0 + 25]!, k12 = kl[o0 + 26]!;
      const k20 = kl[o0 + 48]!, k21 = kl[o0 + 49]!, k22 = kl[o0 + 50]!;
      const t00 = k00 * r0 + k01 * r3 + k02 * r6, t01 = k00 * r1 + k01 * r4 + k02 * r7, t02 = k00 * r2 + k01 * r5 + k02 * r8;
      const t10 = k10 * r0 + k11 * r3 + k12 * r6, t11 = k10 * r1 + k11 * r4 + k12 * r7, t12 = k10 * r2 + k11 * r5 + k12 * r8;
      const t20 = k20 * r0 + k21 * r3 + k22 * r6, t21 = k20 * r1 + k21 * r4 + k22 * r7, t22 = k20 * r2 + k21 * r5 + k22 * r8;
      // Rᵀ·t
      out[o0] = r0 * t00 + r3 * t10 + r6 * t20;
      out[o0 + 1] = r0 * t01 + r3 * t11 + r6 * t21;
      out[o0 + 2] = r0 * t02 + r3 * t12 + r6 * t22;
      out[o0 + 24] = r1 * t00 + r4 * t10 + r7 * t20;
      out[o0 + 25] = r1 * t01 + r4 * t11 + r7 * t21;
      out[o0 + 26] = r1 * t02 + r4 * t12 + r7 * t22;
      out[o0 + 48] = r2 * t00 + r5 * t10 + r8 * t20;
      out[o0 + 49] = r2 * t01 + r5 * t11 + r8 * t21;
      out[o0 + 50] = r2 * t02 + r5 * t12 + r8 * t22;
    }
  }
  // Simetría: bloques J < I
  for (let i = 0; i < 24; i++) {
    const I = (i / 3) | 0;
    for (let j = 0; j < 3 * I; j++) out[24 * i + j] = out[24 * j + i]!;
  }
  return out;
}

/** f_global = Tᵀ·f_local (24). */
export function vectorAGlobales(fl: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const fg = new Float64Array(24);
  for (let I = 0; I < 8; I++) {
    for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += R[3 * c + b]! * fl[3 * I + c]!;
      fg[3 * I + b] = s;
    }
  }
  return fg;
}

/** u_local = T·u_global (24). */
export function vectorALocales(ug: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const ul = new Float64Array(24);
  for (let I = 0; I < 8; I++) {
    for (let a = 0; a < 3; a++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += R[3 * a + c]! * ug[3 * I + c]!;
      ul[3 * I + a] = s;
    }
  }
  return ul;
}

const KF = new Float64Array(144);
const KM = new Float64Array(144);
const KL = new Float64Array(576);

/**
 * Rigidez local 24×24 de la lámina: flexión DKMQ + membrana con drilling (sin acoplamiento:
 * elemento plano). Admite la sección general o, como en el spike, un material isótropo.
 */
export function rigidezLaminaLocal(xy: CoordenadasLocales, sec: SeccionLamina | MaterialLamina, op: OpcionesMembrana = {}): Float64Array {
  const k = new Float64Array(576);
  if ("E" in sec) {
    expandir(k, rigidezDkmq(xy, sec), GDL_FLEXION);
    expandir(k, rigidezMembrana(xy, sec, op), GDL_MEMBRANA);
    return k;
  }
  expandir(k, rigidezFlexion(xy, sec.flexion, KF), GDL_FLEXION);
  expandir(k, rigidezMembranaSeccion(xy, sec.membrana, KM), GDL_MEMBRANA);
  return k;
}

/** Rigidez 24×24 de la lámina en ejes globales (`R`: ejes de la lámina por filas). `out` (576). */
export function rigidezLaminaGlobal(xy: CoordenadasLocales, R: ArrayLike<number>, sec: SeccionLamina, out: Float64Array = new Float64Array(576)): Float64Array {
  rigidezFlexion(xy, sec.flexion, KF);
  rigidezMembranaSeccion(xy, sec.membrana, KM);
  KL.fill(0);
  for (let i = 0; i < 12; i++) {
    const fi = 24 * GDL_FLEXION[i]!;
    const mi = 24 * GDL_MEMBRANA[i]!;
    for (let j = 0; j < 12; j++) {
      KL[fi + GDL_FLEXION[j]!] = KF[12 * i + j]!;
      KL[mi + GDL_MEMBRANA[j]!] = KM[12 * i + j]!;
    }
  }
  return rigidezAGlobales(KL, R, out);
}

// ---------------------------------------------------------------------------------------------
// Resultantes

/** Componentes de las resultantes de lámina, en ejes de la lámina (1 = x, 2 = y). */
export const COMPONENTES_LAMINA = ["Nx", "Ny", "Nxy", "Mx", "My", "Mxy", "Qx", "Qy"] as const;

const OPM = new Float64Array(144);
const OPF = new Float64Array(240);

/**
 * Operador de resultantes en los 4 puntos de Gauss, en GDL locales (24): por punto, 8 filas de 24
 * que dan [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] con el convenio del motor. `out` (768).
 */
export function operadorResultantes(xy: CoordenadasLocales, sec: SeccionLamina, out: Float64Array = new Float64Array(768)): Float64Array {
  operadorMembrana(xy, sec.membrana, OPM);
  operadorFlexion(xy, sec.flexion, OPF);
  out.fill(0);
  for (let g = 0; g < 4; g++) {
    const o = 192 * g;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) out[o + 24 * r + GDL_MEMBRANA[c]!] = OPM[36 * g + 12 * r + c]!;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 12; c++) out[o + 24 * (3 + r) + GDL_FLEXION[c]!] = OPF[60 * g + 12 * r + c]!;
  }
  return out;
}
