/**
 * Escena de un render (A4, `docs/fem3d/agente.md` §10): lo que se dibuja de una planta en una vista,
 * como primitivas en coordenadas del modelo (m, X a la derecha e Y hacia arriba) con su estilo y el
 * objeto físico del que salen. `svg.ts` la encuadra y la escribe; la CLI la pasa a PNG.
 *
 * Todo número rotulado sale de una consulta (A1 o C5) y va también en `extremos`, para que el agente
 * lo cite del JSON y nunca lo lea de la imagen. Las primitivas guardan su geometría exacta para que
 * los tests comparen la escena con el modelo (criterio 1 de A4).
 *
 * Puro: sin IO.
 */
import type { Vec2 } from "../../compilador/fisico.ts";

export type { Vec2 };

/** Estilos de las primitivas (`svg.ts` los traduce a atributos). */
export type Estilo =
  | "losa"
  | "losa-reticular"
  | "abaco"
  | "abaco-relleno"
  | "abaco-borde"
  | "pano"
  | "pano-viguetas"
  | "viga"
  | "vigueta"
  | "pilar-llega"
  | "pilar-arranca"
  | "muro-llega"
  | "muro-arranca"
  | "muro-hueco"
  | "apoyo"
  | "apoyo-lineal"
  | "banda"
  | "hueco-aspa"
  | "eje"
  | "eje-burbuja"
  | "cota"
  | "nivel"
  | "pilar-alzado"
  | "viga-alzado"
  | "muro-alzado"
  | "losa-cortada"
  | "pano-cortado"
  | "seccion-cortada"
  | "eje-pilar"
  | "eje-viga"
  | "muro-alambrico"
  | "losa-alambrico"
  | "pano-alambrico"
  | "barra-analitica"
  | "zona-rigida"
  | "articulacion"
  | "semiempotrado"
  | "nudo-analitico"
  | "lamina-analitica"
  | "lamina-cortada"
  | "enlace-rigido"
  | "carga-superficie"
  | "carga-lineal"
  | "carga-puntual"
  | "carga-pieza"
  | "carga-banda-lineal"
  | "carga-banda-pieza"
  | "atenuado"
  | "atenuado-linea"
  | "diagnostico-error"
  | "diagnostico-aviso"
  | "malla"
  | "malla-abaco"
  | "malla-rigida"
  | "malla-barra"
  | "malla-encima"
  | "malla-nudo-barra"
  | "sin-mapa"
  | "isobanda"
  | "isolinea"
  | "isolinea-cero"
  | "fuera-escala"
  | "contorno"
  | "diagrama-positivo"
  | "diagrama-negativo"
  | "diagrama-eje"
  | "extremo-maximo"
  | "extremo-minimo"
  | "valor-pilar"
  | "reaccion-vertical"
  | "reaccion-horizontal"
  | "armado-cubierto"
  | "zona-refuerzo";

export type Primitiva =
  /** Polígono con huecos: el primer anillo es el contorno (relleno par-impar). `relleno` sustituye al del estilo. */
  | { tipo: "poligono"; anillos: Vec2[][]; estilo: Estilo; objeto?: string; relleno?: string }
  /** Varios anillos con la regla «nonzero»: las bandas de isovalores fundidas (`isovalores.ts`). */
  | { tipo: "region"; anillos: Vec2[][]; estilo: Estilo; relleno: string; banda: number }
  /** `rotulo`: un texto que se repite a lo largo de la línea (el valor de una isolínea), colocado con la escala de cada dibujo (`rotulosLineas`). */
  | { tipo: "linea"; puntos: Vec2[]; estilo: Estilo; objeto?: string; rotulo?: string }
  /** Marca de tamaño fijo en píxeles en un punto del modelo. */
  | { tipo: "marca"; p: Vec2; forma: "circulo" | "cuadrado" | "triangulo"; radio: number; estilo: Estilo; objeto?: string }
  /**
   * Flecha de tamaño fijo en píxeles: sale del punto en la dirección (dx, dy) del modelo (una carga
   * horizontal) o, sin dirección, es un círculo con un punto (vertical, hacia abajo) o con una cruz (hacia arriba).
   */
  | { tipo: "flecha"; p: Vec2; d: Vec2 | null; abajo?: boolean; estilo: Estilo; objeto?: string }
  | Texto;

