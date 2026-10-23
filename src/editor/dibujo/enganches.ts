/**
 * Enganches del dibujo (V2c-1, `docs/fem3d/dibujo.md` §2.2): el índice de los rasgos de una planta
 * (puntos y rectas del modelo físico) y el punto al que se engancha el cursor.
 *
 * - Prioridad, de más a menos (`NIVEL`): punto fijo, centro y esquinas de los pilares; extremos y
 *   vértices de vigas, muros, apoyos lineales, contornos y huecos de losas y paños, y de los ejes;
 *   cruces de los ejes de replanteo entre sí y con vigas y muros; puntos medios; la cara de un pilar;
 *   el pie de la perpendicular desde el último punto; el punto más cercano de una recta. Dentro de un
 *   nivel gana el más cercano y, a la misma distancia, el que se indexó antes (el orden de `porId`).
 * - El radio es de pantalla (10 px, `RADIO_ENGANCHE`): quien llama lo pasa en m (radio / escala), así
 *   que no depende del zoom.
 * - El punto de un rasgo de punto es el del modelo, bit a bit (los mismos doubles); el de un cruce, un
 *   punto medio o una proyección se calcula siempre igual. Lo dibujado sobre lo enganchado une sin
 *   tolerancias.
 * - Sin enganche, el ortogonal (F8, o Mayús) fija el segmento en curso a 0°/90° de los ejes de la losa
 *   (o de los de replanteo) y, con Mayús, también a 45°. Un enganche gana al ortogonal, como en los CAD.
 *
 * Qué hay en una planta es lo que dibuja la vista `modelo` (`PlantaFisica`): los pilares y muros que
 * llegan o arrancan, y las vigas, losas, paños y apoyos lineales de la planta; los ejes, los del
 * modelo o, si no tiene, los propuestos.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { direccionEjes, ejesDe } from "../../compilador/ejes.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { conPuntoFijo } from "../../compilador/puntoFijo.ts";
import { anchoViga, ejeSeccion, huellaMuro, huellaSeccion, huellasVigasPlanta, PlantaFisica } from "../../agente/render/modelo.ts";

export type TipoEnganche = "fijo" | "centro" | "esquina" | "extremo" | "vertice" | "cruce" | "medio" | "cara" | "perpendicular" | "cercano";

/** Nivel de prioridad de cada tipo (1, el que más). */
export const NIVEL: Readonly<Record<TipoEnganche, number>> = { fijo: 1, centro: 1, esquina: 1, extremo: 2, vertice: 2, cruce: 3, medio: 4, cara: 5, perpendicular: 6, cercano: 7 };

export const TIPOS_ENGANCHE = Object.keys(NIVEL) as readonly TipoEnganche[];

/** Lo que dice la barra de estado de cada enganche. */
export const NOMBRE_ENGANCHE: Readonly<Record<TipoEnganche, string>> = {
  fijo: "Punto fijo",
  centro: "Centro",
  esquina: "Esquina",
  extremo: "Extremo",
  vertice: "Vértice",
  cruce: "Cruce",
  medio: "Punto medio",
  cara: "Cara de pilar",
  perpendicular: "Perpendicular",
  cercano: "Cercano",
};

/** Radio de enganche, px de pantalla. */
export const RADIO_ENGANCHE = 10;

export type TipoObjeto = "pilar" | "viga" | "muro" | "apoyoLineal" | "losa" | "pano" | "eje";

interface PuntoRasgo {
  p: Vec2;
  tipo: TipoEnganche;
  objeto: string;
}

interface Recta {
  a: Vec2;
  b: Vec2;
  objeto: string;
}

/** Lo que se resalta de un objeto al pasar el ratón: sus contornos (cerrados) y sus líneas (abiertas). */
export interface Silueta {
  id: string;
  tipo: TipoObjeto;
  cerrados: Vec2[][];
  abiertos: Vec2[][];
}

