// CAPA 1 -> CAPA 2 (PURO, sin React/IO/Pyodide). El corazon del producto.
// Superficie publica del discretizador: la funcion `discretizar`, su resultado y
// constantes, el contrato FEM completo (Capa 2) y las validaciones previas.
export {
  discretizar,
  TOL_NODO,
  mapearEjes,
  clavePosicion,
  releasesDeExtremo,
  resolverSeccion,
  signoGravitatorio,
} from "./discretizar";
export type { ResultadoDiscretizacion } from "./discretizar";

// Contrato de la Capa 2 (schemas Zod + tipos via z.infer).
export * from "./contratoFEM";

// Validaciones previas en lenguaje de obra.
export { validarModelo } from "./validaciones";
export type { ErrorObra } from "./validaciones";

// Centro de masas por planta (F2.1, calculo PURO; lo consume la UI de F2.4).
export { calcularCentroMasaPlanta } from "./centros";
export type { CentroMasaPlanta } from "./centros";
