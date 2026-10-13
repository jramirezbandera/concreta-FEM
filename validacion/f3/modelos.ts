/**
 * Modelos de la fase F3 (`docs/fem3d/cara-propia.md`): la losa de 3 × 3 vanos de F2 con pilares de
 * dos tamaños en sus alineaciones, así que la cara común de C5-g cae dentro de los mayores.
 */
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { losa3x3 } from "../f2/convergencia.ts";

/**
 * La losa de 3 × 3 vanos (6 × 5 m, pilares de 30 × 30, q = 10 kN/m²) con P6-5 de 40 × 40 (la cara
 * común, 5 cm dentro en las dos direcciones) y P12-10 de 30 × 50 con el canto según X (10 cm dentro
 * en las caras x; en las y, la suya).
 */
export function losa3x3Mezclada(): ModeloFisico {
  const f = losa3x3();
  return {
    ...f,
    secciones: [...f.secciones, { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 }, { id: "p3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 }],
    pilares: f.pilares!.map((p) => (p.id === "P6-5" ? { ...p, seccion: "p40" } : p.id === "P12-10" ? { ...p, seccion: "p3050" } : p)),
  };
}
