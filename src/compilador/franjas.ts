/**
 * Franjas de armado (fase F, `docs/fem3d/franjas.md`): franjas de ancho fijo que cubren cada losa
 * maciza o reticular de borde a borde en sus dos direcciones de armado. Sustituyen en la app a las
 * bandas del Anejo I (D5): no se proponen, colocan ni editan, y no se guardan; salen de la losa, de
 * su `eje1` y del ancho.
 *
 * - Direcciones (§2.1): la 1 es el `eje1` de la losa (el ángulo de armado: también orienta los
 *   nervios del reticular y la retícula de la malla) y la 2, su perpendicular. En la dirección k, d
 *   va a lo largo de la franja y n en transversal: (d, n) = (e1, e2) en la 1 y (e2, e1) en la 2, así
 *   que las franjas se numeran por su coordenada transversal creciente. s = p·d, t = p·n.
 * - Ancho (F-a, F-b): `anchoFranja` (1 m por defecto) en una maciza; el intereje en un reticular.
 * - Reparto (F-c): con W la extensión de la losa en t, n = ⌈W/b⌉ franjas iguales de ancho W/n ≤ b.
 * - Nombre: `<losa>:X<i>` en la dirección 1 y `<losa>:Y<i>` en la 2, con i desde 1.
 *
 * Caras de los pilares (§2.2): el momento en una cara sólo es exacto si la cara está en la malla
 * (E5-5; por campos, del −5 al −17 %, C5-2). En cada losa y dirección, las caras comunes de C5-g
 * (`carasComunes`) de los pilares que llegan a la losa se siembran como trazos exactos de lado a
 * lado de la losa (los trozos de la recta dentro de ella, sin sus huecos): son líneas de la rejilla
 * alineada, como las caras de banda de C5, y el corte de todas las franjas que cruzan la recta sigue
 * la malla. Sembrarlas sólo de lo ancho de las franjas que toca el pilar dejaba sus extremos fuera de
 * las líneas de la rejilla, que la rompían (×4 nudos en el edificio objetivo, sin plantillas). Con la
 * opción `franjas: false` no se siembra nada.
 */
import { carasComunes, pilaresEnLosa, semiextension } from "./bandas.ts";
import { radioHuella, type Huella } from "./geometria2d.ts";
import { distanciaABorde, puntoEnRegion } from "./poligonos.ts";
import { ANCHO_FRANJA, type Losa, type Vec2 } from "./fisico.ts";
import { direccionEje1 } from "./losas.ts";
import type { Region } from "./poligonos.ts";
import type { Contexto, LosaCompilada } from "./validar.ts";

export { ANCHO_FRANJA };
/** Paso entre las estaciones de las franjas, m (F-d). */
export const PASO_ESTACIONES = 0.25;

export interface Franja {
  id: string;
  losa: string;
  planta: string;
  direccion: 1 | 2;
  /** A lo largo (d) y en transversal (n), unitarios, en planta. */
  d: Vec2;
  n: Vec2;
  /** Extensión transversal (t = p·n), m. */
  t0: number;
  t1: number;
  /** t1 − t0, m. */
  ancho: number;
  /** Extensión de la losa a lo largo de la franja (s = p·d), m. */
  s0: number;
  s1: number;
  /** Intereje, si la losa es reticular (el momento de la franja es el de un nervio). */
  intereje: number | null;
}

/**
 * Una cara de los pilares de una losa en una dirección: la recta s = p·d, sembrada en los trozos
 * que caen en la losa.
 */
export interface CaraFranja {
  losa: string;
  direccion: 1 | 2;
  /** Coordenada de la cara a lo largo de d, m. */
  s: number;
  /** Lado del vano que mira: −1 en la cara de menor s de sus pilares (el vano está en s < cara), +1 en la de mayor s. */
  lado: -1 | 1;
  /** Trozos de la recta dentro de la losa (sin sus huecos), como intervalos de t, por t creciente. */
  tramos: [number, number][];
  /** Pilares de la cara, con su extensión transversal (la de su huella), por t. */
  pilares: { id: string; t0: number; t1: number }[];
}

