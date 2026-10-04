/**
 * Calibración de la estimación de memoria del núcleo (H16): en un proceso nuevo por modelo,
 * compara el pico estimado tras el análisis simbólico (`estadisticas.memoriaNucleo`) con la memoria
 * lineal real al terminar, y comprueba que la memoria en uso vuelve a su nivel de partida (sin
 * fugas en el núcleo). Después repite el cálculo en el mismo proceso: el asignador reutiliza lo
 * liberado y la memoria lineal no debe crecer.
 *
 * Uso: node validacion/e4/calibrar-memoria.ts <malla> <diafragma|semirrigido> [nrhs] [vueltas]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo, memoriaEnUsoNucleo, memoriaNucleo } from "../../src/nucleo/index.ts";
import { edificio } from "../../src/pruebas/edificio.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const malla = Number(process.argv[2] ?? 0.75);
const diafragma = (process.argv[3] ?? "diafragma") === "diafragma";
const nrhs = Number(process.argv[4] ?? 5);
const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla, huella: malla, vigas: true, muro: true, diafragma, barrasE2: true, laminasE3: true });
const casos = Array.from({ length: nrhs }, (_, k) => ({ ...e.modelo.casos[k % e.modelo.casos.length]!, id: `C${k}` }));
const modelo = { ...e.modelo, casos };
const MB = (b: number) => +(b / 2 ** 20).toFixed(1);
const fila: Record<string, unknown> = { malla, variante: diafragma ? "diafragma" : "semirrigido", nrhs };
const enUso0 = memoriaEnUsoNucleo();
const lineal0 = memoriaNucleo();
const vueltas = Number(process.argv[5] ?? 2);
for (let vuelta = 1; vuelta <= vueltas; vuelta++) {
  const r = calcular(modelo);
  const est = r.estadisticas!;
  Object.assign(fila, {
    [`valido${vuelta}`]: r.valido,
    ecuaciones: est.ecuaciones,
    nnzL: est.nnzL,
    [`requeridaMB${vuelta}`]: MB(est.memoriaNucleo!.requerida),
    [`picoEstimadoMB${vuelta}`]: MB(est.memoriaNucleo!.picoEstimado),
    [`linealMB${vuelta}`]: MB(memoriaNucleo()),
    [`enUsoTrasMB${vuelta}`]: MB(memoriaEnUsoNucleo()),
  });
}
Object.assign(fila, { linealInicialMB: MB(lineal0), enUsoInicialMB: MB(enUso0), fuga: memoriaEnUsoNucleo() - enUso0 });
console.log(JSON.stringify(fila));
