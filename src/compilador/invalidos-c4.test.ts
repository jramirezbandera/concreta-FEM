/**
 * Criterio 6 de C4: catálogo de entradas no válidas de los paños unidireccionales, los reticulares y
 * las cargas sobre paños. Cada una es una mutación de un modelo válido y tiene que acabar en un error
 * con su código y el id físico del culpable, sin lanzar nunca.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";
import { base, CATALOGO } from "../pruebas/invalidos-c4.ts";

describe("criterio 6 de C4: entradas no válidas", () => {
  it("el modelo base es válido", () => {
    const r = compilar(base());
    expect(r.valido, JSON.stringify(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje))).toBe(true);
  });

  it.each(CATALOGO)("%s → %s", (_n, mutar, codigo, id) => {
    const f = structuredClone(base()) as Record<string, unknown> & ModeloFisico;
    mutar(f);
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(f))).not.toThrow();
    expect(r!.valido).toBe(false);
    const d = r!.diagnosticos.filter((x) => x.codigo === codigo);
    expect(d.length, `${codigo} no está en ${r!.diagnosticos.map((x) => `${x.codigo} (${x.mensaje})`).join("; ")}`).toBeGreaterThan(0);
    for (const x of r!.diagnosticos) expect(x.codigo).not.toBe("compilador/error-interno");
    if (id) expect(d.some((x) => x.ids?.includes(id)), `${codigo} sin el id ${id}: ${JSON.stringify(d.map((x) => x.ids))}`).toBe(true);
  });

  it("modificadores de las viguetas no válidos: error de opciones, sin lanzar", () => {
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(base(), { modificadores: { viguetas: { todos: { K: 2 } as never } } }))).not.toThrow();
    expect(r!.valido).toBe(false);
    expect(r!.diagnosticos.map((d) => d.codigo)).toContain("opciones/no-validas");
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(40);
  });
});
