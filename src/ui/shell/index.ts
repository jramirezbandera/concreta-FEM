// Barrel del shell (cromo de la interfaz) de Concreta · Estructuras (feature-9).
// Punto de import para la Fase 2 (App ensambla Shell + Viewport). Componentes y
// props en ingles/dominio; etiquetas visibles en espanol con tildes (CLAUDE §9).
export { Shell } from "./Shell";
export type { ShellProps } from "./Shell";

// Subcomponentes y tipos auxiliares expuestos por si una feature posterior los
// necesita por separado (p. ej. inyectar StatusBar con su API en otra pantalla).
export { Brandbar } from "./Brandbar";
export type { BrandbarProps } from "./Brandbar";
export { Menubar } from "./Menubar";
export { Sidebar } from "./Sidebar";
export { ToolsRail } from "./ToolsRail";
export { StatusBar } from "./StatusBar";
export type { StatusBarProps } from "./StatusBar";
export { BottomTabs } from "./BottomTabs";

export { MENUS_POR_PESTANA } from "./menus";
export type { MenuDef } from "./menus";

// Arranque de persistencia (feature-15): rehidrata y autosalva Modelo + plantillas
// del proyecto activo. Lo invoca App una vez al montar.
export { useArranquePersistencia } from "./useArranquePersistencia";
