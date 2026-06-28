// =============================================================================
// solverClient.ts - API limpia del motor FEM para la UI (feature-5, T3.1).
//
// AISLAMIENTO (CLAUDE.md §8, §17): este es el UNICO punto de contacto entre la
// app y el solver. La UI importa `solverClient` y habla en terminos de
// ModeloFEM/ResultadosCalculo/EstadoMotor; NO sabe que detras hay un Web Worker,
// Pyodide, Comlink ni Python. Todo es asincrono (CLAUDE.md §7): nunca se bloquea
// el hilo principal.
//
// QUE APORTA SOBRE EL WORKER:
//  - Instancia el Worker como singleton perezoso y RECUPERABLE (F5-5) y lo
//    envuelve con Comlink.wrap. Guarda TAMBIEN el handle del Worker (no solo el
//    proxy) para poder terminarlo y recrearlo si muere o se atasca.
//  - VALIDA nPoints en el borde (F5-1) ANTES de cruzar al worker: un Infinity,
//    negativo, fraccionario o gigante reventaria la memoria WASM en PyNite
//    `*_array(n_points)`. Es la regla de oro #8 aplicada a un parametro numerico.
//  - Aplica un TIMEOUT al calculo (F5-3): el Python del worker es sincrono e
//    ININTERRUMPIBLE, asi que la unica forma de cortar un calculo colgado es
//    TERMINAR el worker; el cliente lo hace y recrea el singleton.
//  - VALIDA con Zod (safeParse) la salida de calcular() ANTES de devolverla a la
//    UI (CLAUDE.md regla de oro #8). Esto caza pronto cualquier desajuste entre el
//    glue Python (pynite_glue.py) y el contrato resultados.ts.
//  - Normaliza los rechazos: el worker rechaza con ErrorMotor PLANO (no Error);
//    aqui se re-lanza tal cual para que la UI cace siempre la misma forma.
// =============================================================================

import * as Comlink from "comlink";

import type { ModeloFEM } from "../discretizador/contratoFEM";
import {
  ResultadosCalculoSchema,
  type ResultadosCalculo,
  type EstadoMotor,
  type ErrorMotor,
} from "./resultados";
import {
  ResultadosModalesSchema,
  type ResultadosModales,
} from "./resultadosModales";
import type { SolverWorkerAPI } from "./worker";

// -----------------------------------------------------------------------------
// LIMITES DE nPoints (F5-1, decision documentada):
// nPoints viaja sin filtro hasta PyNite `*_array(n_points)`, que reserva arrays
// (2 x n_points) por barra y combo en memoria WASM. Un valor enorme (1e9), no
// finito (Infinity/NaN), negativo o fraccionario o bien revienta la memoria del
// worker o falla de forma opaca. Rango sano para diagramas de obra: 2..200.
//  - MINIMO 2: hacen falta al menos los dos extremos de la barra para un diagrama.
//  - MAXIMO 200: mas que suficiente para una curva N/V/M/flecha suave en pantalla
//    (la UI no resuelve mas de ~200 px por barra); por encima solo gasta memoria
//    sin ganancia visible. Si en el futuro un caso necesitara mas, se sube aqui.
// nPoints OMITIDO sigue siendo valido: el glue usa su N_POINTS_DEFAULT.
// -----------------------------------------------------------------------------
const N_POINTS_MIN = 2;
const N_POINTS_MAX = 200;

// -----------------------------------------------------------------------------
// TIMEOUT del calculo (F5-3, decision documentada):
// El worker ejecuta Python SINCRONO durante analyze(); el hilo principal (este
// cliente) NO esta bloqueado, asi que un timeout aqui SI puede dispararse. Pero
// el Python sincrono no se puede interrumpir: la unica forma real de detener un
// calculo colgado es TERMINAR el worker. 60 s cubre con holgura un pequeno
// portico de F1 (el smoke resuelve en ~5 s incluido el arranque); si vence, casi
// seguro es un modelo patologico o un atasco, no un calculo legitimo largo.
// Configurable por si un modelo grande de F2+ necesitara mas margen.
// -----------------------------------------------------------------------------
const TIMEOUT_CALCULO_MS_DEFAULT = 60_000;

