// Barrel de la pestana Resultados (feature-14).
//
// Re-exporta solo los named exports PUBLICOS que consume App.tsx (Tarea 3.1):
// los overlays (scene/HUD) y los hooks de orquestacion. DiagramaBarra (default de
// DiagramaBarra.tsx) NO se re-exporta: es interno, vive tras la frontera de
// diagramaLazy.ts y solo lo consume PanelDiagramas (aislamiento de Plotly, #21).
export { DeformadaOverlay } from "./DeformadaOverlay";
export { LeyendaEscala } from "./LeyendaEscala";
// --- Diagramas de esfuerzos sobre las barras (N/V/M en escena) -----------------
// Overlay de escena (cinta rellena + contorno + rotulos de pico por elemento),
// leyenda con selector de magnitud y tamano, y conmutador Deformada|Esfuerzos.
// Los monta App.tsx en la pestana Resultados (sceneOverlays / Slot mid-right).
export { EsfuerzosOverlay } from "./EsfuerzosOverlay";
export { LeyendaEsfuerzos } from "./LeyendaEsfuerzos";
export { SelectorOverlayResultados } from "./SelectorOverlayResultados";
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
// [D10] Rampa de color de los isovalores como leyenda de LIENZO (glass, vertical, Slot
// mid-right): misma ubicacion/orientacion que la leyenda de la deformada. La monta App.tsx
// en la pestana Isovalores (hudOverlays).
export { LeyendaIsovalores } from "./LeyendaIsovalores";

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
