// Barrel de la pestana Resultados (feature-14).
//
// Re-exporta solo los named exports PUBLICOS que consume App.tsx (Tarea 3.1):
// los overlays (scene/HUD) y los hooks de orquestacion. DiagramaBarra (default de
// DiagramaBarra.tsx) NO se re-exporta: es interno, vive tras la frontera de
// diagramaLazy.ts y solo lo consume PanelDiagramas (aislamiento de Plotly, #21).
export { DeformadaOverlay } from "./DeformadaOverlay";
export { LeyendaEscala } from "./LeyendaEscala";
export { LeyendaRampa } from "./LeyendaRampa";
export { PanelDiagramas } from "./PanelDiagramas";
export { TablaReacciones } from "./TablaReacciones";
export { ComboSelector } from "./ComboSelector";
export { BotonCalcular } from "./BotonCalcular";
export { useCalcular, usePrecargaMotor, calcularObra } from "./useCalcular";
export type { UseCalcular, ErrorCalculo, CalculoSink } from "./useCalcular";

// --- Isovalores (F3 corte 1, losa maciza) ------------------------------------
// Overlay del mapa de color de la losa (sceneOverlay) + panel con selector de magnitud y
// leyenda (hudOverlay). Los monta App.tsx en la pestana Isovalores. Solo se muestran si
// hay resultados de placa (quads) para la combinacion activa.
export { IsovaloresOverlay } from "./IsovaloresOverlay";
export { PanelIsovalores } from "./PanelIsovalores";

// --- Analisis modal (F2b) ----------------------------------------------------
// Overlay de la forma modal (sceneOverlay), panel de frecuencias (hudOverlay) y la
// orquestacion del camino modal. ModoOverlay/PanelFrecuencias los monta App.tsx en la
// pestana Resultados; calcularModos lo dispara tambien el menu "Calcular modos".
export { ModoOverlay } from "./ModoOverlay";
export { PanelFrecuencias } from "./PanelFrecuencias";
export {
  useSolicitarModos,
  calcularModos,
} from "./useSolicitarModos";
export type { UseSolicitarModos } from "./useSolicitarModos";
