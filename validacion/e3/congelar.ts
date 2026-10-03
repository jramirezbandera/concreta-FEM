/**
 * Referencia congelada de E3 (regla de oro 1): dos edificios del generador con barras de E2 y
 * láminas de E3 (reticular con multiplicadores y eje 1, ábacos, cargas de lámina de los tres
 * tipos) y la lámina plegada de las pruebas metamórficas, resueltos con faer. El test
 * (src/motor/congelado-e3.test.ts) los recalcula y compara a 1e-9.
 *
 * Sólo se regenera a sabiendas (un cambio de formulación que se ha validado aparte):
 *   bun validacion/e3/congelar.ts
 * Guarda los desplazamientos y reacciones de los mismos nudos que las de E1 y E2 (todos en la
 * lámina plegada), los esfuerzos de extremo de todas las barras y las resultantes de todas las
 * láminas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";
import { nudosGuardados } from "../e1/congelar.ts";
import { laminaPlegada } from "./metamorficas.ts";

const EDIFICIOS: Record<string, OpcionesEdificio> = {
  "e3-diafragma": { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true, diafragma: true, barrasE2: true, laminasE3: true },
  "e3-muelles": { vanosX: 2, vanosY: 1, luzX: 6, luzY: 5, plantas: 3, altura: 3.2, malla: 1, huella: 1, muro: true, vigas: true, muelles: true, barrasE2: true, laminasE3: true },
};

/** Modelos congelados de E3 y los nudos que se guardan de cada uno. */
export const MODELOS_CONGELADOS_E3: Record<string, () => { modelo: ModeloAnalitico; nudos: number[] }> = {
  ...Object.fromEntries(Object.entries(EDIFICIOS).map(([k, o]) => [k, () => ({ modelo: edificio(o).modelo, nudos: nudosGuardados(o) })])),
  "lamina-plegada": () => {
    const modelo = laminaPlegada();
    return { modelo, nudos: modelo.nudos.map((_, v) => v) };
  },
};

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_E3)) {
    const { modelo, nudos } = f();
    const casos = casosValidos(calcular(modelo));
    salida[nombre] = {
      nudos,
      casos: Object.fromEntries(
        casos.map((c) => [
          c.id,
          {
            u: nudos.flatMap((v) => Array.from(c.u.subarray(6 * v, 6 * v + 6))),
            reacciones: nudos.flatMap((v) => Array.from(c.reacciones.subarray(6 * v, 6 * v + 6))),
            esfuerzosBarras: Array.from(c.esfuerzosBarras),
            esfuerzosLaminas: Array.from(c.esfuerzosLaminas),
          },
        ]),
      ),
    };
  }
  const ruta = join(raiz, "src", "motor", "__fixtures__", "edificios-congelados-e3.json");
  writeFileSync(ruta, JSON.stringify({ generado: "bun validacion/e3/congelar.ts", ...salida }));
  console.log(`escrito ${ruta}`);
}