/** Ejes de armado de una losa: (d, n) de cada dirección. */
export function ejesArmado(losa: Pick<Losa, "eje1">): { 1: { d: Vec2; n: Vec2 }; 2: { d: Vec2; n: Vec2 } } {
  const e1 = direccionEje1(losa.eje1 ?? 0);
  const e2 = direccionEje1((losa.eje1 ?? 0) + 90);
  return { 1: { d: e1, n: e2 }, 2: { d: e2, n: e1 } };
}

/** Ancho nominal de las franjas de una losa: el intereje en un reticular, si no `ancho`. */
export function anchoNominal(losa: Pick<Losa, "reticular">, ancho = ANCHO_FRANJA): number {
  return losa.reticular?.intereje ?? ancho;
}

/** Parte de un polígono con a ≤ p·n ≤ b (Sutherland–Hodgman contra una banda, que es convexa). */
function recortarBanda(p: readonly Vec2[], n: Vec2, a: number, b: number): Vec2[] {
  let r: Vec2[] = [...p];
  for (const [lim, sg] of [
    [a, 1],
    [b, -1],
  ] as const) {
    const f = (q: Vec2) => sg * (q[0] * n[0] + q[1] * n[1] - lim);
    const sal: Vec2[] = [];
    for (let i = 0; i < r.length; i++) {
      const P = r[i]!;
      const Q = r[(i + 1) % r.length]!;
      const fp = f(P);
      const fq = f(Q);
      if (fp >= 0) sal.push(P);
      if (fp >= 0 !== fq >= 0) {
        const u = fp / (fp - fq);
        sal.push([P[0] + u * (Q[0] - P[0]), P[1] + u * (Q[1] - P[1])]);
      }
    }
    r = sal;
    if (!r.length) break;
  }
  return r;
}

/**
 * Las franjas de una losa en sus dos direcciones (la 1 primero), por t creciente. `desfase` (en
 * fracciones del ancho, en [0, 1)) sólo sirve para medir cuánto importa su posición (criterio 4):
 * corre los bordes interiores hacia t menores, con una franja más, partida entre los dos bordes.
 */
export function franjasLosa(losa: Losa, ancho = ANCHO_FRANJA, desfase = 0): Franja[] {
  const b = anchoNominal(losa, ancho);
  const ejes = ejesArmado(losa);
  const intereje = losa.reticular?.intereje ?? null;
  const r: Franja[] = [];
  for (const k of [1, 2] as const) {
    const { d, n } = ejes[k];
    const ts = losa.contorno.map((q) => q[0] * n[0] + q[1] * n[1]);
    const tmin = Math.min(...ts);
    const tmax = Math.max(...ts);
    const W = tmax - tmin;
    if (!(W > 0) || !(b > 0)) continue;
    // ⌈W/b⌉, sin que un redondeo de W = m·b añada una franja de ancho nulo
    const nf = Math.max(1, Math.ceil(W / b - 1e-9));
    const bordes = [tmin];
    for (let i = 1; i < nf; i++) bordes.push(tmin + (W * i) / nf);
    if (desfase > 0) for (let i = 1; i <= nf; i++) bordes[i] = tmin + (W * (i - desfase)) / nf;
    bordes.push(tmax);
    for (let i = 0; i + 1 < bordes.length; i++) {
      const [t0, t1] = [bordes[i]!, bordes[i + 1]!];
      const trozo = recortarBanda(losa.contorno, n, t0, t1);
      const ss = trozo.map((q) => q[0] * d[0] + q[1] * d[1]);
      r.push({ id: `${losa.id}:${k === 1 ? "X" : "Y"}${i + 1}`, losa: losa.id, planta: losa.planta, direccion: k, d, n, t0, t1, ancho: t1 - t0, s0: Math.min(...ss), s1: Math.max(...ss), intereje });
    }
  }
  return r;
}

/**
 * Trozos de la recta s = p·d dentro de una región (contorno sin huecos), como intervalos de t = p·n
 * por t creciente: los cruces con los lados de todos sus polígonos, emparejados (par–impar). Un
 * vértice sobre la recta cuenta como del lado s ≥ 0, así que se cruza una sola vez.
 */
