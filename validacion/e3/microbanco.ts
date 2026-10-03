/**
 * Microbanco de la lámina de E3 sobre las 28 280 láminas del edificio objetivo (el de banco.ts):
 * preparación, rigidez en globales por lámina (E1-6: 33 µs en E1), operador de resultantes del
 * centroide por lámina y fuerzas equivalentes por carga de lámina.
 *
 * Uso: node validacion/e3/microbanco.ts → una línea por medida
 */
import { geometria } from "../../src/motor/geometria.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { prepararLamina, cargasDeLaminasDelCaso, operadorGlobal } from "../../src/motor/laminas.ts";
import { rigidezLaminaGlobal } from "../../src/elementos/lamina.ts";
import { edificio } from "../../src/pruebas/edificio.ts";
const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla: 0.75, huella: 0.75, vigas: true, muro: true, diafragma: true, barrasE2: true, laminasE3: true });
const m = e.modelo;
const geo = geometria(m);
const diag = new Diagnosticos();
let t = performance.now();
const pl = m.laminas!.map((l, k) => prepararLamina(l, k, geo, diag)!);
console.log("preparar", (performance.now() - t).toFixed(0), "ms", m.laminas!.length);
t = performance.now();
const out = new Float64Array(576);
for (let r = 0; r < 3; r++) for (const p of pl) rigidezLaminaGlobal(p.xy, p.R, p.seccion, out);
console.log("rigidez", ((performance.now() - t) / 3 / pl.length * 1000).toFixed(2), "µs/lámina");
t = performance.now();
const op = new Float64Array(192);
for (const p of pl) operadorGlobal(p, "centroide", op);
console.log("operador", ((performance.now() - t) / pl.length * 1000).toFixed(2), "µs/lámina");
t = performance.now();
let n = 0;
for (let r = 0; r < 4; r++) for (const c of m.casos) { cargasDeLaminasDelCaso(c.id, c.laminas ?? [], pl, m, geo, diag); n += c.laminas?.length ?? 0; }
console.log("cargas", ((performance.now() - t) / n * 1000).toFixed(2), "µs/carga", n);
