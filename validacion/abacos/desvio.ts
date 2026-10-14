/**
 * Láminas de ábaco cuyo SPR en el centroide más se separa del valor de la lámina, en el reticular de
 * 2 × 2 vanos (`conAcciones(edificioReticular(1, 2, 2))`) o el muestrario. Uso:
 * bun validacion/abacos/desvio.ts [muestrario]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { calcular } from "../../src/motor/calcular.ts";

await prepararNucleo();
const f = process.argv[2] === "muestrario" ? JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8")).modelo : conAcciones(edificioReticular(1, 2, 2));
const c = compilar(f);
if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
const k = calcular(c.modelo);
if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
const r = k.casos.find((x) => x.id === "G")!;
const campos = new CamposLaminas(c.modelo);
const ev = campos.evaluador(r.u);
const C = campos as any;
const filas: { d: number; t: string }[] = [];
const maxRegion = new Map<number, number>();
(c.modelo.laminas ?? []).forEach((_, i) => {
  const g = campos.region(i);
  if (g < 0 || !c.mapeo.laminas?.[i]?.abaco) return;
  maxRegion.set(g, Math.max(maxRegion.get(g) ?? 0, Math.abs(r.esfuerzosLaminas[8 * i + 3]!), Math.abs(r.esfuerzosLaminas[8 * i + 4]!)));
});
(c.modelo.laminas ?? []).forEach((l, i) => {
  const g = campos.region(i);
  if (g < 0 || !c.mapeo.laminas?.[i]?.abaco) return;
  const v = ev.en(i, 0, 0);
  const ns = l.nudos.map((n) => c.modelo.nudos[n]!);
  const x = ns.reduce((s, n) => s + n.x, 0) / 4, y = ns.reduce((s, n) => s + n.y, 0) / 4;
  for (const q of [3, 4]) {
    const raw = r.esfuerzosLaminas[8 * i + q]!;
    const d = Math.abs(v[q]! - raw) / maxRegion.get(g)!;
    const plazas = [0, 1, 2, 3].map((a) => C.plazas[4 * i + a]);
    const vias = plazas.map((p: number) => `${C.borde[p] ? "b" : "i"}${C.plan(p).parches.length}/${C.plan(p).parches[0].base.n}Λ${campos.lebesgueEn(p).toFixed(1)}`).join(" ");
    filas.push({ d, t: `M${q === 3 ? 11 : 22} (${x.toFixed(2)}, ${y.toFixed(2)}) reg ${g} (${C.regiones[g].laminas.length} láms, máx ${maxRegion.get(g)!.toFixed(1)})  lámina ${raw.toFixed(1)}  SPR ${v[q]!.toFixed(1)}  desvío ${(100 * d).toFixed(0)} %  nudos ${vias}` });
  }
});
filas.sort((a, b) => b.d - a.d);
for (const f of filas.slice(0, 15)) console.log(f.t);