export function tramosRecta(region: Region, d: Vec2, n: Vec2, s: number, eps = 1e-9): [number, number][] {
  const ts: number[] = [];
  for (const p of [region.contorno, ...region.huecos])
    for (let i = 0; i < p.length; i++) {
      const A = p[i]!;
      const B = p[(i + 1) % p.length]!;
      const sa = A[0] * d[0] + A[1] * d[1] - s;
      const sb = B[0] * d[0] + B[1] * d[1] - s;
      if (sa >= 0 === sb >= 0) continue;
      const u = sa / (sa - sb);
      ts.push(A[0] * n[0] + A[1] * n[1] + u * ((B[0] - A[0]) * n[0] + (B[1] - A[1]) * n[1]));
    }
  ts.sort((a, b) => a - b);
  const r: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1]! - ts[i]! > eps) r.push([ts[i]!, ts[i + 1]!]);
  return r;
}

/**
 * Coseno mínimo con n (la transversal de la franja) de una viga o un muro que atraviesa la huella de
 * un pilar para que sea el apoyo de la losa en esa dirección (60°).
 */
export const COSENO_APOYO_PILAR = 0.5;

/** ¿Es la huella un rectángulo con sus lados según d y n? */
export function alineada(h: Huella, d: Vec2): boolean {
  if (h.forma?.tipo !== "rectangulo") return false;
  return Math.min(Math.abs(h.ez[0] * d[0] + h.ez[1] * d[1]), Math.abs(h.ey[0] * d[0] + h.ey[1] * d[1])) < 1e-9;
}

/**
 * Tramos de viga de la planta y de muro que llegan a ella, en planta: los que pueden hacer de apoyo
 * de la losa en la línea de un pilar.
 */
function lineasApoyo(ctx: Contexto, planta: string): [Vec2, Vec2][] {
  const k = ctx.planta.get(planta)!;
  const r: [Vec2, Vec2][] = [];
  const de = (pts: readonly Vec2[]) => {
    for (let i = 0; i + 1 < pts.length; i++) r.push([pts[i]!, pts[i + 1]!]);
  };
  for (const v of ctx.vigas) if (v.planta === planta) de(v.puntos);
  for (const m of ctx.muros) if (k >= m.kh && k <= m.kb) de(m.muro.puntos);
  return r;
}

/**
 * ¿Atraviesa la huella del pilar (centro P, semiextensiones ed a lo largo de d y en en n) una viga o
 * un muro que va más según n que según d (COSENO_APOYO_PILAR)? Entonces el apoyo de la losa en la
 * dirección d es esa línea, no la cara del pilar.
 */
function conApoyoLineal(P: Vec2, d: Vec2, n: Vec2, ed: number, en: number, lineas: readonly [Vec2, Vec2][], holgura: number): boolean {
  for (const [A, B] of lineas) {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (!(L > 0)) continue;
    const u: Vec2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    if (Math.abs(u[0] * n[0] + u[1] * n[1]) < COSENO_APOYO_PILAR) continue;
    // El punto del segmento más cercano al centro, dentro de la huella (su rectángulo en d, n)
    const w = Math.max(0, Math.min(L, (P[0] - A[0]) * u[0] + (P[1] - A[1]) * u[1]));
    const Q: Vec2 = [A[0] + w * u[0] - P[0], A[1] + w * u[1] - P[1]];
    if (Math.abs(Q[0] * d[0] + Q[1] * d[1]) <= ed + holgura && Math.abs(Q[0] * n[0] + Q[1] * n[1]) <= en + 1e-9) return true;
  }
  return false;
}

/**
 * Caras de los pilares de una losa (§2.2): en cada dirección, las caras comunes de C5-g de los
 * pilares con forma que llegan a la losa, una por recta y lado, de lado a lado de la losa. En orden
 * de dirección, lado y s.
 *
 * Un pilar atravesado por una viga o un muro que va según la transversal n no tiene caras en esa
 * dirección: el apoyo de la losa es esa línea, cuyo eje ya está en la malla (las franjas tienen allí
 * su estación de apoyo). Así, en una losa con vigas, las caras no cruzan la planta junto a vigas
 * oblicuas a un ángulo pequeño (astillas en la malla) ni la crecen sin necesidad.
 *
 * Una cara no pasa a menos de h (el tamaño de malla) de la huella de un pilar que no es suyo, ni de
 * una viga o un muro casi paralelos a ella (a menos de 45°): ahí se corta. Junto a un pilar ajeno
 * con los lados según los ejes, la cara que va por un lado de su huella sigue por él, y la que pasa
 * por dentro se corta en la huella (R0 de F2). En una planta no
 * ortogonal (circular, en abanico) la recta de una cara rozaba la huella de otro pilar o una viga
 * curva a unos centímetros, y la malla quedaba con astillas (G-4). Una viga a menos de h/2 de la
 * huella (enrasada con una cara) cuenta como su apoyo.
 *
 * Sólo tienen caras los pilares rectangulares con los lados según los ejes de la losa y con la
 * huella dentro de la losa: la cara de uno circular o girado la toca en
 * una tangente o una esquina, y la de uno de borde, con la cara común de C5-g a unos centímetros de
 * la suya, corre casi paralela a su huella; las dos dejan astillas en la malla (G-4). Tampoco hay
 * cara del lado de un vuelo de menos de h: correría casi pegada al borde. En las franjas, junto a
 * ellos no hay estación exacta (aviso `franja/pilar-sin-cara`).
 */
