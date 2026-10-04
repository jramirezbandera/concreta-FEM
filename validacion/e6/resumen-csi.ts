/**
 * Criterio 1 de E6: valores del motor frente a los publicados en los ejemplos de barras de CSI.
 *
 * Uso: bun validacion/e6/resumen-csi.ts → validacion/e6/out_csi.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { dentroDelRedondeo, resultados1024, todosCsi } from "./csi.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const lineas: string[] = [`# validacion/e6/resumen-csi.ts — ${new Date().toISOString().slice(0, 10)}`, ""];
lineas.push("valor | publicado | motor | dif. relativa | redondeo | frente a la cerrada | fuente");
for (const p of todosCsi()) {
  const rel = (p.motor - p.valor) / p.valor;
  const cerrada = p.cerrada === undefined ? "—" : ((p.motor - p.cerrada) / p.cerrada).toExponential(1);
  lineas.push(`${p.nombre} | ${p.valor} | ${p.motor.toPrecision(8)} | ${(100 * rel).toFixed(4)} % | ${dentroDelRedondeo(p) ? "dentro" : "FUERA"} | ${cerrada} | ${p.fuente}`);
}
lineas.push("", "1-024: sensibilidad a la J de pilares y vigas (el PDF no la da), en ft⁴:");
for (const J of [1e-6, 0.5, 2.25, 10]) {
  const r = resultados1024(J);
  lineas.push(`J = ${J}: ${r.map((p) => `${p.motor.toPrecision(5)}${dentroDelRedondeo(p) ? "" : "*"}`).join(" ")}`);
}
lineas.push("(* = fuera del redondeo publicado; columnas: T1…T4, CQC, SRSS, ABS, NRC 10 %)");
writeFileSync(join(import.meta.dirname, "out_csi.txt"), lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
