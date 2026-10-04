/**
 * Criterio 3 de E6: la batería metamórfica sobre N modelos aleatorios (por defecto 2 000), con la
 * cobertura del generador y el peor error de cada relación.
 *
 * Uso:
 *   bun validacion/e6/aleatorios.ts [N]            → validacion/e6/out_aleatorios.txt
 *   bun validacion/e6/aleatorios.ts N --resumen    → sólo una línea JSON (la usa mutaciones.ts)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { modeloAleatorio } from "../../src/pruebas/aleatorio.ts";
import { erroresMetamorficos, RELACIONES } from "../../src/pruebas/metamorficas.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const n = Number(process.argv[2] ?? 2000);
const soloResumen = process.argv.includes("--resumen");
const TOL = 1e-9;

const peores = Object.fromEntries(RELACIONES.map((k) => [k, { error: 0, semilla: 0 }]));
const detectadas = Object.fromEntries(RELACIONES.map((k) => [k, 0])) as Record<string, number>;
const fallos: string[] = [];
let excepciones = 0;
const cobertura: Record<string, number> = {};
const contar = (k: string, v = 1) => (cobertura[k] = (cobertura[k] ?? 0) + v);
let nudos = 0;
let maxNudos = 0;
const t0 = performance.now();
for (let s = 1; s <= n; s++) {
  const ma = modeloAleatorio(s);
  const m = ma.modelo;
  nudos += m.nudos.length;
  maxNudos = Math.max(maxNudos, m.nudos.length);
  if (ma.diafragmas) contar("diafragma");
  if (m.restricciones?.some((r) => r.tipo === "enlace-rigido")) contar("huella (enlace rígido)");
  if (ma.diafragmas && m.restricciones?.some((r) => r.tipo === "enlace-rigido")) contar("cadena huella → diafragma");
  if (m.laminas?.length) contar("forjado de láminas");
  if (m.laminas?.some((l) => l.multiplicadores)) contar("multiplicadores de lámina");
  if (m.laminas?.some((l) => Math.abs(m.nudos[l.nudos[0]]!.z - m.nudos[l.nudos[2]]!.z) > 0.1)) contar("muro de láminas");
  if (m.barras?.some((b) => b.liberaciones)) contar("liberaciones");
  if (m.barras?.some((b) => b.offsets)) contar("offsets");
  if (m.muelles?.some((x) => x.nudos.length === 1)) contar("muelle a tierra");
  if (m.muelles?.some((x) => x.nudos.length === 2)) contar("muelle entre nudos");
  if (ma.impuestos) contar("desplazamientos impuestos");
  try {
    const e = erroresMetamorficos(ma, s);
    const malas: string[] = [];
    for (const k of RELACIONES) {
      const v = e[k];
      if (!(v <= (k === "determinismo" ? 0 : TOL))) {
        detectadas[k]!++;
        malas.push(`${k} = ${v.toExponential(2)}`);
      }
      if (!(v <= peores[k]!.error)) peores[k] = { error: v, semilla: s };
    }
    if (malas.length) fallos.push(`semilla ${s}: ${malas.join(", ")}`);
  } catch (err) {
    excepciones++;
    fallos.push(`semilla ${s}: ${String(err).split("\n").slice(0, 3).join(" ")}`);
  }
}
const segundos = (performance.now() - t0) / 1000;
if (soloResumen) {
  console.log(JSON.stringify({ n, modelosConFallo: fallos.length, excepciones, detectadas, primerFallo: fallos[0] ?? null }));
} else {
  const lineas = [
    `# validacion/e6/aleatorios.ts — ${new Date().toISOString().slice(0, 10)}; ${n} modelos (semillas 1…${n}), ${segundos.toFixed(1)} s`,
    `Nudos por modelo: media ${(nudos / n).toFixed(0)}, máximo ${maxNudos}`,
    "",
    "Cobertura (modelos que tienen cada objeto):",
    ...Object.entries(cobertura).map(([k, v]) => `  ${k}: ${v} (${((100 * v) / n).toFixed(0)} %)`),
    "",
    `Peor error de cada relación (tolerancia ${TOL}; determinismo, 0 exacto):`,
    ...RELACIONES.map((k) => `  ${k}: ${peores[k]!.error.toExponential(2)} (semilla ${peores[k]!.semilla})`),
    "",
    `Modelos con algún fallo: ${fallos.length}; con excepción: ${excepciones}`,
    ...fallos.slice(0, 50),
  ];
  writeFileSync(join(import.meta.dirname, "out_aleatorios.txt"), lineas.join("\n") + "\n");
  console.log(lineas.join("\n"));
}
