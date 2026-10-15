/**
 * El ancho de las vigas en las losas (fase LV, `docs/fem3d/union-losa-viga.md`, decisión CY-g): con
 * la unión de CYPECAD (`unionLosaViga: "cara"`), el ancho de una viga de hormigón rectangular de una
 * planta con losas no es losa. La losa llega a sus caras, y sus nudos en ellas van unidos al eje por
 * un enlace rígido (`losas.ts`); lo que cae en el ancho pasa a la viga (`cargas.ts`).
 *
 * El ancho de cada tramo de la polilínea es un rectángulo de ancho b a lo largo de su eje, de un
 * extremo del tramo al otro. En un quiebro de la polilínea va a inglete si el giro es de
 * GIRO_INGLETE o menos (sin la cuña de losa que dejaría la escuadra por fuera); si es mayor, a
 * escuadra. El trozo que va por el eje de un muro de la planta no cuenta, ni el que pisa el espesor
 * de un muro que cruza o en el que acaba: ahí la losa llega al eje del muro, como en C3.
 *
 * Puro y determinista.
 */
import type { Vec2, Viga } from "./fisico.ts";
import type { Topologia, TramoViga } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

/** Giro máximo de un quiebro que se une a inglete, en grados. */
export const GIRO_INGLETE = 120;

export interface AnchoViga {
  /** Tramo de la viga del que sale. */
  tramo: TramoViga;
  viga: string;
  k: number;
  /** Trozo del tramo, en σ desde su punto A. */
  desde: number;
  hasta: number;
  /** Ancho de la viga, m. */
  b: number;
  /** Polígono del ancho, antihorario. */
  poligono: Vec2[];
}

/** Ancho b de la viga si se une a la losa por sus caras (hormigón y sección rectangular); si no, null. */
export function anchoUnion(ctx: Contexto, v: Viga): number | null {
  if (ctx.op.unionLosaViga !== "cara") return null;
  const sc = ctx.secciones.get(v.seccion);
  if (!sc || sc.material !== "hormigon" || sc.forma !== "rectangular" || sc.huella?.tipo !== "rectangulo") return null;
  const b = sc.huella.b;
  return b / 2 > ctx.op.epsSnap ? b : null;
}

/**
 * Trozos [desde, hasta] de la recta del tramo (σ desde A) que van por el eje de un muro de la planta
 * k (los dos extremos de un tramo del muro a ≤ eps de la recta), unidos.
 */
function sobreMuros(ctx: Contexto, k: number, A: Vec2, u: Vec2, len: number, eps: number): [number, number][] {
  const r: [number, number][] = [];
  const pr = (Q: Vec2) => {
    const dx = Q[0] - A[0];
    const dy = Q[1] - A[1];
    return { s: dx * u[0] + dy * u[1], d: Math.abs(dx * u[1] - dy * u[0]) };
  };
  for (const m of ctx.muros) {
    if (!(k >= m.kh && k <= m.kb)) continue;
    const p = m.muro.puntos;
    for (let i = 1; i < p.length; i++) {
      const [a, b] = [pr(p[i - 1]!), pr(p[i]!)];
      if (a.d > eps || b.d > eps) continue;
      const desde = Math.max(0, Math.min(a.s, b.s));
      const hasta = Math.min(len, Math.max(a.s, b.s));
      if (hasta - desde > eps) r.push([desde, hasta]);
    }
  }
  r.sort((x, y) => x[0] - y[0]);
  return unir(r, eps);
}

/**
 * Trozos [desde, hasta] de la recta del tramo (σ desde A) en los que el ancho de la viga (b) pisa el
 * espesor de un muro de la planta k que la cruza o en el que acaba: ahí es muro, y la losa llega a su
 * eje (C3). Así ningún punto del ancho cae en el eje de un muro, donde sería una estación suya (y con
 * una viga de otro ancho en otra planta, a unos centímetros de la de esa planta).
 */
