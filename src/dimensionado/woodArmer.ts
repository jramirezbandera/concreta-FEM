/**
 * Momentos de dimensionado de Wood–Armer para armado ortogonal en láminas (Wood, Concrete 2(2),
 * 1968, con la discusión de Armer; H34).
 *
 * Portado de `docs/fem3d/investigacion/experimentos/03-resultados/wood_armer.py`, validado contra
 * LUSAS (CSN/LUSAS/1029) y contra el criterio de Johansen por búsqueda.
 *
 * Convenio de entrada: el del motor (H02). Mx produce σx y es positivo con tracción en la cara −z
 * (momento de vano con z hacia arriba); Mxy con cualquier signo (sólo cuenta |Mxy|). kN·m/m.
 *
 * Salida: momentos de dimensionado por cara y dirección, en valor absoluto (≥ 0):
 * - cara −z (inferior en losas): armadura que resiste momentos positivos;
 * - cara +z (superior en losas): armadura que resiste momentos negativos.
 *
 * Se aplica en cada punto y en cada combinación ELU con los tres momentos concomitantes. Sobre la
 * envolvente componente a componente queda del lado seguro, pero sobredimensiona hasta un 73 %
 * (H34): para eso está `envolventeWoodArmer`, que recorre las combinaciones.
 */

export interface MomentosWoodArmer {
  /** Cara −z: momento de dimensionado en x y en y (≥ 0). */
  inferiorX: number;
  inferiorY: number;
  /** Cara +z: momento de dimensionado en x y en y, en valor absoluto (≥ 0). */
  superiorX: number;
  superiorY: number;
}

/** Cara con momentos positivos (tracción en −z): devuelve (mx*, my*) ≥ 0. */
function caraPositiva(mx: number, my: number, a: number): [number, number] {
  let x = mx + a;
  let y = my + a;
  if (x < 0) {
    // mx* = 0 y my* = my + mxy²/|mx|  (mx < 0 aquí, no hay división por cero)
    y = my + (a * a) / Math.abs(mx);
    x = 0;
  }
  if (y < 0) {
    x = mx + (a * a) / Math.abs(my);
    y = 0;
  }
  // Si sigue habiendo un negativo, la cara no necesita armadura
  if (x < 0 || y < 0) return [0, 0];
  return [x, y];
}

export function woodArmer(mx: number, my: number, mxy: number): MomentosWoodArmer {
  const a = Math.abs(mxy);
  const [ix, iy] = caraPositiva(mx, my, a);
  // La cara +z es la cara positiva de los momentos cambiados de signo
  const [sx, sy] = caraPositiva(-mx, -my, a);
  return { inferiorX: ix, inferiorY: iy, superiorX: sx, superiorY: sy };
}

export interface EnvolventeWoodArmer {
  /** Máximo de cada momento de dimensionado en las combinaciones. */
  valores: MomentosWoodArmer;
  /** Índice de la combinación que lo da (−1 si es 0 en todas). */
  combinacion: { inferiorX: number; inferiorY: number; superiorX: number; superiorY: number };
}

/**
 * Wood–Armer en cada combinación y máximo por cara y dirección, con la combinación gobernante.
 * `momentos`: [Mx, My, Mxy] por combinación (3·nComb valores) en un mismo punto.
 */
export function envolventeWoodArmer(momentos: ArrayLike<number>): EnvolventeWoodArmer {
  if (momentos.length % 3 !== 0) throw new Error("se esperan ternas [Mx, My, Mxy] por combinación");
  const valores: MomentosWoodArmer = { inferiorX: 0, inferiorY: 0, superiorX: 0, superiorY: 0 };
  const combinacion = { inferiorX: -1, inferiorY: -1, superiorX: -1, superiorY: -1 };
  for (let k = 0; k < momentos.length / 3; k++) {
    const m = woodArmer(momentos[3 * k]!, momentos[3 * k + 1]!, momentos[3 * k + 2]!);
    for (const c of ["inferiorX", "inferiorY", "superiorX", "superiorY"] as const) {
      if (m[c] > valores[c]) {
        valores[c] = m[c];
        combinacion[c] = k;
      }
    }
  }
  return { valores, combinacion };
}