export interface Texto {
  tipo: "texto";
  p: Vec2;
  texto: string;
  /** px; nunca menos de TEXTO_MINIMO. */
  tamano: number;
  /** Desplazamiento en px desde el punto (x a la derecha, y hacia abajo), en los ejes del texto girado. */
  dx?: number;
  dy?: number;
  ancla?: "inicio" | "medio" | "fin";
  /** Giro en grados (antihorario en el modelo), para rotular a lo largo de una pieza. */
  giro?: number;
  negrita?: boolean;
  /** Mayor, antes: los rótulos que se solapan con otro de más prioridad se omiten (y se cuentan). */
  prioridad: number;
  /** Fondo blanco detrás del texto. */
  fondo?: boolean;
  /** Otras posiciones, en orden, si en la suya se solapa o se sale del plano. */
  alternativas?: { p?: Vec2; dx?: number; dy?: number; ancla?: "inicio" | "medio" | "fin" }[];
  color?: string;
  objeto?: string;
  /**
   * Qué rotula (I2), para que el visor decida con el zoom: `eje` (las burbujas) y `dato` (cargas,
   * diagnósticos, valores) siempre; `cota`, `id` (ids y secciones), al acercarse. Sin clase, `dato`.
   * `fem render` no la usa.
   */
  clase?: "eje" | "cota" | "id" | "dato";
}

/** Tamaño mínimo de cualquier texto (criterio 3 de A4). */
export const TEXTO_MINIMO = 11;

export interface EntradaLeyenda {
  estilo?: Estilo;
  /** Color de una muestra de relleno (bandas de isovalores). */
  relleno?: string;
  texto: string;
}

/** Un número rotulado en la imagen, con su origen. */
export interface ExtremoRotulado {
  que: string;
  valor: number;
  unidad: string;
  objeto?: string;
  punto?: Vec2;
  comb?: string;
}

export interface Escena {
  /** Primera línea de la cabecera. */
  titulo: string;
  /** Las demás líneas de la cabecera (planta y cota, vista, combinación, huella). */
  cabecera: string[];
  primitivas: Primitiva[];
  leyenda: EntradaLeyenda[];
  /** AB: lo que dibuja la leyenda, con su unidad (en un mapa de armado, «X inferior · M_Ed (Wood–Armer) · kN·m/m»). */
  tituloLeyenda?: string;
  /** Notas al pie de la leyenda (lo que no tiene sitio en planta, convenios). */
  notas: string[];
  extremos: ExtremoRotulado[];
  /** Caja del modelo que se encuadra: [xmin, ymin, xmax, ymax]. */
  caja: [number, number, number, number];
  /** La escala de un mapa de isovalores (`vistaCampo`), para que el visor la enseñe y la cambie. */
  mapa?: EscalaDibujada;
}

export interface EscalaDibujada {
  /** Límites de las bandas de dentro de la escala (sin las de fuera). */
  limites: number[];
  paso: number;
  /** Hay una banda por debajo (o por encima) de la escala, rayada. */
  fueraAbajo: boolean;
  fueraArriba: boolean;
  /** Con la escala completa, la marcan picos en muy poca área (`AVISO_PICOS`). */
  picos: boolean;
  minimo: number;
  maximo: number;
  /** El rango sin los picos (`rangoSinPicos`). */
  sinPicos?: [number, number];
  /** El campo es nulo (su mayor |valor|, menos de `CAMPO_NULO`): una sola banda neutra. */
  nulo?: true;
  /** La combinación dibujada (la de los extremos; también cuando un campo nulo no los rotula). */
  combinacion?: string;
}

/** Caja de unos puntos (la vacía si no hay ninguno). */
export function cajaDe(puntos: Iterable<Vec2>): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of puntos) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

