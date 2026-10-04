/**
 * Muros (C3, H17, H29): sus estaciones a lo largo del eje, iguales en todas sus plantas, y su
 * rejilla por paño. Lo usa `losas.ts`, que monta el arreglo plano de cada planta con los ejes de los
 * muros, malla las losas con esos lados ya sembrados y crea los nudos de la cota de cada planta.
 *
 * 1. `ajustarMuros`: une los vértices de los muros a lo cercano a ≤ ε_snap (otro vértice de muro que
 *    comparte planta, un nudo de C1 sin huella o el interior de otro muro, en T), igual en todas sus
 *    plantas: así cada paño es plano (C3-b).
 * 2. `unificarEstaciones`: las estaciones de un tramo en una planta son los puntos del arreglo sobre
 *    su eje (cruces con vigas, losas, bandas y otros muros, caras de pilares, cargas) y los bordes de
 *    sus huecos. Un paño necesita las mismas en su cabeza y en su base, así que lo que falta en una
 *    planta se inserta con las mismas coordenadas (no se mueve nada) hasta que no falta nada. Luego
 *    cada intervalo entre estaciones se divide con la siembra graduada de C2 de paso ≤ min(2h, L/4),
 *    con L el tramo recto de muro que lo contiene (≥ 8 elementos, H17), con el mismo número de
 *    partes en todas las plantas. Los lados de los ejes ya quedan sembrados para la malla de C2.
 * 3. `planMuros`: los paños, las filas de cada grupo de paños de una planta que se tocan (cotas de
 *    las plantas, bordes de huecos y cambios de ley de los empujes, unidas a ≤ ε_snap, y cada
 *    intervalo dividido a ≤ h), los huecos y los empujes unidos, y dónde hay muro junto a la cota de
 *    cada planta (los nudos de la cota sólo se crean donde hacen falta).
 * 4. `mallarMuros`: la rejilla de cada paño (columnas en las estaciones y en los puntos medios de sus
 *    lados, que son los de la división en 3 cuadriláteros de las losas), sin los elementos de los
 *    huecos; las láminas, los apoyos de la base y las barras auxiliares de C3-e.
 *
 * Puro y determinista: todo se recorre en el orden de `ctx.muros` (por id) y de sus tramos.
 */
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { Arreglo, Trazo } from "./arreglo.ts";
import type { Vec2 } from "./fisico.ts";
import { CUANTO_ORDEN } from "./geometria2d.ts";
import { siembraGraduada } from "./mallado.ts";
import type { Topologia, TramoViga } from "./topologia.ts";
import type { Contexto, MuroCompilado } from "./validar.ts";

/** Trazo del eje de un muro en el arreglo de una planta, con los puntos de sus vértices. */
export interface TrazoMuro {
  /** Índice del muro en `ctx.muros`. */
  w: number;
  trazo: Trazo;
  vertices: number[];
}

/** Lo que `muros.ts` necesita de cada planta: su arreglo y los ejes de muro que lleva. */
export interface PlantaMuros {
  k: number;
  a: Arreglo;
  muros: TrazoMuro[];
}

const cm = (d: number) => `${(d * 100).toFixed(1)} cm`;
const dist = (a: Vec2, b: Vec2) => Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));

/** ¿Comparten los muros a y b alguna cota de planta? */
const compartenPlanta = (a: MuroCompilado, b: MuroCompilado) => a.kh <= b.kb && b.kh <= a.kb;

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

/**
 * Paso 1: vértices de los muros ajustados, uno por vértice de cada muro (C3-b). Devuelve null si
 * algún tramo se queda sin longitud.
 */
