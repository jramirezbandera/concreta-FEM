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

// [D14 · PR3] Envoltorio de sección colapsable del dock (cablea el colapso a DockUIState).
export { DockSeccion } from "./DockSeccion";
export type { DockSeccionProps } from "./DockSeccion";

export { MENUS_POR_PESTANA } from "./menus";
export type { MenuDef } from "./menus";

// D2 · Exportar/Importar del menú Archivo: ArchivoIO monta la UI de importación (file
// picker, confirmación, aviso). Lo monta App una vez, como los diálogos.
export { ArchivoIO } from "./ArchivoIO";
export type { ArchivoIOProps } from "./ArchivoIO";

// Arranque de persistencia (feature-15): rehidrata y autosalva Modelo + plantillas
// del proyecto activo. Lo invoca App una vez al montar.
export { useArranquePersistencia } from "./useArranquePersistencia";

// Atajos de teclado globales (auditoria UX-A3/UX-A5): Ctrl+Z/Y undo/redo, F3/F4
// captura/plantillas. Lo monta App una vez.
export { useAtajosGlobales } from "./useAtajosGlobales";
export type {
  EstadoArranquePersistencia,
  ArranquePersistencia,
} from "./useArranquePersistencia";
