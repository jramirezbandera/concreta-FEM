// =============================================================================
// worker.ts - Web Worker del motor FEM (Pyodide + PyNiteFEA), expuesto por Comlink.
//
// AISLAMIENTO (CLAUDE.md §8, hallazgo #6): TODO lo que toca Pyodide/Python vive
// aqui. El resto de la app no sabe que existe Python: habla con solverClient
// (feature-5 T3.1), que envuelve esta API Comlink. Este modulo corre SIEMPRE en
// un Web Worker dedicado, nunca en el hilo principal (CLAUDE.md §7, §17).
//
// CICLO DE VIDA (maquina de estados EstadoMotor de resultados.ts):
//   descargado --precargar()--> cargando --(ok)--> listo
//                                       \--(fallo)--> error  (ErrorMotor fase:"carga")
//   listo --calcular()--> calculando --(ok)--> listo
//                                    \--(fallo glue)--> listo (LANZA ErrorMotor fase:"calculo")
//
// CONTRATO DE error()/ultimoError (FIX F5-7, decision (b)): SOLO los fallos de
// CARGA persisten en `ultimoError` y dejan el estado en "error" para que la UI los
// lea sin re-lanzar. Los fallos de CALCULO se PROPAGAN por la excepcion de
// calcular() (el llamador los recibe ahi) y NO se guardan: el motor vuelve a
// "listo" para admitir otro modelo, asi que error() no los refleja. Esto es
// deliberado: un fallo de calculo es transitorio (un modelo malo), no un estado
// del motor; un fallo de carga si deja el motor inservible hasta reintentar.
//
// IMPORTACION DEL RUNTIME (autohospedado, NO CDN):
//  - `loadPyodide` se importa del paquete ESM `pyodide` (worker.format:'es' en
//    vite.config.ts; optimizeDeps.exclude=['pyodide'] evita que esbuild lo rompa).
//  - El runtime (.wasm, wheels, pyodide-lock.json) se sirve desde INDEX_URL
//    ("/pyodide/", config.ts); loadPyodide lo descarga de ahi con rutas relativas.
//
// INTERCAMBIO DE DATOS Python<->JS (guia §12.4):
//  - Entrada: ModeloFEM -> JSON.stringify -> str (el glue hace json.loads). Es la
//    via mas robusta: evita conversiones de tipos numpy y proxies colgando.
//  - Salida: el glue devuelve un dict JSON-serializable; lo materializamos a un
//    objeto JS PLANO con .toJs({ dict_converter: Object.fromEntries }) y liberamos
//    el proxy. NO cruza ningun JsProxy/PyProxy la frontera de Comlink.
// =============================================================================

import * as Comlink from "comlink";
import { loadPyodide, type PyodideInterface } from "pyodide";
// Glue Python como string (Vite ?raw; ver glue.d.ts). Se ejecuta una vez con
// runPythonAsync para definir build_model/run_analysis/serialize_results/calcular.
import glueSource from "./pynite_glue.py?raw";

import { INDEX_URL } from "./config";
// Esqueleto de arranque compartido (DRY, FIX F5-4): la SECUENCIA loadPackage ->
// instalar wheels en orden -> runPythonAsync(glue) la comparte con el arnes Node
// (tests/golden/_arnes/pyodideNode.ts). Aqui solo aportamos lo especifico del
// navegador: el indexURL "/pyodide/", la URL de cada wheel y el glue por ?raw.
import { instalarMotorPyodide } from "./arranquePyodide";
import type { ModeloFEM } from "../discretizador/contratoFEM";
import type {
  EstadoMotor,
  ErrorMotor,
  ResultadosCalculo,
} from "./resultados";

// -----------------------------------------------------------------------------
// Estado interno del worker (privado; la UI solo lo lee via estado()).
// -----------------------------------------------------------------------------
let estadoActual: EstadoMotor = "descargado";
// El error mas reciente (si estadoActual === "error"), para que la UI lo lea.
let ultimoError: ErrorMotor | null = null;

// Handle de Pyodide una vez instanciado (null hasta precargar()).
let pyodide: PyodideInterface | null = null;

// Promesa de precarga en curso/resuelta. IDEMPOTENCIA: si precargar() se llama
// de nuevo mientras carga o ya esta listo, se reusa ESTA misma promesa en vez de
// re-arrancar Pyodide (arranque WASM ~4-5 s, hallazgo #20). Se anula al fallar
// para permitir reintentar.
let promesaPrecarga: Promise<void> | null = null;

// -----------------------------------------------------------------------------
// Tipo del dict que devuelve el glue Python `calcular(payload)`. NO se valida con
// Zod aqui (eso es T3.1, en solverClient); solo se discrimina ok/error para
// mapear a ResultadosCalculo o lanzar ErrorMotor. La forma viene de pynite_glue.py.
// -----------------------------------------------------------------------------
type RespuestaGlue =
  | { ok: true; resultados: ResultadosCalculo }
  | { ok: false; error: { mensaje: string; detalle?: string } };

