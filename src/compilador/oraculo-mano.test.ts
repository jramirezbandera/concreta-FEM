/**
 * Criterio 2 de C1: cada modelo físico de `validacion/c1/mano.ts` se compara con su modelo analítico
 * escrito a mano, sin llamar al compilador. Desplazamientos, reacciones y esfuerzos de extremo
 * tienen que coincidir a ≤ 1e-10, con los mismos nudos y barras, y los avisos son los previstos.
 */
import { describe, expect, it } from "vitest";
import { casosMano } from "../../validacion/c1/mano.ts";
import { compararModelos } from "../pruebas/compilador.ts";
import { compilar } from "./compilar.ts";

describe("criterio 2 de C1: modelos físicos frente a su modelo analítico hecho a mano", () => {
  it.each(casosMano().map((c) => [c.nombre, c] as const))("%s", (_n, caso) => {
    const r = compilar(caso.fisico);
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(caso.avisos);
    const c = compararModelos(r.modelo, caso.mano);
    expect(c.nBarras).toBe((caso.mano.barras ?? []).length);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });
});
