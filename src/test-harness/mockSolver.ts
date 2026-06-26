// =============================================================================
// mockSolver.ts - mock DETERMINISTA y CONSCIENTE DEL MODELO del solver (feature-16
// T0.4, decisiones D5/D7).
//
// PARA QUE (D2/D5): los specs E2E del flujo F1 necesitan ejercitar la app real
// (discretizar -> Calcular -> deformada/diagramas/reacciones) SIN arrancar Pyodide
// (~4-9 s) y de forma determinista. Este mock inyecta un `ParWorker` falso por la
// costura `__setFabricaWorker()` de solverClient, asi el worker real NUNCA arranca.
//
// AISLAMIENTO (regla de oro #1/#8, CLAUDE.md §8): el mock SOLO habla con
// `solverClient` (su costura publica `__setFabricaWorker`/`__resetWorker`); NO toca
// worker.ts, ni Comlink, ni Pyodide directamente. NO reimplementa FEM: los numeros
// los sintetiza `construirResultadosDesdeModeloFEM` (fixturesResultados.ts) con la
// FORMA del contrato y valores enlatados pero coherentes (D7). El calculo real sigue
// siendo PyNite; esto es solo un doble para cablear la UI en E2E.
//
// CONTROLABLE (D5): `instalarMockSolver()` devuelve un `ControlMockSolver` para que
// el spec gobierne el TIEMPO y el RESULTADO de cada calculo:
//   - calcular() devuelve una promesa PENDIENTE (no se resuelve sola): permite al
//     spec asertar el estado "Calculando…"/aria-busy ANTES de liberarla.
//   - resolver(): cumple la(s) llamada(s) pendiente(s) con el ResultadosCalculo
//     CONSCIENTE DEL MODELO del ultimo modeloFEM recibido (camino feliz).
//   - fallar(e): rechaza la(s) pendiente(s) con un ErrorMotor (camino de error).
//   - contadorLlamadas(): cuantas veces se llamo a calcular (Codex #16: el spec de
//     validacion asevera "motor NO llamado" -> contador == 0 cuando el corte
//     temprano de useCalcular para antes de cruzar al solver).
//
// Lo expone T0.2 en `window.__concreta.usarMockSolver()` bajo VITE_E2E.
// =============================================================================

import {
  __setFabricaWorker,
  __resetWorker,
} from "../solver/solverClient";
import { crearParMock, construirResultadosDesdeModeloFEM } from "../solver/fixturesResultados";
import type { ModeloFEM } from "../discretizador/contratoFEM";
import type { ResultadosCalculo, ErrorMotor } from "../solver/resultados";

/**
 * Control que `instalarMockSolver()` devuelve al spec (D5). Gobierna el tiempo y el
 * resultado de los calculos del mock, y permite asertar que el motor se llamo (o no).
 */
export interface ControlMockSolver {
  /**
   * Resuelve TODAS las llamadas a calcular() pendientes con el ResultadosCalculo
   * CONSCIENTE DEL MODELO del ultimo modeloFEM recibido (camino feliz, D7). Las
   * llamadas posteriores tambien quedaran pendientes hasta el proximo resolver()/
   * fallar(). No-op si no hay pendientes.
   */
  resolver(): void;
  /**
   * Rechaza TODAS las llamadas a calcular() pendientes con `e` (ErrorMotor), para
   * ejercitar el camino de error de motor en la UI (role=status + "Reintentar").
   */
  fallar(e: ErrorMotor): void;
  /** Numero de veces que se ha invocado calcular() (Codex #16: "motor NO llamado"). */
  contadorLlamadas(): number;
  /**
   * Desinstala el mock: restaura la fabrica de produccion y resetea el singleton.
   * Util para limpiar entre specs si se comparte contexto (normalmente cada spec usa
   * un contexto fresco, pero dejarlo explicito evita fugas de estado entre tests).
   */
  desinstalar(): void;
}

