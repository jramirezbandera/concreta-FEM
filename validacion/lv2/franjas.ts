/**
 * Criterio 3 de la fase LV2 (`docs/fem3d/refinamiento-vigas.md`): las franjas de armado de la
 * retícula de 4 × 4 de la fase LV (`edificioReticular(1, 3, 3)`: pilares de 40 × 40 y de 30 × 50,
 * vigas de 30 por todos los ejes y zunchos de 25 a mitad de vano), con h = 0,75 frente a h = 0,125 con
 * las esquinas.
 * Como en `validacion/lv/franjas.ts`: la superior de ELU en las estaciones de apoyo (respecto al
 * máximo de la franja) y el máximo inferior de cada franja.
 * Criterio 3, cambiado el 2026-10-16 (el de antes no lo cumplía ni la malla uniforme de 0,5): pasa si
 * LV2 con h = 0,75 no tiene más estaciones de apoyo por encima del 20 % que LV1 con h = 0,5 uniforme.
 * Las de LV2 por encima del 20 % se listan con su serie al refinar (h = 0,5, 0,25 y 0,125) y
 * los pilares del aviso `malla/esquina-sin-refinar` (LV2-g).
 *
 *   bun validacion/lv2/franjas.ts > validacion/lv2/out_franjas.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const fisico = conAcciones(edificioReticular(1, 3, 3));
const ELU = [1.35, 1.5, 0, 0];

interface Franja {
  dir: 1 | 2;
  t0: number;
  t1: number;
  apoyos: Map<string, { s: number; v: number }>;
  vano: number;
}

const sinRefinar = new Map<string, string[]>();

function medir(op: OpcionesCompilacion): Map<string, Franja> {
  const c = compilar(fisico, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  sinRefinar.set(JSON.stringify(op), c.diagnosticos.filter((d) => d.codigo === "malla/esquina-sin-refinar").flatMap((d) => (d.ids ?? []).slice(1)));
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, op);
  const r = new Map<string, Franja>();
  const fs = q.franjas("L-N1");
  if (!fs.valido) throw new Error("L-N1");
  for (const f of fs.valor) {
    const e = q.franja(f.id);
    const a = q.armadoFranja(f.id, [ELU]);
    if (!e.valido || !a.valido) throw new Error(f.id);
    const apoyos = new Map<string, { s: number; v: number }>();
    let vano = 0;
    e.valor.estaciones.forEach((x, i) => {
      if (x.tipo === "apoyo") apoyos.set(`${x.s.toFixed(3)}:${x.lado}`, { s: x.s, v: a.valor[i]!.superior });
      vano = Math.max(vano, a.valor[i]!.inferior);
    });
    r.set(f.id, { dir: f.direccion as 1 | 2, t0: f.t0, t1: f.t1, apoyos, vano });
  }
  return r;
}

/** ¿La estación s de la franja está en la cara de una viga junto a un pilar (su ventana toca la huella)? */
function junto(f: Franja, s: number): boolean {
  for (const p of fisico.pilares ?? []) {
    const sc = fisico.secciones.find((x) => x.id === p.seccion) as { b: number; h: number };
    const girado = ((p.giro ?? 0) / 90) % 2 === 1;
    const [bx, by] = girado ? [sc.b, sc.h] : [sc.h, sc.b];
    const [c, t, ancho] = f.dir === 1 ? [p.x, p.y, by] : [p.y, p.x, bx];
    if (Math.abs(s - c) <= 0.5 && f.t0 < t + ancho / 2 && f.t1 > t - ancho / 2) return true;
  }
  return false;
}