// =============================================================================
// Arranque del motor (interno). Lo envuelve precargar() para la idempotencia.
//   1) loadPyodide({ indexURL })            -> instancia WASM (runtime local)
//   2) loadPackage(numpy, scipy, micropip)  -> builds WASM nativas de Pyodide
//   3) micropip.install(<URL local prettytable.whl>) -> dep pura-Python de PyNite
//   4) micropip.install(<URL local pynitefea.whl>, deps:false) -> evita numpy>=2.4
//   5) runPythonAsync(glueSource)           -> define las funciones del glue
//
// OFFLINE (regla de oro #9): los wheels de PyNiteFEA/PrettyTable se sirven desde
// el propio origen bajo INDEX_URL (/pyodide/<wheel>), NO de PyPI. copy-pyodide-
// assets.mjs los aterriza alli desde vendor/wheels/. micropip acepta una URL
// directa al .whl, evitando toda resolucion contra PyPI.
// =============================================================================
async function arrancarMotor(): Promise<void> {
  // loadPyodide queda aqui (no en el esqueleto compartido) porque el indexURL
  // difiere por entorno: navegador "/pyodide/", Node node_modules/pyodide.
  const py = await loadPyodide({ indexURL: INDEX_URL });

  // Secuencia comun (loadPackage -> instalar wheels vendorizados en orden con sus
  // flags deps -> runPythonAsync del glue). Lo especifico del navegador: la URL de
  // cada wheel es local bajo INDEX_URL (/pyodide/<fichero>, sin red, regla #9) y el
  // glue llega por import ?raw (Vite). PrettyTable con deps y PyNiteFEA con
  // deps:false los fija WHEELS_VENDOR dentro del esqueleto (hallazgos #2/#10).
  await instalarMotorPyodide(py, {
    urlWheel: (fichero) => `${INDEX_URL}${fichero}`,
    glueSource,
  });

  pyodide = py;
}

