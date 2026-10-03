/**
 * Lámina cuadrilátera plana de 4 nudos y 6 GDL por nudo: geometría local y paso a ejes globales.
 *
 * Ejes locales (como PyNite, H01): x = 1→2; z = x × (1→3); y = z × x; origen en el nudo 1.
 * GDL por nudo, en locales y en globales: [ux, uy, uz, rx, ry, rz].
 */
import { rigidezDkmq, type CoordenadasLocales, type MaterialLamina } from "./dkmq.ts";
import { rigidezMembrana, type OpcionesMembrana } from "./membrana.ts";

export interface MarcoLocal {
  /** Filas: e1, e2, e3 (3×3 por filas). u_local = R·u_global. */
  R: Float64Array;
  /** Coordenadas locales de los 4 nudos [x1, y1, …, x4, y4]. */
  xy: Float64Array;
  /** Distancia máxima de un nudo al plano local (alabeo), m. */
  alabeo: number;
}

/** `X`: coordenadas globales de los 4 nudos [X1, Y1, Z1, …, X4, Y4, Z4]. */
export function marcoLocal(X: ArrayLike<number>): MarcoLocal {
  const v = (a: number) => [X[3 * a]! - X[0]!, X[3 * a + 1]! - X[1]!, X[3 * a + 2]! - X[2]!] as const;
  const v12 = v(1);
  const v13 = v(2);
  const norma = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
  const cruz = (a: readonly number[], b: readonly number[]) =>
    [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!] as const;
  const n1 = norma(v12);
  const e1 = v12.map((c) => c / n1);
  const z = cruz(e1, v13);
  const nz = norma(z);
  const e3 = z.map((c) => c / nz);
  const e2 = cruz(e3, e1);
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

/** Posiciones de [w, θx, θy] de cada nudo en el vector local de 24. */
export const GDL_FLEXION = [2, 3, 4, 8, 9, 10, 14, 15, 16, 20, 21, 22] as const;
/** Posiciones de [ux, uy, θz] de cada nudo en el vector local de 24. */
export const GDL_MEMBRANA = [0, 1, 5, 6, 7, 11, 12, 13, 17, 18, 19, 23] as const;

/** Coloca una matriz 12×12 en las posiciones `gdl` de una 24×24 (sumando). */
export function expandir(k24: Float64Array, k12: ArrayLike<number>, gdl: readonly number[]): void {
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) k24[24 * gdl[i]! + gdl[j]!]! += k12[12 * i + j]!;
}

/** K_global = Tᵀ·K_local·T con T = diag(R, …, R) (8 bloques de 3×3). */
export function rigidezAGlobales(kl: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const kg = new Float64Array(576);
  const tmp = new Float64Array(9);
  for (let I = 0; I < 8; I++) {
    for (let J = 0; J < 8; J++) {
      // tmp = K_IJ·R
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          let s = 0;
          for (let c = 0; c < 3; c++) s += kl[24 * (3 * I + a) + 3 * J + c]! * R[3 * c + b]!;
          tmp[3 * a + b] = s;
        }
      }
      // Rᵀ·tmp
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          let s = 0;
          for (let c = 0; c < 3; c++) s += R[3 * c + a]! * tmp[3 * c + b]!;
          kg[24 * (3 * I + a) + 3 * J + b] = s;
        }
      }
    }
  }
  return kg;
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

export type { CoordenadasLocales };

/** Rigidez local 24×24 de la lámina: flexión DKMQ + membrana con drilling (sin acoplamiento: elemento plano). */
export function rigidezLaminaLocal(xy: CoordenadasLocales, mat: MaterialLamina, op: OpcionesMembrana = {}): Float64Array {
  const k = new Float64Array(576);
  expandir(k, rigidezDkmq(xy, mat), GDL_FLEXION);
  expandir(k, rigidezMembrana(xy, mat, op), GDL_MEMBRANA);
  return k;
}
