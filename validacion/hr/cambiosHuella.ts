/**
 * Fase HR (`docs/fem3d/huella-rigida.md` §3.5, criterio 9): qué cambia en las referencias congeladas
 * de C2, C3, C4, C5 y F con la huella rígida de todos los pilares (sólo la huella y su borde, sin los
 * nudos de fuera a ≤ ε_snap). Por modelo, frente al fixture de antes: los esclavos de cada huella que
 * se pierden, los nudos, barras y láminas, el mayor cambio relativo de los resultados (u, reacciones y
 * esfuerzos, por grupos, como en las pruebas) y, en F, las franjas cuyo máximo de Wood–Armer, caras o
 * avisos cambian. Lo que no tenía esclavos fuera tiene que salir bit a bit.
 * Uso: bun validacion/hr/cambiosHuella.ts > validacion/hr/out_cambiosHuella.txt (antes de regenerar)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { errorResultados } from "../../src/pruebas/metamorficas.ts";
import { MODELOS_CONGELADOS_C2, referenciaC2, type ReferenciaC2 } from "../c2/congelar.ts";
import { MODELOS_CONGELADOS_C3 } from "../c3/congelar.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";
import { MODELOS_CONGELADOS_C5, redondeo, referenciaC5, type ReferenciaC5 } from "../c5/congelar.ts";
import { MODELOS_CONGELADOS_F, referenciaF, type ReferenciaF } from "../f/congelar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const fixtures = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__");
const leer = <T>(nombre: string) => JSON.parse(readFileSync(join(fixtures, nombre), "utf8")) as Record<string, T>;
const F = (v: number[]) => Float64Array.from(v);

type Modelo = { nudos: unknown[]; barras?: unknown[]; laminas?: unknown[]; restricciones: { id: string; esclavos: number[] }[] };

function compararC2(nombre: string, a: ReferenciaC2, b: ReferenciaC2): boolean {
  // Los fixtures van redondeados a 13 cifras (`redondeo`): se comparan así los dos
  const ma = JSON.parse(JSON.stringify(a.modelo, redondeo)) as Modelo;
  const mb = JSON.parse(JSON.stringify(b.modelo, redondeo)) as Modelo;
  const huellasA = new Map(ma.restricciones.filter((x) => x.id.endsWith(":huella")).map((x) => [x.id, x.esclavos.length]));
  const huellasB = new Map(mb.restricciones.filter((x) => x.id.endsWith(":huella")).map((x) => [x.id, x.esclavos.length]));
  const perdidos = [...huellasA].filter(([id, n]) => (huellasB.get(id) ?? 0) !== n).map(([id, n]) => `${id.replace(":huella", "")} ${n} → ${huellasB.get(id) ?? 0}`);
  const otras = ma.restricciones.length !== mb.restricciones.length || ma.restricciones.some((x, i) => !x.id.endsWith(":huella") && x.esclavos.length !== mb.restricciones[i]?.esclavos.length);
  const modeloIgual = JSON.stringify(ma) === JSON.stringify(mb);
  let peor = 0;
  if (a.casos.length === b.casos.length)
    b.casos.forEach((c, k) => {
      const x = { u: F(c.u as unknown as number[]), reacciones: F(c.reacciones as unknown as number[]), esfuerzosBarras: F(c.esfuerzosBarras as unknown as number[]), esfuerzosLaminas: F(c.esfuerzosLaminas as unknown as number[]) };
      const y = { u: F(a.casos[k]!.u as unknown as number[]), reacciones: F(a.casos[k]!.reacciones as unknown as number[]), esfuerzosBarras: F(a.casos[k]!.esfuerzosBarras as unknown as number[]), esfuerzosLaminas: F(a.casos[k]!.esfuerzosLaminas as unknown as number[]) };
      if (x.u.length === y.u.length && x.esfuerzosBarras.length === y.esfuerzosBarras.length && x.esfuerzosLaminas.length === y.esfuerzosLaminas.length) peor = Math.max(peor, errorResultados(x, y));
      else peor = NaN;
    });
  console.log(
    `\n== ${nombre}: ${modeloIgual ? "modelo idéntico" : "modelo distinto"}; nudos ${ma.nudos.length} → ${mb.nudos.length}, barras ${ma.barras?.length ?? 0} → ${mb.barras?.length ?? 0}, láminas ${ma.laminas?.length ?? 0} → ${mb.laminas?.length ?? 0}; esclavos de huella que cambian: ${perdidos.length ? perdidos.join(", ") : "ninguno"}${otras ? "; otras restricciones cambian" : ""}; peor cambio relativo de los resultados: ${Number.isNaN(peor) ? "no comparable (tamaños distintos)" : peor.toExponential(2)}`,
  );
  return modeloIgual && peor < 1e-9;
}

const max = (wa: (number | null)[][], j: number) => Math.max(0, ...wa.map((x) => x[j] ?? 0));
const caras = (r: ReferenciaF["franjas"][string]) => r.estaciones.filter((x) => x.tipo === "cara").map((x) => x.s.toFixed(3)).join(" ");
function compararF(a: ReferenciaF, b: ReferenciaF): void {
  let cambian = 0;
  for (const id of Object.keys(b.franjas)) {
    const x = a.franjas[id];
    const y = b.franjas[id]!;
    if (!x) {
      console.log(`  ${id}: nueva`);
      cambian++;
      continue;
    }
    const [ia, sa, ib, sb] = [max(x.wa, 0), max(x.wa, 1), max(y.wa, 0), max(y.wa, 1)];
    const cc = caras(x) !== caras(y);
    const dd = x.diagnosticos.join() !== y.diagnosticos.join();
    const dv = Math.abs(ia - ib) > 1e-6 * Math.max(1, ia) || Math.abs(sa - sb) > 1e-6 * Math.max(1, sa);
    if (!cc && !dd && !dv) continue;
    cambian++;
    console.log(`  ${id.padEnd(16)} inferior ${ia.toFixed(1)} → ${ib.toFixed(1)}, superior ${sa.toFixed(1)} → ${sb.toFixed(1)}`);
    if (cc) console.log(`      caras: [${caras(x)}] → [${caras(y)}]`);
    if (dd) console.log(`      avisos: [${x.diagnosticos.join(", ")}] → [${y.diagnosticos.join(", ")}]`);
  }
  console.log(`  franjas que cambian: ${cambian} de ${Object.keys(b.franjas).length}`);
}

const resumen: string[] = [];
for (const [suite, modelos, fixture] of [
  ["C2", MODELOS_CONGELADOS_C2, "congelado-c2.json"],
  ["C3", MODELOS_CONGELADOS_C3, "congelado-c3.json"],
  ["C4", MODELOS_CONGELADOS_C4, "congelado-c4.json"],
] as [string, typeof MODELOS_CONGELADOS_C2, string][]) {
  console.log(`\n# ${suite}`);
  const antes = leer<ReferenciaC2>(fixture);
  const iguales: string[] = [];
  const cambian: string[] = [];
  for (const [k, f] of Object.entries(modelos)) (compararC2(k, antes[k]!, referenciaC2(f)) ? iguales : cambian).push(k);
  resumen.push(`${suite}: bit a bit ${iguales.length} (${iguales.join(", ")}); cambian ${cambian.length}${cambian.length ? ` (${cambian.join(", ")})` : ""}`);
}

console.log(`\n# C5`);
{
  const antes = leer<ReferenciaC5>("congelado-c5.json");
  const iguales: string[] = [];
  const cambian: string[] = [];
  for (const [k, f] of Object.entries(MODELOS_CONGELADOS_C5)) {
    const b = referenciaC5(f);
    const igual = compararC2(k, antes[k]!.c2, b.c2);
    const est = JSON.stringify(antes[k]!.estaciones, redondeo) === JSON.stringify(b.estaciones, redondeo);
    if (!est) console.log("  las estaciones de las bandas cambian");
    (igual && est ? iguales : cambian).push(k);
  }
  resumen.push(`C5: bit a bit ${iguales.length} (${iguales.join(", ")}); cambian ${cambian.length}${cambian.length ? ` (${cambian.join(", ")})` : ""}`);
}

console.log(`\n# F`);
{
  const antes = leer<ReferenciaF>("congelado-f.json");
  const iguales: string[] = [];
  const cambian: string[] = [];
  for (const [k, f] of Object.entries(MODELOS_CONGELADOS_F)) {
    const b = referenciaF(f);
    const igual = compararC2(k, antes[k]!.c2, b.c2);
    compararF(antes[k]!, b);
    (igual ? iguales : cambian).push(k);
  }
  resumen.push(`F: bit a bit ${iguales.length} (${iguales.join(", ")}); cambian ${cambian.length}${cambian.length ? ` (${cambian.join(", ")})` : ""}`);
}

console.log(`\n# Resumen\n${resumen.map((x) => `- ${x}`).join("\n")}`);
