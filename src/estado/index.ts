// Barrel del estado (CLAUDE.md §10): cuatro ambitos separados + nucleo undo/redo.
// modeloStore (Capa 1, unico en la pila de undo) · seleccionStore · vistaStore ·
// resultadosStore (derivados). Punto unico de import para la UI (feature-9+).

// --- Stores ------------------------------------------------------------------
export { modeloStore } from "./modeloStore";
export { seleccionStore } from "./seleccionStore";
export { vistaStore } from "./vistaStore";
export type {
  Pestana,
  ModoVista,
  DialogoActivo,
  MagnitudDiagrama,
  MagnitudIsovalores,
} from "./vistaStore";
export type {
  Herramienta,
  DefaultsPilar,
  DefaultsViga,
  DefaultsCarga,
  DefaultsPano,
} from "./vistaStore";
export { resultadosStore } from "./resultadosStore";
// modalStore (F2b): resultados del analisis MODAL (frecuencias + formas de vibracion).
// Espejo de resultadosStore para el camino modal (independiente del estatico); fuera
// de undo, se invalida al editar la obra desde modeloStore. Lo alimenta calcularModos
// y lo consumen ModoOverlay/PanelFrecuencias.
export { modalStore } from "./modalStore";
// crStore (F2, T-cr-fem-exacto): resultados del CENTRO DE RIGIDEZ (cr_por_planta).
// Espejo de modalStore para el camino del CR (independiente del estatico/modal); fuera
// de undo, se invalida al editar la obra desde modeloStore. Lo alimenta calcularCR y lo
// consumen CentroRigidezOverlay/CentroRigidez.
export { crStore } from "./crStore";
// calculoStore (feature-17): estado del calculo (estado del motor + progreso/errores).
// Fuera de undo, como vistaStore/resultadosStore. Lo alimenta useCalcular/calcularObra
// y lo consumen Brandbar/Menubar/BotonCalcular.
export { calculoStore } from "./calculoStore";

// --- Nucleo Command + IDs ----------------------------------------------------
export { PilaUndo } from "./comandos/pilaUndo";
export { crearComandoParches } from "./comandos/comando";
export type {
  Comando,
  AplicadorParches,
  RecetaModelo,
} from "./comandos/comando";
export { nuevoId } from "./ids";

// --- Comandos concretos (muestra; resto en feature-10..13) -------------------
export {
  crearPilar,
  editarPilar,
  eliminarPilar,
  moverPilar,
  moverNudo,
  crearViga,
  editarViga,
  eliminarViga,
  crearPano,
  editarPano,
  eliminarPano,
  crearGrupo,
  editarGrupo,
  eliminarGrupo,
  crearPlanta,
  editarPlanta,
  eliminarPlanta,
  crearCarga,
  editarCarga,
  eliminarCarga,
  crearHipotesis,
  editarHipotesis,
  eliminarHipotesis,
  editarAnalisis,
} from "./comandos/comandosModelo";
export type {
  DatosPilar,
  DatosViga,
  ExtremoViga,
  DatosPano,
  DatosGrupo,
  DatosPlanta,
  DatosCarga,
  DatosHipotesis,
} from "./comandos/comandosModelo";
