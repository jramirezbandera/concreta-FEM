/**
 * Bajada de cargas por áreas tributarias (A3, `docs/fem3d/agente.md` §8): un oráculo del modelo,
 * independiente del compilador y del motor, para comparar con el axil de cada tramo de pilar. Un
 * pilar sin conectar, un apoyo que falta o una transición no buscada se ven como un axil muy
 * distinto de su bajada.
 *
 * - En cada planta, el diagrama de Voronoi de los pilares que la sostienen (los que tienen un tramo
 *   con su cabeza en ella) y de puntos cada `PASO_MURO` m de los ejes de los muros que llegan a
 *   ella, recortado a la caja de la planta. Cada celda es convexa (intersección de semiplanos).
 * - Cada carga va donde cae: las de superficie y el pp de losas y paños, por el área de la celda
 *   dentro de su región (`momentosInterseccion`); las lineales, las de viga y el peso de las vigas,
 *   muestreados por su eje cada `PASO` m al generador más cercano; las puntuales, al suyo.
 * - La bajada de un tramo es lo que recibe en su planta más lo que baja por el tramo de encima, con
 *   su peso y sus cargas. Un pilar apeado (base "ninguno") lleva lo suyo, como carga puntual, a la
 *   planta en la que nace.
 * - Lo que cae en las celdas de los muros es de los muros: no se comprueba.
 *
 * Sólo cargas verticales (hacia abajo positivas, kN) y sólo los casos que se piden (los
 * gravitatorios). Puro.
 */
import type { CargaFisica, Losa, ModeloFisico, PanoUnidireccional, Vec2 } from "../compilador/fisico.ts";
import { momentosInterseccion, type Region } from "../compilador/poligonos.ts";
import { ejeSeccion } from "../compilador/puntoFijo.ts";
import { areaRegion, areaSeccion, gammaMaterial, pesoLibre, pesoLosa, Plantas, ppDePano, regionDe, sobreMuros, tramos } from "./sensatez.ts";

/** Separación de los puntos de los ejes de los muros que hacen de generadores, m. */
export const PASO_MURO = 0.5;
/** Paso del muestreo de las cargas lineales y de viga, m. */
export const PASO = 0.25;

interface Generador {
  /** Id del pilar o del muro. */
  id: string;
  pilar: boolean;
  p: Vec2;
}

