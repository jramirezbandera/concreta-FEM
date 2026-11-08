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
  losa: { fill: "#1d2430", stroke: "#6b7686", sw: 1.2 },
  "losa-reticular": { fill: "#1c2a1f", stroke: "#5f7f63", sw: 1 },
  abaco: { fill: "#2e4532", stroke: "#7da682", sw: 1 },
  "abaco-relleno": { fill: "#2e4532" },
  "abaco-borde": { stroke: "#7da682", sw: 1 },
  pano: { fill: "#2b2518", stroke: "#a08a5e", sw: 1 },
  "forjado-direccion": { stroke: "#9cc3a0", sw: 1.6 },
  nervio: { stroke: "#4c6a45", sw: 0.7 },
  viga: { fill: "#3a4350", stroke: "#a3adba", sw: 0.8 },
  "hueco-aspa": { stroke: "#6b7686", sw: 0.8 },
  eje: { stroke: "#6b7686", sw: 0.8, dash: "14 3 2 3" },
  "eje-burbuja": { fill: "#0c0c0e", stroke: "#a3adba", sw: 1.2 },
  cota: { stroke: "#8b95a3", sw: 0.8 },
  nivel: { stroke: "#4b5563", sw: 0.8 },
  "pilar-alzado": { fill: "#2a313b", stroke: "#d4d6db", sw: 1 },
  "viga-alzado": { fill: "#3a4350", stroke: "#a3adba", sw: 0.8 },
  "muro-alzado": { fill: "#323a45", stroke: "#c5ccd5", sw: 0.8 },
  "losa-cortada": { fill: "#8a94a1", stroke: "#c5ccd5", sw: 0.8 },
  "pano-cortado": { fill: "#a08a5e", stroke: "#c9b48a", sw: 0.8 },
  "seccion-cortada": { fill: "#d4d6db", stroke: "#d4d6db", sw: 0.8 },
  "eje-pilar": { stroke: "#d4d6db", sw: 2 },
  "eje-viga": { fill: "#a3adba", stroke: "#a3adba", sw: 2 },
  "muro-alambrico": { stroke: "#c5ccd5", sw: 1.2 },
  "losa-alambrico": { stroke: "#8a94a1", sw: 2.4 },
  "pano-alambrico": { stroke: "#c9b48a", sw: 2.4 },
  "barra-analitica": { stroke: "#60a5fa", sw: 2 },
  "zona-rigida": { stroke: "#fb923c", sw: 4.5 },
  articulacion: { fill: "#0c0c0e", stroke: "#60a5fa", sw: 1.6 },
  semiempotrado: { fill: "#0c0c0e", stroke: "#a78bfa", sw: 1.6 },
  "nudo-analitico": { fill: "#fafafa", stroke: "#fafafa", sw: 1 },
  "lamina-analitica": { stroke: "#5b6575", sw: 0.7 },
  "lamina-cortada": { stroke: "#2dd4bf", sw: 2 },
  "enlace-rigido": { stroke: "#fb923c", sw: 1, dash: "4 3" },
  vigueta: { stroke: "#b49a68", sw: 1.4 },
  barra: { stroke: "#38bdf8", sw: 2, dash: "8 4" },
  "barra-alzado": { stroke: "#38bdf8", sw: 3 },
  "pilar-llega": { fill: "#d4d6db", stroke: "#d4d6db", sw: 1 },
  "pilar-arranca": { fill: "#0c0c0e", stroke: "#d4d6db", sw: 1.6 },
  "muro-llega": { fill: "#8a94a1", stroke: "#c5ccd5", sw: 0.8 },
  "muro-arranca": { fill: "#0c0c0e", stroke: "#c5ccd5", sw: 1.4, dash: "5 3" },
  "muro-hueco": { fill: "#0c0c0e", stroke: "#fb923c", sw: 1.6 },
  apoyo: { fill: "#2dd4bf", stroke: "#2dd4bf", sw: 1 },
  "apoyo-lineal": { stroke: "#2dd4bf", sw: 3.5 },
  atenuado: { fill: "#1a1d23", stroke: "#3a404a", sw: 0.8 },
  "atenuado-linea": { stroke: "#3a404a", sw: 1 },
  "peso-propio": { fill: "#9ca3af", stroke: "#9ca3af", sw: 1, dash: "6 4", opacity: 0.1 },
  "peso-propio-linea": { stroke: "#9ca3af", sw: 2.5, dash: "6 4" },
  malla: { fill: "#12151a", stroke: "#5b6575", sw: 0.6 },
  "malla-abaco": { fill: "#1c2a1f", stroke: "#5b6575", sw: 0.6 },
  "malla-rigida": { fill: "#4b5563", stroke: "#9ca3af", sw: 0.6 },
  "malla-encima": { stroke: "#94a3b8", sw: 0.5 },
  "malla-nudo-barra": { fill: "#f59e0b", stroke: "#f59e0b", sw: 1 },
  "sin-mapa": { fill: "#2a2e35", stroke: "#4b5563", sw: 0.6 },
  contorno: { stroke: "#cbd5e1", sw: 1.2 },
  "diagrama-eje": { stroke: "#9ca3af", sw: 1 },
  "extremo-maximo": { fill: "#0c0c0e", stroke: "#fafafa", sw: 2 },
  "extremo-minimo": { fill: "#fafafa", stroke: "#fafafa", sw: 2 },
  "valor-pilar": { fill: "#d4d6db", stroke: "#d4d6db", sw: 1 },
  "armado-cubierto": { fill: "#2a2e35" },
  "zona-refuerzo": { stroke: "#f8fafc", sw: 1.8 },
};

export function pintura(estilo: Estilo, tema: Theme): Pintura {
  return (tema === "dark" ? OSCURO[estilo] : undefined) ?? ESTILOS[estilo];
}

const cacheOscuro = new Map<string, string>();

/**
 * R-28: el color de un dato (una banda de un mapa, una zona) en el tema: en el claro, el de
 * `fem render`; en el oscuro, con la luminosidad subida de L a 0,3 + 0,7·L (mismo tono y
 * saturación, el mismo orden): los extremos de la rampa (#67001f, #053061) se perdían en el fondo
 * casi negro. Sólo los colores en hexadecimal de 6 cifras; los demás, tal cual.
 */
export function rellenoTema(color: string, tema: Theme): string {
  if (tema !== "dark" || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ya = cacheOscuro.get(color);
  if (ya) return ya;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
  const [mx, mn] = [Math.max(r, g, b), Math.min(r, g, b)];
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l2 = 0.3 + 0.7 * l;
  const c = (1 - Math.abs(2 * l2 - 1)) * sat;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l2 - c / 2;
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const t = `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
  cacheOscuro.set(color, t);
  return t;
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
