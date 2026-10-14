/**
 * Franjas vecinas de un pilar (que no lo tocan): perfil de la envolvente superior estación a estación
 * junto a la cara del pilar, con la malla de uso y con la de referencia, en el edificio reticular de C4
 * de 2 plantas (las peores de `out_convergencia.txt`) o, con TROZO=1, en el trozo de 3 × 3 vanos de
 * `sp3.ts` (las peores de `out_sp3.txt`).
 * Uso: bun validacion/abacos/vecinas.ts [franja…] > validacion/abacos/out_vecinas.txt
 *      TROZO=1 bun validacion/abacos/vecinas.ts > validacion/abacos/out_vecinas_trozo.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";

await prepararNucleo();
// TROZO=1: el trozo de 3 × 3 vanos de sp3.ts, frente a h = 0,1 con ε_snap = 0,01
const TROZO = process.env.TROZO === "1";
const fisico: ModeloFisico = conAcciones(TROZO ? edificioReticular(2, 3, 3) : edificioReticular(2));
const IDS = process.argv.slice(2).length ? process.argv.slice(2) : TROZO ? ["L-N2:Y16", "L-N1:Y16"] : ["L-N2:Y31", "L-N1:Y31", "L-N2:Y29", "L-N1:X13"];
const VENTANA = 1.5;

interface Est {
  s: number;
  tipo: string;
  lado: number;
  piezas: string[];
  sup: number;
  inf: number;
}

function perfiles(op: OpcionesCompilacion): Map<string, { t: [number, number]; est: Est[] }> {
  const c = compilar(fisico, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, op);
  const cj = conjuntoCombinaciones(q, seleccionPorDefecto(fisico.casos, "esfuerzos"));
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  const r = new Map<string, { t: [number, number]; est: Est[] }>();
  for (const id of IDS) {
    const f = q.franja(id);
    const a = q.armadoFranja(id, cj.valor.factores);
    if (!f.valido || !a.valido) throw new Error(id);
    const fs = q.franjas(id.slice(0, id.lastIndexOf(":")));
    if (!fs.valido) throw new Error(id);
    const fr = fs.valor.find((x) => x.id === id)!;
    r.set(id, { t: [fr.t0, fr.t1], est: f.valor.estaciones.map((e, i) => ({ s: e.s, tipo: e.tipo, lado: e.lado, piezas: e.piezas, sup: a.valor[i]!.superior, inf: a.valor[i]!.inferior })) });
  }
  console.error(`  ${JSON.stringify(op)}: ${c.modelo.nudos.length} nudos`);
  return r;
}

const MALLAS: [string, OpcionesCompilacion][] = [
  ["0,75", { tamanoMalla: 0.75 }],
  ["0,375", { tamanoMalla: 0.375 }],
  ["0,25 ε.01", { tamanoMalla: 0.25, epsSnap: 0.01 }],
  ...(TROZO ? ([["0,1 ε.01", { tamanoMalla: 0.1, epsSnap: 0.01 }]] as [string, OpcionesCompilacion][]) : []),
];
const res = MALLAS.map(([n, o]) => [n, perfiles(o)] as const);
const pilares = fisico.pilares!;
for (const id of IDS) {
  const ref = res[res.length - 1]![1].get(id)!;
  const pico = ref.est.reduce((a, e) => (e.sup > a.sup ? e : a));
  console.log(`\n${id}: t = ${ref.t[0].toFixed(2)}…${ref.t[1].toFixed(2)}; pico superior en la referencia ${pico.sup.toFixed(1)} en s = ${pico.s.toFixed(2)} (${pico.tipo})`);
  const dir = id.includes(":X") ? 0 : 1;
  const cerca = pilares.filter((p) => Math.abs((dir ? p.y : p.x) - pico.s) < 1);
  console.log(`  pilares cerca: ${cerca.map((p) => `${p.id} (t = ${(dir ? p.x : p.y).toFixed(2)}, ${p.seccion}, giro ${p.giro ?? 0})`).join("; ")}`);
  for (const [n, m] of res) {
    const est = m.get(id)!.est.filter((e) => Math.abs(e.s - pico.s) <= VENTANA);
    console.log(`  ${n.padEnd(10)} ${est.map((e) => `${e.s.toFixed(2)}${e.tipo[0]}${e.lado > 0 ? "+" : e.lado < 0 ? "-" : ""}:${e.sup.toFixed(1)}`).join("  ")}`);
  }
}
