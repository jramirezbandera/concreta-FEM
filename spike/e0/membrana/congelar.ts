// Congela los resultados de la lámina del motor en los modelos del criterio 2 (regresión).
//   bun spike/e0/membrana/congelar.ts   → src/elementos/__fixtures__/lamina-congelada.json
// Sólo se regenera cuando un cambio de formulación es intencionado y está validado.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { macnealHarder, muro, vigaEnMuro } from "./modelos.ts";

const raiz = join(import.meta.dirname, "..", "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src/nucleo/pkg/nucleo_bg.wasm")));
const valores: Record<string, number> = {};
for (const [nx, ny] of [[1, 3], [2, 6], [4, 12], [8, 24]] as const) valores[`muro_${nx}x${ny}`] = muro(nx, ny);
for (const f of ["rectangular", "trapezoidal", "paralelogramo"] as const) {
  for (const c of ["cortante", "momento"] as const) valores[`mh_${f}_${c}`] = macnealHarder(f, c);
}
for (const [n, e] of [[6, 0], [6, 1], [6, 6], [12, 0], [12, 1], [12, 2], [12, 12]] as const) valores[`viga_${n}_${e}`] = vigaEnMuro(n, e).punta;
const salida = join(raiz, "src/elementos/__fixtures__/lamina-congelada.json");
writeFileSync(salida, JSON.stringify({ generador: "spike/e0/membrana/congelar.ts", opciones: "por defecto (γ = G, estabilización 1e-2)", valores }, null, 1) + "\n");
console.log(valores);
