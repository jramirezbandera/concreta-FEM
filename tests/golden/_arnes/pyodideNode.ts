// =============================================================================
// ARRANQUE DE PYODIDE EN NODE — NUCLEO COMPARTIDO (DRY, FIX Q1 eng-review F6).
//
// PROBLEMA que resuelve: la receta de arranque del motor FEM en Node estaba
// DUPLICADA palabra por palabra entre el arnes golden (tests/golden/_arnes/
// motor.ts) y el smoke test (src/solver/smoke.test.ts): loadPyodide con el
// indexURL local de node_modules/pyodide, loadPackage de PAQUETES_WASM+micropip,
// instalacion de los WHEELS_VENDOR desde file:// local (con la barra normalizada
// SIN %20), runPythonAsync del glue pynite_glue.py, lectura de las versiones
// reales del runtime y el closure calcular() que serializa el ModeloFEM y valida
// la salida con ResultadosCalculoSchema.safeParse. Mantener dos copias en sync
// era una trampa: un fix de la URL file:// o del orden de wheels podia aplicarse
// a una sola.
//
// SOLUCION: este modulo concentra el NUCLEO compartido. Los dos consumidores
// aportan SOLO su politica de test (el arnes golden envuelve en ArranqueMotor
// {ok|skip+motivo} y cachea la promesa a nivel de modulo; el smoke hace su skip
// propio con sus console.warn de diagnostico). Aqui NO vive ninguna logica de
// test: solo la fontaneria reutilizable.
//
// UBICACION: vive en tests/golden/_arnes/ (sitio NEUTRAL respecto a capas). El
// smoke (src/solver/smoke.test.ts) lo importa por ruta relativa, igual que ya
// importa fixtures de tests indirectamente y tipos de src. Justificacion: es
// codigo de INFRAESTRUCTURA DE TEST, no de produccion; src/solver/worker.ts (el
// runtime real del navegador) NO depende de el. Ponerlo bajo src/ haria que
// produccion arrastrara una ruta a vendor/wheels/ via file://, que solo tiene
// sentido en Node. Por eso el nucleo Node-only queda en tests/.
//
// OFFLINE TOTAL (regla de oro #9): numpy/scipy/micropip/wcwidth son wheels WASM
// ya presentes en node_modules/pyodide (indexURL local); PyNiteFEA + PrettyTable
// estan VENDORIZADOS en vendor/wheels/ y se instalan con micropip desde file://
// local. No se toca PyPI ni el CDN. Reusa las constantes de src/solver/config.ts
// (FUENTE UNICA del par de versiones y del plan de wheels; CLAUDE.md §8, §18).
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadPyodide, type PyodideInterface } from "pyodide";

import { WHEELS_VENDOR } from "../../../src/solver/config";
// Esqueleto de arranque compartido (DRY, FIX F5-4): la SECUENCIA loadPackage ->
// instalar wheels en orden -> runPythonAsync(glue) se reusa del modulo de produccion
// (src/solver/arranquePyodide.ts), que es NEUTRAL respecto al entorno. Aqui solo
// aportamos lo especifico de Node: la URL file:// de cada wheel y el glue por
// readFileSync. NO se duplica ya la receta entre worker.ts y este arnes.
import { instalarMotorPyodide } from "../../../src/solver/arranquePyodide";
import {
  ResultadosCalculoSchema,
  type ResultadosCalculo,
} from "../../../src/solver/resultados";
import type { ModeloFEM } from "../../../src/discretizador/contratoFEM";

const here = dirname(fileURLToPath(import.meta.url));
// node_modules/pyodide (pyodide-lock.json + .wasm + los 15 wheels WASM:
// numpy/scipy/micropip/wcwidth/...). loadPyodide resuelve los wheels relativos a
// aqui SIN red. Rutas calculadas RELATIVAS a este modulo: ambos consumidores
// obtienen las MISMAS rutas absolutas sea cual sea su ubicacion.
const INDEX_URL_NODE = resolve(here, "../../../node_modules/pyodide") + "/";
// El glue Python vive en src/solver y es la frontera Python<->TS.
const GLUE_PATH = resolve(here, "../../../src/solver/pynite_glue.py");
// Wheels vendorizados (PyNiteFEA, PrettyTable) en vendor/wheels/. En Node se
// instalan con micropip desde una URL file:// local — sin red (regla de oro #9).
const VENDOR_WHEELS_DIR = resolve(here, "../../../vendor/wheels");

