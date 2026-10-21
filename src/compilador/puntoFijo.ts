/**
 * Punto fijo de los pilares (fase PF, `docs/fem3d/punto-fijo.md`), como en CYPECAD: el punto (x, y)
 * de un pilar es un punto de su sección que no se mueve entre plantas (el centro, el centro de un
 * lado o una esquina), y la sección de cada tramo crece desde él. Si la sección cambia, el eje (el
 * centro de la sección) cambia de un tramo a otro, y esa excentricidad la lleva un offset rígido en
 * la base del tramo de encima (`piezas.ts`).
 *
 * Los lados se nombran en los ejes de la sección girados con ella: «derecha», según el canto h (z
 * local, `giro` desde +X), y «superior», 90° más allá (−y local). Con giro 0, derecha es +X y
 * superior, +Y, como la vista en planta de CYPECAD. El rectángulo es la huella de la sección (`b` × `h`;
 * en una T, `bf` × `h`; en un perfil I, `b` × `h`); en una circular, el cuadrado de lado D.
 *
 * Sin `fijo`, o con "centro", el eje es (x, y) tal cual (los mismos bits de antes de PF). Con un giro
 * que no es múltiplo de 90°, el eje sale del seno y el coseno del giro (COM-12: puede diferir en un
 * ulp entre motores de JavaScript; la numeración canónica lo absorbe).
 */
import type { PuntoFijo, Seccion, Vec2 } from "./fisico.ts";
import type { FormaHuella } from "./secciones.ts";

export type { PuntoFijo };

/** Dónde está el punto fijo en la huella: [u según el canto (+1, derecha), v a 90° (+1, superior)]. */
export const SIGNOS_PUNTO_FIJO: Readonly<Record<PuntoFijo, readonly [number, number]>> = {
  centro: [0, 0],
  "mitad-derecha": [1, 0],
  "mitad-izquierda": [-1, 0],
  "mitad-superior": [0, 1],
  "mitad-inferior": [0, -1],
  "esquina-superior-derecha": [1, 1],
  "esquina-superior-izquierda": [-1, 1],
  "esquina-inferior-derecha": [1, -1],
  "esquina-inferior-izquierda": [-1, -1],
};

export const PUNTOS_FIJOS = Object.keys(SIGNOS_PUNTO_FIJO) as readonly PuntoFijo[];

/** Lo que hace falta de un pilar: su punto, su giro y su punto fijo. */
export interface PilarFijo {
  x: number;
  y: number;
  giro?: number;
  fijo?: PuntoFijo;
}

/** Medidas de la huella según el canto (h) y a 90° (b); null si la sección no las da. */
export type MedidasHuella = { h: number; b: number } | null;

export const medidasForma = (f: FormaHuella | null): MedidasHuella => (!f ? null : f.tipo === "circulo" ? { h: f.D, b: f.D } : { h: f.h, b: f.b });

/** El pilar tiene un punto fijo que no es el centro. */
export const conPuntoFijo = (p: PilarFijo): boolean => p.fijo !== undefined && p.fijo !== "centro";

/**
 * Eje (centro de la sección) de un tramo de pilar con la huella de medidas `m`. Sin punto fijo, o
 * con el centro, o sin medidas (un error de `validar`), el punto (x, y) del pilar.
 */
export function ejePilar(p: PilarFijo, m: MedidasHuella): Vec2 {
  if (!conPuntoFijo(p) || !m) return [p.x, p.y];
  const [u, v] = SIGNOS_PUNTO_FIJO[p.fijo!];
  if (u === 0 && v === 0) return [p.x, p.y];
  // Los giros múltiplos de 90° son exactos, como en `huellaPilar`
  const giro = p.giro ?? 0;
  const g = (((giro % 360) + 360) % 360) / 90;
  let c: number;
  let s: number;
  if (Number.isInteger(g)) [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][g]! as [number, number];
  else [c, s] = [Math.cos((giro * Math.PI) / 180), Math.sin((giro * Math.PI) / 180)];
  // Del punto fijo al centro: −u·h/2 según el canto (c, s) y −v·b/2 según (−s, c)
  const du = (-u * m.h) / 2;
  const dv = (-v * m.b) / 2;
  return [p.x + du * c - dv * s, p.y + du * s + dv * c];
}

/**
 * Medidas de la huella de una sección física, las de `compilarSeccion` (en una T, bf × h; en un
 * perfil I, b × h en mm; en una general, b × h si las da); null si no se conocen.
 */
export function medidasSeccion(s: Seccion | undefined): MedidasHuella {
  if (!s) return null;
  if (s.forma === "circular") return s.D > 0 ? { h: s.D, b: s.D } : null;
  const [b, h] =
    s.forma === "rectangular" ? [s.b, s.h] : s.forma === "T" ? [s.bf, s.h] : s.forma === "I" ? [s.perfil.b * 1e-3, s.perfil.h * 1e-3] : s.b !== undefined && s.h !== undefined ? [s.b, s.h] : [0, 0];
  return b > 0 && h > 0 ? { h, b } : null;
}

/** Eje en planta de un tramo de pilar con la sección física s: el centro de su sección. */
export const ejeSeccion = (p: PilarFijo, s: Seccion | undefined): Vec2 => ejePilar(p, medidasSeccion(s));