export function ajustarMuros(ctx: Contexto, topo: Topologia, diag: Diagnosticos): Vec2[][] | null {
  const { epsGeom, epsSnap } = ctx.op;
  const V: { w: number; i: number; P: Vec2 }[] = [];
  ctx.muros.forEach((m, w) => m.muro.puntos.forEach((P, i) => V.push({ w, i, P })));
  const uf = new UnionFind(V.length);
  for (let a = 0; a < V.length; a++)
    for (let b = a + 1; b < V.length; b++)
      if (compartenPlanta(ctx.muros[V[a]!.w]!, ctx.muros[V[b]!.w]!) && dist(V[a]!.P, V[b]!.P) <= epsSnap) uf.unir(a, b);
  const grupos = new Map<number, number[]>();
  V.forEach((_, i) => {
    const r = uf.raiz(i);
    let g = grupos.get(r);
    if (!g) grupos.set(r, (g = []));
    g.push(i);
  });
  const nuevo: Vec2[][] = ctx.muros.map((m) => m.muro.puntos.map((p) => [p[0], p[1]] as Vec2));
  const fijado: boolean[][] = ctx.muros.map((m) => m.muro.puntos.map(() => false));
  const con = new Map<string, string>();
  for (const g of grupos.values()) {
    // Plantas del grupo y nudos de C1 sin huella en ellas a ≤ ε_snap de algún vértice
    const ks = new Set<number>();
    for (const i of g) for (let k = ctx.muros[V[i]!.w]!.kh; k <= ctx.muros[V[i]!.w]!.kb; k++) ks.add(k);
    let mejor: { n: number; d: number } | null = null;
    topo.nudos.forEach((nd, n) => {
      if (!ks.has(nd.k) || nd.z !== undefined || nd.pilar?.huella.forma) return;
      let d = Infinity;
      for (const i of g) d = Math.min(d, dist(V[i]!.P, [nd.x, nd.y]));
      if (d > epsSnap) return;
      const m = topo.nudos[mejor?.n ?? n]!;
      if (!mejor || d < mejor.d || (d === mejor.d && (nd.x < m.x || (nd.x === m.x && nd.y < m.y)))) mejor = { n, d };
    });
    let destino: Vec2;
    if (mejor) {
      const nd = topo.nudos[(mejor as { n: number }).n]!;
      destino = [nd.x, nd.y];
      con.set(`${g[0]}`, `el nudo de ${[...nd.fisicos].sort().join(", ") || "una viga"}`);
    } else {
      destino = V[g[0]!]!.P;
      for (const i of g) {
        const Q = V[i]!.P;
        if (Q[0] < destino[0] || (Q[0] === destino[0] && Q[1] < destino[1])) destino = Q;
      }
    }
    for (const i of g) {
      nuevo[V[i]!.w]![V[i]!.i] = [destino[0], destino[1]];
      fijado[V[i]!.w]![V[i]!.i] = mejor !== null;
    }
  }
  // Encuentros en T: un vértice a ≤ ε_snap del interior de un tramo de otro muro que comparte planta
  const T: { w: number; i: number; Q: Vec2 }[] = [];
  ctx.muros.forEach((m, w) =>
    nuevo[w]!.forEach((P, i) => {
      if (fijado[w]![i]) return;
      let mejor: { Q: Vec2; d: number } | null = null;
      ctx.muros.forEach((o, w2) => {
        if (w2 === w || !compartenPlanta(m, o)) return;
        const p = nuevo[w2]!;
        for (let j = 1; j < p.length; j++) {
          const [A, B] = [p[j - 1]!, p[j]!];
          const L = dist(A, B);
          const u: Vec2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
          const sigma = (P[0] - A[0]) * u[0] + (P[1] - A[1]) * u[1];
          const d = Math.abs((P[0] - A[0]) * u[1] - (P[1] - A[1]) * u[0]);
          if (d > epsGeom && d <= epsSnap && sigma > epsSnap && sigma < L - epsSnap && (!mejor || d < mejor.d)) mejor = { Q: [A[0] + sigma * u[0], A[1] + sigma * u[1]], d };
        }
      });
      if (mejor) T.push({ w, i, Q: (mejor as { Q: Vec2 }).Q });
    }),
  );
  for (const t of T) nuevo[t.w]![t.i] = t.Q;
  // Avisos y tramos degenerados
  let bien = true;
  ctx.muros.forEach((m, w) => {
    m.muro.puntos.forEach((P, i) => {
      const d = dist(P, nuevo[w]![i]!);
      if (d > epsGeom) diag.aviso("muro/ajuste", `El punto ${i + 1} del muro ${m.muro.id} se mueve ${cm(d)} para unirse a lo cercano (C3-b).`, [m.muro.id], { distancia: d });
    });
    for (let i = 1; i < nuevo[w]!.length; i++) {
      if (!(dist(nuevo[w]![i - 1]!, nuevo[w]![i]!) > epsSnap)) {
        diag.error("muro/degenerado", `El tramo ${i} del muro ${m.muro.id} se queda sin longitud al unir sus puntos a lo cercano (tolerancia ${cm(epsSnap)}).`, [m.muro.id]);
        bien = false;
      }
    }
  });
  return bien ? nuevo : null;
}

/** Puntos del arreglo del tramo i de un muro en una planta, de su primer vértice al segundo. */
export function cadenaTramo(tm: TrazoMuro, i: number): number[] {
  const p = tm.trazo.puntos;
  let pos = 0;
  const idx: number[] = [];
  for (let v = 0; v <= i + 1; v++) {
    while (pos < p.length && p[pos] !== tm.vertices[v]) pos++;
    if (pos >= p.length) throw new Error(`cadenaTramo: falta el vértice ${v} del muro ${tm.trazo.id}`);
    idx.push(pos);
  }
  return p.slice(idx[i]!, idx[i + 1]! + 1);
}

export interface EstacionesMuros {
  /** Por planta, claves «a,b» (a < b) de los lados de los ejes de los muros: ya están sembrados. */
  presembrados: Map<number, Set<string>>;
  /** Puntos del arreglo de la planta k a lo largo del tramo i del muro w (estaciones). */
  cadena(k: number, w: number, i: number): number[];
  /** Puntos de los bordes de los huecos de cada muro (en el orden de sus huecos): [desde, hasta]. */
  bordesHuecos: Vec2[][][];
}