/** Versiones reales del runtime (re-asercion del par; CLAUDE.md §18). */
export type VersionesRuntime = {
  python: string;
  numpy: string;
  scipy: string;
  pynite: string;
};

/** Motor arrancado y listo: el closure `calcular` + las versiones reales. */
export type MotorArrancado = {
  /** Llama al glue calcular(modeloFEM) y devuelve ResultadosCalculo VALIDADO. */
  calcular(modeloFEM: ModeloFEM): ResultadosCalculo;
  /** Versiones reales del runtime (re-asercion del par; CLAUDE.md §18). */
  versiones: VersionesRuntime;
  /** Instancia Pyodide cruda (para usos avanzados del smoke; no la reinstancies). */
  py: PyodideInterface;
};

/** Timeout generoso para el arranque (Pyodide + descargas). Reusable por ambos. */
export const TIMEOUT_ARRANQUE = 180_000;

/** Descripcion legible de un error desconocido. */
export function descr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Construye la URL file:// local de un wheel vendorizado (vendor/wheels/<fichero>).
// micropip en Node lee `parsed_url.path` literal: necesita file:// con barras
// NORMALES y SIN url-encoding del espacio (pathToFileURL mete %20/triple barra que
// su compat de Node no decodifica -> ENOENT). Esta es la parte ESPECIFICA de Node
// que el esqueleto compartido (instalarMotorPyodide) NO conoce: se la inyectamos
// como `urlWheel`. `onWheel` permite al smoke loguear cada URL local instalada.
function urlWheelNode(
  fichero: string,
  onWheel?: (url: string, deps: boolean) => void,
): string {
  const url = "file://" + resolve(VENDOR_WHEELS_DIR, fichero).split("\\").join("/");
  // El flag deps lo necesita el gancho de diagnostico; lo buscamos en WHEELS_VENDOR.
  const deps = WHEELS_VENDOR.find((w) => w.fichero === fichero)?.deps ?? false;
  onWheel?.(url, deps);
  return url;
}

/**
 * Error con FASE de arranque y motivo legible. Los consumidores lo capturan y
 * traducen a su politica de skip (ArranqueMotor {ok:false,motivo} en el golden;
 * skip propio en el smoke), sin duplicar la receta.
 */
export class ErrorArranquePyodide extends Error {
  constructor(
    public readonly fase: string,
    motivo: string,
  ) {
    super(motivo);
    this.name = "ErrorArranquePyodide";
  }
}

/** Hooks opcionales de diagnostico (los usa el smoke para sus console.warn). */
export type GanchosArranque = {
  /** Se llama por cada wheel vendorizado antes de instalarlo (URL local + deps). */
  onWheel?: (url: string, deps: boolean) => void;
};

/**
 * Arranca Pyodide + numpy/scipy + PyNiteFEA en Node (OFFLINE) y devuelve el motor
 * listo: { calcular, versiones, py }. NUCLEO COMPARTIDO entre el arnes golden y
 * el smoke; NO contiene logica de test. Lanza ErrorArranquePyodide con la fase si
 * algo falla, para que cada consumidor decida como reportarlo (skip vs rojo).
 *
 * Pasos (identicos a worker.ts, sin red): loadPyodide(indexURL local) ->
 * loadPackage(numpy,scipy,micropip) -> micropip.install(wheels vendorizados,
 * file:// local) -> runPythonAsync(glue) -> leer versiones -> construir calcular().
 */
