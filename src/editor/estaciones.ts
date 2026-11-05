/**
 * Las estaciones de una polilínea (los huecos de un muro, el tramo de una carga en viga) cuando se
 * mueve alguno de sus vértices: se vuelven a medir en su tramo, a la misma fracción. Lo usan los
 * pinzamientos (`transformar.ts`) y «Alinear» (`alinear.ts`).
 *
 * Puro: sin IO.
 */
import type { Vec2 } from "../compilador/fisico.ts";

/** La longitud acumulada hasta cada vértice. */
export const longitudes = (ps: readonly Vec2[]): number[] => {
  const r = [0];
  for (let i = 1; i < ps.length; i++) r.push(r[i - 1]! + Math.hypot(ps[i]![0] - ps[i - 1]![0], ps[i]![1] - ps[i - 1]![1]));
  return r;
};

/** La estación s de la polilínea `ps`, medida otra vez sobre `qs` (los mismos vértices, alguno movido): en su tramo, a la misma fracción. */
export function reestacionar(ps: readonly Vec2[], qs: readonly Vec2[], s: number): number {
  const [l0, l1] = [longitudes(ps), longitudes(qs)];
  let i = 0;
  while (i < ps.length - 2 && s > l0[i + 1]!) i++;
  const largo = l0[i + 1]! - l0[i]!;
  const lam = largo > 0 ? (s - l0[i]!) / largo : 0;
  const r = l1[i]! + lam * (l1[i + 1]! - l1[i]!);
  // Como las estaciones dibujadas (V2c2-1): a 1e-9 m
  return Math.min(Math.max(Math.round(r * 1e9) / 1e9, 0), l1.at(-1)!);
}