/**
 * Paso 2: estaciones de los muros, las mismas en todas sus plantas, y división de sus intervalos.
 * Modifica los arreglos de `plantas` (ya resueltos). Devuelve null con un error si no converge.
 */
export function unificarEstaciones(ctx: Contexto, plantas: ReadonlyMap<number, PlantaMuros>, puntos: readonly Vec2[][], diag: Diagnosticos): EstacionesMuros | null {
  const { epsGeom, epsSnap, tamanoMalla: h } = ctx.op;
  const trazoDe = (k: number, w: number) => plantas.get(k)!.muros.find((x) => x.w === w)!;
  const cadena = (k: number, w: number, i: number) => cadenaTramo(trazoDe(k, w), i);
  const P = (k: number, p: number): Vec2 => {
    const q = plantas.get(k)!.a.puntos[p]!;
    return [q.x, q.y];
  };
  const eje = (w: number, i: number) => {
    const [A, B] = [puntos[w]![i]!, puntos[w]![i + 1]!];
    const L = dist(A, B);
    return { A, u: [(B[0] - A[0]) / L, (B[1] - A[1]) / L] as Vec2, L };
  };
  const sigma = (w: number, i: number, Q: Vec2) => {
    const { A, u } = eje(w, i);
    return (Q[0] - A[0]) * u[0] + (Q[1] - A[1]) * u[1];
  };
  /** Inserta Q en la cadena del tramo i del muro w en la planta k (si no está ya a ≤ ε_geom). */
  const insertar = (k: number, w: number, i: number, Q: Vec2): boolean => {
    const c = cadena(k, w, i);
    if (c.some((p) => dist(P(k, p), Q) <= epsGeom)) return false;
    const sq = sigma(w, i, Q);
    for (let j = 0; j + 1 < c.length; j++) {
      const [s0, s1] = [sigma(w, i, P(k, c[j]!)), sigma(w, i, P(k, c[j + 1]!))];
      if (sq > Math.min(s0, s1) && sq < Math.max(s0, s1)) {
        plantas.get(k)!.a.partirLado(c[j]!, c[j + 1]!, [Q]);
        return true;
      }
    }
    return false;
  };
  const paños: { w: number; i: number; k: number }[] = [];
  ctx.muros.forEach((m, w) => {
    for (let i = 0; i + 1 < puntos[w]!.length; i++) for (let k = m.kh; k < m.kb; k++) paños.push({ w, i, k });
  });

  // Bordes de los huecos: se unen a una estación a ≤ ε_snap de alguna de sus plantas, y si no, se
  // insertan en su sitio en todas ellas
  const bordesHuecos: Vec2[][][] = ctx.muros.map(() => []);
  ctx.muros.forEach((m, w) => {
    const zb = ctx.cotas[m.kb]!;
    m.huecos.forEach((hh, nh) => {
      const ks = new Set<number>();
      for (let k = m.kh; k < m.kb; k++) {
        const [z0, z1] = [ctx.cotas[k + 1]! - zb, ctx.cotas[k]! - zb];
        if (Math.min(z1, hh.z1) - Math.max(z0, hh.z0) > epsGeom) [k, k + 1].forEach((x) => ks.add(x));
      }
      const { A, u, L } = eje(w, hh.tramo);
      const bordes: Vec2[] = [];
      for (const [cual, s] of [["izquierdo", hh.desde], ["derecho", hh.hasta]] as const) {
        const sg = Math.min(L, Math.max(0, s - m.s0[hh.tramo]!));
        let Q: Vec2 = [A[0] + sg * u[0], A[1] + sg * u[1]];
        let mejor: { Q: Vec2; d: number } | null = null;
        for (const k of [...ks].sort((a, b) => a - b))
          for (const p of cadena(k, w, hh.tramo)) {
            const X = P(k, p);
            const d = Math.abs(sigma(w, hh.tramo, X) - sg);
            if (d <= epsSnap && (!mejor || d < mejor.d)) mejor = { Q: X, d };
          }
        if (mejor) {
          Q = (mejor as { Q: Vec2 }).Q;
          if ((mejor as { d: number }).d > epsGeom) diag.aviso("muro/ajuste", `El borde ${cual} del hueco ${nh + 1} del muro ${m.muro.id} se mueve ${cm((mejor as { d: number }).d)} para unirse a lo cercano (C3-b).`, [m.muro.id]);
        }
        for (const k of ks) insertar(k, w, hh.tramo, Q);
        bordes.push(Q);
      }
      bordesHuecos[w]!.push(bordes);
    });
  });

  // Estaciones que faltan en la otra planta de un paño, hasta que no falta ninguna
  const emparejar = (): boolean => {
    for (let vuelta = 0; vuelta < 50; vuelta++) {
      const pendientes: { k: number; w: number; i: number; Q: Vec2 }[] = [];
      for (const { w, i, k } of paños) {
        const [arriba, abajo] = [cadena(k, w, i).map((p) => P(k, p)), cadena(k + 1, w, i).map((p) => P(k + 1, p))];
        for (const Q of arriba) if (!abajo.some((X) => dist(X, Q) <= epsGeom)) pendientes.push({ k: k + 1, w, i, Q });
        for (const Q of abajo) if (!arriba.some((X) => dist(X, Q) <= epsGeom)) pendientes.push({ k, w, i, Q });
      }
      if (!pendientes.length) return true;
      const tocadas = new Set<number>();
      for (const p of pendientes) if (insertar(p.k, p.w, p.i, p.Q)) tocadas.add(p.k);
      for (const k of [...tocadas].sort((a, b) => a - b)) plantas.get(k)!.a.resolver();
      if (!tocadas.size) return false;
    }
    return false;
  };
  const fallo = (): null => {
    diag.error("muro/estaciones", "No se han podido igualar las estaciones de los muros entre sus plantas. Es un fallo del compilador.", ctx.muros.map((m) => m.muro.id));
    return null;
  };
  if (!emparejar()) return fallo();

  // División de los intervalos: tramo recto (tramos colineales unidos por sus extremos) de cada tramo
  const tramos: { w: number; i: number }[] = [];
  ctx.muros.forEach((_, w) => {
    for (let i = 0; i + 1 < puntos[w]!.length; i++) tramos.push({ w, i });
  });
  const uf = new UnionFind(tramos.length);
  for (let a = 0; a < tramos.length; a++)
    for (let b = a + 1; b < tramos.length; b++) {
      const [ta, tb] = [tramos[a]!, tramos[b]!];
      if (!compartenPlanta(ctx.muros[ta.w]!, ctx.muros[tb.w]!)) continue;
      const pa = [puntos[ta.w]![ta.i]!, puntos[ta.w]![ta.i + 1]!];
      const pb = [puntos[tb.w]![tb.i]!, puntos[tb.w]![tb.i + 1]!];
      if (!pa.some((X) => pb.some((Y) => dist(X, Y) <= epsGeom))) continue;
      const { A, u } = eje(ta.w, ta.i);
      if (pb.every((Q) => Math.abs((Q[0] - A[0]) * u[1] - (Q[1] - A[1]) * u[0]) <= epsGeom)) uf.unir(a, b);
    }
  const recto = new Map<number, number>();
  tramos.forEach((t, j) => recto.set(uf.raiz(j), (recto.get(uf.raiz(j)) ?? 0) + eje(t.w, t.i).L));
  const pasoDe = new Map<string, number>();
  tramos.forEach((t, j) => pasoDe.set(`${t.w}:${t.i}`, Math.min(2 * h, recto.get(uf.raiz(j))! / 4)));
  const clave = (Q: Vec2) => `${Math.round(Q[0] / CUANTO_ORDEN)},${Math.round(Q[1] / CUANTO_ORDEN)}`;
  const intervalos = new Map<string, { A: Vec2; B: Vec2; paso: number; donde: Map<string, { k: number; p: number; q: number }> }>();
  const tam = new Map<string, number>();
  ctx.muros.forEach((m, w) => {
    for (let i = 0; i + 1 < puntos[w]!.length; i++)
      for (let k = m.kh; k <= m.kb; k++) {
        const c = cadena(k, w, i);
        const paso = pasoDe.get(`${w}:${i}`)!;
        for (const p of c) {
          const kp = clave(P(k, p));
          tam.set(kp, Math.min(tam.get(kp) ?? Infinity, plantas.get(k)!.a.rasgo(p, 2 * h)));
        }
        for (let j = 0; j + 1 < c.length; j++) {
          let [p, q] = [c[j]!, c[j + 1]!];
          let [A, B] = [P(k, p), P(k, q)];
          if (clave(B) < clave(A)) [p, q, A, B] = [q, p, B, A];
          const kk = `${clave(A)}|${clave(B)}`;
          let it = intervalos.get(kk);
          if (!it) intervalos.set(kk, (it = { A, B, paso, donde: new Map() }));
          it.paso = Math.min(it.paso, paso);
          it.donde.set(`${k}:${p}:${q}`, { k, p, q });
        }
      }
  });
  const tocadas = new Set<number>();
  for (const kk of [...intervalos.keys()].sort()) {
    const it = intervalos.get(kk)!;
    const L = dist(it.A, it.B);
    const [ka, kb] = kk.split("|") as [string, string];
    const { t } = siembraGraduada(L, Math.min(it.paso, tam.get(ka)!), Math.min(it.paso, tam.get(kb)!), it.paso);
    if (!t.length) continue;
    const qs = t.map((x) => [it.A[0] + (it.B[0] - it.A[0]) * x, it.A[1] + (it.B[1] - it.A[1]) * x] as Vec2);
    for (const { k, p, q } of it.donde.values()) {
      plantas.get(k)!.a.partirLado(p, q, qs);
      tocadas.add(k);
    }
  }
  for (const k of [...tocadas].sort((a, b) => a - b)) plantas.get(k)!.a.resolver();
  if (!emparejar()) return fallo();
  // Comprobación: cada paño tiene las mismas estaciones arriba y abajo, en el mismo orden
  for (const { w, i, k } of paños) {
    const [arriba, abajo] = [cadena(k, w, i), cadena(k + 1, w, i)];
    if (arriba.length !== abajo.length || arriba.some((p, j) => dist(P(k, p), P(k + 1, abajo[j]!)) > epsGeom)) return fallo();
  }
  const presembrados = new Map<number, Set<string>>();
  for (const [k, pl] of plantas) {
    const s = new Set<string>();
    for (const tm of pl.muros)
      for (let i = 0; i + 1 < tm.vertices.length; i++) {
        const c = cadenaTramo(tm, i);
        for (let j = 0; j + 1 < c.length; j++) s.add(c[j]! < c[j + 1]! ? `${c[j]},${c[j + 1]}` : `${c[j + 1]},${c[j]}`);
      }
    presembrados.set(k, s);
  }
  return { presembrados, cadena, bordesHuecos };
}

