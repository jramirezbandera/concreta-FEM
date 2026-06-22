// =============================================================================
// arranquePyodide.ts - ESQUELETO DE ARRANQUE compartido (DRY, FIX F5-4 eng-review).
//
// PROBLEMA que resuelve: la SECUENCIA de arranque del motor (loadPackage de los
// paquetes WASM + micropip -> instalar los WHEELS_VENDOR en orden con su flag
// `deps` -> runPythonAsync del glue) estaba COPIADA palabra por palabra entre dos
// consumidores que viven en entornos distintos:
//   - worker.ts (NAVEGADOR): indexURL "/pyodide/", wheels desde `${INDEX_URL}<fichero>`,
//     glue obtenido por import `?raw` (Vite).
//   - tests/golden/_arnes/pyodideNode.ts (NODE): indexURL de node_modules/pyodide,
//     wheels desde `file://` local normalizado, glue por readFileSync.
// Comparten WHEELS_VENDOR y PAQUETES_WASM (config.ts) pero la receta estaba
// duplicada: un fix del orden de wheels o de la llamada a micropip podia aplicarse
// a una sola copia.
//
// SOLUCION: este modulo concentra SOLO el esqueleto reutilizable. Es NEUTRAL
// respecto al entorno: NO importa `?raw` (Vite) ni `readFileSync`/`file://` (Node).
// Recibe del caller lo que DIFIERE entre entornos:
//   - una instancia Pyodide ya creada (`py`), porque loadPyodide({indexURL}) usa un
//     indexURL distinto en cada entorno y conviene que el caller controle su error.
//   - `urlWheel(fichero)`: como construir la URL de cada wheel (navegador: `${INDEX_URL}fichero`;
//     Node: `file://<ruta local normalizada>`).
//   - `glueSource`: el codigo Python del glue (el caller lo obtiene por ?raw o readFileSync).
// Y ejecuta la receta UNICA: loadPackage([...PAQUETES_WASM,"micropip"]) -> por cada
// WHEELS_VENDOR micropip.install(urlWheel(fichero), {deps}) -> runPythonAsync(glue).
//
// AISLAMIENTO (CLAUDE.md §8): vive en /src/solver junto al resto del motor. Al no
// depender de nada especifico de entorno, es importable desde el bundle del
// navegador (worker.ts) y desde Node (pyodideNode.ts). Reusa las constantes de
// config.ts (FUENTE UNICA del par de versiones y del plan de wheels).
// =============================================================================

import type { PyodideInterface } from "pyodide";

import { PAQUETES_WASM, WHEELS_VENDOR } from "./config";

/**
 * Parametros que DIFIEREN entre el arranque del navegador y el de Node. El
 * esqueleto comun (instalarMotorPyodide) solo necesita estos dos puntos de
 * variacion; todo lo demas (orden de wheels, flags `deps`, paquetes WASM) sale de
 * config.ts.
 */
export type OpcionesArranquePyodide = {
  /**
   * Construye la URL desde la que micropip instalara un wheel vendorizado.
   *   navegador: `${INDEX_URL}${fichero}`  (servido bajo /pyodide/)
   *   Node:      `file://${ruta local normalizada}`
   */
  urlWheel: (fichero: string) => string;
  /** Codigo fuente del glue Python (worker: import ?raw; Node: readFileSync). */
  glueSource: string;
};

/**
 * Ejecuta la SECUENCIA de instalacion/arranque sobre una instancia Pyodide YA
 * creada por el caller (loadPyodide queda fuera porque su indexURL difiere por
 * entorno). Pasos identicos en navegador y Node:
 *   1) loadPackage([...PAQUETES_WASM, "micropip"]) -> builds WASM (numpy/scipy) + micropip.
 *   2) por cada WHEELS_VENDOR: micropip.install(urlWheel(fichero), { deps }) en ORDEN
 *      (PrettyTable con deps -> resuelve wcwidth local; PyNiteFEA con deps:false ->
 *      esquiva numpy>=2.4 y matplotlib; hallazgos #2/#10).
 *   3) runPythonAsync(glueSource) -> define build_model/run_analysis/calcular en el interprete.
 * Resuelve cuando el glue esta cargado. Propaga cualquier excepcion al caller para
 * que aplique su politica (estado "error" en el worker; skip en los tests).
 */
export async function instalarMotorPyodide(
  py: PyodideInterface,
  { urlWheel, glueSource }: OpcionesArranquePyodide,
): Promise<void> {
  // 1) Paquetes WASM nativos de Pyodide + micropip (loadPackage los resuelve local).
  await py.loadPackage([...PAQUETES_WASM, "micropip"]);

  // 2) Wheels vendorizados (PrettyTable + PyNiteFEA) via micropip, en el ORDEN y
  //    con los flags `deps` de WHEELS_VENDOR (fuente unica, config.ts).
  const micropip = py.pyimport("micropip");
  for (const { fichero, deps } of WHEELS_VENDOR) {
    await micropip.install(urlWheel(fichero), { deps });
  }

  // 3) Definir las funciones del glue en el interprete. runPythonAsync por si el
  //    glue usa await en el futuro (hoy es sincrono; via recomendada, guia §12.5).
  await py.runPythonAsync(glueSource);
}
