// =============================================================================
// useCalcular.ts - Orquestacion del calculo (feature-14, Tarea 1.1).
//
// Conecta el modelo de obra (Capa 1) con el motor FEM (Capa 2) SIN reimplementar
// nada de calculo (CLAUDE.md regla de oro #1): solo coordina discretizar() ->
// solverClient.calcular() -> stores. NO renderiza UI; expone estado + acciones.
// El boton/indicador (Tarea 1.2) y la integracion en App.tsx (Tarea 3.1) consumen
// esta API.
//
// AISLAMIENTO (CLAUDE.md §8): habla solo con solverClient; no sabe que detras hay
// Web Worker, Pyodide ni Python. Todo es asincrono (CLAUDE.md §7).
//
// LENGUAJE DE OBRA (CLAUDE.md §2): los mensajes al arquitecto nunca llevan jerga
// FEM. Los ErrorObra del discretizador ya cumplen; para ErrorMotor usamos su
// `mensaje` (texto en espanol, no el `detalle` tecnico).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

import {
  discretizar,
  type ErrorObra,
  type ModeloFEM,
  type Trazabilidad,
} from "../../discretizador";
import { modeloStore } from "../../estado/modeloStore";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { esErrorMotor, solverClient } from "../../solver";
import type { EstadoMotor, ErrorMotor } from "../../solver";

// -----------------------------------------------------------------------------
// Error de motor enriquecido con la fase, listo para que la UI lo muestre. La UI
// solo necesita `mensaje` (lenguaje de obra) y, si quiere, `fase` para matizar
// el copy ("no se pudo arrancar el motor" vs "no se pudo resolver el modelo").
// Es exactamente la forma de ErrorMotor; se reexpone con nombre propio para que
// las tareas siguientes tipen sin importar del solver.
// -----------------------------------------------------------------------------
export type ErrorCalculo = ErrorMotor;

// API publica de useCalcular(). Las tareas 1.2 (boton/indicador) y 3.1 (App) la
// consumen; cualquier cambio aqui se coordina con ellas.
export interface UseCalcular {
  /** Lanza el pipeline obra -> FEM -> resultados. No relanza: deja el estado
   *  consultable. Ignora la llamada si ya hay un calculo en curso (doble clic). */
  calcular: () => Promise<void>;
  /** Estado del motor (reactivo). La UI habilita "Calcular" solo en "listo". */
  estadoMotor: EstadoMotor;
  /** true mientras este hook tiene un calcular() en vuelo (incluye discretizar
   *  + carga + analisis). Distinto de estadoMotor==="calculando" (que solo cubre
   *  la fase de analyze() en el worker). Para deshabilitar el boton end-to-end. */
  calculando: boolean;
  /** Errores de OBRA bloqueantes del ultimo intento (discretizar ok:false), en
   *  lenguaje de obra y apuntando al elemento culpable. [] si no hubo. */
  errores: ErrorObra[];
  /** Avisos NO bloqueantes del ultimo discretizar ok:true (p.ej. arranque
   *  elastico tratado como empotrado). [] si no hubo. */
  avisos: ErrorObra[];
  /** Ultimo fallo del MOTOR (carga o calculo), o null. Mensaje ya legible. */
  ultimoError: ErrorCalculo | null;
}

// -----------------------------------------------------------------------------
// calcularObra(): pipeline IMPERATIVO obra -> FEM -> resultados, SIN hooks.
//
// Fuente UNICA de verdad del calculo. La consumen dos caminos:
//  - el hook useCalcular() (camino reactivo de la UI: refleja estado/errores), que
//    pasa sus setters por `sink`.
//  - el DISPATCH del menu "Calcular obra" (Menubar.tsx, camino imperativo): no hay
//    componente ni estado React, asi que llama calcularObra() sin `sink`.
// Asi el boton y el menu disparan EXACTAMENTE la misma logica (no se duplica el
// pipeline). El guard de reentrada es a nivel de modulo: dos disparos solapados
// (doble clic, o boton + menu a la vez) no lanzan dos calculos.
//
// `sink` son callbacks OPCIONALES para que la UI refleje el progreso/resultado; en
// el camino imperativo se omiten (el BotonCalcular, montado en Resultados, ya
// refleja el estado del motor via su propio hook tras el auto-switch de pestana).
// -----------------------------------------------------------------------------
export interface CalculoSink {
  onCalculando?: (v: boolean) => void;
  onErrores?: (e: ErrorObra[]) => void;
  onAvisos?: (a: ErrorObra[]) => void;
  onErrorMotor?: (e: ErrorCalculo | null) => void;
  /** Llamado tras cada transicion que conviene reflejar (lanzar calculo, fin). */
  onRefrescarEstado?: () => void;
}

