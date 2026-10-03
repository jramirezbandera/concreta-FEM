/**
 * Regla de oro 2 con cargas de barra: el equilibrio de cada cálculo usa la resultante real de
 * las cargas, no las fuerzas nodales equivalentes de sus FER. Este test simula un error en las FER
 * (un 0,1 % de más) y comprueba que el cálculo deja de ser válido. Un error de las FER que esté en
 * equilibrio con las cargas (que sólo reparta mal entre los dos extremos) no lo puede detectar
 * ningún equilibrio global: para eso están los oráculos y las soluciones cerradas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Constructor, seccionRectangularTimoshenko } from "../pruebas/constructor.ts";
import { calcular } from "./calcular.ts";

vi.mock("../elementos/cargasBarra.ts", async (original) => {
  const m = await original<typeof import("../elementos/cargasBarra.ts")>();
  return { ...m, ferBarra: (...args: Parameters<typeof m.ferBarra>) => m.ferBarra(...args).map((v) => v * 1.001) };
});

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("regla de oro 2 con cargas de barra", () => {
  it("unas FER erróneas (×1,001) rompen el equilibrio y el cálculo no es válido", () => {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0);
    const b = m.nudo(5, 0, 0);
    m.barra(a, b, seccionRectangularTimoshenko(0.3, 0.5), [0, 0, 1]);
    m.apoyo(a);
    m.apoyo(b);
    m.caso("q", [], [], [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -10] }]);
    const r = calcular(m.modelo(), { solver: "perfil" });
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["equilibrio/no-cumple"]);
    const fuerzas = r.diagnosticos[0]!.detalles!.fuerzas as number;
    expect(fuerzas).toBeGreaterThan(1e-4);
  });
});
