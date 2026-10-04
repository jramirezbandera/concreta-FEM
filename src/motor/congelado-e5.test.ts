/**
 * Referencia congelada de E5 (regla de oro 1): los cortes (por fuerzas nodales y por campos) y los
 * campos SPR de los modelos de validacion/e5/congelar.ts tienen que dar los mismos valores a 1e-9,
 * con los dos solvers, y NaN en las mismas componentes. Si falla tras un cambio, o el cambio es un
 * error o es una mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_E5, referenciaE5, type ReferenciaE5 } from "../../validacion/e5/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { errorLaminas } from "../pruebas/comparar.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-e5.json"), "utf8")) as Record<string, ReferenciaE5>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** max|a − b| / max|b| por grupos de 3 (fuerzas y momentos), con NaN (null) en las mismas posiciones. */
function errorCorte(a: (number | null)[], b: (number | null)[]): number {
  expect(a.map((v) => v === null)).toEqual(b.map((v) => v === null));
  let peor = 0;
  for (const g of [0, 3]) {
    let dif = 0;
    let ref = 0;
    for (let k = 0; k < b.length; k += 6) {
      for (let c = g; c < g + 3; c++) {
        if (b[k + c] === null) continue;
        dif = Math.max(dif, Math.abs(a[k + c]! - b[k + c]!));
        ref = Math.max(ref, Math.abs(b[k + c]!));
      }
    }
    peor = Math.max(peor, ref > 0 ? dif / ref : dif);
  }
  return peor;
}

describe("referencia congelada de E5", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_E5)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver})`, () => {
        const ref = congelado[nombre]!;
        const r = referenciaE5(f, solver);
        expect(Object.keys(r.cortes)).toEqual(Object.keys(ref.cortes));
        for (const id of Object.keys(ref.cortes)) expect(errorCorte(r.cortes[id]!, ref.cortes[id]!), id).toBeLessThan(1e-9);
        expect(errorLaminas(r.campos, ref.campos), "campos").toBeLessThan(1e-9);
      });
    }
  }
});
