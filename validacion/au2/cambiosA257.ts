/**
 * A2-57 (`docs/fem3d/auditoria-2.md` §11.2): qué cambia en la referencia congelada de F cuando un obstáculo
 * que tapa menos de la mitad del rango de una franja (lo que asoma de un pilar más ancho que su viga, una
 * viga paralela por su lado) ya no acerca a la cara la recta de my y mxy de las estaciones de cara y
 * apoyo (LV2-h). Por modelo, frente al fixture: la malla (no debería cambiar), las estaciones cuyo mx
 * cambia (no debería haber), las que cambian en my o mxy (con la mayor diferencia relativa al mayor
 * |valor| de esa componente en la franja) y el máximo de Wood–Armer de cada franja.
 * Uso: bun validacion/au2/cambiosA257.ts > validacion/au2/out_cambiosA257.txt (antes de regenerar el fixture)
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
const todos: number[] = [];
for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
  const a = antes[k]!;
  const b = JSON.parse(JSON.stringify(referenciaF(f), redondeo)) as ReferenciaF;
  const malla = JSON.stringify(a.c2.modelo) === JSON.stringify(b.c2.modelo);
  let mxCambia = 0;
  let total = 0;
  const cambian: { id: string; s: number; tipo: string; d: number }[] = [];
  const dMax: { id: string; inf: number; sup: number; infA: number; infB: number; supA: number; supB: number }[] = [];
  for (const id of Object.keys(b.franjas)) {
    const x = a.franjas[id]!;
    const y = b.franjas[id]!;
    const escala = [1, 2].map((c) => Math.max(1e-9, ...x.estaciones.flatMap((e) => e.medios.filter((_, i) => i % 3 === c).map((v) => Math.abs(v ?? 0)))));
    y.estaciones.forEach((e, j) => {
      const e0 = x.estaciones[j]!;
      if (e.tipo === "paso") return;
      total++;
      if (e.medios.some((v, i) => i % 3 === 0 && v !== e0.medios[i])) mxCambia++;
      let d = 0;
      e.medios.forEach((v, i) => {
        if (i % 3 === 0) return;
        d = Math.max(d, Math.abs((v ?? 0) - (e0.medios[i] ?? 0)) / escala[(i % 3) - 1]!);
      });
      if (d > 1e-9) cambian.push({ id, s: e.s, tipo: e.tipo, d });
    });
    const mxA = (w: (number | null)[][], q: number) => Math.max(0, ...w.map((v) => v[q] ?? 0));
    const [infA, infB, supA, supB] = [mxA(x.wa, 0), mxA(y.wa, 0), mxA(x.wa, 1), mxA(y.wa, 1)];
    const inf = infA > 1e-6 ? infB / infA - 1 : 0;
    const sup = supA > 1e-6 ? supB / supA - 1 : 0;
    if (Math.abs(inf) > 1e-9 || Math.abs(sup) > 1e-9) dMax.push({ id, inf, sup, infA, infB, supA, supB });
  }
  todos.push(...dMax.flatMap((x) => [x.inf, x.sup]));
  console.log(`\n== ${k}${malla ? " (malla idéntica)" : " (¡la malla cambia!)"}: caras y apoyos ${total}; con otro mx ${mxCambia}; con otro my o mxy ${cambian.length}`);
  for (const c of [...cambian].sort((p, q) => q.d - p.d).slice(0, 3)) console.log(`    ${c.id.padEnd(16)} ${c.tipo} s = ${c.s.toFixed(3)}: hasta ${pc(c.d)} del mayor de la franja`);
  if (dMax.length)
    for (const x of [...dMax].sort((p, q) => Math.max(Math.abs(q.inf), Math.abs(q.sup)) - Math.max(Math.abs(p.inf), Math.abs(p.sup))).slice(0, 3))
      console.log(`    máximo de Wood–Armer ${x.id.padEnd(16)} inferior ${x.infA.toFixed(2)} → ${x.infB.toFixed(2)} (${pc(x.inf)}); superior ${x.supA.toFixed(2)} → ${x.supB.toFixed(2)} (${pc(x.sup)})`);
}
console.log(`\nEn total: el máximo de Wood–Armer (inferior y superior) de las franjas que cambian, mediana ${pc(med(todos))}, de ${pc(Math.min(0, ...todos))} a ${pc(Math.max(0, ...todos))}.`);
