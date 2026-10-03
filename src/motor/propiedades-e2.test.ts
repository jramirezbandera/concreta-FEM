/**
 * Criterio 3 de E2: propiedades y pruebas metamórficas (H38) con barras de Timoshenko, offsets,
 * liberaciones y cargas de barra, sobre los modelos de los oráculos y los edificios de E2:
 * - giro y traslación del modelo: u y reacciones giran, los esfuerzos de barra (locales) no cambian;
 * - renumeración de nudos y barras;
 * - inversión del sentido de las barras: u y reacciones iguales; en cada sección N, Vy, T y My
 *   iguales y Vz y Mz con el signo cambiado;
 * - superposición con cargas de barra.
 * Todo a ≤ 1e-9 (H37); los valores medidos van al informe con validacion/e2/resumen.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { erroresMetamorficos, MODELOS_PROPIEDADES } from "../../validacion/e2/metamorficas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const TOL = 1e-9;

describe("propiedades y pruebas metamórficas con barras de E2 (≤ 1e-9)", () => {
  for (const [nombre, fabrica, R] of MODELOS_PROPIEDADES) {
    it(nombre, () => {
      const [giro, ren, inv, sup] = erroresMetamorficos(fabrica(), R);
      expect(giro, "giro").toBeLessThan(TOL);
      expect(ren, "renumeración").toBeLessThan(TOL);
      expect(inv, "inversión de barras").toBeLessThan(TOL);
      expect(sup, "superposición").toBeLessThan(TOL);
    });
  }
});
