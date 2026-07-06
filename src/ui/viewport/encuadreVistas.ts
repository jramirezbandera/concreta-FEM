// encuadreVistas: encuadre PURO de los alzados de consulta (UX-1.5). Calcula la
// posicion/target/zoom de una camara ORTOGRAFICA que mira al centro del edificio
// desde -Y (alzado frontal) o desde +X (alzado lateral), con Z-up. SIN React ni
// three: testeable en Node. Hermano de boundsEdificio (que aporta la caja).
import type { BoundsEdificio } from "./boundsEdificio";

export type DireccionAlzado = "frontal" | "lateral";

export interface EncuadreAlzado {
  position: [number, number, number];
  target: [number, number, number];
  // Zoom de camara ortografica de three: pixeles por unidad de mundo.
  zoom: number;
}

// Holgura alrededor del edificio (1 = ajuste tangente) y distancia nominal de la
// camara al centro: en orto la distancia NO afecta a la escala (solo el zoom), pero
// debe dejar el edificio completo dentro de near/far.
const MARGEN = 1.15;
const DIST = 50;

// Suelo de la extension visible (m): un modelo plano (una unica planta a cota 0)
// no debe producir zoom Infinity/NaN.
const EXTENSION_MIN = 1;

export function encuadreAlzado(
  bounds: BoundsEdificio,
  dir: DireccionAlzado,
  viewport: { w: number; h: number },
): EncuadreAlzado {
  const [cx, cy, cz] = bounds.centro;
  // Lo que se ve en cada alzado: frontal (desde -Y) proyecta X (ancho) y Z (alto);
  // lateral (desde +X) proyecta Y y Z.
  const anchoMundo =
    dir === "frontal" ? bounds.max[0] - bounds.min[0] : bounds.max[1] - bounds.min[1];
  const altoMundo = bounds.max[2] - bounds.min[2];
  const w = Math.max(anchoMundo, EXTENSION_MIN);
  const h = Math.max(altoMundo, EXTENSION_MIN);
  // El zoom que hace entrar el edificio en el viewport por el eje mas restrictivo.
  const zoom = Math.min(viewport.w / (w * MARGEN), viewport.h / (h * MARGEN));
  const position: [number, number, number] =
    dir === "frontal" ? [cx, cy - DIST, cz] : [cx + DIST, cy, cz];
  return { position, target: [cx, cy, cz], zoom };
}