/** Una llamada a calcular() en vuelo: como cumplirla/rechazarla y con que modelo. */
interface LlamadaPendiente {
  modeloFEM: ModeloFEM;
  resolve: (r: ResultadosCalculo) => void;
  reject: (e: ErrorMotor) => void;
}

/**
 * Instala el mock determinista del solver y devuelve su control (D5/D7).
 *
 * Inyecta por `__setFabricaWorker()` un `ParWorker` falso cuyo `proxy.calcular()`
 * devuelve una promesa PENDIENTE (controlada desde fuera) y `proxy.estado()` reporta
 * siempre "listo" (proxy.error() -> null). Llama a `__resetWorker()` para que la
 * PROXIMA `obtenerProxy()` use esta fabrica (suelta cualquier singleton previo).
 *
 * IMPORTANTE (D2): instalar ANTES del primer `precargar()`/`calcular()` de la app
 * (en el arranque E2E, via addInitScript -> e2eBridge). Si se instala en runtime,
 * el `__resetWorker()` de aqui garantiza que el siguiente uso recree con el mock.
 */
export function instalarMockSolver(): ControlMockSolver {
  // Llamadas a calcular() en vuelo (pendientes de resolver/fallar). Normalmente 1,
  // pero soportamos varias por robustez (un spec podria encadenar calculos).
  const pendientes: LlamadaPendiente[] = [];
  // Contador de invocaciones a calcular() (Codex #16). Se incrementa SIEMPRE que la
  // app cruza al "motor" (este mock), aunque la promesa aun no se haya resuelto.
  let llamadas = 0;

  // proxy.calcular del mock: registra la llamada y devuelve una promesa controlada.
  // El cliente (solverClient) le pasa (modeloFEM, nPoints?); el mock ignora nPoints
  // (el constructor consciente del modelo usa su propio n_points enlatado) pero
  // GUARDA el modeloFEM para sintetizar el resultado con sus nombres reales (D7).
  const calcular = (
    modeloFEM: ModeloFEM,
    _nPoints?: number,
  ): Promise<ResultadosCalculo> => {
    llamadas += 1;
    return new Promise<ResultadosCalculo>((resolve, reject) => {
      pendientes.push({ modeloFEM, resolve, reject });
    });
  };

  // Par worker+proxy falso. estado() siempre "listo" (la UI habilita Calcular);
  // error() null (no hay fallo de carga en el mock). terminate() es un no-op: el
  // mock no tiene Python sincrono que cortar, pero el handle debe existir para que
  // el timeout/onerror de solverClient no rompan (ParWorker exige worker.terminate).
  const { par } = crearParMock({
    calcular, // firma (modeloFEM, nPoints?) => Promise<ResultadosCalculo>, como el worker
    estado: async () => "listo" as const, // el motor mock siempre esta listo
    error: async () => null, // sin fallo de carga en el mock
    terminate: () => undefined,
  });

  // Soltar cualquier singleton previo y fijar la fabrica mock. El proximo
  // obtenerProxy() (precargar/calcular/estado) crea el par desde esta fabrica.
  __resetWorker();
  __setFabricaWorker(() => par);

  return {
    resolver(): void {
      // Vaciar la cola resolviendo cada pendiente con su resultado consciente del
      // modelo. Se copia y limpia primero para que un calculo disparado dentro de un
      // .then() encadenado no se procese en este mismo barrido.
      const enVuelo = pendientes.splice(0, pendientes.length);
      for (const p of enVuelo) {
        p.resolve(construirResultadosDesdeModeloFEM(p.modeloFEM));
      }
    },
    fallar(e: ErrorMotor): void {
      const enVuelo = pendientes.splice(0, pendientes.length);
      for (const p of enVuelo) {
        p.reject(e);
      }
    },
    contadorLlamadas(): number {
      return llamadas;
    },
    desinstalar(): void {
      __setFabricaWorker(null); // restaura la fabrica de produccion
      __resetWorker(); // suelta el singleton mock
    },
  };
}
