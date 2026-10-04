/**
 * Criterio 5 de E6: el motor con edificios más grandes que el objetivo (D9), para ver cómo crecen
 * el tiempo de cada fase y la memoria.
 *
 * El edificio es el objetivo de E4 (7 plantas, 10 × 8 pilares, luces de 6 m, barras de E2, láminas
 * de E3, muro y huellas) con 24 casos, cambiando los elementos por vano: 7, 8 (el objetivo, malla de
 * 0,75 m), 10, 12 y 14, de ~22 000 a ~88 000 nudos. Cada tamaño corre en su propio proceso de Node
 * para medir su memoria máxima (maxRSS); el exponente de cada fase es la pendiente de log(tiempo)
 * frente a log(nudos), por mínimos cuadrados.
 *
 * Uso: node validacion/e6/escalado.ts [diafragma|semirrigido] → validacion/e6/out_escalado.txt
 *      (un tamaño suelto: node validacion/e6/escalado.ts --uno <elementos por vano> <variante>)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo, memoriaNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivo, huellaResultado } from "../e4/modelos.ts";

const raiz = join(import.meta.dirname, "..", "..");

if (process.argv[2] === "--uno") {
  const e = Number(process.argv[3]);
  const diafragma = process.argv[4] !== "semirrigido";
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const t0 = performance.now();
  const modelo = edificioObjetivo({ malla: 6 / e, diafragma, casos: 24 });
  const tModelo = performance.now() - t0;
  const r = calcular(modelo);
  const est = r.estadisticas;
  console.log(
    JSON.stringify({
      elementos: e,
      variante: diafragma ? "diafragma" : "semirrigido",
      valido: r.valido,
      errores: r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo),
      nudos: est?.nudos,
      ecuaciones: est?.ecuaciones,
      nnzL: est?.nnzL,
      tModelo,
      tiempos: est?.tiempos,
      total: est ? Object.entries(est.tiempos).filter(([k]) => !k.includes(".")).reduce((s, [, v]) => s + v, 0) : null,
      wasmMB: Math.round(memoriaNucleo() / 2 ** 20),
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      huella: r.valido ? huellaResultado(r) : null,
    }),
  );
  process.exit(0);
}

const variante = process.argv[2] ?? "diafragma";
const filas: Record<string, unknown>[] = [];
for (const e of [7, 8, 10, 12, 14]) {
  const salida = execFileSync(process.execPath, [import.meta.filename, "--uno", String(e), variante], { encoding: "utf8", maxBuffer: 2 ** 26, timeout: 900_000 });
  const fila = JSON.parse(salida.trim().split("\n").pop()!);
  filas.push(fila);
  console.log(JSON.stringify(fila));
  if (!fila.valido) break;
}
const validas = filas.filter((f) => f.valido) as { nudos: number; tiempos: Record<string, number>; total: number }[];
const fases = ["numeracion", "cargas", "patron", "ensamblado", "solucion.analisis", "solucion.factorizacion", "solucion.resolucion", "solucion.residuo", "recuperacion"];
const pendiente = (xs: number[], ys: number[]) => {
  const lx = xs.map(Math.log);
  const ly = ys.map((y) => Math.log(Math.max(y, 1e-3)));
  const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
  const my = ly.reduce((a, b) => a + b, 0) / ly.length;
  return lx.reduce((s, x, i) => s + (x - mx) * (ly[i]! - my), 0) / lx.reduce((s, x) => s + (x - mx) ** 2, 0);
};
const lineas = [
  `# validacion/e6/escalado.ts ${variante} — ${new Date().toISOString().slice(0, 10)}, ${cpus()[0]?.model.trim()}, node ${process.version}; 24 casos`,
  "",
  "elementos por vano | nudos | ecuaciones | nnz(L) | total (s) | factorización (s) | WASM (MB) | maxRSS (MB) | válido",
  ...filas.map((f: Record<string, unknown>) => {
    const t = f.tiempos as Record<string, number> | undefined;
    return `${f.elementos} | ${f.nudos ?? "—"} | ${f.ecuaciones ?? "—"} | ${f.nnzL ?? "—"} | ${f.total ? ((f.total as number) / 1000).toFixed(2) : "—"} | ${t?.["solucion.factorizacion"] ? (t["solucion.factorizacion"] / 1000).toFixed(2) : "—"} | ${f.wasmMB} | ${f.maxRssMB} | ${f.valido ? "sí" : `no: ${(f.errores as string[]).join(", ")}`}`;
  }),
  "",
  "Exponente del tiempo frente a los nudos (pendiente log–log):",
  ...[...fases, "total"].map((fase) => {
    const ys = validas.map((f) => (fase === "total" ? f.total : (f.tiempos[fase] ?? 0)));
    return `  ${fase}: ${validas.length >= 2 ? pendiente(validas.map((f) => f.nudos), ys).toFixed(2) : "—"} (${ys.map((y) => (y / 1000).toFixed(2)).join(", ")} s)`;
  }),
];
writeFileSync(join(import.meta.dirname, `out_escalado_${variante}.txt`), lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
