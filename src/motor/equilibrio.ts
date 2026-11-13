/**
 * Regla de oro 2: equilibrio global entre cargas y reacciones en cada cálculo.
 *
 * Con elementos que no hacen trabajo en un movimiento de sólido rígido y restricciones rígidas
 * (las de T), las cargas más las reacciones suman cero en fuerzas y en momentos salvo el residuo
 * del solver. Así se detectan a la vez errores de formulación de un elemento (que no esté
 * autoequilibrado), de las restricciones (una T que no sea rígida) y de la resolución.
 */
import type { Resultante } from "./barras.ts";
import type { Geometria } from "./geometria.ts";

export interface Equilibrio {
  /** |ΣF| / Σ|F|, con Σ|F| la suma de las normas de todas las fuerzas (cargas y reacciones). */
  fuerzas: number;
  /**
   * |ΣM| / (Σ(|x|·|F| + |M|) + Σ|F|·L), con x la posición respecto al centro del modelo y L su
   * tamaño. El término Σ|F|·L evita dividir por casi cero si todas las fuerzas pasan por el centro.
   */
  momentos: number;
}

/** Suma de resultantes de cargas no nodales (de barra y de lámina), con sus escalas. */
export function sumaResultantes(a: Resultante, b: Resultante): Resultante {
  return {
    F: [a.F[0] + b.F[0], a.F[1] + b.F[1], a.F[2] + b.F[2]],
    M: [a.M[0] + b.M[0], a.M[1] + b.M[1], a.M[2] + b.M[2]],
    escalaF: a.escalaF + b.escalaF,
    escalaM: a.escalaM + b.escalaM,
  };
}

/**
 * `f` y `r`: cargas y reacciones físicas, 6 por nudo, en ejes globales. `magnitudR` (opcional,
 * 6 por nudo) es la suma de los valores absolutos de los términos que se cancelan en cada
 * reacción: es la escala del redondeo cuando la reacción neta es casi nula (p. ej. un giro de
 * sólido rígido impuesto), y sustituye a `r` en las escalas. `extra` es la resultante de las
 * cargas que no son nodales (de barra y de lámina), respecto al centro del modelo, con sus escalas.
 */
export function equilibrio(geo: Geometria, f: Float64Array, r: Float64Array, magnitudR?: Float64Array, extra?: Resultante): Equilibrio {
  const { xyz, centro } = geo;
  const nn = xyz.length / 3;
  const F = extra ? [...extra.F] : [0, 0, 0];
  const M = extra ? [...extra.M] : [0, 0, 0];
  let escalaF = extra?.escalaF ?? 0;
  let escalaM = extra?.escalaM ?? 0;
  const v = [0, 0, 0];
  for (let i = 0; i < nn; i++) {
    const x = xyz[3 * i]! - centro[0];
    const y = xyz[3 * i + 1]! - centro[1];
    const z = xyz[3 * i + 2]! - centro[2];
    for (const [vec, mag] of [
      [f, f],
      [r, magnitudR ?? r],
    ] as const) {
      const b = 6 * i;
      const fx = vec[b]!;
      const fy = vec[b + 1]!;
      const fz = vec[b + 2]!;
      const mx = vec[b + 3]!;
      const my = vec[b + 4]!;
      const mz = vec[b + 5]!;
      const ef = Math.hypot(mag[b]!, mag[b + 1]!, mag[b + 2]!);
      const em = Math.hypot(mag[b + 3]!, mag[b + 4]!, mag[b + 5]!);
      if (ef === 0 && em === 0) continue;
      F[0]! += fx;
      F[1]! += fy;
      F[2]! += fz;
      escalaF += ef;
      v[0] = y * fz - z * fy;
      v[1] = z * fx - x * fz;
      v[2] = x * fy - y * fx;
      M[0]! += v[0] + mx;
      M[1]! += v[1] + my;
      M[2]! += v[2] + mz;
      escalaM += Math.hypot(x, y, z) * ef + em;
    }
  }
  return {
    fuerzas: escalaF > 0 ? Math.hypot(F[0]!, F[1]!, F[2]!) / escalaF : 0,
    momentos: escalaM > 0 ? Math.hypot(M[0]!, M[1]!, M[2]!) / (escalaM + escalaF * geo.tamano) : 0,
  };
}

/**
 * A2-10: el mismo desequilibrio, referido sólo a las cargas (las nodales `f` y las de barra y lámina
 * `extra`); null si el caso no tiene cargas. La escala de `equilibrio` lleva las reacciones y su
 * `magnitudR` (Σ|k·u|), que crecen con u: en un mecanismo que el pivote no ve, u se dispara y el
 * desequilibrio relativo queda en el redondeo aunque las reacciones no equilibren las cargas.
 */
export function desequilibrioCargas(geo: Geometria, f: Float64Array, r: Float64Array, extra?: Resultante): Equilibrio | null {
  const { xyz, centro } = geo;
  const nn = xyz.length / 3;
  const F = extra ? [...extra.F] : [0, 0, 0];
  const M = extra ? [...extra.M] : [0, 0, 0];
  let escalaF = extra?.escalaF ?? 0;
  let escalaM = extra?.escalaM ?? 0;
  for (let i = 0; i < nn; i++) {
    const x = xyz[3 * i]! - centro[0];
    const y = xyz[3 * i + 1]! - centro[1];
    const z = xyz[3 * i + 2]! - centro[2];
    for (const [vec, carga] of [
      [f, true],
      [r, false],
    ] as const) {
      const b = 6 * i;
      const [fx, fy, fz, mx, my, mz] = [vec[b]!, vec[b + 1]!, vec[b + 2]!, vec[b + 3]!, vec[b + 4]!, vec[b + 5]!];
      F[0]! += fx;
      F[1]! += fy;
      F[2]! += fz;
      M[0]! += y * fz - z * fy + mx;
      M[1]! += z * fx - x * fz + my;
      M[2]! += x * fy - y * fx + mz;
      if (!carga) continue;
      const ef = Math.hypot(fx, fy, fz);
      escalaF += ef;
      escalaM += Math.hypot(x, y, z) * ef + Math.hypot(mx, my, mz);
    }
  }
  if (!(escalaF > 0 || escalaM > 0)) return null;
  return {
    fuerzas: escalaF > 0 ? Math.hypot(F[0]!, F[1]!, F[2]!) / escalaF : 0,
    momentos: Math.hypot(M[0]!, M[1]!, M[2]!) / (escalaM + escalaF * geo.tamano),
  };
}
