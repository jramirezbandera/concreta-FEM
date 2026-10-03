/**
 * Parche de MacNeal y Harder (Finite Elements in Analysis and Design 1, 1985): rectángulo
 * 0,24 × 0,12 con 5 cuadriláteros irregulares. Los 4 nudos exteriores (0–3) llevan el campo
 * exacto impuesto; los 4 interiores (4–7) son libres y tienen que reproducirlo.
 */
export const PARCHE_NUDOS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.24, 0],
  [0.24, 0.12],
  [0, 0.12],
  [0.04, 0.02],
  [0.18, 0.03],
  [0.16, 0.08],
  [0.08, 0.08],
];

/** Conectividad en sentido antihorario. */
export const PARCHE_QUADS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
  [4, 5, 6, 7],
];

export const PARCHE_EXTERIORES = [0, 1, 2, 3] as const;
