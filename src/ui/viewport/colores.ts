// Colores del viewport derivados de los design tokens (Spec Diseno UI §1, fuente
// de verdad: src/styles/tokens.css). three.js necesita valores hex como
// THREE.Color, no CSS custom properties, por eso resolvemos cada token a un hex.
//
// ESTRATEGIA (una sola fuente de verdad): leemos el computed style de las CSS vars
// en runtime cuando hay DOM (asi un cambio de tema en tokens.css se propaga al
// lienzo sin tocar este modulo). Si no hay DOM o la var esta vacia, caemos a un
// FALLBACK hex copiado del Spec §1 (documentado token a token). El fallback evita
// que el viewport quede en negro si se monta antes de cargar el CSS o en entornos
// sin getComputedStyle.
import { Color } from "three";

// Fallback hex (Spec Diseno UI §1.1-§1.3). DEBE coincidir con tokens.css.
const FALLBACK = {
  canvas: "#eef1f6",
  canvasGrid: "#cdd6e2",
  canvasGrid2: "#aab8d0",
  canvasAxis: "#7a90b6",
  accent: "#2563eb",
  accentLine: "#4f86f0",
  pilar: "#9db2ce",
  pilarLine: "#b6c7dd",
  viga: "#c9a66b",
  vigaLine: "#ddbd87",
  node: "#c07d12",
  onAccent: "#ffffff",
} as const;

// Mapa nombre logico -> nombre de la CSS custom property (sin el prefijo --).
const VAR_NAME: Record<keyof typeof FALLBACK, string> = {
  canvas: "canvas",
  canvasGrid: "canvas-grid",
  canvasGrid2: "canvas-grid-2",
  canvasAxis: "canvas-axis",
  accent: "accent",
  accentLine: "accent-line",
  pilar: "pilar",
  pilarLine: "pilar-line",
  viga: "viga",
  vigaLine: "viga-line",
  node: "node",
  onAccent: "on-accent",
};

export type NombreColor = keyof typeof FALLBACK;

// Lee una CSS var del :root; "" si no hay DOM o no esta definida.
function leerVar(nombre: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(`--${nombre}`).trim();
}

// Resuelve un token a string hex (var en runtime o fallback del Spec).
function resolverHex(nombre: NombreColor): string {
  return leerVar(VAR_NAME[nombre]) || FALLBACK[nombre];
}

// Devuelve un THREE.Color para el token. Cachea por nombre: las CSS vars no
// cambian dentro de una sesion (no hay theming dinamico en F1) y asi evitamos
// recalcular en cada reconstruccion de geometria.
const cache = new Map<NombreColor, Color>();

export function colorToken(nombre: NombreColor): Color {
  const existente = cache.get(nombre);
  if (existente) return existente;
  const color = new Color(resolverHex(nombre));
  cache.set(nombre, color);
  return color;
}

// Variante string hex (p. ej. para props de drei que esperan string como
// GizmoViewport axisColors o el background del Canvas).
export function hexToken(nombre: NombreColor): string {
  return resolverHex(nombre);
}
