// Barrel de dialogos de Concreta · Estructuras. Envoltorio fino de Radix Dialog
// (Dialogo) y, mas adelante, los dialogos concretos (DialogoGruposYPlantas,
// biblioteca de secciones, cargas...). API en ingles/dominio; etiquetas de UI en
// espanol con tildes (CLAUDE.md §9). El CSS se importa desde Dialogo.tsx.
export { Dialogo } from "./Dialogo";
export type { DialogoProps } from "./Dialogo";

// Dialogo concreto de Plantas y grupos (feature-10).
export { DialogoGruposYPlantas } from "./DialogoGruposYPlantas";

// Dialogo concreto de Hipotesis (feature-13).
export { DialogoHipotesis } from "./DialogoHipotesis";

// Seccion de cargas reutilizable por los inspectores de viga/pilar (feature-13).
export { SeccionCargas } from "./SeccionCargas";
export type { SeccionCargasProps } from "./SeccionCargas";