function cruzaMuros(ctx: Contexto, k: number, A: Vec2, u: Vec2, len: number, b: number, eps: number): [number, number][] {
  const r: [number, number][] = [];
  const n = normal(u);
  for (const m of ctx.muros) {
    if (!(k >= m.kh && k <= m.kb)) continue;
    const t = m.material.t;
    const p = m.muro.puntos;
    for (let i = 1; i < p.length; i++) {
      const [W0, W1] = [p[i - 1]!, p[i]!];
      const Lw = Math.sqrt((W1[0] - W0[0]) * (W1[0] - W0[0]) + (W1[1] - W0[1]) * (W1[1] - W0[1]));
      if (!(Lw > 0)) continue;
      const w: Vec2 = [(W1[0] - W0[0]) / Lw, (W1[1] - W0[1]) / Lw];
      const nw = normal(w);
      const c = nw[0] * u[0] + nw[1] * u[1];
      // Paralelo (a 1e-6, por encima de lo que gira un tramo un ruido de ε_geom): lo que va por su eje,
      // `sobreMuros`; si no, no se cruzan
      if (Math.abs(c) < 1e-6) continue;
      // σ de los cruces de los dos bordes del ancho con las dos caras del muro
      const ss: number[] = [];
      for (const sb of [-b / 2, b / 2])
        for (const sw of [-t / 2, t / 2]) {
          const P0: Vec2 = [A[0] + sb * n[0] - W0[0], A[1] + sb * n[1] - W0[1]];
          ss.push((sw - (nw[0] * P0[0] + nw[1] * P0[1])) / c);
        }
      // Y dentro de lo que el tramo de muro (con su espesor) ocupa a lo largo del eje: casi paralelos
      // (un muro colineal que empieza donde acaba la viga, con un ruido de ε_geom), el cruce de las
      // rectas se va a miles de metros
      const sw = [W0, W1].map((W) => (W[0] - A[0]) * u[0] + (W[1] - A[1]) * u[1]);
      const ew = (t / 2) * Math.abs(c);
      const lo = Math.max(Math.min(...ss), Math.min(...sw) - ew, 0);
      const hi = Math.min(Math.max(...ss), Math.max(...sw) + ew, len);
      if (!(hi - lo > eps)) continue;
      // Sólo si el muro está ahí: el trozo del ancho entre lo y hi toca el tramo del muro
      const a = [lo, hi].flatMap((sg) => [-b / 2, b / 2].map((sb) => (A[0] + sg * u[0] + sb * n[0] - W0[0]) * w[0] + (A[1] + sg * u[1] + sb * n[1] - W0[1]) * w[1]));
      if (Math.max(...a) < -eps || Math.min(...a) > Lw + eps) continue;
      r.push([lo, hi]);
    }
  }
  r.sort((x, y) => x[0] - y[0]);
  return unir(r, eps);
}

/** Intervalos ordenados, unidos si se tocan a ≤ eps. */
function unir(r: readonly [number, number][], eps: number): [number, number][] {
  const unidos: [number, number][] = [];
  for (const [a, b] of r) {
    const ult = unidos[unidos.length - 1];
    if (ult && a <= ult[1] + eps) ult[1] = Math.max(ult[1], b);
    else unidos.push([a, b]);
  }
  return unidos;
}

/** Normal izquierda de una dirección. */
const normal = (u: Vec2): Vec2 => [-u[1], u[0]];

/**
 * Esquinas de un extremo del ancho: (derecha, izquierda) en el punto P del eje. Con la dirección del
 * otro tramo del quiebro (`otro`, la del tramo que sigue en el extremo final o la del que llega en el
 * inicial), a inglete; sin ella, a escuadra.
 */
function extremo(P: Vec2, u: Vec2, b: number, otro: Vec2 | null): [Vec2, Vec2] {
  const n = normal(u);
  let m: Vec2 = n;
  let f = b / 2;
  if (otro) {
    const n2 = normal(otro);
    const c = 1 + n[0] * n2[0] + n[1] * n2[1];
    // Giro ≤ GIRO_INGLETE (120°): 1 + cos(giro) ≥ 1 + cos(120°) = 0,5 (sin Math.cos, que no da los
    // mismos bits en todos los motores, COM-12)
    if (c >= 0.5 - 1e-12) {
      m = [n[0] + n2[0], n[1] + n2[1]];
      f = b / 2 / c;
    }
  }
  return [
    [P[0] - f * m[0], P[1] - f * m[1]],
    [P[0] + f * m[0], P[1] + f * m[1]],
  ];
}

/**
 * Los anchos de las vigas de la planta k que se unen a la losa por sus caras, en orden canónico: el
 * más ancho, luego el más paralelo al eje 1 de la planta (e1, el de su primera losa) y luego por su
 * punto medio (v y luego u, a ε_geom). Así el orden no depende de los ids (renumerar), ni del de las
 * listas, ni de una traslación o un giro con el eje 1; en el cruce de dos vigas, decide a cuál van los
 * nudos y las piezas que están a la misma distancia de los dos ejes.
 */
