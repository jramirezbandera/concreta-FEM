// Viewport R3F base (feature-9). Punto unico de import para el shell (Fase 2) y
// para las features que inyectan geometria/overlays (F11/12/14) via el contrato de
// extension de ViewportProps. Importar el CSS (viewport.css) una vez en index.css.
export { Viewport } from "./Viewport";
export type { ViewportProps } from "./Viewport";

// Helpers de color derivados de tokens, por si una feature de UI necesita el mismo
// mapeo token->hex/THREE.Color para su propia geometria (mantiene una sola fuente).
export { colorToken, hexToken } from "./colores";
export type { NombreColor } from "./colores";

// Canal de coordenadas vivas del cursor (viewport -> barra de estado). El shell
// se suscribe y throttlea; lo reutiliza F11 para el replanteo en planta.
export { suscribirCoords, leerCoords, emitirCoords } from "./hooks/coordsBus";
export type { Coords } from "./hooks/coordsBus";
