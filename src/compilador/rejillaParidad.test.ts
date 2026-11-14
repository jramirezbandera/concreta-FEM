/**
 * A2-46 (`docs/fem3d/auditoria-2.md` §11.3): la paridad de la rejilla con un bloque de plantilla que
 * tiene celdas fuera de las losas en medio de una columna. En la retícula al azar 3 con muros y h = 0,25,
 * el bloque del pilar P0-4 partía en dos tramos una columna de celdas cubiertas, y cada tramo decidía
 * por su cuenta si se partía: en el que no, la celda regular de al lado y el borde de la plantilla no
 * partían igual su arista (malla/conformidad) y la planta iba por la triangulación sola
 * (`malla/sin-rejilla`). Ahora se igualan en el bloque y en cada tramo. En las geometrías de G y las 48
 * retículas, con h = 0,75, 0,5 y 0,25, sólo cambia esa malla (`validacion/au2/mallasA246.ts`).
 */
import { describe, expect, it } from "vitest";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";

describe("A2-46: la paridad de la rejilla junto a una plantilla con celdas fuera de la losa", () => {
  it("la retícula 3 con muros y h = 0,25 se malla con la rejilla, sin el respaldo", () => {
    const f0 = reticulaAleatoria(3);
    const f = conMurosAleatorios({ ...f0, secciones: [...f0.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f0.casos, { id: "V" }] }, 3);
    const c = compilar(f, { tamanoMalla: 0.25 });
    expect(c.valido).toBe(true);
    expect(c.diagnosticos.filter((d) => d.codigo === "malla/sin-rejilla" || d.codigo === "malla/conformidad").map((d) => d.mensaje)).toEqual([]);
  }, 120_000);
});