export function anchosPlanta(ctx: Contexto, topo: Topologia, k: number, e1: Vec2): AnchoViga[] {
  const r: AnchoViga[] = [];
  const eps = ctx.op.epsSnap;
  for (const tv of topo.tramos) {
    if (tv.k !== k) continue;
    const b = anchoUnion(ctx, tv.viga);
    if (b === null) continue;
    const { A, u, len } = tv.t;
    const pts = tv.viga.puntos;
    const dir = (i: number): Vec2 | null => {
      if (i < 0 || i + 1 >= pts.length) return null;
      const [P, Q] = [pts[i]!, pts[i + 1]!];
      const L = Math.sqrt((Q[0] - P[0]) * (Q[0] - P[0]) + (Q[1] - P[1]) * (Q[1] - P[1]));
      return L > 0 ? [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L] : null;
    };
    // Trozos del tramo fuera de los muros: de los que van por su eje y del espesor de los que cruza
    const muros = unir([...sobreMuros(ctx, k, A, u, len, eps), ...cruzaMuros(ctx, k, A, u, len, b, eps)].sort((x, y) => x[0] - y[0]), eps);
    const trozos: [number, number][] = [];
    let s = 0;
    for (const [a, c] of muros) {
      if (a - s > eps) trozos.push([s, a]);
      s = Math.max(s, c);
    }
    if (len - s > eps) trozos.push([s, len]);
    for (const [desde, hasta] of trozos) {
      const P = (sg: number): Vec2 => (sg === 0 ? A : sg === len ? tv.t.B : [A[0] + sg * u[0], A[1] + sg * u[1]]);
      // A inglete sólo en un quiebro de la propia polilínea (no en un trozo cortado por un muro)
      const [d0, i0] = extremo(P(desde), u, b, desde === 0 ? dir(tv.indice - 1) : null);
      const [d1, i1] = extremo(P(hasta), u, b, hasta === len ? dir(tv.indice + 1) : null);
      r.push({ tramo: tv, viga: tv.viga.id, k, desde, hasta, b, poligono: [d0, d1, i1, i0] });
    }
  }
  const tol = ctx.op.epsGeom;
  const clave = r.map((a) => {
    const { A, u } = a.tramo.t;
    const sm = (a.desde + a.hasta) / 2;
    const M: Vec2 = [A[0] + sm * u[0], A[1] + sm * u[1]];
    return { b: a.b, al: Math.abs(u[0] * e1[0] + u[1] * e1[1]), u: M[0] * e1[0] + M[1] * e1[1], v: -M[0] * e1[1] + M[1] * e1[0] };
  });
  const orden = r.map((_, i) => i).sort((i, j) => {
    const [x, y] = [clave[i]!, clave[j]!];
    if (Math.abs(x.b - y.b) > tol) return y.b - x.b;
    if (Math.abs(x.al - y.al) > 1e-9) return y.al - x.al;
    if (Math.abs(x.v - y.v) > tol) return x.v - y.v;
    if (Math.abs(x.u - y.u) > tol) return x.u - y.u;
    return i - j;
  });
  return orden.map((i) => r[i]!);
}

/** Distancia de q al eje de un ancho (el segmento de su trozo). */
export function distanciaAlEje(q: Vec2, a: AnchoViga): number {
  const { A, u } = a.tramo.t;
  const sg = Math.max(a.desde, Math.min(a.hasta, (q[0] - A[0]) * u[0] + (q[1] - A[1]) * u[1]));
  return Math.sqrt((q[0] - A[0] - sg * u[0]) * (q[0] - A[0] - sg * u[0]) + (q[1] - A[1] - sg * u[1]) * (q[1] - A[1] - sg * u[1]));
}

/** Proyección de q sobre el eje de un ancho, en σ del tramo, dentro del trozo. */
export function sigmaEnAncho(q: Vec2, a: AnchoViga): number {
  const { A, u } = a.tramo.t;
  return Math.max(a.desde, Math.min(a.hasta, (q[0] - A[0]) * u[0] + (q[1] - A[1]) * u[1]));
}

/**
 * De varios anchos (índices en `anchos`, en el orden canónico de `anchosPlanta`) que contienen q, el
 * de eje más cercano; a igual distancia (a 1e-9), el primero.
 */
export function anchoMasCercano(q: Vec2, candidatos: readonly number[], anchos: readonly AnchoViga[]): number {
  let mejor = -1;
  let dm = Infinity;
  for (const i of candidatos) {
    const d = distanciaAlEje(q, anchos[i]!);
    if (mejor < 0 || d < dm - 1e-9 || (Math.abs(d - dm) <= 1e-9 && i < mejor)) {
      mejor = i;
      dm = Math.min(dm, d);
    }
  }
  return mejor;
}
