/**
 * Combinaciones y envolventes de resultados por caso (C5.4, H21, H36). Todo lo que da el motor es
 * lineal en los casos: el valor de una combinación es Σ fₖ·valorₖ, con fₖ los factores de sus casos
 * (los de `src/combinaciones/`, o unos dados). Los vectores por caso van seguidos: n valores del
 * caso 0, n del caso 1… (el formato de los esfuerzos de `Cortes`, 6·nc).
 */

/** Combinación lineal de un vector por caso (n valores por caso) con unos factores por caso. */
export function combinar(porCaso: ArrayLike<number>, n: number, factores: ArrayLike<number>): Float64Array {
  const r = new Float64Array(n);
  for (let k = 0; k < factores.length; k++) {
    const a = factores[k]!;
    if (a) for (let q = 0; q < n; q++) r[q]! += a * porCaso[n * k + q]!;
  }
  return r;
}

/**
 * Envolvente de cada componente en unas combinaciones: máximo y mínimo, y la combinación (su
 * índice) que da cada uno (H36). La concomitancia de una componente con las demás es la combinación
 * entera de esa combinación (`combinar`). Un NaN (una componente sin valor, E5-1) no gobierna nunca:
 * si todas lo son, la envolvente es NaN con índice −1.
 */
export interface Envolvente {
  max: Float64Array;
  min: Float64Array;
  combinacionMax: Int32Array;
  combinacionMin: Int32Array;
}

export function envolvente(porCaso: ArrayLike<number>, n: number, combinaciones: readonly ArrayLike<number>[]): Envolvente {
  const e: Envolvente = {
    max: new Float64Array(n).fill(Number.NaN),
    min: new Float64Array(n).fill(Number.NaN),
    combinacionMax: new Int32Array(n).fill(-1),
    combinacionMin: new Int32Array(n).fill(-1),
  };
  combinaciones.forEach((f, c) => {
    const v = combinar(porCaso, n, f);
    for (let q = 0; q < n; q++) {
      const x = v[q]!;
      if (Number.isNaN(x)) continue;
      if (e.combinacionMax[q] < 0 || x > e.max[q]!) {
        e.max[q] = x;
        e.combinacionMax[q] = c;
      }
      if (e.combinacionMin[q] < 0 || x < e.min[q]!) {
        e.min[q] = x;
        e.combinacionMin[q] = c;
      }
    }
  });
  return e;
}

/** Factores de un caso suelto (1 en el caso k, 0 en los demás). */
export function factoresCaso(k: number, nc: number): Float64Array {
  const f = new Float64Array(nc);
  f[k] = 1;
  return f;
}
