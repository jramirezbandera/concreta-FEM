// =============================================================================
// ejecutarPipelineAuxiliar.ts - Runner COMPARTIDO de pipeline asincrono obra ->
// FEM -> resultados (F2.1, decision 4A; cierra la parte de runner de
// T-modal-overlay-dedup).
//
// Tres caminos asincronos del proyecto comparten EXACTAMENTE el mismo esqueleto:
//   - calcularObra (estatico, useCalcular.ts)
//   - calcularModos (modal, useSolicitarModos.ts)
//   - calcularCR (centro de rigidez, useSolicitarCR.ts)
// Todos hacen: guard de reentrada -> sink onCalculando(true)/onErrorMotor(null) ->
// preparar (puro: discretizar / prepararModeloCR) -> si ok:false expone errores y
// corta antes del motor -> calcular (await solverClient.X) -> GUARD DE IDENTIDAD del
// modelo (si la obra cambio durante el await, NO comprometer resultados ni navegar)
// -> exito (escribir en el store + auto-switch de pestana) -> catch (ErrorMotor o
// excepcion envuelta en lenguaje de obra) -> finally (bajar guard + refrescar estado).
//
// Esta funcion factoriza ese esqueleto y deja PARAMETRIZADO lo que difiere:
//   - `preparar`: la discretizacion/preparacion pura (devuelve payload o errores; el
//      estatico ademas devuelve `avisos`, el modal/CR no).
//   - `ejecutar`: el await al solver (recibe el payload de `preparar`).
//   - `alExito`: que hacer con el resultado (escribir en el store del camino). El
//      auto-switch de pestana lo hace el runner DESPUES (comun a los tres).
//   - `mensajeFalloInesperado`: copy de obra para una excepcion que no es ErrorMotor.
//
// AISLAMIENTO (CLAUDE.md §8): habla solo con `esErrorMotor` del solver; no sabe que
// detras hay Worker/Pyodide/Python. Todo asincrono (CLAUDE.md §7). LENGUAJE DE OBRA
// (CLAUDE.md §2): los mensajes al arquitecto nunca llevan jerga FEM.
//
// COMPORTAMIENTO IDENTICO al codigo previo de calcularObra/calcularModos (refactor
// sin cambio observable): mismo orden de callbacks del sink, mismo guard de reentrada
// (a nivel de modulo en cada llamador), mismo guard de identidad, mismo auto-switch.
// =============================================================================

import type { ErrorObra } from "../../discretizador";
import type { Modelo } from "../../dominio";
import { modeloStore } from "../../estado/modeloStore";
import { vistaStore } from "../../estado/vistaStore";
import { esErrorMotor } from "../../solver";
import type { CalculoSink, ErrorCalculo } from "./useCalcular";

// Resultado de la fase PURA de preparacion (discretizar / prepararModeloCR). El
// camino estatico ademas trae `avisos` (no bloqueantes), TANTO en ok:true (los avisos
// del discretizar) COMO en ok:false (avisos=[] para limpiar los del intento anterior);
// el modal/CR no tienen canal de avisos, asi que `avisos` es opcional y el runner solo
// invoca onAvisos cuando la clave viene presente (no introduce una llamada a onAvisos
// donde antes no la habia: el modal nunca la hacia, ni en ok:true ni en ok:false).
export type Preparado<P> =
  | { ok: true; payload: P; avisos?: ErrorObra[] }
  | { ok: false; errores: ErrorObra[]; avisos?: ErrorObra[] };