// Guard de reentrada a nivel de modulo: sincrono, robusto a doble disparo desde
// distintos origenes (boton del componente y menu comparten este flag).
let calculoEnVuelo = false;

export async function calcularObra(sink: CalculoSink = {}): Promise<void> {
  if (calculoEnVuelo) return; // ya hay un calculo en curso: no relanzar.
  calculoEnVuelo = true;
  sink.onCalculando?.(true);
  sink.onErrorMotor?.(null);

  try {
    // a. Modelo actual de obra (Capa 1).
    const modelo = modeloStore.getState().getModelo();

    // b. Discretizar (puro). ok:false => errores de obra, no llamamos al motor.
    const resultadoDisc = discretizar(modelo);
    if (!resultadoDisc.ok) {
      sink.onErrores?.(resultadoDisc.errores);
      sink.onAvisos?.([]);
      return; // Cortamos antes del motor: la obra no esta lista.
    }
    // ok:true => guardamos avisos (no bloquean) y limpiamos errores previos.
    sink.onErrores?.([]);
    sink.onAvisos?.(resultadoDisc.avisos);

    const modeloFEM: ModeloFEM = resultadoDisc.modeloFEM;
    const trazabilidad: Trazabilidad = resultadoDisc.trazabilidad;

    // c. Calcular en el motor. solverClient asegura el motor listo (precarga si
    // hace falta), valida la salida con Zod y aplica timeout. Refrescamos el
    // estado del motor en cuanto lanzamos para reflejar "cargando"/"calculando".
    sink.onRefrescarEstado?.();
    const resultados = await solverClient.calcular(modeloFEM);

    // c.bis Guard de carrera (eng-review D3): si la obra cambio MIENTRAS calculabamos,
    // estos resultados corresponden al modelo VIEJO. modeloStore usa Immer: cualquier
    // edicion (ejecutar/deshacer/cargar) reemplaza la referencia del modelo, asi que
    // basta comparar identidad. Si cambio, NO comprometemos los resultados como
    // vigentes (el editar ya disparo limpiar()): evita mostrar datos que no
    // corresponden a la obra actual marcados como validos, y no cambiamos de pestana.
    if (modeloStore.getState().getModelo() !== modelo) {
      return;
    }

    // d. Exito: fijar resultados (con el ModeloFEM y la trazabilidad que los
    // generaron: el resultadosStore los recibe juntos a proposito).
    resultadosStore.getState().setResultados(resultados, modeloFEM, trazabilidad);

    // Inicializar la combinacion activa SOLO si la actual no aplica: null o no
    // presente entre las combos calculadas. Si ya hay una valida (recalculo del
    // mismo modelo), se respeta la eleccion del usuario.
    const combinacionActiva = vistaStore.getState().combinacionActiva;
    if (combinacionActiva === null || !resultados.combos.includes(combinacionActiva)) {
      vistaStore.getState().setCombinacionActiva(resultados.combos[0] ?? null);
    }

    // Auto-switch a la pestana Resultados (confirmado por el usuario).
    vistaStore.getState().setPestanaActiva("resultados");
  } catch (e) {
    // e. Fallo del motor (carga o calculo). No relanzamos para no romper la UI:
    // dejamos el error consultable. esErrorMotor distingue el ErrorMotor plano del
    // worker; su `mensaje` ya viene en lenguaje de obra y `fase` permite matizar.
    if (esErrorMotor(e)) {
      sink.onErrorMotor?.(e);
    } else {
      // Cualquier otra excepcion (no deberia ocurrir: el cliente normaliza a
      // ErrorMotor). La envolvemos en un mensaje legible y la marcamos como fallo
      // de calculo para no exponer jerga tecnica al arquitecto.
      sink.onErrorMotor?.({
        fase: "calculo",
        mensaje:
          "No se pudo completar el calculo por un fallo inesperado. " +
          "Vuelve a intentarlo; si persiste, reporta la incidencia.",
        detalle: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    calculoEnVuelo = false;
    sink.onCalculando?.(false);
    // Refresco final: el motor vuelve a "listo" tras un calculo (o a "error" tras
    // un fallo de carga); que la UI lo refleje cuanto antes.
    sink.onRefrescarEstado?.();
  }
}

// -----------------------------------------------------------------------------
// useEstadoMotor: expone el EstadoMotor de forma reactiva.
//
// El worker no emite eventos y solverClient no ofrece suscripcion (decision
// documentada en solverClient.ts): la UI sondea estado(). Aqui hacemos un sondeo
// LIGERO y acotado:
//  - refresco puntual al montar y bajo demanda (refrescar()), que el hook llama
//    tras cada transicion que el propio codigo dispara (precarga/calculo).
//  - polling SOLO mientras el estado es transitorio ("cargando"/"calculando"):
//    en cuanto el motor queda "listo"/"error"/"descargado" se detiene el interval.
// Asi evitamos un timer permanente y renders por frame (CLAUDE.md §7).
// -----------------------------------------------------------------------------
const INTERVALO_SONDEO_MS = 400;

function useEstadoMotor(): {
  estadoMotor: EstadoMotor;
  refrescar: () => void;
} {
  const [estadoMotor, setEstadoMotor] = useState<EstadoMotor>("descargado");
  // Guardamos el ultimo estado en una ref para que el efecto de polling decida si
  // seguir sondeando sin recrearse en cada cambio (evita reinstalar el interval).
  const estadoRef = useRef<EstadoMotor>("descargado");
  // Evita actualizar estado tras desmontar (consulta async en vuelo).
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Consulta puntual al solver y publica el estado si cambio (evita renders
  // redundantes: setState con el mismo valor no re-renderiza, pero ademas asi el
  // efecto de polling lee siempre un valor coherente via la ref).
  const refrescar = useCallback(() => {
    void solverClient
      .estado()
      .then((e) => {
        if (!montadoRef.current) return;
        estadoRef.current = e;
        setEstadoMotor((prev) => (prev === e ? prev : e));
      })
      .catch(() => {
        // estado() es un passthrough que no deberia rechazar; si lo hace, no
        // tocamos el estado (lo refrescara la proxima transicion).
      });
  }, []);

  // Refresco al montar.
  useEffect(() => {
    refrescar();
  }, [refrescar]);

  // Polling acotado: solo activo mientras el estado sea transitorio. Se reevalua
  // cuando cambia `estadoMotor`; si pasa a estable, el efecto limpia su interval y
  // no instala otro (queda en reposo hasta la proxima transicion disparada).
  useEffect(() => {
    const transitorio =
      estadoMotor === "cargando" || estadoMotor === "calculando";
    if (!transitorio) return;
    const id = setInterval(refrescar, INTERVALO_SONDEO_MS);
    return () => clearInterval(id);
  }, [estadoMotor, refrescar]);

  return { estadoMotor, refrescar };
}

// -----------------------------------------------------------------------------
// usePrecargaMotor: arranca el motor en segundo plano UNA vez al montar.
//
// CLAUDE.md §8: precargar mientras el usuario modela para que "Calcular" este
// listo cuanto antes. solverClient.precargar() ya es idempotente; aqui ademas
// guardamos un guard de montaje para no dispararla dos veces en StrictMode.
// No bloquea: ignoramos el error del propio precargar (el estado "error" lo
// reflejara useEstadoMotor sondeando). Devuelve el estado para que App lo use si
// quiere (indicador "cargando motor").
// -----------------------------------------------------------------------------
export function usePrecargaMotor(): { estadoMotor: EstadoMotor } {
  const { estadoMotor, refrescar } = useEstadoMotor();
  const lanzadaRef = useRef(false);

  useEffect(() => {
    if (lanzadaRef.current) return;
    lanzadaRef.current = true;
    // En segundo plano: no await. Tras lanzar, refrescamos para capturar la
    // transicion a "cargando"; el polling de useEstadoMotor seguira hasta "listo".
    void solverClient
      .precargar()
      .catch(() => {
        // El fallo de carga queda registrado en el worker (error()) y el estado
        // pasara a "error"; useEstadoMotor lo reflejara. Nada que hacer aqui.
      })
      .finally(() => {
        refrescar();
      });
    // Refresco inmediato para reflejar "cargando" sin esperar al .finally.
    refrescar();
  }, [refrescar]);

  return { estadoMotor };
}

// -----------------------------------------------------------------------------
// useCalcular: el hook de orquestacion principal.
// -----------------------------------------------------------------------------
export function useCalcular(): UseCalcular {
  const { estadoMotor, refrescar } = useEstadoMotor();
  const [calculando, setCalculando] = useState(false);
  const [errores, setErrores] = useState<ErrorObra[]>([]);
  const [avisos, setAvisos] = useState<ErrorObra[]>([]);
  const [ultimoError, setUltimoError] = useState<ErrorCalculo | null>(null);

  // El camino reactivo delega en calcularObra() (fuente unica del pipeline) y le
  // pasa sus setters por el `sink`: asi el boton y el menu disparan la MISMA logica
  // sin duplicarla. El guard de reentrada vive dentro de calcularObra() (a nivel de
  // modulo), robusto a doble disparo desde distintos origenes.
  const calcular = useCallback(async (): Promise<void> => {
    await calcularObra({
      onCalculando: setCalculando,
      onErrores: setErrores,
      onAvisos: setAvisos,
      onErrorMotor: setUltimoError,
      onRefrescarEstado: refrescar,
    });
  }, [refrescar]);

  return { calcular, estadoMotor, calculando, errores, avisos, ultimoError };
}
