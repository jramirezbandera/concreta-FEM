/**
 * Mallador de las losas de una planta (C2, H29): del arreglo plano a cuadriláteros DKMQ.
 *
 * 1. Siembra: cada lado del arreglo se divide en partes iguales de ≤ 2h.
 * 2. Retícula de Steiner por losa: triangular (sin puntos cocirculares, COM-11) de lado 2h,
 *    orientada con el `eje1` de la losa y anclada en su vértice canónico (el menor en la dirección
 *    2 y luego en la 1), así que se traslada y gira con la losa. Sólo los puntos dentro de la losa
 *    y a ≥ 0,45·2h de todo lado.
 * 3. Triangulación de Delaunay restringida (delaunator + constrainautor) de todos los puntos,
 *    ordenados por (x, y), con los lados sembrados como aristas obligatorias. Los empates de
 *    Delaunay (cuatro puntos cocirculares, que la siembra regular produce a menudo) y los casi
 *    empates por redondeo se resuelven con una regla intrínseca (la diagonal más corta; si miden
 *    igual, la más alineada con el eje 1; si no, la de pendiente positiva en sus ejes), no con el
 *    orden de barrido de delaunator: así la malla no cambia al trasladar o girar la planta.
 * 4. Se quedan los triángulos cuyo centroide cae en una losa (fuera de sus huecos): como los
 *    contornos son aristas obligatorias, cada triángulo está entero dentro o fuera.
 * 5. Cada triángulo se divide en 3 cuadriláteros (vértice, puntos medios de sus lados y
 *    centroide), en sentido antihorario: normal hacia +Z.
 * 6. Validador (H23): Σ áreas de cada losa = su área (sin la malla, `poligonos.ts`) a 1e-9; cada
 *    lado del arreglo dentro de una losa o en su borde, cubierto por aristas de la malla; cada punto
 *    del arreglo dentro de una losa, vértice de la malla; jacobiano escalado en los 4 puntos de
 *    Gauss > 0 (aviso si es bajo).
 *
 * Puro y determinista; no lanza: un fallo de la triangulación vuelve como `{ ok: false }`.
 */
import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { incircle } from "robust-predicates";
import type { Arreglo, Trazo } from "./arreglo.ts";
import type { Vec2 } from "./fisico.ts";
import { distanciaASegmento, momentosRegion, puntoEnRegion, type Region } from "./poligonos.ts";

/** Versiones de las bibliotecas del mallador (entran en la huella de compilación, H23). */
export const VERSIONES_MALLADOR = { delaunator: "5.1.0", constrainautor: "4.1.0", "robust-predicates": "3.0.3" } as const;

/** Jacobiano escalado por debajo del cual se avisa de un cuadrilátero de mala calidad. */
export const JACOBIANO_BAJO = 0.2;

/** Pendiente con que crece el paso de la siembra desde un rasgo pequeño (m por m). */
const CRECIMIENTO = 2;

export interface LosaMallar {
  id: string;
  contorno: Trazo;
  huecos: readonly Trazo[];
  /** Dirección del eje 1 (unitaria). */
  eje1: Vec2;
}

export interface NudoMalla {
  x: number;
  y: number;
  /** Punto del arreglo que es, o −1 (siembra, retícula, punto medio o centroide). */
  punto: number;
}

export interface QuadMalla {
  /** Nudos de la malla, antihorario (normal +Z). */
  nudos: [number, number, number, number];
  /** Losa (índice en la lista de `mallarPlanta`). */
  losa: number;
  /** Triángulo del que sale. */
  triangulo: number;
}

export interface ProblemaMalla {
  /** Losa a la que afecta, o −1. */
  losa: number;
  severidad: "error" | "aviso";
  codigo: string;
  mensaje: string;
}