/** Un paño: el tramo i del muro w entre la planta k (su cabeza) y la k + 1 (su base). */
export interface PanoMuro {
  w: number;
  i: number;
  k: number;
  /** Estaciones de la cabeza y de la base (puntos de cada arreglo), emparejadas. */
  arriba: number[];
  abajo: number[];
  /** Grupo de paños de la planta que se tocan: tienen las mismas filas. */
  grupo: number;
  /** σ de sus columnas a lo largo del tramo: estaciones y puntos medios alternos. */
  sigmas: number[];
  /** Estaciones en planta (las mismas arriba y abajo). */
  estaciones: Vec2[];
}

export interface PlanMuros {
  panos: PanoMuro[];
  /** Cotas de las filas de cada grupo, de abajo arriba. */
  filas: number[][];
  /** Huecos unidos de cada muro: tramo, σ de sus bordes a lo largo del tramo y cotas absolutas. */
  huecos: { i: number; sa: number; sb: number; z0: number; z1: number }[][];
  /** Ley unida de cada empuje: cotas absolutas de su tramo cargado. */
  empujes: Map<string, { z0: number; z1: number }>;
  /** Eje de cada tramo de cada muro ajustado: origen, dirección y longitud. */
  ejes: { A: Vec2; u: Vec2; L: number }[][];
  /** ¿Hay muro justo debajo y justo encima de la cota de la planta k en el lado j del tramo i del muro w? */
  presente(k: number, w: number, i: number, j: number): { debajo: boolean; encima: boolean };
}

