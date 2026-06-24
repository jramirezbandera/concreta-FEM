// Viewport R3F base (feature-9). Punto unico de import para el shell (Fase 2) y
// para las features que inyectan geometria/overlays (F11/12/14) via el contrato de
// extension de ViewportProps. Importar el CSS (viewport.css) una vez en index.css.
export { Viewport } from "./Viewport";
export type { ViewportProps } from "./Viewport";

// Helpers de color derivados de tokens, por si una feature de UI necesita el mismo
// mapeo token->hex/THREE.Color para su propia geometria (mantiene una sola fuente).
export { colorToken, hexToken } from "./colores";
export type { NombreColor } from "./colores";

// Calco de plantillas DXF (feature-15): sceneOverlay R3F que dibuja las plantillas
// visibles de la planta activa como fondo no interactivo. Lo monta App via
// `sceneOverlays` (cableado en otra tarea).
export { OverlayPlantillas } from "./OverlayPlantillas";

// Canal de coordenadas vivas del cursor (viewport -> barra de estado). El shell
// se suscribe y throttlea; lo reutiliza F11 para el replanteo en planta.
export { suscribirCoords, leerCoords, emitirCoords } from "./hooks/coordsBus";
export type { Coords } from "./hooks/coordsBus";

// Captura PNG del viewport (feature-15, F3): API publica que dispara la descarga
// de la vista actual. La ejecuta ControlCaptura dentro de la escena. Lo cablea el
// boton F3 de la barra de herramientas (otra tarea).
export { capturarViewport, descargarPng } from "./capturarPng";