export type ResultadoMalla =
  | {
      ok: true;
      nudos: NudoMalla[];
      quads: QuadMalla[];
      /** Centroide y losa de cada triángulo que se queda. */
      triangulos: { c: Vec2; losa: number }[];
      /** Lados del arreglo (en el orden de `arreglo.lados()`). */
      lados: { a: number; b: number; trazos: number[] }[];
      /** Nudos de la malla a lo largo de cada lado, de a a b; vacío si no toca ninguna losa. */
      nudosLado: number[][];
      /** Región de cada losa con su geometría ya unida (la que se malla). */
      regiones: Region[];
      calidad: { jacobianoMin: number; bajos: number };
      problemas: ProblemaMalla[];
    }
  | { ok: false; mensaje: string };

/** Empate de Delaunay: |incircle| ≤ TOL_EMPATE·L⁴, con L el tamaño de los cuatro puntos. */
const TOL_EMPATE = 1e-10;

const nextEdge = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
const prevEdge = (e: number) => (e % 3 === 0 ? e + 2 : e - 1);

/**
 * Constrainautor con los empates de Delaunay resueltos por una regla intrínseca (cabecera, paso 3).
 * Sustituye `inCircle`, que el autor deja para eso.
 */
class Restringidor extends Constrainautor {
  private e1: Vec2 = [1, 0];

  /** Restringe las aristas y normaliza los empates; devuelve las pasadas de normalización. */
  restringir(aristas: readonly [number, number][], e1: Vec2): number {
    this.e1 = e1;
    this.constrainAll(aristas);
    const del = this.del as unknown as { triangles: Uint32Array; halfedges: Int32Array };
    const giro = this as unknown as { flipDiagonal(e: number): number };
    for (let pasada = 1; pasada <= 50; pasada++) {
      let cambios = 0;
      for (let e = 0; e < del.halfedges.length; e++) {
        const adj = del.halfedges[e]!;
        if (adj < e || this.isConstrained(e)) continue;
        const t = del.triangles;
        if (this.inCircle(t[prevEdge(e)]!, t[e]!, t[nextEdge(e)]!, t[prevEdge(adj)]!)) {
          giro.flipDiagonal(e);
          cambios++;
        }
      }
      if (!cambios) return pasada;
    }
    return -1;
  }

  /** ¿Hay que cambiar la diagonal p2–p3 de los triángulos (p1, p2, p3) y (p3, p2, px) por p1–px? */
  protected override inCircle(p1: number, p2: number, p3: number, px: number): boolean {
    const c = this.del.coords;
    const X = (i: number): Vec2 => [c[2 * i]!, c[2 * i + 1]!];
    const [A, B, C, D] = [X(p1), X(p2), X(p3), X(px)];
    const v = incircle(A[0], A[1], B[0], B[1], C[0], C[1], D[0], D[1]);
    let L = 0;
    for (const P of [B, C, D]) L = Math.max(L, Math.abs(P[0] - A[0]), Math.abs(P[1] - A[1]));
    const tol = TOL_EMPATE * L * L * L * L;
    if (v < -tol) return true;
    if (v > tol) return false;
    return this.prefiere(A, D, B, C);
  }

  /** ¿Es preferible la diagonal PQ a la RS en un empate? */
  private prefiere(P: Vec2, Q: Vec2, R: Vec2, S: Vec2): boolean {
    const d1: Vec2 = [Q[0] - P[0], Q[1] - P[1]];
    const d2: Vec2 = [S[0] - R[0], S[1] - R[1]];
    const L1 = Math.sqrt(d1[0] * d1[0] + d1[1] * d1[1]);
    const L2 = Math.sqrt(d2[0] * d2[0] + d2[1] * d2[1]);
    const tol = 1e-9 * Math.max(L1, L2);
    if (Math.abs(L1 - L2) > tol) return L1 < L2;
    const [ex, ey] = this.e1;
    const u1 = d1[0] * ex + d1[1] * ey;
    const v1 = -d1[0] * ey + d1[1] * ex;
    const u2 = d2[0] * ex + d2[1] * ey;
    const v2 = -d2[0] * ey + d2[1] * ex;
    if (Math.abs(Math.abs(u1) - Math.abs(u2)) > tol) return Math.abs(u1) > Math.abs(u2);
    const s1 = u1 * v1 > 0;
    const s2 = u2 * v2 > 0;
    return s1 && !s2;
  }
}

