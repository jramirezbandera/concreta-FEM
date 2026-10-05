/**
 * Mallador de las losas de una planta (C2, H29, H52): del arreglo plano a cuadriláteros DKMQ.
 *
 * 0. Rejilla alineada (`rejilla.ts`, C2-a): las celdas regulares de una rejilla en los ejes de la
 *    primera losa se parten en cuadriláteros por los puntos medios de sus lados. Lo demás (alrededor
 *    de los rasgos que no caen en la rejilla) va por los pasos 1 a 5, con las aristas de la interfaz
 *    como obligatorias; la CDT las parte por su punto medio, igual que la rejilla, y la malla es
 *    conforme. Los lados que van por una línea se cortan en los nudos de la rejilla y sólo se
 *    siembran sus tramos fuera de ella. Sin rejilla (o si no hay ninguna celda regular), todo es CDT.
 * 1. Siembra: cada lado del arreglo se divide en partes iguales de ≤ 2h.
 * 2. Retícula de Steiner por losa: triangular (sin puntos cocirculares, COM-11) de lado 2h,
 *    orientada con el `eje1` de la losa y anclada en su vértice canónico (el menor en la dirección
 *    2 y luego en la 1), así que se traslada y gira con la losa. Sólo los puntos dentro de la losa
 *    y a ≥ 0,45·2h de todo lado.
 * 3. Triangulación de Delaunay restringida (delaunator + constrainautor) de todos los puntos,
 *    ordenados por (x, y), con los lados sembrados como aristas obligatorias. Los empates de
 *    Delaunay (cuatro o más puntos cocirculares, que la siembra regular y las huellas producen a
 *    menudo) y los casi empates por redondeo o por un ruido de ε_geom se deshacen con una
 *    perturbación simbólica ligada a los ejes de la losa (`Restringidor`), no con el orden de
 *    barrido de delaunator: así la malla no cambia al trasladar o girar la planta.
 * 4. Se quedan los triángulos cuyo centroide cae en una losa (fuera de sus huecos) y no en una celda
 *    regular: como los contornos y la interfaz son aristas obligatorias, cada triángulo está entero
 *    dentro o fuera. Los de área de redondeo (entre un borde sembrado y la envolvente convexa) se
 *    descartan antes.
 * 5. Cada triángulo se divide en 3 cuadriláteros (vértice, puntos medios de sus lados y
 *    centroide), en sentido antihorario: normal hacia +Z.
 * 6. Validador (H23): Σ áreas de cada losa = su área (sin la malla, `poligonos.ts`) a 1e-9; cada
 *    lado del arreglo dentro de una losa o en su borde, cubierto por aristas de la malla; cada punto
 *    del arreglo dentro de una losa, vértice de la malla; jacobiano escalado en los 4 puntos de
 *    Gauss > 0 (aviso si es bajo); y la rejilla y la CDT parten igual cada arista de la interfaz.
 *
 * Puro y determinista; no lanza: un fallo de la triangulación vuelve como `{ ok: false }`.
 */
import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { incircle } from "robust-predicates";
import type { Arreglo, Trazo } from "./arreglo.ts";
import type { Vec2 } from "./fisico.ts";
import { distanciaASegmento, momentosRegion, puntoEnRegion, type Region } from "./poligonos.ts";
import { cubierta, IRREGULAR, REGULAR, rejillaPlanta, type Rejilla } from "./rejilla.ts";

/** Versiones de las bibliotecas del mallador (entran en la huella de compilación, H23). */
export const VERSIONES_MALLADOR = { delaunator: "5.1.0", constrainautor: "4.1.0", "robust-predicates": "3.0.3" } as const;

/** Distancia mínima del centro de una celda irregular a los segmentos y a la retícula, en fracciones de 2h. */
export const HOLGURA_CENTRO = 0.3;

/** Fracción del área de las losas que tiene que cubrir la rejilla para no comparar con la CDT sola. */
export const COBERTURA_MINIMA = 0.75;

/** Jacobiano escalado por debajo del cual se avisa de un cuadrilátero de mala calidad. */
export const JACOBIANO_BAJO = 0.2;

/** Pendiente con que crece el paso de la siembra desde un rasgo pequeño (m por m). */
const CRECIMIENTO = 2;