const fina = medir({ tamanoMalla: 0.125, refinoEsquinas: true });
const variantes: [string, OpcionesCompilacion][] = [
  ["LV1, h = 0,75", { refinoEsquinas: false }],
  ["LV2, h = 0,75", { refinoEsquinas: true }],
  ["LV1, h = 0,5 uniforme", { tamanoMalla: 0.5, refinoEsquinas: false }],
  ["LV2, h = 0,5", { tamanoMalla: 0.5, refinoEsquinas: true }],
];
console.log("## Retícula de 4 × 4 (fase LV): franjas con ELU frente a h = 0,125\n");
console.log(`${"".padEnd(24)}${"apoyos: mediana / máx".padStart(24)}${"vano: mediana / máx".padStart(24)}${"caras junto a un pilar: máx".padStart(30)}${"apoyos > 10 % / > 20 %".padStart(26)}`);
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
const pct = (v: number) => `${(100 * v).toFixed(1)} %`;
const peores = new Map<string, [string, number, number, number, boolean][]>();
const mas20 = new Map<string, [string, number, number][]>();
for (const [nombre, op] of variantes) {
  const g = medir(op);
  const ea: number[] = [];
  const ev: number[] = [];
  const ej: number[] = [];
  const todos: [string, number, number, number, boolean][] = [];
  for (const [id, x] of g) {
    const y = fina.get(id)!;
    const ref = Math.max(1, ...[...y.apoyos.values()].map((a) => a.v));
    for (const [k, a] of x.apoyos) {
      const b = y.apoyos.get(k);
      if (!b) continue;
      const err = Math.abs(a.v - b.v) / ref;
      ea.push(err);
      const j = junto(x, a.s);
      if (j) ej.push(err);
      todos.push([`${id} ${k}`, a.v, b.v, err, j]);
    }
    if (y.vano > 1) {
      ev.push(Math.abs(x.vano / y.vano - 1));
      todos.push([`${id} vano`, x.vano, y.vano, Math.abs(x.vano / y.vano - 1), false]);
    }
  }
  peores.set(nombre, todos.sort((a, b) => b[3] - a[3]).slice(0, 10));
  mas20.set(nombre, todos.filter((x) => x[3] > 0.2 && !x[0].endsWith("vano")).map((x) => [x[0], x[3], 0]));
  console.log(`${nombre.padEnd(24)}${`${pct(med(ea))} / ${pct(Math.max(...ea))}`.padStart(24)}${`${pct(med(ev))} / ${pct(Math.max(...ev))}`.padStart(24)}${`${pct(Math.max(...ej))} (${ej.length})`.padStart(30)}${`${ea.filter((x) => x > 0.1).length} / ${ea.filter((x) => x > 0.2).length} (${ea.length})`.padStart(26)}`);
}
const [n2, nU] = [mas20.get("LV2, h = 0,75")!.length, mas20.get("LV1, h = 0,5 uniforme")!.length];
console.log(`\n**Criterio 3:** estaciones de apoyo por encima del 20 %, ${n2} con LV2 (h = 0,75) frente a ${nU} con h = 0,5 uniforme: ${n2 <= nU ? "pasa" : "no pasa"}.`);
console.log(`Aviso malla/esquina-sin-refinar con LV2, h = 0,75: ${sinRefinar.get(JSON.stringify({ refinoEsquinas: true }))!.join(", ") || "ninguno"}.`);

// Serie al refinar de las de LV2 por encima del 20 % (con la de h = 0,125 de referencia, ya medida)
const serie = [0.5, 0.25].map((h) => medir({ tamanoMalla: h, refinoEsquinas: true }));
const lv2 = medir({ refinoEsquinas: true });
console.log("\n### LV2, h = 0,75: las de apoyo por encima del 20 %, al refinar (kN·m/m; * junto a un pilar)");
console.log(`   ${"".padEnd(30)}${["0,75", "0,5", "0,25", "0,125"].map((x) => x.padStart(9)).join("")}   0,25 → 0,125`);
for (const [k] of mas20.get("LV2, h = 0,75")!) {
  const [id, s] = k.split(" ") as [string, string];
  const v = [lv2, ...serie, fina].map((g) => g.get(id)!.apoyos.get(s)!.v);
  const ref = Math.max(1, ...[...fina.get(id)!.apoyos.values()].map((a) => a.v));
  const j = junto(lv2.get(id)!, lv2.get(id)!.apoyos.get(s)!.s);
  console.log(`   ${(k + (j ? " *" : "")).padEnd(30)}${v.map((x) => x.toFixed(2).padStart(9)).join("")}   ${pct((v[3]! - v[2]!) / ref).padStart(8)}`);
}

for (const [nombre, t] of peores) {
  console.log(`\n### Los peores, ${nombre} (valor, referencia, error; * junto a un pilar)`);
  for (const [k, v, w, err, j] of t) console.log(`   ${(k + (j ? " *" : "")).padEnd(30)} ${v.toFixed(2).padStart(8)} ${w.toFixed(2).padStart(8)} ${pct(err).padStart(8)}`);
}
