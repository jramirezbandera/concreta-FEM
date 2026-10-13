/**
 * Las cargas de un caso en el 3D del visor (a petición del usuario, tras I4;
 * `docs/fem3d/interfaz.md` §17), de `geometriaCargas` (las mismas del alzado): bloques translúcidos
 * con flechas, la punta de cada flecha en la pieza y en el sentido de la carga.
 *
 * - Superficie: la tapa del bloque sobre su región (los trapecios de `descomponer`, los del sólido) y
 *   una flecha en cada nudo de una retícula de paso ≥ 1 m (≤ ~100 por carga).
 * - Lineal, viga y pilar: una valla de la pieza a la cola de las flechas, con una flecha cada ≤ 0,75 m.
 * - Puntual: una flecha de largo fijo (ORDENADA_DIAGRAMA m por la escala) en la dirección de F, y su
 *   momento, una flecha de doble punta de 0,6 de ese largo en la dirección de M (regla de la mano
 *   derecha), que sale del punto.
 * - Empuje: la tapa del bloque de presiones de cada tramo del muro, con su contorno y una retícula de
 *   flechas (sin las de los huecos).
 * Escalas: la mayor carga de superficie (o presión) del caso ocupa ORDENADA_DIAGRAMA m por la pedida,
 * y la mayor por metro, lo mismo con la suya.
 * Cada carga dice las plantas en las que está, para que el 3D rotule sólo las de la planta resaltada
 * (y las elegidas): en sólido, las de las plantas de abajo quedan dentro del edificio. Cada segmento
 * y cada triángulo dicen su carga y su planta (lo de un pilar o un muro, partido por plantas: la de
 * la cabeza de cada tramo, como en el sólido y el alámbrico), y cada carga, su pieza y el tipo de
 * esta: así el 3D filtra las cargas como las piezas (rango de plantas, tipos, aislar y ocultar) y las
 * elige con un clic.
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba.
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../compilador/cotas.ts";
import type { CargaFisica, ModeloFisico } from "../compilador/fisico.ts";
import { geometriaCargas, presionEn, textoCarga, type ClaseCarga, type V3 } from "../agente/render/cargas.ts";
import { ORDENADA_DIAGRAMA } from "../agente/render/diagramas.ts";
import { rotulo, type EntradaLeyenda } from "../agente/render/escena.ts";
import { descomponer } from "./solido.ts";

export const CLASES_CARGA: readonly ClaseCarga[] = ["superficie", "lineal", "puntual", "pieza"];
/** Los colores de cada clase, los de la planta (`carga-*` de `svg.ts`). */
export const COLOR_CARGA: Record<ClaseCarga, string> = { superficie: "#2563eb", lineal: "#dc2626", puntual: "#dc2626", pieza: "#ea580c" };

export interface ObjetoCarga3D {
  id: string;
  tipo: CargaFisica["tipo"];
  texto: string;
  /** Dónde va su rótulo (m, globales): la cola de su flecha central. */
  punto: V3;
  /** Su valor mayor, para dar prioridad a su rótulo. */
  peso: number;
  /** Las plantas en las que está: la suya (superficie, lineal, puntual), la de su viga o las de los tramos de su pilar o su muro. */
  plantas: string[];
  /** La pieza que carga (losa, paño, viga, pilar o muro) y su tipo, para los filtros del 3D; una lineal o una puntual, ninguna. */
  pieza: string | null;
  tipoPieza: "losa" | "pano" | "viga" | "pilar" | "muro" | null;
}

export interface Cargas3D {
  origen: [number, number, number];
  caso: string;
  /** Flechas y contornos: segmentos (x, y, z de sus dos extremos), su clase (índice en CLASES_CARGA), su carga (índice en `objetos`) y su planta (índice en `plantas`). */
  segmentos: Float32Array;
  claseSegmento: Uint8Array;
  objetoSegmento: Uint32Array;
  plantaSegmento: Uint16Array;
  /** Las tapas y las vallas de los bloques: triángulos, su clase, su carga y su planta. */
  triangulos: Float32Array;
  claseTriangulo: Uint8Array;
  objetoTriangulo: Uint32Array;
  plantaTriangulo: Uint16Array;
  /** Las plantas del modelo, de arriba abajo. */
  plantas: string[];
  objetos: ObjetoCarga3D[];
  /** `valor` (kN/m² o kN/m) ocupa `m` metros. */
  escalas: { superficie: { m: number; valor: number }; lineal: { m: number; valor: number }; puntual: number };
  leyenda: EntradaLeyenda[];
  notas: string[];
}

