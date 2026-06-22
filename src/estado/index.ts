// Barrel del estado (CLAUDE.md §10): cuatro ambitos separados + nucleo undo/redo.
// modeloStore (Capa 1, unico en la pila de undo) · seleccionStore · vistaStore ·
// resultadosStore (derivados). Punto unico de import para la UI (feature-9+).

// --- Stores ------------------------------------------------------------------
export { modeloStore } from "./modeloStore";
export { seleccionStore } from "./seleccionStore";
export { vistaStore } from "./vistaStore";
export type { Pestana, ModoVista, DialogoActivo } from "./vistaStore";
export type { Herramienta, DefaultsPilar } from "./vistaStore";
export { resultadosStore } from "./resultadosStore";

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
  crearGrupo,
  editarGrupo,
  eliminarGrupo,
  crearPlanta,
  editarPlanta,
  eliminarPlanta,
} from "./comandos/comandosModelo";
export type {
  DatosPilar,
  DatosGrupo,
  DatosPlanta,
} from "./comandos/comandosModelo";
