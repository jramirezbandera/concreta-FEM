/**
 * Criterio 1 de C4: cada paño de `validacion/c4/mano.ts` se compara con su modelo analítico escrito
 * a mano, sin llamar al compilador: desplazamientos, reacciones y esfuerzos de extremo a ≤ 1e-10,
 * con los mismos nudos y barras, y los avisos previstos.
 */
import { describe, expect, it } from "vitest";
import { casosManoC4 } from "../../validacion/c4/mano.ts";
import { compararModelos } from "../pruebas/compilador.ts";
import { compilar } from "./compilar.ts";

describe("criterio 1 de C4: paños unidireccionales frente a su modelo analítico hecho a mano", () => {
  it.each(casosManoC4().map((c) => [c.nombre, c] as const))("%s", (_n, caso) => {
    const r = compilar(caso.fisico, caso.opciones);
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(caso.avisos);
    const c = compararModelos(r.modelo, caso.mano);
    expect(c.nBarras).toBe((caso.mano.barras ?? []).length);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });
});
