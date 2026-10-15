/**
 * Criterio 8 de la fase LV (`docs/fem3d/union-losa-viga.md`): el tamaño de la malla con la unión por
 * las caras frente a la de antes, en el edificio objetivo con losas y vigas por todos los ejes (C2) y
 * en la retícula enrasada: nudos, ecuaciones aproximadas (6 por nudo libre), láminas en la rejilla y
 * plantillas de pilar, ecuaciones y tiempos de compilación y cálculo, respaldo y avisos de calidad.
 *
 *   bun validacion/lv/banco.ts [plantas] > validacion/lv/out_banco.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { edificioObjetivoLosas, reticulaEnrasada } from "../c2/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const plantas = Number(process.argv[2] ?? 7);
const casos: [string, ModeloFisico][] = [
  [`edificio objetivo con losas (${plantas} plantas)`, edificioObjetivoLosas(plantas)],
  ["retícula enrasada", reticulaEnrasada(1)],
];
for (const [nombre, f] of casos) {
  console.log(`## ${nombre}`);
  for (const op of [{}, { unionLosaViga: "eje" }] as OpcionesCompilacion[]) {
    const t0 = performance.now();
    const r = compilar(f, op);
    const ms = performance.now() - t0;
    if (!r.valido) {
      console.log(`  ${JSON.stringify(op)}: NO compila: ${r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo).join(", ")}`);
      continue;
    }
    const e = r.estadisticas;
    const t1 = performance.now();
    const c = calcular(r.modelo);
    const tc = performance.now() - t1;
    const calc = c.valido ? `; cálculo ${Math.round(tc)} ms, ${c.estadisticas.ecuaciones} ecuaciones` : `; cálculo NO válido: ${c.diagnosticos.map((d) => d.codigo).join(", ")}`;
    const avisos = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => d.codigo))].join(", ");
    console.log(
      `  ${(op.unionLosaViga ?? "cara").padEnd(5)} nudos ${e.nudos}, láminas ${e.laminas} (${e.malla.laminasRejilla} en la rejilla, ${e.malla.plantillas} plantillas), enlaces de cara ${e.enlacesVigas.enlaces} (${e.enlacesVigas.nudos} nudos), jacobiano mínimo ${e.malla.jacobianoMin.toFixed(3)} (${e.malla.bajos} bajos), compilación ${Math.round(ms)} ms${calc}${avisos ? `; ${avisos}` : ""}`,
    );
  }
}