export function carasFranjas(ctx: Contexto, l: LosaCompilada): CaraFranja[] {
  const pilares = pilaresEnLosa(ctx, l);
  const ejes = ejesArmado(l.losa);
  const lineas = lineasApoyo(ctx, l.losa.planta);
  const r: CaraFranja[] = [];
  for (const k of [1, 2] as const) {
    const { d, n } = ejes[k];
    const h = ctx.op.tamanoMalla;
    const todos = pilares.filter((p) => semiextension(p.huella, d) > 0 && semiextension(p.huella, n) > 0);
    // Una viga a menos de h/2 de la huella (enrasada con una cara del pilar) también es su apoyo
    const dentro = (p: (typeof todos)[number]) => puntoEnRegion(p.p, l.region) && [l.region.contorno, ...l.region.huecos].every((q) => distanciaABorde(p.p, q) > radioHuella(p.huella) + ctx.op.epsSnap);
    const conForma = todos.filter((p) => alineada(p.huella, d) && dentro(p) && !conApoyoLineal(p.p, d, n, semiextension(p.huella, d), semiextension(p.huella, n), lineas, ctx.op.tamanoMalla / 2));
    const tramos = carasComunes(conForma, d);
    const porRecta = new Map<string, CaraFranja>();
    for (const p of conForma) {
      const [sa, sb] = tramos.get(p.id)!;
      const tc = p.p[0] * n[0] + p.p[1] * n[1];
      const e = semiextension(p.huella, n);
      for (const [s, lado] of [
        [sa, -1],
        [sb, 1],
      ] as const) {
        // Sin vano de al menos h al otro lado de la cara (un vuelo corto): sin cara, que correría casi
        // pegada al borde de la losa
        const q = s + lado * h;
        if (!puntoEnRegion([q * d[0] + tc * n[0], q * d[1] + tc * n[1]], l.region)) continue;
        const clave = `${lado}:${s}`;
        let c = porRecta.get(clave);
        if (!c) porRecta.set(clave, (c = { losa: l.losa.id, direccion: k, s, lado, tramos: tramosRecta(l.region, d, n, s), pilares: [] }));
        c.pilares.push({ id: p.id, t0: tc - e, t1: tc + e });
      }
    }
    // Fuera de los pilares ajenos, con su holgura. Junto a uno alineado no hay astilla posible si la
    // recta va por un lado de su huella (corre por él) o por dentro (se corta en la huella, como en
    // los suyos): cortarla a h dejaba su extremo suelto junto al pilar, y la plantilla de un pilar de
    // borde se iba a la triangulación (F2, R0)
    const tolLado = 10 * ctx.op.epsGeom;
    for (const c of porRecta.values()) {
      const suyos = new Set(c.pilares.map((p) => p.id));
      for (const p of todos) {
        if (suyos.has(p.id)) continue;
        const sp = p.p[0] * d[0] + p.p[1] * d[1];
        const ed = semiextension(p.huella, d);
        if (Math.abs(sp - c.s) > ed + h) continue;
        const recto = alineada(p.huella, d);
        if (recto && Math.abs(Math.abs(sp - c.s) - ed) <= tolLado) continue;
        const tp = p.p[0] * n[0] + p.p[1] * n[1];
        const en = semiextension(p.huella, n) + (recto && Math.abs(sp - c.s) < ed ? 0 : h);
        c.tramos = c.tramos.flatMap(([a, b]): [number, number][] => [...(tp - en > a ? [[a, Math.min(b, tp - en)] as [number, number]] : []), ...(tp + en < b ? [[Math.max(a, tp + en), b] as [number, number]] : [])].filter(([x, y]) => y - x > 1e-9));
      }
      // Ni por dentro de las huellas de sus pilares (la cara común de C5-g de uno mayor que el menor
      // de su línea va por dentro de él, a unos centímetros de su lado): ahí todo es rígido
      for (const p of todos) {
        if (!suyos.has(p.id)) continue;
        const sp = p.p[0] * d[0] + p.p[1] * d[1];
        if (!(Math.abs(sp - c.s) < semiextension(p.huella, d) - 1e-9)) continue;
        const tp = p.p[0] * n[0] + p.p[1] * n[1];
        const en = semiextension(p.huella, n);
        c.tramos = c.tramos.flatMap(([a, b]): [number, number][] => [...(tp - en > a ? [[a, Math.min(b, tp - en)] as [number, number]] : []), ...(tp + en < b ? [[Math.max(a, tp + en), b] as [number, number]] : [])].filter(([x, y]) => y - x > 1e-9));
      }
      // Ni junto a una viga o un muro casi paralelo a ella (a menos de 45°) a menos de h
      for (const [A, B] of lineas) {
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (!(L > 0) || Math.abs(((B[0] - A[0]) * n[0] + (B[1] - A[1]) * n[1]) / L) < Math.SQRT1_2) continue;
        const [sa, sb] = [A[0] * d[0] + A[1] * d[1] - c.s, B[0] * d[0] + B[1] * d[1] - c.s];
        if (Math.min(Math.abs(sa), Math.abs(sb)) > h && sa * sb > 0) continue;
        const [ta, tb] = [A[0] * n[0] + A[1] * n[1], B[0] * n[0] + B[1] * n[1]];
        const [lo, hi] = [Math.min(ta, tb) - h, Math.max(ta, tb) + h];
        c.tramos = c.tramos.flatMap(([a, b]): [number, number][] => [...(lo > a ? [[a, Math.min(b, lo)] as [number, number]] : []), ...(hi < b ? [[Math.max(a, hi), b] as [number, number]] : [])].filter(([x, y]) => y - x > 1e-9));
      }
      // Sólo los trozos que llevan algún pilar suyo (o lo tocan, si se ha cortado su huella)
      c.tramos = c.tramos.filter(([a, b]) => c.pilares.some((p) => p.t1 >= a - 1e-9 && p.t0 <= b + 1e-9));
    }
    const caras = [...porRecta.values()].filter((c) => c.tramos.length).sort((a, b) => a.lado - b.lado || a.s - b.s);
    for (const c of caras) c.pilares.sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : 1));
    r.push(...caras);
  }
  return r;
}

