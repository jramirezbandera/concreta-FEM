/**
 * Estaciones de una banda de dimensionado (C5.2): dónde se cortan sus esfuerzos a lo largo del eje.
 * - Caras: los extremos de sus `apoyos` dentro de la banda (no en sus extremos). El compilador las
 *   siembra a lo ancho de la banda, así que su corte por fuerzas nodales es exacto (E5-5).
 * - Vanos: el centro de cada tramo libre entre dos apoyos consecutivos.
 * Sin apoyos, una banda no tiene estaciones (sólo se siembra su contorno, C2).
 */
import type { Banda, Vec2 } from "./fisico.ts";

export interface EstacionBanda {
  /** Distancia a lo largo del eje desde `desde`, m. */
  s: number;
  tipo: "cara" | "vano";
}

/** Ejes de la banda: d a lo largo (de `desde` a `hasta`), n = d girado 90° (a su izquierda), y su longitud. */
export function ejesBanda(b: Banda): { d: Vec2; n: Vec2; L: number } {
  const dx = b.hasta[0] - b.desde[0];
  const dy = b.hasta[1] - b.desde[1];
  const L = Math.sqrt(dx * dx + dy * dy);
  return { d: [dx / L, dy / L], n: [-dy / L, dx / L], L };
}

/** Punto del eje de la banda a la distancia s de `desde`. */
export function puntoBanda(b: Banda, s: number): Vec2 {
  const { d } = ejesBanda(b);
  return [b.desde[0] + s * d[0], b.desde[1] + s * d[1]];
}

/** Segmento a lo ancho de la banda en la estación s (de su lado −n a su lado +n). */
export function ladoEstacion(b: Banda, s: number): Vec2[] {
  const { n } = ejesBanda(b);
  const P = puntoBanda(b, s);
  const h = b.ancho / 2;
  return [
    [P[0] - h * n[0], P[1] - h * n[1]],
    [P[0] + h * n[0], P[1] + h * n[1]],
  ];
}

/** Estaciones de la banda, ordenadas por s (las caras que coinciden, una vez). */
export function estacionesBanda(b: Banda, eps: number): EstacionBanda[] {
  const { L } = ejesBanda(b);
  const apoyos = [...(b.apoyos ?? [])].map(([a, c]) => [Math.max(0, a), Math.min(L, c)] as const).sort((x, y) => x[0] - y[0]);
  if (!apoyos.length) return [];
  // Unión de los tramos que se solapan
  const unidos: [number, number][] = [];
  for (const [a, c] of apoyos) {
    const u = unidos[unidos.length - 1];
    if (u && a <= u[1] + eps) u[1] = Math.max(u[1], c);
    else unidos.push([a, c]);
  }
  const r: EstacionBanda[] = [];
  const dentro = (s: number) => s > eps && s < L - eps;
  unidos.forEach(([a, c], i) => {
    if (dentro(a)) r.push({ s: a, tipo: "cara" });
    if (dentro(c) && c - a > eps) r.push({ s: c, tipo: "cara" });
    const sig = unidos[i + 1];
    if (sig && sig[0] - c > eps) r.push({ s: (c + sig[0]) / 2, tipo: "vano" });
  });
  return r.sort((x, y) => x.s - y.s);
}