// -----------------------------------------------------------------------------
// COSTURA DE TEST (documentada): fabrica de worker inyectable.
// En PRODUCCION `obtenerProxy()` hace `new Worker(new URL('./worker.ts', ...))` +
// Comlink.wrap. Eso no es instanciable ni mockeable en el runner de Node de
// Vitest (no hay `Worker` de navegador ni import.meta.url de worker). Para poder
// testear la LOGICA del cliente (validacion de nPoints, safeParse, timeout,
// reset) SIN Pyodide ni navegador, exponemos una unica costura: una fabrica que
// devuelve { worker, proxy }. Por defecto usa la fabrica real; el test la
// sustituye con __setFabricaWorker(). NO altera el comportamiento de produccion
// (la fabrica por defecto es exactamente la de antes) ni la API publica.
// -----------------------------------------------------------------------------

/** Par worker+proxy que maneja el cliente. El handle del Worker es lo que F5-5
 *  guardaba de menos: sin el no se puede terminar/recrear un worker muerto. */
export interface ParWorker {
  /** Handle real del Worker (o un doble en test). Necesario para terminate(). */
  readonly worker: Pick<Worker, "terminate"> & {
    // onerror/onmessageerror: el parametro como `never` deja ASIGNABLES tanto el
    // `Worker` real del DOM (handler con ev:ErrorEvent) como el `() => void` que
    // instala obtenerProxy() (en test el doble tambien encaja).
    onerror?: ((ev: never) => unknown) | null;
    onmessageerror?: ((ev: never) => unknown) | null;
  };
  /** Proxy Comlink hacia la API del worker (precargar/calcular/estado/error). */
  readonly proxy: Comlink.Remote<SolverWorkerAPI>;
}

/** Fabrica que crea un worker nuevo y su proxy. Reemplazable solo en test. */
type FabricaWorker = () => ParWorker;

// Fabrica REAL de produccion: new Worker ESM (patron Vite) + Comlink.wrap.
const fabricaReal: FabricaWorker = () => {
  // `new URL('./worker.ts', import.meta.url)` + { type:'module' }: patron Vite
  // para un worker ESM. Comlink.wrap convierte el canal del worker en un proxy
  // cuyos metodos devuelven promesas (la API real vive en worker.ts).
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  const proxy = Comlink.wrap<SolverWorkerAPI>(worker);
  return { worker, proxy };
};

let fabricaWorker: FabricaWorker = fabricaReal;

/**
 * COSTURA DE TEST: sustituye la fabrica de worker. Solo para tests del cliente.
 * Llamar con `null` restaura la fabrica de produccion. No usar en la app.
 */
export function __setFabricaWorker(f: FabricaWorker | null): void {
  fabricaWorker = f ?? fabricaReal;
}

// -----------------------------------------------------------------------------
// Singleton perezoso y RECUPERABLE (F5-5). NO se crea al importar el modulo: el
// Worker (y la posterior precarga de Pyodide) solo arrancan en la primera
// operacion. Guardamos el PAR (worker+proxy), no solo el proxy: sin el handle del
// Worker no se puede terminar/recrear si muere.
// -----------------------------------------------------------------------------
let par: ParWorker | null = null;

/**
 * Devuelve el proxy del worker, creando un Worker NUEVO si no hay (arranque
 * limpio) o si se reseteo previamente (recuperacion). Instala onerror/
 * onmessageerror: si el worker muere (crash de boot, OOM), marca el motor caido y
 * resetea el singleton para que la proxima operacion recree uno limpio.
 */
