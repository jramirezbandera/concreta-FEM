/**
 * Rótulos de una escena en pantalla (I2, `docs/fem3d/interfaz.md` §8 y §14): la regla del SVG de A4
 * (`escenaASvg`) en cada encuadre, con el zoom.
 *
 * - Qué se intenta: los de clase `eje` y `dato` (y los que no tienen clase), siempre; las cotas,
 *   desde ESCALA_COTAS px/m; los ids y las secciones, desde ESCALA_IDS px/m o si su objeto está
 *   elegido.
 * - Por prioridad (lo elegido primero, después la de A4), cada texto en su posición o en la primera
 *   alternativa que no se solapa con otro ya puesto; los que no caben se omiten y se cuentan. Al
 *   acercarse se separan, así que caben más.
 * - Los solapes se buscan en una rejilla de celdas de CELDA px, para no comparar cada caja con
 *   todas en cada fotograma.
 */
import { TEXTO_MINIMO, type Texto, type Vec2 } from "../../../src/agente/render/escena.ts";

export const ESCALA_COTAS = 10;
export const ESCALA_IDS = 40;
const CELDA = 64;

export interface RotuloPuesto {
  t: Texto;
  x: number;
  y: number;
  ancla: "inicio" | "medio" | "fin";
  tam: number;
  /** Caja del fondo (sin girar), si lo lleva. */
  fondo: [number, number, number, number] | null;
}

/** ¿Se intenta este rótulo con esta escala (px/m)? */
export function visible(t: Texto, escala: number, elegidos: ReadonlySet<string>): boolean {
  if (t.clase === "id") return escala >= ESCALA_IDS || (t.objeto !== undefined && elegidos.has(t.objeto));
  if (t.clase === "cota") return escala >= ESCALA_COTAS;
  return true;
}

/**
 * `px`: del modelo a la pantalla. `medir`: el ancho de un texto en px con su fuente. Devuelve los
 * puestos y cuántos de los que se intentaron no cupieron.
 */
export function colocarRotulos(textos: readonly Texto[], px: (q: Vec2) => [number, number], ancho: number, alto: number, medir: (texto: string, tam: number, negrita: boolean) => number, escala: number, elegidos: ReadonlySet<string> = new Set()): { puestos: RotuloPuesto[]; omitidos: number } {
  const rejilla = new Map<number, [number, number, number, number][]>();
  const clave = (i: number, j: number) => i * 100003 + j;
  const celdas = (c: readonly [number, number, number, number]) => {
    const r: number[] = [];
    for (let i = Math.floor(c[0] / CELDA); i <= Math.floor(c[2] / CELDA); i++) for (let j = Math.floor(c[1] / CELDA); j <= Math.floor(c[3] / CELDA); j++) r.push(clave(i, j));
    return r;
  };
  const solapa = (c: readonly [number, number, number, number]) => celdas(c).some((k) => rejilla.get(k)?.some((q) => c[0] < q[2] && c[2] > q[0] && c[1] < q[3] && c[3] > q[1]));
  const guardar = (c: [number, number, number, number]) => {
    for (const k of celdas(c)) {
      const l = rejilla.get(k);
      if (l) l.push(c);
      else rejilla.set(k, [c]);
    }
  };
  const puestos: RotuloPuesto[] = [];
  let omitidos = 0;
  const prioridad = (t: Texto) => t.prioridad + (t.objeto !== undefined && elegidos.has(t.objeto) ? 1000 : 0);
  const orden = textos
    .map((t, i) => [t, i] as const)
    .filter(([t]) => visible(t, escala, elegidos))
    .sort((a, b) => prioridad(b[0]) - prioridad(a[0]) || a[1] - b[1]);
  for (const [t] of orden) {
    const tam = Math.max(TEXTO_MINIMO, t.tamano);
    const w = medir(t.texto, tam, !!t.negrita);
    const g = (-(t.giro ?? 0) * Math.PI) / 180;
    const [c, s] = [Math.cos(g), Math.sin(g)];
    let puesto = false;
    for (const pos of [{ p: t.p, dx: t.dx, dy: t.dy, ancla: t.ancla }, ...(t.alternativas ?? [])]) {
      const [a0, b0] = px(pos.p ?? t.p);
      const [ox, oy] = [pos.dx ?? 0, pos.dy ?? 0];
      const [a, b] = [a0 + ox * c - oy * s, b0 + ox * s + oy * c];
      const ancla = pos.ancla ?? "inicio";
      const xi = ancla === "inicio" ? 0 : ancla === "medio" ? -w / 2 : -w;
      let caja: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [u, v] of [
        [xi - 2, -0.8 * tam],
        [xi + w + 2, -0.8 * tam],
        [xi + w + 2, 0.25 * tam],
        [xi - 2, 0.25 * tam],
      ] as const) {
        const [x, y] = [a + u * c - v * s, b + u * s + v * c];
        caja = [Math.min(caja[0], x), Math.min(caja[1], y), Math.max(caja[2], x), Math.max(caja[3], y)];
      }
      if (caja[2] < 0 || caja[0] > ancho || caja[3] < 0 || caja[1] > alto) {
        // Fuera del encuadre: no se pinta, pero tampoco es un solape
        puesto = true;
        break;
      }
      if (solapa(caja)) continue;
      guardar(caja);
      puestos.push({ t, x: a, y: b, ancla, tam, fondo: t.fondo ? [a + xi - 2, b - 0.8 * tam, w + 4, 1.05 * tam] : null });
      puesto = true;
      break;
    }
    if (!puesto) omitidos++;
  }
  return { puestos, omitidos };
}
