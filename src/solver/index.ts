// CAPA 2 -> resultados (Pyodide/PyNite en Web Worker + Comlink). API PUBLICA del
// modulo solver: lo unico que la app puede importar. El worker, pynite_glue.py y
// la maquinaria Comlink/Pyodide quedan ENCAPSULADOS (CLAUDE.md §8): la UI habla
// solo con solverClient y con los tipos del contrato de resultados.

// Cliente: punto unico de contacto con el motor (precargar/calcular/estado/error).
export { solverClient, esErrorMotor } from "./solverClient";
export type { SolverClient } from "./solverClient";

// Tipos del contrato de resultados/estado que la UI necesita para tipar y para
// mostrar estados/errores. Se re-exportan desde aqui (no desde resultados.ts) para
// que la UI tenga una sola entrada al modulo. Los *Schema de Zod NO se re-exportan:
// la validacion de borde ya la hace solverClient; la UI consume datos ya validados.
export type {
  ResultadosCalculo,
  EstadoMotor,
  ErrorMotor,
} from "./resultados";

// DELIBERADAMENTE FUERA: worker.ts (SolverWorkerAPI), config.ts, pynite_glue.py y
// los *Schema de Zod. Son detalle de implementacion del solver, no API publica.