/** Región de una losa con las coordenadas de sus trazos en el arreglo. */
export function regionDe(arreglo: Arreglo, l: LosaMallar): Region {
  const poli = (t: Trazo): Vec2[] => t.puntos.map((i) => [arreglo.puntos[i]!.x, arreglo.puntos[i]!.y]);
  return { contorno: poli(l.contorno), huecos: l.huecos.map(poli) };
}

const cajaDe = (p: readonly Vec2[]): [number, number, number, number] => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of p) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return [x0, y0, x1, y1];
};

/** Jacobiano escalado mínimo de un cuadrilátero bilineal en sus 4 puntos de Gauss. */
export function jacobianoEscalado(X: readonly Vec2[]): number {
  const g = 1 / Math.sqrt(3);
  const xi = [-1, 1, 1, -1];
  const eta = [-1, -1, 1, 1];
  let min = Infinity;
  for (const [a, b] of [
    [-g, -g],
    [g, -g],
    [g, g],
    [-g, g],
  ] as const) {
    let xx = 0;
    let xy = 0;
    let ex = 0;
    let ey = 0;
    for (let i = 0; i < 4; i++) {
      const dxi = (xi[i]! * (1 + b * eta[i]!)) / 4;
      const deta = (eta[i]! * (1 + a * xi[i]!)) / 4;
      xx += dxi * X[i]![0];
      xy += dxi * X[i]![1];
      ex += deta * X[i]![0];
      ey += deta * X[i]![1];
    }
    const det = xx * ey - ex * xy;
    min = Math.min(min, det / (Math.sqrt(xx * xx + xy * xy) * Math.sqrt(ex * ex + ey * ey)));
  }
  return min;
}

