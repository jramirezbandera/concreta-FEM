// Barrel del ARNES de los golden tests (feature-6). T1.1 (golden del
// discretizador) y T1.2 (asserts numericos del pipeline) importan SOLO desde
// aqui. Tres bloques: arranque del motor compartido, pipeline, fixtures de obra y
// politica de tolerancias.

// Arranque UNICO compartido de Pyodide (cachea la promesa a nivel de modulo).
export {
  obtenerMotor,
  TIMEOUT_ARRANQUE,
  type MotorGolden,
  type ArranqueMotor,
  type VersionesRuntime,
} from "./motor";

// Pipeline obra -> discretizar -> motor (y el discretizador aislado, sin motor).
export { ejecutarPipeline, discretizarOExplotar } from "./pipeline";

// Fixtures de las obras canonicas (Capa 1, solo entrada).
export {
  fixtureBiapoyadaUDL,
  fixtureVoladizoPuntual,
  fixtureBiapoyadaPuntualCentro,
  fixturePorticoSimple,
  // Peso propio (F2a / F3.1): viga, pilar y toggle ON/OFF.
  fixturePesoPropioVigaBiapoyada,
  fixturePesoPropioPilar,
  conPesoPropioOff,
  RHO_ACERO,
  MATERIAL_GOLDEN,
  PERFIL_GOLDEN,
  SECCION_GOLDEN,
  type ParamsUDL,
  type ParamsVoladizoP,
  type ParamsBiapoyadaP,
  type ParamsPortico,
  type ParamsPesoPropioViga,
  type ParamsPesoPropioPilar,
} from "./fixtures";

// Politica de tolerancias + formato del caso golden.
export {
  TOL_REL_ESFUERZOS,
  TOL_REL_REACCIONES,
  TOL_REL_FLECHAS,
  PISO_ABS_ESFUERZOS,
  PISO_ABS_FLECHAS,
  compararConTolerancia,
  compararEsfuerzo,
  compararReaccion,
  compararFlecha,
  compararPorCategoria,
  type ResultadoComparacion,
  type CategoriaTolerancia,
  type MagnitudEsperada,
  type CasoGolden,
} from "./tolerancias";