export function cargas3D(f: ModeloFisico, origen: [number, number, number], caso: string, escala = 1): Cargas3D {
  const geo = geometriaCargas(f, caso);
  const indice = new Map(f.plantas.map((p, i) => [p.id, i]));
  /** Las plantas de las cabezas de los tramos de una pieza vertical (las plantas van de arriba abajo). */
  const tramos = (desde: string, hasta: string) => f.plantas.slice(indice.get(hasta) ?? 0, indice.get(desde) ?? 0).map((p) => p.id);
  const cotas = cotasPlantas(f.plantas);
  /** La planta de lo que va de zlo a zhi: la de menor cota que no queda por debajo de zhi (en un tramo vertical, la de su cabeza). */
  const plantaEn = (zhi: number): number => {
    let [k, mejor] = [0, Infinity];
    cotas.forEach((c, i) => {
      if (c !== null && c >= zhi - 1e-6 && c < mejor) [k, mejor] = [i, c];
    });
    return k;
  };
  /** Los cortes de [lo, hi] por las cotas de las plantas. */
  const porPlantas = (lo: number, hi: number): [number, number][] => {
    const zs = [lo, ...cotas.filter((c): c is number => c !== null && c > lo + 1e-9 && c < hi - 1e-9).sort((a, b) => a - b), hi];
    return zs.slice(1).map((z, i) => [zs[i]!, z]);
  };
  const piezaDe = (g: CargaFisica): [string | null, ObjetoCarga3D["tipoPieza"]] => {
    switch (g.tipo) {
      case "superficie":
        return g.losa ? [g.losa, "losa"] : g.pano ? [g.pano, "pano"] : [null, "losa"];
      case "lineal":
      case "puntual":
        return [null, null];
      case "viga":
        return [g.viga, "viga"];
      case "pilar":
        return [g.pilar, "pilar"];
      case "empuje":
        return [g.muro, "muro"];
    }
  };
  const plantasDe = (g: CargaFisica): string[] => {
    switch (g.tipo) {
      case "superficie":
      case "lineal":
      case "puntual":
        return [g.planta];
      case "viga": {
        const v = f.vigas?.find((x) => x.id === g.viga);
        return v ? [v.planta] : [];
      }
      case "pilar": {
        const p = f.pilares?.find((x) => x.id === g.pilar);
        return p ? tramos(p.desde, p.hasta) : [];
      }
      case "empuje": {
        const m = f.muros?.find((x) => x.id === g.muro);
        return m ? tramos(m.desde, m.hasta) : [];
      }
    }
  };
  let [maxS, maxL] = [0, 0];
  for (const x of geo.cargas) {
    for (const r of x.regiones) maxS = Math.max(maxS, Math.hypot(...r.q));
    for (const p of x.presiones) maxS = Math.max(maxS, Math.abs(p.p0), Math.abs(p.p1));
    for (const l of x.lineas) maxL = Math.max(maxL, Math.hypot(...l.qa), Math.hypot(...l.qb));
  }
  const m = ORDENADA_DIAGRAMA * escala;
  const [kS, kL] = [maxS > 0 ? m / maxS : 0, maxL > 0 ? m / maxL : 0];

  const seg: number[] = [];
  const cs: number[] = [];
  const os: number[] = [];
  const ps: number[] = [];
  const tri: number[] = [];
  const ct: number[] = [];
  const ot: number[] = [];
  const pt: number[] = [];
  const objetos: ObjetoCarga3D[] = [];
  const rel = (A: number[], p: readonly number[]) => A.push(p[0]! - origen[0], p[1]! - origen[1], p[2]! - origen[2]);
  let clase = 0;
  let obj = 0;
  let pl = 0;
  const linea = (a: V3, b: V3) => {
    rel(seg, a);
    rel(seg, b);
    cs.push(clase);
    os.push(obj);
    ps.push(pl);
  };
  const triangulo = (a: V3, b: V3, c: V3) => {
    rel(tri, a);
    rel(tri, b);
    rel(tri, c);
    ct.push(clase);
    ot.push(obj);
    pt.push(pl);
  };
  const cuad = (a: V3, b: V3, c: V3, d: V3) => {
    triangulo(a, b, c);
    triangulo(a, c, d);
  };
  /** La flecha de F (m) que acaba en P: el fuste y una punta de cuatro trazos. */
  const flecha = (P: V3, F: V3) => {
    const L = Math.hypot(F[0], F[1], F[2]);
    if (!(L > 1e-3 * m)) return;
    linea([P[0] - F[0], P[1] - F[1], P[2] - F[2]], P);
    punta(P, F, Math.min(0.3 * L, 0.12 * m));
  };
  /** Una punta de cuatro trazos de largo h en P, en la dirección de F. */
  const punta = (P: V3, F: V3, h: number) => {
    const L = Math.hypot(F[0], F[1], F[2]);
    const d: V3 = [F[0] / L, F[1] / L, F[2] / L];
    const ref: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const u: V3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
    const lu = Math.hypot(...u);
    const n1: V3 = [u[0] / lu, u[1] / lu, u[2] / lu];
    const n2: V3 = [d[1] * n1[2] - d[2] * n1[1], d[2] * n1[0] - d[0] * n1[2], d[0] * n1[1] - d[1] * n1[0]];
    const w = 0.4 * h;
    for (const n of [n1, n2]) for (const s of [1, -1]) linea([P[0] - h * d[0] + s * w * n[0], P[1] - h * d[1] + s * w * n[1], P[2] - h * d[2] + s * w * n[2]], P);
  };
  const desde = (P: V3, o: V3): V3 => [P[0] + o[0], P[1] + o[1], P[2] + o[2]];
  const entre = (a: V3, b: V3, t: number): V3 => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];

  for (const x of geo.cargas) {
    const g = x.carga;
    clase = CLASES_CARGA.indexOf(x.clase);
    obj = objetos.length;
    const rot: { p: V3 | null; largo: number } = { p: null, largo: -1 };
    const anclar = (p: V3, largo: number) => {
      if (largo > rot.largo) Object.assign(rot, { p, largo });
    };
    let peso = 0;

    for (const r of x.regiones) {
      const o: V3 = [-r.q[0] * kS, -r.q[1] * kS, -r.q[2] * kS];
      peso = Math.max(peso, Math.hypot(...r.q));
      // La región en trapecios (x según X, y según Y)
      const trap: { xa: number; xb: number; a0: number; a1: number; b0: number; b1: number }[] = [];
      let area = 0;
      for (const col of descomponer(r.P, r.capas ?? [], [1, 0]))
        for (const fr of col.franjas) {
          if (!fr.enP || (r.capas && !fr.capas.some(Boolean))) continue;
          trap.push({ xa: col.xa, xb: col.xb, ...fr });
          area += ((col.xb - col.xa) * (fr.a1 - fr.a0 + fr.b1 - fr.b0)) / 2;
        }
      if (!(area > 0)) continue;
      const z = r.z;
      pl = plantaEn(z);
      for (const t of trap) {
        cuad(desde([t.xa, t.a0, z], o), desde([t.xb, t.b0, z], o), desde([t.xb, t.b1, z], o), desde([t.xa, t.a1, z], o));
        anclar(desde([(t.xa + t.xb) / 2, (t.a0 + t.a1 + t.b0 + t.b1) / 4, z], o), (t.xb - t.xa) * (t.a1 - t.a0 + t.b1 - t.b0));
      }
      // Las flechas, en una retícula global de paso ≥ 1 m (en cuartos de metro)
      const paso = Math.ceil(Math.max(1, Math.sqrt(area / 100)) * 4) / 4;
      for (const t of trap) {
        for (let i = Math.ceil(t.xa / paso - 0.5); (i + 0.5) * paso < t.xb; i++) {
          const X = (i + 0.5) * paso;
          if (X < t.xa) continue;
          const s = (X - t.xa) / (t.xb - t.xa);
          const [lo, hi] = [t.a0 + s * (t.b0 - t.a0), t.a1 + s * (t.b1 - t.a1)];
          for (let j = Math.ceil(lo / paso - 0.5); (j + 0.5) * paso < hi; j++) {
            const Y = (j + 0.5) * paso;
            if (Y >= lo) flecha([X, Y, z], [-o[0], -o[1], -o[2]]);
          }
        }
      }
    }

    for (const l0 of x.lineas) {
      peso = Math.max(peso, Math.hypot(...l0.qa), Math.hypot(...l0.qb));
      // Una vertical (un pilar), partida por las plantas que cruza
      const [za, zb] = [Math.min(l0.a[2], l0.b[2]), Math.max(l0.a[2], l0.b[2])];
      const trozos = zb - za > 1e-9 ? porPlantas(za, zb).map(([lo, hi]) => [(lo - l0.a[2]) / (l0.b[2] - l0.a[2]), (hi - l0.a[2]) / (l0.b[2] - l0.a[2])].sort((p, q) => p - q) as [number, number]) : [[0, 1] as [number, number]];
      trozos.forEach(([t0, t1], k) => {
        const l = { a: entre(l0.a, l0.b, t0), b: entre(l0.a, l0.b, t1), qa: entre(l0.qa, l0.qb, t0), qb: entre(l0.qa, l0.qb, t1) };
        pl = plantaEn(Math.max(l.a[2], l.b[2]));
        const [oa, ob]: V3[] = [l.qa, l.qb].map((q) => [-q[0] * kL, -q[1] * kL, -q[2] * kL]);
        const [ca, cb] = [desde(l.a, oa!), desde(l.b, ob!)];
        cuad(l.a, l.b, cb, ca);
        linea(ca, cb);
        const largo = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]);
        const n = Math.max(1, Math.ceil(largo / 0.75));
        // La flecha del corte entre dos trozos, una vez
        for (let i = k ? 1 : 0; i <= n; i++) {
          const t = i / n;
          const O = entre(oa!, ob!, t);
          flecha(entre(l.a, l.b, t), [-O[0], -O[1], -O[2]]);
        }
        anclar(entre(ca, cb, 0.5), largo);
      });
    }

    for (const p of x.puntos) {
      pl = plantaEn(p.p[2]);
      const L = Math.hypot(...p.F);
      peso = Math.max(peso, L);
      if (L > 0) {
        const F: V3 = [(p.F[0] / L) * m, (p.F[1] / L) * m, (p.F[2] / L) * m];
        flecha(p.p, F);
        anclar([p.p[0] - F[0], p.p[1] - F[1], p.p[2] - F[2]], 0);
      }
      // El momento: una flecha de doble punta que sale del punto (regla de la mano derecha)
      const LM = Math.hypot(...p.M);
      if (LM > 0) {
        const D: V3 = [(p.M[0] / LM) * 0.6 * m, (p.M[1] / LM) * 0.6 * m, (p.M[2] / LM) * 0.6 * m];
        const Q = desde(p.p, D);
        const h = 0.12 * m;
        linea(p.p, Q);
        punta(Q, D, h);
        punta(desde(Q, [(-D[0] / (0.6 * m)) * h * 0.8, (-D[1] / (0.6 * m)) * h * 0.8, (-D[2] / (0.6 * m)) * h * 0.8]), D, h);
        if (!(L > 0)) anclar(Q, 0);
      }
    }

    for (const pr of x.presiones) {
      peso = Math.max(peso, Math.abs(pr.p0), Math.abs(pr.p1));
      const o = (z: number): V3 => {
        const k = -presionEn(pr, z) * kS;
        return [pr.n[0] * k, pr.n[1] * k, 0];
      };
      const en = (t: number, z: number): V3 => [pr.A[0] + t * (pr.B[0] - pr.A[0]), pr.A[1] + t * (pr.B[1] - pr.A[1]), z];
      const l = Math.hypot(pr.B[0] - pr.A[0], pr.B[1] - pr.A[1]);
      // Por plantas, como los tramos del muro
      porPlantas(pr.zs[0], pr.zs[1]).forEach(([z0, z1], k) => {
        pl = plantaEn(z1);
        const tapa = [desde(en(0, z0), o(z0)), desde(en(1, z0), o(z0)), desde(en(1, z1), o(z1)), desde(en(0, z1), o(z1))] as const;
        cuad(...tapa);
        for (let i = 0; i < 4; i++) linea(tapa[i]!, tapa[(i + 1) % 4]!);
        const [ns, nz] = [Math.max(1, Math.ceil(l / 1)), Math.max(1, Math.ceil((z1 - z0) / 1))];
        for (let i = 0; i <= ns; i++)
          for (let j = k ? 1 : 0; j <= nz; j++) {
            const [s, z] = [(i / ns) * l, z0 + (j / nz) * (z1 - z0)];
            if (pr.huecos.some((h) => s > h.s0 && s < h.s1 && z > h.z0 && z < h.z1)) continue;
            const O = o(z);
            flecha(en(i / ns, z), [-O[0], -O[1], -O[2]]);
          }
        const zm = (z0 + z1) / 2;
        anclar(desde(en(0.5, zm), o(zm)), l * (z1 - z0));
      });
    }

    const [pieza, tipoPieza] = piezaDe(g);
    if (rot.p) objetos.push({ id: g.id, tipo: g.tipo, texto: textoCarga(g), punto: rot.p, peso, plantas: plantasDe(g), pieza, tipoPieza });
  }

  const c = f.casos.find((x) => x.id === caso);
  const usadas = new Set(cs);
  const leyenda: EntradaLeyenda[] = [
    ...(usadas.has(0) ? [{ relleno: COLOR_CARGA.superficie, texto: "Carga de superficie (kN/m²): el bloque sobre su zona" }] : []),
    ...(usadas.has(1) ? [{ relleno: COLOR_CARGA.lineal, texto: "Carga lineal (kN/m) y puntual (kN, de largo fijo; su momento, de doble punta)" }] : usadas.has(2) ? [{ relleno: COLOR_CARGA.puntual, texto: "Carga puntual (kN), de largo fijo; su momento, de doble punta" }] : []),
    ...(usadas.has(3) ? [{ relleno: COLOR_CARGA.pieza, texto: "Carga en una viga o un pilar (kN/m) y empuje de un muro (kN/m²)" }] : []),
  ];
  const notas = [
    ...(maxS > 0 || maxL > 0 ? [`Escalas: ${[maxS > 0 ? `${rotulo(maxS)} kN/m² = ${rotulo(m)} m` : "", maxL > 0 ? `${rotulo(maxL)} kN/m = ${rotulo(m)} m` : ""].filter(Boolean).join("; ")}. Las puntuales, de ${rotulo(m)} m. Cada flecha, con la punta en la pieza y en el sentido de la carga.`] : []),
    "Se rotulan las cargas de la planta resaltada y las elegidas. El momento de una puntual, una flecha de doble punta que sale del punto, por la regla de la mano derecha.",
    "Cada carga, como está en el modelo: el cálculo une a ε_snap sus zonas y polilíneas a lo que tienen cerca (C2-b).",
    ...(!c ? [`El caso «${caso}» no existe.`] : c.pesoPropio ? ["Este caso lleva además el peso propio de la estructura, que calcula el programa y no se dibuja."] : []),
    ...(objetos.length ? [] : ["El caso no tiene cargas."]),
    ...geo.notas,
  ];
  return {
    origen,
    caso,
    segmentos: Float32Array.from(seg),
    claseSegmento: Uint8Array.from(cs),
    objetoSegmento: Uint32Array.from(os),
    plantaSegmento: Uint16Array.from(ps),
    triangulos: Float32Array.from(tri),
    claseTriangulo: Uint8Array.from(ct),
    objetoTriangulo: Uint32Array.from(ot),
    plantaTriangulo: Uint16Array.from(pt),
    plantas: f.plantas.map((x) => x.id),
    objetos,
    escalas: { superficie: { m, valor: maxS }, lineal: { m, valor: maxL }, puntual: m },
    leyenda,
    notas,
  };
}