/** Fracción de paso que se tolera antes de añadir un tramo más a la siembra de un lado. */
const HOLGURA_SIEMBRA = 1e-4;

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
  /** Pieza de la que sale (triángulo de la CDT o celda de la rejilla). */
  pieza: number;
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
      /**
       * Centroide y losa de cada pieza: los triángulos de la CDT que se quedan y luego las celdas
       * regulares de la rejilla. Cada una está entera dentro o fuera de cada zona del arreglo.
       */
      piezas: { c: Vec2; losa: number }[];
      /** Lados del arreglo (en el orden de `arreglo.lados()`). */
      lados: { a: number; b: number; trazos: number[] }[];
      /** Nudos de la malla a lo largo de cada lado, de a a b; vacío si no toca ninguna losa. */
      nudosLado: number[][];
      /** Región de cada losa con su geometría ya unida (la que se malla). */
      regiones: Region[];
      calidad: { jacobianoMin: number; bajos: number };
      /**
       * Celdas regulares de la rejilla, plantillas de pilar, cuadriláteros que salen de ellas y
       * fracción del área de las losas que cubren.
       */
      rejilla: { celdas: number; plantillas: number; quads: number; cobertura: number };
      problemas: ProblemaMalla[];
    }
  | { ok: false; mensaje: string };

/**
 * Empate de Delaunay: |incircle| ≤ máx(TOL_EMPATE·L⁴, 10·ε_geom·L³), con L el tamaño de los cuatro
 * puntos. El segundo término es lo que mueve el incircle un ruido de ε_geom en un punto: un empate
 * exacto (cuatro puntos cocirculares, como las esquinas de una huella dentro de la losa) sigue
 * siéndolo con ese ruido, o con el redondeo de una traslación o un giro.
 */
const TOL_EMPATE = 1e-10;

const nextEdge = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
const prevEdge = (e: number) => (e % 3 === 0 ? e + 2 : e - 1);

/**
 * Constrainautor con los empates de Delaunay resueltos por una regla intrínseca (cabecera, paso 3).
 * Sustituye `inCircle`, que el autor deja para eso.
 */
class Restringidor extends Constrainautor {
  private e1: Vec2 = [1, 0];
  private O: Vec2 = [0, 0];
  private epsGeom = 0;

  /**
   * Restringe las aristas y normaliza los empates; devuelve las pasadas de normalización. Los
   * empates se deshacen con una perturbación simbólica (Edelsbrunner–Mücke): cada punto se levanta
   * en el paraboloide con un peso infinitesimal w = U² + (√2 − 1)·U·V, con (U, V) sus coordenadas en
   * los ejes 1-2 de la primera losa respecto a `O`. Con ella la triangulación es la regular de esos
   * pesos, única aunque haya 5 o más puntos cocirculares (el octógono de la huella de un pilar
   * circular), las vueltas de Lawson llegan a ella sin ciclos y no depende de la posición de la
   * planta. Un peso no afín y con un término cruzado irracional rompe también las simetrías de los
   * rectángulos y trapecios alineados con el eje 1.
   */
  restringir(aristas: readonly [number, number][], e1: Vec2, O: Vec2, epsGeom: number): number {
    this.e1 = e1;
    this.O = O;
    this.epsGeom = epsGeom;
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
    const tol = Math.max(TOL_EMPATE * L * L * L * L, 10 * this.epsGeom * L * L * L);
    if (v < -tol) return true;
    if (v > tol) return false;
    // Empate: el término de primer orden de la perturbación (el incircle con los pesos en la
    // columna levantada, con el mismo convenio de signo que el de robust-predicates)
    const w = (P: Vec2) => {
      const dx = P[0] - this.O[0];
      const dy = P[1] - this.O[1];
      const U = dx * this.e1[0] + dy * this.e1[1];
      const V = -dx * this.e1[1] + dy * this.e1[0];
      return U * U + (Math.SQRT2 - 1) * U * V;
    };
    const wd = w(D);
    const f = [A, B, C].map((P) => [P[0] - D[0], P[1] - D[1], w(P) - wd] as const);
    const [a, b, cc] = f as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
    const delta = a[0] * (b[1] * cc[2] - b[2] * cc[1]) - a[1] * (b[0] * cc[2] - b[2] * cc[0]) + a[2] * (b[0] * cc[1] - b[1] * cc[0]);
    let escala = 0;
    for (const r of f) escala = Math.max(escala, Math.abs(r[2]));
    if (Math.abs(delta) > 1e-12 * escala * L * L) return delta < 0;
    return this.prefiere(A, D, B, C);
  }

