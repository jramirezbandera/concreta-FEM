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
import { modeloStore } from "../../estado/modeloStore";
import { modalStore } from "../../estado/modalStore";
import { vistaStore } from "../../estado/vistaStore";
import { esErrorMotor, solverClient } from "../../solver";
import type { EstadoMotor } from "../../solver";
import type { ErrorCalculo, CalculoSink } from "./useCalcular";
import { refrescarEstadoMotor } from "./useCalcular";

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

// -----------------------------------------------------------------------------
// calcularModos(): pipeline IMPERATIVO obra -> FEM modal -> frecuencias/formas, SIN
// hooks. Fuente UNICA del camino modal. La consumen el hook useSolicitarModos() (camino
// reactivo de la UI) y el DISPATCH del menu "Calcular modos" (Menubar.tsx, imperativo).
//
// El guard de reentrada es a nivel de modulo: dos disparos solapados (doble clic, o
// boton + menu a la vez) no lanzan dos calculos modales. Comparte el calculoStore con
// el estatico para reflejar el estado del motor.
// -----------------------------------------------------------------------------
export async function calcularModos(numModos: number): Promise<void> {
  if (modalEnVuelo) return; // ya hay un calculo modal en curso: no relanzar.
  modalEnVuelo = true;
  sinkAlStore.onCalculando?.(true);
  sinkAlStore.onErrorMotor?.(null);

  try {
    // a. Modelo actual de obra (Capa 1).
    const modelo = modeloStore.getState().getModelo();

    // b. Discretizar en MODO MODAL (puro). opts.modal => analysis.type:"modal" +
    // num_modes; corre las guardas modales (MODAL_NUM_MODOS / MODAL_SIN_MASA). ok:false
    // => errores de obra (en lenguaje de obra), no llamamos al motor.
    const resultadoDisc = discretizar(modelo, { modal: { numModos } });
    if (!resultadoDisc.ok) {
      sinkAlStore.onErrores?.(resultadoDisc.errores);
      return; // Cortamos antes del motor: la obra no esta lista para modal.
    }
    // ok:true => limpiamos errores previos.
    sinkAlStore.onErrores?.([]);

    const modeloFEM: ModeloFEM = resultadoDisc.modeloFEM;
    const trazabilidad: Trazabilidad = resultadoDisc.trazabilidad;

    // c. Calcular los modos en el motor. solverClient.calcularModal asegura el motor
    // listo (precarga si hace falta), valida la salida con Zod y aplica timeout.
    // Refrescamos el estado del motor en cuanto lanzamos para reflejar "cargando"/"calculando".
    sinkAlStore.onRefrescarEstado?.();
    const modos = await solverClient.calcularModal(modeloFEM);

    // c.bis Guard de carrera (igual que calcularObra): si la obra cambio MIENTRAS
    // calculabamos, estos modos corresponden al modelo VIEJO. modeloStore usa Immer:
    // cualquier edicion reemplaza la referencia, basta comparar identidad. Si cambio,
    // NO los comprometemos como vigentes (el editar ya disparo limpiar() en modalStore).
    if (modeloStore.getState().getModelo() !== modelo) {
      return;
    }

    // d. Exito: fijar los modos (con el ModeloFEM y la trazabilidad que los generaron:
    // el modalStore los recibe juntos a proposito). setModos reancla modoActivo=1.
    modalStore.getState().setModos(modos, modeloFEM, trazabilidad);

    // Auto-switch a la pestana Resultados (espejo de calcularObra, hallazgo D2): el
    // PanelFrecuencias y el ModoOverlay SOLO se montan en Resultados, asi que lanzar
    // "Calcular modos" desde el menu en otra pestana ejecutaria el motor sin que el
    // usuario viera nada. Tras el guard de identidad (no navegar si la obra cambio
    // durante el await) y tras fijar los modos, llevamos al usuario a verlos. NO
    // forzamos modo 3D (igual que calcularObra con la deformada): el usuario conmuta a
    // 3D con sus controles cuando quiere ver la forma animada.
    vistaStore.getState().setPestanaActiva("resultados");
  } catch (e) {
    // e. Fallo del motor (carga o calculo modal). No relanzamos: dejamos el error
    // consultable. esErrorMotor distingue el ErrorMotor plano del worker; su `mensaje`
    // ya viene en lenguaje de obra.
    if (esErrorMotor(e)) {
      sinkAlStore.onErrorMotor?.(e);
    } else {
      sinkAlStore.onErrorMotor?.({
        fase: "calculo",
        mensaje:
          "No se pudieron calcular los modos de vibracion por un fallo inesperado. " +
          "Vuelve a intentarlo; si persiste, reporta la incidencia.",
        detalle: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    modalEnVuelo = false;
    sinkAlStore.onCalculando?.(false);
    // Refresco final: el motor vuelve a "listo" tras un calculo (o a "error"); que la
    // UI lo refleje cuanto antes.
    sinkAlStore.onRefrescarEstado?.();
  }
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
