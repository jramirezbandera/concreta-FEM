// Barrel de UI (feature-9, Fase 2). Punto unico de import de la capa de interfaz
// para App y para features posteriores (F11/12/14/15). Reexporta lo publico del
// shell, el viewport y las primitivas. Idioma: API en ingles/dominio; etiquetas
// visibles en espanol con tildes (CLAUDE.md §9).

// --- Shell (cromo de la interfaz) --------------------------------------------
export {
  Shell,
  Brandbar,
  Menubar,
  Sidebar,
  ToolsRail,
  StatusBar,
  BottomTabs,
  MENUS_POR_PESTANA,
} from "./shell";
export type {
  ShellProps,
  BrandbarProps,
  StatusBarProps,
  MenuDef,
} from "./shell";

// --- Viewport (nucleo del lienzo CAD) ----------------------------------------
// Viewport + helpers de color (mismo mapeo token->hex/THREE.Color para que las
// features que inyectan geometria mantengan una sola fuente de color).
export { Viewport, colorToken, hexToken } from "./viewport";
export type { ViewportProps, NombreColor } from "./viewport";

// --- Primitivas UI (Radix-skinned, solo tokens) ------------------------------
export {
  Boton,
  Segmentado,
  PanelFlotante,
  Chip,
  Pill,
  FilaArbol,
  Campo,
  SelectUso,
} from "./primitivas";
export type {
  BotonProps,
  VarianteBoton,
  SegmentadoProps,
  OpcionSegmento,
  PanelFlotanteProps,
  ChipProps,
  PillProps,
  FilaArbolProps,
  CampoProps,
  SelectUsoProps,
} from "./primitivas";

// --- Dialogos (envoltorio Radix + dialogos concretos) ------------------------
export { Dialogo, DialogoGruposYPlantas } from "./dialogos";
export type { DialogoProps } from "./dialogos";
