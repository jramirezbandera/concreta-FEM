/**
 * Paso 2 del compilador: la topología de cada planta (H28, COM-05, COM-06). Decide qué se une con
 * qué y crea los nudos; las barras y los offsets salen después (`piezas.ts`).
 *
 * Regla general: la geometría dibujada no se mueve nunca. Las tolerancias deciden la conectividad
 * y el hueco entre lo dibujado y el nudo se convierte en un offset rígido de la barra. Así las
 * cargas quedan exactamente donde están y el control «sin pérdidas» es exacto.
 *
 * Por planta, en este orden:
 * 1. Pilares: un nudo en su eje. Dos ejes a ≤ ε_snap comparten nudo sólo si uno acaba donde el
 *    otro empieza; si no, es un error.
 * 2. Vértices de vigas dentro de la huella de un pilar (ampliada en ε_snap): al nudo del pilar.
 * 3. Los demás vértices se agrupan a ≤ ε_snap; el nudo es el vértice de menor (x, y) del grupo.
 * 4. Encuentro en T: un nudo de vértice a ≤ ε_snap del interior de otro tramo se lleva a su
 *    proyección sobre ese tramo y lo parte.
 * 5. Viga que pasa por un pilar (su recta a ≤ ε_snap de la huella, con la proyección del eje
 *    dentro del tramo): se parte en el nudo del pilar.
 * 6. Cruces de tramos: un nudo nuevo, o el que ya haya a ≤ ε_snap del cruce.
 * 7. Apoyos: al pilar, al nudo a ≤ ε_snap o partiendo el tramo más cercano.
 * 8. Cadenas: los nudos de cada tramo ordenados por su proyección σ sobre la recta del tramo.
 * 9. Comprobaciones: nudos distintos a ≤ ε_snap (error: encuentro ambiguo), uniones con hueco
 *    (aviso con la distancia) y extremos libres a ≤ 3·ε_snap de algo (aviso de casi encuentro).
 */
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Pilar, Vec2, Viga } from "./fisico.ts";
import { cortarTramos, cuerdaHuella, dist, distanciaAHuella, huellaPilar, proyectar, radioHuella, RejillaHash, tramo, type Huella, type Tramo2D } from "./geometria2d.ts";
import type { Contexto } from "./validar.ts";

export interface PuntoPilar {
  nudo: number;
  /** Huella con la que se unen las vigas de la planta: la del pilar de debajo, o la del de encima. */
  huella: Huella;
  /** Pilares cuyo eje llega al nudo, por id. */
  pilares: string[];
}

export interface NudoT {
  /** Planta (índice de arriba abajo). */
  k: number;
  x: number;
  y: number;
  fisicos: Set<string>;
  pilar: PuntoPilar | null;
}

export interface TramoViga {
  /** Índice global del tramo (orden canónico: planta, viga por id, tramo). */
  id: number;
  viga: Viga;
  k: number;
  /** Tramo de la polilínea. */
  indice: number;
  t: Tramo2D;
  /** Estación del punto A del tramo a lo largo de la viga. */
  s0: number;
  ini: number;
  fin: number;
  /** Nudos interiores que lo parten. */
  partes: number[];
  /** Nudos del tramo ordenados por σ (proyección sobre la recta del tramo, desde A). */
  cadena: { nudo: number; sigma: number }[];
}

/**
 * Dónde cae un punto de una planta: en la huella de un pilar (su nudo); si no, sobre una viga a
 * ≤ ε_snap (exacto); si no, en un nudo a ≤ ε_snap.
 */
export type Destino = { tipo: "nudo"; nudo: number } | { tipo: "tramo"; tramo: TramoViga; sigma: number };

