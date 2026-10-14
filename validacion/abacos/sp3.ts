/**
 * SP-3 / SP-4: referencia fina de las franjas en un trozo del edificio reticular de C4 (3 × 3 vanos
 * de 6 × 5 m, vigas por todos los ejes, ábacos de 2,5 m, 2 plantas, con acciones). Para cada malla, la
 * envolvente superior e inferior de cada franja (las combinaciones ELU por defecto). Con h fino, los
 * nudos a ≤ ε_snap de una huella se hacen rígidos (F2-9 / F3-8: caras altas), así que las mallas
 * finas se calculan también con ε_snap = 0,01.
 * Uso: bun validacion/abacos/sp3.ts > validacion/abacos/out_sp3.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { franjas, type FilaFranja } from "../../src/agente/consultas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";

await prepararNucleo();
const fisico: ModeloFisico = conAcciones(edificioReticular(2, 3, 3));
const LOSAS = ["L-N1", "L-N2"];

function envolventes(opciones: OpcionesCompilacion): Map<string, FilaFranja> {
  const t0 = performance.now();
  const c = compilar(fisico, opciones);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, opciones);
  const cj = conjuntoCombinaciones(q, seleccionPorDefecto(fisico.casos, "esfuerzos"));
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  const r = new Map<string, FilaFranja>();
  for (const losa of LOSAS) {
    const f = franjas(q, cj.valor, { losa });
    if (!f.valido) throw new Error(f.diagnosticos[0]!.mensaje);
    for (const x of f.valor.franjas) r.set(x.id, x);
  }
  console.error(`  ${JSON.stringify(opciones)}: ${c.modelo.nudos.length} nudos, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return r;
}

const MALLAS: [string, OpcionesCompilacion][] = [
  ["0,75", { tamanoMalla: 0.75 }],
  ["0,5", { tamanoMalla: 0.5 }],
  ["0,375", { tamanoMalla: 0.375 }],
  ["0,25", { tamanoMalla: 0.25 }],
  ["0,15", { tamanoMalla: 0.15 }],
  ["0,1", { tamanoMalla: 0.1 }],
  ["0,25 ε.01", { tamanoMalla: 0.25, epsSnap: 0.01 }],
  ["0,15 ε.01", { tamanoMalla: 0.15, epsSnap: 0.01 }],
  ["0,1 ε.01", { tamanoMalla: 0.1, epsSnap: 0.01 }],
];
const res = MALLAS.map(([n, o]) => [n, envolventes(o)] as const);
const ref = res[res.length - 1]![1];
console.log(`Trozo del edificio reticular (3 × 3 vanos, 2 plantas): envolventes de las franjas ≥ 20 kN·m/m en la referencia (h = 0,1, ε_snap = 0,01), en kN·m/m`);
console.log(`${"franja".padEnd(10)} ${"lado".padEnd(9)} ${MALLAS.map(([n]) => n.padStart(10)).join("")}   s (0,75 / ref)`);
const filas: { e: number; t: string }[] = [];
for (const [id, fr] of ref)
  for (const lado of ["inferior", "superior"] as const) {
    const vr = fr[lado]?.v;
    if (vr === undefined || Math.abs(vr) < 20) continue;
    const vs = res.map(([, m]) => m.get(id)?.[lado]?.v ?? NaN);
    filas.push({ e: (vs[0]! - vr) / vr, t: `${id.padEnd(10)} ${lado.padEnd(9)} ${vs.map((v) => v.toFixed(1).padStart(10)).join("")}   ${res[0]![1].get(id)?.[lado]?.s.toFixed(2)} / ${fr[lado]!.s.toFixed(2)}` });
  }
filas.sort((a, b) => a.e - b.e);
for (const f of filas) console.log(f.t);
console.log("\nError de cada malla frente a la referencia (media, |media|, mínimo, máximo):");
for (const [n, m] of res) {
  const es: number[] = [];
  for (const [id, fr] of ref)
    for (const lado of ["inferior", "superior"] as const) {
      const vr = fr[lado]?.v;
      const v = m.get(id)?.[lado]?.v;
      if (vr === undefined || v === undefined || Math.abs(vr) < 20) continue;
      es.push((v - vr) / vr);
    }
  const p = (x: number) => `${(100 * x).toFixed(1)} %`;
  console.log(`  ${n.padEnd(10)} ${p(es.reduce((s, x) => s + x, 0) / es.length).padStart(8)} ${p(es.reduce((s, x) => s + Math.abs(x), 0) / es.length).padStart(8)} ${p(Math.min(...es)).padStart(8)} ${p(Math.max(...es)).padStart(8)}`);
}