function obtenerProxy(): Comlink.Remote<SolverWorkerAPI> {
  if (par) return par.proxy;

  par = fabricaWorker();

  // onerror/onmessageerror: un fallo no capturado del worker (boot, OOM, atasco
  // del runtime) llega aqui. No podemos recuperar ESTE worker -> lo damos por
  // muerto y reseteamos el singleton. La proxima precargar()/calcular()/estado()
  // creara un Worker nuevo desde cero (vuelve a obtenerProxy()).
  if (par.worker) {
    const muerto = () => {
      // Resetear sin volver a terminar (el worker ya esta caido): basta soltar el
      // singleton para forzar la recreacion limpia en la proxima operacion.
      par = null;
    };
    par.worker.onerror = muerto;
    par.worker.onmessageerror = muerto;
  }

  return par.proxy;
}

/**
 * Termina el worker actual (si lo hay) y limpia el singleton. Reutilizada desde
 * el timeout (F5-3) y desde onerror (F5-5). Tras llamarla, la proxima operacion
 * recrea un Worker nuevo via obtenerProxy(). terminate() es la UNICA forma de
 * cortar el Python sincrono que el worker ejecuta colgado.
 */
function resetWorker(): void {
  if (par) {
    try {
      par.worker.terminate();
    } catch {
      // Si terminate falla (worker ya muerto) da igual: lo soltamos igualmente.
    }
    par = null;
  }
}

/**
 * COSTURA DE TEST: fuerza un reset del worker desde fuera (para asertar la
 * recreacion limpia tras un reset). No usar en la app: el reset de produccion lo
 * gestiona el timeout/onerror internamente.
 */
export function __resetWorker(): void {
  resetWorker();
}

// -----------------------------------------------------------------------------
// MANEJO DE ERRORES (decision documentada):
// El worker SIEMPRE rechaza precargar()/calcular() con un objeto ErrorMotor PLANO
// {fase,mensaje,detalle?}, nunca con una instancia de Error (ver worker.ts). Al
// cruzar Comlink ese objeto llega como dato plano. Aqui lo RE-LANZAMOS tal cual:
// la UI debe cazar ErrorMotor (no `instanceof Error`) y usar `error.fase` para
// distinguir fallo de carga ("carga") de fallo de calculo ("calculo"), y
// `error.mensaje` (lenguaje de obra) para mostrar. `esErrorMotor` permite a la UI
// (y a este cliente) discriminar con seguridad.
// -----------------------------------------------------------------------------

/** Type guard publico: distingue un ErrorMotor plano de cualquier otra excepcion. */
export function esErrorMotor(e: unknown): e is ErrorMotor {
  return (
    typeof e === "object" &&
    e !== null &&
    "fase" in e &&
    "mensaje" in e &&
    ((e as { fase: unknown }).fase === "carga" ||
      (e as { fase: unknown }).fase === "calculo")
  );
}

/** Crea un ErrorMotor de fase "calculo" con mensaje en lenguaje de obra. */
function errorCalculo(mensaje: string, detalle?: string): ErrorMotor {
  return { fase: "calculo", mensaje, detalle };
}