export interface Topologia {
  nudos: NudoT[];
  /** Nudo del eje de cada pilar en cada planta: clave `${pilar}@${k}`. */
  nudoPilar: Map<string, number>;
  /** Puntos de pilar de cada nudo. */
  tramosDe: Map<string, TramoViga[]>;
  tramos: TramoViga[];
  apoyoEn: Map<string, number>;
  /** Vigas que llegan a cada nudo. */
  vigasEn: Map<number, Set<string>>;
  localizar(k: number, P: Vec2): Destino | null;
}

/** Sección del tramo de un pilar con la cabeza en la planta k. */
export function seccionTramo(ctx: Contexto, p: Pilar, k: number): string {
  const id = ctx.plantas[k]!.id;
  return p.tramos?.find((t) => t.planta === id)?.seccion ?? p.seccion;
}

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

const cm = (d: number) => `${(d * 100).toFixed(1)} cm`;

export function construirTopologia(ctx: Contexto, diag: Diagnosticos): Topologia {
  const { epsGeom, epsSnap } = ctx.op;
  const lado = Math.max(1, 4 * epsSnap);
  const nudos: NudoT[] = [];
  const nudoPilar = new Map<string, number>();
  const tramos: TramoViga[] = [];
  const tramosDe = new Map<string, TramoViga[]>();
  const apoyoEn = new Map<string, number>();
  const porPlanta = new Map<number, { pilares: PuntoPilar[]; gPilares: RejillaHash; gTramos: RejillaHash; gNudos: RejillaHash; tramos: TramoViga[] }>();

  const nuevoNudo = (k: number, x: number, y: number, pilar: PuntoPilar | null = null): number => {
    nudos.push({ k, x, y, fisicos: new Set(), pilar });
    return nudos.length - 1;
  };
  const P = (n: number): Vec2 => [nudos[n]!.x, nudos[n]!.y];

  // Plantas de abajo arriba (la numeración final la hace el compilador, por cota)
  const plantasUsadas = new Set<number>();
  for (const p of ctx.pilares) for (let k = ctx.planta.get(p.hasta)!; k <= ctx.planta.get(p.desde)!; k++) plantasUsadas.add(k);
  for (const v of ctx.vigas) plantasUsadas.add(ctx.planta.get(v.planta)!);
  for (const a of ctx.apoyos) plantasUsadas.add(ctx.planta.get(a.planta)!);

  for (const k of [...plantasUsadas].sort((a, b) => b - a)) {
    const gPilares = new RejillaHash(lado);
    const gTramos = new RejillaHash(lado);
    const gNudos = new RejillaHash(lado);
    const insertarNudo = (n: number) => gNudos.insertar(n, nudos[n]!.x, nudos[n]!.y, nudos[n]!.x, nudos[n]!.y);
    const cerca = (g: RejillaHash, p: Vec2, r: number) => g.buscar(p[0] - r, p[1] - r, p[0] + r, p[1] + r);

    // 1. Pilares
    const puntos: PuntoPilar[] = [];
    const abajoDe = new Map<PuntoPilar, Pilar>();
    const arribaDe = new Map<PuntoPilar, Pilar>();
    const gEjes = new RejillaHash(lado);
    for (const p of ctx.pilares) {
      const kb = ctx.planta.get(p.desde)!;
      const kh = ctx.planta.get(p.hasta)!;
      if (k < kh || k > kb) continue;
      const abajo = k < kb;
      const arriba = k > kh;
      let destino: PuntoPilar | null = null;
      let dmin = Infinity;
      for (const i of cerca(gEjes, [p.x, p.y], epsSnap)) {
        const pp = puntos[i]!;
        const d = dist([p.x, p.y], P(pp.nudo));
        if (d <= epsSnap && d < dmin) [destino, dmin] = [pp, d];
      }
      if (destino) {
        if ((abajo && abajoDe.has(destino)) || (arriba && arribaDe.has(destino))) {
          diag.error(
            "topologia/pilares-solapados",
            `Los pilares ${[...destino.pilares, p.id].join(" y ")} coinciden en la planta ${ctx.plantas[k]!.id} y se solapan en altura.`,
            [...destino.pilares, p.id],
          );
          continue;
        }
        if (dmin > epsGeom)
          diag.aviso("topologia/fusion", `El pilar ${p.id} se une al ${destino.pilares[0]} en la planta ${ctx.plantas[k]!.id} con una excentricidad de ${cm(dmin)}.`, [p.id, ...destino.pilares], {
            distancia: dmin,
          });
        destino.pilares.push(p.id);
      } else {
        const pp: PuntoPilar = { nudo: -1, huella: huellaPilar(p.x, p.y, p.giro ?? 0, null), pilares: [p.id] };
        pp.nudo = nuevoNudo(k, p.x, p.y, pp);
        puntos.push(pp);
        gEjes.insertar(puntos.length - 1, p.x, p.y, p.x, p.y);
        destino = pp;
      }
      if (abajo) abajoDe.set(destino, p);
      if (arriba) arribaDe.set(destino, p);
      nudoPilar.set(`${p.id}@${k}`, destino.nudo);
      nudos[destino.nudo]!.fisicos.add(p.id);
    }
    // Huella: la del pilar de debajo (las vigas del forjado llegan a su cabeza) o la del de encima
    puntos.forEach((pp, i) => {
      const p = abajoDe.get(pp) ?? arribaDe.get(pp)!;
      const kSeccion = abajoDe.has(pp) ? k : k - 1;
      pp.huella = huellaPilar(p.x, p.y, p.giro ?? 0, ctx.secciones.get(seccionTramo(ctx, p, kSeccion))!.huella);
      const r = radioHuella(pp.huella) + epsSnap;
      gPilares.insertar(i, p.x - r, p.y - r, p.x + r, p.y + r);
      insertarNudo(pp.nudo);
    });
    const pilarCercano = (Q: Vec2): PuntoPilar | null => {
      let mejor: PuntoPilar | null = null;
      let dmin = Infinity;
      for (const i of cerca(gPilares, Q, 0)) {
        const pp = puntos[i]!;
        if (distanciaAHuella(Q, pp.huella) > epsSnap) continue;
        const d = dist(Q, pp.huella.c);
        if (d < dmin) [mejor, dmin] = [pp, d];
      }
      return mejor;
    };

    // 2 y 3. Vértices de las vigas
    const vigas = ctx.vigas.filter((v) => ctx.planta.get(v.planta) === k);
    const vertices: { viga: Viga; i: number; P: Vec2; nudo: number }[] = [];
    for (const v of vigas) v.puntos.forEach((Q, i) => vertices.push({ viga: v, i, P: Q, nudo: -1 }));
    const libres: number[] = [];
    vertices.forEach((vt, i) => {
      const pp = pilarCercano(vt.P);
      if (pp) vt.nudo = pp.nudo;
      else libres.push(i);
    });
    const uf = new UnionFind(vertices.length);
    const gVert = new RejillaHash(lado);
    for (const i of libres) gVert.insertar(i, vertices[i]!.P[0], vertices[i]!.P[1], vertices[i]!.P[0], vertices[i]!.P[1]);
    for (const i of libres) for (const j of cerca(gVert, vertices[i]!.P, epsSnap)) if (j > i && dist(vertices[i]!.P, vertices[j]!.P) <= epsSnap) uf.unir(i, j);
    const grupos = new Map<number, number[]>();
    for (const i of libres) {
      const r = uf.raiz(i);
      let g = grupos.get(r);
      if (!g) grupos.set(r, (g = []));
      g.push(i);
    }
    const nudosLibres: number[] = [];
    for (const g of [...grupos.values()].sort((a, b) => a[0]! - b[0]!)) {
      // El vértice de menor (x, y): no depende del orden de la entrada
      let rep = vertices[g[0]!]!.P;
      for (const i of g) {
        const Q = vertices[i]!.P;
        if (Q[0] < rep[0] || (Q[0] === rep[0] && Q[1] < rep[1])) rep = Q;
      }
      const n = nuevoNudo(k, rep[0], rep[1]);
      nudosLibres.push(n);
      for (const i of g) vertices[i]!.nudo = n;
    }

    // Tramos de las vigas
    const tramosK: TramoViga[] = [];
    let base = 0;
    for (const v of vigas) {
      let s0 = 0;
      const lista: TramoViga[] = [];
      for (let i = 0; i + 1 < v.puntos.length; i++) {
        const t = tramo(v.puntos[i]!, v.puntos[i + 1]!);
        const tv: TramoViga = { id: tramos.length, viga: v, k, indice: i, t, s0, ini: vertices[base + i]!.nudo, fin: vertices[base + i + 1]!.nudo, partes: [], cadena: [] };
        s0 += t.len;
        tramos.push(tv);
        tramosK.push(tv);
        lista.push(tv);
        const r = 3 * epsSnap;
        gTramos.insertar(tramosK.length - 1, Math.min(t.A[0], t.B[0]) - r, Math.min(t.A[1], t.B[1]) - r, Math.max(t.A[0], t.B[0]) + r, Math.max(t.A[1], t.B[1]) + r);
      }
      tramosDe.set(v.id, lista);
      base += v.puntos.length;
    }
    const incide = (tv: TramoViga, n: number) => tv.ini === n || tv.fin === n || tv.partes.includes(n);
    const tramosCerca = (Q: Vec2, r: number) => cerca(gTramos, Q, r).map((i) => tramosK[i]!);

    // 4. Encuentros en T
    for (const n of nudosLibres) {
      const Q = P(n);
      let mejor: { tv: TramoViga; sigma: number; d: number } | null = null;
      for (const tv of tramosCerca(Q, epsSnap)) {
        if (incide(tv, n)) continue;
        const { sigma, d } = proyectar(Q, tv.t);
        if (d <= epsSnap && sigma > epsSnap && sigma < tv.t.len - epsSnap && (!mejor || d < mejor.d)) mejor = { tv, sigma, d };
      }
      if (!mejor) continue;
      const A = mejor.tv.t.A;
      const u = mejor.tv.t.u;
      nudos[n]!.x = A[0] + mejor.sigma * u[0];
      nudos[n]!.y = A[1] + mejor.sigma * u[1];
      mejor.tv.partes.push(n);
    }
    for (const n of nudosLibres) insertarNudo(n);

    // 5. Vigas que pasan por un pilar
    for (const pp of puntos) {
      const c = pp.huella.c;
      for (const tv of tramosCerca(c, radioHuella(pp.huella) + 3 * epsSnap)) {
        if (incide(tv, pp.nudo)) continue;
        const { sigma, d } = proyectar(c, tv.t);
        if (!(sigma > epsGeom && sigma < tv.t.len - epsGeom)) continue;
        // Distancia de la recta a la huella: la del eje menos el semiancho de la huella en la normal
        const nrm: Vec2 = [-tv.t.u[1], tv.t.u[0]];
        const f = pp.huella.forma;
        const semi = !f ? 0 : f.tipo === "circulo" ? f.D / 2 : (f.h / 2) * Math.abs(nrm[0] * pp.huella.ez[0] + nrm[1] * pp.huella.ez[1]) + (f.b / 2) * Math.abs(nrm[0] * pp.huella.ey[0] + nrm[1] * pp.huella.ey[1]);
        if (d - semi <= epsSnap) tv.partes.push(pp.nudo);
        else if (d - semi <= 3 * epsSnap)
          diag.aviso("topologia/casi-encuentro", `La viga ${tv.viga.id} pasa a ${cm(d - semi)} del pilar ${pp.pilares[0]} sin unirse a él.`, [tv.viga.id, pp.pilares[0]!], {
            distancia: d - semi,
          });
      }
    }

    // 6. Cruces
    const huellas = puntos.map((pp) => pp.huella);
    for (let a = 0; a < tramosK.length; a++) {
      const p = tramosK[a]!;
      const { A, B } = p.t;
      const candidatos = gTramos.buscar(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1]));
      for (const b of candidatos) {
        if (b <= a) continue;
        const q = tramosK[b]!;
        // Solape (aunque compartan nudos: una viga dibujada encima de otra se une a ella en T)
        const sol = Math.max(solape(p.t, q.t, epsSnap, huellas), solape(q.t, p.t, epsSnap, huellas));
        if (sol > epsSnap) {
          diag.error("topologia/vigas-solapadas", `Las vigas ${p.viga.id} y ${q.viga.id} se solapan a lo largo de ${sol.toPrecision(3)} m en la planta ${ctx.plantas[k]!.id}.`, [p.viga.id, q.viga.id]);
          continue;
        }
        const comunes = [p.ini, p.fin, ...p.partes].filter((n) => incide(q, n));
        if (comunes.length) continue;
        const c = cortarTramos(p.t, q.t);
        if (!c) continue;
        if (!(c.sp > epsGeom && c.sp < p.t.len - epsGeom && c.sq > epsGeom && c.sq < q.t.len - epsGeom)) continue;
        const X: Vec2 = [A[0] + c.sp * p.t.u[0], A[1] + c.sp * p.t.u[1]];
        if (pilarCercano(X)) continue;
        let n = -1;
        let dmin = Infinity;
        for (const m of cerca(gNudos, X, epsSnap)) {
          const d = dist(X, P(m));
          if (d <= epsSnap && d < dmin && !nudos[m]!.pilar) [n, dmin] = [m, d];
        }
        if (n < 0) {
          n = nuevoNudo(k, X[0], X[1]);
          insertarNudo(n);
        } else if (dmin > epsGeom) {
          diag.aviso("topologia/fusion", `El cruce de las vigas ${p.viga.id} y ${q.viga.id} se une a un nudo a ${cm(dmin)}, con brazos rígidos.`, [p.viga.id, q.viga.id], { distancia: dmin });
        }
        if (!incide(p, n)) p.partes.push(n);
        if (!incide(q, n)) q.partes.push(n);
      }
    }

    // 7. Apoyos
    for (const ap of ctx.apoyos) {
      if (ctx.planta.get(ap.planta) !== k) continue;
      const Q: Vec2 = [ap.x, ap.y];
      let n = pilarCercano(Q)?.nudo ?? -1;
      if (n < 0) {
        let dmin = Infinity;
        for (const m of cerca(gNudos, Q, epsSnap)) {
          const d = dist(Q, P(m));
          if (d <= epsSnap && d < dmin) [n, dmin] = [m, d];
        }
      }
      if (n < 0) {
        let mejor: { tv: TramoViga; sigma: number; d: number } | null = null;
        for (const tv of tramosCerca(Q, epsSnap)) {
          const { sigma, d } = proyectar(Q, tv.t);
          if (d <= epsSnap && sigma > epsGeom && sigma < tv.t.len - epsGeom && (!mejor || d < mejor.d)) mejor = { tv, sigma, d };
        }
        if (mejor) {
          n = nuevoNudo(k, mejor.tv.t.A[0] + mejor.sigma * mejor.tv.t.u[0], mejor.tv.t.A[1] + mejor.sigma * mejor.tv.t.u[1]);
          insertarNudo(n);
          mejor.tv.partes.push(n);
        }
      }
      if (n < 0) {
        diag.error("apoyo/sin-destino", `El apoyo ${ap.id} no cae sobre ningún pilar, nudo ni viga de la planta ${ap.planta} (tolerancia ${cm(epsSnap)}).`, [ap.id]);
        continue;
      }
      const d = dist(Q, P(n));
      if (d > epsGeom && !nudos[n]!.pilar) diag.aviso("topologia/fusion", `El apoyo ${ap.id} se lleva ${cm(d)} hasta el nudo más cercano.`, [ap.id], { distancia: d });
      apoyoEn.set(ap.id, n);
      nudos[n]!.fisicos.add(ap.id);
    }

    // 8. Cadenas
    for (const tv of tramosK) {
      const lista = [tv.ini, tv.fin, ...tv.partes];
      const unicos = [...new Set(lista)];
      tv.cadena = unicos.map((n) => ({ nudo: n, sigma: proyectar(P(n), tv.t).sigma })).sort((a, b) => a.sigma - b.sigma || a.nudo - b.nudo);
      for (let i = 1; i < tv.cadena.length; i++) {
        if (!(tv.cadena[i]!.sigma - tv.cadena[i - 1]!.sigma > epsGeom)) {
          diag.error(
            "topologia/tramo-degenerado",
            `La viga ${tv.viga.id} tiene dos nudos en el mismo punto de su tramo ${tv.indice + 1} (planta ${ctx.plantas[k]!.id}): el encuentro es ambiguo.`,
            [tv.viga.id, ...nudos[tv.cadena[i]!.nudo]!.fisicos],
          );
          break;
        }
      }
      for (const { nudo } of tv.cadena) nudos[nudo]!.fisicos.add(tv.viga.id);
    }
    porPlanta.set(k, { pilares: puntos, gPilares, gTramos, gNudos, tramos: tramosK });

    // 9. Comprobaciones
    const nudosK = nudos.map((_, i) => i).filter((i) => nudos[i]!.k === k);
    for (const n of nudosK) {
      for (const m of cerca(gNudos, P(n), epsSnap)) {
        if (m <= n) continue;
        const d = dist(P(n), P(m));
        if (d <= epsSnap) {
          const ids = [...new Set([...nudos[n]!.fisicos, ...nudos[m]!.fisicos])];
          diag.error(
            "topologia/nudos-proximos",
            `En la planta ${ctx.plantas[k]!.id} quedan dos nudos a ${cm(d)} (de ${ids.join(", ")}): el encuentro es ambiguo; ajuste la geometría para que se toquen o se separen más de ${cm(epsSnap)}.`,
            ids,
            { distancia: d },
          );
        }
      }
    }
    // Uniones con hueco: vértice dibujado → nudo (en un pilar, la distancia a su huella)
    for (const vt of vertices) {
      const nd = nudos[vt.nudo]!;
      const d = nd.pilar ? distanciaAHuella(vt.P, nd.pilar.huella) : dist(vt.P, [nd.x, nd.y]);
      if (d > epsGeom) {
        const con = nd.pilar ? `el pilar ${nd.pilar.pilares[0]}` : `el nudo de ${[...nd.fisicos].filter((f) => f !== vt.viga.id).join(", ") || "otra viga"}`;
        diag.aviso("topologia/fusion", `El punto ${vt.i + 1} de la viga ${vt.viga.id} se une a ${con} a ${cm(d)}, con un brazo rígido.`, [vt.viga.id, ...nd.fisicos], { distancia: d });
      }
    }
    // Extremos libres (voladizos) cerca de algo: casi encuentro
    const usos = new Map<number, number>();
    for (const tv of tramosK) for (const { nudo } of tv.cadena) usos.set(nudo, (usos.get(nudo) ?? 0) + 1);
    for (const vt of vertices) {
      const n = vt.nudo;
      if (nudos[n]!.pilar || usos.get(n) !== 1 || [...apoyoEn.values()].includes(n)) continue;
      const Q = vt.P;
      const r = 3 * epsSnap;
      const cerca1 = puntos.find((pp) => distanciaAHuella(Q, pp.huella) <= r);
      const cerca2 = tramosCerca(Q, r).find((tv) => {
        if (incide(tv, n)) return false;
        const { sigma, d } = proyectar(Q, tv.t);
        return d <= r && sigma >= -r && sigma <= tv.t.len + r;
      });
      const otro = cerca1 ? `el pilar ${cerca1.pilares[0]}` : cerca2 ? `la viga ${cerca2.viga.id}` : null;
      if (otro) diag.aviso("topologia/casi-encuentro", `El extremo de la viga ${vt.viga.id} queda a menos de ${cm(r)} de ${otro} sin unirse.`, [vt.viga.id, cerca1?.pilares[0] ?? cerca2!.viga.id]);
    }
  }

  const vigasEn = new Map<number, Set<string>>();
  for (const tv of tramos) {
    for (const { nudo } of tv.cadena) {
      let s = vigasEn.get(nudo);
      if (!s) vigasEn.set(nudo, (s = new Set()));
      s.add(tv.viga.id);
    }
  }

  const localizar = (k: number, Q: Vec2): Destino | null => {
    const pk = porPlanta.get(k);
    if (!pk) return null;
    let mejorPilar: PuntoPilar | null = null;
    let dp = Infinity;
    for (const i of pk.gPilares.buscar(Q[0], Q[1], Q[0], Q[1])) {
      const pp = pk.pilares[i]!;
      if (distanciaAHuella(Q, pp.huella) > epsSnap) continue;
      const d = dist(Q, pp.huella.c);
      if (d < dp) [mejorPilar, dp] = [pp, d];
    }
    if (mejorPilar) return { tipo: "nudo", nudo: mejorPilar.nudo };
    // Sobre una viga antes que en un nudo cercano: así la carga queda donde está (exacta)
    let mejor: { tv: TramoViga; sigma: number; d: number } | null = null;
    for (const i of pk.gTramos.buscar(Q[0] - epsSnap, Q[1] - epsSnap, Q[0] + epsSnap, Q[1] + epsSnap)) {
      const tv = pk.tramos[i]!;
      const { sigma, d } = proyectar(Q, tv.t);
      if (d <= epsSnap && sigma >= 0 && sigma <= tv.t.len && (!mejor || d < mejor.d)) mejor = { tv, sigma, d };
    }
    if (mejor) return { tipo: "tramo", tramo: mejor.tv, sigma: mejor.sigma };
    let n = -1;
    let dn = Infinity;
    for (const m of pk.gNudos.buscar(Q[0] - epsSnap, Q[1] - epsSnap, Q[0] + epsSnap, Q[1] + epsSnap)) {
      const d = dist(Q, P(m));
      if (d <= epsSnap && d < dn) [n, dn] = [m, d];
    }
    return n >= 0 ? { tipo: "nudo", nudo: n } : null;
  };

  return { nudos, nudoPilar, tramosDe, tramos, apoyoEn, vigasEn, localizar };
}

