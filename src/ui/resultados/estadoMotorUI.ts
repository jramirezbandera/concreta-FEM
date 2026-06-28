// estadoMotorUI: helpers compartidos de presentacion del estado del motor de
// calculo. Cierra T-estado-motor-helpers: hasta F2.4 estos helpers estaban
// TRIPLICADOS (BotonCalcular, Brandbar, Menubar) con copias casi identicas y
// derivas sutiles. Aqui viven una sola vez y los tres los consumen. SIN cambio de
// comportamiento: cada funcion reproduce exactamente lo que hacia su replica.
//
// LENGUAJE DE OBRA (CLAUDE.md §17): el arquitecto nunca ve el estado tecnico crudo
// ("descargado"/"cargando"); estos helpers lo traducen a copy de obra. CERO jerga
// FEM. No saben que detras hay Pyodide/Python: solo proyectan EstadoMotor + flag de
// calculo en curso a etiqueta/habilitacion/tono.
import type { EstadoMotor } from "../../solver";

// Texto del boton de calculo segun el estado del motor (BotonCalcular del panel de
// Resultados). "Cargando motor…" y "Calculando…" son los estados visibles que exige
// el spec (feature-14); el resto cae en "Calcular". "Reintentar" tras un error.
export function etiquetaBotonCalcular(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): string {
  if (calculando || estadoMotor === "calculando") return "Calculando…";
  if (estadoMotor === "descargado" || estadoMotor === "cargando")
    return "Cargando motor…";
  if (estadoMotor === "error") return "Reintentar";
  return "Calcular";
}

// El calculo solo admite lanzarse con el motor "listo" (o en "error", para
// reintentar) y sin un calculo en curso. Criterio UNICO compartido por el boton del
// panel (BotonCalcular), el boton de la brandbar y el item de menu "Calcular obra".
export function calculoHabilitado(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): boolean {
  if (calculando) return false;
  return estadoMotor === "listo" || estadoMotor === "error";
}

// Rotulo del estado del motor en lenguaje de obra. Tag compacto (cabecera del panel
// de calculo y indicador de la brandbar). Sin jerga FEM; no expone "descargado".
export function rotuloEstadoMotor(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): string {
  if (calculando || estadoMotor === "calculando") return "calculando";
  switch (estadoMotor) {
    case "listo":
      return "motor listo";
    case "error":
      return "motor con error";
    default: // "descargado" | "cargando"
      return "preparando motor";
  }
}

// Tono semantico del punto indicador del estado del motor (brandbar). Mapea a una
// clase de color via shell.css (--success/--warning/--danger/--text-3).
export function tonoEstadoMotor(
  estadoMotor: EstadoMotor,
  calculando: boolean,
): string {
  if (calculando || estadoMotor === "calculando") return "calculando";
  if (estadoMotor === "listo") return "listo";
  if (estadoMotor === "error") return "error";
  return "preparando";
}
