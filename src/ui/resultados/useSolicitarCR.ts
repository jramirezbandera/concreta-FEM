// =============================================================================
// useSolicitarCR.ts - Orquestacion del CENTRO DE RIGIDEZ (CR) FEM-exacto (F2).
//
// Espejo de useSolicitarModos.ts (camino modal) pero para el camino del CR: el usuario
// pulsa "Calcular centro de rigidez" (accion separada de "Calcular obra"/"Calcular
// modos"); preparamos la base FEM (geometria+rigidez, SIN cargas), el motor fabrica un
// diafragma rigido por planta y mide el CR, y volcamos el resultado al crStore.
//
// CR es un camino INDEPENDIENTE (decision 8A del plan): tiene su propio store (crStore),
// su propio overlay (CentroRigidezOverlay) y su propio disparador. NO reusa resultadosStore
// ni modalStore; comparte el estado del MOTOR (calculoStore: es el mismo motor, mismo ciclo
// de vida) y el runner de pipeline auxiliar (4A) con el estatico/modal.
//
// AISLAMIENTO (CLAUDE.md §8): habla solo con solverClient.calcularCR; no sabe que detras
// hay Web Worker, Pyodide ni Python. Todo asincrono (CLAUDE.md §7).
//
// LENGUAJE DE OBRA (CLAUDE.md §2): los mensajes al arquitecto nunca llevan jerga FEM. Los
// ErrorObra de prepararModeloCR (referencias rotas, sin sujecion) ya cumplen; para
// ErrorMotor usamos su `mensaje` (texto en espanol, no el `detalle` tecnico).
// =============================================================================

import { useCallback } from "react";

import { prepararModeloCR } from "../../discretizador";
import type { ModeloFEM, PlantaInfoCR, ErrorObra } from "../../discretizador";
import { calculoStore } from "../../estado/calculoStore";
import { modeloStore } from "../../estado/modeloStore";
import { crStore } from "../../estado/crStore";
import { solverClient } from "../../solver";
import type { EstadoMotor } from "../../solver";
import type { CRGlue } from "../../solver/resultadosCR";
import { ensamblarResultadosCR } from "../../solver/ensamblarCR";
import type { ErrorCalculo, CalculoSink } from "./useCalcular";
import { refrescarEstadoMotor } from "./useCalcular";
import { ejecutarPipelineAuxiliar } from "./ejecutarPipelineAuxiliar";

// API publica de useSolicitarCR(). El panel del CR (CentroRigidez) la consume. Reusa el
// ciclo de vida del motor que comparte calculoStore.
export interface UseSolicitarCR {
  /** Lanza el pipeline obra -> FEM base -> centro de rigidez por planta. No relanza si
   *  ya hay un calculo (estatico, modal o CR) de ESTE camino en curso. */
  calcularCR: () => Promise<void>;
  /** Estado del motor (reactivo, compartido con el calculo estatico/modal). */
  estadoMotor: EstadoMotor;
  /** true mientras hay un calculo en vuelo (estatico/modal/CR): para deshabilitar. */
  calculando: boolean;
  /** Errores de OBRA bloqueantes del ultimo intento de CR (prepararModeloCR ok:false),
   *  en lenguaje de obra (referencias rotas, estructura sin sujecion). */
  errores: ErrorObra[];
  /** Ultimo fallo del MOTOR (carga o calculo del CR), o null. Mensaje ya legible. */
  ultimoError: ErrorCalculo | null;
}

// Payload de la fase pura del camino CR: la base FEM + el diafragma por planta que el
// glue necesita. NO incluye cargas de usuario (el CR aplica sus propias cargas unitarias).
interface PayloadCR {
  modeloFEM: ModeloFEM;
  plantasInfo: PlantaInfoCR[];
}

// -----------------------------------------------------------------------------
// sinkAlStore: vuelca el progreso del pipeline del CR al calculoStore (fuente UNICA del
// estado de calculo, compartida con el estatico/modal). Asi el boton/menu/brandbar
// reflejan "calculando"/error tanto si el calculo en vuelo es estatico, modal o CR.
//
// NOTA: el estado del MOTOR (`calculando`) es compartido -es el mismo motor-, pero los
// errores/fallos del CR van a CANALES PROPIOS (`erroresCR`/`ultimoErrorCR`), NO al canal
// estatico ni al modal: cada panel lee su propio canal y no se contaminan entre si.
// onRefrescarEstado reconsulta el EstadoMotor real (compartido).
// -----------------------------------------------------------------------------
const sinkAlStore: CalculoSink = {
  onCalculando: (v) => calculoStore.getState().setCalculando(v),
  onErrores: (e) => calculoStore.getState().setErroresCR(e),
  onErrorMotor: (e) => calculoStore.getState().setUltimoErrorCR(e),
  onRefrescarEstado: () => refrescarEstadoMotor(),
};