export async function arrancarMotorNode(
  ganchos: GanchosArranque = {},
): Promise<MotorArrancado> {
  let py: PyodideInterface;
  try {
    py = await loadPyodide({ indexURL: INDEX_URL_NODE });
  } catch (e) {
    throw new ErrorArranquePyodide(
      "loadPyodide",
      `loadPyodide fallo (indexURL=${INDEX_URL_NODE}): ${descr(e)}`,
    );
  }

  // 1-3) SECUENCIA COMPARTIDA (FIX F5-4): loadPackage(numpy/scipy/micropip) ->
  // instalar wheels vendorizados en orden con sus flags deps -> runPythonAsync(glue).
  // La aporta el esqueleto neutral instalarMotorPyodide; aqui solo inyectamos lo
  // ESPECIFICO de Node: la URL file:// de cada wheel (urlWheelNode, con el gancho
  // de diagnostico del smoke) y el glue por readFileSync. El glue se lee ANTES para
  // reportar con claridad un .py ausente.
  let glue: string;
  try {
    glue = readFileSync(GLUE_PATH, "utf8");
  } catch (e) {
    throw new ErrorArranquePyodide(
      "glue",
      `lectura del glue fallo (GLUE_PATH=${GLUE_PATH}): ${descr(e)}`,
    );
  }
  try {
    await instalarMotorPyodide(py, {
      urlWheel: (fichero) => urlWheelNode(fichero, ganchos.onWheel),
      glueSource: glue,
    });
  } catch (e) {
    // Una sola fase para la receta compartida; el motivo cita las causas tipicas
    // (wheel WASM ausente, .whl vendorizado ausente, pin numpy>=2.4 / matplotlib,
    // import Pynite roto: pip._vendor). Suficiente para distinguir de un bug real.
    throw new ErrorArranquePyodide(
      "instalarMotor",
      `arranque (loadPackage/wheels vendorizados ${VENDOR_WHEELS_DIR}/glue) fallo ` +
        `(¿falta wheel WASM o .whl / pin numpy>=2.4 / matplotlib / import Pynite roto: pip._vendor?): ${descr(e)}`,
    );
  }

  // 4) Re-asercion del par de versiones (CLAUDE.md §18: golden/smoke re-asertan).
  let versiones: VersionesRuntime;
  try {
    const ver = py.runPython(`
import sys, json, numpy, scipy
import importlib.metadata as _md
try:
    _pn = _md.version("PyNiteFEA")
except Exception:
    _pn = "?"
json.dumps({
    "python": "%d.%d.%d" % sys.version_info[:3],
    "numpy": numpy.__version__,
    "scipy": scipy.__version__,
    "pynite": _pn,
})
`) as string;
    versiones = JSON.parse(ver) as VersionesRuntime;
  } catch (e) {
    throw new ErrorArranquePyodide(
      "versiones",
      `lectura de versiones numpy/scipy/PyNiteFEA fallo: ${descr(e)}`,
    );
  }

  // Construye el closure `calcular`: serializa el ModeloFEM, llama al glue y
  // valida la salida con safeParse (borde Python<->TS, CLAUDE.md §8, #15).
  const calcular = (modeloFEM: ModeloFEM): ResultadosCalculo => {
    const fnCalcular = py.globals.get("calcular");
    const proxy = fnCalcular(JSON.stringify(modeloFEM));
    const raw = proxy.toJs({ dict_converter: Object.fromEntries }) as
      | { ok: true; resultados: unknown }
      | { ok: false; error: { mensaje?: string; detalle?: string } };
    proxy.destroy?.();
    fnCalcular.destroy?.();

    if (!raw.ok) {
      throw new Error(
        `El glue devolvio error:\n  mensaje: ${raw.error.mensaje}\n  detalle:\n${raw.error.detalle}`,
      );
    }
    // safeParse (NUNCA parse) en el borde: si falla, el contrato de resultados se
    // rompio (bug del glue), no un dato de usuario.
    const parsed = ResultadosCalculoSchema.safeParse(raw.resultados);
    if (!parsed.success) {
      throw new Error(
        `ResultadosCalculoSchema.safeParse FALLO:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    return parsed.data;
  };

  return { calcular, versiones, py };
}