// =============================================================================
// API expuesta por Comlink. El cliente (solverClient T3.1) hace Comlink.wrap()
// de un new Worker(...) y obtiene este objeto como proxy asincrono.
// =============================================================================
const api = {
  /** Estado actual del motor (sincrono). La UI lo sondea para habilitar Calcular. */
  estado(): EstadoMotor {
    return estadoActual;
  },

  /**
   * Ultimo ErrorMotor de CARGA si estadoActual==="error" (null en otro caso).
   * Permite a la UI mostrar el detalle de un fallo de arranque sin re-lanzar.
   * NO refleja fallos de CALCULO: esos se propagan por la excepcion de calcular()
   * y dejan el motor "listo" (ver FIX F5-7, contrato en la cabecera del modulo).
   */
  error(): ErrorMotor | null {
    return ultimoError;
  },

  /**
   * Arranca Pyodide + instala paquetes + carga el glue. IDEMPOTENTE: llamadas
   * concurrentes o repetidas reusan la misma promesa; si ya esta listo, resuelve
   * de inmediato. Transiciona descargado->cargando->listo, o ->error (fase "carga").
   */
  async precargar(): Promise<void> {
    // Ya listo: nada que hacer.
    if (estadoActual === "listo") return;
    // Carga en curso (o previa resuelta): reusar la misma promesa (idempotencia).
    if (promesaPrecarga) return promesaPrecarga;

    estadoActual = "cargando";
    ultimoError = null;

    promesaPrecarga = (async () => {
      try {
        await arrancarMotor();
        estadoActual = "listo";
      } catch (e) {
        // Fallo de carga: reflejar en estado "error" con ErrorMotor legible y
        // permitir reintento anulando la promesa cacheada.
        estadoActual = "error";
        ultimoError = {
          fase: "carga",
          mensaje:
            "No se pudo arrancar el motor de calculo (Pyodide/PyNite). " +
            "Revisa la conexion y vuelve a intentarlo.",
          detalle: e instanceof Error ? (e.stack ?? e.message) : String(e),
        };
        promesaPrecarga = null; // permite reintentar precargar()
        throw ultimoError;
      }
    })();

    return promesaPrecarga;
  },

  /**
   * Ejecuta el calculo de un ModeloFEM (Capa 2) y devuelve ResultadosCalculo como
   * objeto JS PLANO (sin proxies). Asegura el motor listo (precarga si hace falta),
   * pone estado "calculando" y vuelve a "listo" al terminar.
   *
   * Errores del glue (payload invalido, fallo de PyNite) llegan como {ok:false} y
   * se relanzan como ErrorMotor{fase:"calculo"}; no rompen el estado del motor (se
   * vuelve a "listo" para permitir reintentar con otro modelo). FIX F5-7: estos
   * fallos NO se guardan en ultimoError ni se reflejan en error() (que solo cubre
   * fallos de carga); el llamador los recibe AQUI, por la excepcion.
   *
   * @param modeloFEM contrato de Capa 2 (discretizador). Se pasa como JSON string.
   * @param nPoints   nº de puntos al muestrear los diagramas *_array() (opcional).
   */
  async calcular(
    modeloFEM: ModeloFEM,
    nPoints?: number,
  ): Promise<ResultadosCalculo> {
    // Asegurar motor listo. Si la precarga falla, propaga su ErrorMotor (fase "carga").
    // FIX F5-8: usamos `api.precargar()` (referencia al objeto module-level) en vez
    // de `this.precargar()`, para no depender de como Comlink liga el receptor del
    // objeto expuesto (el binding de `this` no esta garantizado tras el wrap).
    if (estadoActual !== "listo") {
      await api.precargar();
    }
    if (!pyodide) {
      // Salvaguarda: precargar() deberia haber dejado pyodide; si no, es un bug.
      throw {
        fase: "calculo",
        mensaje: "El motor de calculo no esta disponible.",
        detalle: "pyodide es null tras precargar().",
      } satisfies ErrorMotor;
    }

    estadoActual = "calculando";
    try {
      // Recuperar la funcion `calcular` del glue ya definida en el interprete.
      // FIX F5-2: el ciclo de vida de CADA PyProxy se envuelve en try/finally para
      // que SIEMPRE se libere (.destroy()), tambien si toJs() o la llamada lanzan.
      // Antes el destroy iba DESPUES de toJs(): un fallo en medio fugaba memoria WASM.
      const calcularPy = pyodide.globals.get("calcular");
      let respuesta: RespuestaGlue;
      try {
        // Entrada como JSON string (via mas robusta, guia §12.4): el glue hace
        // json.loads. Asi no cruza ningun proxy de objeto JS hacia Python.
        const payloadJson = JSON.stringify(modeloFEM);

        // Llamada al glue. nPoints se pasa por nombre solo si viene; el glue tiene
        // su propio N_POINTS_DEFAULT. callKwargs evita posicional fragil. El proxy
        // de respuesta tambien se libera en su propio finally (ver dentro).
        const respuestaProxy =
          typeof nPoints === "number"
            ? calcularPy.callKwargs(payloadJson, { n_points: nPoints })
            : calcularPy(payloadJson);
        try {
          // Materializar el dict Python a objeto JS plano. dict_converter:
          // Object.fromEntries -> dicts a objetos (no Map), recursivo; los ndarrays
          // ya vienen como listas (.tolist() en el glue) -> arrays JS.
          respuesta = respuestaProxy.toJs({
            dict_converter: Object.fromEntries,
          }) as RespuestaGlue;
        } finally {
          // Liberar el proxy de respuesta SIEMPRE (incluso si toJs() lanzo).
          respuestaProxy.destroy?.();
        }
      } finally {
        // Liberar el proxy de la funcion `calcular` SIEMPRE (incluso si la llamada
        // o el materializado lanzaron).
        calcularPy.destroy?.();
      }

      if (!respuesta.ok) {
        // El glue NUNCA lanza a traves de la frontera: el error viene como dato.
        // Lo elevamos a ErrorMotor (fase "calculo") para que la UI lo distinga de
        // un fallo de carga. El motor sigue "listo".
        estadoActual = "listo";
        throw {
          fase: "calculo",
          mensaje: respuesta.error.mensaje,
          detalle: respuesta.error.detalle,
        } satisfies ErrorMotor;
      }

      estadoActual = "listo";
      // Objeto JS plano y serializable: cruza Comlink sin proxies. La validacion
      // Zod (safeParse) la hace el cliente en T3.1, no aqui.
      return respuesta.resultados;
    } catch (e) {
      // Volver a "listo" si seguimos calculando (un fallo de calculo no tumba el
      // motor). Si ya es un ErrorMotor (lo de arriba), re-propagar tal cual.
      if (estadoActual === "calculando") estadoActual = "listo";
      if (esErrorMotor(e)) throw e;
      // Fallo inesperado en la frontera (no del glue): envolver como ErrorMotor.
      throw {
        fase: "calculo",
        mensaje: "Fallo inesperado durante el calculo.",
        detalle: e instanceof Error ? (e.stack ?? e.message) : String(e),
      } satisfies ErrorMotor;
    }
  },
};

/** Type guard: distingue un ErrorMotor ya formado de otra excepcion. */
function esErrorMotor(e: unknown): e is ErrorMotor {
  return (
    typeof e === "object" &&
    e !== null &&
    "fase" in e &&
    "mensaje" in e &&
    (e as { fase: unknown }).fase !== undefined
  );
}

// Tipo de la API para que solverClient (T3.1) lo importe y tipe el Comlink.wrap.
export type SolverWorkerAPI = typeof api;

// Exponer la API por Comlink en el canal del worker.
Comlink.expose(api);
