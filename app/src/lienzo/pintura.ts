/**
 * Pintura de los estilos de las escenas de A4 en el visor. En el tema claro es la misma de
 * `fem render` (`ESTILOS` de `src/agente/render/svg.ts`); en el oscuro se cambian los neutros (losas,
 * vigas, pilares, contornos), que sobre negro no se verían, y se deja todo lo que es dato: las
 * bandas de isovalores, los diagramas y las cargas.
 */
import { ESTILOS, type Pintura } from "../../../src/agente/render/svg.ts";
import type { Estilo } from "../../../src/agente/render/escena.ts";
import type { Theme } from "../tema/types.ts";

const OSCURO: Partial<Record<Estilo, Pintura>> = {
  losa: { fill: "#1d2430", stroke: "#6b7686", sw: 1 },
  "losa-reticular": { fill: "#1c2a1f", stroke: "#5f7f63", sw: 1 },
  abaco: { fill: "#2e4532", stroke: "#7da682", sw: 1 },
  pano: { fill: "#2b2518", stroke: "#a08a5e", sw: 1 },
  viga: { fill: "#4f5966", stroke: "#a3adba", sw: 0.8 },
  vigueta: { stroke: "#b49a68", sw: 1.4 },
  "pilar-llega": { fill: "#d4d6db", stroke: "#d4d6db", sw: 1 },
  "pilar-arranca": { fill: "#0c0c0e", stroke: "#d4d6db", sw: 1.6 },
  "muro-llega": { fill: "#8a94a1", stroke: "#c5ccd5", sw: 0.8 },
  "muro-arranca": { fill: "#0c0c0e", stroke: "#c5ccd5", sw: 1.4, dash: "5 3" },
  "muro-hueco": { fill: "#0c0c0e", stroke: "#fb923c", sw: 1.6 },
  atenuado: { fill: "#1a1d23", stroke: "#3a404a", sw: 0.8 },
  "atenuado-linea": { stroke: "#3a404a", sw: 1 },
  malla: { fill: "#12151a", stroke: "#5b6575", sw: 0.6 },
  "malla-abaco": { fill: "#1c2a1f", stroke: "#5b6575", sw: 0.6 },
  "malla-rigida": { fill: "#4b5563", stroke: "#9ca3af", sw: 0.6 },
  "sin-mapa": { fill: "#2a2e35", stroke: "#4b5563", sw: 0.6 },
  contorno: { stroke: "#cbd5e1", sw: 1.2 },
  "diagrama-eje": { stroke: "#9ca3af", sw: 1 },
  "extremo-maximo": { fill: "#0c0c0e", stroke: "#fafafa", sw: 2 },
  "extremo-minimo": { fill: "#fafafa", stroke: "#fafafa", sw: 2 },
  "valor-pilar": { fill: "#d4d6db", stroke: "#d4d6db", sw: 1 },
};

export function pintura(estilo: Estilo, tema: Theme): Pintura {
  return (tema === "dark" ? OSCURO[estilo] : undefined) ?? ESTILOS[estilo];
}

/** Atributos SVG (de React) de una pintura; `relleno` sustituye al del estilo. */
export function atributos(p: Pintura, relleno?: string): Record<string, string | number> {
  const fill = relleno ?? p.fill;
  const a: Record<string, string | number> = { fill: fill ?? "none" };
  if (p.stroke) {
    a.stroke = p.stroke;
    a.strokeWidth = p.sw ?? 1;
    a.strokeLinejoin = "round";
  }
  if (p.dash) a.strokeDasharray = p.dash;
  if (p.opacity !== undefined) a.fillOpacity = p.opacity;
  return a;
}
