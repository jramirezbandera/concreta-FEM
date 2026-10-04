/**
 * Cotas de las plantas a partir de sus alturas (H33, COM-17). Copiado de `cotasEdificio()` de
 * `src/lib/edificio/index.ts` de Concreta (wh0am1-dev/concreta), para que las cotas del modelo
 * 3D sean las mismas que ven los demás módulos.
 */
import type { Planta } from "./fisico.ts";

/**
 * Cota del forjado de cada planta, m, en el orden de la lista (de arriba abajo).
 *
 * El forjado de la planta sobre rasante MÁS BAJA (la última de la lista que no es sótano) está a
 * ±0,00. Hacia arriba, cada forjado está a la cota del de debajo más la altura de la planta de
 * debajo; hacia abajo, un sótano está a la cota del de encima menos su propia altura. `null` donde
 * no se puede saber: falta la altura de alguna planta entre medias. Si todo el edificio está
 * enterrado, el forjado de arriba se toma a ±0,00.
 */
export function cotasPlantas(plantas: readonly Pick<Planta, "tipo" | "altura">[]): (number | null)[] {
  const cotas: (number | null)[] = plantas.map(() => null);
  if (plantas.length === 0) return cotas;
  let origen = 0;
  for (let i = plantas.length - 1; i >= 0; i--) {
    if (plantas[i]!.tipo !== "sotano") {
      origen = i;
      break;
    }
  }
  cotas[origen] = 0;
  for (let i = origen - 1; i >= 0; i--) {
    const abajo = cotas[i + 1]!;
    const h = plantas[i + 1]!.altura;
    cotas[i] = abajo === null || h === null ? null : abajo + h;
  }
  for (let j = origen + 1; j < plantas.length; j++) {
    const arriba = cotas[j - 1]!;
    const h = plantas[j]!.altura;
    cotas[j] = arriba === null || h === null ? null : arriba - h;
  }
  return cotas;
}