// =============================================================================
// API publica que consume la UI. Objeto plano de funciones asincronas.
// =============================================================================
export const solverClient = {
  /**
   * Arranca el motor (Pyodide + PyNite) en segundo plano. IDEMPOTENTE (el worker
   * reusa su misma promesa de carga). Llamala mientras el usuario modela para que
   * "Calcular" este listo cuanto antes. Resuelve cuando el motor queda "listo";
   * rechaza con ErrorMotor{fase:"carga"} si falla el arranque.
   */
  async precargar(): Promise<void> {
    await obtenerProxy().precargar();
  },

  /**
   * Calcula un ModeloFEM (Capa 2) y devuelve ResultadosCalculo VALIDADO con Zod.
   * El worker asegura el motor listo (precarga si hace falta). La validacion en el
   * borde (safeParse) es obligatoria (CLAUDE.md #8): si la salida del glue no cumple
   * el contrato resultados.ts, se lanza un ErrorMotor{fase:"calculo"} legible en vez
   * de propagar datos malformados a la UI (detecta pronto desajustes glue<->contrato).
   *
   * VALIDACION DE nPoints (F5-1): si viene definido, debe ser ENTERO FINITO en
   * [2,200]. Si no cumple, se lanza ErrorMotor{fase:"calculo"} SIN cruzar al worker.
   *
   * TIMEOUT (F5-3): el calculo corre contra `timeoutMs` (60 s por defecto). Si
   * vence, se TERMINA el worker (unica forma de cortar el Python sincrono), se
   * resetea el singleton (la proxima llamada recrea el worker) y se rechaza con
   * ErrorMotor{fase:"calculo"}.
   *
   * Rechaza con ErrorMotor: {fase:"carga"} si no arranco el motor, {fase:"calculo"}
   * si fallo el analisis, la validacion, nPoints o por timeout. Usa esErrorMotor()/
   * error.fase para cazarlo.
   *
   * @param modeloFEM contrato de Capa 2 (salida del discretizador).
   * @param nPoints   nº de puntos de muestreo de los diagramas (opcional; el glue
   *                  tiene su propio valor por defecto). Si se da: entero en [2,200].
   * @param timeoutMs presupuesto de tiempo del calculo (opcional; 60 s por defecto).
   */
  async calcular(
    modeloFEM: ModeloFEM,
    nPoints?: number,
    timeoutMs: number = TIMEOUT_CALCULO_MS_DEFAULT,
  ): Promise<ResultadosCalculo> {
    // --- F5-1: validar nPoints ANTES de cruzar al worker ---------------------
    // Solo si viene definido (undefined es valido: el glue usa su default).
    if (nPoints !== undefined) {
      if (
        !Number.isFinite(nPoints) ||
        !Number.isInteger(nPoints) ||
        nPoints < N_POINTS_MIN ||
        nPoints > N_POINTS_MAX
      ) {
        // No cruzamos al worker: lo paramos en el borde (regla de oro #8).
        throw errorCalculo(
          `El numero de puntos de los diagramas debe ser un entero entre ${N_POINTS_MIN} y ${N_POINTS_MAX}.`,
          `nPoints invalido: ${String(nPoints)}`,
        );
      }
    }

    // --- F5-3: calcular contra un timeout ------------------------------------
    // Carrera entre el calculo del worker y un reloj. Si gana el reloj, el worker
    // sigue ejecutando Python sincrono colgado: lo TERMINAMOS y reseteamos.
    const proxy = obtenerProxy();

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const promesaTimeout = new Promise<never>((_, reject) => {
      temporizador = setTimeout(() => {
        // Cortar de verdad: terminar el worker (el Python sincrono no se
        // interrumpe de otra forma) y soltar el singleton para recrearlo.
        resetWorker();
        reject(
          errorCalculo(
            "El calculo tardo demasiado y se ha cancelado. Revisa el modelo " +
              "(puede tener un problema que impide resolverlo) y vuelve a intentarlo.",
            `Timeout de ${timeoutMs} ms en calcular().`,
          ),
        );
      }, timeoutMs);
    });

    let bruto: unknown;
    try {
      // El worker materializa el resultado a objeto JS plano; aqui solo validamos.
      bruto = await Promise.race([proxy.calcular(modeloFEM, nPoints), promesaTimeout]);
    } finally {
      // Limpiar el reloj siempre (gane quien gane) para no dejar timers vivos.
      if (temporizador !== undefined) clearTimeout(temporizador);
    }

    // --- F5 (#8): safeParse en el borde --------------------------------------
    const parseado = ResultadosCalculoSchema.safeParse(bruto);
    if (!parseado.success) {
      // Desajuste glue<->contrato: la salida no cumple resultados.ts. Lo elevamos a
      // ErrorMotor para que la UI lo trate como cualquier fallo de calculo, con el
      // detalle Zod en `detalle` (para diagnostico en modo avanzado, no para el arquitecto).
      throw errorCalculo(
        "El motor devolvio resultados con un formato inesperado. " +
          "Es un fallo interno del calculo; revisa el modelo o reporta la incidencia.",
        parseado.error.message,
      );
    }

    return parseado.data;
  },

  /**
   * Calcula el ANALISIS MODAL (F2b) de un ModeloFEM (Capa 2, con
   * analysis.type==="modal") y devuelve ResultadosModales VALIDADO con Zod
   * (frecuencias en Hz + formas de vibracion por nudo). Camino INDEPENDIENTE de
   * calcular(): NO usa nPoints (modal no muestrea diagramas) y valida con
   * ResultadosModalesSchema (no ResultadosCalculoSchema).
   *
   * Comparte la fontaneria de calcular(): mismo singleton recuperable, mismo
   * TIMEOUT (F5-3, termina el worker y recrea el singleton si vence), y safeParse en
   * el borde (#8). Contrato de error IDENTICO: rechaza con ErrorMotor {fase:"carga"}
   * si no arranco el motor, {fase:"calculo"} si fallo el analisis (p. ej. modelo sin
   * masa, estructura inestable), la validacion o por timeout. Usa esErrorMotor()/
   * error.fase para cazarlo. Exito -> ResultadosModales.
   *
   * @param modeloFEM contrato de Capa 2 con analysis.type==="modal" y num_modes.
   * @param timeoutMs presupuesto de tiempo del calculo (opcional; 60 s por defecto).
   */
  async calcularModal(
    modeloFEM: ModeloFEM,
    timeoutMs: number = TIMEOUT_CALCULO_MS_DEFAULT,
  ): Promise<ResultadosModales> {
    // --- F5-3: calcular contra un timeout (mismo patron que calcular) --------
    const proxy = obtenerProxy();

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const promesaTimeout = new Promise<never>((_, reject) => {
      temporizador = setTimeout(() => {
        resetWorker();
        reject(
          errorCalculo(
            "El calculo de modos tardo demasiado y se ha cancelado. Revisa el " +
              "modelo y vuelve a intentarlo.",
            `Timeout de ${timeoutMs} ms en calcularModal().`,
          ),
        );
      }, timeoutMs);
    });

    let bruto: unknown;
    try {
      bruto = await Promise.race([proxy.calcularModal(modeloFEM), promesaTimeout]);
    } finally {
      if (temporizador !== undefined) clearTimeout(temporizador);
    }

    // --- safeParse en el borde con el contrato MODAL (#8) --------------------
    const parseado = ResultadosModalesSchema.safeParse(bruto);
    if (!parseado.success) {
      throw errorCalculo(
        "El motor devolvio los modos con un formato inesperado. " +
          "Es un fallo interno del calculo; revisa el modelo o reporta la incidencia.",
        parseado.error.message,
      );
    }

    return parseado.data;
  },

  /**
   * Estado actual del motor (passthrough). La UI lo sondea para habilitar
   * "Calcular" (solo en "listo") y mostrar "cargando motor"/"calculando".
   */
  async estado(): Promise<EstadoMotor> {
    return obtenerProxy().estado();
  },

  /**
   * Ultimo ErrorMotor registrado por el worker (null si no hay), p. ej. tras un
   * fallo de carga, para que la UI muestre el detalle sin re-lanzar. Passthrough.
   */
  async error(): Promise<ErrorMotor | null> {
    return obtenerProxy().error();
  },
};

// -----------------------------------------------------------------------------
// SUSCRIPCION AL ESTADO (decision documentada):
// NO se expone onEstado(cb) ni callbacks Comlink.proxy. Motivo: el estado del
// motor cambia en transiciones puntuales y conocidas por la UI (la UI dispara
// precargar()/calcular(), asi que sabe cuando consultar). Anadir polling o un
// canal de eventos por el worker complica el modulo sin necesidad real para el MVP.
// La UI gestiona su propio sondeo ligero llamando a estado() (p. ej. al montar y
// tras precargar/calcular) o derivando el estado de las propias promesas. Si en el
// futuro hiciera falta reactividad fina, se anade aqui un onEstado con Comlink.proxy.
// -----------------------------------------------------------------------------

export type SolverClient = typeof solverClient;
