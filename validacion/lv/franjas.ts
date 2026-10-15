/**
 * Criterio 7 de la fase LV (`docs/fem3d/union-losa-viga.md`): las franjas de armado con la losa unida
 * a las vigas por sus caras. En la retícula de 4 × 4 pilares de 40 × 40 con vigas por todos los ejes
 * (`edificioReticular(1, 3, 3)`, la de SP-3), las estaciones de apoyo en las caras de las vigas
 * (por fuerzas nodales, del lado de la losa) y el máximo de vano de cada franja, con h = 0,75, 0,5 y
 * 0,375 frente a h = 0,25: la armadura superior (en las caras) e inferior (en el vano) de ELU. (*) El
 * error de las caras, respecto a la mayor superior de la franja: en las de las vigas de borde, con la
 * torsión a 0,1, la losa está casi apoyada y el valor es pequeño.
 *
 *   bun validacion/lv/franjas.ts > validacion/lv/out_franjas.txt
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

function consultas(op: OpcionesCompilacion): Consultas {
  const c = compilar(fisico, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  return new Consultas(fisico, c, k.casos, op);
}

/** Por franja: la superior de ELU en cada estación de apoyo (clave: s y lado) y la inferior máxima de vano. */
function medir(q: Consultas): Map<string, { apoyos: Map<string, number>; vano: number; avisos: string[] }> {
  const r = new Map<string, { apoyos: Map<string, number>; vano: number; avisos: string[] }>();
  const fs = q.franjas("L-N1");
  if (!fs.valido) throw new Error("L-N1");
  for (const f of fs.valor) {
    const e = q.franja(f.id);
    const a = q.armadoFranja(f.id, [ELU]);
    if (!e.valido || !a.valido) throw new Error(f.id);
    const apoyos = new Map<string, number>();
    let vano = 0;
    e.valor.estaciones.forEach((x, i) => {
      if (x.tipo === "apoyo") apoyos.set(`${x.s.toFixed(3)}:${x.lado}`, a.valor[i]!.superior);
      vano = Math.max(vano, a.valor[i]!.inferior);
    });
    r.set(f.id, { apoyos, vano, avisos: e.diagnosticos.map((d) => d.codigo) });
  }
  return r;
}

for (const union of ["cara", "eje"] as const) {
const fina = medir(consultas({ tamanoMalla: 0.25, unionLosaViga: union }));
console.log(`
## Unión ${union === "cara" ? "por las caras (fase LV)" : "por el eje (antes)"}. Retícula de 4 × 4 pilares de 40 × 40 con vigas por todos los ejes; ELU; frente a h = 0,25
`);
console.log("h       apoyos (cara de viga): mediana / máx |error|*  vano (máx inferior): mediana / máx |error|   estaciones de apoyo   avisos");
for (const h of [0.75, 0.5, 0.375]) {
  const g = medir(consultas({ tamanoMalla: h, unionLosaViga: union }));
  const ea: number[] = [];
  const ev: number[] = [];
  let n = 0;
  const avisos = new Set<string>();
  for (const [id, x] of g) {
    const y = fina.get(id)!;
    for (const a of x.avisos) avisos.add(a);
    // Respecto al máximo de la superior de la franja en la malla fina: en las caras de las vigas de
    // borde, con la torsión a 0,1, la losa está casi apoyada y el valor es pequeño
    const ref = Math.max(1, ...y.apoyos.values());
    for (const [k, v] of x.apoyos) {
      n++;
      const w = y.apoyos.get(k);
      if (w === undefined) continue;
      ea.push(Math.abs(v - w) / ref);
    }
    if (y.vano > 1) ev.push(Math.abs(x.vano / y.vano - 1));
  }
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
  const pct = (v: number) => `${(100 * v).toFixed(1)} %`;
  if (process.argv[2] === "peores") {
    const todos: [string, number, number, number][] = [];
    for (const [id, x] of g) {
      const y = fina.get(id)!;
      const ref = Math.max(1, ...y.apoyos.values());
      for (const [k, v] of x.apoyos) {
        const w = y.apoyos.get(k);
        if (w !== undefined) todos.push([`${id} ${k}`, v, w, Math.abs(v - w) / ref]);
      }
      if (y.vano > 1) todos.push([`${id} vano`, x.vano, y.vano, Math.abs(x.vano / y.vano - 1)]);
    }
    for (const t of todos.sort((a, b) => b[3] - a[3]).slice(0, 12)) console.log(`   ${t[0].padEnd(30)} ${t[1].toFixed(2).padStart(8)} ${t[2].toFixed(2).padStart(8)} ${(100 * t[3]).toFixed(1)} %`);
  }
  console.log(`${h.toFixed(3).padEnd(8)}${`${pct(med(ea))} / ${pct(Math.max(...ea))}`.padEnd(48)}${`${pct(med(ev))} / ${pct(Math.max(...ev))}`.padEnd(45)}${String(n).padEnd(22)}${[...avisos].join(", ")}`);
}
}
