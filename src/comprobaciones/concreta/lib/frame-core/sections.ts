// Fichero propio de Concreta FEM, no de Concreta: lo escribe `scripts/copiar-concreta.ts` en el
// sitio de `src/lib/frame-core/sections.ts` (véase `manifiesto.json`, `sustituciones`).
//
// Las copias sólo le piden el módulo elástico del hormigón con el que se calculó la estructura.
// En Concreta es el de la EHE-08; en este motor, el Ecm del Código Estructural (CY-a).
import { hormigon } from "../../../../secciones/seccion3D.ts";

/** E del hormigón del cálculo, MPa: el de `hormigon(fck)` (kN/m² → MPa). */
export function rcElasticModulusMPa(fck: number): number {
  return hormigon(fck).E / 1e3;
}
