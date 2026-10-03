/**
 * Referencia congelada de E2 (regla de oro 1): dos edificios del generador con barras de
 * Timoshenko, zonas rígidas, vigas descolgadas, rótulas y cargas de barra, resueltos con faer.
 * El test (src/motor/congelado-e2.test.ts) los recalcula y compara a 1e-9.
 *
 * Sólo se regenera a sabiendas (un cambio de formulación que se ha validado aparte):
 *   bun validacion/e2/congelar.ts
 * Guarda los desplazamientos y reacciones de los mismos nudos que la de E1 y los esfuerzos de
 * extremo de todas las barras.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";
import { nudosGuardados } from "../e1/congelar.ts";

export const EDIFICIOS_CONGELADOS_E2: Record<string, OpcionesEdificio> = {
  "e2-diafragma": { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true, diafragma: true, barrasE2: true },
  "e2-muelles": { vanosX: 2, vanosY: 1, luzX: 6, luzY: 5, plantas: 3, altura: 3.2, malla: 1, huella: 1, muro: true, vigas: true, muelles: true, barrasE2: true },
};

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  for (const [nombre, o] of Object.entries(EDIFICIOS_CONGELADOS_E2)) {
    const casos = casosValidos(calcular(edificio(o).modelo));
    const nudos = nudosGuardados(o);
    salida[nombre] = {
      nudos,
      casos: Object.fromEntries(
        casos.map((c) => [
          c.id,
          {
            u: nudos.flatMap((v) => Array.from(c.u.subarray(6 * v, 6 * v + 6))),
            reacciones: nudos.flatMap((v) => Array.from(c.reacciones.subarray(6 * v, 6 * v + 6))),
            esfuerzosBarras: Array.from(c.esfuerzosBarras),
          },
        ]),
      ),
    };
  }
  const ruta = join(raiz, "src", "motor", "__fixtures__", "edificios-congelados-e2.json");
  writeFileSync(ruta, JSON.stringify({ generado: "bun validacion/e2/congelar.ts", ...salida }));
  console.log(`escrito ${ruta}`);
}
