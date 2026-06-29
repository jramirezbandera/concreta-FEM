// =============================================================================
// useSolicitarModos.ts - Orquestacion del ANALISIS MODAL (F2b).
//
// Espejo de useCalcular.ts (camino estatico) pero para el camino MODAL: el usuario
// pulsa "Calcular modos" (accion separada de "Calcular obra"); calculamos las
// frecuencias propias y las formas de vibracion, y las volcamos al modalStore.
//
// Modal es un camino INDEPENDIENTE (decision de alcance F2b): tiene su propio store
// (modalStore), su propio overlay (ModoOverlay) y su propio disparador. NO reusa el
// resultadosStore ni el pipeline estatico; comparte el estado del MOTOR (calculoStore:
// es el mismo motor, mismo ciclo de vida) y los helpers de precarga/estado de useCalcular.
//
// AISLAMIENTO (CLAUDE.md §8): habla solo con solverClient.calcularModal; no sabe que
// detras hay Web Worker, Pyodide ni Python. Todo asincrono (CLAUDE.md §7).
//
// LENGUAJE DE OBRA (CLAUDE.md §2): los mensajes al arquitecto nunca llevan jerga FEM.
// Los ErrorObra del discretizador (guards MODAL_NUM_MODOS/MODAL_SIN_MASA) ya cumplen;
// para ErrorMotor usamos su `mensaje` (texto en espanol, no el `detalle` tecnico).
// =============================================================================

import { useCallback } from "react";

import {
  discretizar,
  type ErrorObra,
  type ModeloFEM,
  type Trazabilidad,
} from "../../discretizador";
import { calculoStore } from "../../estado/calculoStore";
import { modalStore } from "../../estado/modalStore";
import { solverClient } from "../../solver";
import type { EstadoMotor, ResultadosModales } from "../../solver";
import type { ErrorCalculo, CalculoSink } from "./useCalcular";
import { refrescarEstadoMotor } from "./useCalcular";
import { ejecutarPipelineAuxiliar } from "./ejecutarPipelineAuxiliar";

// API publica de useSolicitarModos(). El panel de frecuencias (PanelFrecuencias) y el
// boton/menu la consumen. Reusa el ciclo de vida del motor que comparte calculoStore.
export interface UseSolicitarModos {
  /** Lanza el pipeline obra -> FEM modal -> frecuencias/formas. No relanza si ya hay
   *  un calculo (estatico O modal) en curso. `numModos` lo pasa el llamante. */
  calcularModos: (numModos: number) => Promise<void>;
  /** Estado del motor (reactivo, compartido con el calculo estatico). */
  estadoMotor: EstadoMotor;
  /** true mientras hay un calculo en vuelo (estatico o modal): para deshabilitar. */
  calculando: boolean;
  /** Errores de OBRA bloqueantes del ultimo intento modal (discretizar ok:false), en
   *  lenguaje de obra. Incluye los guards modales (sin masa / nº de modos invalido). */
  errores: ErrorObra[];
  /** Ultimo fallo del MOTOR (carga o calculo modal), o null. Mensaje ya legible. */
  ultimoError: ErrorCalculo | null;
}

// -----------------------------------------------------------------------------
// sinkAlStore: vuelca el progreso del pipeline modal al calculoStore (fuente UNICA del
// estado de calculo, compartida con el estatico). Asi el boton/menu/brandbar reflejan
// "calculando"/error tanto si el calculo en vuelo es estatico como modal.
//
// NOTA: el estado del MOTOR (`calculando`) es compartido -es el mismo motor-, pero los
// errores/fallos del modal van a CANALES PROPIOS (`erroresModal`/`ultimoErrorModal`),
// NO al canal estatico: el panel modal (PanelFrecuencias) y el estatico (BotonCalcular)
// estan montados a la vez en Resultados; con canales separados, un "Calcular modos"
// fallido NO contamina el panel de "Calcular obra" (ni al reves). onRefrescarEstado
// reconsulta el EstadoMotor real (compartido).
// -----------------------------------------------------------------------------
const sinkAlStore: CalculoSink = {
  onCalculando: (v) => calculoStore.getState().setCalculando(v),
  onErrores: (e) => calculoStore.getState().setErroresModal(e),
  onErrorMotor: (e) => calculoStore.getState().setUltimoErrorModal(e),
  onRefrescarEstado: () => refrescarEstadoMotor(),
};

