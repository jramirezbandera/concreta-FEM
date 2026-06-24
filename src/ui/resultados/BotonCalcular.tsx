import { PanelFlotante, Boton } from "../primitivas";
// CONTRATO CON TAREA 1.1 (useCalcular.ts, en desarrollo en paralelo): este componente
// se programa CONTRA la interfaz acordada del hook. Si por la carrera el fichero aun no
// exporta exactamente `useCalcular`, el import queda correcto y se reconcilia al integrar.
import { useCalcular } from "./useCalcular";
import type { ErrorObra } from "../../discretizador";
import "./botonCalcular.css";

// BotonCalcular (feature-14, Tarea 1.2): boton "Calcular" + indicador de estado del
// motor + panel de errores/avisos en LENGUAJE DE OBRA. Es el unico disparador visible
// del corte vertical F1 (obra -> discretizar -> solver -> resultados). Vocabulario de
// obra; CERO jerga FEM (CLAUDE.md §17): el usuario nunca ve "nodo", "member" ni "release".
//
// El componente NO sabe que detras hay Python/Pyodide: solo consume `useCalcular()`, que
// refleja el `EstadoMotor` del solverClient y orquesta el calculo asincrono (CLAUDE.md §7,
// el hilo principal nunca se bloquea). El estado del motor decide habilitacion y etiqueta;
// los errores de discretizacion / del motor se muestran como panel no intrusivo.

// Texto del boton segun el estado del motor. "Cargando motor…" y "Calculando…" son los
// estados visibles que exige el spec (feature-14); el resto cae en "Calcular".
function etiquetaBoton(estadoMotor: string, calculando: boolean): string {
  if (calculando || estadoMotor === "calculando") return "Calculando…";
  if (estadoMotor === "descargado" || estadoMotor === "cargando") return "Cargando motor…";
  if (estadoMotor === "error") return "Reintentar";
  return "Calcular";
}

// El boton solo admite pulsacion cuando el motor esta "listo" (o en "error", para
// reintentar) y no hay un calculo en curso. Mientras carga el motor o calcula, deshabilitado.
function botonHabilitado(estadoMotor: string, calculando: boolean): boolean {
  if (calculando) return false;
  return estadoMotor === "listo" || estadoMotor === "error";
}

// Rotulo del estado del motor en lenguaje de obra (no se expone el estado tecnico crudo
// como "descargado"). Tag compacto en la cabecera del panel; sin jerga FEM.
function tagEstadoMotor(estadoMotor: string): string {
  switch (estadoMotor) {
    case "listo":
      return "motor listo";
    case "calculando":
      return "calculando";
    case "error":
      return "motor con error";
    default: // "descargado" | "cargando"
      return "preparando motor";
  }
}

// Una fila de mensaje de obra (error bloqueante o aviso no bloqueante). Texto tal cual lo
// produce el discretizador (espanol con tildes, sin jerga FEM); el `codigo` no se muestra.
function FilaMensaje({ obra }: { obra: ErrorObra }) {
  return (
    <li
      className={
        obra.severidad === "error"
          ? "cx-calcular__msg cx-calcular__msg--error"
          : "cx-calcular__msg cx-calcular__msg--aviso"
      }
    >
      {obra.mensaje}
    </li>
  );
}

export function BotonCalcular() {
  const { calcular, estadoMotor, calculando, errores, avisos, ultimoError } = useCalcular();

  const habilitado = botonHabilitado(estadoMotor, calculando);
  const etiqueta = etiquetaBoton(estadoMotor, calculando);

  // Hay algo que reportar si la discretizacion devolvio errores/avisos de obra o si el
  // motor fallo (carga/calculo). Se muestra debajo del boton, sin bloquear la UI.
  const hayErrores = errores.length > 0;
  const hayAvisos = avisos.length > 0;
  const hayFalloMotor = ultimoError !== null;
  const hayReporte = hayErrores || hayAvisos || hayFalloMotor;

  return (
    <PanelFlotante
      className="cx-calcular"
      // El "estado del motor" como tag mono en la cabecera mantiene visible si el motor
      // esta cargando/listo/calculando sin ocupar mas cromo (Spec feature-14).
      titulo="Cálculo"
      tag={tagEstadoMotor(estadoMotor)}
    >
      <Boton
        variante="primary"
        onClick={() => void calcular()}
        disabled={!habilitado}
        // `aria-busy` comunica a lectores de pantalla que hay trabajo en curso (motor
        // cargando o calculando) sin depender solo del texto.
        aria-busy={calculando || estadoMotor === "cargando"}
      >
        {etiqueta}
      </Boton>

      {hayReporte && (
        <div className="cx-calcular__reporte" role="status" aria-live="polite">
          {hayFalloMotor && (
            // Fallo del motor (carga o calculo): se muestra el mensaje de obra del hook
            // (ya traducido por Tarea 1.1), nunca el traceback de Python.
            <p className="cx-calcular__motor-error">{ultimoError.mensaje}</p>
          )}
          {hayErrores && (
            <ul className="cx-calcular__lista">
              {errores.map((e, i) => (
                <FilaMensaje key={`${e.codigo}-${e.elementoId ?? i}`} obra={e} />
              ))}
            </ul>
          )}
          {hayAvisos && (
            <ul className="cx-calcular__lista">
              {avisos.map((a, i) => (
                <FilaMensaje key={`${a.codigo}-${a.elementoId ?? i}`} obra={a} />
              ))}
            </ul>
          )}
        </div>
      )}
    </PanelFlotante>
  );
}
