/**
 * Criterio 5 de C1: catálogo de modelos físicos no válidos. Cada uno es una mutación de un modelo
 * válido y tiene que acabar en un error con su código y con el id físico del objeto culpable,
 * sin lanzar nunca (la entrada puede venir de un fichero).
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";
import { base, CATALOGO, type Mutable } from "../pruebas/invalidos-c1.ts";

describe("criterio 5 de C1: entradas físicas no válidas", () => {
  it("el modelo base es válido y no tiene avisos", () => {
    const r = compilar(base());
    expect(r.diagnosticos).toEqual([]);
    expect(r.valido).toBe(true);
  });

  it.each(CATALOGO)("%s → %s", (_n, mutar, codigo, id, opciones) => {
    const f = base() as Mutable;
    const otro = mutar(f);
    const entrada = otro === null ? (null as unknown as ModeloFisico) : (f as ModeloFisico);
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(entrada, opciones))).not.toThrow();
    expect(r!.valido).toBe(false);
    const d = r!.diagnosticos.filter((x) => x.codigo === codigo);
    expect(d.length, `${codigo} no está en ${r!.diagnosticos.map((x) => `${x.codigo} (${x.mensaje})`).join("; ")}`).toBeGreaterThan(0);
    for (const x of r!.diagnosticos) expect(x.codigo).not.toBe("compilador/error-interno");
    if (id) expect(d.some((x) => x.ids?.includes(id)), `${codigo} sin el id ${id}: ${JSON.stringify(d.map((x) => x.ids))}`).toBe(true);
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(60);
  });
});
