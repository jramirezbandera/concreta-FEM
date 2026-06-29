// crMotorUI: helpers de presentacion del estado del motor PARA EL CAMINO DEL CENTRO DE
// RIGIDEZ (CR, F2). Espejo de modalMotorUI.ts pero con copy propio del CR ("Calcular
// centro de rigidez" / "Calculando…"): el disparo del CR es independiente del estatico y
// del modal, asi que su boton lleva etiqueta propia. La HABILITACION es la MISMA que el
// calculo estatico/modal (mismo motor, mismo ciclo de vida), por eso se reusa
// `calculoHabilitado` de estadoMotorUI en vez de duplicarlo.
//
// LENGUAJE DE OBRA (CLAUDE.md §17): "centro de rigidez". CERO jerga FEM (nada de
// "diafragma rigido FEM"/"GDL"/"flexibilidad"). No sabe que detras hay Pyodide/Python.
import type { EstadoMotor } from "../../solver";
import { calculoHabilitado } from "../resultados/estadoMotorUI";

// Texto del boton "Calcular centro de rigidez" segun el estado del motor. Reusa los
// estados visibles del motor ("Cargando motor…") pero con copy propio en reposo/curso.
export function etiquetaBotonCR(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): string {
  if (calculando || estadoMotor === "calculando") return "Calculando…";
  if (estadoMotor === "descargado" || estadoMotor === "cargando")
    return "Cargando motor…";
  if (estadoMotor === "error") return "Reintentar";
  return "Calcular centro de rigidez";
}

// Alias de la habilitacion compartida con nombre explicito para el CR (mismo criterio
// que "Calcular obra"). Existe para que el panel del CR lea un nombre que delata su
// intencion sin recordar que es el mismo helper.
export function crHabilitado(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): boolean {
  return calculoHabilitado(estadoMotor, calculando);
}
