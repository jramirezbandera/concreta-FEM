/**
 * Referencia congelada de E2 (regla de oro 1): los edificios de validacion/e2/congelar.ts, con
 * barras de Timoshenko, offsets, rótulas y cargas de barra, tienen que dar los mismos
 * desplazamientos, reacciones y esfuerzos de barra a 1e-9, con los dos solvers. Si falla tras un
 * cambio, o el cambio es un error o es una mejora de formulación que hay que validar aparte
 * (oráculos) antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { nudosGuardados } from "../../validacion/e1/congelar.ts";
import { EDIFICIOS_CONGELADOS_E2 } from "../../validacion/e2/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../pruebas/comparar.ts";
import { edificio } from "../pruebas/edificio.ts";
import { calcular } from "./calcular.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "edificios-congelados-e2.json"), "utf8")) as Record<
  string,
  { nudos: number[]; casos: Record<string, { u: number[]; reacciones: number[]; esfuerzosBarras: number[] }> }
>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("referencia congelada de E2", () => {
  for (const [nombre, o] of Object.entries(EDIFICIOS_CONGELADOS_E2)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver})`, () => {
        const ref = congelado[nombre]!;
        const nudos = nudosGuardados(o);
        expect(nudos).toEqual(ref.nudos);
        const casos = casosValidos(calcular(edificio(o).modelo, { solver }));
        expect(casos.map((c) => c.id)).toEqual(Object.keys(ref.casos));
        for (const c of casos) {
          const u = nudos.flatMap((v) => Array.from(c.u.subarray(6 * v, 6 * v + 6)));
          const r = nudos.flatMap((v) => Array.from(c.reacciones.subarray(6 * v, 6 * v + 6)));
          expect(errorPorGrupos(u, ref.casos[c.id]!.u), `${c.id} u`).toBeLessThan(1e-9);
          expect(errorPorGrupos(r, ref.casos[c.id]!.reacciones), `${c.id} R`).toBeLessThan(1e-9);
          expect(errorPorGrupos(c.esfuerzosBarras, ref.casos[c.id]!.esfuerzosBarras), `${c.id} esfuerzos`).toBeLessThan(1e-9);
        }
      });
    }
  }
});
