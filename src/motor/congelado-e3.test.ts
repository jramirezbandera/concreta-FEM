/**
 * Referencia congelada de E3 (regla de oro 1): los modelos de validacion/e3/congelar.ts, con
 * láminas con multiplicadores, ejes de usuario y cargas de lámina, tienen que dar los mismos
 * desplazamientos, reacciones, esfuerzos de barra y resultantes de lámina a 1e-9, con los dos
 * solvers. Si falla tras un cambio, o el cambio es un error o es una mejora de formulación que hay
 * que validar aparte (oráculos) antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_E3 } from "../../validacion/e3/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos, errorLaminas, errorPorGrupos } from "../pruebas/comparar.ts";
import { calcular } from "./calcular.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "edificios-congelados-e3.json"), "utf8")) as Record<
  string,
  { nudos: number[]; casos: Record<string, { u: number[]; reacciones: number[]; esfuerzosBarras: number[]; esfuerzosLaminas: number[] }> }
>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("referencia congelada de E3", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_E3)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver})`, () => {
        const ref = congelado[nombre]!;
        const { modelo, nudos } = f();
        expect(nudos).toEqual(ref.nudos);
        const casos = casosValidos(calcular(modelo, { solver }));
        expect(casos.map((c) => c.id)).toEqual(Object.keys(ref.casos));
        for (const c of casos) {
          const r = ref.casos[c.id]!;
          const u = nudos.flatMap((v) => Array.from(c.u.subarray(6 * v, 6 * v + 6)));
          const R = nudos.flatMap((v) => Array.from(c.reacciones.subarray(6 * v, 6 * v + 6)));
          expect(errorPorGrupos(u, r.u), `${c.id} u`).toBeLessThan(1e-9);
          expect(errorPorGrupos(R, r.reacciones), `${c.id} R`).toBeLessThan(1e-9);
          if (r.esfuerzosBarras.length) expect(errorPorGrupos(c.esfuerzosBarras, r.esfuerzosBarras), `${c.id} barras`).toBeLessThan(1e-9);
          expect(errorLaminas(c.esfuerzosLaminas, r.esfuerzosLaminas), `${c.id} láminas`).toBeLessThan(1e-9);
        }
      });
    }
  }
});
