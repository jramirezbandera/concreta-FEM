/**
 * Fase F2, criterios 2 y 7 (`docs/fem3d/refinamiento.md`): tamaño y tiempo del edificio objetivo de 7
 * plantas (losa plana, con vigas y reticular con ábacos), con y sin el refinamiento.
 *
 * Uso: node validacion/f2/banco.ts → validacion/f2/out_banco.txt (con --sin-escribir, sólo pantalla)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });
const lineas = ["# Fase F2: tamaño y tiempo del edificio objetivo (7 plantas, h = 0,75)", "", "modelo | malla | nudos | ecuaciones | perfil móvil (≤ 200 000) | plantillas (refinadas) | avisos de malla | compilar (s) | calcular (s)"];
for (const [nombre, f] of [
  ["losa plana", sinVigas(edificioObjetivoLosas(7))],
  ["maciza con vigas", edificioObjetivoLosas(7)],
  ["reticular con ábacos (V2 de C4)", edificioReticular(7)],
] as [string, ModeloFisico][])
  for (const [malla, op] of [
    ["F1.1 + R0 (refinoCaras: false)", { refinoCaras: false }],
    ["F2", {}],
  ] as [string, OpcionesCompilacion][]) {
    // La mediana de tres
    const tc: number[] = [];
    const tk: number[] = [];
    let fila = "";
    for (let k = 0; k < 3; k++) {
      let t = performance.now();
      const r = compilar(f, op);
      tc.push((performance.now() - t) / 1000);
      if (!r.valido) throw new Error(nombre);
      t = performance.now();
      const c = calcular(r.modelo);
      tk.push((performance.now() - t) / 1000);
      if (!c.valido) throw new Error(`${nombre}: cálculo no válido`);
      const eq = c.estadisticas.ecuaciones;
      const av = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => d.codigo))].join(", ") || "—";
      fila = `${nombre} | ${malla} | ${r.modelo.nudos.length} | ${eq} | ${eq <= 200000 ? "cabe" : "NO cabe"} | ${r.estadisticas.malla.plantillas} (${r.estadisticas.malla.plantillasRefinadas}) | ${av}`;
    }
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[1]!.toFixed(2);
    lineas.push(`${fila} | ${med(tc)} | ${med(tk)}`);
    console.log(lineas[lineas.length - 1]);
  }
if (!process.argv.includes("--sin-escribir")) writeFileSync(join(import.meta.dirname, "out_banco.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
