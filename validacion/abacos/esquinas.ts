/**
 * Esquinas entrantes de la losa (las de los huecos y las cóncavas del contorno): a qué distancia de la
 * esquina deja de converger una estación de franja. En el trozo reticular de `sp3.ts` (3 × 3 vanos,
 * 2 plantas, con el hueco de la escalera en [12,6; 17,4] × [10,4; 14,6]), cada estación cuya recta,
 * dentro de su franja (o de su ventana), pasa a ≤ 1,5 m de una esquina: su envolvente con h de 0,75 a
 * 0,1 y el error de h = 0,75 frente a h = 0,1 con ε_snap = 0,01, por distancia.
 * Uso: bun validacion/abacos/esquinas.ts > validacion/abacos/out_esquinas.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { ejesArmado, esquinasEntrantes } from "../../src/compilador/franjas.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";

await prepararNucleo();
const fisico: ModeloFisico = conAcciones(edificioReticular(2, 3, 3));
const RADIO = 1.5;

interface Fila {
  clave: string;
  d: number;
  /** Ancho en losa sobre el de la franja. */
  losa: number;
  sup: number;
  inf: number;
}

function medir(op: OpcionesCompilacion): Map<string, Fila> {
  const c = compilar(fisico, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, op);
  const cj = conjuntoCombinaciones(q, seleccionPorDefecto(fisico.casos, "esfuerzos"));
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  const ctx = validar(fisico, resolverOpciones(op), new Diagnosticos())!;
  const r = new Map<string, Fila>();
  for (const l of ctx.losas) {
    const esq = esquinasEntrantes(l.region);
    const fs = q.franjas(l.losa.id);
    if (!fs.valido) throw new Error(l.losa.id);
    for (const f of fs.valor) {
      const { d, n } = ejesArmado(l.losa)[f.direccion];
      const e = q.franja(f.id);
      const a = q.armadoFranja(f.id, cj.valor.factores);
      if (!e.valido || !a.valido) throw new Error(f.id);
      e.valor.estaciones.forEach((x, i) => {
        const [t0, t1] = x.ventana ?? [f.t0, f.t1];
        const dist = Math.min(...esq.map(({ p: P }) => {
          const sc = P[0] * d[0] + P[1] * d[1];
          const tc = P[0] * n[0] + P[1] * n[1];
          return Math.hypot(x.s - sc, Math.max(0, t0 - tc, tc - t1));
        }));
        if (!(dist <= RADIO)) return;
        r.set(`${f.id}|${x.tipo}|${x.s.toFixed(3)}|${x.lado}`, { clave: `${f.id}|${x.tipo}|${x.s.toFixed(3)}|${x.lado}`, d: dist, losa: x.anchoEnLosa / (t1 - t0), sup: a.valor[i]!.superior, inf: a.valor[i]!.inferior });
      });
    }
  }
  console.error(`  ${JSON.stringify(op)}: ${c.modelo.nudos.length} nudos`);
  return r;
}

const MALLAS: [string, OpcionesCompilacion][] = [
  ["0,75", { tamanoMalla: 0.75 }],
  ["0,375", { tamanoMalla: 0.375 }],
  ["0,25 ε.01", { tamanoMalla: 0.25, epsSnap: 0.01 }],
  ["0,15 ε.01", { tamanoMalla: 0.15, epsSnap: 0.01 }],
  ["0,1 ε.01", { tamanoMalla: 0.1, epsSnap: 0.01 }],
];
const res = MALLAS.map(([n, o]) => [n, medir(o)] as const);
const ref = res[res.length - 1]![1];
const pc = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} %`;

console.log(`Trozo reticular: estaciones de franja a ≤ ${RADIO} m de una esquina entrante (envolvente de ELU, kN·m/m; sólo las ≥ 10 en la referencia)`);
for (const lado of ["sup", "inf"] as const) {
  console.log(`\n${lado === "sup" ? "Superior" : "Inferior"}: error de h = 0,75 frente a h = 0,1 (ε_snap 0,01) por distancia a la esquina`);
  console.log(`  ${"distancia".padEnd(12)} estaciones  media  |media|   peor   (las ≥ 20)`);
  for (const [a, b] of [
    [0, 0.25],
    [0.25, 0.5],
    [0.5, 0.75],
    [0.75, 1.0],
    [1.0, 1.5],
  ] as const) {
    const es: number[] = [];
    for (const [cl, f] of ref) {
      const g = res[0]![1].get(cl);
      if (!g || f.d < a || f.d >= b || f[lado] < 20) continue;
      es.push((g[lado] - f[lado]) / f[lado]);
    }
    if (!es.length) continue;
    const peor = es.reduce((x, y) => (Math.abs(y) > Math.abs(x) ? y : x));
    console.log(`  ${`${a}–${b} m`.padEnd(12)} ${String(es.length).padStart(10)}  ${pc(es.reduce((x, y) => x + y, 0) / es.length).padStart(7)} ${pc(es.reduce((x, y) => x + Math.abs(y), 0) / es.length).padStart(7)} ${pc(peor).padStart(7)}`);
  }
}

console.log(`\nPor estación (a ≤ 0,75 m; superior / inferior ≥ 10 en la referencia): distancia, losa / ancho, y el valor en cada malla`);
console.log(`  ${"franja | tipo | s | lado".padEnd(32)} ${"d".padStart(5)} ${"losa".padStart(5)}  ${MALLAS.map(([n]) => n.padStart(10)).join("")}   0,75 frente a 0,1`);
for (const [cl, f] of [...ref].sort((x, y) => x[1].d - y[1].d)) {
  if (f.d > 0.75) continue;
  for (const lado of ["sup", "inf"] as const) {
    if (f[lado] < 10) continue;
    const vs = res.map(([, m]) => m.get(cl)?.[lado]);
    const v0 = vs[0];
    console.log(`  ${`${cl} ${lado}`.padEnd(32)} ${f.d.toFixed(2).padStart(5)} ${f.losa.toFixed(2).padStart(5)}  ${vs.map((v) => (v === undefined ? "—" : v.toFixed(1)).padStart(10)).join("")}   ${v0 === undefined ? "—" : pc((v0 - f[lado]) / f[lado])}`);
  }
}
