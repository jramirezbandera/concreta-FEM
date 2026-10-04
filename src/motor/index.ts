/**
 * Motor FEM 3D de Concreta (fases E1, E2 y E3: núcleo, barras y láminas). API pública.
 *
 * Entra un `ModeloAnalitico` y sale, por caso, un `Float64Array` de desplazamientos y otro de
 * reacciones (6 por nudo), los esfuerzos de extremo de las barras y las resultantes de las
 * láminas en su centroide, con diagnósticos. Los diagramas completos de las barras salen de
 * `DiagramasBarras`, y las resultantes de lámina en cualquier punto, de `ResultantesLaminas`. Los
 * convenios de unidades, ejes y signos están en la cabecera de `modelo.ts`.
 */
export { DiagramasBarras, type BarraPreparada } from "./barras.ts";
export { ResultantesLaminas, type LaminaPreparada } from "./laminas.ts";
export { COMPONENTES_LAMINA, type MultiplicadoresLamina } from "../elementos/lamina.ts";
export type { MaterialLamina } from "../elementos/dkmq.ts";
export { calcular, TOL_EQUILIBRIO, type LimitesCalculo, type OpcionesCalculo } from "./calcular.ts";
export type { Diagnostico, Severidad } from "./diagnosticos.ts";
export {
  NOMBRES_GDL,
  type Apoyo,
  type BarraAnalitica,
  type CargaBarra,
  type CargaLamina,
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