/** Recorta el polígono convexo `c` con el semiplano {x : (x − m)·d ≤ 0}. */
function recortar(c: Vec2[], m: Vec2, d: Vec2): Vec2[] {
  const r: Vec2[] = [];
  const f = (p: Vec2) => (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
  for (let i = 0; i < c.length; i++) {
    const [a, b] = [c[i]!, c[(i + 1) % c.length]!];
    const [fa, fb] = [f(a), f(b)];
    if (fa <= 0) r.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      r.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return r;
}

/** Recorta el polígono `p` (cualquiera) con el convexo antihorario `c`: Sutherland–Hodgman. */
function recortarConvexo(p: Vec2[], c: readonly Vec2[]): Vec2[] {
  let r = p;
  for (let i = 0; i < c.length && r.length; i++) {
    const [a, b] = [c[i]!, c[(i + 1) % c.length]!];
    // interior a la izquierda de ab: (x − a)·n ≤ 0 con n = (b − a) girado −90°
    r = recortar(r, a, [b[1] - a[1], -(b[0] - a[0])]);
  }
  return r;
}

const areaCon = (p: readonly Vec2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i]![0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * p[i]![1];
  return a / 2;
};

/** Celdas de Voronoi de los generadores dentro de la caja (convexas, antihorarias). */
function celdas(gens: readonly Generador[], caja: Vec2[]): Vec2[][] {
  return gens.map((g, i) => {
    const otros = gens.map((h, j) => ({ j, d: Math.hypot(h.p[0] - g.p[0], h.p[1] - g.p[1]) })).filter((x) => x.j !== i && x.d > 0);
    otros.sort((a, b) => a.d - b.d);
    let c = caja;
    for (const { j, d } of otros) {
      // Un generador a más del doble del radio de la celda ya no la recorta
      const radio = Math.max(...c.map((q) => Math.hypot(q[0] - g.p[0], q[1] - g.p[1])));
      if (d > 2 * radio) break;
      const h = gens[j]!.p;
      c = recortar(c, [(g.p[0] + h[0]) / 2, (g.p[1] + h[1]) / 2], [h[0] - g.p[0], h[1] - g.p[1]]);
      if (c.length < 3) return [];
    }
    return c;
  });
}

/** Área de región ∩ celda (convexa) ∩ zona (cualquiera): la zona en triángulos en abanico, cada uno recortado por la celda. */
function areaEnCelda(r: Region, celda: readonly Vec2[], zona: readonly Vec2[] | undefined): number {
  if (!zona) return momentosInterseccion(r, celda).A;
  const sZ = Math.sign(areaCon(zona));
  const O = zona[0]!;
  let A = 0;
  for (let i = 1; i + 1 < zona.length; i++) {
    const t: Vec2[] = [O, zona[i]!, zona[i + 1]!];
    const s = Math.sign(areaCon(t));
    if (!s) continue;
    const tc = recortarConvexo(s > 0 ? t : [t[0]!, t[2]!, t[1]!], celda);
    if (tc.length >= 3) A += sZ * s * momentosInterseccion(r, tc).A;
  }
  return A;
}

export interface TramoTributario {
  pilar: string;
  /** Planta de la cabeza del tramo. */
  planta: string;
  /** Bajada hasta la cabeza del tramo, kN (compresión positiva). */
  bajada: number;
  /**
   * Muro en el que está embebido el tramo (su eje a menos de medio espesor más ε_snap del eje del
   * muro en la misma planta): el muro y el pilar se reparten la carga según su rigidez, así que el
   * axil del pilar no se compara.
   */
  enMuro?: string;
}

/** Bajada tributaria de cada tramo de pilar con la suma de los casos `casos` (ids). */
export function bajadaTributaria(f: ModeloFisico, casos: ReadonlySet<string>, epsSnap = 0.05): TramoTributario[] {
  const P = new Plantas(f);
  const material = new Map(f.materiales.map((m) => [m.id, m]));
  const seccion = new Map(f.secciones.map((s) => [s.id, s]));
  const conPeso = f.casos.some((c) => c.pesoPropio && casos.has(c.id));
  const cargas = (f.cargas ?? []).filter((c) => casos.has(c.caso));
  const losasEn = (pl: string) => (f.losas ?? []).filter((l) => l.planta === pl);
  const panosEn = (pl: string) => (f.panos ?? []).filter((x) => x.planta === pl);

  // Peso y cargas de cada tramo de pilar (van a los tramos de debajo)
  const propio = new Map<string, number>(); // `${pilar}@${k}`
  for (const p of f.pilares ?? []) {
    for (const k of P.tramosVertical(p)) {
      const s = seccion.get(p.tramos?.find((t) => t.planta === P.ids[k])?.seccion ?? p.seccion);
      const m = s && material.get(s.material);
      propio.set(`${p.id}@${k}`, conPeso && s && m ? areaSeccion(s) * gammaMaterial(m) * P.altura(k) : 0);
    }
    const zb = P.cotas[P.indice.get(p.desde)!]!;
    const L = P.cotas[P.indice.get(p.hasta)!]! - zb;
    for (const c of cargas) {
      if (c.tipo !== "pilar" || c.pilar !== p.id) continue;
      const [a, b] = [c.desde ?? 0, c.hasta ?? L];
      const v = (q: readonly number[]) => -(c.ejes === "global" ? q[2]! : q[0]!);
      const [qa, qb] = [v(c.q), v(c.qb ?? c.q)];
      for (const k of P.tramosVertical(p)) {
        const [s0, s1] = [Math.max(a, P.cotas[k + 1]! - zb), Math.min(b, P.cotas[k]! - zb)];
        if (!(s1 > s0) || !(b > a)) continue;
        const q = (s: number) => qa + ((qb - qa) * (s - a)) / (b - a);
        propio.set(`${p.id}@${k}`, propio.get(`${p.id}@${k}`)! + ((q(s0) + q(s1)) / 2) * (s1 - s0));
      }
    }
  }

  const caja = (() => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const ver = (q: readonly number[]) => ([x0, y0, x1, y1] = [Math.min(x0, q[0]!), Math.min(y0, q[1]!), Math.max(x1, q[0]!), Math.max(y1, q[1]!)]);
    for (const p of f.pilares ?? []) ver([p.x, p.y]);
    for (const x of [...(f.losas ?? []), ...(f.panos ?? [])]) x.contorno.forEach(ver);
    for (const x of [...(f.muros ?? []), ...(f.vigas ?? [])]) x.puntos.forEach(ver);
    for (const c of f.cargas ?? []) if (c.tipo === "puntual") ver([c.x, c.y]);
    else if (c.tipo === "lineal") c.puntos.forEach(ver);
    else if (c.tipo === "superficie" && c.zona) c.zona.forEach(ver);
    const m = 1 + 0.1 * Math.max(x1 - x0, y1 - y0);
    return [
      [x0 - m, y0 - m],
      [x1 + m, y0 - m],
      [x1 + m, y1 + m],
      [x0 - m, y1 + m],
    ] as Vec2[];
  })();

  // El eje del tramo de un pilar con la cabeza en la planta k (PF: el centro de su sección)
  const ejeEn = (p: NonNullable<ModeloFisico["pilares"]>[number], k: number): Vec2 => ejeSeccion(p, f.secciones?.find((s) => s.id === (p.tramos?.find((t) => t.planta === P.ids[k])?.seccion ?? p.seccion)));
  const cabeza = new Map<string, number>(); // bajada en la cabeza del tramo `${pilar}@${k}`
  const r: TramoTributario[] = [];
  const apeados = new Map<number, { p: Vec2; F: number }[]>();
  for (let k = 0; k < P.ids.length; k++) {
    const pl = P.ids[k]!;
    const gens: Generador[] = [];
    for (const p of f.pilares ?? []) if (P.tramosVertical(p).includes(k)) gens.push({ id: p.id, pilar: true, p: ejeEn(p, k) });
    for (const m of f.muros ?? []) {
      if (!P.tramosVertical(m).includes(k)) continue;
      for (const t of tramos(m.puntos)) {
        const n = Math.max(1, Math.ceil(t.L / PASO_MURO));
        for (let i = 0; i <= n; i++) gens.push({ id: m.id, pilar: false, p: [t.A[0] + (t.u[0] * t.L * i) / n, t.A[1] + (t.u[1] * t.L * i) / n] });
      }
    }
    // Generadores repetidos (las esquinas de un muro): uno basta
    const unicos = [...new Map(gens.map((g) => [`${g.p[0].toFixed(9)},${g.p[1].toFixed(9)}`, g])).values()];
    const recibe = new Map<string, number>(unicos.filter((g) => g.pilar).map((g) => [g.id, 0]));
    if (unicos.length) {
      const C = celdas(unicos, caja);
      const cercano = (q: Vec2) => {
        let [mejor, dmin] = [0, Infinity];
        unicos.forEach((g, i) => {
          const d = (g.p[0] - q[0]) ** 2 + (g.p[1] - q[1]) ** 2;
          if (d < dmin) [mejor, dmin] = [i, d];
        });
        return unicos[mejor]!;
      };
      const dar = (g: Generador, F: number) => {
        if (g.pilar) recibe.set(g.id, recibe.get(g.id)! + F);
      };
      const enCeldas = (r: Region, q: number, zona?: readonly Vec2[]) => {
        if (!q) return;
        unicos.forEach((g, i) => {
          if (g.pilar && C[i]!.length >= 3) dar(g, q * areaEnCelda(r, C[i]!, zona));
        });
      };
      const muestrear = (puntos: readonly Vec2[], q: (s: number) => number, desde = 0, hasta = Infinity) => {
        let s0 = 0;
        for (const t of tramos(puntos)) {
          const [a, b] = [Math.max(desde, s0), Math.min(hasta, s0 + t.L)];
          if (b > a) {
            const n = Math.max(1, Math.ceil((b - a) / PASO));
            for (let i = 0; i < n; i++) {
              const s = a + ((i + 0.5) * (b - a)) / n;
              dar(cercano([t.A[0] + t.u[0] * (s - s0), t.A[1] + t.u[1] * (s - s0)]), (q(s) * (b - a)) / n);
            }
          }
          s0 += t.L;
        }
      };
      // Peso de losas, paños y vigas
      if (conPeso) {
        for (const l of losasEn(pl)) {
          const m = material.get(l.material);
          if (m) enCeldas(regionDe(l), pesoLosa(l, m) / areaRegion(l));
        }
        for (const x of panosEn(pl)) enCeldas(regionDe(x), ppDePano(f, x) ?? 0);
        for (const v of f.vigas ?? []) {
          if (v.planta !== pl) continue;
          const s = seccion.get(v.seccion);
          const m = s && material.get(s.material);
          if (!s || !m) continue;
          const g = gammaMaterial(m);
          const w = areaSeccion(s) * g;
          const bajo = s.forma === "rectangular" && m.tipo === "hormigon";
          // C2-g: bajo una losa o un paño, sólo lo que no pesa ya como forjado (mitad del ancho a cada lado, AU-4); A-9: por
          // el eje de un muro que le llega desde abajo, sólo lo que sobresale de él
          for (const t of tramos(v.puntos)) {
            const muros = bajo ? sobreMuros(t, k, f, P, epsSnap) : [];
            muestrear([t.A, t.B], (sl) => {
              if (!bajo) return w;
              let wl = 0;
              for (const lado of [1, -1]) wl += (s.b / 2) * pesoLibre(f, pl, [t.A[0] + t.u[0] * sl - (lado * t.u[1] * s.b) / 4, t.A[1] + t.u[1] * sl + (lado * t.u[0] * s.b) / 4], s.h, g);
              const o = muros.find((x) => sl > x.desde && sl < x.hasta);
              return o ? (wl * Math.max(0, s.b - o.t)) / s.b : wl;
            });
          }
        }
      }
      for (const c of cargas) {
        const enPlanta = "planta" in c ? c.planta === pl : c.tipo === "viga" ? (f.vigas ?? []).find((v) => v.id === c.viga)?.planta === pl : false;
        if (!enPlanta) continue;
        cargaEnPlanta(c, losasEn(pl), panosEn(pl), enCeldas, muestrear, (q, F) => dar(cercano(q), F), f);
      }
      for (const a of apeados.get(k) ?? []) dar(cercano(a.p), a.F);
    }
    // Bajada en la cabeza de cada tramo con su cabeza en k
    for (const p of f.pilares ?? []) {
      const ks = P.tramosVertical(p);
      if (!ks.includes(k)) continue;
      const arriba = ks.includes(k - 1) ? cabeza.get(`${p.id}@${k - 1}`)! + propio.get(`${p.id}@${k - 1}`)! : 0;
      const N = (recibe.get(p.id) ?? 0) + arriba;
      cabeza.set(`${p.id}@${k}`, N);
      const muro = (f.muros ?? []).find((m) => P.tramosVertical(m).includes(k) && tramos(m.puntos).some((t) => distancia(ejeEn(p, k), t) <= m.espesor / 2 + epsSnap));
      r.push({ pilar: p.id, planta: pl, bajada: N, ...(muro ? { enMuro: muro.id } : {}) });
      // Un pilar apeado lleva lo suyo a la planta en la que nace
      const kb = ks[ks.length - 1]! + 1;
      if (k === kb - 1 && (p.base ?? "empotrado") === "ninguno") apeados.set(kb, [...(apeados.get(kb) ?? []), { p: ejeEn(p, k), F: N + propio.get(`${p.id}@${k}`)! }]);
    }
  }
  return r;
}

/** Distancia de q al segmento AB. */
function distancia(q: Vec2, t: { A: Vec2; L: number; u: Vec2 }): number {
  const s = Math.min(t.L, Math.max(0, (q[0] - t.A[0]) * t.u[0] + (q[1] - t.A[1]) * t.u[1]));
  return Math.hypot(q[0] - t.A[0] - s * t.u[0], q[1] - t.A[1] - s * t.u[1]);
}

/** Una carga de la planta: a las celdas (superficie), muestreada (lineal y de viga) o puntual. */
function cargaEnPlanta(
  c: CargaFisica,
  losas: Losa[],
  panos: PanoUnidireccional[],
  enCeldas: (r: Region, q: number, zona?: readonly Vec2[]) => void,
  muestrear: (puntos: readonly Vec2[], q: (s: number) => number, desde?: number, hasta?: number) => void,
  puntual: (q: Vec2, F: number) => void,
  f: ModeloFisico,
): void {
  switch (c.tipo) {
    case "superficie": {
      const q = -c.q[2];
      const regiones = [...losas.filter((l) => c.pano === undefined && (c.losa === undefined || l.id === c.losa)), ...panos.filter((x) => c.losa === undefined && (c.pano === undefined || x.id === c.pano))];
      for (const x of regiones) enCeldas(regionDe(x), q, c.zona);
      return;
    }
    case "lineal":
      muestrear(c.puntos, () => -c.q[2]);
      return;
    case "puntual":
      if (c.F?.[2]) puntual([c.x, c.y], -c.F[2]);
      return;
    case "viga": {
      const v = (f.vigas ?? []).find((x) => x.id === c.viga);
      if (!v) return;
      const L = tramos(v.puntos).reduce((s, t) => s + t.L, 0);
      const [a, b] = [c.desde ?? 0, c.hasta ?? L];
      const [qa, qb] = [-c.q[2], -(c.qb ?? c.q)[2]];
      muestrear(v.puntos, (s) => (b > a ? qa + ((qb - qa) * (s - a)) / (b - a) : qa), a, b);
      return;
    }
    default:
      return; // las de pilar van con su peso; los empujes son horizontales
  }
}
