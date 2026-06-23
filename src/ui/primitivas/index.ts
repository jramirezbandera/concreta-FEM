// Primitivas UI Radix-skinned de Concreta · Estructuras (feature-9, Fase 0).
// Componentes reutilizables estilados SOLO con tokens (clases .cx-*; ver
// primitivas.css). Etiquetas de UI en espanol con tildes; API en ingles/dominio
// segun CLAUDE.md §9. Importar el CSS una vez en index.css.
export { Boton } from "./Boton";
export type { BotonProps, VarianteBoton } from "./Boton";

export { Segmentado } from "./Segmentado";
export type { SegmentadoProps, OpcionSegmento } from "./Segmentado";

export { PanelFlotante } from "./PanelFlotante";
export type { PanelFlotanteProps } from "./PanelFlotante";

export { Chip, Pill } from "./Chip";
export type { ChipProps, PillProps } from "./Chip";

export { FilaArbol } from "./FilaArbol";
export type { FilaArbolProps } from "./FilaArbol";

export { Campo } from "./Campo";
export type { CampoProps } from "./Campo";

export { CampoNumero } from "./CampoNumero";
export type { CampoNumeroProps } from "./CampoNumero";

export { SelectUso } from "./SelectUso";
export type { SelectUsoProps } from "./SelectUso";

export { SelectSeccion } from "./SelectSeccion";
export type { SelectSeccionProps } from "./SelectSeccion";

export { SelectMaterial } from "./SelectMaterial";
export type { SelectMaterialProps } from "./SelectMaterial";

export { SelectHipotesis } from "./SelectHipotesis";
export type { SelectHipotesisProps } from "./SelectHipotesis";
