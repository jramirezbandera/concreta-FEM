/**
 * Motor FEM 3D de Concreta (fases E1 y E2: núcleo y barras). API pública.
 *
 * Entra un `ModeloAnalitico` y sale, por caso, un `Float64Array` de desplazamientos y otro de
 * reacciones (6 por nudo) y los esfuerzos de extremo de las barras, con diagnósticos; los
 * diagramas completos de las barras salen de `DiagramasBarras`. Los convenios de unidades, ejes y
 * signos están en la cabecera de `modelo.ts`.
 */
export { DiagramasBarras, type BarraPreparada } from "./barras.ts";
export { calcular, TOL_EQUILIBRIO, type OpcionesCalculo } from "./calcular.ts";
export type { Diagnostico, Severidad } from "./diagnosticos.ts";
export {
  NOMBRES_GDL,
  type Apoyo,
  type BarraAnalitica,
  type CargaBarra,
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
  type Seis,
  type Vec3,
} from "./modelo.ts";
export { UMBRAL_MAL_CONDICIONADO, UMBRAL_MECANISMO, type TipoSolver } from "./solucion.ts";
export { DiagramaBarra, COMPONENTES_DESPLAZAMIENTO, COMPONENTES_ESFUERZO } from "../elementos/cargasBarra.ts";
export type { ModificadoresBarra, SeccionBarra } from "../elementos/barra.ts";
