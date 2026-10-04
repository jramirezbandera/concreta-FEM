/**
 * Memoria JS del motor por fase (E4, H16): el heap de V8 y los ArrayBuffer tras cada fase de
 * `calcular()`, para ver qué parte de la memoria de un cálculo es del núcleo WASM y cuál del
 * motor en TypeScript. Con --expose-gc se fuerza una recolección antes de medir cada fase, así
 * que se mide lo vivo, no la basura pendiente.
 *
 * `arrayBuffersMB` va en bruto: Node cuenta en él la memoria WASM inicial pero no lo que crece
 * después, así que sólo es la memoria JS de los `Float64Array` mientras el núcleo no ha crecido
 * (hasta el ensamblado).
 *
 * Uso: node --expose-gc validacion/e4/memoria-js.ts <malla> <diafragma|semirrigido> [casos]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo, memoriaNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivo, nombreVariante } from "./modelos.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("hace falta --expose-gc");
const v = { malla: Number(process.argv[2] ?? 0.75), diafragma: (process.argv[3] ?? "diafragma") === "diafragma", casos: Number(process.argv[4] ?? 24) };
const MB = (b: number) => Math.round(b / 2 ** 20);
const medida = () => {
  const m = process.memoryUsage();
  return { heapMB: MB(getHeapStatistics().used_heap_size), arrayBuffersMB: MB(m.arrayBuffers), wasmMB: MB(memoriaNucleo()), rssMB: MB(m.rss) };
};
gc();
const base = medida();
const modelo = edificioObjetivo(v);
gc();
const conModelo = medida();
const filas: Record<string, unknown>[] = [{ fase: "base", ...base }, { fase: "modelo", ...conModelo }];
let picoHeap = 0;
const r = calcular(modelo, {
  alProgreso: (fase) => {
    picoHeap = Math.max(picoHeap, getHeapStatistics().used_heap_size);
    gc();
    filas.push({ fase, ...medida() });
  },
});
gc();
filas.push({ fase: "resultado vivo", ...medida() });
const casos = r.valido ? r.casos : [];
const bytesResultado = casos.reduce((s, c) => s + c.u.byteLength + c.reacciones.byteLength + c.esfuerzosBarras.byteLength + c.esfuerzosLaminas.byteLength, 0);
console.log(JSON.stringify({ variante: nombreVariante(v), nudos: r.estadisticas?.nudos, laminas: modelo.laminas?.length, barras: modelo.barras?.length, resultadoMB: MB(bytesResultado), picoHeapSinGcMB: MB(picoHeap) }));
for (const f of filas) console.log(JSON.stringify(f));