  /** ¿Es preferible la diagonal PQ a la RS en un empate? */
  private prefiere(P: Vec2, Q: Vec2, R: Vec2, S: Vec2): boolean {
    const d1: Vec2 = [Q[0] - P[0], Q[1] - P[1]];
    const d2: Vec2 = [S[0] - R[0], S[1] - R[1]];
    const L1 = Math.sqrt(d1[0] * d1[0] + d1[1] * d1[1]);
    const L2 = Math.sqrt(d2[0] * d2[0] + d2[1] * d2[1]);
    // Con la misma holgura que el empate: lo que mueve un ruido de ε_geom no decide
    const tol = Math.max(1e-9 * Math.max(L1, L2), 10 * this.epsGeom);
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

/**
 * Siembra graduada de un lado de longitud L (paso 1): el tamaño a lo largo del lado es g(x) =
 * min(s, sa + λx, sb + λ(L − x)), con sa y sb el de los rasgos de sus extremos, y los puntos van
 * donde ∫dx/g es múltiplo de su total / n. Devuelve n y los parámetros t ∈ (0, 1) de los n − 1
 * puntos interiores. Con `nFijo`, reparte ese número de tramos (los muros de C3 lo unifican entre
 * plantas).
 */
export function siembraGraduada(L: number, sa: number, sb: number, s: number, nFijo?: number): { n: number; t: number[] } {
  const g = (x: number) => Math.min(s, sa + CRECIMIENTO * x, sb + CRECIMIENTO * (L - x));
  const m = 64;
  const acum = [0];
  for (let i = 1; i <= m; i++) acum.push(acum[i - 1]! + ((L / m) * (1 / g(((i - 1) * L) / m) + 1 / g((i * L) / m))) / 2);
  const total = acum[m]!;
  // Con holgura: un lado de justo k pasos no puede pasar a k + 1 por un redondeo o un ruido
  const n = nFijo ?? Math.max(1, Math.ceil(total - HOLGURA_SIEMBRA));
  const t: number[] = [];
  let j = 0;
  for (let i = 1; i < n; i++) {
    const objetivo = (total * i) / n;
    while (acum[j + 1]! < objetivo) j++;
    t.push((j + (objetivo - acum[j]!) / (acum[j + 1]! - acum[j]!)) / m);
  }
  return { n, t };
}

/**
 * Malla las losas de una planta. `presembrados`: claves «a,b» (a < b) de los lados que no se
 * siembran, los de los ejes de los muros (C3), cuyos puntos ya son sus estaciones. Con `rejilla`
 * (por defecto), las zonas regulares van en la rejilla alineada de `rejilla.ts` y sólo el resto en
 * la CDT; sin ella, todo en la CDT. Si la rejilla cubre menos de COBERTURA_MINIMA del área de las
 * losas (una planta pequeña y llena de rasgos), se malla también sin ella y se queda la malla con
 * menos nudos (a igualdad, la de la rejilla).
 */
export function mallarPlanta(arreglo: Arreglo, losas: readonly LosaMallar[], h: number, epsGeom = 1e-6, presembrados?: ReadonlySet<string>, rejilla = true): ResultadoMalla {
  const r = mallarPlantaCon(arreglo, losas, h, epsGeom, presembrados, rejilla);
  if (!rejilla || !r.ok || r.rejilla.cobertura >= COBERTURA_MINIMA) return r;
  const sin = mallarPlantaCon(arreglo, losas, h, epsGeom, presembrados, false);
  return sin.ok && sin.nudos.length < r.nudos.length ? sin : r;
}

/** `mallarPlanta` sin comparar con la CDT sola cuando la rejilla cubre poco (para las pruebas). */
export function mallarPlantaCon(arreglo: Arreglo, losas: readonly LosaMallar[], h: number, epsGeom: number, presembrados: ReadonlySet<string> | undefined, rejilla: boolean): ResultadoMalla {
  const s = 2 * h;
  const lados = arreglo.lados();
  const regiones = losas.map((l) => regionDe(arreglo, l));
  const cajas = regiones.map((r) => cajaDe(r.contorno));
  const P: Vec2[] = arreglo.puntos.map((p) => [p.x, p.y]);
  const origen: number[] = arreglo.puntos.map((_, i) => i);
  const enLosa = (q: Vec2) =>
    regiones.findIndex((r, k) => {
      const cj = cajas[k]!;
      return !(q[0] < cj[0] || q[0] > cj[2] || q[1] < cj[1] || q[1] > cj[3]) && puntoEnRegion(q, r);
    });
  const trazoLosa = new Set<Trazo>(losas.flatMap((l) => [l.contorno, ...l.huecos]));
  const fijos = lados.map((l) => presembrados?.has(`${l.a},${l.b}`) ?? false);

  // Vértice canónico de cada losa: el menor en v y luego en u, comparando a ε_geom (dos vértices de
  // un lado paralelo al eje 1 empatan en v, y el redondeo de un giro o un ruido no puede decidir
  // cuál). Ancla su retícula; el de la primera ancla también la rejilla y los empates de la CDT.
  const origenes: Vec2[] = losas.map((l, k) => {
    const r = regiones[k]!;
    const [e1x, e1y] = l.eje1;
    const u = (q: Vec2) => q[0] * e1x + q[1] * e1y;
    const v = (q: Vec2) => -q[0] * e1y + q[1] * e1x;
    let O = r.contorno[0]!;
    for (const q of r.contorno) {
      const dv = v(q) - v(O);
      if (dv < -epsGeom || (Math.abs(dv) <= epsGeom && u(q) < u(O) - epsGeom)) O = q;
    }
    return O;
  });

  // Rejilla alineada de las zonas regulares
  const nPuntos = P.length;
  let rj: Rejilla | null = null;
  if (rejilla && losas.length) {
    const ladoEnLosa = lados.map((l) => {
      const [A, B] = [P[l.a]!, P[l.b]!];
      return l.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!)) || enLosa([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]) >= 0;
    });
    const puntoEnLosa = P.map((q) => enLosa(q) >= 0);
    lados.forEach((l, k) => {
      if (ladoEnLosa[k]) puntoEnLosa[l.a] = puntoEnLosa[l.b] = true;
    });
    // Huellas de los pilares: sus puntos y sus lados
    const huellas = arreglo.trazos.flatMap((t, ti) => (t.tipo === "huella" ? [{ puntos: t.puntos, lados: lados.flatMap((l, k) => (l.trazos.includes(ti) ? [k] : [])) }] : []));
    rj = rejillaPlanta({ P, lados, ladoEnLosa, puntoEnLosa, fijos, huellas, regiones, enLosa, O: origenes[0]!, e: losas[0]!.eje1, h, epsGeom });
  }
  // Punto (índice en P) de cada nudo de la rejilla que se usa
  const pNudo = new Map<number, number>();
  const pDe = (n: number): number => {
    const p = rj!.puntoNudo[n]!;
    if (p >= 0) return p;
    let q = pNudo.get(n);
    if (q === undefined) {
      P.push(rj!.posicion(n));
      origen.push(-1);
      pNudo.set(n, (q = P.length - 1));
    }
    return q;
  };
  // Redes de las plantillas de pilar en índices de P (un punto medio, como el par de sus extremos),
  // sus aristas interiores y las cadenas de los lados de sus huellas (por el anillo de la red)
  const redes = (rj?.plantillas ?? []).map((pl) =>
    pl.red.map((x): number | [number, number] => {
      if (x.tipo === "nudo") return pDe(x.n);
      if (x.tipo === "medio") return [pDe(x.n1), pDe(x.n2)];
      if (x.tipo === "punto") return x.p;
      P.push(x.q);
      origen.push(-1);
      return P.length - 1;
    }),
  );
  const aristasPlantilla = new Set<string>();
  const cadenaHuella = new Map<number, number[]>();
  redes.forEach((red, t) => {
    const { A, B } = rj!.plantillas[t]!;
    for (let b = 0; b < B; b++)
      for (let a = 0; a < A; a++) {
        const x = red[a + A * b]!;
        for (const y of [a < A - 1 ? red[a + 1 + A * b]! : null, b < B - 1 ? red[a + A * (b + 1)]! : null]) {
          if (y === null || typeof x !== "number" || typeof y !== "number") continue;
          aristasPlantilla.add(x < y ? `${x},${y}` : `${y},${x}`);
        }
      }
    const anillo = rj!.plantillas[t]!.anillo.map((i) => red[i] as number);
    const n = anillo.length;
    const dePunto = new Set(anillo.filter((p) => p < nPuntos));
    for (const k of rj!.plantillas[t]!.huellaLados) {
      const l = lados[k]!;
      // Del extremo a, por el anillo, hasta el siguiente punto del arreglo en un sentido u otro
      const ia = anillo.indexOf(l.a);
      for (const paso of [1, n - 1]) {
        const c = [l.a];
        let m = (ia + paso) % n;
        while (!dePunto.has(anillo[m]!)) {
          c.push(anillo[m]!);
          m = (m + paso) % n;
        }
        if (anillo[m] === l.b) {
          cadenaHuella.set(k, [...c, l.b]);
          break;
        }
      }
    }
  });

