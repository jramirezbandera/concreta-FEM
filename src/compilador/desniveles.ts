/**
 * Fase DN (`docs/fem3d/desniveles.md`): los desniveles de los forjados.
 *
 * Los nudos de un forjado con desnivel siguen en el plano de su planta (DN-a); lo que cambia es lo
 * que cada pieza ocupa alrededor del nudo de un pilar (ZR1), que se calcula con la cara superior de
 * cada forjado y de cada viga respecto al plano. Aquí, lo que no depende de la malla y sirve igual al
 * compilador y al dibujo (que no espera a compilar, AL-4):
 *
 * - **`desnivelesVigas`** (DN-e): una viga no tiene desnivel propio, sino el del forjado más alto que
 *   la toca: el que pasa por su eje o llega a una de sus caras, mirado a b/4 del eje y un poco más allá
 *   de cada cara, a 1/4, 1/2 y 3/4 de cada tramo. Sin forjados, el de la planta (0).
 * - **`escalones`** (DN-b): donde dos forjados de una planta con desniveles distintos comparten un
 *   trozo de borde, el solape en canto es lo común de sus dos franjas verticales,
 *   min(caras superiores) − max(caras inferiores). Lo que de ese trozo no va sobre el eje de una viga
 *   (a menos de b/2), de un muro que llega a la planta (a menos de t/2) o de un apoyo lineal, con un
 *   solape menor que la mitad del canto del más delgado, se devuelve: sin solape, es un error; con él,
 *   un aviso.
 *
 * Sólo aritmética y `Math.sqrt`/`Math.hypot` (COM-12).
 */
import type { Diagnosticos } from "../motor/diagnosticos.ts";
import type { ModeloFisico, Seccion, Vec2, Viga } from "./fisico.ts";
import { cuerdaHuella, huellaPilar, type Huella } from "./geometria2d.ts";
import { puntoEnRegion, type Region } from "./poligonos.ts";
import type { SeccionCompilada } from "./secciones.ts";
import { ejeTramo, seccionTramo } from "./topologia.ts";
import type { Contexto, LosaCompilada, PanoCompilado } from "./validar.ts";

/** Un forjado de una planta (losa o paño), con su desnivel y su canto. */
export interface ForjadoDN {
  id: string;
  planta: string;
  region: Region;
  /** Desnivel de su cara superior respecto a la cota de la planta, m. */
  desnivel: number;
  /** Canto total, m (en un paño, el de su vigueta). */
  canto: number;
}

/** Una pieza lineal que sostiene un borde (viga, muro o apoyo lineal): su eje y medio ancho. */
export interface SoporteDN {
  id: string;
  planta: string;
  puntos: readonly Vec2[];
  semiancho: number;
}

/** Las losas y los paños como forjados con su desnivel y su canto. */
export function forjadosDN(losas: readonly LosaCompilada[], panos: readonly PanoCompilado[]): ForjadoDN[] {
  return [
    ...losas.map((l) => ({ id: l.losa.id, planta: l.losa.planta, region: l.region, desnivel: l.losa.desnivel ?? 0, canto: l.material.t })),
    ...panos.map((p) => ({ id: p.pano.id, planta: p.pano.planta, region: p.region, desnivel: p.pano.desnivel ?? 0, canto: p.seccion.canto })),
  ];
}

/** Las vigas como soportes, con medio ancho de su alma. */
export const soportesVigas = (vigas: readonly Viga[], secciones: ReadonlyMap<string, SeccionCompilada>): SoporteDN[] =>
  vigas.map((v) => ({ id: v.id, planta: v.planta, puntos: v.puntos, semiancho: (secciones.get(v.seccion)?.alma ?? 0) / 2 }));

