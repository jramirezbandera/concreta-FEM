/**
 * Las comprobaciones de conjunto (`comprobarPilares`, `comprobarVigas`, `comprobarLosas`,
 * `comprobarPunzonamientos`), por pasos: cada una es un generador que avisa de por dónde va tras cada
 * pieza, para que quien la llama (el worker de la app) pueda decirlo y atender otra cosa entre dos
 * piezas. Las funciones de siempre son el mismo generador llevado hasta el final (`agotar`): los
 * mismos números, en el mismo orden.
 */

/** Por dónde va una comprobación de conjunto. */
export interface Paso {
  /** Qué se está haciendo, en palabras («armado de la tabla», «reglas de obra»). */
  fase: string;
  /** Piezas hechas de esta fase y las que tiene. */
  hecho: number;
  total: number;
  /** La pieza que se acaba de hacer. */
  pieza?: string;
  /** Qué se cuenta, si no son las piezas del tipo («franjas», en las demandas de una losa). */
  unidad?: string;
}

/** Lleva un generador hasta el final y da su resultado. */
export function agotar<T>(g: Generator<Paso, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