/**
 * Longitud que comparten dos tramos casi colineales fuera de las huellas de los pilares (dentro de
 * un pilar se solapan dos vigas dibujadas hasta su cara lejana, y no importa): si los dos extremos
 * de q están a ≤ ε de la recta de p, la de sus proyecciones dentro de p; si no, 0.
 */
function solape(p: Tramo2D, q: Tramo2D, eps: number, huellas: readonly Huella[]): number {
  const a = proyectar(q.A, p);
  const b = proyectar(q.B, p);
  if (a.d > eps || b.d > eps) return 0;
  const lo = Math.max(0, Math.min(a.sigma, b.sigma));
  const hi = Math.min(p.len, Math.max(a.sigma, b.sigma));
  if (!(hi - lo > eps)) return 0;
  let dentro = 0;
  for (const h of huellas) {
    const c = cuerdaHuella(p.A, p.u, h);
    if (c) dentro += Math.max(0, Math.min(hi, c[1]) - Math.max(lo, c[0]));
  }
  return hi - lo - dentro;
}

/** Cuerda de la recta de un tramo dentro de la huella de un pilar, en σ del tramo. */
export function cuerdaEnTramo(tv: TramoViga, pp: PuntoPilar): [number, number] | null {
  return cuerdaHuella(tv.t.A, tv.t.u, pp.huella);
}
