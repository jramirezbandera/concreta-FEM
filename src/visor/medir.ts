/**
 * Medir en una vista 2D (planta o alzado): distancias por una polilínea y áreas por un polígono.
 * Puro: la vista le da los puntos (m, en x, y de la planta o en u, z del alzado) y pinta lo que sale.
 *
 * Sin el editor (Resultados, o un alzado de Cargas) no hay índice de enganches del modelo: el punto
 * se engancha a lo dibujado (`engancharEscena`), a los vértices y puntos medios de los contornos y
 * las líneas de las piezas, los ejes y los niveles y de la plantilla DXF; no a lo que se dibuja encima
 * de ellas (cargas, diagramas, isovalores, la malla, los diagnósticos).
 */
import type { Vec2 } from "../agente/render/escena.ts";
import type { EscenaPreparada } from "./escena.ts";

export type ModoMedir = "distancia" | "area";

export interface ResultadoMedida {
  /** La longitud de cada tramo (en un área, también el de cierre). */
  tramos: number[];
  /** La suma de los tramos: la longitud de la polilínea o el perímetro. */
  total: number;
  /** Del primer punto al último (distancia). */
  dx: number;
  dy: number;
  /** El área (≥ 0) y su centroide; sólo con tres puntos o más, en un área. */
  area: number | null;
  centroide: Vec2 | null;
  /** El contorno se corta a sí mismo: el área sale con los lazos restados. */
  seCruza: boolean;
}

/** Los estilos de lo que se dibuja encima de las piezas: medir no engancha a ellos. */
const SIN_ENGANCHE = /^(carga-|peso-propio|malla|isolinea|isobanda|diagrama-|diagnostico-|extremo-|eje-burbuja|hueco-aspa|fuera-escala|sin-mapa)/;

const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** El área con signo (antihorario, positiva) de un polígono. */
export function areaConSigno(ps: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) a += ps[j]![0] * ps[i]![1] - ps[i]![0] * ps[j]![1];
  return a / 2;
}