/** Puntos de una primitiva en el modelo (los de un texto o una marca, su punto). */
export function puntosDe(p: Primitiva): Vec2[] {
  switch (p.tipo) {
    case "poligono":
    case "region":
      return p.anillos.flat();
    case "linea":
      return p.puntos;
    default:
      return [p.p];
  }
}

// ─── Geometría plana auxiliar ───────────────────────────────────────────────────────────────────

/** Área con signo (positiva en sentido antihorario). */
export function area(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]![0] - p[i]![0]) * (p[j]![1] + p[i]![1]);
  return a / 2;
}

export function dentro(q: Vec2, p: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Intervalos [x0, x1] de la recta y = cte dentro de unos anillos (par-impar). */
function intervalosHorizontales(anillos: readonly (readonly Vec2[])[], y: number): [number, number][] {
  const xs: number[] = [];
  for (const p of anillos)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i]!;
      const [xj, yj] = p[j]!;
      if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
  xs.sort((a, b) => a - b);
  const r: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) r.push([xs[i]!, xs[i + 1]!]);
  return r;
}

/**
 * Un punto dentro de un polígono con huecos para rotularlo: el centroide si cae dentro; si no, el
 * centro del intervalo más ancho de la horizontal que pasa por él (o por la mitad de la caja).
 */
export function puntoInterior(anillos: readonly (readonly Vec2[])[]): Vec2 {
  const c = anillos[0]!;
  let [ax, ay, aa] = [0, 0, 0];
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const f = c[j]![0] * c[i]![1] - c[i]![0] * c[j]![1];
    aa += f;
    ax += (c[j]![0] + c[i]![0]) * f;
    ay += (c[j]![1] + c[i]![1]) * f;
  }
  const g: Vec2 = aa !== 0 ? [ax / (3 * aa), ay / (3 * aa)] : c[0]!;
  const enHueco = anillos.slice(1).some((h) => dentro(g, h));
  if (dentro(g, c) && !enHueco) return g;
  const [, y0, , y1] = cajaDe(c);
  for (const y of [g[1], (y0 + y1) / 2]) {
    const iv = intervalosHorizontales(anillos, y);
    if (!iv.length) continue;
    const m = iv.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    return [(m[0] + m[1]) / 2, y];
  }
  return g;
}

/** Longitud de una polilínea y el punto y la dirección (unitaria) a la distancia s de su inicio. */
export function longitud(p: readonly Vec2[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
  return l;
}

export function puntoEnPolilinea(p: readonly Vec2[], s: number): { p: Vec2; d: Vec2 } {
  let resto = s;
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1]!, p[i]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l === 0) continue;
    const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    if (resto <= l || i === p.length - 1) {
      const t = Math.max(0, Math.min(l, resto));
      return { p: [a[0] + d[0] * t, a[1] + d[1] * t], d };
    }
    resto -= l;
  }
  return { p: p[0] ?? [0, 0], d: [1, 0] };
}

/**
 * Banda de anchura `ancho` a lo largo de una polilínea: un cuadrilátero por tramo (los tramos se
 * solapan en las esquinas, que se rellenan igual).
 */
export function bandaPolilinea(p: readonly Vec2[], ancho: number): Vec2[][] {
  const r: Vec2[][] = [];
  const m = ancho / 2;
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1]!, p[i]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l === 0) continue;
    const [nx, ny] = [(-(b[1] - a[1]) / l) * m, ((b[0] - a[0]) / l) * m];
    r.push([
      [a[0] - nx, a[1] - ny],
      [b[0] - nx, b[1] - ny],
      [b[0] + nx, b[1] + ny],
      [a[0] + nx, a[1] + ny],
    ]);
  }
  return r;
}

/** Radio del arco de un momento y medio largo de su flecha de doble punta, m del dibujo. */
export const R_MOMENTO = 0.5;

/**
 * El momento de una carga puntual en un dibujo plano (m del dibujo): su componente normal al dibujo
 * (`giro`, positiva antihoraria tal como se mira: hacia quien mira, por la regla de la mano derecha)
 * como un arco de tres cuartos de vuelta alrededor de P con su punta, y la del plano del dibujo
 * (`enPlano`) como una flecha de doble punta que sale de P en su dirección.
 */
