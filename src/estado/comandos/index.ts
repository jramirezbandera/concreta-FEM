// Barrel del nucleo de comandos (patron Command) y comandos concretos.
export { crearComandoParches, applyPatches } from "./comando";
export type { Comando, AplicadorParches, RecetaModelo, Patch } from "./comando";
export { PilaUndo } from "./pilaUndo";
export { crearPilar, moverNudo } from "./comandosModelo";
export type { DatosPilar } from "./comandosModelo";
