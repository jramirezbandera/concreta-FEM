/**
 * Referencia congelada de E1 (regla de oro 1): dos edificios del generador con todo lo que hay
 * en el núcleo (láminas, barras, muro, diafragma rígido, huella encadenada, muelles, asiento),
 * resueltos con faer. El test (src/motor/congelado.test.ts) los recalcula y compara a 1e-9.
 *
 * Sólo se regenera a sabiendas (un cambio de formulación que se ha validado aparte):
 *   bun validacion/e1/congelar.ts
 * Guarda los desplazamientos y reacciones de uno de cada 5 nudos y de todos los apoyados.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";

export const EDIFICIOS_CONGELADOS: Record<string, OpcionesEdificio> = {
  "diafragma-huella-muro": { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true, diafragma: true },
  "semirrigido-muelles": { vanosX: 2, vanosY: 1, luzX: 6, luzY: 5, plantas: 3, altura: 3.2, malla: 1, huella: 1, muro: true, vigas: true, muelles: true },
};

/** Nudos que se guardan: uno de cada 5 y todos los que tienen apoyo o muelle a tierra. */
export function nudosGuardados(o: OpcionesEdificio): number[] {
  const m = edificio(o).modelo;
  const s = new Set<number>();
  for (let v = 0; v < m.nudos.length; v += 5) s.add(v);
  for (const a of m.apoyos ?? []) s.add(a.nudo);
  for (const mu of m.muelles ?? []) if (mu.nudos.length === 1) s.add(mu.nudos[0]);
  return [...s].sort((a, b) => a - b);
}

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  for (const [nombre, o] of Object.entries(EDIFICIOS_CONGELADOS)) {
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
          },
        ]),
      ),
    };
  }
  const ruta = join(raiz, "src", "motor", "__fixtures__", "edificios-congelados.json");
  writeFileSync(ruta, JSON.stringify({ generado: "bun validacion/e1/congelar.ts", ...salida }));
  console.log(`escrito ${ruta}`);
}