/** Paso 3: paños, filas, huecos y empujes unidos, y presencia junto a cada planta. */
export function planMuros(ctx: Contexto, plantas: ReadonlyMap<number, PlantaMuros>, puntos: readonly Vec2[][], est: EstacionesMuros, diag: Diagnosticos): PlanMuros {
  const { epsGeom, epsSnap, tamanoMalla: h } = ctx.op;
  const ejes = puntos.map((p) =>
    p.slice(1).map((B, i) => {
      const A = p[i]!;
      const L = dist(A, B);
      return { A, u: [(B[0] - A[0]) / L, (B[1] - A[1]) / L] as Vec2, L };
    }),
  );
  const sigma = (w: number, i: number, Q: Vec2) => {
    const { A, u } = ejes[w]![i]!;
    return (Q[0] - A[0]) * u[0] + (Q[1] - A[1]) * u[1];
  };
  const P = (k: number, p: number): Vec2 => {
    const q = plantas.get(k)!.a.puntos[p]!;
    return [q.x, q.y];
  };
  const panos: PanoMuro[] = [];
  ctx.muros.forEach((m, w) => {
    for (let i = 0; i + 1 < puntos[w]!.length; i++) for (let k = m.kb - 1; k >= m.kh; k--) {
      const arriba = est.cadena(k, w, i);
      const s = arriba.map((p) => sigma(w, i, P(k, p)));
      const sigmas = s.flatMap((x, j) => (j + 1 < s.length ? [x, (x + s[j + 1]!) / 2] : [x]));
      panos.push({ w, i, k, arriba, abajo: est.cadena(k + 1, w, i), grupo: -1, sigmas, estaciones: arriba.map((p) => P(k, p)) });
    }
  });
  // Grupos: paños de la misma planta que comparten una estación de su cabeza
  const uf = new UnionFind(panos.length);
  const porPunto = new Map<string, number>();
  panos.forEach((pa, j) => {
    for (const p of pa.arriba) {
      const kk = `${pa.k}:${p}`;
      const otro = porPunto.get(kk);
      if (otro === undefined) porPunto.set(kk, j);
      else uf.unir(otro, j);
    }
  });
  const indiceGrupo = new Map<number, number>();
  panos.forEach((pa, j) => {
    const r = uf.raiz(j);
    if (!indiceGrupo.has(r)) indiceGrupo.set(r, indiceGrupo.size);
    pa.grupo = indiceGrupo.get(r)!;
  });
  // Niveles de cada grupo: las cotas de su planta y, unidas a ≤ ε_snap, las de huecos y empujes
  const niveles: number[][] = [];
  const candidatos: number[][] = [];
  const zb = (pa: PanoMuro) => ctx.cotas[pa.k + 1]!;
  const zt = (pa: PanoMuro) => ctx.cotas[pa.k]!;
  for (const pa of panos) {
    niveles[pa.grupo] ??= [zb(pa), zt(pa)];
    candidatos[pa.grupo] ??= [];
    const m = ctx.muros[pa.w]!;
    const base = ctx.cotas[m.kb]!;
    const cerca = (z: number) => z > zb(pa) - epsSnap && z < zt(pa) + epsSnap;
    for (const hh of m.huecos) if (hh.tramo === pa.i) for (const z of [base + hh.z0, base + hh.z1]) if (cerca(z)) candidatos[pa.grupo]!.push(z);
    for (const c of ctx.cargas) if (c.tipo === "empuje" && c.muro === m.muro.id) for (const z of [base + c.z0, base + c.z1]) if (cerca(z)) candidatos[pa.grupo]!.push(z);
  }
  const unido = new Map<string, number>();
  niveles.forEach((nv, g) => {
    for (const z of [...new Set(candidatos[g]!)].sort((a, b) => a - b)) {
      let mejor = -1;
      for (let j = 0; j < nv.length; j++) if (Math.abs(nv[j]! - z) <= epsSnap && (mejor < 0 || Math.abs(nv[j]! - z) < Math.abs(nv[mejor]! - z))) mejor = j;
      if (mejor < 0) nv.push(z);
      unido.set(`${g}:${z}`, mejor < 0 ? z : nv[mejor]!);
    }
    nv.sort((a, b) => a - b);
  });
  /** Cota unida de z en el muro w (en la planta en la que cae, o la de la cota de planta más cercana a ≤ ε_snap). */
  const unir = (w: number, i: number, z: number): number => {
    const m = ctx.muros[w]!;
    const [zmin, zmax] = [ctx.cotas[m.kb]!, ctx.cotas[m.kh]!];
    if (z <= zmin + epsSnap) return zmin;
    if (z >= zmax - epsSnap) return zmax;
    for (let k = m.kh; k < m.kb; k++) if (Math.abs(ctx.cotas[k]! - z) <= epsSnap) return ctx.cotas[k]!;
    const pa = panos.find((x) => x.w === w && x.i === i && z > zb(x) && z < zt(x))!;
    return unido.get(`${pa.grupo}:${z}`) ?? z;
  };
  const filas = niveles.map((nv) => {
    const f: number[] = [nv[0]!];
    for (let j = 0; j + 1 < nv.length; j++) {
      const d = nv[j + 1]! - nv[j]!;
      const n = Math.max(1, Math.ceil(d / h - 1e-4));
      for (let l = 1; l < n; l++) f.push(nv[j]! + (d * l) / n);
      f.push(nv[j + 1]!);
    }
    return f;
  });
  // Huecos y empujes unidos
  const huecos = ctx.muros.map((m, w) => {
    const base = ctx.cotas[m.kb]!;
    return m.huecos.map((hh, nh) => {
      const [Qa, Qb] = est.bordesHuecos[w]![nh]!;
      const z0 = unir(w, hh.tramo, base + hh.z0);
      const z1 = unir(w, hh.tramo, base + hh.z1);
      const d = Math.max(Math.abs(z0 - base - hh.z0), Math.abs(z1 - base - hh.z1));
      if (d > epsGeom) diag.aviso("muro/ajuste", `El hueco ${nh + 1} del muro ${m.muro.id} se ajusta ${cm(d)} en altura para unirse a lo cercano (C3-b).`, [m.muro.id], { distancia: d });
      return { i: hh.tramo, sa: sigma(w, hh.tramo, Qa!), sb: sigma(w, hh.tramo, Qb!), z0, z1 };
    });
  });
  const empujes = new Map<string, { z0: number; z1: number }>();
  for (const c of ctx.cargas) {
    if (c.tipo !== "empuje") continue;
    const w = ctx.muros.findIndex((m) => m.muro.id === c.muro);
    const m = ctx.muros[w]!;
    const base = ctx.cotas[m.kb]!;
    const [a, b] = [base + c.z0, base + c.z1];
    // Cada extremo, en el tramo 0 (las filas de un grupo son las mismas en todos sus tramos)
    const z0 = unir(w, 0, Math.max(a, base));
    const z1 = unir(w, 0, Math.min(b, ctx.cotas[m.kh]!));
    const d = Math.max(a > base ? Math.abs(z0 - a) : 0, b < ctx.cotas[m.kh]! ? Math.abs(z1 - b) : 0);
    if (d > epsGeom) diag.aviso("muro/ajuste", `El empuje ${c.id} se ajusta ${cm(d)} en altura para que su ley cambie en una fila de la malla del muro ${m.muro.id} (C3-h).`, [c.id, m.muro.id], { distancia: d });
    empujes.set(c.id, { z0, z1 });
  }
  const presente = (k: number, w: number, i: number, j: number) => {
    const m = ctx.muros[w]!;
    const c = est.cadena(k, w, i);
    const sm = (sigma(w, i, P(k, c[j]!)) + sigma(w, i, P(k, c[j + 1]!))) / 2;
    const z = ctx.cotas[k]!;
    const tapa = (f: (x: { z0: number; z1: number }) => boolean) => huecos[w]!.some((hh) => hh.i === i && sm > Math.min(hh.sa, hh.sb) && sm < Math.max(hh.sa, hh.sb) && f(hh));
    return {
      debajo: k >= m.kh && k < m.kb && !tapa((hh) => hh.z0 < z && hh.z1 >= z),
      encima: k > m.kh && k <= m.kb && !tapa((hh) => hh.z0 <= z && hh.z1 > z),
    };
  };
  return { panos, filas, huecos, empujes, ejes, presente };
}

