/**
 * PF (`docs/fem3d/punto-fijo.md`): lo que cambia el punto fijo en los pilares de fachada que reducen
 * su sección. Modelo `edificioPuntoFijo` (`src/pruebas/puntoFijo.ts`): losa plana de 25 cm, 2 × 2 vanos
 * de 5 m y tres plantas; pilares de 40 × 40 hasta N1 y de 30 × 30 encima, con la cara exterior (o la
 * esquina) fija en el borde de la losa; el central, con el centro fijo. Casos G (peso propio) y Q
 * (3 kN/m²), sumados con factor 1. Tres modelos:
 * - PF: con el punto fijo (la excentricidad de 5 cm entre tramos, con su brazo rígido);
 * - eje 40: sin punto fijo, todos los tramos en el eje del de 40 (lo que se hacía antes de PF);
 * - eje 30: sin punto fijo, todos en el eje del de 30.
 * De cada pilar, el tramo de N1 en su cabeza y el de N2 en su base (esfuerzos en las caras, i' y j',
 * ejes locales: My en el plano del canto, que con giro 0 es XZ; Mz, en el YZ). Y N·e del de N2.
 *
 *   bun validacion/pf/medir.ts > validacion/pf/out_medir.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { ejePilar } from "../../src/compilador/puntoFijo.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { edificioPuntoFijo } from "../../src/pruebas/puntoFijo.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const f1 = (v: number) => v.toFixed(1).padStart(7);
const f2 = (v: number) => v.toFixed(2).padStart(7);

/** Sin punto fijo: cada pilar en el eje de su sección de medidas m (el mismo en todos los tramos). */
const sinFijo = (f: ModeloFisico, lado: number): ModeloFisico => ({
  ...f,
  pilares: f.pilares!.map(({ fijo, ...p }) => {
    const [x, y] = ejePilar({ ...p, fijo }, { h: lado, b: lado });
    return { ...p, x, y };
  }),
});

type Tramos = Record<string, { n1: Float64Array; n2: Float64Array }>;

function medir(f: ModeloFisico): { tramos: Tramos; ecuaciones: number } {
  const r = valido(compilar(f));
  const casos = casosValidos(calcular(r.modelo));
  const c = new Consultas(f, r, casos, {});
  const ks = ["G", "Q"].map((id) => f.casos.findIndex((x) => x.id === id));
  const suma = (e: Float64Array) => Float64Array.from({ length: 6 }, (_, i) => ks.reduce((s, k) => s + e[6 * k + i]!, 0));
  const tramos: Tramos = {};
  for (const p of f.pilares!) {
    const t = c.pilar(p.id);
    if (!t.valido) throw new Error(p.id);
    const de = (planta: string) => t.valor.find((x) => x.planta === planta)!;
    tramos[p.id] = { n1: suma(de("N1").cabeza.esfuerzos), n2: suma(de("N2").base.esfuerzos) };
  }
  return { tramos, ecuaciones: 6 * r.modelo.nudos.length };
}

const f = edificioPuntoFijo();
const variantes = [
  ["PF", medir(f)],
  ["eje 40", medir(sinFijo(f, 0.4))],
  ["eje 30", medir(sinFijo(f, 0.3))],
] as const;

console.log("PF: punto fijo en la fachada (40 × 40 hasta N1, 30 × 30 encima; e = 5 cm por lado). G + Q, kN y kN·m.");
console.log(`Nudos: ${variantes.map(([n, m]) => `${n} ${m.ecuaciones / 6}`).join(", ")}`);
console.log(`\n${"pilar".padEnd(6)} ${"fijo".padEnd(26)} ${"modelo".padEnd(7)} | cabeza de N1: ${"N".padStart(7)} ${"My".padStart(7)} ${"Mz".padStart(7)} | base de N2: ${"N".padStart(7)} ${"My".padStart(7)} ${"Mz".padStart(7)} | ${"N·e".padStart(6)}`);
for (const p of f.pilares!) {
  for (const [nombre, m] of variantes) {
    const t = m.tramos[p.id]!;
    const e = nombre === "PF" ? Math.hypot(...ejePilar(p, { h: 0.4, b: 0.4 }).map((v, i) => v - ejePilar(p, { h: 0.3, b: 0.3 })[i]!)) : 0;
    console.log(
      `${p.id.padEnd(6)} ${(p.fijo ?? "").padEnd(26)} ${nombre.padEnd(7)} |               ${f1(t.n1[0]!)} ${f2(t.n1[4]!)} ${f2(t.n1[5]!)} |             ${f1(t.n2[0]!)} ${f2(t.n2[4]!)} ${f2(t.n2[5]!)} | ${e ? f2(Math.abs(t.n2[0]!) * e) : "".padStart(7)}`,
    );
  }
}
