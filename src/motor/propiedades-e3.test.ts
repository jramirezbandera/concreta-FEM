/**
 * Criterio 4 de E3: pruebas metamórficas (H38) con láminas, multiplicadores, ejes de usuario y
 * cargas de lámina, sobre una lámina plegada con viga de borde, dos edificios de E3 y los modelos
 * del oráculo PyNite:
 * - giro y traslación del modelo (con el eje 1 de cada lámina fijado, porque la regla de CSI
 *   depende de Z): u y reacciones giran; las resultantes de lámina y los esfuerzos de barra, no;
 * - renumeración de nudos y elementos, y cambio del nudo inicial de cada lámina;
 * - inversión del orden de los nudos de las láminas: u y reacciones iguales; las resultantes con
 *   los cambios de signo de la cabecera de modelo.ts;
 * - superposición con cargas de lámina de los tres tipos.
 * Todo a ≤ 1e-9 (H37); los valores medidos van al informe con validacion/e3/resumen.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { erroresMetamorficosE3, MODELOS_PROPIEDADES_E3 } from "../../validacion/e3/metamorficas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const TOL = 1e-9;

describe("propiedades y pruebas metamórficas con láminas de E3 (≤ 1e-9)", () => {
  for (const [nombre, fabrica, R] of MODELOS_PROPIEDADES_E3) {
    it(nombre, () => {
      const [giro, ren, inv, sup] = erroresMetamorficosE3(fabrica(), R);
      if (R) expect(giro, "giro").toBeLessThan(TOL);
      expect(ren, "renumeración").toBeLessThan(TOL);
      expect(inv, "inversión del orden de los nudos").toBeLessThan(TOL);
      expect(sup, "superposición").toBeLessThan(TOL);
    });
  }
});
