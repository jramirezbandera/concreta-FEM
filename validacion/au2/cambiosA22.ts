/**
 * A2-2 (`docs/fem3d/auditoria-2.md` §11.1): qué cambia en la referencia congelada de F con las estaciones
 * de paso escaladas al corte exacto de la recta de la malla más cercana. Por modelo, frente al fixture:
 * la malla (no debería cambiar), las estaciones de cara y apoyo (no deberían cambiar), las de paso que
 * cambian y cuánto su mx (con la suma de los casos) y el máximo de Wood–Armer de cada franja (inferior y
 * superior), con las que más.
 * Uso: bun validacion/au2/cambiosA22.ts > validacion/au2/out_cambiosA22.txt (antes de regenerar el fixture)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { redondeo } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F, referenciaF, type ReferenciaF } from "../f/congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-f.json"), "utf8")) as Record<string, ReferenciaF>;
const pc = (x: number) => `${(100 * x).toFixed(1)} %`;
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
let todosPaso: number[] = [];
const todosMax: number[] = [];
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaF(f), redondeo)) as ReferenciaF;
  const malla = JSON.stringify(a.c2.modelo) === JSON.stringify(b.c2.modelo);
  let carasMueven = 0;
  const dPaso: number[] = [];
  const dMax: { id: string; inf: number; sup: number; infA: number; infB: number; supA: number; supB: number }[] = [];
  for (const id of Object.keys(b.franjas)) {
    const x = a.franjas[id]!;
    const y = b.franjas[id]!;
    const escala = Math.max(1e-9, ...x.estaciones.map((e) => Math.abs(e.medios.filter((_, i) => i % 3 === 0).reduce((s, v) => s + (v ?? 0), 0))));
    y.estaciones.forEach((e, j) => {
      const e0 = x.estaciones[j]!;
      const mx = (q: typeof e) => q.medios.filter((_, i) => i % 3 === 0).reduce((s, v) => s + (v ?? 0), 0);
      const d = (mx(e) - mx(e0)) / escala;
      if (e.tipo === "paso") {
        if (Math.abs(d) > 1e-9) dPaso.push(d);
      } else if (Math.abs(d) > 1e-9) carasMueven++;
    });
    const mxA = (w: (number | null)[][], q: number) => Math.max(0, ...w.map((v) => v[q] ?? 0));
    const [infA, infB, supA, supB] = [mxA(x.wa, 0), mxA(y.wa, 0), mxA(x.wa, 1), mxA(y.wa, 1)];
    const inf = infA > 1e-6 ? infB / infA - 1 : 0;
    const sup = supA > 1e-6 ? supB / supA - 1 : 0;
    if (Math.abs(inf) > 1e-9 || Math.abs(sup) > 1e-9) dMax.push({ id, inf, sup, infA, infB, supA, supB });
  }
  todosPaso = todosPaso.concat(dPaso);
  todosMax.push(...dMax.map((x) => x.inf));
  console.log(`\n== ${k}${malla ? " (malla idéntica)" : " (¡la malla cambia!)"}: caras y apoyos que se mueven: ${carasMueven}; estaciones de paso que cambian: ${dPaso.length}`);
  if (dPaso.length) console.log(`  mx de paso (suma de casos, sobre el mayor |mx| de su franja): mediana ${pc(med(dPaso))}, de ${pc(Math.min(...dPaso))} a ${pc(Math.max(...dPaso))}`);
  if (dMax.length) {
    const di = dMax.map((x) => x.inf);
    console.log(`  máximo de la armadura inferior de cada franja: mediana ${pc(med(di))}, de ${pc(Math.min(...di))} a ${pc(Math.max(...di))}; las tres que más:`);
    for (const x of [...dMax].sort((p, q) => Math.abs(q.inf) - Math.abs(p.inf)).slice(0, 3)) console.log(`    ${x.id.padEnd(16)} inferior ${x.infA.toFixed(2)} → ${x.infB.toFixed(2)} (${pc(x.inf)}); superior ${x.supA.toFixed(2)} → ${x.supB.toFixed(2)} (${pc(x.sup)})`);
  }
}
console.log(`\nEn total: ${todosPaso.length} estaciones de paso cambian (mediana ${pc(med(todosPaso))}); el máximo de la inferior de cada franja, mediana ${pc(med(todosMax))}, de ${pc(Math.min(...todosMax))} a ${pc(Math.max(...todosMax))}.`);
