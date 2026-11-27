/**
 * Los momentos de empotramiento perfecto de un vano a partir de su ley de momentos (CO2-j,
 * `docs/fem3d/comprobaciones.md` §8.26): los que tendría en sus extremos, con las mismas cargas, si
 * los dos no pudieran girar. Hacen falta para el momento mínimo en la cara de un apoyo (CE Anejo 19
 * §5.3.2.2(3): no menos de 0,65 veces el de empotramiento perfecto).
 *
 * No hacen falta las cargas: cualquier ley de momentos en equilibrio con ellas difiere de la del
 * modelo en una recta. Con M₀(x) = M(x) − [M(a)·(1 − ξ) + M(b)·ξ] (la isostática: lo que queda al
 * quitar los momentos de los extremos; ξ = (x − a)/L), la de empotramiento perfecto es
 * M₀ + MA·(1 − ξ) + MB·ξ con los dos giros de extremo nulos (viga de rigidez constante, sin
 * deformación por cortante):
 *
 *   ∫ M·(1 − ξ) dx = 0,  ∫ M·ξ dx = 0   →   MA = −(4·A − 2·B)/L,  MB = −(4·B − 2·A)/L
 *
 * con A = ∫ M₀·(1 − ξ) dx y B = ∫ M₀·ξ dx. Con una carga uniforme q, A = B = q·L³/24 y
 * MA = MB = −q·L²/12. Puro; el signo, el de M (positivo, tracción abajo: con cargas hacia abajo los
 * dos salen negativos).
 */

/** Un trozo de la ley de momentos: M(x) es un polinomio de grado ≤ 4 en él (sin saltos dentro). */
export interface TrozoMomentos {
  x0: number;
  x1: number;
  M: (x: number) => number;
}

// Gauss–Legendre de 3 puntos: exacta hasta grado 5 (M cúbico por un factor lineal, de sobra)
const NODOS = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)] as const;
const PESOS = [5 / 9, 8 / 9, 5 / 9] as const;

/**
 * [MA, MB] de empotramiento perfecto entre `a` y `b` (los valores de M en ellos, `Ma` y `Mb`, se dan
 * aparte: en un extremo puede haber un salto). Los trozos cubren [a, b] sin huecos; null si no hay luz.
 */
export function momentosEmpotramiento(trozos: readonly TrozoMomentos[], a: number, b: number, Ma: number, Mb: number): [number, number] | null {
  const L = b - a;
  if (!(L > 1e-9) || !trozos.length) return null;
  let [I1, I2] = [0, 0];
  for (const t of trozos) {
    const [m, h] = [(t.x0 + t.x1) / 2, (t.x1 - t.x0) / 2];
    if (!(h > 0)) continue;
    for (let k = 0; k < 3; k++) {
      const x = m + h * NODOS[k]!;
      const xi = (x - a) / L;
      const w = PESOS[k]! * h * t.M(x);
      I1 += w * (1 - xi);
      I2 += w * xi;
    }
  }
  const A = I1 - (Ma * L) / 3 - (Mb * L) / 6;
  const B = I2 - (Ma * L) / 6 - (Mb * L) / 3;
  return [-(4 * A - 2 * B) / L, -(4 * B - 2 * A) / L];
}