export interface IndiceEnganches {
  planta: string;
  /** Rasgos de punto, por nivel y en el orden de indexado. */
  puntos: PuntoRasgo[];
  /** Rectas para el punto medio, la perpendicular y el más cercano. */
  rectas: Recta[];
  /** Las caras de los pilares (rectángulos) y sus círculos. */
  caras: Recta[];
  circulos: { c: Vec2; r: number; objeto: string }[];
  /** Los cruces de ejes entre sí (para Pilar con ventana). */
  crucesEjes: Vec2[];
  /** Dirección de los ejes de la losa (o de replanteo), grados desde +X, en [0, 90). */
  direccion: number;
  /** Lo que hay en la planta, para «al pasar el ratón», de más a menos prioridad. */
  siluetas: (Silueta & { distancia: (q: Vec2) => number })[];
}

// ─── Geometría ──────────────────────────────────────────────────────────────────────────────────

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Punto de ab más cercano a q, y su parámetro en [0, 1]. */
function proyectar(q: Vec2, a: Vec2, b: Vec2): { p: Vec2; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { p: a, t: 0 };
  const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2;
  if (t <= 0) return { p: a, t: 0 };
  if (t >= 1) return { p: b, t: 1 };
  // En una recta paralela a X o a Y, su coordenada fija y la del cursor, bit a bit
  if (dx === 0) return { p: [a[0], q[1]], t };
  if (dy === 0) return { p: [q[0], a[1]], t };
  return { p: [a[0] + t * dx, a[1] + t * dy], t };
}

const distSegmento = (q: Vec2, a: Vec2, b: Vec2) => dist(q, proyectar(q, a, b).p);

/** Cruce de los segmentos ab y cd (extremos incluidos), o null si no se cortan o son paralelos. */
export function cruce(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  const e = 1e-12;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  // Un extremo que cae en el otro segmento es ese extremo, tal cual
  if (t <= e) return a;
  if (t >= 1 - e) return b;
  if (u <= e) return c;
  if (u >= 1 - e) return d;
  // Con una recta paralela a X o a Y, su coordenada fija tal cual (la retícula de ejes da los números escritos)
  const x = rx === 0 ? a[0] : sx === 0 ? c[0] : a[0] + t * rx;
  const y = ry === 0 ? a[1] : sy === 0 ? c[1] : a[1] + t * ry;
  return [x, y];
}

