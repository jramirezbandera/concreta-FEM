/**
 * Compilador de Concreta FEM 3D (fase C1: barras). API pública: entra un `ModeloFisico` y sale el
 * `ModeloAnalitico` del motor con su `Mapeo` y sus diagnósticos; `EsfuerzosPiezas` devuelve los
 * resultados del motor a las piezas físicas. Plan y decisiones en
 * `docs/fem3d/compilador.md`; convenios del modelo físico en la cabecera de `fisico.ts`.
 */
export { compilar, huellaCompilacion, VERSION_COMPILADOR, type EstadisticasCompilacion, type ResultadoCompilacion } from "./compilar.ts";
export { cotasPlantas } from "./cotas.ts";
export { canonico, huellaDe, sha256 } from "./huella.ts";
export { fisicosDeIds, traducirDiagnosticos, type BarraMapeada, type Mapeo, type NudoMapeado } from "./mapeo.ts";
export { TOL_SIN_PERDIDAS } from "./cargas.ts";
export { EsfuerzosPiezas, type TramoFlexible } from "./resultados.ts";
export { FACTOR_ZONA_RIGIDA, MODIFICADORES_D4 } from "./fisico.ts";
export type {
  ApoyoFisico,
  CargaFisica,
  CasoFisico,
  Liberacion,
  Material,
  ModeloFisico,
  ModificadoresPieza,
  ModificadoresPiezas,
  OpcionesCompilacion,
  Pilar,
  Planta,
  Seccion,
  TipoPlanta,
  Vec2,
  Viga,
} from "./fisico.ts";
