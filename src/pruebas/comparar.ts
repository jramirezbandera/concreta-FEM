/**
 * Utilidades de comparación de resultados del motor para tests y oráculos: no es código del motor.
 */
import type { ResultadoCalculo, ResultadoCaso } from "../motor/modelo.ts";

/** Casos de un cálculo que tiene que ser válido; si no lo es, lanza con sus diagnósticos. */
export function casosValidos(r: ResultadoCalculo): ResultadoCaso[] {
  if (!r.valido) throw new Error(`cálculo no válido:\n${r.diagnosticos.map((d) => `  ${d.codigo}: ${d.mensaje}`).join("\n")}`);
  return r.casos;
}

/**
 * Error relativo por grupos de 6 por nudo (traslaciones / giros, o fuerzas / momentos):
 * max|a − b| / max|b| de cada grupo, el peor de los dos, sobre `nudos` (todos si se omite).
 */
export function errorPorGrupos(a: ArrayLike<number>, b: ArrayLike<number>, nudos?: readonly number[]): number {
  const lista = nudos ?? Array.from({ length: b.length / 6 }, (_, i) => i);
  let peor = 0;
  for (const g of [0, 3]) {
    let dif = 0;
    let ref = 0;
    for (const v of lista) {
      for (let c = g; c < g + 3; c++) {
        dif = Math.max(dif, Math.abs(a[6 * v + c]! - b[6 * v + c]!));
        ref = Math.max(ref, Math.abs(b[6 * v + c]!));
      }
    }
    peor = Math.max(peor, ref > 0 ? dif / ref : dif);
  }
  return peor;
}
