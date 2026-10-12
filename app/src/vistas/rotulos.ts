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
 * - Con poco zoom, las burbujas de los ejes se ralean para no tocarse (`ralearBurbujas`), y las que
 *   quedan son obstáculos para las cotas y los demás rótulos.
 * - Los solapes se buscan en una rejilla de celdas de CELDA px, para no comparar cada caja con
 *   todas en cada fotograma.
 */
import { TEXTO_MINIMO, type Texto, type Vec2 } from "../../../src/agente/render/escena.ts";
import type { Glifo } from "../../../src/visor/escena.ts";

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

type Caja = [number, number, number, number];

/** Separación mínima entre dos burbujas de eje, px. */
const HUECO_BURBUJAS = 3;

/**
 * Las burbujas de los ejes que caben sin tocarse, como en CAD al alejarse. Se decide por eje (sus
 * burbujas de los dos extremos, juntas), por grupos de ejes paralelos ordenados a lo largo de su
 * normal: primero los elegidos, después el primero y el último de cada grupo y luego los demás en
 * orden; cada eje se queda si ninguna de sus burbujas toca a otra ya puesta. Con los ejes a
 * distancias iguales quedan los extremos y uno de cada dos, de cada tres…
 * Devuelve las que se ocultan, los textos sin el de cada burbuja oculta, y la caja de cada burbuja
 * que se ve, para que las cotas y los demás rótulos no se pongan encima.
 */
export function ralearBurbujas(glifos: readonly Glifo[], textos: readonly Texto[], px: (q: Vec2) => [number, number], elegidos: ReadonlySet<string> = new Set()): { ocultos: Set<Glifo>; textos: Texto[]; obstaculos: Caja[] } {
  type Burbuja = { g: Extract<Glifo, { tipo: "marca" }>; q: [number, number] };
  const porEje = new Map<string, Burbuja[]>();
  glifos.forEach((g, i) => {
    if (g.tipo !== "marca" || g.estilo !== "eje-burbuja") return;
    const k = g.objeto ?? `#${i}`;
    const l = porEje.get(k);
    const b = { g, q: px(g.p) };
    if (l) l.push(b);
    else porEje.set(k, [b]);
  });
  // Grupos de ejes paralelos (por la dirección en pantalla entre sus dos burbujas, en grados)
  const grupos = new Map<number, { id: string; bs: Burbuja[]; t: number }[]>();
  for (const [id, bs] of porEje) {
    const [a, b] = [bs[0]!.q, bs[bs.length - 1]!.q];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const ang = bs.length > 1 && Math.hypot(dx, dy) > 1e-6 ? (((Math.round((Math.atan2(dy, dx) * 180) / Math.PI) % 180) + 180) % 180) : -1;
    const r = (ang * Math.PI) / 180;
    // Posición a lo largo de la normal del grupo, en orden de lectura (sin dirección, por x)
    let [nx, ny] = [-Math.sin(r), Math.cos(r)];
    if (nx < -1e-9 || (Math.abs(nx) <= 1e-9 && ny < 0)) [nx, ny] = [-nx, -ny];
    const t = ang < 0 ? a[0] : nx * a[0] + ny * a[1];
    const l = grupos.get(ang);
    if (l) l.push({ id, bs, t });
    else grupos.set(ang, [{ id, bs, t }]);
  }
  const ordenados = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).map(([, l]) => l.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)));
  const orden = [
    ...ordenados.flat().filter((x) => elegidos.has(x.id)),
    ...ordenados.flatMap((l) => (l.length > 1 ? [l[0]!, l[l.length - 1]!] : l)),
    ...ordenados.flatMap((l) => l.slice(1, -1)),
  ];
  const puestas: Burbuja[] = [];
  const ocultos = new Set<Glifo>();
  const vistos = new Set<string>();
  for (const x of orden) {
    if (vistos.has(x.id)) continue;
    vistos.add(x.id);
    if (x.bs.some((b) => puestas.some((o) => Math.hypot(o.q[0] - b.q[0], o.q[1] - b.q[1]) < o.g.radio + b.g.radio + HUECO_BURBUJAS))) for (const b of x.bs) ocultos.add(b.g);
    else puestas.push(...x.bs);
  }
  // El rótulo de una burbuja es el texto de clase «eje» de su objeto en su mismo punto
  const oculta = (t: Texto) => t.clase === "eje" && [...ocultos].some((g) => g.objeto === t.objeto && g.p[0] === t.p[0] && g.p[1] === t.p[1]);
  return {
    ocultos,
    textos: ocultos.size ? textos.filter((t) => !oculta(t)) : [...textos],
    obstaculos: puestas.map(({ g, q }) => [q[0] - g.radio - 1, q[1] - g.radio - 1, q[0] + g.radio + 1, q[1] + g.radio + 1]),
  };
}

/**
 * `px`: del modelo a la pantalla. `medir`: el ancho de un texto en px con su fuente. `obstaculos`:
 * cajas en px donde no se pone ningún rótulo salvo los de clase `eje` (las burbujas, que llevan el
 * suyo dentro). Devuelve los puestos y cuántos de los que se intentaron no cupieron.
 */
export function colocarRotulos(textos: readonly Texto[], px: (q: Vec2) => [number, number], ancho: number, alto: number, medir: (texto: string, tam: number, negrita: boolean) => number, escala: number, elegidos: ReadonlySet<string> = new Set(), obstaculos: readonly Caja[] = []): { puestos: RotuloPuesto[]; omitidos: number } {
  const rejilla = new Map<number, Caja[]>();
  const fija = new Map<number, Caja[]>();
  const clave = (i: number, j: number) => i * 100003 + j;
  const celdas = (c: readonly [number, number, number, number]) => {
    const r: number[] = [];
    for (let i = Math.floor(c[0] / CELDA); i <= Math.floor(c[2] / CELDA); i++) for (let j = Math.floor(c[1] / CELDA); j <= Math.floor(c[3] / CELDA); j++) r.push(clave(i, j));
    return r;
  };
  const toca = (r: Map<number, Caja[]>, c: readonly [number, number, number, number]) => celdas(c).some((k) => r.get(k)?.some((q) => c[0] < q[2] && c[2] > q[0] && c[1] < q[3] && c[3] > q[1]));
  const guardar = (r: Map<number, Caja[]>, c: Caja) => {
    for (const k of celdas(c)) {
      const l = r.get(k);
      if (l) l.push(c);
      else r.set(k, [c]);
    }
  };
  for (const c of obstaculos) guardar(fija, c);
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
      let caja: Caja = [Infinity, Infinity, -Infinity, -Infinity];
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
      if (toca(rejilla, caja) || (t.clase !== "eje" && obstaculos.length && toca(fija, caja))) continue;
      guardar(rejilla, caja);
      puestos.push({ t, x: a, y: b, ancla, tam, fondo: t.fondo ? [a + xi - 2, b - 0.8 * tam, w + 4, 1.05 * tam] : null });
      puesto = true;
      break;
    }
    if (!puesto) omitidos++;
  }
  return { puestos, omitidos };
}