export function momento2D(P: Vec2, giro: number, enPlano: Vec2, estilo: Estilo, objeto: string, r = R_MOMENTO): Primitiva[] {
  const out: Primitiva[] = [];
  const punta = (E: Vec2, d: Vec2, h: number): Primitiva => {
    const n: Vec2 = [-d[1], d[0]];
    const w = 0.45 * h;
    return { tipo: "linea", puntos: [[E[0] - h * d[0] + w * n[0], E[1] - h * d[1] + w * n[1]], E, [E[0] - h * d[0] - w * n[0], E[1] - h * d[1] - w * n[1]]], estilo, objeto };
  };
  if (giro !== 0) {
    const s = Math.sign(giro);
    const t0 = Math.PI / 4;
    const arco: Vec2[] = Array.from({ length: 25 }, (_, i) => {
      const t = t0 + (s * 1.5 * Math.PI * i) / 24;
      return [P[0] + r * Math.cos(t), P[1] + r * Math.sin(t)];
    });
    const te = t0 + s * 1.5 * Math.PI;
    out.push({ tipo: "linea", puntos: arco, estilo, objeto }, punta(arco[24]!, [-s * Math.sin(te), s * Math.cos(te)], 0.4 * r));
  }
  const l = Math.hypot(enPlano[0], enPlano[1]);
  if (l > 0) {
    const d: Vec2 = [enPlano[0] / l, enPlano[1] / l];
    const Q: Vec2 = [P[0] + 2 * r * d[0], P[1] + 2 * r * d[1]];
    out.push({ tipo: "linea", puntos: [P, Q], estilo, objeto }, punta(Q, d, 0.4 * r), punta([Q[0] - 0.3 * r * d[0], Q[1] - 0.3 * r * d[1]], d, 0.4 * r));
  }
  return out;
}

/** Tramos de las rectas paralelas a `d` separadas `paso` que caen dentro de unos anillos (par-impar). */
export function rayado(anillos: readonly (readonly Vec2[])[], d: Vec2, paso: number): [Vec2, Vec2][] {
  // En ejes (u a lo largo de d, v perpendicular): las rectas son v = cte
  const n: Vec2 = [-d[1], d[0]];
  const giro = (q: Vec2): Vec2 => [q[0] * d[0] + q[1] * d[1], q[0] * n[0] + q[1] * n[1]];
  const vuelta = (u: number, v: number): Vec2 => [u * d[0] + v * n[0], u * d[1] + v * n[1]];
  const a = anillos.map((r) => r.map(giro));
  // La caja de todos los anillos: una banda de isovalores puede tener varios separados
  const [, v0, , v1] = cajaDe(a.flat());
  const r: [Vec2, Vec2][] = [];
  const primero = Math.ceil(v0 / paso + 1e-9);
  for (let k = primero; k * paso < v1 - 1e-9; k++) {
    const v = k * paso;
    for (const [u0, u1] of intervalosHorizontales(a, v)) r.push([vuelta(u0, v), vuelta(u1, v)]);
  }
  return r;
}

// ─── Textos ─────────────────────────────────────────────────────────────────────────────────────

/** Ancho aproximado de un texto en Roboto, en em (para colocar los rótulos sin solapes). */
export function anchoTexto(t: string, tamano: number, negrita = false): number {
  let w = 0;
  for (const c of t) {
    if (" .,:;'|!il·()[]/-".includes(c)) w += 0.3;
    else if (/[A-ZÁÉÍÓÚÑ]|[mwMW%]/.test(c)) w += 0.66;
    else w += 0.56;
  }
  return w * tamano * (negrita ? 1.06 : 1);
}

/** Número para rotular: `cifras` significativas, con coma decimal (`num` de sensatez sin exponente). */
export function rotulo(x: number, cifras = 3): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const a = Math.abs(x);
  const d = Math.max(0, cifras - 1 - Math.floor(Math.log10(a)));
  const t = Number(x.toFixed(Math.min(d, 6)));
  return (Object.is(t, -0) ? 0 : t).toString().replace(".", ",");
}