/** Desnivel de cada viga con algún forjado de su planta con desnivel (DN-e); las demás, 0. */
export function desnivelesVigas(forjados: readonly ForjadoDN[], vigas: readonly SoporteDN[], eps: number): Map<string, number> {
  const res = new Map<string, number>();
  const conDesnivel = new Set(forjados.filter((f) => f.desnivel !== 0).map((f) => f.planta));
  if (!conDesnivel.size) return res;
  for (const v of vigas) {
    if (!conDesnivel.has(v.planta)) continue;
    const deLaPlanta = forjados.filter((f) => f.planta === v.planta);
    let max = -Infinity;
    for (let i = 0; i + 1 < v.puntos.length; i++) {
      const [ax, ay] = v.puntos[i]!;
      const [bx, by] = v.puntos[i + 1]!;
      const L = Math.hypot(bx - ax, by - ay);
      if (!(L > eps)) continue;
      const n: Vec2 = [-(by - ay) / L, (bx - ax) / L];
      for (const t of [0.25, 0.5, 0.75]) {
        const M: Vec2 = [ax + t * (bx - ax), ay + t * (by - ay)];
        for (const d of [v.semiancho / 2, -v.semiancho / 2, v.semiancho + 2 * eps, -v.semiancho - 2 * eps]) {
          const q: Vec2 = [M[0] + d * n[0], M[1] + d * n[1]];
          for (const f of deLaPlanta) if (f.desnivel > max && puntoEnRegion(q, f.region)) max = f.desnivel;
        }
      }
    }
    if (max !== -Infinity && max !== 0) res.set(v.id, max);
  }
  return res;
}

/** Un trozo de borde común entre dos forjados con desniveles distintos y sin apoyo bastante. */
export interface EscalonDN {
  a: string;
  b: string;
  planta: string;
  desde: Vec2;
  hasta: Vec2;
  /** Solape en canto de los dos forjados, m (≤ 0: no se tocan). */
  solape: number;
  /** El canto del más delgado, m. */
  cantoMinimo: number;
}

const anillos = (r: Region) => [r.contorno, ...r.huecos];

/** La huella de un pilar en una planta. */
export interface PilarDN {
  planta: string;
  huella: Huella;
}

const cm = (d: number) => `${(d * 100).toFixed(1)} cm`;
const coma2 = (v: number) => (Math.round(v * 100) / 100 + 0).toFixed(2).replace(".", ",");

/**
 * DN-b en el compilador: `losa/escalon-sin-apoyo` (error) donde dos forjados con desniveles distintos no
 * se solapan en canto y su borde común no va sobre una viga, un muro, un apoyo lineal o la huella de un
 * pilar; `losa/escalon-solape-corto` (aviso) donde se solapan menos de medio canto del más delgado.
 */
export function avisarEscalones(ctx: Contexto, diag: Diagnosticos): void {
  const forjados = forjadosDN(ctx.losas, ctx.panos);
  if (!forjados.some((f) => f.desnivel !== 0)) return;
  const soportes: SoporteDN[] = [
    ...soportesVigas(ctx.vigas, ctx.secciones),
    ...ctx.muros.flatMap((w) => ctx.plantas.slice(w.kh, w.kb + 1).map((pl) => ({ id: w.muro.id, planta: pl.id, puntos: w.muro.puntos, semiancho: w.material.t / 2 }))),
    ...ctx.apoyosLineales.map((a) => ({ id: a.id, planta: a.planta, puntos: a.puntos, semiancho: 0 })),
  ];
  const pilares: PilarDN[] = [];
  for (const p of ctx.pilares) {
    const [kb, kh] = [ctx.planta.get(p.desde)!, ctx.planta.get(p.hasta)!];
    // en cada planta que atraviesa o en la que acaba, la huella del tramo que llega desde abajo
    for (let k = kh; k < kb; k++) {
      const [x, y] = ejeTramo(ctx, p, k);
      pilares.push({ planta: ctx.plantas[k]!.id, huella: huellaPilar(x, y, p.giro ?? 0, ctx.secciones.get(seccionTramo(ctx, p, k))?.huella ?? null) });
    }
  }
  const eps = ctx.op.epsSnap;
  for (const e of escalones(forjados, soportes, eps, pilares, ctx.op.epsGeom)) {
    const tramo = `de (${e.desde.map(coma2).join("; ")}) a (${e.hasta.map(coma2).join("; ")})`;
    if (e.solape <= ctx.op.epsGeom)
      diag.error(
        "losa/escalon-sin-apoyo",
        `Los forjados ${e.a} y ${e.b} de la planta ${e.planta} tienen desniveles distintos y no se solapan en canto (${cm(-e.solape)} de hueco), así que no se transmiten nada por su borde común ${tramo}. Ponga una viga, un muro o un apoyo lineal en ese borde, o acerque sus desniveles.`,
        [e.a, e.b],
        { solape: e.solape },
      );
    else
      diag.aviso(
        "losa/escalon-solape-corto",
        `Los forjados ${e.a} y ${e.b} de la planta ${e.planta} sólo se solapan ${cm(e.solape)} en canto por su borde común ${tramo}, menos de la mitad del más delgado (${cm(e.cantoMinimo)}): el cálculo los une, pero las barras de uno tienen que doblarse o anclarse en ese solape. Con una viga en el escalón no hace falta.`,
        [e.a, e.b],
        { solape: e.solape },
      );
  }
}

