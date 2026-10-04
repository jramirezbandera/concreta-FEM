/**
 * Compara con Node los resultados de otros navegadores (`out_dispositivos.jsonl`, modo
 * `--dispositivos`): recalcula cada variante con `calcular()` en Node, saca la misma muestra de
 * valores (`muestraResultado`) y da, por campo, el error relativo máximo frente a la escala del
 * campo (max |valor| de la muestra) y cuántos valores son idénticos bit a bit. Sirve para los
 * motores de JS que no son V8 (JavaScriptCore en iOS), cuya huella no coincide con la de Node.
 *
 * Uso: node validacion/e4/comparar-dispositivos.ts   → out_comparar_dispositivos.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivo, huellaResultado, muestraResultado, nombreVariante, type Variante } from "./modelos.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const filas = readFileSync(join(import.meta.dirname, "out_dispositivos.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Record<string, unknown>);

const lineas = [`# validacion/e4/comparar-dispositivos.ts — ${new Date().toISOString().slice(0, 10)}, node ${process.version}`];
let ua = "";
const referencias = new Map<string, { huella: string; muestra: Record<string, number[]> }>();
for (const f of filas) {
  if (f.evento === "dispositivo") ua = String(f.ua);
  if (f.evento !== "calculo" || !f.muestra) continue;
  const v = f.parametros as Variante;
  const nombre = nombreVariante(v);
  if (!referencias.has(nombre)) {
    const modelo = edificioObjetivo(v);
    const r = calcular(modelo);
    referencias.set(nombre, { huella: huellaResultado(r), muestra: muestraResultado(modelo, r) });
  }
  const ref = referencias.get(nombre)!;
  const muestra = f.muestra as Record<string, number[]>;
  const campos: Record<string, { errorRelativo: number; identicos: string }> = {};
  let peor = 0;
  for (const [clave, b] of Object.entries(ref.muestra)) {
    const a = muestra[clave];
    if (!a || a.length !== b.length) throw new Error(`${nombre}: la muestra ${clave} no cuadra`);
    const escala = Math.max(...b.map(Math.abs));
    let d = 0;
    let iguales = 0;
    a.forEach((x, i) => {
      d = Math.max(d, Math.abs(x - b[i]!));
      if (x === b[i]) iguales++; // === y no Object.is: JSON no conserva el signo de -0
    });
    const e = escala > 0 ? d / escala : d;
    peor = Math.max(peor, e);
    campos[clave] = { errorRelativo: +e.toExponential(2), identicos: `${iguales}/${b.length}` };
  }
  lineas.push(JSON.stringify({ fecha: f.fecha, ua, variante: nombre, huellaIgual: f.huella === ref.huella, peorErrorRelativo: +peor.toExponential(2), campos }));
}
writeFileSync(join(import.meta.dirname, "out_comparar_dispositivos.txt"), lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
