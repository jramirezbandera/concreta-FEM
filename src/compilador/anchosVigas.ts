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
 * Las tiras de borde (fase TB, `tirasBorde`): la losa dibujada hasta unos centímetros por fuera de
 * la cara de una viga de borde (el zuncho por el eje de los pilares y el forjado hasta la fachada) no
 * se malla. La tira entre la cara y el borde, de hasta TIRA_MAXIMA·b, va con la viga como su ancho:
 * lo que cae en ella pasa a la viga con su momento de transporte. El borde dibujado no se mueve.
 *
 * Puro y determinista.
 */
import type { Vec2, Viga } from "./fisico.ts";
import { areaConSigno, defectoPoligono, distanciaABorde, distanciaEntreSegmentos, puntoEnPoligono, type Region } from "./poligonos.ts";
import { cuerdaEnTramo, distanciaARegion, type Topologia, type TramoViga } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

/** Giro máximo de un quiebro que se une a inglete, en grados. */
export const GIRO_INGLETE = 120;

/** Ancho máximo de una tira de borde (fase TB), en anchos de la viga más allá de su cara. */
export const TIRA_MAXIMA = 1;

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
  /**
   * Fase TB: es la tira de borde de la viga, del lado `tira` de su eje (+1, a la izquierda de su
   * dirección), entre su cara y el borde de la losa. No es losa, como el ancho, pero no tiene caras.
   */
  tira?: 1 | -1;
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
    // Un corte por un muro a ≤ eps de la cara de un pilar de la cadena se lleva a la cara (fase LV2,
    // §17): entre la cara del pilar y la del muro (5 mm con un pilar de 25 bajo un muro de 26) quedaba
    // una franja de losa de astillas, que la triangulación refinaba en tercios y cambiaba al girar la
    // planta. El ancho acaba donde empieza el pilar; lo que queda del muro bajo esos milímetros es suyo.
    // Sólo con la malla de LV2 (el trazo exacto del ancho): sin ella, el arreglo ya los unía a ε_snap
    const carasPilares: number[] = [];
    for (const c of tv.cadena) {
      const pp = topo.nudos[c.nudo]!.pilar;
      const cu = pp ? cuerdaEnTramo(tv, pp) : null;
      if (cu) carasPilares.push(cu[0], cu[1]);
    }
    // Sólo hacia el muro (el ancho crece hasta la cara, nunca se acorta hacia la losa)
    const aCara = (sg: number, sentido: 1 | -1): number => {
      let mejor = sg;
      let dm = eps;
      for (const x of carasPilares) {
        const d = (sg - x) * sentido;
        if (d > 0 && d <= eps && d < dm) [mejor, dm] = [x, d];
      }
      return mejor;
    };
    if (ctx.op.refinoEsquinas)
      for (let i = 0; i < trozos.length; i++) {
        const [d, h] = trozos[i]!;
        trozos[i] = [d === 0 ? 0 : aCara(d, 1), h === len ? len : aCara(h, -1)];
      }
    for (const [desde, hasta] of trozos) {
      if (!(hasta - desde > eps)) continue;
      const P = (sg: number): Vec2 => (sg === 0 ? A : sg === len ? tv.t.B : [A[0] + sg * u[0], A[1] + sg * u[1]]);
      // A inglete sólo en un quiebro de la propia polilínea (no en un trozo cortado por un muro)
      const [d0, i0] = extremo(P(desde), u, b, desde === 0 ? dir(tv.indice - 1) : null);
      const [d1, i1] = extremo(P(hasta), u, b, hasta === len ? dir(tv.indice + 1) : null);
      r.push({ tramo: tv, viga: tv.viga.id, k, desde, hasta, b, poligono: [d0, d1, i1, i0] });
    }
  }
  return ordenCanonico(r, e1, ctx.op.epsGeom);
}

/** Los anchos en el orden canónico de `anchosPlanta`. */
function ordenCanonico(r: readonly AnchoViga[], e1: Vec2, tol: number): AnchoViga[] {
  const clave = r.map((a) => {
    const { A, u } = a.tramo.t;
    const sm = (a.desde + a.hasta) / 2;
    // Una tira, por el centro de su polígono: las dos de un trozo comparten el eje
    const M: Vec2 = a.tira ? centro(a.poligono) : [A[0] + sm * u[0], A[1] + sm * u[1]];
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

const centro = (p: readonly Vec2[]): Vec2 => p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length] as Vec2, [0, 0] as Vec2);
const punto = (A: Vec2, u: Vec2, s: number): Vec2 => [A[0] + s * u[0], A[1] + s * u[1]];
const prod = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
/** Corte de las rectas P + s·u y Q + t·v (null si son paralelas). */
function corteRectas(P: Vec2, u: Vec2, Q: Vec2, v: Vec2): Vec2 | null {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-12) return null;
  const s = ((Q[0] - P[0]) * v[1] - (Q[1] - P[1]) * v[0]) / den;
  return punto(P, u, s);
}

