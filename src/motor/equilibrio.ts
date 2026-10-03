/**
 * Regla de oro 2: equilibrio global entre cargas y reacciones en cada cálculo.
 *
 * Con elementos que no hacen trabajo en un movimiento de sólido rígido y restricciones rígidas
 * (las de T), las cargas más las reacciones suman cero en fuerzas y en momentos salvo el residuo
 * del solver. Así se detectan a la vez errores de formulación de un elemento (que no esté
 * autoequilibrado), de las restricciones (una T que no sea rígida) y de la resolución.
 */
import type { Geometria } from "./elementos.ts";

export interface Equilibrio {
  /** |ΣF| / Σ|F|, con Σ|F| la suma de las normas de todas las fuerzas (cargas y reacciones). */
  fuerzas: number;
  /**
   * |ΣM| / (Σ(|x|·|F| + |M|) + Σ|F|·L), con x la posición respecto al centro del modelo y L su
   * tamaño. El término Σ|F|·L evita dividir por casi cero si todas las fuerzas pasan por el centro.
   */
  momentos: number;
}

/**
 * `f` y `r`: cargas y reacciones físicas, 6 por nudo, en ejes globales. `magnitudR` (opcional,
 * 6 por nudo) es la suma de los valores absolutos de los términos que se cancelan en cada
 * reacción: es la escala del redondeo cuando la reacción neta es casi nula (p. ej. un giro de
 * sólido rígido impuesto), y sustituye a `r` en las escalas.
 */
export function equilibrio(geo: Geometria, f: Float64Array, r: Float64Array, magnitudR?: Float64Array): Equilibrio {
  const { xyz, centro } = geo;
  const nn = xyz.length / 3;
  const F = [0, 0, 0];
  const M = [0, 0, 0];
  let escalaF = 0;
  let escalaM = 0;
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
