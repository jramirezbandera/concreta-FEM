/**
 * Fase BN: lo que da el pórtico arriostrado de `src/pruebas/barras.ts` (diagnósticos, axil de cada
 * barra por caso y reparto del cortante del viento entre la cruz y los pilares). Sale en
 * `out_medir.txt`.
 *   bun validacion/bn/medir.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosPiezas } from "../../src/compilador/resultados.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { porticoArriostrado } from "../../src/pruebas/barras.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const out: string[] = [];
const f = porticoArriostrado();
const r = compilar(f);
if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
out.push(`Pórtico arriostrado: ${r.estadisticas.nudos} nudos, ${r.estadisticas.barras} barras, ${r.estadisticas.laminas} láminas.`);
for (const d of r.diagnosticos) out.push(`  ${d.severidad} ${d.codigo}: ${d.mensaje}`);
const casos = casosValidos(calcular(r.modelo));
const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, casos);
out.push("", "Axil en el centro de cada barra (kN, + tracción):");
for (const b of f.barras!) {
  const t = ep.tramos(b.id)[0]!;
  const N = f.casos.map((_, c) => ep.diagrama(t.barra, c).esfuerzosEn((t.s1 - t.s0) / 2, 1)[0]!);
  out.push(`  ${b.id}: ${f.casos.map((c, k) => `${c.id} ${N[k]!.toFixed(3)}`).join(", ")}`);
}
// Viento: el cortante en la base de los pilares frente al de la cruz (la proyección horizontal de su axil)
const w = f.casos.findIndex((c) => c.id === "W");
let pilares = 0;
for (const p of f.pilares!) {
  const n = r.mapeo.nudosPilar[`${p.id}@C`]!;
  pilares += -casos[w]!.reacciones[6 * n]!;
}
out.push("", `Viento (15 kN en +X): reacciones de los pilares en X = ${pilares.toFixed(3)} kN (con la cruz y la diagonal de y = 4, que arrancan en sus nudos)`);
writeFileSync(join(import.meta.dirname, "out_medir.txt"), `${out.join("\n")}\n`);
console.log(out.join("\n"));