/**
 * Las tiras de borde de la planta k (fase TB), en orden canónico, de los anchos `anchos` (los de
 * `anchosPlanta`) en las losas de `regiones`. Un lado del borde de una losa (contorno o hueco)
 * paralelo al eje de un ancho, con la losa entre él y la viga y a más de ε_snap de su cara pero a no
 * más de TIRA_MAXIMA·b de ella, da una tira por cada trozo del ancho que recorre: el cuadrilátero
 * entre la cara y el lado, en lo que el trozo cubre del lado. La primera y la última de la línea
 * llegan hasta los extremos del lado si les quedan a no más de b/2 + TIRA_MAXIMA·b + ε_snap (las
 * esquinas: el pilar de esquina está en el eje): allí cierran contra el lado vecino, a inglete con su
 * tira si la tiene. Una tira que no es un cuadrilátero simple dentro de la losa, o que pisa un muro,
 * no se pone (esa franja se malla).
 */
export function tirasBorde(ctx: Contexto, k: number, anchos: readonly AnchoViga[], regiones: readonly Region[], e1: Vec2): AnchoViga[] {
  const eps = ctx.op.epsSnap;
  const tol = ctx.op.epsGeom;
  const r: AnchoViga[] = [];
  const muros = ctx.muros.filter((m) => k >= m.kh && k <= m.kb).map((m) => m.muro.puntos);
  for (const rg of regiones) {
    const anillos = [rg.contorno, ...rg.huecos];
    for (const [ia, an0] of anillos.entries()) {
      const an = an0.filter((q, i) => {
        const s = an0[(i + 1) % an0.length]!;
        return Math.hypot(s[0] - q[0], s[1] - q[1]) > tol;
      });
      const n = an.length;
      if (n < 3) continue;
      // Hacia la losa: a la izquierda en un contorno antihorario; en un hueco, hacia fuera de él
      const sentido = Math.sign(areaConSigno(an)) * (ia === 0 ? 1 : -1);
      const lados = an.map((P, i) => {
        const Q = an[(i + 1) % n]!;
        const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
        const e: Vec2 = [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L];
        return { P, Q, L, e, nu: [-e[1] * sentido, e[0] * sentido] as Vec2 };
      });
      // La línea de vigas de cada lado: los trozos paralelos a la distancia más corta, del lado de la losa
      type Trozo = { a: AnchoViga; s: 1 | -1; c0: number; c1: number; X0: Vec2; X1: Vec2 };
      const lineas = lados.map((l): { d: number; trozos: Trozo[] } | null => {
        let mejor = null as { d: number; trozos: Trozo[] } | null;
        for (const a of anchos) {
          if (a.tira) continue;
          const { A, u } = a.tramo.t;
          const nn: Vec2 = [-u[1], u[0]];
          if (Math.abs(l.e[0] * u[1] - l.e[1] * u[0]) > 1e-9) continue;
          const [tP, tQ] = [prod([l.P[0] - A[0], l.P[1] - A[1]], nn), prod([l.Q[0] - A[0], l.Q[1] - A[1]], nn)];
          if (Math.abs(tP - tQ) > tol) continue;
          const t = (tP + tQ) / 2;
          const d = Math.abs(t);
          if (!(d > a.b / 2 + eps && d <= a.b / 2 + TIRA_MAXIMA * a.b + tol)) continue;
          const s = t > 0 ? 1 : -1;
          // La losa, entre el lado y la viga
          if (prod(l.nu, nn) * s > -(1 - 1e-9)) continue;
          const X0 = a.desde === 0 ? A : a.desde === a.tramo.t.len ? a.tramo.t.B : punto(A, u, a.desde);
          const X1 = a.hasta === a.tramo.t.len ? a.tramo.t.B : a.hasta === 0 ? A : punto(A, u, a.hasta);
          const [r0, r1] = [prod([X0[0] - l.P[0], X0[1] - l.P[1]], l.e), prod([X1[0] - l.P[0], X1[1] - l.P[1]], l.e)];
          const [c0, c1] = [Math.max(0, Math.min(r0, r1)), Math.min(l.L, Math.max(r0, r1))];
          if (!(c1 - c0 > tol)) continue;
          const tr = { a, s: s as 1 | -1, c0, c1, X0: r0 <= r1 ? X0 : X1, X1: r0 <= r1 ? X1 : X0 };
          if (!mejor || d < mejor.d - tol) mejor = { d, trozos: [tr] };
          else if (Math.abs(d - mejor.d) <= tol) mejor.trozos.push(tr);
        }
        mejor?.trozos.sort((x, y) => x.c0 - y.c0);
        return mejor;
      });
      // Las tiras de cada lado, en su recorrido [t0, t1] del lado; las de los extremos, hasta el vértice
      const tiras = lineas.map((ln, i) => {
        if (!ln) return [];
        const l = lados[i]!;
        const ext = (b: number) => b / 2 + TIRA_MAXIMA * b + eps;
        return ln.trozos.map((tr, j) => {
          const inicio = j === 0 && tr.c0 <= ext(tr.a.b);
          const final = j === ln.trozos.length - 1 && l.L - tr.c1 <= ext(tr.a.b);
          return { ...tr, inicio, final };
        });
      });
      /** La cara de la viga de una tira (un punto y su dirección). */
      const cara = (tr: { a: AnchoViga; s: 1 | -1 }): { O: Vec2; u: Vec2 } => {
        const { A, u } = tr.a.tramo.t;
        return { O: [A[0] - tr.s * (tr.a.b / 2) * u[1], A[1] + tr.s * (tr.a.b / 2) * u[0]], u };
      };
      /** Pie en la cara de un punto X del eje (o del lado), en perpendicular. */
      const pie = (X: Vec2, c: { O: Vec2; u: Vec2 }): Vec2 => punto(c.O, c.u, prod([X[0] - c.O[0], X[1] - c.O[1]], c.u));
      // Esquinas en cada vértice i (entre el lado i − 1 y el i), una vez: a inglete si las dos tiras llegan a él
      const esquinas = an.map((V, i) => {
        const ip = (i + n - 1) % n;
        const [ta, tb] = [tiras[ip]!.at(-1), tiras[i]![0]];
        const fin = ta?.final ? { tr: ta, c: cara(ta) } : null;
        const ini = tb?.inicio ? { tr: tb, c: cara(tb) } : null;
        const inglete = fin && ini ? corteRectas(fin.c.O, fin.c.u, ini.c.O, ini.c.u) : null;
        const contra = (c: { O: Vec2; u: Vec2 }, vecino: (typeof lados)[number]): Vec2 => {
          // Contra el lado vecino si la cara lo corta dentro de él; si no, en perpendicular por el vértice
          const X = corteRectas(c.O, c.u, vecino.P, vecino.e);
          if (X) {
            const s = prod([X[0] - vecino.P[0], X[1] - vecino.P[1]], vecino.e);
            if (s >= -tol && s <= vecino.L + tol) return X;
          }
          return pie(V, c);
        };
        return {
          fin: fin ? (inglete ?? contra(fin.c, lados[i]!)) : null,
          ini: ini ? (inglete ?? contra(ini.c, lados[ip]!)) : null,
        };
      });
      for (const [i, ts] of tiras.entries()) {
        const l = lados[i]!;
        for (const tr of ts) {
          const c = cara(tr);
          const enLado = (X: Vec2): Vec2 => punto(l.P, l.e, prod([X[0] - l.P[0], X[1] - l.P[1]], l.e));
          const E0 = tr.inicio ? l.P : enLado(tr.X0);
          const E1 = tr.final ? l.Q : enLado(tr.X1);
          const F0 = tr.inicio ? esquinas[i]!.ini! : pie(tr.X0, c);
          const F1 = tr.final ? esquinas[(i + 1) % n]!.fin! : pie(tr.X1, c);
          let poli: Vec2[] = [E0, E1, F1, F0];
          if (areaConSigno(poli) < 0) poli = [F0, F1, E1, E0];
          // Un cuadrilátero simple, dentro de la losa, sin vértices de la losa dentro ni muros
          if (defectoPoligono(poli, tol) || !(Math.abs(areaConSigno(poli)) > tol * tol)) continue;
          if (poli.some((q) => distanciaARegion(q, rg) > tol)) continue;
          if (anillos.some((x) => x.some((q) => puntoEnPoligono(q, poli) && distanciaABorde(q, poli) > tol))) continue;
          if (muros.some((p) => p.some((q, j) => j > 0 && (puntoEnPoligono(q, poli) || poli.some((A, m) => distanciaEntreSegmentos(p[j - 1]!, q, A, poli[(m + 1) % 4]!) === 0))))) continue;
          r.push({ tramo: tr.a.tramo, viga: tr.a.viga, k, desde: tr.a.desde, hasta: tr.a.hasta, b: tr.a.b, poligono: poli, tira: tr.s });
        }
      }
    }
  }
  return ordenCanonico(r, e1, tol);
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
