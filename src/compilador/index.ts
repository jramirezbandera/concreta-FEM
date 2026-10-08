/**
 * Compilador de Concreta FEM 3D (C1: barras; C2: losas). API pública: entra un `ModeloFisico` y
 * sale el `ModeloAnalitico` del motor con su `Mapeo` y sus diagnósticos; `EsfuerzosPiezas` devuelve
 * los resultados del motor a las piezas físicas, y el mapeo da las láminas de cada losa. Plan y
 * decisiones en `docs/fem3d/compilador.md`; convenios del modelo físico en la cabecera de
 * `fisico.ts`.
 */
export { compilar, huellaCompilacion, VERSION_COMPILADOR, type EstadisticasCompilacion, type ResultadoCompilacion } from "./compilar.ts";
export { cotasPlantas } from "./cotas.ts";
export { canonico, huellaDe, sha256 } from "./huella.ts";
export { fisicosDeIds, traducirDiagnosticos, type BarraMapeada, type Mapeo, type NudoMapeado } from "./mapeo.ts";
export { TOL_SIN_PERDIDAS } from "./cargas.ts";
export { EsfuerzosPiezas, type TramoFlexible } from "./resultados.ts";
export { proponerBandas, type PropuestaBandas } from "./bandas.ts";
export { EsfuerzosBandas, woodArmerEstacion, DELTA_MUESTRAS, type EstacionResultado, type MetodoWoodArmer } from "./esfuerzosBandas.ts";
export { estacionesBanda, ejesBanda, type EstacionBanda } from "./estaciones.ts";
export { EsfuerzosMuros, DELTA_BORDE, type Dintel, type EsfuerzosCorte, type Machon } from "./esfuerzosMuros.ts";
export { FACTOR_ZONA_RIGIDA, MODIFICADORES_D4, TAMANO_MALLA } from "./fisico.ts";
export { JACOBIANO_BAJO, VERSIONES_MALLADOR } from "./mallado.ts";
export type {
  ApoyoFisico,
  ApoyoLineal,
  Banda,
  CargaFisica,
  CasoFisico,
  Liberacion,
  Losa,
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
