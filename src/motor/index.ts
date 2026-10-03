/**
 * Motor FEM 3D de Concreta (fase E1: núcleo). API pública.
 *
 * Entra un `ModeloAnalitico` y sale, por caso, un `Float64Array` de desplazamientos y otro de
 * reacciones (6 por nudo), con diagnósticos. Los convenios de unidades, ejes y signos están en
 * la cabecera de `modelo.ts`.
 */
export { calcular, TOL_EQUILIBRIO, type OpcionesCalculo } from "./calcular.ts";
export type { Diagnostico, Severidad } from "./diagnosticos.ts";
export {
  NOMBRES_GDL,
  type Apoyo,
  type BarraAnalitica,
  type CargaNodal,
  type CasoCarga,
  type DesplazamientoImpuesto,
  type EstadisticasCalculo,
  type Gdl,
  type LaminaAnalitica,
  type ModeloAnalitico,
  type Muelle,
  type NudoAnalitico,
  type ResultadoCalculo,
  type ResultadoCaso,
  type Restriccion,
  type Vec3,
} from "./modelo.ts";
export { UMBRAL_MAL_CONDICIONADO, UMBRAL_MECANISMO, type TipoSolver } from "./solucion.ts";
