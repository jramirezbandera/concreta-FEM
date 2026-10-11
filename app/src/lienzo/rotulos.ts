/**
 * Rótulos de una escena en pantalla: la misma regla que el SVG de A4 (`escenaASvg`), en cada
 * encuadre. Por prioridad, cada texto en su posición o en la primera alternativa que no se solapa con
 * otro ya puesto ni se sale del lienzo; los que no caben se omiten y se cuentan. Al acercarse se
 * separan, así que caben más.
 */
import { anchoTexto, TEXTO_MINIMO, type Texto, type Vec2 } from "../../../src/agente/render/escena.ts";

export interface RotuloPuesto {
  t: Texto;
  x: number;
  y: number;
  ancla: "inicio" | "medio" | "fin";
  tam: number;
  /** Caja del fondo (sin girar), si lo lleva. */
  fondo: [number, number, number, number] | null;
}

/**
 * `px`: del modelo a la pantalla. `prioridadMinima`: los rótulos de menos prioridad no se intentan
 * (con muchos, ahorra el solape de miles de cajas).
 */
export function colocarRotulos(textos: readonly Texto[], px: (q: Vec2) => [number, number], ancho: number, alto: number): { puestos: RotuloPuesto[]; omitidos: number } {
  const cajas: [number, number, number, number][] = [];
  const puestos: RotuloPuesto[] = [];
  let omitidos = 0;
  const orden = textos.map((t, i) => [t, i] as const).sort((a, b) => b[0].prioridad - a[0].prioridad || a[1] - b[1]);
  for (const [t] of orden) {
    const tam = Math.max(TEXTO_MINIMO, t.tamano);
    const w = anchoTexto(t.texto, tam, t.negrita);
    const g = (-(t.giro ?? 0) * Math.PI) / 180;
    const [c, s] = [Math.cos(g), Math.sin(g)];
    let puesto = false;
    for (const pos of [{ p: t.p, dx: t.dx, dy: t.dy, ancla: t.ancla }, ...(t.alternativas ?? [])]) {
      const [a0, b0] = px(pos.p ?? t.p);
      const [ox, oy] = [pos.dx ?? 0, pos.dy ?? 0];
      const [a, b] = [a0 + ox * c - oy * s, b0 + ox * s + oy * c];
      const ancla = pos.ancla ?? "inicio";
      const xi = ancla === "inicio" ? 0 : ancla === "medio" ? -w / 2 : -w;
      const esquinas = [
        [xi - 2, -0.8 * tam],
        [xi + w + 2, -0.8 * tam],
        [xi + w + 2, 0.25 * tam],
        [xi - 2, 0.25 * tam],
      ].map(([u, v]) => [a + u! * c - v! * s, b + u! * s + v! * c] as const);
      const caja: [number, number, number, number] = [Math.min(...esquinas.map((q) => q[0])), Math.min(...esquinas.map((q) => q[1])), Math.max(...esquinas.map((q) => q[0])), Math.max(...esquinas.map((q) => q[1]))];
      if (caja[2] < 0 || caja[0] > ancho || caja[3] < 0 || caja[1] > alto) {
        // Fuera del encuadre: no se pinta, pero tampoco es un solape
        puesto = true;
        break;
      }
      if (cajas.some((q) => caja[0] < q[2] && caja[2] > q[0] && caja[1] < q[3] && caja[3] > q[1])) continue;
      cajas.push(caja);
      puestos.push({ t, x: a, y: b, ancla, tam, fondo: t.fondo ? [a + xi - 2, b - 0.8 * tam, w + 4, 1.05 * tam] : null });
      puesto = true;
      break;
    }
    if (!puesto) omitidos++;
  }
  return { puestos, omitidos };
}
