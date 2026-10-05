/**
 * Paños de forjado unidireccional (C4, D2, H46, E2-3): viguetas como barras, sus nudos y el reparto
 * de las cargas del paño. Corre tras la topología de C1 y el ajuste de los muros, y antes de las
 * losas: sus nudos son nudos de C1 más (fijos en el arreglo de las losas, estaciones de los muros).
 *
 * 1. Contorno unido (C2-b): cada vértice del paño a ≤ ε_snap de un nudo de su planta va a ese nudo;
 *    si no, a ≤ ε_snap del eje de una viga o de un muro, a él (al cruce, si son dos). Aviso si se
 *    mueve más de ε_geom.
 * 2. Grupos (C4-a): los paños de una planta con la misma dirección (salvo el sentido) y el mismo
 *    intereje que comparten un lado. Cada grupo tiene un marco (d, n): d, la dirección de las
 *    viguetas con su ángulo en [0°, 180°); n, d girada 90°. En ese marco, σ = X·d y η = X·n.
 * 3. Rectas: η_j = η_c + (j − (n_v − 1)/2)·s, con η_c el centro del ancho W del grupo en η y
 *    n_v = máx(1, round(W/s)). Cada recta se recorta a cada paño (sin huecos) por la regla del
 *    semiplano, y cada trozo de más de 2·ε_snap es una vigueta, salvo si va por el eje de una viga o
 *    de un muro paralelos (ya está ahí).
 * 4. Apoyos de cada vigueta (C4-b): sus extremos y los cruces con ejes de vigas y muros y con las
 *    huellas de pilar por las que pasa. Nudo de cada uno (C4-d): el del pilar (en su huella); si no,
 *    uno a ≤ ε_snap que ya exista; si no, uno nuevo sobre la viga (que se parte), sobre el muro (en
 *    su vértice si lo tiene a ≤ ε_snap) o en el borde de la losa; si no, un extremo libre. Un extremo
 *    libre en el borde de otro paño es un error (dos paños se separan por una viga).
 * 5. Receptores de borde (C4-e): los lados del paño paralelos a d que van sobre el eje de una viga,
 *    por los tramos de viga que los cubren.
 * 6. Reparto (C4-e, `RepartoPano`): en el marco del paño, por franjas en σ entre cortes (vértices,
 *    extremos de viguetas y de receptores de borde y, en una zona, sus vértices), la sección del
 *    paño son intervalos en η con lados lineales. En cada intervalo, los receptores (las viguetas
 *    que cubren la franja y los lados que son receptores de borde) se reparten la carga por la regla
 *    de la palanca entre consecutivos; entre un lado que no es receptor y el receptor más cercano, a
 *    éste entera, con el momento de transporte; un intervalo sin receptores va al nudo más cercano
 *    de la vigueta más próxima. Cada receptor recibe por franja una carga trapecial con la misma
 *    fuerza y el mismo momento que la exacta (integrales de polígonos de orden 2), así que «sin
 *    pérdidas» es exacto.
 *
 * Puro y determinista: los paños van en el orden de `ctx.panos` (por id) y las viguetas, por paño,
 * en orden de (η, σ). Las comparaciones con umbral llevan holgura.
 */
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Vec2 } from "./fisico.ts";
import { cortarTramos, cuerdaHuella, dist, distanciaAHuella, RejillaHash, tramo, type Tramo2D } from "./geometria2d.ts";
import { defectoPoligono, distanciaASegmento, momentos2Interseccion, momentos2Poligono, type Momentos2, type Region } from "./poligonos.ts";
import { distanciaARegion, ordenarCadena, type PuntoPilar, type Topologia, type TramoViga } from "./topologia.ts";
import type { Contexto } from "./validar.ts";

/** Qué sujeta un nudo de vigueta. */
export type ApoyoVigueta = "pilar" | "viga" | "muro" | "losa" | "nudo" | "libre";

/** Un nudo de una vigueta. */
export interface EslabonVigueta {
  /** Estación en la recta del marco (σ) del punto de la vigueta que se une al nudo. */
  sigma: number;
  nudo: number;
  apoyo: ApoyoVigueta;
  /** Pilar con huella (zona rígida de C1-a), si el nudo es suyo. */
  pilar?: PuntoPilar;
}

export interface ViguetaU {
  /** `<paño>:v<n>`, con n por orden de (η, σ) dentro del paño. */
  id: string;
  /** Índice del paño en `ctx.panos`. */
  pano: number;
  k: number;
  /** Marco de su grupo: P(σ) = σ·d + η·n. */
  d: Vec2;
  n: Vec2;
  eta: number;
  /** Extremos en σ (a < b). */
  a: number;
  b: number;
  /** Nudos por σ creciente: los extremos y los apoyos interiores. */
  cadena: EslabonVigueta[];
}

/** Lado de un paño paralelo a sus viguetas sobre el eje de una viga: receptor de borde (C4-e). */
export interface BordePano {
  eta: number;
  /** Tramo del lado cubierto por esta viga, en σ. */
  a: number;
  b: number;
  tramo: TramoViga;
}

export interface PanosU {
  viguetas: ViguetaU[];
  /** Región unida de cada paño (por índice en `ctx.panos`), en planta. */
  regiones: Region[];
  /** Marco del grupo de cada paño. */
  marcos: { d: Vec2; n: Vec2 }[];
  /** Receptores de borde de cada paño. */
  bordes: BordePano[][];
  /** Viguetas de cada paño (índices en `viguetas`), por orden de (η, σ). */
  porPano: number[][];
  /** Nudos creados por las viguetas. */
  nudosNuevos: number;
  /** Viguetas con un solo apoyo (voladizos que sujeta una sola pieza). */
  voladizos: number;
}

const cm = (d: number) => `${(d * 100).toFixed(1)} cm`;
const punto = (d: Vec2, n: Vec2, s: number, e: number): Vec2 => [s * d[0] + e * n[0], s * d[1] + e * n[1]];
/** d con su ángulo en [0°, 180°), sin −0. */
const canonica = (d: Vec2): Vec2 => (d[1] > 0 || (d[1] === 0 && d[0] > 0) ? [d[0] + 0, d[1] + 0] : [0 - d[0], 0 - d[1]]);
const anillos = (r: Region): readonly (readonly Vec2[])[] => [r.contorno, ...r.huecos];

