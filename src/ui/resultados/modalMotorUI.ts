// modalMotorUI: helpers de presentacion del estado del motor PARA EL CAMINO MODAL
// (F2b). Espejo de estadoMotorUI.ts pero con copy propio del modal ("Calcular modos" /
// "Calculando modos…"): el disparo modal es independiente del estatico, asi que su
// boton/menu llevan etiqueta propia. La HABILITACION es la MISMA que el calculo
// estatico (mismo motor, mismo ciclo de vida), por eso se reusa `calculoHabilitado` de
// estadoMotorUI en vez de duplicarlo.
//
// LENGUAJE DE OBRA (CLAUDE.md §17): "modos de vibracion", "frecuencia". CERO jerga FEM
// (nada de "eigenvalue"/"GDL"/"modal mass"). No sabe que detras hay Pyodide/Python.
import type { EstadoMotor } from "../../solver";
import { calculoHabilitado } from "./estadoMotorUI";

// Reexport de la habilitacion compartida: el modal se lanza con el motor "listo" (o en
// "error" para reintentar) y sin calculo en curso, exactamente igual que "Calcular obra".
export { calculoHabilitado } from "./estadoMotorUI";

// Texto del boton "Calcular modos" segun el estado del motor. Reusa los estados
// visibles del motor ("Cargando motor…") pero con copy modal propio en reposo/curso.
export function etiquetaBotonModos(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): string {
  if (calculando || estadoMotor === "calculando") return "Calculando modos…";
  if (estadoMotor === "descargado" || estadoMotor === "cargando")
    return "Cargando motor…";
  if (estadoMotor === "error") return "Reintentar";
  return "Calcular modos";
}

// Alias de la habilitacion compartida con nombre explicito para el modal (mismo
// criterio que "Calcular obra"). Existe para que el panel/menu modal lean un nombre
// que delata su intencion sin tener que recordar que es el mismo helper.
export function modosHabilitado(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): boolean {
  return calculoHabilitado(estadoMotor, calculando);
}