// Guard de reentrada a nivel de modulo PROPIO del camino CR: sincrono, robusto a doble
// disparo (boton del panel + item de menu comparten este flag).
let crEnVuelo = false;

// -----------------------------------------------------------------------------
// calcularCR(): pipeline IMPERATIVO obra -> FEM base -> centro de rigidez, SIN hooks.
// Fuente UNICA del camino CR. La consume el hook useSolicitarCR() (camino reactivo de
// la UI). El esqueleto (guard de reentrada, onCalculando/onErrorMotor, preparar->corte,
// guard de identidad, auto-switch, catch/finally) lo lleva el runner compartido (4A);
// aqui parametrizamos lo propio del camino CR.
// -----------------------------------------------------------------------------
export async function calcularCR(): Promise<void> {
  await ejecutarPipelineAuxiliar<PayloadCR, CRGlue>({
    estaEnVuelo: () => crEnVuelo,
    marcarEnVuelo: (v) => {
      crEnVuelo = v;
    },
    preparar: (modelo) => {
      // prepararModeloCR factoriza la base (geometria+rigidez, sin cargas de usuario) +
      // el diafragma por planta. ok:false => errores de obra (referencias/sujecion), NO
      // se llama al motor. El CR NO tiene canal de avisos (no devolvemos `avisos`).
      const prep = prepararModeloCR(modelo);
      if (!prep.ok) return { ok: false, errores: prep.errores };
      return {
        ok: true,
        payload: { modeloFEM: prep.modeloFEM, plantasInfo: prep.plantasInfo },
      };
    },
    // solverClient.calcularCR asegura el motor listo, valida la salida CRUDA (CRGlue:
    // x/y por planta) con Zod y aplica timeout. El ensamblado de ex/ey (que necesita el
    // CM, concepto de obra) se hace en alExito (Capa 2 -> Capa 1 puro).
    ejecutar: ({ modeloFEM, plantasInfo }) =>
      solverClient.calcularCR(modeloFEM, plantasInfo),
    alExito: (crGlue) => {
      // El runner ya garantizo (guard de identidad) que la obra no cambio durante el
      // await: el modelo actual ES el que genero este crGlue. ensamblarResultadosCR le
      // añade ex/ey desde el centro de masas PURO (calcularCentroMasaPlanta) y produce
      // el ResultadosCR final (validado con Zod en el ensamblaje).
      const modelo = modeloStore.getState().getModelo();
      const resultados = ensamblarResultadosCR(crGlue, modelo);
      crStore.getState().setCR(resultados);
    },
    mensajeFalloInesperado:
      "No se pudo calcular el centro de rigidez por un fallo inesperado. " +
      "Vuelve a intentarlo; si persiste, reporta la incidencia.",
    sink: sinkAlStore,
  });
}

// -----------------------------------------------------------------------------
// useSolicitarCR: hook de orquestacion del camino CR.
//
// LEE el estado de calculo del calculoStore (fuente UNICA, compartida con el estatico/
// modal): asi el panel del CR refleja el mismo ciclo de vida del motor. NO monta su
// propio sondeo del EstadoMotor: el poller canonico es usePrecargaMotor (montado en App).
// calcularCR() delega en la funcion de modulo (que ya vuelca al store).
// -----------------------------------------------------------------------------
export function useSolicitarCR(): UseSolicitarCR {
  const estadoMotor = calculoStore((s) => s.estadoMotor);
  const calculando = calculoStore((s) => s.calculando);
  // Canales PROPIOS del CR (no los del estatico ni el modal): asi el panel del CR solo
  // refleja los errores/fallos de "Calcular centro de rigidez".
  const errores = calculoStore((s) => s.erroresCR);
  const ultimoError = calculoStore((s) => s.ultimoErrorCR);

  const calcular = useCallback(async (): Promise<void> => {
    await calcularCR();
  }, []);

  return {
    calcularCR: calcular,
    estadoMotor,
    calculando,
    errores,
    ultimoError,
  };
}
