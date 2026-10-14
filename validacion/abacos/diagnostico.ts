/**
 * Diagnóstico: M11 junto a los pilares medianeros del muestrario (L2, reticular de PL1).
 * Compara el valor bruto en el centroide de cada lámina con el del mapa (SPR) y dice la región SPR.
 * Uso: bun validacion/abacos/diagnostico.ts [x y radio]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepararNucleo } from "../a3/revisar.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { calcular } from "../../src/motor/calcular.ts";

await prepararNucleo();
const p = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8"));
const c = compilar(p.modelo, p.opciones ?? {});
if (!c.valido) throw new Error(JSON.stringify(c.diagnosticos.slice(0, 3)));
const k = calcular(c.modelo);
if (!k.valido) throw new Error(JSON.stringify(k.diagnosticos.slice(0, 3)));
const FAC: Record<string, number> = { G: 1.35, CM: 1.35, Q: 1.5 };
const ncomb = k.casos.length;
const u = new Float64Array(k.casos[0]!.u.length);
const raw = new Float64Array(k.casos[0]!.esfuerzosLaminas.length);
k.casos.forEach((r) => {
  const f = FAC[r.id] ?? 0;
  if (!f) return;
  for (let i = 0; i < u.length; i++) u[i] += f * r.u[i]!;
  for (let i = 0; i < raw.length; i++) raw[i] += f * r.esfuerzosLaminas[i]!;
});
console.log("casos", ncomb, k.casos.map((r) => r.id).join(" "));
const campos = new CamposLaminas(c.modelo);
const ev = campos.evaluadorCompartido(u);
const [x0, y0, R] = process.argv.slice(2).map(Number) as [number, number, number];
const cx = x0 ?? 0, cy = y0 ?? 5.5, rr = R ?? 1.6;
const filas: string[] = [];
(c.modelo.laminas ?? []).forEach((l, i) => {
  const m = c.mapeo.laminas?.[i];
  if (m?.losa !== "L2") return;
  const ns = l.nudos.map((n) => c.modelo.nudos[n]!);
  const x = ns.reduce((s, n) => s + n.x, 0) / 4, y = ns.reduce((s, n) => s + n.y, 0) / 4;
  if (Math.abs(x - cx) > rr || Math.abs(y - cy) > rr) return;
  const reg = campos.region(i);
  const spr = reg >= 0 ? ev.en(i, 0, 0) : null;
  filas.push(
    `${x.toFixed(2).padStart(6)} ${y.toFixed(2).padStart(6)} ab=${m.abaco ? 1 : 0} reg=${String(reg).padStart(3)}  M11 bruto=${raw[8 * i + 3]!.toFixed(1).padStart(8)} spr=${spr ? spr[3]!.toFixed(1).padStart(8) : "     -  "}   M22 bruto=${raw[8 * i + 4]!.toFixed(1).padStart(8)} spr=${spr ? spr[4]!.toFixed(1).padStart(8) : "     -  "}`,
  );
});
filas.sort();
console.log(filas.join("\n"));

// Plazas de la región de la lámina más cercana a (cx + 0.7, cy + 0.6)
if (process.env.PLAZAS) {
  const C = campos as any;
  let mejor = -1, dmin = Infinity;
  (c.modelo.laminas ?? []).forEach((l, i) => {
    if (campos.region(i) < 0 || c.mapeo.laminas?.[i]?.losa !== "L2") return;
    const ns = l.nudos.map((n) => c.modelo.nudos[n]!);
    const d = Math.hypot(ns.reduce((s, n) => s + n.x, 0) / 4 - cx - 0.7, ns.reduce((s, n) => s + n.y, 0) / 4 - cy - 0.6);
    if (d < dmin) [dmin, mejor] = [d, i];
  });
  const g = campos.region(mejor);
  console.log("región", g, "láminas", C.regiones[g].laminas.length);
  const nod = campos.nodales(u);
  for (let p = 0; p < campos.nPlazas; p++) {
    if (C.regionDePlaza[p] !== g) continue;
    const pl = C.plan(p);
    // coordenadas globales: de una lámina que use la plaza
    let xy = "";
    for (const k of C.regiones[g].laminas) for (let a = 0; a < 4; a++) if (C.plazas[4 * k + a] === p && !xy) { const n = c.modelo.nudos[c.modelo.laminas![k]!.nudos[a]!]!; xy = `${n.x.toFixed(2)},${n.y.toFixed(2)}`; }
    console.log(`plaza ${String(p).padStart(6)} (${xy}) borde=${C.borde[p]} parches=${pl.parches.length} bases=${pl.parches.map((q: any) => q.base.n + "/" + q.muestras.length + "@(" + q.x.toFixed(2) + "," + q.y.toFixed(2) + ")").join(" ")} degr=${pl.degradado}  M11=${nod[8 * p + 3]!.toFixed(1)} M22=${nod[8 * p + 4]!.toFixed(1)}`);
  }
}
