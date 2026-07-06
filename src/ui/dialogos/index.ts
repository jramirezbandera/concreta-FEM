// Barrel de dialogos de Concreta · Estructuras. Envoltorio fino de Radix Dialog
// (Dialogo) y los dialogos concretos (DialogoPlantas, biblioteca de secciones,
// cargas...). API en ingles/dominio; etiquetas de UI en espanol con tildes
// (CLAUDE.md §9). El CSS se importa desde Dialogo.tsx.
export { Dialogo } from "./Dialogo";
export type { DialogoProps } from "./Dialogo";

// Dialogo concreto de Plantas (feature-10; sin grupos desde F3.4).
export { DialogoPlantas } from "./DialogoPlantas";

// Dialogo concreto de Hipotesis (feature-13).
export { DialogoHipotesis } from "./DialogoHipotesis";

// Dialogo concreto de Opciones de analisis (F2.4).
export { DialogoOpcionesAnalisis } from "./DialogoOpcionesAnalisis";

// Dialogo concreto de Seccion personalizada (auditoria UI/UX D3): crear seccion de
// obra de hormigon a medida. AUTO-GATEADO (lee dialogoActivo); el orquestador lo monta.
export { DialogoSeccionPersonalizada } from "./DialogoSeccionPersonalizada";

// Dialogo concreto de Datos generales (auditoria UI/UX D13): nombre de la obra. Recibe el
// id/nombre del proyecto activo por props (metadato de persistencia, no Capa 1); App lo monta.
export { DialogoDatosGenerales } from "./DialogoDatosGenerales";
export type { DialogoDatosGeneralesProps } from "./DialogoDatosGenerales";

// Seccion de cargas reutilizable por los inspectores de viga/pilar (feature-13).
export { SeccionCargas } from "./SeccionCargas";
export type { SeccionCargasProps } from "./SeccionCargas";