/** Los trozos de borde común sin apoyo de los forjados con desniveles distintos (DN-b). */
export function escalones(entrada: readonly ForjadoDN[], soportes: readonly SoporteDN[], eps: number, pilares: readonly PilarDN[] = [], epsZ = eps): EscalonDN[] {
  const res: EscalonDN[] = [];
  // Por ids, para que el diagnóstico no dependa del orden de las listas
  const forjados = [...entrada].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (let i = 0; i < forjados.length; i++)
    for (let j = i + 1; j < forjados.length; j++) {
      const A = forjados[i]!;
      const B = forjados[j]!;
      if (A.planta !== B.planta || Math.abs(A.desnivel - B.desnivel) <= epsZ) continue;
      const solape = Math.min(A.desnivel, B.desnivel) - Math.max(A.desnivel - A.canto, B.desnivel - B.canto);
      const cantoMinimo = Math.min(A.canto, B.canto);
      if (solape >= cantoMinimo / 2 - epsZ) continue;
      const deLaPlanta = soportes.filter((s) => s.planta === A.planta);
      for (const ra of anillos(A.region))
        for (let p = 0; p < ra.length; p++) {
          const P = ra[p]!;
          const Q = ra[(p + 1) % ra.length]!;
          const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
          if (!(L > eps)) continue;
          const u: Vec2 = [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L];
          // lo común con los lados de B, como intervalos de [0, L] sobre PQ
          const comunes: [number, number][] = [];
          for (const rb of anillos(B.region))
            for (let q = 0; q < rb.length; q++) {
              const I = enRecta(P, u, L, rb[q]!, rb[(q + 1) % rb.length]!, eps);
              if (I) comunes.push(I);
            }
          if (!comunes.length) continue;
          const cubiertos: [number, number][] = [];
          for (const s of deLaPlanta)
            for (let q = 0; q + 1 < s.puntos.length; q++) {
              const I = enRecta(P, u, L, s.puntos[q]!, s.puntos[q + 1]!, s.semiancho + eps);
              if (I) cubiertos.push(I);
            }
          // lo que va por la huella de un pilar (por dentro o por su cara)
          for (const h of pilares) {
            if (h.planta !== A.planta) continue;
            const c = cuerdaHuella(P, u, h.huella, eps, true);
            if (c && Math.min(L, c[1]) > Math.max(0, c[0])) cubiertos.push([Math.max(0, c[0]), Math.min(L, c[1])]);
          }
          for (const [s0, s1] of restar(unir(comunes), unir(cubiertos))) {
            if (s1 - s0 <= eps) continue;
            const X: Vec2 = [P[0] + s0 * u[0], P[1] + s0 * u[1]];
            const Y: Vec2 = [P[0] + s1 * u[0], P[1] + s1 * u[1]];
            const alReves = X[0] > Y[0] || (X[0] === Y[0] && X[1] > Y[1]);
            res.push({ a: A.id, b: B.id, planta: A.planta, desde: alReves ? Y : X, hasta: alReves ? X : Y, solape, cantoMinimo });
          }
        }
    }
  return res;
}

