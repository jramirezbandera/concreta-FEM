/**
 * Oráculo externo de la fase F2 (`docs/fem3d/refinamiento.md`, criterio 5): la losa plana de H25
 * (y su reticular) con el h por defecto, con y sin el refinamiento, para OpenSeesPy ASDShellQ4. Las
 * estaciones y el modelo se exportan como en F (`validacion/f/opensees-modelos.ts`).
 *
 * `bun validacion/f2/opensees-modelos.ts` escribe validacion/f2/opensees-modelos.json (regenerable,
 * fuera del repositorio); después, `.venv312/Scripts/python.exe validacion/f/oraculo_franjas.py
 * validacion/f2` → validacion/f2/out_opensees.txt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { reticularH25 } from "../c5/modelos.ts";
import { estacionesOraculo } from "../f/opensees-modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const salida: Record<string, unknown> = {};
for (const [nombre, f, op] of [
  ["h25-plana@0.75 sin refinar", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75, refinoCaras: false }],
  ["h25-plana@0.75 con F2", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75 }],
  ["h25-plana@0.375", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.375 }],
  ["h25-reticular@0.75 con F2", reticularH25(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75 }],
] as [string, ModeloFisico, OpcionesCompilacion][]) {
  const x = estacionesOraculo(nombre, { ...f, bandas: undefined }, op);
  salida[nombre] = x;
  console.log(`${nombre}: ${x.modelo.nudos.length} nudos, ${x.estaciones.length} estaciones`);
}
writeFileSync(join(import.meta.dirname, "opensees-modelos.json"), JSON.stringify(salida));