  // 1. Siembra graduada de los lados: el paso empieza en el tamaño del rasgo más cercano a cada
  // extremo (la distancia a otro punto del arreglo) y crece con pendiente CRECIMIENTO hasta 2h.
  const celdasP = new Map<string, number[]>();
  const celdaP = (x: number, y: number) => `${Math.floor(x / s)},${Math.floor(y / s)}`;
  for (let i = 0; i < nPuntos; i++) {
    const k = celdaP(P[i]![0], P[i]![1]);
    let v = celdasP.get(k);
    if (!v) celdasP.set(k, (v = []));
    v.push(i);
  }
  const rasgo = (q: Vec2, yo: number): number => {
    const [x, y] = q;
    let d = s;
    const cx = Math.floor(x / s);
    const cy = Math.floor(y / s);
    for (let a = cx - 1; a <= cx + 1; a++)
      for (let b = cy - 1; b <= cy + 1; b++)
        for (const j of celdasP.get(`${a},${b}`) ?? []) {
          if (j === yo) continue;
          const dx = P[j]![0] - x;
          const dy = P[j]![1] - y;
          d = Math.min(d, Math.sqrt(dx * dx + dy * dy));
        }
    return d;
  };
  const tam = Array.from({ length: nPuntos }, (_, i) => rasgo(P[i]!, i));
  const tamDe = (p: number) => (p < nPuntos ? tam[p]! : rasgo(P[p]!, -1));
  const sembrar = (p: number, q: number): number[] => {
    const [A, B] = [P[p]!, P[q]!];
    const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
    return siembraGraduada(L, tamDe(p), tamDe(q), s).t.map((t) => {
      P.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
      origen.push(-1);
      return P.length - 1;
    });
  };
  // Aristas obligatorias de la CDT (índices en P), sin repetir
  const restricciones: [number, number][] = [];
  const restringidas = new Set<string>();
  const restringir = (p: number, q: number) => {
    const k = p < q ? `${p},${q}` : `${q},${p}`;
    if (restringidas.has(k)) return;
    restringidas.add(k);
    restricciones.push([p, q]);
  };
  // Cadena de cada lado: sus extremos, los nudos de la rejilla que son esquina de una celda regular
  // y la siembra de los tramos que van por la CDT
  const cadenas: number[][] = lados.map((l, k) => {
    // Los lados de los ejes de los muros ya vienen sembrados (C3): sus puntos son las estaciones
    if (fijos[k]) {
      restringir(l.a, l.b);
      return [l.a, l.b];
    }
    const ch = cadenaHuella.get(k);
    if (ch) return ch;
    const el = rj?.enLinea[k];
    const cortes: { p: number; n: number }[] = [];
    if (!el) cortes.push({ p: l.a, n: -1 }, { p: l.b, n: -1 });
    else
      el.nudos.forEach((n, m) => {
        const p = rj!.puntoNudo[n]!;
        if (p === l.a || p === l.b) cortes.push({ p, n });
        else if (rj!.cubre(n)) cortes.push({ p: pDe(n), n });
        if (m === 0 && p !== l.a) cortes.unshift({ p: l.a, n: -1 });
        if (m === el.nudos.length - 1 && p !== l.b) cortes.push({ p: l.b, n: -1 });
      });
    const c = [l.a];
    for (let m = 0; m + 1 < cortes.length; m++) {
      const [x, y] = [cortes[m]!, cortes[m + 1]!];
      if (aristasPlantilla.has(x.p < y.p ? `${x.p},${y.p}` : `${y.p},${x.p}`)) {
        // Arista dentro de una plantilla (el tramo de viga entre la cara del pilar y el borde)
        c.push(y.p);
        continue;
      }
      const ea = x.n >= 0 && y.n >= 0 ? rj!.estadosArista(x.n, y.n) : null;
      if (ea && (cubierta(ea[0]) || cubierta(ea[1]))) {
        // Arista de la rejilla: obligatoria en la CDT si está en la interfaz o en el borde de la
        // rejilla (un borde de losa), para que ningún triángulo de fuera entre en una celda cubierta
        if (!cubierta(ea[0]) || !cubierta(ea[1])) restringir(x.p, y.p);
        c.push(y.p);
        continue;
      }
      let ant = x.p;
      for (const q of [...sembrar(x.p, y.p), y.p]) {
        restringir(ant, q);
        c.push(q);
        ant = q;
      }
    }
    return c;
  });
  // La interfaz entre la rejilla y la CDT
  for (const [n1, n2] of rj?.interfaz ?? []) restringir(pDe(n1), pDe(n2));