class UnionFind {
  private readonly padre: number[];
  constructor(n: number) {
    this.padre = Array.from({ length: n }, (_, i) => i);
  }
  raiz(i: number): number {
    while (this.padre[i] !== i) i = this.padre[i] = this.padre[this.padre[i]!]!;
    return i;
  }
  unir(a: number, b: number): void {
    const [ra, rb] = [this.raiz(a), this.raiz(b)];
    if (ra !== rb) this.padre[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** Proyección de V sobre la recta A + t·u (u unitario). */
const proyectarRecta = (V: Vec2, A: Vec2, u: Vec2): Vec2 => {
  const t = (V[0] - A[0]) * u[0] + (V[1] - A[1]) * u[1];
  return [A[0] + t * u[0], A[1] + t * u[1]];
};

/** Cruce de dos rectas A + t·u y B + s·v, o null si son paralelas. */
const cruceRectas = (A: Vec2, u: Vec2, B: Vec2, v: Vec2): Vec2 | null => {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((B[0] - A[0]) * v[1] - (B[1] - A[1]) * v[0]) / den;
  return [A[0] + t * u[0], A[1] + t * u[1]];
};

/** Estaciones σ donde la recta η = eta corta los anillos (regla del semiplano: η ≤ eta cuenta como abajo). */
function cortesRecta(anillosSE: readonly (readonly Vec2[])[], eta: number): number[] {
  const r: number[] = [];
  for (const p of anillosSE)
    for (let i = 0, m = p.length; i < m; i++) {
      const [P, Q] = [p[i]!, p[(i + 1) % m]!];
      const eP = P[1] - eta;
      const eQ = Q[1] - eta;
      if (eP > 0 === eQ > 0) continue;
      r.push(P[0] + ((Q[0] - P[0]) * eP) / (eP - eQ));
    }
  return r.sort((x, y) => x - y);
}

/** Lo que el compilador sabe de una planta con paños. */
interface PlantaP {
  tramos: TramoViga[];
  ejesMuros: { w: number; t: Tramo2D }[];
  verticesMuros: Vec2[];
  pilares: PuntoPilar[];
  losas: Region[];
  /** Nudos de la planta en la cota (de C1 y los nuevos), en una rejilla hash. */
  hash: RejillaHash;
}

export function construirPanos(ctx: Contexto, topo: Topologia, puntosMuros: readonly Vec2[][], diag: Diagnosticos): PanosU {
  const { epsGeom, epsSnap } = ctx.op;
  const r: PanosU = {
    viguetas: [],
    regiones: ctx.panos.map((p) => p.region),
    marcos: ctx.panos.map((p) => ({ d: canonica(p.d), n: [-canonica(p.d)[1], canonica(p.d)[0]] })),
    bordes: ctx.panos.map(() => []),
    porPano: ctx.panos.map(() => []),
    nudosNuevos: 0,
    voladizos: 0,
  };
  if (!ctx.panos.length) return r;
  const nudosAntes = topo.nudos.length;
  const lado = Math.max(1, 4 * epsSnap);
  const P = (n: number): Vec2 => [topo.nudos[n]!.x, topo.nudos[n]!.y];

  // Lo que hay en cada planta con paños
  const plantas = new Map<number, PlantaP>();
  for (const k of [...new Set(ctx.panos.map((p) => p.k))].sort((a, b) => b - a)) {
    const ejesMuros: PlantaP["ejesMuros"] = [];
    const verticesMuros: Vec2[] = [];
    ctx.muros.forEach((m, w) => {
      if (k < m.kh || k > m.kb) return;
      const p = puntosMuros[w]!;
      for (let i = 0; i + 1 < p.length; i++) ejesMuros.push({ w, t: tramo(p[i]!, p[i + 1]!) });
      verticesMuros.push(...p);
    });
    const hash = new RejillaHash(lado);
    const pilares: PuntoPilar[] = [];
    topo.nudos.forEach((nd, n) => {
      if (nd.k !== k || nd.z !== undefined) return;
      hash.insertar(n, nd.x, nd.y, nd.x, nd.y);
      if (nd.pilar && nd.pilar.nudo === n) pilares.push(nd.pilar);
    });
    plantas.set(k, { tramos: topo.tramos.filter((t) => t.k === k), ejesMuros, verticesMuros, pilares, losas: ctx.losas.filter((l) => ctx.planta.get(l.losa.planta) === k).map((l) => l.region), hash });
  }
  const nudoCercano = (k: number, X: Vec2, conPilares: boolean): number => {
    const pl = plantas.get(k)!;
    let mejor = -1;
    let dmin = Infinity;
    for (const n of pl.hash.buscar(X[0] - epsSnap, X[1] - epsSnap, X[0] + epsSnap, X[1] + epsSnap)) {
      if (!conPilares && topo.nudos[n]!.pilar?.huella.forma) continue;
      const d = dist(X, P(n));
      if (d <= epsSnap && d < dmin) [mejor, dmin] = [n, d];
    }
    return mejor;
  };

  // 1. Contorno unido
  const unirVertice = (k: number, V: Vec2): Vec2 => {
    const n = nudoCercano(k, V, true);
    if (n >= 0) return P(n);
    const pl = plantas.get(k)!;
    const rectas: { A: Vec2; u: Vec2; d: number }[] = [];
    for (const tv of pl.tramos) {
      const d = distanciaASegmento(V, tv.t.A, tv.t.B);
      if (d <= epsSnap) rectas.push({ A: tv.t.A, u: tv.t.u, d });
    }
    for (const { t } of pl.ejesMuros) {
      const d = distanciaASegmento(V, t.A, t.B);
      if (d <= epsSnap) rectas.push({ A: t.A, u: t.u, d });
    }
    if (!rectas.length) return V;
    let mejor: { X: Vec2; d: number } | null = null;
    for (let i = 0; i < rectas.length; i++)
      for (let j = i + 1; j < rectas.length; j++) {
        const X = cruceRectas(rectas[i]!.A, rectas[i]!.u, rectas[j]!.A, rectas[j]!.u);
        if (!X) continue;
        const d = dist(V, X);
        if (d <= epsSnap && (!mejor || d < mejor.d)) mejor = { X, d };
      }
    if (mejor) return mejor.X;
    let cerca = rectas[0]!;
    for (const x of rectas) if (x.d < cerca.d) cerca = x;
    return proyectarRecta(V, cerca.A, cerca.u);
  };
  const validos: boolean[] = ctx.panos.map(() => true);
  ctx.panos.forEach((pc, i) => {
    let mov = 0;
    const unir = (anillo: readonly Vec2[]): Vec2[] => {
      const q: Vec2[] = [];
      for (const V of anillo) {
        const X = unirVertice(pc.k, V);
        mov = Math.max(mov, dist(V, X));
        if (!q.length || dist(q[q.length - 1]!, X) > epsGeom) q.push(X);
      }
      if (q.length > 1 && dist(q[0]!, q[q.length - 1]!) <= epsGeom) q.pop();
      return q;
    };
    const reg: Region = { contorno: unir(pc.region.contorno), huecos: pc.region.huecos.map(unir) };
    const defecto = anillos(reg)
      .map((p) => defectoPoligono(p, epsGeom))
      .find((x) => x);
    if (defecto) {
      diag.error("pano/degenerado", `El paño ${pc.pano.id} (o uno de sus huecos) ${defecto} al unir sus vértices a lo cercano (tolerancia ${cm(epsSnap)}).`, [pc.pano.id]);
      validos[i] = false;
      return;
    }
    if (mov > epsGeom) diag.aviso("pano/ajuste", `El paño ${pc.pano.id} se ajusta a lo que lo rodea: sus vértices se mueven hasta ${cm(mov)} (C2-b).`, [pc.pano.id], { distancia: mov });
    r.regiones[i] = reg;
  });
  if (diag.hayErrores) return r;

  // 2. Grupos: misma planta, dirección (salvo el sentido) e intereje, y un lado común
  const uf = new UnionFind(ctx.panos.length);
  const mismoMarco = (i: number, j: number) => {
    const [a, b] = [r.marcos[i]!.d, r.marcos[j]!.d];
    const [si, sj] = [ctx.panos[i]!.pano.intereje, ctx.panos[j]!.pano.intereje];
    return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12 && Math.abs(si - sj) <= 1e-12 * si;
  };
  const compartenLado = (x: Region, y: Region): boolean => {
    for (const p of anillos(x))
      for (let i = 0; i < p.length; i++) {
        const t = tramo(p[i]!, p[(i + 1) % p.length]!);
        for (const q of anillos(y))
          for (let j = 0; j < q.length; j++) {
            const [C, D] = [q[j]!, q[(j + 1) % q.length]!];
            const dC = Math.abs((C[0] - t.A[0]) * t.u[1] - (C[1] - t.A[1]) * t.u[0]);
            const dD = Math.abs((D[0] - t.A[0]) * t.u[1] - (D[1] - t.A[1]) * t.u[0]);
            if (dC > epsSnap || dD > epsSnap) continue;
            const sC = (C[0] - t.A[0]) * t.u[0] + (C[1] - t.A[1]) * t.u[1];
            const sD = (D[0] - t.A[0]) * t.u[0] + (D[1] - t.A[1]) * t.u[1];
            if (Math.min(t.len, Math.max(sC, sD)) - Math.max(0, Math.min(sC, sD)) > epsSnap) return true;
          }
      }
    return false;
  };
  for (let i = 0; i < ctx.panos.length; i++)
    for (let j = i + 1; j < ctx.panos.length; j++)
      if (validos[i] && validos[j] && ctx.panos[i]!.k === ctx.panos[j]!.k && mismoMarco(i, j) && compartenLado(r.regiones[i]!, r.regiones[j]!)) uf.unir(i, j);
  const grupos = new Map<number, number[]>();
  ctx.panos.forEach((_, i) => {
    if (!validos[i]) return;
    const g = uf.raiz(i);
    let l = grupos.get(g);
    if (!l) grupos.set(g, (l = []));
    l.push(i);
  });
  // El marco del grupo: el de su primer paño
  for (const g of grupos.values()) for (const i of g) r.marcos[i] = r.marcos[g[0]!]!;

  // Tipo de apoyo de un nudo que ya existe
  const apoyoNuevo = new Map<number, ApoyoVigueta>();
  const apoyoDe = (n: number): ApoyoVigueta => {
    const a = apoyoNuevo.get(n);
    if (a) return a;
    const nd = topo.nudos[n]!;
    if (nd.pilar) return "pilar";
    if (topo.vigasEn.has(n)) return "viga";
    return "nudo";
  };
  const tramosTocados = new Set<TramoViga>();
  const nuevoNudo = (k: number, X: Vec2, apoyo: ApoyoVigueta): number => {
    topo.nudos.push({ k, x: X[0], y: X[1], fisicos: new Set(), pilar: null });
    const n = topo.nudos.length - 1;
    plantas.get(k)!.hash.insertar(n, X[0], X[1], X[0], X[1]);
    apoyoNuevo.set(n, apoyo);
    return n;
  };
  const enTramo = (tv: TramoViga, X: Vec2, k: number): number => {
    const n = nuevoNudo(k, X, "viga");
    tv.partes.push(n);
    tramosTocados.add(tv);
    let s = topo.vigasEn.get(n);
    if (!s) topo.vigasEn.set(n, (s = new Set()));
    s.add(tv.viga.id);
    return n;
  };
  /** Pilar con huella (o sin ella) a ≤ ε_snap de X. */
  const pilarEn = (k: number, X: Vec2): PuntoPilar | null => {
    let mejor: PuntoPilar | null = null;
    let dmin = Infinity;
    for (const pp of plantas.get(k)!.pilares) {
      if (distanciaAHuella(X, pp.huella) > epsSnap) continue;
      const d = dist(X, pp.huella.c);
      if (d < dmin) [mejor, dmin] = [pp, d];
    }
    return mejor;
  };

  /** Nudo de un extremo de vigueta en X (C4-d), o null si cae libre en el borde de otro paño. */
  const nudoExtremo = (k: number, X: Vec2, pano: number): { nudo: number; apoyo: ApoyoVigueta; pilar?: PuntoPilar } | { otro: number } => {
    const pp = pilarEn(k, X);
    if (pp) return { nudo: pp.nudo, apoyo: "pilar", ...(pp.huella.forma ? { pilar: pp } : {}) };
    const n = nudoCercano(k, X, false);
    if (n >= 0) return { nudo: n, apoyo: apoyoDe(n) };
    const pl = plantas.get(k)!;
    let mejor: { tv: TramoViga; X: Vec2; d: number } | null = null;
    for (const tv of pl.tramos) {
      const s = (X[0] - tv.t.A[0]) * tv.t.u[0] + (X[1] - tv.t.A[1]) * tv.t.u[1];
      if (!(s > epsGeom && s < tv.t.len - epsGeom)) continue;
      const Y: Vec2 = [tv.t.A[0] + s * tv.t.u[0], tv.t.A[1] + s * tv.t.u[1]];
      const d = dist(X, Y);
      if (d <= epsSnap && (!mejor || d < mejor.d)) mejor = { tv, X: Y, d };
    }
    if (mejor) return { nudo: enTramo(mejor.tv, mejor.X, k), apoyo: "viga" };
    // Muro: en su vértice si lo tiene a ≤ ε_snap; si no, sobre su eje
    for (const V of pl.verticesMuros) if (dist(X, V) <= epsSnap) return { nudo: nuevoNudo(k, V, "muro"), apoyo: "muro" };
    let muro: { X: Vec2; d: number } | null = null;
    for (const { t } of pl.ejesMuros) {
      const s = (X[0] - t.A[0]) * t.u[0] + (X[1] - t.A[1]) * t.u[1];
      if (!(s > 0 && s < t.len)) continue;
      const Y: Vec2 = [t.A[0] + s * t.u[0], t.A[1] + s * t.u[1]];
      const d = dist(X, Y);
      if (d <= epsSnap && (!muro || d < muro.d)) muro = { X: Y, d };
    }
    if (muro) return { nudo: nuevoNudo(k, muro.X, "muro"), apoyo: "muro" };
    if (pl.losas.some((reg) => distanciaARegion(X, reg) <= epsSnap)) return { nudo: nuevoNudo(k, X, "losa"), apoyo: "losa" };
    const otro = ctx.panos.findIndex((p, j) => j !== pano && validos[j] && p.k === k && distanciaARegion(X, r.regiones[j]!) <= epsSnap);
    if (otro >= 0) return { otro };
    return { nudo: nuevoNudo(k, X, "libre"), apoyo: "libre" };
  };

  // 3 y 4. Rectas, viguetas y sus apoyos, grupo a grupo
  const sinApoyo = new Map<number, number>();
  const voladizos = new Map<number, number>();
  /** Viguetas con un solo apoyo: un voladizo, salvo si sigue en la misma recta por otra vigueta (continua). */
  const unApoyo: { v: number; nudo: number }[] = [];
  const contiguos = new Map<string, [number, number]>();
  for (const g of [...grupos.values()].sort((a, b) => a[0]! - b[0]!)) {
    const { d, n } = r.marcos[g[0]!]!;
    const s = ctx.panos[g[0]!]!.pano.intereje;
    let [lo, hi] = [Infinity, -Infinity];
    for (const i of g)
      for (const V of r.regiones[i]!.contorno) {
        const e = V[0] * n[0] + V[1] * n[1];
        [lo, hi] = [Math.min(lo, e), Math.max(hi, e)];
      }
    const W = hi - lo;
    const nv = Math.max(1, Math.floor(W / s + 0.5 + 1e-9));
    const ec = (lo + hi) / 2;
    const etas = Array.from({ length: nv }, (_, j) => ec + (j - (nv - 1) / 2) * s);
    for (const i of g) {
      const pc = ctx.panos[i]!;
      const k = pc.k;
      const pl = plantas.get(k)!;
      const se = anillos(r.regiones[i]!).map((p) => p.map((V) => [V[0] * d[0] + V[1] * d[1], V[0] * n[0] + V[1] * n[1]] as Vec2));
      const tramosV: { eta: number; a: number; b: number }[] = [];
      for (const eta of etas) {
        const c = cortesRecta(se, eta);
        for (let j = 0; j + 1 < c.length; j += 2) {
          const [a, b] = [c[j]!, c[j + 1]!];
          if (!(b - a > 2 * epsSnap)) continue;
          // Por el eje de una viga o de un muro paralelos: ya están ahí
          const M = punto(d, n, (a + b) / 2, eta);
          const sobreEje = [...pl.tramos.map((tv) => tv.t), ...pl.ejesMuros.map((x) => x.t)].some(
            (t) => Math.abs(t.u[0] * d[1] - t.u[1] * d[0]) <= 1e-9 && distanciaASegmento(M, t.A, t.B) <= epsSnap,
          );
          if (!sobreEje) tramosV.push({ eta, a, b });
        }
      }
      tramosV.sort((x, y) => x.eta - y.eta || x.a - y.a);
      for (const tv0 of tramosV) {
        const { eta, a, b } = tv0;
        const A = punto(d, n, a, eta);
        const B = punto(d, n, b, eta);
        const recta = tramo(A, B);
        const eslabones: (EslabonVigueta & { extremo: boolean })[] = [];
        let libreEnOtro = -1;
        for (const [sg, X] of [
          [a, A],
          [b, B],
        ] as const) {
          const e = nudoExtremo(k, X, i);
          if ("otro" in e) {
            libreEnOtro = e.otro;
            continue;
          }
          eslabones.push({ sigma: sg, nudo: e.nudo, apoyo: e.apoyo, ...(e.pilar ? { pilar: e.pilar } : {}), extremo: true });
        }
        if (libreEnOtro >= 0) {
          const [x, y] = [pc.pano.id, ctx.panos[libreEnOtro]!.pano.id].sort();
          contiguos.set(`${x}|${y}`, [i, libreEnOtro]);
          continue;
        }
        // Apoyos interiores: cruces con vigas y muros, y pilares por los que pasa
        const interior = (sg: number) => sg - a > epsSnap && b - sg > epsSnap;
        for (const tv of pl.tramos) {
          const c = cortarTramos(recta, tv.t);
          if (!c || !interior(a + c.sp) || c.sq < -epsSnap || c.sq > tv.t.len + epsSnap) continue;
          const X = punto(d, n, a + c.sp, eta);
          const pp = pilarEn(k, X);
          if (pp) continue; // el pilar lo pone su huella, abajo
          const m = nudoCercano(k, X, false);
          const nudo = m >= 0 ? m : enTramo(tv, [tv.t.A[0] + c.sq * tv.t.u[0], tv.t.A[1] + c.sq * tv.t.u[1]], k);
          eslabones.push({ sigma: a + c.sp, nudo, apoyo: m >= 0 ? apoyoDe(m) : "viga", extremo: false });
        }
        for (const { t } of pl.ejesMuros) {
          const c = cortarTramos(recta, t);
          if (!c || !interior(a + c.sp) || c.sq < 0 || c.sq > t.len) continue;
          const X = punto(d, n, a + c.sp, eta);
          if (pilarEn(k, X)) continue;
          const m = nudoCercano(k, X, false);
          const nudo = m >= 0 ? m : nuevoNudo(k, [t.A[0] + c.sq * t.u[0], t.A[1] + c.sq * t.u[1]], "muro");
          eslabones.push({ sigma: a + c.sp, nudo, apoyo: m >= 0 ? apoyoDe(m) : "muro", extremo: false });
        }
        for (const pp of pl.pilares) {
          const sc = (pp.huella.c[0] - A[0]) * recta.u[0] + (pp.huella.c[1] - A[1]) * recta.u[1];
          if (!interior(a + sc)) continue;
          const cu = cuerdaHuella(A, recta.u, pp.huella);
          const cerca = cu ? true : distanciaAHuella(punto(d, n, a + sc, eta), pp.huella) <= epsSnap;
          if (!cerca) continue;
          eslabones.push({ sigma: a + sc, nudo: pp.nudo, apoyo: "pilar", ...(pp.huella.forma ? { pilar: pp } : {}), extremo: false });
        }
        // Por σ; dos seguidos en el mismo nudo son uno (el extremo, si lo es alguno)
        eslabones.sort((x, y) => x.sigma - y.sigma || Number(y.extremo) - Number(x.extremo));
        const cadena: EslabonVigueta[] = [];
        for (const e of eslabones) {
          const ult = cadena[cadena.length - 1];
          if (ult && ult.nudo === e.nudo) {
            if (e.extremo) cadena[cadena.length - 1] = { sigma: e.sigma, nudo: e.nudo, apoyo: e.apoyo, ...(e.pilar ? { pilar: e.pilar } : {}) };
            continue;
          }
          cadena.push({ sigma: e.sigma, nudo: e.nudo, apoyo: e.apoyo, ...(e.pilar ? { pilar: e.pilar } : {}) });
        }
        if (cadena.length < 2) continue; // una astilla junto a un vértice: su carga va a las vecinas
        const apoyos = cadena.filter((x) => x.apoyo !== "libre").length;
        if (apoyos === 0) {
          sinApoyo.set(i, (sinApoyo.get(i) ?? 0) + 1);
          continue;
        }
        const id = `${pc.pano.id}:v${r.porPano[i]!.length + 1}`;
        if (apoyos === 1) unApoyo.push({ v: r.viguetas.length, nudo: cadena.find((x) => x.apoyo !== "libre")!.nudo });
        for (const x of cadena) topo.nudos[x.nudo]!.fisicos.add(pc.pano.id);
        r.porPano[i]!.push(r.viguetas.length);
        r.viguetas.push({ id, pano: i, k, d, n, eta, a, b, cadena });
      }
    }
  }
  for (const { v, nudo } of unApoyo) {
    const x = r.viguetas[v]!;
    const sigue = r.viguetas.some((o, w) => w !== v && o.k === x.k && o.d === x.d && Math.abs(o.eta - x.eta) <= 1e-9 && o.cadena.some((c) => c.nudo === nudo));
    if (!sigue) voladizos.set(x.pano, (voladizos.get(x.pano) ?? 0) + 1);
  }
  for (const [x, y] of [...contiguos.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]))
    diag.error(
      "pano/contiguo-sin-apoyo",
      `Las viguetas del paño ${ctx.panos[x]!.pano.id} acaban en el borde del paño ${ctx.panos[y]!.pano.id} sin una viga, un muro ni una losa entre ellos (C4-b). Ponga una viga (o un zuncho) en el lado común, o dibuje los dos como un solo paño.`,
      [ctx.panos[x]!.pano.id, ctx.panos[y]!.pano.id],
    );
  for (const [i, c] of [...sinApoyo].sort((p, q) => p[0] - q[0]))
    diag.error("pano/vigueta-sin-apoyo", `${c} viguetas del paño ${ctx.panos[i]!.pano.id} no se apoyan en ninguna viga, muro, pilar ni losa (C4-b): serían un mecanismo. El contorno del paño tiene que ir por los ejes de sus apoyos.`, [ctx.panos[i]!.pano.id]);
  for (const [i, c] of [...voladizos].sort((p, q) => p[0] - q[0]))
    diag.aviso(
      "pano/vigueta-en-voladizo",
      `${c} viguetas del paño ${ctx.panos[i]!.pano.id} se apoyan en un solo punto y no siguen en otra vigueta: trabajan en voladizo y su giro sólo lo coarta la pieza que las sujeta (con una viga, su torsión). Compruebe que no les falta un apoyo.`,
      [ctx.panos[i]!.pano.id],
    );
  ctx.panos.forEach((_, i) => r.porPano[i]!.length === 0 && validos[i] && !sinApoyo.has(i) && ![...contiguos.values()].some(([x]) => x === i) && diag.error("pano/sin-viguetas", `El paño ${ctx.panos[i]!.pano.id} no tiene ninguna vigueta: es más estrecho que su intereje en toda su longitud o va entero por ejes de vigas.`, [ctx.panos[i]!.pano.id]));
  r.voladizos = [...voladizos.values()].reduce((x, y) => x + y, 0);
  if (diag.hayErrores) return r;

  // Las vigas partidas por las viguetas
  for (const tv of [...tramosTocados].sort((x, y) => x.id - y.id)) ordenarCadena(ctx, topo.nudos, tv, diag);

  // 5. Receptores de borde: lados paralelos a d sobre el eje de una viga
  ctx.panos.forEach((pc, i) => {
    if (!validos[i]) return;
    const { d, n } = r.marcos[i]!;
    const pl = plantas.get(pc.k)!;
    for (const p of anillos(r.regiones[i]!))
      for (let j = 0; j < p.length; j++) {
        const [V, U] = [p[j]!, p[(j + 1) % p.length]!];
        const [eV, eU] = [V[0] * n[0] + V[1] * n[1], U[0] * n[0] + U[1] * n[1]];
        if (Math.abs(eV - eU) > 1e-9 * Math.max(1, Math.abs(eV))) continue;
        const [sV, sU] = [V[0] * d[0] + V[1] * d[1], U[0] * d[0] + U[1] * d[1]];
        const [lo, hi] = [Math.min(sV, sU), Math.max(sV, sU)];
        for (const tv of pl.tramos) {
          const t = tv.t;
          if (Math.abs(t.u[0] * d[1] - t.u[1] * d[0]) > 1e-9) continue;
          const dl = (X: Vec2) => Math.abs((X[0] - t.A[0]) * t.u[1] - (X[1] - t.A[1]) * t.u[0]);
          if (dl(V) > epsSnap || dl(U) > epsSnap) continue;
          const [sa, sb] = [t.A[0] * d[0] + t.A[1] * d[1], t.B[0] * d[0] + t.B[1] * d[1]];
          const a = Math.max(lo, Math.min(sa, sb));
          const b = Math.min(hi, Math.max(sa, sb));
          if (b - a > epsGeom) r.bordes[i]!.push({ eta: (eV + eU) / 2, a, b, tramo: tv });
        }
      }
    r.bordes[i]!.sort((x, y) => x.eta - y.eta || x.a - y.a || x.tramo.id - y.tramo.id);
  });
  r.nudosNuevos = topo.nudos.length - nudosAntes;
  return r;
}

/**
 * Trozos del segmento AB por paño: se corta por los lados de todos los paños y cada trozo va al
 * primero (por índice) que contiene su punto medio, también en su borde. Así una carga que corre
 * por el lado común de dos paños se reparte una sola vez.
 */
export function trozosEnPanos(A: Vec2, B: Vec2, panos: readonly { i: number; region: Region }[]): { i: number; A: Vec2; B: Vec2 }[] {
  const L = dist(A, B);
  if (!(L > 0)) return [];
  const t = tramo(A, B);
  const ts = new Set<number>([0, 1]);
  for (const { region } of panos)
    for (const p of anillos(region))
      for (let k = 0, m = p.length; k < m; k++) {
        const e = tramo(p[k]!, p[(k + 1) % m]!);
        const c = cortarTramos(t, e);
        if (c && c.sp > 0 && c.sp < L && c.sq >= 0 && c.sq <= e.len) ts.add(c.sp / L);
        // Un vértice del paño sobre el segmento (un lado que lo toca o corre por él)
        const s = (p[k]![0] - A[0]) * t.u[0] + (p[k]![1] - A[1]) * t.u[1];
        if (s > 0 && s < L && Math.abs((p[k]![0] - A[0]) * t.u[1] - (p[k]![1] - A[1]) * t.u[0]) <= 1e-9) ts.add(s / L);
      }
  const orden = [...ts].sort((x, y) => x - y);
  const trozos: { i: number; u0: number; u1: number }[] = [];
  const X = (u: number): Vec2 => (u === 0 ? A : u === 1 ? B : [A[0] + u * (B[0] - A[0]), A[1] + u * (B[1] - A[1])]);
  for (let j = 0; j + 1 < orden.length; j++) {
    const [u0, u1] = [orden[j]!, orden[j + 1]!];
    if (!((u1 - u0) * L > 1e-12)) continue;
    const M = X((u0 + u1) / 2);
    const p = panos.find(({ region }) => distanciaARegion(M, region) <= 1e-9);
    if (!p) continue;
    const ult = trozos[trozos.length - 1];
    if (ult && ult.i === p.i && ult.u1 === u0) ult.u1 = u1;
    else trozos.push({ i: p.i, u0, u1 });
  }
  return trozos.map((x) => ({ i: x.i, A: X(x.u0), B: X(x.u1) }));
}

// ---------------------------------------------------------------------------------------------
// Reparto de las cargas de un paño (C4-e)

/** Un receptor: una vigueta (índice en `PanosU.viguetas`) o un receptor de borde del paño. */
export type Receptor = { tipo: "vigueta"; v: number } | { tipo: "borde"; b: BordePano };

/**
 * Dónde van las cargas repartidas. Todo en el marco del paño (σ a lo largo de d) y por unidad de
 * longitud en σ; los vectores, globales.
 */
export interface EmisorPano {
  /** Carga lineal de qa (en σa) a qb (en σb) sobre la recta del receptor, σa < σb. */
  lineal(rec: Receptor, sa: number, sb: number, qa: readonly number[], qb: readonly number[]): void;
  /** Fuerza y momento en la estación σ de la recta del receptor. */
  puntual(rec: Receptor, sigma: number, F: readonly number[], M: readonly number[]): void;
  /** Fuerza F y momento M en el punto Q (en planta, a la cota de la planta), llevados al nudo n con el momento de transporte. */
  aNudo(n: number, Q: Vec2, F: readonly number[], M: readonly number[]): void;
}

const escalar = (q: readonly number[], f: number) => [q[0]! * f, q[1]! * f, q[2]! * f];
/** n × q, con n horizontal. */
const nPorQ = (n: Vec2, q: readonly number[]) => [n[1] * q[2]!, -n[0] * q[2]!, n[0] * q[1]! - n[1] * q[0]!];

interface Franja {
  s0: number;
  s1: number;
  /** Intervalos de la sección del paño: sus lados como funciones lineales de σ y si son receptores. */
  intervalos: { lo: (s: number) => number; hi: (s: number) => number; loBorde: BordePano | null; hiBorde: BordePano | null; receptores: { eta: number; rec: Receptor }[] }[];
}

/** El reparto de un paño: sus franjas y receptores, en su marco. */
export class RepartoPano {
  private readonly d: Vec2;
  private readonly n: Vec2;
  private readonly anillos: Vec2[][];
  private readonly cortesBase: number[];
  private readonly viguetas: { v: number; vig: ViguetaU }[];
  private readonly bordes: BordePano[];

  constructor(panos: PanosU, i: number) {
    const { d, n } = panos.marcos[i]!;
    this.d = d;
    this.n = n;
    this.anillos = anillos(panos.regiones[i]!).map((p) => p.map((V) => this.se(V)));
    this.viguetas = panos.porPano[i]!.map((v) => ({ v, vig: panos.viguetas[v]! }));
    this.bordes = panos.bordes[i]!;
    this.cortesBase = [...this.anillos.flatMap((p) => p.map((V) => V[0])), ...this.viguetas.flatMap(({ vig }) => [vig.a, vig.b]), ...this.bordes.flatMap((b) => [b.a, b.b])];
  }

  /** (σ, η) de un punto en planta. */
  se(X: Vec2): Vec2 {
    return [X[0] * this.d[0] + X[1] * this.d[1], X[0] * this.n[0] + X[1] * this.n[1]];
  }

  /** Franjas entre cortes, con sus intervalos y receptores. `extra`: más cortes (los vértices de una zona). */
  private franjas(extra: readonly number[]): Franja[] {
    const cs = [...this.cortesBase, ...extra].sort((x, y) => x - y);
    const u: number[] = [];
    for (const c of cs) if (!u.length || c - u[u.length - 1]! > 1e-9) u.push(c);
    const tol = 1e-9;
    const r: Franja[] = [];
    for (let j = 0; j + 1 < u.length; j++) {
      const [s0, s1] = [u[j]!, u[j + 1]!];
      const sm = (s0 + s1) / 2;
      const lados: { f: (s: number) => number; em: number; paralelo: boolean }[] = [];
      for (const p of this.anillos)
        for (let k = 0, m = p.length; k < m; k++) {
          const [Pp, Q] = [p[k]!, p[(k + 1) % m]!];
          if (!((Pp[0] - sm) * (Q[0] - sm) < 0)) continue;
          const f = (s: number) => Pp[1] + ((Q[1] - Pp[1]) * (s - Pp[0])) / (Q[0] - Pp[0]);
          lados.push({ f, em: f(sm), paralelo: Math.abs(Q[1] - Pp[1]) <= 1e-9 * Math.max(1, Math.abs(Pp[1])) });
        }
      lados.sort((x, y) => x.em - y.em);
      const intervalos: Franja["intervalos"] = [];
      for (let k = 0; k + 1 < lados.length; k += 2) {
        const [L, H] = [lados[k]!, lados[k + 1]!];
        const borde = (lado: typeof L) => (lado.paralelo ? (this.bordes.find((b) => Math.abs(b.eta - lado.em) <= 1e-8 * Math.max(1, Math.abs(b.eta)) && b.a <= s0 + tol && b.b >= s1 - tol) ?? null) : null);
        const loBorde = borde(L);
        const hiBorde = borde(H);
        const receptores: { eta: number; rec: Receptor }[] = [];
        if (loBorde) receptores.push({ eta: loBorde.eta, rec: { tipo: "borde", b: loBorde } });
        for (const { v, vig } of this.viguetas) if (vig.a <= s0 + tol && vig.b >= s1 - tol && vig.eta >= L.em - tol && vig.eta <= H.em + tol) receptores.push({ eta: vig.eta, rec: { tipo: "vigueta", v } });
        if (hiBorde) receptores.push({ eta: hiBorde.eta, rec: { tipo: "borde", b: hiBorde } });
        receptores.sort((x, y) => x.eta - y.eta);
        intervalos.push({ lo: L.f, hi: H.f, loBorde, hiBorde, receptores });
      }
      r.push({ s0, s1, intervalos });
    }
    return r;
  }

  /** Trapecio de [s0, s1] con fuerza F y momento Ms respecto al centro: intensidades en los extremos. */
  private static trapecio(s0: number, s1: number, F: number, Ms: number): [number, number] {
    const L = s1 - s0;
    return [F / L - (6 * Ms) / (L * L), F / L + (6 * Ms) / (L * L)];
  }

  /**
   * Carga de superficie q (global, kN/m²) sobre el paño entero o sobre su parte en `zona` (polígono
   * en planta). Devuelve el área cargada.
   */
  superficie(q: readonly number[], zona: readonly Vec2[] | null, e: EmisorPano): number {
    const zse = zona ? zona.map((V) => this.se(V)) : null;
    let area = 0;
    for (const fr of this.franjas(zse ? zse.map((V) => V[0]) : [])) {
      const { s0, s1 } = fr;
      const sm = (s0 + s1) / 2;
      for (const it of fr.intervalos) {
        const R = it.receptores;
        /** Integrales de la celda (convexa, antihoraria, en (σ, η)) ∩ zona, en coordenadas (σ − sm, η − er). */
        const integrar = (celda: Vec2[], er: number): Momentos2 => {
          const c = celda.map((V) => [V[0] - sm, V[1] - er] as Vec2);
          return zse ? momentos2Interseccion(zse.map((V) => [V[0] - sm, V[1] - er] as Vec2), c) : momentos2Poligono(c);
        };
        const emitir = (rec: Receptor, F: number, Ms: number) => {
          if (F === 0 && Ms === 0) return;
          const [qa, qb] = RepartoPano.trapecio(s0, s1, F, Ms);
          e.lineal(rec, s0, s1, escalar(q, qa), escalar(q, qb));
        };
        // Entre receptores consecutivos: la palanca
        for (let k = 0; k + 1 < R.length; k++) {
          const [a, b] = [R[k]!, R[k + 1]!];
          const D = b.eta - a.eta;
          if (!(D > 0)) continue;
          const m = integrar(
            [
              [s0, a.eta],
              [s1, a.eta],
              [s1, b.eta],
              [s0, b.eta],
            ],
            a.eta,
          );
          if (!(m.A > 0)) continue;
          area += m.A;
          emitir(b.rec, m.Sy / D, m.Sxy / D);
          emitir(a.rec, m.A - m.Sy / D, m.Sx - m.Sxy / D);
        }
        // Entre un lado que no es receptor y el receptor más cercano: a éste, con el transporte
        const caja = (rec: { eta: number; rec: Receptor } | null, celda: Vec2[]) => {
          const er = rec ? rec.eta : it.lo(sm);
          const m = integrar(celda, er);
          if (!(m.A > 0)) return;
          area += m.A;
          if (rec) {
            emitir(rec.rec, m.A, m.Sx);
            if (m.Sy !== 0) e.puntual(rec.rec, sm + m.Sx / m.A, [0, 0, 0], escalar(nPorQ(this.n, q), m.Sy));
          } else this.huerfana(q, [sm + m.Sx / m.A, er + m.Sy / m.A], m.A, e);
        };
        if (!R.length) {
          caja(null, [
            [s0, it.lo(s0)],
            [s1, it.lo(s1)],
            [s1, it.hi(s1)],
            [s0, it.hi(s0)],
          ]);
          continue;
        }
        const [pri, ult] = [R[0]!, R[R.length - 1]!];
        if (!it.loBorde)
          caja(pri, [
            [s0, it.lo(s0)],
            [s1, it.lo(s1)],
            [s1, pri.eta],
            [s0, pri.eta],
          ]);
        if (!it.hiBorde)
          caja(ult, [
            [s0, ult.eta],
            [s1, ult.eta],
            [s1, it.hi(s1)],
            [s0, it.hi(s0)],
          ]);
      }
    }
    return area;
  }

  /**
   * Una carga sin receptor en su intervalo (C4-e): la fuerza q·A en C (en el marco) y el momento M,
   * al nudo más cercano de la vigueta más próxima.
   */
  private huerfana(q: readonly number[], C: Vec2, A: number, e: EmisorPano, M: readonly number[] = [0, 0, 0]): void {
    let mejor = this.viguetas[0]!.vig;
    for (const { vig } of this.viguetas) if (Math.abs(vig.eta - C[1]) < Math.abs(mejor.eta - C[1])) mejor = vig;
    let nudo = mejor.cadena[0]!;
    for (const x of mejor.cadena) if (Math.abs(x.sigma - C[0]) < Math.abs(nudo.sigma - C[0])) nudo = x;
    e.aNudo(nudo.nudo, punto(this.d, this.n, C[0], C[1]), escalar(q, A), M);
  }

  /** Franja e intervalo de un punto (σ, η), o null si cae fuera del paño. */
  private donde(fs: Franja[], X: Vec2): { fr: Franja; it: Franja["intervalos"][number] } | null {
    const fr = fs.find((f) => X[0] >= f.s0 - 1e-9 && X[0] <= f.s1 + 1e-9);
    if (!fr) return null;
    const it = fr.intervalos.find((x) => X[1] >= x.lo(X[0]) - 1e-9 && X[1] <= x.hi(X[0]) + 1e-9);
    return it ? { fr, it } : null;
  }

  /** Fuerza F y momento M en el punto X (en planta) del paño. Devuelve false si X cae fuera. */
  puntual(X: Vec2, F: readonly number[], M: readonly number[], e: EmisorPano): boolean {
    const S = this.se(X);
    const w = this.donde(this.franjas([]), S);
    if (!w) return false;
    const R = w.it.receptores;
    if (!R.length) {
      this.huerfana(F, S, 1, e, M);
      return true;
    }
    const k = R.findIndex((x) => x.eta >= S[1]);
    if (k === 0 || k < 0) {
      // Fuera de los receptores: al del extremo, con el momento de transporte
      const rec = k === 0 ? R[0]! : R[R.length - 1]!;
      const T = escalar(nPorQ(this.n, F), S[1] - rec.eta);
      e.puntual(rec.rec, S[0], F, [M[0]! + T[0]!, M[1]! + T[1]!, M[2]! + T[2]!]);
      return true;
    }
    const [a, b] = [R[k - 1]!, R[k]!];
    const t = (S[1] - a.eta) / (b.eta - a.eta);
    e.puntual(a.rec, S[0], escalar(F, 1 - t), M);
    e.puntual(b.rec, S[0], escalar(F, t), [0, 0, 0]);
    return true;
  }

  /**
   * Carga lineal q (global, kN/m) sobre el segmento AB (en planta). Reparte la parte dentro del paño
   * y devuelve su longitud.
   */
  segmento(A: Vec2, B: Vec2, q: readonly number[], e: EmisorPano): number {
    const [SA, SB] = [this.se(A), this.se(B)];
    const L = dist(A, B);
    if (!(L > 0)) return 0;
    const fs = this.franjas([]);
    // Cortes del segmento: franjas, rectas de receptores y lados del paño
    const ts = new Set<number>([0, 1]);
    const dS = SB[0] - SA[0];
    const dE = SB[1] - SA[1];
    for (const f of fs)
      for (const s of [f.s0, f.s1]) {
        if (dS !== 0) {
          const t = (s - SA[0]) / dS;
          if (t > 0 && t < 1) ts.add(t);
        }
      }
    const etas = new Set<number>([...this.viguetas.map(({ vig }) => vig.eta), ...this.bordes.map((b) => b.eta)]);
    for (const eta of etas)
      if (dE !== 0) {
        const t = (eta - SA[1]) / dE;
        if (t > 0 && t < 1) ts.add(t);
      }
    for (const p of this.anillos)
      for (let k = 0, m = p.length; k < m; k++) {
        const c = cortarTramos(tramo(SA, SB), tramo(p[k]!, p[(k + 1) % m]!));
        if (c && c.sp > 0 && c.sp < L && c.sq >= 0 && c.sq <= dist(p[k]!, p[(k + 1) % m]!)) ts.add(c.sp / L);
      }
    const orden = [...ts].sort((x, y) => x - y);
    let largo = 0;
    for (let j = 0; j + 1 < orden.length; j++) {
      const [t0, t1] = [orden[j]!, orden[j + 1]!];
      if (!(t1 - t0 > 1e-12)) continue;
      const X = (t: number): Vec2 => [SA[0] + t * dS, SA[1] + t * dE];
      const [X0, X1, Xm] = [X(t0), X(t1), X((t0 + t1) / 2)];
      const w = this.donde(fs, Xm);
      if (!w) continue;
      const l = (t1 - t0) * L;
      largo += l;
      const R = w.it.receptores;
      const ds = X1[0] - X0[0];
      /** Fracciones f0 (en X0) y f1 (en X1) de la carga al receptor rec. */
      const dar = (rec: Receptor, f0: number, f1: number) => {
        if (Math.abs(ds) > 1e-9) {
          const k = l / Math.abs(ds);
          if (ds > 0) e.lineal(rec, X0[0], X1[0], escalar(q, f0 * k), escalar(q, f1 * k));
          else e.lineal(rec, X1[0], X0[0], escalar(q, f1 * k), escalar(q, f0 * k));
        } else e.puntual(rec, Xm[0], escalar(q, ((f0 + f1) / 2) * l), [0, 0, 0]);
      };
      if (!R.length) {
        this.huerfana(q, Xm, l, e);
        continue;
      }
      const k = R.findIndex((x) => x.eta >= Xm[1]);
      if (k === 0 || k < 0) {
        const rec = k === 0 ? R[0]! : R[R.length - 1]!;
        dar(rec.rec, 1, 1);
        const brazo = (X0[1] + X1[1]) / 2 - rec.eta;
        if (brazo !== 0) e.puntual(rec.rec, Xm[0], [0, 0, 0], escalar(nPorQ(this.n, q), brazo * l));
        continue;
      }
      const [a, b] = [R[k - 1]!, R[k]!];
      const D = b.eta - a.eta;
      const [w0, w1] = [(X0[1] - a.eta) / D, (X1[1] - a.eta) / D];
      dar(a.rec, 1 - w0, 1 - w1);
      dar(b.rec, w0, w1);
    }
    return largo;
  }
}
