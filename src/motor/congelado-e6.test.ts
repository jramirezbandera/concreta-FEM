/**
 * Referencia congelada de E6 (regla de oro 1): los modelos de validacion/e6/congelar.ts tienen que dar
 * los mismos resultados completos a 1e-9, con los dos solvers. Si falla tras un cambio, o el cambio
 * es un error o es una mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_E6, referenciaE6, type ReferenciaE6 } from "../../validacion/e6/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { errorResultados } from "../pruebas/metamorficas.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-e6.json"), "utf8")) as Record<string, ReferenciaE6>;
const F = (v: number[]) => Float64Array.from(v);

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("referencia congelada de E6", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_E6)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver})`, () => {
        const ref = congelado[nombre]!;
        const r = referenciaE6(f, solver);
        expect(r.casos.length).toBe(ref.casos.length);
        r.casos.forEach((c, k) => {
          const a = { u: F(c.u), reacciones: F(c.reacciones), esfuerzosBarras: F(c.esfuerzosBarras), esfuerzosLaminas: F(c.esfuerzosLaminas) };
          const b = { u: F(ref.casos[k]!.u), reacciones: F(ref.casos[k]!.reacciones), esfuerzosBarras: F(ref.casos[k]!.esfuerzosBarras), esfuerzosLaminas: F(ref.casos[k]!.esfuerzosLaminas) };
          expect(errorResultados(a, b), `caso ${k}`).toBeLessThan(1e-9);
        });
      });
    }
  }
});
