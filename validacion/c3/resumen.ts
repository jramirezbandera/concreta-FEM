/**
 * Criterios 3, 4 y 5 de C3 en modelos al azar con muros (`murosAleatorios.ts`, sobre los modelos con
 * losas de C2 y sin ellas): calidad de la malla de los muros, «sin pérdidas», equilibrio y las
 * transformaciones de la planta. Las pruebas (`muros.test.ts`, `metamorficas-c3.test.ts`) comprueban
 * lo mismo con sus tolerancias; esto da los valores.
 *
 * Uso: bun validacion/c3/resumen.ts → validacion/c3/out_resumen.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { planos, relacionPlanoC2, valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const lineas = [`# validacion/c3/resumen.ts — ${new Date().toLocaleDateString("sv-SE")}: criterios 3, 4 y 5 de C3 en modelos al azar con muros`, ""];
lineas.push("## Criterios 3 y 5: malla, sin pérdidas y equilibrio (h por defecto, 0,75 m)");
lineas.push("| semilla | losas | nudos | láminas de muro | aux. | aspecto máx. | > 4 | avisos de muro | sin pérdidas F | sin pérdidas M | equilibrio |");
lineas.push("|---|---|---|---|---|---|---|---|---|---|---|");
const peor = { sp: 0, eq: 0, asp: 0 };
for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  for (const conLosas of [true, false]) {
    const base = fisicoAleatorio(s);
    const f = conMurosAleatorios(conLosas ? conLosasAleatorias(base, s) : base, s);
    const r = valido(compilar(f));
    const c = calcular(r.modelo);
    if (!c.valido) throw new Error(`semilla ${s}: ${c.diagnosticos.map((d) => d.mensaje).join("; ")}`);
    const eq = Math.max(...c.casos.map((k) => Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos)));
    const e = r.estadisticas;
    const avisos = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("muro/")).map((d) => d.codigo))].join(", ") || "—";
    peor.sp = Math.max(peor.sp, e.sinPerdidas.fuerzas, e.sinPerdidas.momentos);
    peor.eq = Math.max(peor.eq, eq);
    peor.asp = Math.max(peor.asp, e.muros.aspectoMax);
    lineas.push(`| ${s} | ${conLosas ? "sí" : "no"} | ${e.nudos} | ${e.laminasMuros} | ${e.muros.auxiliares} | ${e.muros.aspectoMax.toFixed(2)} | ${e.muros.altos} | ${avisos} | ${e.sinPerdidas.fuerzas.toExponential(1)} | ${e.sinPerdidas.momentos.toExponential(1)} | ${eq.toExponential(1)} |`);
  }
}
lineas.push(`Peor: sin pérdidas ${peor.sp.toExponential(1)}; equilibrio ${peor.eq.toExponential(1)}; aspecto ${peor.asp.toFixed(2)} (fuera de las huellas de los pilares).`, "");
const semillas = [1, 2, 3, 5, 8];
lineas.push(`## Criterio 4: transformaciones de la planta (semillas ${semillas.join(", ")}, con losas)`);
lineas.push("| transformación | misma malla | error de u | error de reacciones |", "|---|---|---|---|");
for (const { nombre, t } of planos()) {
  let misma = 0;
  let eu = 0;
  let er = 0;
  for (const s of semillas) {
    const e = relacionPlanoC2(conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s), s), t);
    if (e.mismaMalla) misma++;
    eu = Math.max(eu, e.u);
    er = Math.max(er, e.reacciones);
  }
  lineas.push(`| ${nombre} | sí, en ${misma} de ${semillas.length} | ${eu.toExponential(1)} | ${er.toExponential(1)} |`);
}
const texto = lineas.join("\n");
console.log(texto);
writeFileSync(join(import.meta.dirname, "out_resumen.txt"), texto + "\n");