/**
 * Pilares con forma de la losa que no tienen caras en la dirección k sin que una viga o un muro los
 * atraviese (los circulares, los girados y los de borde, `carasFranjas`), con su extensión
 * transversal: junto a ellos, las franjas no tienen estación exacta.
 */
export function pilaresSinCara(ctx: Contexto, l: LosaCompilada, k: 1 | 2): { id: string; t0: number; t1: number }[] {
  const { d, n } = ejesArmado(l.losa)[k];
  const lineas = lineasApoyo(ctx, l.losa.planta);
  const conCara = new Set(carasFranjas(ctx, l).filter((c) => c.direccion === k).flatMap((c) => c.pilares.map((p) => p.id)));
  return pilaresEnLosa(ctx, l)
    .filter((p) => p.huella.forma && !conCara.has(p.id) && !conApoyoLineal(p.p, d, n, semiextension(p.huella, d), semiextension(p.huella, n), lineas, ctx.op.tamanoMalla / 2))
    .map((p) => {
      const tc = p.p[0] * n[0] + p.p[1] * n[1];
      const e = semiextension(p.huella, n);
      return { id: p.id, t0: tc - e, t1: tc + e };
    });
}

/** Extremos en planta de los trozos de una cara. */
export function segmentosCara(c: CaraFranja, ejes: { d: Vec2; n: Vec2 }): [Vec2, Vec2][] {
  const { d, n } = ejes;
  const P = (t: number): Vec2 => [c.s * d[0] + t * n[0], c.s * d[1] + t * n[1]];
  return c.tramos.map(([t0, t1]) => [P(t0), P(t1)]);
}
