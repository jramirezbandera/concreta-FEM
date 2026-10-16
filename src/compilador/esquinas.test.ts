/**
 * Fase LV2 (`docs/fem3d/refinamiento-vigas.md`), decisión LV2-g: un cruce de vigas con pilar cuya
 * esquina cae en la triangulación se queda sin plantilla de esquina, con la malla de LV1, y se avisa
 * (`malla/esquina-sin-refinar`) con los pilares del cruce.
 * En la retícula de 4 × 4 de la fase LV, los cruces de las cuatro esquinas del hueco de la escalera
 * (P12-10, P12-15, P18-10 y P18-15): allí están las peores estaciones de las franjas de LV2 (X13 y X19).
 */
import { describe, expect, it } from "vitest";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { compilar } from "./compilar.ts";
import type { OpcionesCompilacion } from "./fisico.ts";

const fisico = conAcciones(edificioReticular(1, 3, 3));
const avisos = (op: OpcionesCompilacion) => {
  const c = compilar(fisico, op);
  expect(c.valido).toBe(true);
  return c.diagnosticos.filter((d) => d.codigo === "malla/esquina-sin-refinar");
};

describe("cruces sin refinar (LV2-g)", () => {
  it("avisa de los pilares de los cruces junto al hueco, por la triangulación", () => {
    const av = avisos({ refinoEsquinas: true });
    expect(av).toHaveLength(1);
    expect(av[0]!.severidad).toBe("aviso");
    expect(av[0]!.ids).toEqual(["L-N1", "P12-10", "P12-15", "P18-10", "P18-15"]);
    expect(av[0]!.mensaje).toContain("junto a P12-10, P12-15, P18-10, P18-15");
    expect(av[0]!.mensaje).toContain("cae en la triangulación");
  });

  it("sin el refinamiento de las esquinas, o con h = 0,5 (todos los cruces caben), no avisa", () => {
    expect(avisos({ refinoEsquinas: false })).toEqual([]);
    expect(avisos({ refinoEsquinas: true, tamanoMalla: 0.5 })).toEqual([]);
  });
});