  // 2. Retícula de Steiner, lejos de los lados y de la interfaz (índice de segmentos por celdas de
  // 2h) y fuera de las celdas regulares
  const segs: [Vec2, Vec2][] = [...lados.map((l) => [P[l.a]!, P[l.b]!] as [Vec2, Vec2]), ...(rj?.interfaz ?? []).map(([n1, n2]) => [P[pDe(n1)]!, P[pDe(n2)]!] as [Vec2, Vec2])];
  const celdas = new Map<string, number[]>();
  const celda = (x: number, y: number) => `${Math.floor(x / s)},${Math.floor(y / s)}`;
  segs.forEach(([A, B], i) => {
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
    for (const i of celdas.get(celda(q[0], q[1])) ?? []) if (distanciaASegmento(q, segs[i]![0], segs[i]![1]) < holgura) return false;
    return true;
  };
  const enRejilla = (q: Vec2) => {
    const c = rj ? rj.celdaDe(q) : -1;
    return c >= 0 && cubierta(rj!.estado[c]!);
  };
  const fila = (s * Math.sqrt(3)) / 2;
  const reticula: number[] = [];
  losas.forEach((l, k) => {
    const r = regiones[k]!;
    const [e1x, e1y] = l.eje1;
    const u = (q: Vec2) => q[0] * e1x + q[1] * e1y;
    const v = (q: Vec2) => -q[0] * e1y + q[1] * e1x;
    const O = origenes[k]!;
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
        if (puntoEnRegion(q, r) && lejos(q) && !enRejilla(q)) {
          P.push(q);
          origen.push(-1);
          reticula.push(P.length - 1);
        }
      }
    }
  });
  // Con rejilla, el centro de cada celda irregular a ≥ HOLGURA_CENTRO·2h de los segmentos y de la
  // retícula: en un parche pequeño (alrededor de un pilar sin plantilla) no cabe ningún punto de la
  // retícula, y sin él la CDT une los rasgos con las esquinas de la interfaz en abanico
  if (rj) {
    const cerca = new Map<string, Vec2[]>();
    const clave = (q: Vec2) => `${Math.floor(q[0] / s)},${Math.floor(q[1] / s)}`;
    const poner = (q: Vec2) => {
      const k = clave(q);
      let v = cerca.get(k);
      if (!v) cerca.set(k, (v = []));
      v.push(q);
    };
    for (const p of reticula) poner(P[p]!);
    // Con holgura: en una planta regular, un centro justo a la distancia mínima no puede depender
    // del redondeo de una traslación o un giro
    const dmin = HOLGURA_CENTRO * s * (1 - 1e-4);
    const libre = (q: Vec2) => {
      const [cx, cy] = [Math.floor(q[0] / s), Math.floor(q[1] / s)];
      for (let a = cx - 1; a <= cx + 1; a++)
        for (let b = cy - 1; b <= cy + 1; b++)
          for (const o of cerca.get(`${a},${b}`) ?? []) if ((o[0] - q[0]) * (o[0] - q[0]) + (o[1] - q[1]) * (o[1] - q[1]) < dmin * dmin) return false;
      for (const i of celdas.get(celda(q[0], q[1])) ?? []) if (distanciaASegmento(q, segs[i]![0], segs[i]![1]) < dmin) return false;
      return true;
    };
    const nu = rj.U.length;
    for (let j = 0; j < rj.V.length - 1; j++)
      for (let i = 0; i < nu - 1; i++) {
        if (rj.estado[i + j * (nu - 1)] !== IRREGULAR) continue;
        const n = i + j * nu;
        const X = [rj.posicion(n), rj.posicion(n + 1), rj.posicion(n + nu + 1), rj.posicion(n + nu)];
        const q: Vec2 = [(X[0]![0] + X[1]![0] + X[2]![0] + X[3]![0]) / 4, (X[0]![1] + X[1]![1] + X[2]![1] + X[3]![1]) / 4];
        if (enLosa(q) < 0 || !libre(q)) continue;
        P.push(q);
        origen.push(-1);
        reticula.push(P.length - 1);
        poner(q);
      }
  }

  // 3. Triangulación restringida de los puntos que necesita, ordenados por (x, y): sin rejilla,
  // todos; con ella, los del arreglo que no son nudos de la rejilla rodeados de celdas regulares,
  // los de las aristas obligatorias y la retícula
  const enCDT = new Uint8Array(P.length);
  for (let p = 0; p < nPuntos; p++) enCDT[p] = !rj || (!rj.absorbidos[p] && (rj.nudoPunto[p]! < 0 || rj.toca(rj.nudoPunto[p]!, IRREGULAR))) ? 1 : 0;
  for (const [p, q] of restricciones) enCDT[p] = enCDT[q] = 1;
  for (const p of reticula) enCDT[p] = 1;
  for (let p = nPuntos; p < P.length; p++) if (!rj) enCDT[p] = 1;
  const usarCDT = !rj || rj.estado.some((x) => x === IRREGULAR);
  const orden = P.map((_, i) => i)
    .filter((i) => usarCDT && enCDT[i])
    .sort((a, b) => P[a]![0] - P[b]![0] || P[a]![1] - P[b]![1]);
  const pos = new Int32Array(P.length).fill(-1);
  orden.forEach((p, i) => (pos[p] = i));
  let tri: Uint32Array = new Uint32Array(0);
  let pasadas = 1;
  if (orden.length >= 3) {
    const coords = new Float64Array(2 * orden.length);
    orden.forEach((p, i) => {
      coords[2 * i] = P[p]![0];
      coords[2 * i + 1] = P[p]![1];
    });
    const aristas: [number, number][] = restricciones.map(([p, q]) => [pos[p]!, pos[q]!]);
    aristas.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    try {
      const d = new Delaunator(coords);
      // Dirección de referencia de los empates: el eje 1 de la primera losa
      pasadas = new Restringidor(d).restringir(aristas, losas[0]?.eje1 ?? [1, 0], origenes[0] ?? [0, 0], epsGeom);
      tri = d.triangles;
    } catch (e) {
      return { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
    }
  }

  // 4. Triángulos dentro de las losas y fuera de las celdas regulares (índices en P)
  const Q = (p: number) => P[p]!;
  const triangulos: { v: [number, number, number]; c: Vec2; losa: number }[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    let [a, b, c] = [orden[tri[t]!]!, orden[tri[t + 1]!]!, orden[tri[t + 2]!]!];
    const [A, B, C] = [Q(a), Q(b), Q(c)];
    const area2 = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    // Degenerados: entre la cadena sembrada de un lado recto (que en una dirección cualquiera no es
    // exactamente recta) y la envolvente convexa quedan triángulos de área de redondeo cuyo
    // centroide cae en el borde. Dentro de una losa no los hay: su lado libre se voltea.
    let L2 = 0;
    for (const [P1, P2] of [
      [A, B],
      [B, C],
      [C, A],
    ] as const)
      L2 = Math.max(L2, (P2[0] - P1[0]) * (P2[0] - P1[0]) + (P2[1] - P1[1]) * (P2[1] - P1[1]));
    if (!(Math.abs(area2) > 1e-10 * L2)) continue;
    if (area2 < 0) [b, c] = [c, b];
    const g: Vec2 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
    if (enRejilla(g)) continue;
    let losa = -1;
    for (let k = 0; k < losas.length && losa < 0; k++) {
      const cj = cajas[k]!;
      if (g[0] < cj[0] || g[0] > cj[2] || g[1] < cj[1] || g[1] > cj[3]) continue;
      if (puntoEnRegion(g, regiones[k]!)) losa = k;
    }
    if (losa >= 0) triangulos.push({ v: [a, b, c], c: g, losa });
  }

  // 5. Cuadriláteros: 3 por triángulo y 4, 2 o 1 por celda regular
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
  const vertice = (p: number) => nudo(`v${p}`, Q(p), origen[p]!);
  const medio = (p: number, q: number) => {
    const [A, B] = [Q(p), Q(q)];
    return nudo(p < q ? `m${p},${q}` : `m${q},${p}`, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], -1);
  };
  // Aristas de las piezas y si están partidas (la CDT parte todas): comprueba la conformidad
  const aristasMalla = new Map<string, boolean>();
  let conformes = true;
  const arista = (p: number, q: number, partida: boolean) => {
    const k = p < q ? `${p},${q}` : `${q},${p}`;
    const x = aristasMalla.get(k);
    if (x === undefined) aristasMalla.set(k, partida);
    else if (x !== partida) conformes = false;
  };
  const quads: QuadMalla[] = [];
  const piezas: { c: Vec2; losa: number }[] = [];
  triangulos.forEach((t, ti) => {
    const [a, b, c] = t.v;
    const [na, nb, nc] = [vertice(a), vertice(b), vertice(c)];
    const [mab, mbc, mca] = [medio(a, b), medio(b, c), medio(c, a)];
    const g = nudo(`c${ti}`, t.c, -1);
    quads.push({ nudos: [na, mab, g, mca], losa: t.losa, pieza: ti });
    quads.push({ nudos: [nb, mbc, g, mab], losa: t.losa, pieza: ti });
    quads.push({ nudos: [nc, mca, g, mbc], losa: t.losa, pieza: ti });
    piezas.push({ c: t.c, losa: t.losa });
    arista(a, b, true);
    arista(b, c, true);
    arista(c, a, true);
  });
  let celdasRejilla = 0;
  let plantillas = 0;
  if (rj) {
    const nu = rj.U.length;
    for (let j = 0; j < rj.V.length - 1; j++)
      for (let i = 0; i < nu - 1; i++) {
        const ci = i + j * (nu - 1);
        if (rj.estado[ci] !== REGULAR) continue;
        const n00 = i + j * nu;
        // Esquinas en sentido antihorario (los ejes 1-2 son directos): normal +Z
        const [a, b, c, d] = [pDe(n00), pDe(n00 + 1), pDe(n00 + nu + 1), pDe(n00 + nu)];
        const [ph, pv] = [rj.partida(n00, n00 + 1), rj.partida(n00, n00 + nu)];
        arista(a, b, ph);
        arista(d, c, ph);
        arista(a, d, pv);
        arista(b, c, pv);
        const [na, nb, nc, nd] = [vertice(a), vertice(b), vertice(c), vertice(d)];
        const X = [Q(a), Q(b), Q(c), Q(d)];
        const g: Vec2 = [(X[0]![0] + X[1]![0] + X[2]![0] + X[3]![0]) / 4, (X[0]![1] + X[1]![1] + X[2]![1] + X[3]![1]) / 4];
        const pi = piezas.length;
        const k = rj.losa[ci]!;
        piezas.push({ c: g, losa: k });
        const q = (n: [number, number, number, number]) => quads.push({ nudos: n, losa: k, pieza: pi });
        if (ph && pv) {
          const [mab, mbc, mdc, mad] = [medio(a, b), medio(b, c), medio(d, c), medio(a, d)];
          const ng = nudo(`g${ci}`, g, -1);
          q([na, mab, ng, mad]);
          q([mab, nb, mbc, ng]);
          q([ng, mbc, nc, mdc]);
          q([mad, ng, mdc, nd]);
        } else if (ph) {
          const [mab, mdc] = [medio(a, b), medio(d, c)];
          q([na, mab, mdc, nd]);
          q([mab, nb, nc, mdc]);
        } else if (pv) {
          const [mbc, mad] = [medio(b, c), medio(a, d)];
          q([na, nb, mbc, mad]);
          q([mad, mbc, nc, nd]);
        } else q([na, nb, nc, nd]);
        celdasRejilla++;
      }
    // Plantillas de pilar: los cuadriláteros de su red en una losa, una pieza cada uno
    redes.forEach((red, t) => {
      const pl = rj!.plantillas[t]!;
      const { A, B } = pl;
      const nd = (x: number | [number, number]) => (typeof x === "number" ? vertice(x) : medio(x[0], x[1]));
      const X = (x: number | [number, number]): Vec2 => (typeof x === "number" ? Q(x) : [(Q(x[0])[0] + Q(x[1])[0]) / 2, (Q(x[0])[1] + Q(x[1])[1]) / 2]);
      for (let b = 0; b < B - 1; b++)
        for (let a = 0; a < A - 1; a++) {
          const v = [red[a + A * b]!, red[a + 1 + A * b]!, red[a + 1 + A * (b + 1)]!, red[a + A * (b + 1)]!];
          const k = pl.losas[a + (A - 1) * b]!;
          if (k < 0) continue;
          const g = v.map(X).reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4] as Vec2, [0, 0] as Vec2);
          quads.push({ nudos: v.map(nd) as [number, number, number, number], losa: k, pieza: piezas.length });
          piezas.push({ c: g, losa: k });
          // Aristas entre puntos de P (las del borde son medias aristas de la rejilla)
          for (let m = 0; m < 4; m++) {
            const [x, y] = [v[m]!, v[(m + 1) % 4]!];
            if (typeof x === "number" && typeof y === "number") arista(x, y, false);
          }
        }
      // El borde: las aristas de la rejilla con su punto medio en la red, partidas
      for (const bd of pl.bordes) if (bd.losa >= 0) arista(pDe(bd.n1), pDe(bd.n2), true);
      plantillas++;
    });
  }

  // Nudos a lo largo de cada lado (sólo los tramos que son arista de una pieza que se queda)
  const nudosLado = cadenas.map((c) => {
    const r: number[] = [];
    for (let i = 0; i + 1 < c.length; i++) {
      const [p, q] = [c[i]!, c[i + 1]!];
      const partida = aristasMalla.get(p < q ? `${p},${q}` : `${q},${p}`);
      if (partida === undefined) continue;
      const np = nudoDe.get(`v${p}`)!;
      if (r[r.length - 1] !== np) r.push(np);
      if (partida) r.push(nudoDe.get(p < q ? `m${p},${q}` : `m${q},${p}`)!);
      r.push(nudoDe.get(`v${q}`)!);
    }
    return r;
  });

  // 6. Validador
  const problemas: ProblemaMalla[] = [];
  if (!conformes) problemas.push({ losa: -1, severidad: "error", codigo: "malla/conformidad", mensaje: "La rejilla y la triangulación no parten igual una arista de la interfaz. Es un fallo del compilador." });
  const areas = losas.map(() => 0);
  let jacobianoMin = Infinity;
  let peor: Vec2 = [0, 0];
  let bajos = 0;
  const malos = losas.map(() => 0);
  let areaRejilla = 0;
  for (const q of quads) {
    const X = q.nudos.map((n) => [nudos[n]!.x, nudos[n]!.y] as Vec2);
    let a = 0;
    for (let i = 0; i < 4; i++) a += X[i]![0] * X[(i + 1) % 4]![1] - X[(i + 1) % 4]![0] * X[i]![1];
    areas[q.losa]! += a / 2;
    if (q.pieza >= triangulos.length) areaRejilla += a / 2;
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
    piezas,
    lados,
    nudosLado,
    regiones,
    calidad: { jacobianoMin: quads.length ? jacobianoMin : 1, bajos },
    rejilla: { celdas: celdasRejilla, plantillas, quads: quads.length - 3 * triangulos.length, cobertura: areaRejilla / Math.max(1e-300, areas.reduce((s, a) => s + a, 0)) },
    problemas,
  };
}