/** El centroide de un polígono (el de sus vértices si su área es nula). */
export function centroide(ps: readonly Vec2[]): Vec2 {
  const a = areaConSigno(ps);
  if (Math.abs(a) < 1e-12) {
    const n = ps.length || 1;
    return [ps.reduce((s, p) => s + p[0], 0) / n, ps.reduce((s, p) => s + p[1], 0) / n];
  }
  // Respecto al primer vértice, para no perder cifras lejos del origen
  const [ox, oy] = ps[0]!;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const [x0, y0] = [ps[j]![0] - ox, ps[j]![1] - oy];
    const [x1, y1] = [ps[i]![0] - ox, ps[i]![1] - oy];
    const k = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  return [ox + cx / (6 * a), oy + cy / (6 * a)];
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Dos segmentos se cortan en un punto interior de los dos (sin contar los que se tocan en un extremo). */
function seCortan(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const [o1, o2, o3, o4] = [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** El polígono cerrado se corta a sí mismo (lados no consecutivos que se cruzan). */
export function poligonoSeCruza(ps: readonly Vec2[]): boolean {
  const n = ps.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const [a, b] = [ps[i]!, ps[(i + 1) % n]!];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (seCortan(a, b, ps[j]!, ps[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Lo que mide una polilínea (distancia) o un polígono (área) con sus puntos. */
export function medir(modo: ModoMedir, ps: readonly Vec2[]): ResultadoMedida {
  const tramos: number[] = [];
  for (let i = 1; i < ps.length; i++) tramos.push(dist(ps[i - 1]!, ps[i]!));
  const cerrado = modo === "area" && ps.length >= 3;
  if (cerrado) tramos.push(dist(ps[ps.length - 1]!, ps[0]!));
  const [a, b] = [ps[0], ps[ps.length - 1]];
  return {
    tramos,
    total: tramos.reduce((s, x) => s + x, 0),
    dx: a && b ? b[0] - a[0] : 0,
    dy: a && b ? b[1] - a[1] : 0,
    area: cerrado ? Math.abs(areaConSigno(ps)) : null,
    centroide: cerrado ? centroide(ps) : null,
    seCruza: cerrado && poligonoSeCruza(ps),
  };
}

/** Un enganche a lo dibujado. */
export interface EngancheEscena {
  p: Vec2;
  tipo: "vertice" | "medio" | "cercano";
}

/**
 * El punto de lo dibujado más cercano a q a menos de `radio` (m): primero los vértices, luego los
 * puntos medios y luego el punto más cercano de una línea. Con `plantilla`, también sus segmentos
 * (x, y, z por vértice, respecto a su origen).
 */
export function engancharEscena(e: EscenaPreparada | null, q: Vec2, radio: number, plantilla?: { posiciones: Float32Array; origen: Vec2 } | null): EngancheEscena | null {
  let vert: { p: Vec2; d: number } | null = null;
  let medio: { p: Vec2; d: number } | null = null;
  let cerca: { p: Vec2; d: number } | null = null;
  const r2 = radio * radio;
  const segmento = (x0: number, y0: number, x1: number, y1: number) => {
    // Fuera de la caja del segmento ampliada con el radio, nada
    if (q[0] < Math.min(x0, x1) - radio || q[0] > Math.max(x0, x1) + radio || q[1] < Math.min(y0, y1) - radio || q[1] > Math.max(y0, y1) + radio) return;
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
    ] as const) {
      const d = (x - q[0]) ** 2 + (y - q[1]) ** 2;
      if (d <= r2 && (!vert || d < vert.d)) vert = { p: [x, y], d };
    }
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const dm = (mx - q[0]) ** 2 + (my - q[1]) ** 2;
    if (dm <= r2 && (!medio || dm < medio.d)) medio = { p: [mx, my], d: dm };
    const [ux, uy] = [x1 - x0, y1 - y0];
    const l2 = ux * ux + uy * uy;
    if (l2 > 0) {
      const t = Math.max(0, Math.min(1, ((q[0] - x0) * ux + (q[1] - y0) * uy) / l2));
      const [cx, cy] = [x0 + t * ux, y0 + t * uy];
      const dc = (cx - q[0]) ** 2 + (cy - q[1]) ** 2;
      if (dc <= r2 && (!cerca || dc < cerca.d)) cerca = { p: [cx, cy], d: dc };
    }
  };
  if (e) {
    const [ox, oy] = e.origen;
    for (const c of e.capas) {
      if (c.forma === "region" || SIN_ENGANCHE.test(c.estilo)) continue;
      const s = c.segmentos;
      // Fuera de la caja de la capa, nada
      if (q[0] < ox + c.caja[0] - radio || q[0] > ox + c.caja[2] + radio || q[1] < oy + c.caja[1] - radio || q[1] > oy + c.caja[3] + radio) continue;
      for (let i = 0; i + 3 < s.length; i += 4) segmento(ox + s[i]!, oy + s[i + 1]!, ox + s[i + 2]!, oy + s[i + 3]!);
    }
  }
  if (plantilla) {
    const [ox, oy] = plantilla.origen;
    const s = plantilla.posiciones;
    for (let i = 0; i + 5 < s.length; i += 6) segmento(ox + s[i]!, oy + s[i + 1]!, ox + s[i + 3]!, oy + s[i + 4]!);
  }
  const v = vert as { p: Vec2 } | null;
  const m = medio as { p: Vec2 } | null;
  const c = cerca as { p: Vec2 } | null;
  if (v) return { p: limpio(v.p), tipo: "vertice" };
  if (m) return { p: limpio(m.p), tipo: "medio" };
  if (c) return { p: limpio(c.p), tipo: "cercano" };
  return null;
}

/** Lo dibujado va en Float32 respecto al origen: el punto se redondea a 0,1 mm (sus cifras de más son ruido). */
const limpio = (p: Vec2): Vec2 => [Math.round(p[0] * 1e4) / 1e4 + 0, Math.round(p[1] * 1e4) / 1e4 + 0];