/** Lámina de un muro: nudos de la topología (normal a la derecha del eje), muro, tramo y paño. */
export interface LaminaMuro {
  nudos: [number, number, number, number];
  w: number;
  i: number;
  /** Planta de la cabeza del paño. */
  k: number;
  /** Eje 1: dirección del lado de la estación en planta. */
  eje1: Vec2;
  /** Cotas de su fila (abajo y arriba), para las cargas. */
  z0: number;
  z1: number;
}

export interface MallaMuros {
  laminas: LaminaMuro[];
  /** Nudos de la base de cada muro con vínculo (por id). */
  apoyos: Map<string, number[]>;
  /** Barras auxiliares de C3-e: el tramo de viga y los nudos de la fila del muro por la que sigue. */
  auxiliares: { tramo: TramoViga; nudos: number[] }[];
  /** Relación de aspecto máxima de los elementos de muro y cuántos pasan de 4. */
  aspecto: { max: number; altos: number };
}

/** Relación de aspecto por encima de la cual se avisa (C3: H17 pide ≤ 2 en el cuerpo del muro). */
export const ASPECTO_ALTO = 4;

/**
 * Paso 4: rejilla de cada paño. `nudosCadena(k, w, i)` da los nudos de la topología de la cota de
 * la planta k a lo largo del tramo i del muro w: estaciones y puntos medios alternos (−1 donde no
 * hacen falta). `huellas`: nudos esclavos de una huella (C2-d).
 */
