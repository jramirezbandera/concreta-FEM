/**
 * Resumen medido de los criterios 3, 4 y 5 de C2 sobre modelos al azar con losas (los tests
 * comprueban los umbrales; esto da los valores para el informe):
 * - 3: tamaño y calidad de la malla (jacobiano escalado mínimo y cuadriláteros bajo 0,2);
 * - 4: metamórficas (traslación, giros de 90° y 37°: ¿la misma malla? y errores de u y reacciones);
 * - 5: «sin pérdidas» del compilador y equilibrio del motor.
 *
 * Uso: bun validacion/c2/resumen.ts → validacion/c2/out_resumen.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { planos, relacionPlanoC2, valido } from "../../src/pruebas/metamorficasFisicas.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const lineas: string[] = [`# validacion/c2/resumen.ts — ${new Date().toLocaleDateString("sv-SE")}: criterios 3, 4 y 5 de C2 en modelos al azar con losas`];
const e = (v: number) => v.toExponential(1);

lineas.push("", "## Criterios 3 y 5: malla, sin pérdidas y equilibrio (h por defecto, 0,75 m)");
lineas.push("| semilla | eje 1 | diafragma | nudos | láminas | huellas | jac. mín. | bajo 0,2 | sin pérdidas F | sin pérdidas M | equilibrio |");
lineas.push("|---|---|---|---|---|---|---|---|---|---|---|");
let peor = { jac: 1, sp: 0, eq: 0 };
for (let s = 1; s <= 12; s++) {
  for (const eje1 of ["x", "azar"] as const) {
    const dia = s % 3 !== 0;
    const r = valido(compilar(conLosasAleatorias(fisicoAleatorio(s, { diafragma: dia }), s, { eje1 })));
    const c = calcular(r.modelo);
    if (!c.valido) throw new Error(`semilla ${s}: cálculo no válido`);
    const eq = Math.max(...c.casos.map((k) => Math.max(k.equilibrio.fuerzas, k.equilibrio.momentos)));
    const st = r.estadisticas;
    peor = { jac: Math.min(peor.jac, st.malla.jacobianoMin), sp: Math.max(peor.sp, st.sinPerdidas.fuerzas, st.sinPerdidas.momentos), eq: Math.max(peor.eq, eq) };
    lineas.push(`| ${s} | ${eje1} | ${dia ? "rígido" : "no"} | ${st.nudos} | ${st.laminas} | ${st.huellas} | ${st.malla.jacobianoMin.toFixed(3)} | ${st.malla.bajos} | ${e(st.sinPerdidas.fuerzas)} | ${e(st.sinPerdidas.momentos)} | ${e(eq)} |`);
  }
}
lineas.push(`Peor: jacobiano ${peor.jac.toFixed(3)}; sin pérdidas ${e(peor.sp)}; equilibrio ${e(peor.eq)}.`);

lineas.push("", "## Criterio 4: transformaciones de la planta (semillas 1, 2, 3, 4, 6 y 9)");
lineas.push("| transformación | misma malla | error de u | error de reacciones |");
lineas.push("|---|---|---|---|");
for (const { nombre, t } of planos()) {
  let misma = true;
  let eu = 0;
  let er = 0;
  for (const s of [1, 2, 3, 4, 6, 9]) {
    const x = relacionPlanoC2(conLosasAleatorias(fisicoAleatorio(s), s), t);
    misma &&= x.mismaMalla;
    if (x.mismaMalla) [eu, er] = [Math.max(eu, x.u), Math.max(er, x.reacciones)];
  }
  lineas.push(`| ${nombre} | ${misma ? "sí, en las 6" : "no"} | ${e(eu)} | ${e(er)} |`);
}
const texto = lineas.join("\n");
console.log(texto);
writeFileSync(join(import.meta.dirname, "out_resumen.txt"), texto + "\n");