/**
 * El trozo de [0, L] de la recta P + s·u que recorre el segmento CD, si es paralelo a ella (a menos
 * de eps en sus extremos) y la distancia de sus dos extremos a la recta es ≤ tol.
 */
function enRecta(P: Vec2, u: Vec2, L: number, C: Vec2, D: Vec2, tol: number): [number, number] | null {
  const dist = (X: Vec2) => Math.abs((X[0] - P[0]) * u[1] - (X[1] - P[1]) * u[0]);
  if (dist(C) > tol || dist(D) > tol) return null;
  const sC = (C[0] - P[0]) * u[0] + (C[1] - P[1]) * u[1];
  const sD = (D[0] - P[0]) * u[0] + (D[1] - P[1]) * u[1];
  const s0 = Math.max(0, Math.min(sC, sD));
  const s1 = Math.min(L, Math.max(sC, sD));
  return s1 > s0 ? [s0, s1] : null;
}

function unir(I: [number, number][]): [number, number][] {
  const o = [...I].sort((x, y) => x[0] - y[0]);
  const r: [number, number][] = [];
  for (const [a, b] of o) {
    const u = r[r.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], b);
    else r.push([a, b]);
  }
  return r;
}

function restar(A: [number, number][], B: [number, number][]): [number, number][] {
  const r: [number, number][] = [];
  for (const [a0, a1] of A) {
    let s = a0;
    for (const [b0, b1] of B) {
      if (b1 <= s || b0 >= a1) continue;
      if (b0 > s) r.push([s, b0]);
      s = Math.max(s, b1);
    }
    if (s < a1) r.push([s, a1]);
  }
  return r;
}

/** Canto de una sección física (h; D en una circular), m; null si no se sabe. */
function cantoFisico(s: Seccion | undefined): number | null {
  if (!s) return null;
  switch (s.forma) {
    case "rectangular":
    case "T":
      return s.h;
    case "circular":
      return s.D;
    case "I":
      return s.perfil.h / 1000;
    case "general":
      return s.h ?? null;
  }
}

/**
 * `desnivelesVigas` sobre el modelo físico, sin compilar (para el dibujo y la sensatez): las losas y los
 * paños con su canto, y las vigas con medio ancho de su sección (b de una rectangular, bw de una T).
 */
export function desnivelesVigasFisico(f: ModeloFisico, eps = 0.05): Map<string, number> {
  if (![...(f.losas ?? []), ...(f.panos ?? [])].some((x) => (x.desnivel ?? 0) !== 0)) return new Map();
  const seccion = new Map(f.secciones.map((s) => [s.id, s]));
  const region = (x: { contorno: readonly Vec2[]; huecos?: readonly (readonly Vec2[])[] }): Region => ({ contorno: x.contorno, huecos: x.huecos ?? [] });
  const ancho = (s: Seccion | undefined) => (s?.forma === "rectangular" ? s.b : s?.forma === "T" ? s.bw : s?.forma === "circular" ? s.D : 0);
  return desnivelesVigas(
    [
      ...(f.losas ?? []).map((l) => ({ id: l.id, planta: l.planta, region: region(l), desnivel: l.desnivel ?? 0, canto: l.espesor })),
      ...(f.panos ?? []).map((p) => ({ id: p.id, planta: p.planta, region: region(p), desnivel: p.desnivel ?? 0, canto: cantoFisico(seccion.get(p.seccion)) ?? 0 })),
    ],
    (f.vigas ?? []).map((v) => ({ id: v.id, planta: v.planta, puntos: v.puntos, semiancho: ancho(seccion.get(v.seccion)) / 2 })),
    eps,
  );
}
