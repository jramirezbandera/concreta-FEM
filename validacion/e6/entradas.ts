/**
 * Criterio 4 de E6: cada entrada no válida del catálogo (src/pruebas/invalidos.ts) sobre 40 modelos
 * aleatorios, con lo que devuelve `calcular`.
 *
 * Uso: bun validacion/e6/entradas.ts → validacion/e6/out_entradas.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { modeloAleatorio } from "../../src/pruebas/aleatorio.ts";
import { ENTRADAS_NO_VALIDAS, estropear } from "../../src/pruebas/invalidos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const N = 40;
const lineas = [`# validacion/e6/entradas.ts — ${new Date().toISOString().slice(0, 10)}; cada entrada sobre los modelos aleatorios 1…${N} que tienen el objeto`, ""];
lineas.push("entrada | descripción | modelos | resultado (errores de cada cálculo) | esperado | ¿cumple?");
let incumplen = 0;
for (const e of ENTRADAS_NO_VALIDAS) {
  const res: Record<string, number> = {};
  let aplicadas = 0;
  let cumple = true;
  for (let s = 1; s <= N; s++) {
    const m = estropear(modeloAleatorio(s).modelo, e, s);
    if (!m) continue;
    aplicadas++;
    let clave: string;
    try {
      const r = calcular(m);
      const errores = [...new Set(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo))];
      clave = r.valido ? "válido" : errores.join(" + ") || "NO VÁLIDO SIN ERROR";
      if (e.codigos.length ? r.valido || !errores.some((c) => e.codigos.includes(c)) : !r.valido && !errores.length) cumple = false;
    } catch (err) {
      clave = `EXCEPCIÓN ${String(err).split("\n")[0]}`;
      cumple = false;
    }
    res[clave] = (res[clave] ?? 0) + 1;
  }
  if (!cumple) incumplen++;
  const resultado = Object.entries(res).map(([k, v]) => `${k} ×${v}`).join("; ");
  lineas.push(`${e.id}${e.contrato ? " (contrato)" : ""} | ${e.descripcion} | ${aplicadas} | ${resultado} | ${e.codigos.join(" o ") || "válido o error"} | ${cumple ? "sí" : "NO"}`);
}
lineas.push("", `${ENTRADAS_NO_VALIDAS.length} entradas; incumplen: ${incumplen}`);
writeFileSync(join(import.meta.dirname, "out_entradas.txt"), lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
