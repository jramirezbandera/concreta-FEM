/**
 * Barra 3D de Euler–Bernoulli (12 GDL), versión mínima para el spike E0.
 *
 * Sólo la usan los ensayos de membrana con una viga en el plano del muro (criterio 2). La barra
 * del motor (Timoshenko, offsets, punto de inserción, liberaciones y modificadores) es E2.
 *
 * Ejes locales: x = i→j; z local según el vector de referencia `vz` proyectado (la dirección del
 * canto, H02); y = z × x. GDL por nudo: [ux, uy, uz, rx, ry, rz].
 */

export interface SeccionBarra {
  E: number;
  G: number;
  A: number;
  /** Inercia para la flexión alrededor del eje local y (canto según z), m⁴. */
  Iy: number;
  /** Inercia para la flexión alrededor del eje local z, m⁴. */
  Iz: number;
  J: number;
}

/** Matriz 3×3 por filas (e1, e2, e3) y longitud. u_local = R·u_global. */
export function marcoBarra(Xi: ArrayLike<number>, Xj: ArrayLike<number>, vz: ArrayLike<number>): { R: Float64Array; L: number } {
  const d = [Xj[0]! - Xi[0]!, Xj[1]! - Xi[1]!, Xj[2]! - Xi[2]!];
  const L = Math.hypot(d[0]!, d[1]!, d[2]!);
  const e1 = d.map((c) => c / L);
  const p = vz[0]! * e1[0]! + vz[1]! * e1[1]! + vz[2]! * e1[2]!;
  const z = [vz[0]! - p * e1[0]!, vz[1]! - p * e1[1]!, vz[2]! - p * e1[2]!];
  const nz = Math.hypot(z[0]!, z[1]!, z[2]!);
  if (nz < 1e-9) throw new Error("el vector de referencia de la barra es paralelo a su eje");
  const e3 = z.map((c) => c / nz);
  const e2 = [e3[1]! * e1[2]! - e3[2]! * e1[1]!, e3[2]! * e1[0]! - e3[0]! * e1[2]!, e3[0]! * e1[1]! - e3[1]! * e1[0]!];
  return { R: Float64Array.of(...e1, ...e2, ...e3), L };
}

/** Rigidez local 12×12 (por filas). */
export function rigidezBarraLocal(L: number, s: SeccionBarra): Float64Array {
  const k = new Float64Array(144);
  const pon = (i: number, j: number, v: number) => {
    k[12 * i + j] = v;
    k[12 * j + i] = v;
  };
  const EA = (s.E * s.A) / L;
  const GJ = (s.G * s.J) / L;
  pon(0, 0, EA); pon(6, 6, EA); pon(0, 6, -EA);
  pon(3, 3, GJ); pon(9, 9, GJ); pon(3, 9, -GJ);
  // Flexión en el plano x-y (alrededor de z): v, θz
  const a = (12 * s.E * s.Iz) / L ** 3;
  const b = (6 * s.E * s.Iz) / L ** 2;
  const c = (4 * s.E * s.Iz) / L;
  const e = (2 * s.E * s.Iz) / L;
  pon(1, 1, a); pon(7, 7, a); pon(1, 7, -a);
  pon(1, 5, b); pon(1, 11, b); pon(5, 7, -b); pon(7, 11, -b);
  pon(5, 5, c); pon(11, 11, c); pon(5, 11, e);
  // Flexión en el plano x-z (alrededor de y): w, θy
  const a2 = (12 * s.E * s.Iy) / L ** 3;
  const b2 = (6 * s.E * s.Iy) / L ** 2;
  const c2 = (4 * s.E * s.Iy) / L;
  const e2 = (2 * s.E * s.Iy) / L;
  pon(2, 2, a2); pon(8, 8, a2); pon(2, 8, -a2);
  pon(2, 4, -b2); pon(2, 10, -b2); pon(4, 8, b2); pon(8, 10, b2);
  pon(4, 4, c2); pon(10, 10, c2); pon(4, 10, e2);
  return k;
}

/** Rigidez en ejes globales: Tᵀ·k·T con T = diag(R, R, R, R). */
export function rigidezBarraGlobal(kl: ArrayLike<number>, R: ArrayLike<number>): Float64Array {
  const kg = new Float64Array(144);
  for (let I = 0; I < 4; I++) for (let J = 0; J < 4; J++) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) s += R[3 * p + a]! * kl[12 * (3 * I + p) + 3 * J + q]! * R[3 * q + b]!;
      kg[12 * (3 * I + a) + 3 * J + b] = s;
    }
  }
  return kg;
}