function puntoEnPoligono(q: Vec2, p: readonly Vec2[]): boolean {
  let dentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Distancia de q a una polilínea (cerrada si `cerrada`). */
function distPolilinea(q: Vec2, p: readonly Vec2[], cerrada: boolean): number {
  let d = Infinity;
  const n = p.length;
  if (n === 1) return dist(q, p[0]!);
  for (let i = 0; i < (cerrada ? n : n - 1); i++) d = Math.min(d, distSegmento(q, p[i]!, p[(i + 1) % n]!));
  return d;
}

/** Unitario a `grados` desde +X, exacto en los múltiplos de 90°. */
export function unitario(grados: number): Vec2 {
  const g = (((grados % 360) + 360) % 360) / 90;
  if (Number.isInteger(g)) return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[g % 4]!;
  const r = (grados * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

// ─── El índice ──────────────────────────────────────────────────────────────────────────────────

const segmentos = (ps: readonly Vec2[], cerrado: boolean): [Vec2, Vec2][] => {
  const r: [Vec2, Vec2][] = [];
  const n = ps.length;
  for (let i = 0; i < (cerrado ? n : n - 1); i++) {
    const a = ps[i]!;
    const b = ps[(i + 1) % n]!;
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a, b]);
  }
  return r;
};

/** Dirección de los ejes para el ortogonal: la de las losas y paños de la planta o, si no hay, la del primer eje de replanteo. */
export function direccionOrto(m: ModeloFisico, planta: string): number {
  const losas = (m.losas ?? []).filter((l) => l.planta === planta);
  const panos = (m.panos ?? []).filter((l) => l.planta === planta);
  if (losas.length || panos.length) return direccionEjes({ ...m, losas, panos });
  const e = ejesDe(m).ejes[0];
  if (!e) return 0;
  const g = (Math.atan2(e.hasta[1] - e.desde[1], e.hasta[0] - e.desde[0]) * 180) / Math.PI;
  const r = Math.round((((g % 90) + 90) % 90) * 1e6) / 1e6;
  return r === 90 ? 0 : r;
}

/** Los rasgos de una planta. Se rehace cuando cambia el modelo o la planta. */
export function indiceEnganches(m: ModeloFisico, planta: string): IndiceEnganches {
  const pl = new PlantaFisica(m, planta);
  const puntos: PuntoRasgo[] = [];
  const rectas: Recta[] = [];
  const caras: Recta[] = [];
  const circulos: IndiceEnganches["circulos"] = [];
  const siluetas: IndiceEnganches["siluetas"] = [];
  const punto = (p: Vec2, tipo: TipoEnganche, objeto: string) => puntos.push({ p, tipo, objeto });

  // Pilares: punto fijo, centro de la sección (el eje del tramo) y esquinas o cuadrantes
  for (const { p, seccion } of pl.pilares()) {
    const fijo: Vec2 = [p.x, p.y];
    const centro = ejeSeccion(p, seccion);
    // Sin punto fijo, (x, y) es el centro: un solo rasgo
    if (conPuntoFijo(p)) punto(fijo, "fijo", p.id);
    punto(centro, "centro", p.id);
    const h = huellaSeccion(p, seccion);
    if (h && "anillo" in h) {
      for (const c of h.anillo) punto(c, "esquina", p.id);
      for (const [a, b] of segmentos(h.anillo, true)) caras.push({ a, b, objeto: p.id });
      siluetas.push({ id: p.id, tipo: "pilar", cerrados: [h.anillo], abiertos: [], distancia: (q) => (puntoEnPoligono(q, h.anillo) ? 0 : distPolilinea(q, h.anillo, true)) });
    } else if (h) {
      const { centro: c, radio: r } = h;
      for (const g of [0, 90, 180, 270]) {
        const u = unitario(g);
        punto([c[0] + r * u[0], c[1] + r * u[1]], "esquina", p.id);
      }
      circulos.push({ c, r, objeto: p.id });
      const anillo = Array.from({ length: 32 }, (_, i): Vec2 => [c[0] + r * Math.cos((i * Math.PI) / 16), c[1] + r * Math.sin((i * Math.PI) / 16)]);
      siluetas.push({ id: p.id, tipo: "pilar", cerrados: [anillo], abiertos: [], distancia: (q) => Math.max(0, dist(q, c) - r) });
    } else siluetas.push({ id: p.id, tipo: "pilar", cerrados: [], abiertos: [[fijo]], distancia: (q) => dist(q, fijo) });
  }

  // Polilíneas: vigas, muros y apoyos lineales
  const huellasV = huellasVigasPlanta(pl);
  const polilinea = (id: string, ps: readonly Vec2[]) => {
    ps.forEach((p, i) => punto(p, i === 0 || i === ps.length - 1 ? "extremo" : "vertice", id));
    for (const [a, b] of segmentos(ps, false)) rectas.push({ a, b, objeto: id });
  };
  const muros = pl.muros().map((x) => x.m);
  for (const v of pl.enPlanta(m.vigas)) {
    polilinea(v.id, v.puntos);
    const b = anchoViga(m.secciones?.find((s) => s.id === v.seccion));
    const ps = v.puntos;
    siluetas.push({ id: v.id, tipo: "viga", cerrados: huellasV.get(v.id) ?? [], abiertos: [ps as Vec2[]], distancia: (q) => Math.max(0, distPolilinea(q, ps, false) - b / 2) });
  }
  for (const w of muros) {
    polilinea(w.id, w.puntos);
    const ps = w.puntos;
    siluetas.push({ id: w.id, tipo: "muro", cerrados: huellaMuro(ps, w.espesor), abiertos: [ps as Vec2[]], distancia: (q) => Math.max(0, distPolilinea(q, ps, false) - w.espesor / 2) });
  }
  for (const a of pl.enPlanta(m.apoyosLineales)) {
    polilinea(a.id, a.puntos);
    const ps = a.puntos;
    siluetas.push({ id: a.id, tipo: "apoyoLineal", cerrados: [], abiertos: [ps as Vec2[]], distancia: (q) => distPolilinea(q, ps, false) });
  }

  // Ejes de replanteo: extremos, rectas y cruces (entre sí, con vigas y con muros)
  const ejes = ejesDe(m).ejes;
  const siluetasEjes: IndiceEnganches["siluetas"] = [];
  for (const e of ejes) {
    punto(e.desde, "extremo", e.id);
    punto(e.hasta, "extremo", e.id);
    if (e.desde[0] !== e.hasta[0] || e.desde[1] !== e.hasta[1]) rectas.push({ a: e.desde, b: e.hasta, objeto: e.id });
    siluetasEjes.push({ id: e.id, tipo: "eje", cerrados: [], abiertos: [[e.desde, e.hasta]], distancia: (q) => distSegmento(q, e.desde, e.hasta) });
  }
  const crucesEjes: Vec2[] = [];
  const vistos = new Set<string>();
  const anadirCruce = (p: Vec2, objeto: string, deEjes: boolean) => {
    const k = `${p[0]} ${p[1]}`;
    if (deEjes && !crucesEjes.some((c) => c[0] === p[0] && c[1] === p[1])) crucesEjes.push(p);
    if (vistos.has(k)) return;
    vistos.add(k);
    punto(p, "cruce", objeto);
  };
  for (let i = 0; i < ejes.length; i++)
    for (let j = i + 1; j < ejes.length; j++) {
      const c = cruce(ejes[i]!.desde, ejes[i]!.hasta, ejes[j]!.desde, ejes[j]!.hasta);
      if (c) anadirCruce(c, ejes[i]!.id, true);
    }
  for (const e of ejes)
    for (const x of [...pl.enPlanta(m.vigas), ...muros])
      for (const [a, b] of segmentos(x.puntos, false)) {
        const c = cruce(e.desde, e.hasta, a, b);
        if (c) anadirCruce(c, x.id, false);
      }

  // Contornos y huecos de losas y paños
  const siluetasLosas: IndiceEnganches["siluetas"] = [];
  for (const [tipo, xs] of [["losa", pl.enPlanta(m.losas)], ["pano", pl.enPlanta(m.panos)]] as const)
    for (const l of xs) {
      const anillos = [l.contorno, ...(l.huecos ?? [])];
      for (const r of anillos) {
        for (const p of r) punto(p, "vertice", l.id);
        for (const [a, b] of segmentos(r, true)) rectas.push({ a, b, objeto: l.id });
      }
      const huecos = l.huecos ?? [];
      siluetasLosas.push({ id: l.id, tipo, cerrados: anillos as Vec2[][], abiertos: [], distancia: (q) => (puntoEnPoligono(q, l.contorno) && !huecos.some((h) => puntoEnPoligono(q, h)) ? 0 : Infinity) });
    }

  // Puntos medios, después de todo lo demás (su nivel los ordena igual)
  for (const r of rectas) punto([(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2], "medio", r.objeto);

  return { planta, puntos, rectas, caras, circulos, crucesEjes, direccion: direccionOrto(m, planta), siluetas: [...siluetas, ...siluetasEjes, ...siluetasLosas] };
}

// ─── Enganchar ──────────────────────────────────────────────────────────────────────────────────

export interface Enganche {
  p: Vec2;
  tipo: TipoEnganche;
  /** El objeto del rasgo (un pilar, una viga, un eje…). */
  objeto: string;
}

export interface OpcionesEnganche {
  /** El último punto del segmento en curso (para la perpendicular). */
  ultimo?: Vec2 | null;
  /** Los tipos que enganchan; por defecto, todos. */
  activos?: ReadonlySet<TipoEnganche>;
}

/** El enganche del cursor q con el radio en m, o null si no hay ninguno a ese radio. */
export function enganchar(ix: IndiceEnganches, q: Vec2, radio: number, o: OpcionesEnganche = {}): Enganche | null {
  const activo = (t: TipoEnganche) => !o.activos || o.activos.has(t);
  let mejor: (Enganche & { d: number; n: number }) | null = null;
  const proponer = (p: Vec2, tipo: TipoEnganche, objeto: string) => {
    if (!activo(tipo)) return;
    const d = dist(p, q);
    if (d > radio) return;
    const n = NIVEL[tipo];
    if (!mejor || n < mejor.n || (n === mejor.n && d < mejor.d)) mejor = { p, tipo, objeto, d, n };
  };
  for (const x of ix.puntos) proponer(x.p, x.tipo, x.objeto);
  // Lo que se calcula con el cursor, sólo si puede ganar a lo que ya hay
  const puede = (t: TipoEnganche) => activo(t) && (!mejor || NIVEL[t] <= mejor.n);
  if (puede("cara")) {
    for (const c of ix.caras) proponer(proyectar(q, c.a, c.b).p, "cara", c.objeto);
    for (const c of ix.circulos) {
      const d = dist(q, c.c);
      if (d > 0) proponer([c.c[0] + ((q[0] - c.c[0]) * c.r) / d, c.c[1] + ((q[1] - c.c[1]) * c.r) / d], "cara", c.objeto);
    }
  }
  const u = o.ultimo;
  if (u && puede("perpendicular"))
    for (const r of ix.rectas) {
      const { p, t } = proyectar(u, r.a, r.b);
      if (t > 0 && t < 1 && dist(p, u) > 0) proponer(p, "perpendicular", r.objeto);
    }
  if (puede("cercano")) for (const r of ix.rectas) proponer(proyectar(q, r.a, r.b).p, "cercano", r.objeto);
  if (!mejor) return null;
  const { p, tipo, objeto } = mejor as Enganche;
  return { p, tipo, objeto };
}

/**
 * El punto del ortogonal: q llevado a la recta por `desde` más cercana de las de `direccion` + k·90°
 * (o + k·45° con `a45`). En los múltiplos de 90° desde +X, la coordenada que no cambia es la de
 * `desde`, bit a bit.
 */
export function ortogonal(desde: Vec2, q: Vec2, direccion: number, a45: boolean): Vec2 {
  const paso = a45 ? 45 : 90;
  const alfa = (Math.atan2(q[1] - desde[1], q[0] - desde[0]) * 180) / Math.PI;
  const beta = direccion + Math.round((alfa - direccion) / paso) * paso;
  const d = unitario(beta);
  if (d[1] === 0) return [q[0], desde[1]];
  if (d[0] === 0) return [desde[0], q[1]];
  const l = (q[0] - desde[0]) * d[0] + (q[1] - desde[1]) * d[1];
  return [desde[0] + l * d[0], desde[1] + l * d[1]];
}

export interface Apunte {
  /** El punto que se usa. */
  p: Vec2;
  enganche: Enganche | null;
  /** Se usó el ortogonal. */
  orto: boolean;
}

/** El punto del cursor: el enganche si lo hay; si no, el ortogonal (con F8 o Mayús y un punto anterior); si no, el cursor. */
export function apuntar(ix: IndiceEnganches, q: Vec2, radio: number, o: OpcionesEnganche & { orto?: boolean; mayus?: boolean } = {}): Apunte {
  const e = enganchar(ix, q, radio, o);
  if (e) return { p: e.p, enganche: e, orto: false };
  if (o.ultimo && (o.orto || o.mayus)) return { p: ortogonal(o.ultimo, q, ix.direccion, !!o.mayus), enganche: null, orto: true };
  return { p: q, enganche: null, orto: false };
}

/** Lo que hay bajo el cursor (a menos del radio, m): pilares, luego vigas, muros y apoyos lineales, luego ejes, luego losas y paños. */
export function bajoCursor(ix: IndiceEnganches, q: Vec2, radio: number): Silueta | null {
  let mejor: { s: Silueta; d: number; grupo: number } | null = null;
  const grupo = (t: TipoObjeto) => (t === "pilar" ? 0 : t === "eje" ? 2 : t === "losa" || t === "pano" ? 3 : 1);
  for (const s of ix.siluetas) {
    const d = s.distancia(q);
    if (d > radio) continue;
    const g = grupo(s.tipo);
    if (!mejor || g < mejor.grupo || (g === mejor.grupo && d < mejor.d)) mejor = { s, d, grupo: g };
  }
  if (!mejor) return null;
  const { id, tipo, cerrados, abiertos } = mejor.s;
  return { id, tipo, cerrados, abiertos };
}
