/**
 * Cuánto se sale de verdad cada nudo del rango de sus muestras, por tramos de Λ: e = |M nudo| /
 * máx |M muestra| (M = Mx, My, Mxy), con la suma de los casos gravitatorios. Uso:
 * bun validacion/abacos/exceso.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepararNucleo } from "../a3/revisar.ts";
import { reticularH25 } from "../c5/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { losaPilaresMezclados } from "../c5/modelos.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { lebesgue } from "./lebesgue.ts";
import { OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";

await prepararNucleo();
const modelos: [string, () => [ModeloFisico, OpcionesCompilacion]][] = [
  ["muestrario", () => [JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8")).modelo, {}]],
  ["edificioReticular(2)", () => [edificioReticular(2), {}]],
  ["h25-reticular", () => [reticularH25(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75 }]],
  ["pilares-mezclados", () => [losaPilaresMezclados(), {}]],
];
const TRAMOS = [0, 2, 3, 5, 7, 10, 20, Infinity];
for (const [nombre, f] of modelos) {
  const [fisico, opciones] = f();
  const c = compilar(fisico, opciones);
  if (!c.valido) throw new Error(nombre);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(nombre);
  const u = new Float64Array(k.casos[0]!.u.length);
  for (const r of k.casos) if (!/^(W|E|S)/.test(r.id)) for (let i = 0; i < u.length; i++) u[i] += r.u[i]!;
  const campos = new CamposLaminas(c.modelo);
  const { L } = lebesgue(campos);
  const ev = campos.evaluador(u);
  const C = campos.flexion as any;
  const peor = TRAMOS.slice(1).map(() => ({ n: 0, max: 0, p95: [] as number[] }));
  for (let p = 0; p < campos.nPlazas; p++) {
    const v = ev.plaza(p);
    const pl = C.plan(p);
    let m = 0;
    for (const c2 of pl.parches) for (const s of c2.muestras) {
      // Muestras de flexión de la lámina: 5 × [Mx, My, Mxy, Qx, Qy] en el triedro de su región
      const g = (ev as any).muestrasFlexion(Math.floor(s / 5));
      const o = 5 * (s % 5);
      m = Math.max(m, Math.abs(g[o]), Math.abs(g[o + 1]), Math.abs(g[o + 2]));
    }
    const e = Math.max(Math.abs(v[3]!), Math.abs(v[4]!), Math.abs(v[5]!)) / (m || 1);
    const t = TRAMOS.findIndex((x, i) => L[p]! >= x && L[p]! < TRAMOS[i + 1]!);
    const b = peor[t]!;
    b.n++;
    b.max = Math.max(b.max, e);
    b.p95.push(e);
  }
  console.log(`\n${nombre}`);
  peor.forEach((b, i) => {
    if (!b.n) return;
    b.p95.sort((a, z) => a - z);
    console.log(`  Λ en [${TRAMOS[i]}, ${TRAMOS[i + 1]}): ${String(b.n).padStart(6)} nudos  exceso p95 ${b.p95[Math.floor(0.95 * (b.n - 1))]!.toFixed(2)}  máx ${b.max.toFixed(2)}`);
  });
}
