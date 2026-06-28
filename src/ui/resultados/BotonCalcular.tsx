import { PanelFlotante, Boton } from "../primitivas";
import { useCalcular } from "./useCalcular";
import {
  etiquetaBotonCalcular,
  calculoHabilitado,
  rotuloEstadoMotor,
} from "./estadoMotorUI";
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
// los errores de discretizacion / del motor se muestran como panel no intrusivo. Los
// helpers de presentacion del estado del motor viven en estadoMotorUI.ts (compartidos
// con la Brandbar y el Menubar; cerro T-estado-motor-helpers).

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

  const habilitado = calculoHabilitado(estadoMotor, calculando);
  const etiqueta = etiquetaBotonCalcular(estadoMotor, calculando);

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
      tag={rotuloEstadoMotor(estadoMotor, calculando)}
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
