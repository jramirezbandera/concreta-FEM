/**
 * Criterio 6 de C2: catálogo de entradas no válidas de las losas, apoyos lineales, bandas y cargas
 * de superficie y lineales. Cada una es una mutación de un modelo válido y tiene que acabar en un
 * error con su código y el id físico del culpable, sin lanzar nunca.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";
import { base, CATALOGO } from "../pruebas/invalidos-c2.ts";

describe("criterio 6 de C2: entradas no válidas", () => {
  it("el modelo base es válido", () => {
    const r = compilar(base());
    expect(r.valido, JSON.stringify(r.diagnosticos.map((d) => d.mensaje))).toBe(true);
  });

  it.each(CATALOGO)("%s → %s", (_n, mutar, codigo, id, opciones) => {
    const f = structuredClone(base()) as Record<string, unknown> & ModeloFisico;
    mutar(f);
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(f, opciones))).not.toThrow();
    expect(r!.valido).toBe(false);
    const d = r!.diagnosticos.filter((x) => x.codigo === codigo);
    expect(d.length, `${codigo} no está en ${r!.diagnosticos.map((x) => `${x.codigo} (${x.mensaje})`).join("; ")}`).toBeGreaterThan(0);
    for (const x of r!.diagnosticos) expect(x.codigo).not.toBe("compilador/error-interno");
    if (id) expect(d.some((x) => x.ids?.includes(id)), `${codigo} sin el id ${id}: ${JSON.stringify(d.map((x) => x.ids))}`).toBe(true);
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(45);
  });
});
