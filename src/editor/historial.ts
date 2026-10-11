/**
 * Deshacer y rehacer del editor (V2a): una pila de proyectos. Cada operación deja el proyecto
 * anterior tal cual (`aplicar` no lo toca), así que deshacer devuelve el mismo objeto y, al
 * guardarlo, los mismos bytes (criterio 2 de V2a).
 *
 * Puro: sin IO.
 */
import type { Proyecto } from "../agente/proyecto.ts";

/** Pasos que se guardan para deshacer. */
export const MAX_DESHACER = 200;

export interface Historial {
  readonly actual: Proyecto;
  readonly pasado: readonly { proyecto: Proyecto; etiqueta: string }[];
  readonly futuro: readonly { proyecto: Proyecto; etiqueta: string }[];
}

export const historial = (p: Proyecto): Historial => ({ actual: p, pasado: [], futuro: [] });

/** Un paso nuevo: lo que había se puede deshacer, y lo deshecho ya no se puede rehacer. */
export function hacer(h: Historial, p: Proyecto, etiqueta: string): Historial {
  return { actual: p, pasado: [...h.pasado, { proyecto: h.actual, etiqueta }].slice(-MAX_DESHACER), futuro: [] };
}

export function deshacer(h: Historial): Historial {
  const x = h.pasado.at(-1);
  if (!x) return h;
  return { actual: x.proyecto, pasado: h.pasado.slice(0, -1), futuro: [{ proyecto: h.actual, etiqueta: x.etiqueta }, ...h.futuro] };
}

export function rehacer(h: Historial): Historial {
  const x = h.futuro[0];
  if (!x) return h;
  return { actual: x.proyecto, pasado: [...h.pasado, { proyecto: h.actual, etiqueta: x.etiqueta }], futuro: h.futuro.slice(1) };
}