export function mallarMuros(
  ctx: Contexto,
  topo: Topologia,
  plan: PlanMuros,
  nudosCadena: (k: number, w: number, i: number) => number[],
  esclavos: ReadonlySet<number>,
  diag: Diagnosticos,
): MallaMuros {
  const laminas: LaminaMuro[] = [];
  const apoyos = new Map<string, number[]>();
  const intermedio = new Map<string, number>();
  const usados = new Set<number>();
  let aspectoMax = 1;
  let altos = 0;
  const peor = new Map<string, number>();
  for (const pa of plan.panos) {
    const m = ctx.muros[pa.w]!;
    const arriba = nudosCadena(pa.k, pa.w, pa.i);
    const abajo = nudosCadena(pa.k + 1, pa.w, pa.i);
    const Z = plan.filas[pa.grupo]!;
    const r = Z.length - 1;
    const nudo = (c: number, l: number): number => {
      if (l === 0) return abajo[c]!;
      if (l === r) return arriba[c]!;
      const [t, b] = [arriba[c]!, abajo[c]!];
      // Columna sin nudo arriba o abajo (no hace falta en la cota): se toma la posición del otro
      const ref = t >= 0 ? t : b;
      const kk = `${t}|${b}|${pa.k}|${l}`;
      let n = intermedio.get(kk);
      if (n === undefined) {
        const nd = topo.nudos[ref]!;
        topo.nudos.push({ k: pa.k, x: nd.x, y: nd.y, z: Z[l]!, fisicos: new Set(), pilar: null });
        intermedio.set(kk, (n = topo.nudos.length - 1));
      }
      return n;
    };
    const huecos = plan.huecos[pa.w]!.filter((hh) => hh.i === pa.i);
    for (let c = 0; c + 1 < arriba.length; c++) {
      const j = Math.floor(c / 2);
      for (let l = 0; l < r; l++) {
        // Centro del elemento: σ medio de sus dos columnas y cota media de su fila
        const sm = (pa.sigmas[c]! + pa.sigmas[c + 1]!) / 2;
        const zm = (Z[l]! + Z[l + 1]!) / 2;
        if (huecos.some((hh) => sm > Math.min(hh.sa, hh.sb) && sm < Math.max(hh.sa, hh.sb) && zm > hh.z0 && zm < hh.z1)) continue;
        const ns: [number, number, number, number] = [nudo(c, l), nudo(c + 1, l), nudo(c + 1, l + 1), nudo(c, l + 1)];
        if (ns.some((n) => n < 0)) throw new Error(`mallarMuros: falta un nudo de la cota en el muro ${m.muro.id} (tramo ${pa.i + 1}, lado ${j + 1})`);
        for (const n of ns) {
          usados.add(n);
          topo.nudos[n]!.fisicos.add(m.muro.id);
        }
        const X = ns.map((n) => topo.nudos[n]!);
        const ancho = Math.sqrt((X[1]!.x - X[0]!.x) ** 2 + (X[1]!.y - X[0]!.y) ** 2);
        const alto = Z[l + 1]! - Z[l]!;
        const asp = Math.max(ancho / alto, alto / ancho);
        aspectoMax = Math.max(aspectoMax, asp);
        if (asp > ASPECTO_ALTO) {
          altos++;
          peor.set(m.muro.id, Math.max(peor.get(m.muro.id) ?? 0, asp));
        }
        laminas.push({ nudos: ns, w: pa.w, i: pa.i, k: pa.k, eje1: [(X[1]!.x - X[0]!.x) / ancho, (X[1]!.y - X[0]!.y) / ancho], z0: Z[l]!, z1: Z[l + 1]! });
      }
    }
  }
  for (const [id, a] of [...peor].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
    diag.aviso(
      "muro/aspecto",
      `El muro ${id} tiene elementos hasta ${a.toFixed(1)} veces más altos que anchos (o al revés): hay estaciones o filas muy juntas (bordes de huecos, caras de pilares o cruces a poco más de ε_snap), y la membrana pierde precisión (H17 pide ≤ 2).`,
      [id],
      { aspecto: a },
    );
  // Apoyos de la base y comprobación de los muros que nacen sobre otra pieza (C3-f)
  ctx.muros.forEach((m, w) => {
    const base = m.muro.base ?? "empotrado";
    const nudos = new Set<number>();
    for (let i = 0; i + 1 < m.muro.puntos.length; i++) for (const n of nudosCadena(m.kb, w, i)) if (n >= 0 && usados.has(n)) nudos.add(n);
    const lista = [...nudos].sort((a, b) => a - b);
    if (base !== "ninguno") apoyos.set(m.muro.id, lista);
    else if (!lista.some((n) => esclavos.has(n) || [...topo.nudos[n]!.fisicos].some((f) => f !== m.muro.id)))
      diag.error("muro/arranque-sin-apoyo", `El muro ${m.muro.id} nace en la planta ${m.muro.desde} sin vínculo («ninguno») y no le llega ninguna losa, viga, pilar ni otro muro.`, [m.muro.id]);
  });
  return { laminas, apoyos, auxiliares: auxiliaresVigas(ctx, topo, nudosCadena), aspecto: { max: aspectoMax, altos } };
}

/**
 * C3-e (H05, E0-6): una viga que acaba en el extremo de un muro en su plano, sin solaparse con él, se
 * prolonga dentro por la fila de nudos de la planta a lo largo de su canto y al menos un elemento.
 */
function auxiliaresVigas(ctx: Contexto, topo: Topologia, nudosCadena: (k: number, w: number, i: number) => number[]): { tramo: TramoViga; nudos: number[] }[] {
  const r: { tramo: TramoViga; nudos: number[] }[] = [];
  const XY = (n: number): Vec2 => [topo.nudos[n]!.x, topo.nudos[n]!.y];
  for (const tv of topo.tramos) {
    if (!tv.cadena.length) continue;
    const canto = ctx.secciones.get(tv.viga.seccion)!.canto;
    for (const [n, db] of [
      [tv.cadena[0]!.nudo, tv.t.u],
      [tv.cadena[tv.cadena.length - 1]!.nudo, [-tv.t.u[0], -tv.t.u[1]] as Vec2],
    ] as const) {
      if (topo.nudos[n]!.pilar) continue;
      // La viga sale del nudo n en la dirección db; el muro tiene que seguir desde n en la contraria
      let mejor: number[] | null = null;
      ctx.muros.forEach((m, w) => {
        if (mejor || tv.k < m.kh || tv.k > m.kb) return;
        for (let i = 0; i + 1 < m.muro.puntos.length; i++) {
          let c = nudosCadena(tv.k, w, i);
          if (c[c.length - 1] === n) c = [...c].reverse();
          if (c[0] !== n || c.length < 2 || c[1]! < 0) continue;
          const [X0, X1] = [XY(c[0]!), XY(c[1]!)];
          const L = dist(X0, X1);
          const dw: Vec2 = [(X1[0] - X0[0]) / L, (X1[1] - X0[1]) / L];
          if (!(Math.abs(dw[0] * db[1] - dw[1] * db[0]) <= 0.01 && dw[0] * db[0] + dw[1] * db[1] < 0)) continue;
          const nudos = [c[0]!];
          let largo = 0;
          for (let j = 1; j < c.length && c[j]! >= 0; j++) {
            largo += dist(XY(c[j - 1]!), XY(c[j]!));
            nudos.push(c[j]!);
            if (largo >= canto - ctx.op.epsGeom) break;
          }
          mejor = nudos;
          return;
        }
      });
      if (mejor) r.push({ tramo: tv, nudos: mejor });
    }
  }
  return r;
}