// Guard de reentrada a nivel de modulo PROPIO del camino modal: sincrono, robusto a
// doble disparo (boton del panel + item de menu comparten este flag).
let modalEnVuelo = false;

// Payload de la fase pura del camino modal: el ModeloFEM modal + la trazabilidad que el
// modalStore guarda junto a los modos (mismo origen, deben casar).
interface PayloadModal {
  modeloFEM: ModeloFEM;
  trazabilidad: Trazabilidad;
}

// -----------------------------------------------------------------------------
// calcularModos(): pipeline IMPERATIVO obra -> FEM modal -> frecuencias/formas, SIN
// hooks. Fuente UNICA del camino modal. La consumen el hook useSolicitarModos() (camino
// reactivo de la UI) y el DISPATCH del menu "Calcular modos" (Menubar.tsx, imperativo).
//
// El esqueleto (guard de reentrada, onCalculando/onErrorMotor, discretizar->corte,
// guard de identidad, auto-switch a Resultados, catch/finally) lo lleva el runner
// compartido (4A); aqui parametrizamos lo propio del camino modal. Comparte el
// calculoStore con el estatico para reflejar el estado del motor.
// -----------------------------------------------------------------------------
export async function calcularModos(numModos: number): Promise<void> {
  await ejecutarPipelineAuxiliar<PayloadModal, ResultadosModales>({
    estaEnVuelo: () => modalEnVuelo,
    marcarEnVuelo: (v) => {
      modalEnVuelo = v;
    },
    preparar: (modelo) => {
      // Discretizar en MODO MODAL: opts.modal => analysis.type:"modal" + num_modes;
      // corre las guardas modales (MODAL_NUM_MODOS / MODAL_SIN_MASA). El modal NO tiene
      // canal de avisos: no devolvemos `avisos` (el runner no llamara a onAvisos).
      const disc = discretizar(modelo, { modal: { numModos } });
      if (!disc.ok) return { ok: false, errores: disc.errores };
      return {
        ok: true,
        payload: { modeloFEM: disc.modeloFEM, trazabilidad: disc.trazabilidad },
      };
    },
    // solverClient.calcularModal asegura el motor listo, valida con Zod y aplica timeout.
    ejecutar: ({ modeloFEM }) => solverClient.calcularModal(modeloFEM),
    // Fijar los modos (con el ModeloFEM y la trazabilidad que los generaron: el
    // modalStore los recibe juntos a proposito). setModos reancla modoActivo=1. El
    // auto-switch a Resultados (hallazgo D2: PanelFrecuencias/ModoOverlay solo se montan
    // ahi) lo hace el runner tras el guard de identidad.
    alExito: (modos, { modeloFEM, trazabilidad }) => {
      modalStore.getState().setModos(modos, modeloFEM, trazabilidad);
    },
    mensajeFalloInesperado:
      "No se pudieron calcular los modos de vibracion por un fallo inesperado. " +
      "Vuelve a intentarlo; si persiste, reporta la incidencia.",
    sink: sinkAlStore,
  });
}

// -----------------------------------------------------------------------------
// useSolicitarModos: hook de orquestacion del camino modal.
//
// LEE el estado de calculo del calculoStore (fuente UNICA, compartida con el estatico):
// asi el panel modal refleja el mismo ciclo de vida del motor. NO monta su propio
// sondeo del EstadoMotor: el poller canonico es usePrecargaMotor (montado en App).
// calcularModos() delega en la funcion de modulo (que ya vuelca al store).
// -----------------------------------------------------------------------------
export function useSolicitarModos(): UseSolicitarModos {
  const estadoMotor = calculoStore((s) => s.estadoMotor);
  const calculando = calculoStore((s) => s.calculando);
  // Canales PROPIOS del modal (no los del estatico): asi el panel modal solo refleja
  // los errores/fallos de "Calcular modos".
  const errores = calculoStore((s) => s.erroresModal);
  const ultimoError = calculoStore((s) => s.ultimoErrorModal);

  const calcular = useCallback(async (numModos: number): Promise<void> => {
    await calcularModos(numModos);
  }, []);

  return {
    calcularModos: calcular,
    estadoMotor,
    calculando,
    errores,
    ultimoError,
  };
}