// Parametros del runner. `P` es el tipo del payload de preparar (p.ej. {modeloFEM,
// trazabilidad} en el estatico; {modeloFEM, plantasInfo} en el CR), `R` el tipo del
// resultado del solver.
export interface PipelineAuxiliar<P, R> {
  /** Guard de reentrada (a nivel de modulo del llamador): lee/escribe el flag de "en
   *  vuelo". Se pasa como par get/set para que cada camino tenga su PROPIO flag (dos
   *  disparos del mismo camino no se solapan; caminos distintos no se bloquean entre
   *  si — el guard de doble disparo del MISMO camino es lo que importa). */
  estaEnVuelo: () => boolean;
  marcarEnVuelo: (v: boolean) => void;
  /** Fase PURA: discretiza/prepara el modelo. ok:false corta antes del motor. */
  preparar: (modelo: Modelo) => Preparado<P>;
  /** Fase asincrona: llama al solver con el payload de `preparar`. */
  ejecutar: (payload: P) => Promise<R>;
  /** Exito: escribe el resultado en el store del camino (recibe tambien el payload,
   *  por si el store guarda el ModeloFEM/trazabilidad junto al resultado). El runner
   *  ya garantizo el guard de identidad ANTES de llamar a esto. */
  alExito: (resultado: R, payload: P) => void;
  /** Copy de obra para una excepcion que NO es ErrorMotor (fallo inesperado). */
  mensajeFalloInesperado: string;
  /** Si tras el exito se navega a la pestana "Resultados". Default true (estatico/modal:
   *  sus paneles viven en Resultados). El CR lo pone FALSE: su marcador/panel son ayuda de
   *  PLANTA (planta-only), asi que calcular el CR NO debe sacar al usuario de la vista
   *  planta (donde ve el marcador) hacia Resultados (donde no se dibuja). */
  autoSwitchResultados?: boolean;
  /** Sink (callbacks de progreso). El llamador combina con su sink al store. */
  sink: CalculoSink;
}

// Runner compartido. Reproduce el flujo de calcularObra/calcularModos (mismo orden de
// efectos). El guard de reentrada lo lleva el llamador (flag de modulo) via los
// callbacks estaEnVuelo/marcarEnVuelo, robusto a doble disparo del mismo camino.
export async function ejecutarPipelineAuxiliar<P, R>(
  cfg: PipelineAuxiliar<P, R>,
): Promise<void> {
  if (cfg.estaEnVuelo()) return; // ya hay un calculo de ESTE camino en curso.
  const { sink } = cfg;
  cfg.marcarEnVuelo(true);
  sink.onCalculando?.(true);
  sink.onErrorMotor?.(null);

  try {
    // a. Modelo actual de obra (Capa 1). Capturamos la referencia para el guard de
    // identidad: modeloStore usa Immer, cualquier edicion la reemplaza.
    const modelo = modeloStore.getState().getModelo();

    // b. Preparar (puro). ok:false => errores de obra; NO se llama al motor.
    const prep = cfg.preparar(modelo);
    if (!prep.ok) {
      sink.onErrores?.(prep.errores);
      // Solo el camino estatico tiene canal de avisos; lo limpia con avisos=[] (el modal
      // nunca llamaba a onAvisos). No introducimos la llamada salvo que el preparado la traiga.
      if (prep.avisos !== undefined) sink.onAvisos?.(prep.avisos);
      return;
    }
    // ok:true => limpiamos errores previos; avisos solo si el camino los aporta.
    sink.onErrores?.([]);
    if (prep.avisos !== undefined) sink.onAvisos?.(prep.avisos);

    // c. Calcular en el motor. Refrescamos el estado en cuanto lanzamos para reflejar
    // "cargando"/"calculando".
    sink.onRefrescarEstado?.();
    const resultado = await cfg.ejecutar(prep.payload);

    // c.bis Guard de identidad (eng-review D3): si la obra cambio MIENTRAS calculabamos,
    // este resultado corresponde al modelo VIEJO. Comparar identidad basta (Immer
    // reemplaza la referencia en cada edicion). Si cambio, NO lo comprometemos ni
    // navegamos (el editar ya disparo limpiar() en el store correspondiente).
    if (modeloStore.getState().getModelo() !== modelo) {
      return;
    }

    // d. Exito: el llamador escribe en su store. El auto-switch a Resultados es comun a
    // los caminos cuyo panel vive ahi (estatico/modal). El CR (autoSwitchResultados:false)
    // se ve EN PLANTA: navegar a Resultados lo sacaria de donde esta su marcador, asi que
    // no navega.
    cfg.alExito(resultado, prep.payload);
    if (cfg.autoSwitchResultados !== false) {
      vistaStore.getState().setPestanaActiva("resultados");
    }
  } catch (e) {
    // e. Fallo del motor (carga o calculo). No relanzamos: dejamos el error
    // consultable. esErrorMotor distingue el ErrorMotor plano del worker.
    if (esErrorMotor(e)) {
      sink.onErrorMotor?.(e);
    } else {
      const fallo: ErrorCalculo = {
        fase: "calculo",
        mensaje: cfg.mensajeFalloInesperado,
        detalle: e instanceof Error ? e.message : String(e),
      };
      sink.onErrorMotor?.(fallo);
    }
  } finally {
    cfg.marcarEnVuelo(false);
    sink.onCalculando?.(false);
    sink.onRefrescarEstado?.();
  }
}
