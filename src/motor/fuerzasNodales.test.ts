/**
 * Criterio 1 de E5: fuerzas nodales de los elementos y de las restricciones.
 * - k·u de cada barra y cada lámina está autoequilibrado (ΣF y ΣM nulos), así que g + f_eq lo
 *   está (que f_eq sea estáticamente equivalente a la carga lo prueba ya el equilibrio global de
 *   cada cálculo, E2 y E3).
 * - En cada nudo, Σ g = P + R + Σ C (carga nodal, reacción y fuerzas de las restricciones de las
 *   que el nudo forma parte), en todas las componentes: en los esclavos, sus GDL libres; en los
 *   maestros, el cierre del equilibrio de cada cuerpo; en las cadenas huella → cabeza de pilar →
 *   diafragma, el reparto entre los dos cuerpos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { erroresFuerzasNodales, MODELOS_FUERZAS_NODALES } from "../../validacion/e5/fuerzasNodales.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 1 de E5: fuerzas nodales", () => {
  for (const [nombre, fabrica] of MODELOS_FUERZAS_NODALES) {
    it(`${nombre}: k·u autoequilibrado en cada elemento y Σg = P + R + C en cada nudo`, () => {
      const [elemento, nudo] = erroresFuerzasNodales(fabrica());
      expect(elemento, "autoequilibrio de k·u").toBeLessThan(1e-12);
      expect(nudo, "equilibrio de los nudos").toBeLessThan(1e-9);
    });
  }
});