export function mallarPlanta(arreglo: Arreglo, losas: readonly LosaMallar[], h: number): ResultadoMalla {
  const s = 2 * h;
  const lados = arreglo.lados();
  const regiones = losas.map((l) => regionDe(arreglo, l));
  const cajas = regiones.map((r) => cajaDe(r.contorno));
  const P: Vec2[] = arreglo.puntos.map((p) => [p.x, p.y]);
  const origen: number[] = arreglo.puntos.map((_, i) => i);

  // 1. Siembra graduada de los lados: el paso empieza en el tamaño del rasgo más cercano a cada
  // extremo (la distancia a otro punto del arreglo) y crece con pendiente CRECIMIENTO hasta 2h.
  const nPuntos = P.length;
  const celdasP = new Map<string, number[]>();
  const celdaP = (x: number, y: number) => `${Math.floor(x / s)},${Math.floor(y / s)}`;
  for (let i = 0; i < nPuntos; i++) {
    const k = celdaP(P[i]![0], P[i]![1]);
    let v = celdasP.get(k);
    if (!v) celdasP.set(k, (v = []));
    v.push(i);
  }
  const rasgo = (i: number): number => {
    const [x, y] = P[i]!;
    let d = s;
    const cx = Math.floor(x / s);
    const cy = Math.floor(y / s);
    for (let a = cx - 1; a <= cx + 1; a++)
      for (let b = cy - 1; b <= cy + 1; b++)
        for (const j of celdasP.get(`${a},${b}`) ?? []) {
          if (j === i) continue;
          const dx = P[j]![0] - x;
          const dy = P[j]![1] - y;
          d = Math.min(d, Math.sqrt(dx * dx + dy * dy));
        }
    return d;
  };
  const tam = Array.from({ length: nPuntos }, (_, i) => rasgo(i));
  const cadenas: number[][] = lados.map((l) => {
    const [A, B] = [P[l.a]!, P[l.b]!];
    const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
    // Tamaño a lo largo del lado, g(x) = min(2h, sa + λx, sb + λ(L − x)); se reparten los puntos
    // donde ∫dx/g es múltiplo de su total / n
    const [sa, sb] = [tam[l.a]!, tam[l.b]!];
    const g = (x: number) => Math.min(s, sa + CRECIMIENTO * x, sb + CRECIMIENTO * (L - x));
    const m = 64;
    const acum = [0];
    for (let i = 1; i <= m; i++) acum.push(acum[i - 1]! + ((L / m) * (1 / g(((i - 1) * L) / m) + 1 / g((i * L) / m))) / 2);
    const total = acum[m]!;
    const n = Math.max(1, Math.ceil(total - 1e-9));
    const c = [l.a];
    let j = 0;
    for (let i = 1; i < n; i++) {
      const objetivo = (total * i) / n;
      while (acum[j + 1]! < objetivo) j++;
      const t = (j + (objetivo - acum[j]!) / (acum[j + 1]! - acum[j]!)) / m;
      P.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
      origen.push(-1);
      c.push(P.length - 1);
    }
    c.push(l.b);
    return c;
  });

  // 2. Retícula de Steiner, lejos de los lados (índice de los lados por celdas de 2h)
  const celdas = new Map<string, number[]>();
  const celda = (x: number, y: number) => `${Math.floor(x / s)},${Math.floor(y / s)}`;
  lados.forEach((l, i) => {
    const [A, B] = [P[l.a]!, P[l.b]!];
    for (let cx = Math.floor((Math.min(A[0], B[0]) - s) / s); cx <= Math.floor((Math.max(A[0], B[0]) + s) / s); cx++)
      for (let cy = Math.floor((Math.min(A[1], B[1]) - s) / s); cy <= Math.floor((Math.max(A[1], B[1]) + s) / s); cy++) {
        const k = `${cx},${cy}`;
        let v = celdas.get(k);
        if (!v) celdas.set(k, (v = []));
        v.push(i);
      }
  });
  const holgura = 0.45 * s;
  const lejos = (q: Vec2) => {
    for (const i of celdas.get(celda(q[0], q[1])) ?? []) if (distanciaASegmento(q, P[lados[i]!.a]!, P[lados[i]!.b]!) < holgura) return false;
    return true;
  };
  const fila = (s * Math.sqrt(3)) / 2;
  losas.forEach((l, k) => {
    const r = regiones[k]!;
    const [e1x, e1y] = l.eje1;
    const u = (q: Vec2) => q[0] * e1x + q[1] * e1y;
    const v = (q: Vec2) => -q[0] * e1y + q[1] * e1x;
    // Vértice canónico: el menor en v y luego en u
    let O = r.contorno[0]!;
    for (const q of r.contorno) if (v(q) < v(O) || (v(q) === v(O) && u(q) < u(O))) O = q;
    let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const q of r.contorno) {
      const du = u(q) - u(O);
      const dv = v(q) - v(O);
      [u0, v0, u1, v1] = [Math.min(u0, du), Math.min(v0, dv), Math.max(u1, du), Math.max(v1, dv)];
    }
    for (let j = Math.floor(v0 / fila); j <= Math.ceil(v1 / fila); j++) {
      const desp = j % 2 === 0 ? 0 : s / 2;
      for (let i = Math.floor((u0 - desp) / s); i <= Math.ceil((u1 - desp) / s); i++) {
        const a = i * s + desp;
        const b = j * fila;
        const q: Vec2 = [O[0] + a * e1x - b * e1y, O[1] + a * e1y + b * e1x];
        if (puntoEnRegion(q, r) && lejos(q)) {
          P.push(q);
          origen.push(-1);
        }
      }
    }
  });

  // 3. Triangulación restringida de los puntos ordenados por (x, y)
  const orden = P.map((_, i) => i).sort((a, b) => P[a]![0] - P[b]![0] || P[a]![1] - P[b]![1]);
  const pos = new Int32Array(P.length);
  orden.forEach((p, i) => (pos[p] = i));
  const coords = new Float64Array(2 * P.length);
  orden.forEach((p, i) => {
    coords[2 * i] = P[p]![0];
    coords[2 * i + 1] = P[p]![1];
  });
  const aristas: [number, number][] = [];
  for (const c of cadenas) for (let i = 0; i + 1 < c.length; i++) aristas.push([pos[c[i]!]!, pos[c[i + 1]!]!]);
  aristas.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let tri: Uint32Array;
  let pasadas: number;
  try {
    const d = new Delaunator(coords);
    // Dirección de referencia de los empates: el eje 1 de la primera losa
    pasadas = new Restringidor(d).restringir(aristas, losas[0]?.eje1 ?? [1, 0]);
    tri = d.triangles;
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
  }

  // 4. Triángulos dentro de las losas
  const Q = (i: number) => P[orden[i]!]!;
  const triangulos: { v: [number, number, number]; c: Vec2; losa: number }[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    let [a, b, c] = [tri[t]!, tri[t + 1]!, tri[t + 2]!];
    const [A, B, C] = [Q(a), Q(b), Q(c)];
    const area2 = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (area2 === 0) continue;
    if (area2 < 0) [b, c] = [c, b];
    const g: Vec2 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
    let losa = -1;
    for (let k = 0; k < losas.length && losa < 0; k++) {
      const cj = cajas[k]!;
      if (g[0] < cj[0] || g[0] > cj[2] || g[1] < cj[1] || g[1] > cj[3]) continue;
      if (puntoEnRegion(g, regiones[k]!)) losa = k;
    }
    if (losa >= 0) triangulos.push({ v: [a, b, c], c: g, losa });
  }

  // 5. Cuadriláteros
  const nudos: NudoMalla[] = [];
  const nudoDe = new Map<string, number>();
  const nudo = (k: string, q: Vec2, punto: number) => {
    let n = nudoDe.get(k);
    if (n === undefined) {
      nudos.push({ x: q[0], y: q[1], punto });
      nudoDe.set(k, (n = nudos.length - 1));
    }
    return n;
  };
  const vertice = (i: number) => nudo(`v${i}`, Q(i), origen[orden[i]!]!);
  const medio = (i: number, j: number) => {
    const [A, B] = [Q(i), Q(j)];
    return nudo(i < j ? `m${i},${j}` : `m${j},${i}`, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], -1);
  };
  const quads: QuadMalla[] = [];
  triangulos.forEach((t, ti) => {
    const [a, b, c] = t.v;
    const [na, nb, nc] = [vertice(a), vertice(b), vertice(c)];
    const [mab, mbc, mca] = [medio(a, b), medio(b, c), medio(c, a)];
    const g = nudo(`c${ti}`, t.c, -1);
    quads.push({ nudos: [na, mab, g, mca], losa: t.losa, triangulo: ti });
    quads.push({ nudos: [nb, mbc, g, mab], losa: t.losa, triangulo: ti });
    quads.push({ nudos: [nc, mca, g, mbc], losa: t.losa, triangulo: ti });
  });

  // Nudos a lo largo de cada lado (sólo los tramos que son arista de un triángulo que se queda)
  const aristasMalla = new Set<string>();
  for (const t of triangulos) {
    const [a, b, c] = t.v;
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const)
      aristasMalla.add(i < j ? `${i},${j}` : `${j},${i}`);
  }
  const nudosLado = cadenas.map((c) => {
    const r: number[] = [];
    for (let i = 0; i + 1 < c.length; i++) {
      const [p, q] = [pos[c[i]!]!, pos[c[i + 1]!]!];
      if (!aristasMalla.has(p < q ? `${p},${q}` : `${q},${p}`)) continue;
      const np = nudoDe.get(`v${p}`)!;
      if (r[r.length - 1] !== np) r.push(np);
      r.push(nudoDe.get(p < q ? `m${p},${q}` : `m${q},${p}`)!, nudoDe.get(`v${q}`)!);
    }
    return r;
  });

  // 6. Validador
  const problemas: ProblemaMalla[] = [];
  const areas = losas.map(() => 0);
  let jacobianoMin = Infinity;
  let peor: Vec2 = [0, 0];
  let bajos = 0;
  const malos = losas.map(() => 0);
  for (const q of quads) {
    const X = q.nudos.map((n) => [nudos[n]!.x, nudos[n]!.y] as Vec2);
    let a = 0;
    for (let i = 0; i < 4; i++) a += X[i]![0] * X[(i + 1) % 4]![1] - X[(i + 1) % 4]![0] * X[i]![1];
    areas[q.losa]! += a / 2;
    const j = jacobianoEscalado(X);
    if (j < jacobianoMin) [jacobianoMin, peor] = [j, [(X[0]![0] + X[1]![0] + X[2]![0] + X[3]![0]) / 4, (X[0]![1] + X[1]![1] + X[2]![1] + X[3]![1]) / 4]];
    if (j <= 0) malos[q.losa]!++;
    else if (j < JACOBIANO_BAJO) bajos++;
  }
  losas.forEach((l, k) => {
    const A = momentosRegion(regiones[k]!).A;
    const e = Math.abs(areas[k]! - A) / A;
    if (!(e <= 1e-9))
      problemas.push({ losa: k, severidad: "error", codigo: "malla/area", mensaje: `La malla de la losa ${l.id} no cubre su área: ${areas[k]!.toPrecision(10)} m² frente a ${A.toPrecision(10)} m² (error ${e.toExponential(2)}).` });
    if (malos[k]! > 0)
      problemas.push({ losa: k, severidad: "error", codigo: "malla/jacobiano", mensaje: `La malla de la losa ${l.id} tiene ${malos[k]} cuadriláteros con el jacobiano ≤ 0 (invertidos o degenerados).` });
  });
  // Lados y puntos que tienen que estar en la malla
  const enLosa = (q: Vec2) => regiones.findIndex((r, k) => {
    const cj = cajas[k]!;
    return !(q[0] < cj[0] || q[0] > cj[2] || q[1] < cj[1] || q[1] > cj[3]) && puntoEnRegion(q, r);
  });
  const trazoLosa = new Set<Trazo>(losas.flatMap((l) => [l.contorno, ...l.huecos]));
  lados.forEach((l, i) => {
    if (nudosLado[i]!.length) return;
    const [A, B] = [P[l.a]!, P[l.b]!];
    const borde = l.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!));
    const k = enLosa([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]);
    if (borde || k >= 0)
      problemas.push({ losa: k, severidad: "error", codigo: "malla/lado-perdido", mensaje: `Un lado de ${l.trazos.map((t) => arreglo.trazos[t]!.id).join(", ")} entre (${A[0].toFixed(3)}, ${A[1].toFixed(3)}) y (${B[0].toFixed(3)}, ${B[1].toFixed(3)}) no es arista de la malla.` });
  });
  const usados = new Set(nudos.filter((n) => n.punto >= 0).map((n) => n.punto));
  arreglo.puntos.forEach((p, i) => {
    if (usados.has(i)) return;
    const k = enLosa([p.x, p.y]);
    if (k >= 0) problemas.push({ losa: k, severidad: "error", codigo: "malla/punto-perdido", mensaje: `El punto (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) de la losa ${losas[k]!.id} no es vértice de la malla.` });
  });
  if (pasadas < 0) problemas.push({ losa: -1, severidad: "aviso", codigo: "malla/empates", mensaje: "Los empates de la triangulación no se han resuelto en 50 pasadas: la malla puede depender de la posición de la planta." });
  if (bajos > 0) {
    // Lo que pasa junto al peor: los trazos con algún lado a menos de 2h de él
    const cerca = [...new Set(lados.filter((l) => distanciaASegmento(peor, P[l.a]!, P[l.b]!) < s).flatMap((l) => l.trazos.map((t) => arreglo.trazos[t]!.id)))].sort();
    problemas.push({
      losa: -1,
      severidad: "aviso",
      codigo: "malla/calidad",
      mensaje: `${bajos} cuadriláteros tienen el jacobiano escalado por debajo de ${JACOBIANO_BAJO} (mínimo ${jacobianoMin.toFixed(3)}, en (${peor[0].toFixed(2)}, ${peor[1].toFixed(2)}), junto a ${cerca.join(", ") || "nada"}): hay rasgos de la planta a menos de un elemento entre sí, como dos líneas casi paralelas a poco más de ε_snap.`,
    });
  }

  return {
    ok: true,
    nudos,
    quads,
    triangulos: triangulos.map((t) => ({ c: t.c, losa: t.losa })),
    lados,
    nudosLado,
    regiones,
    calidad: { jacobianoMin: quads.length ? jacobianoMin : 1, bajos },
    problemas,
  };
}
