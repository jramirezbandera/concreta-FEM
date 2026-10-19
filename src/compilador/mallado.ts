/**
 * Mallador de las losas de una planta (C2, H29, H52): del arreglo plano a cuadriláteros DKMQ.
 *
 * 0. Rejilla alineada (`rejilla.ts`, C2-a): las celdas regulares de una rejilla en los ejes de la
 *    primera losa se parten en cuadriláteros por los puntos medios de sus lados. Lo demás (alrededor
 *    de los rasgos que no caen en la rejilla) va por los pasos 1 a 5, con las aristas de la interfaz
 *    como obligatorias; la CDT las parte por su punto medio, igual que la rejilla, y la malla es
 *    conforme. Los lados que van por una línea se cortan en los nudos de la rejilla y sólo se
 *    siembran sus tramos fuera de ella. Sin rejilla (o si no hay ninguna celda regular), todo es CDT.
 *    Con `refino` (F2), las plantillas de los pilares con caras de franja se refinan junto a ellas
 *    (`rejilla.ts`); si la planta refinada no pasa el validador, se malla sin refinar y se avisa
 *    (`malla/cara-sin-refinar`), antes de recurrir a la CDT sola.
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
 *    Después, refinamiento de Delaunay (G-4): mientras un triángulo que se queda, fuera de las
 *    huellas, dé un cuadrilátero con el jacobiano escalado < JACOBIANO_OBJETIVO, se añade su
 *    circuncentro (o su «off-center»); los tramos sembrados invadidos se parten por la mitad
 *    (Ruppert). Los tramos de los muros, la rejilla, la interfaz y las plantillas no se parten.
 *    Con las esquinas de LV2 (`refinamiento-vigas.md` §18), las aristas obligatorias que no tocan
 *    losa (el eje de una viga dentro de su ancho) no cuentan, y las que no se parten sólo rechazan
 *    un punto que forme con ellas un triángulo malo y no mejore MEJORA_MINIMA veces el que se
 *    refina: antes, sus círculos diametrales dejaban sin refinar la triangulación junto a las vigas.
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
import { incircle, orient2d } from "robust-predicates";
import type { Arreglo, Trazo } from "./arreglo.ts";
import type { Vec2 } from "./fisico.ts";
import { CUANTO_ORDEN } from "./geometria2d.ts";
import { distanciaASegmento, jacobianoEscalado, momentosRegion, puntoEnPoligono, puntoEnRegion, type Region, RegionIndexada } from "./poligonos.ts";
import { cubierta, IRREGULAR, REGULAR, rejillaPlanta, type RefinoHuella, type Rejilla } from "./rejilla.ts";

export { jacobianoEscalado };

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

/** Refinamiento de Delaunay (G-4): jacobiano escalado mínimo de los 3 cuadriláteros de cada triángulo que se queda. */
export const JACOBIANO_OBJETIVO = 0.3;
/** Refinamiento: distancia mínima de un punto nuevo a los demás, en fracciones de su circunradio (o de la media arista que parte). */
export const SEPARACION = 0.5;
/** Refinamiento: no se refina un triángulo con el circunradio (o una arista con la mitad) por debajo de esta fracción del tamaño local. */
export const PISO = 0.1;
/** Refinamiento: rondas como mucho (cada una vuelve a triangular la planta). */
export const RONDAS_MAXIMAS = 40;
/**
 * Junto a una arista que no se parte, un punto nuevo que no llegue a JACOBIANO_OBJETIVO sólo entra si
 * el triángulo que formaría con ella mejora al menos esto el que se refina (LV2, §18).
 */
export const MEJORA_MINIMA = 1.5;

/** Fracción de paso que se tolera antes de añadir un tramo más a la siembra de un lado. */
const HOLGURA_SIEMBRA = 1e-4;

export interface LosaMallar {
  id: string;
  contorno: Trazo;
  huecos: readonly Trazo[];
  /** Dirección del eje 1 (unitaria). */
  eje1: Vec2;
}

/**
 * El ancho de una viga que no es losa (fase LV, `anchosVigas.ts`): su trazo cerrado en el arreglo y
 * los extremos de su eje.
 */
export interface AnchoMallar {
  trazo: Trazo;
  A: Vec2;
  B: Vec2;
  /** Ancho de la viga. */
  b: number;
}

/**
 * Una pieza de la triangulación en el ancho de una viga (fase LV): no es lámina, y su carga pasa a la
 * viga. En el cruce de dos anchos, al de la viga que pasa por él (`anchoDe` en `mallarPlantaCon`).
 */
export interface PiezaAncho {
  /** Vértices, antihorario. */
  v: Vec2[];
  c: Vec2;
  area: number;
  /** Losa (índice en la lista de `mallarPlanta`) en cuya región cae. */
  losa: number;
  /** Ancho (índice en la lista de `mallarPlanta`). */
  ancho: number;
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
  /** Otros objetos físicos a los que se refiere (los pilares de `malla/esquina-sin-refinar`). */
  objetos?: readonly string[];
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
      /** Piezas en el ancho de las vigas (fase LV): no son láminas. */
      piezasAncho: PiezaAncho[];
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
      rejilla: { celdas: number; plantillas: number; refinadas: number; quads: number; cobertura: number };
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
/**
 * Tope de predicados (`inCircle` e `intersectSegments`) por punto en una triangulación restringida
 * de `Restringidor` (más 100 000). Con unos rasgos casi degenerados (una línea de carga que cruza la
 * cara del ancho de una viga con 2°, y los puntos que el refinamiento pone junto al cruce, fase LV),
 * el recorrido de constrainautor ciclaba sin fin. Con el tope lanza: se repite sin los empates (el
 * respaldo) y, si tampoco acaba, la planta no se malla (error), pero nunca se cuelga. Los modelos de
 * las pruebas hacen ≤ 14 por punto.
 */
const TOPE_PREDICADOS = 200;

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
  private llamadas = 0;
  private tope = Infinity;
  private conEmpates = true;

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
    this.tope = TOPE_PREDICADOS * (this.del.coords.length / 2) + 100000;
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

  /** Restringe las aristas con los predicados exactos, sin los empates (el respaldo), con el mismo tope. */
  restringirSinEmpates(aristas: readonly [number, number][]): void {
    this.conEmpates = false;
    this.tope = TOPE_PREDICADOS * (this.del.coords.length / 2) + 100000;
    this.constrainAll(aristas);
  }

  private contar(): void {
    if (++this.llamadas > this.tope) throw new Error(`La triangulación restringida no acaba (${this.llamadas} predicados)`);
  }

  protected override intersectSegments(p1: number, p2: number, p3: number, p4: number): boolean {
    this.contar();
    return super.intersectSegments(p1, p2, p3, p4);
  }

  /**
   * ¿Hay que cambiar la diagonal p2–p3 de los triángulos (p1, p2, p3) y (p3, p2, px) por p1–px? Nunca
   * si el cuadrilátero no es estrictamente convexo: con puntos casi alineados (junto a un ángulo de
   * 2° entre dos aristas obligatorias), el empate pedía girarla, la estructura de constrainautor se
   * corrompía y sus recorridos alrededor de un vértice no acababan (fase LV).
   */
  protected override inCircle(p1: number, p2: number, p3: number, px: number): boolean {
    this.contar();
    if (!this.conEmpates) return super.inCircle(p1, p2, p3, px);
    const c = this.del.coords;
    const X = (i: number): Vec2 => [c[2 * i]!, c[2 * i + 1]!];
    const [A, B, C, D] = [X(p1), X(p2), X(p3), X(px)];
    if (!this.cambiar(A, B, C, D)) return false;
    const [o1, o2] = [orient2d(A[0], A[1], D[0], D[1], B[0], B[1]), orient2d(A[0], A[1], D[0], D[1], C[0], C[1])];
    return (o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0);
  }

  private cambiar(A: Vec2, B: Vec2, C: Vec2, D: Vec2): boolean {
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

/** Jacobiano escalado mínimo de los 3 cuadriláteros en que se divide un triángulo (paso 5). */
export function jacobianoTriangulo(A: Vec2, B: Vec2, C: Vec2): number {
  const m = (P1: Vec2, P2: Vec2): Vec2 => [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];
  const g: Vec2 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  const [mab, mbc, mca] = [m(A, B), m(B, C), m(C, A)];
  return Math.min(jacobianoEscalado([A, mab, g, mca]), jacobianoEscalado([B, mbc, g, mab]), jacobianoEscalado([C, mca, g, mbc]));
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
export function mallarPlanta(arreglo: Arreglo, losas: readonly LosaMallar[], h: number, epsGeom = 1e-6, presembrados?: ReadonlySet<string>, rejilla = true, refino?: RefinoCaras, anchos: readonly AnchoMallar[] = []): ResultadoMalla {
  // La triangulación sola lleva lo de LV2 que no depende de la rejilla (§18: el refinamiento junto a
  // las vigas); sin esquinas, la de siempre
  const sin = () => mallarPlantaCon(arreglo, losas, h, epsGeom, presembrados, false, refino?.esquinas ? refino : undefined, anchos);
  if (!rejilla) return sin();
  const conRejilla = () => mallarPlantaCon(arreglo, losas, h, epsGeom, presembrados, true, undefined, anchos);
  const r = conRespaldo(refino?.caras.size || (refino?.esquinas && anchos.length) ? () => conRespaldoRefino(() => mallarPlantaCon(arreglo, losas, h, epsGeom, presembrados, true, refino, anchos), conRejilla, [...refino.caras.keys()]) : conRejilla, sin);
  if (!r.ok || r.rejilla.cobertura >= COBERTURA_MINIMA || r.problemas.some((p) => p.codigo === "malla/sin-rejilla")) return r;
  const s = sin();
  return s.ok && s.nudos.length < r.nudos.length ? s : r;
}

/**
 * G-1: si la malla con rejilla falla (una excepción, o no pasa el validador), la planta se malla con
 * la triangulación sola, que no depende de la rejilla, y se avisa. Un fallo de la rejilla no puede
 * impedir el cálculo. Si la triangulación sola también falla, queda el fallo de la rejilla (o el
 * de la triangulación, si la rejilla lanzó una excepción).
 */
export function conRespaldo(conRejilla: () => ResultadoMalla, sinRejilla: () => ResultadoMalla): ResultadoMalla {
  let r: ResultadoMalla;
  try {
    r = conRejilla();
  } catch (e) {
    r = { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
  }
  const fallo = !r.ok ? r.mensaje || "error" : [...new Set(r.problemas.filter((p) => p.severidad === "error").map((p) => p.codigo))].join(", ");
  if (!fallo) return r;
  const sin = sinRejilla();
  if (!sin.ok || sin.problemas.some((p) => p.severidad === "error")) return r.ok ? r : sin;
  sin.problemas.push({
    losa: -1,
    severidad: "aviso",
    codigo: "malla/sin-rejilla",
    mensaje: `La rejilla alineada ha fallado en esta planta (${fallo}) y se ha mallado con la triangulación sola, con más nudos y sin plantillas de pilar. El cálculo es válido; el fallo es del compilador: avise para corregirlo.`,
  });
  return sin;
}

/**
 * F2: si la planta con las caras refinadas falla (una excepción, o no pasa el validador), se malla
 * con la rejilla sin refinar y se avisa de que en las caras de sus pilares el momento puede salir
 * bajo. Si también falla, queda el fallo, y `conRespaldo` pasa a la triangulación sola.
 */
export function conRespaldoRefino(conRefino: () => ResultadoMalla, sinRefino: () => ResultadoMalla, pilares: readonly string[]): ResultadoMalla {
  let r: ResultadoMalla;
  try {
    r = conRefino();
  } catch (e) {
    r = { ok: false, mensaje: e instanceof Error ? e.message : String(e) };
  }
  const fallo = !r.ok ? r.mensaje || "error" : [...new Set(r.problemas.filter((p) => p.severidad === "error").map((p) => p.codigo))].join(", ");
  if (!fallo) return r;
  const sin = sinRefino();
  if (!sin.ok || sin.problemas.some((p) => p.severidad === "error")) return sin;
  sin.problemas.push(avisoSinRefinar(pilares, `el refinamiento ha fallado en esta planta (${fallo})`));
  return sin;
}

/**
 * Aviso de los pilares cuyas caras se quedan sin refinar (F2). Sin pilares, la planta sólo refinaba
 * las esquinas de los paños (LV2), y el aviso es el de ellas.
 */
function avisoSinRefinar(pilares: readonly string[], porque: string): ProblemaMalla {
  const caras = pilares.length > 0;
  return {
    losa: -1,
    severidad: "aviso",
    codigo: caras ? "malla/cara-sin-refinar" : "malla/esquina-sin-refinar",
    mensaje: `La malla ${caras ? `junto a las caras de ${[...pilares].sort().join(", ")}` : "de las esquinas de los paños entre vigas de esta planta"} no se ha refinado: ${porque}. Con el tamaño de malla por defecto, ${
      caras ? "el momento de las franjas en esas caras puede salir hasta un 6 % bajo" : "el momento de las vigas en las caras de los pilares puede salir un 20 % bajo, y el de las franjas en ellas, hasta un 40 %"
    }. El cálculo es válido; el fallo es del compilador: avise para corregirlo.`,
  };
}

/** Aviso de los pilares de los cruces de vigas cuyas esquinas se quedan sin refinar (LV2-g). */
function avisoEsquinaSinRefinar(pilares: readonly string[], porque: string): ProblemaMalla {
  const ids = [...new Set(pilares)].sort();
  return {
    objetos: ids,
    losa: -1,
    severidad: "aviso",
    codigo: "malla/esquina-sin-refinar",
    mensaje: `La malla de las esquinas de los paños junto a ${ids.join(", ")} no se ha refinado: ${porque}. Allí queda la malla de antes de refinar las esquinas, y con el tamaño de malla por defecto el momento de la viga en la cara de esos pilares puede salir un 20 % bajo, y el de las franjas en sus caras, hasta un 40 %. El cálculo es válido; revise esas caras con más cuidado o baje el tamaño de malla.`,
  };
}

/**
 * Caras de pilares que se refinan (F2), por el id del pilar de la huella: la normal d de su recta y
 * el lado (−1: el de s = d·x menores).
 */
export interface RefinoCaras {
  caras: ReadonlyMap<string, readonly { d: Vec2; lado: -1 | 1 }[]>;
  /** 2·ε_snap: la escala de «junto a un pilar» en las plantillas de esquina (LV2-g) y de las huellas tapadas por un ancho (LV-8). Hasta la fase HR, también la distancia mínima de un nudo nuevo a la cara. */
  separacion: number;
  /** Refinar las esquinas de los paños entre las caras de las vigas (fase LV2). */
  esquinas?: boolean;
  /** Huellas de todos los pilares de la planta (LV2: lejos de ellas, sin nudos nuevos). */
  huellas?: readonly (readonly Vec2[])[];
  /** Id del pilar de cada una de `huellas`, para los avisos. */
  idsHuellas?: readonly string[];
  /** Índices en `huellas` de los pilares tapados por el ancho de su viga (LV-8): sin sembrar, con la plantilla de cara delante de su huella. */
  tapadas?: readonly number[];
}

/** `mallarPlanta` sin comparar con la CDT sola cuando la rejilla cubre poco (para las pruebas). */
export function mallarPlantaCon(arreglo: Arreglo, losas: readonly LosaMallar[], h: number, epsGeom: number, presembrados: ReadonlySet<string> | undefined, rejilla: boolean, refino?: RefinoCaras, anchos: readonly AnchoMallar[] = []): ResultadoMalla {
  const s = 2 * h;
  const lados = arreglo.lados();
  const regiones = losas.map((l) => regionDe(arreglo, l));
  // Los contornos en el arreglo tienen cientos de puntos y se consultan por cada triángulo de cada
  // ronda: indexados por bandas, con el mismo resultado que `puntoEnRegion`
  const regionesIdx = regiones.map((r) => new RegionIndexada(r));
  const cajas = regiones.map((r) => cajaDe(r.contorno));
  const P: Vec2[] = arreglo.puntos.map((p) => [p.x, p.y]);
  const origen: number[] = arreglo.puntos.map((_, i) => i);
  /** Losa en cuya región (contorno sin huecos) cae q, o −1. */
  const enRegion = (q: Vec2) =>
    regiones.findIndex((_, k) => {
      const cj = cajas[k]!;
      return !(q[0] < cj[0] || q[0] > cj[2] || q[1] < cj[1] || q[1] > cj[3]) && regionesIdx[k]!.dentro(q);
    });
  // El ancho de las vigas (fase LV): está en la región de la losa, pero no es losa. Su polígono es el
  // de su trazo en el arreglo (ya unido a lo cercano), el mismo que siembra la malla
  const conAnchos = anchos.length > 0;
  const anchosP = anchos.map((a) => {
    const poli = a.trazo.puntos.map((i) => P[i]!);
    const d: Vec2 = [a.B[0] - a.A[0], a.B[1] - a.A[1]];
    const L = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
    return { poli, caja: cajaDe(poli), A: a.A, B: a.B, u: [d[0] / L, d[1] / L] as Vec2 };
  });
  // Los anchos por celdas de su caja (de lado 2h): por cada punto se miran sólo los anchos cuya caja
  // toca su celda, en el mismo orden, así que `enAnchos` da la misma lista que recorrerlos todos.
  // Con los miles de triángulos de cada `quedan`, recorrerlos todos contra todos los anchos era la
  // mitad de ese paso
  const celdasAnchos = new Map<string, number[]>();
  anchosP.forEach((a, i) => {
    const cj = a.caja;
    for (let x = Math.floor(cj[0] / s); x <= Math.floor(cj[2] / s); x++)
      for (let y = Math.floor(cj[1] / s); y <= Math.floor(cj[3] / s); y++) {
        const k = `${x},${y}`;
        const v = celdasAnchos.get(k);
        if (v) v.push(i);
        else celdasAnchos.set(k, [i]);
      }
  });
  /** Anchos que contienen q. */
  const enAnchos = (q: Vec2): number[] => {
    const r: number[] = [];
    for (const i of celdasAnchos.get(`${Math.floor(q[0] / s)},${Math.floor(q[1] / s)}`) ?? []) {
      const a = anchosP[i]!;
      const cj = a.caja;
      if (!(q[0] < cj[0] || q[0] > cj[2] || q[1] < cj[1] || q[1] > cj[3]) && puntoEnPoligono(q, a.poli)) r.push(i);
    }
    return r;
  };
  /**
   * De los anchos que contienen q (el cruce de dos vigas), el de la que pasa por él, no el de la que
   * acaba en él (q a menos del medio ancho de la otra del extremo de su eje); si pasan o acaban las
   * dos, el primero. La regla es discreta: el reparto del cruce no depende de cómo lo triangula la CDT
   * (con el eje más cercano dependía de una diagonal, y un giro de la planta cambiaba la carga).
   */
  const anchoDe = (q: Vec2): number => {
    const en = enAnchos(q);
    if (en.length < 2) return en.length ? en[0]! : -1;
    const acaba = (i: number) => {
      const { A, B, u } = anchosP[i]!;
      const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
      const sg = (q[0] - A[0]) * u[0] + (q[1] - A[1]) * u[1];
      const otro = Math.max(...en.filter((j) => j !== i).map((j) => anchos[j]!.b / 2));
      return Math.min(sg, L - sg) <= otro + 1e-9;
    };
    return en.find((i) => !acaba(i)) ?? en[0]!;
  };
  /** Losa en la que cae q (fuera del ancho de las vigas), o −1. */
  const enLosa = conAnchos ? (q: Vec2) => (enAnchos(q).length ? -1 : enRegion(q)) : enRegion;
  const trazoLosa = new Set<Trazo>(losas.flatMap((l) => [l.contorno, ...l.huecos]));
  const fijos = lados.map((l) => presembrados?.has(`${l.a},${l.b}`) ?? false);
  // Con anchos, un lado cuenta (se siembra, va en la rejilla y se valida) si toca losa por algún lado,
  // y es borde (arista obligatoria) si lo que hay a cada lado es distinto, en la losa o en su región.
  // Un lado dentro del ancho de una viga y de la región de una losa (un borde de losa dibujado por el
  // eje de la viga, el de una zona de carga o de un ábaco) no cuenta, pero es arista obligatoria: las
  // piezas del ancho no lo cruzan, y su carga es la de su lado
  const ladoA = lados.map((l) => {
    if (!conAnchos) return { relevante: false, borde: false, iz: false, de: false };
    const [A, B] = [P[l.a]!, P[l.b]!];
    const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
    const m: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const nu: Vec2 = L > 0 ? [-(B[1] - A[1]) / L, (B[0] - A[0]) / L] : [0, 0];
    const dl = 10 * epsGeom;
    const [Mi, Md]: [Vec2, Vec2] = [
      [m[0] + dl * nu[0], m[1] + dl * nu[1]],
      [m[0] - dl * nu[0], m[1] - dl * nu[1]],
    ];
    const [iz, de] = [enLosa(Mi), enLosa(Md)];
    const [ri, rd] = [enRegion(Mi), enRegion(Md)];
    return { relevante: iz >= 0 || de >= 0, borde: iz !== de || ri !== rd || (iz < 0 && de < 0 && (ri >= 0 || rd >= 0)), iz: iz >= 0, de: de >= 0 };
  });
  /** Puntos de los trazos de los anchos (en su borde: cuentan por sus lados). */
  const puntoAncho = new Set<number>(anchos.flatMap((a) => a.trazo.puntos));

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
  /** Id (el del pilar) de cada huella, en el orden de la rejilla. */
  const idHuella: string[] = [];
  /** Si cada huella de la rejilla es una tira (LV-8), en el mismo orden. */
  const tiraHuella: boolean[] = [];
  if (rejilla && losas.length) {
    const ladoEnLosa = lados.map((l, k) => {
      if (conAnchos) return ladoA[k]!.relevante;
      const [A, B] = [P[l.a]!, P[l.b]!];
      return l.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!)) || enLosa([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]) >= 0;
    });
    const puntoEnLosa = P.map((q, p) => !puntoAncho.has(p) && enLosa(q) >= 0);
    lados.forEach((l, k) => {
      if (ladoEnLosa[k]) puntoEnLosa[l.a] = puntoEnLosa[l.b] = true;
    });
    // Huellas de los pilares: sus puntos y sus lados. Con el ancho de las vigas y las esquinas de los
    // paños (fase LV2, LV-8): la huella que un ancho atraviesa de lado a lado va por las tiras que
    // asoman de él, cada una como huella de su grupo (el pilar): un pilar de fachada enrasado contra
    // el ancho, con su plantilla. Sin tiras, lo que asoma lo mallaba la triangulación con astillas
    const huellas: { puntos: number[]; lados: number[]; grupo: number; tira?: boolean }[] = [];
    const centroHuella: Vec2[] = [];
    const tolTira = 10 * epsGeom;
    let grupo = 0;
    arreglo.trazos.forEach((t, ti) => {
      if (t.tipo !== "huella") return;
      const ladosT = lados.flatMap((l, k) => (l.trazos.includes(ti) ? [k] : []));
      const c = t.puntos.reduce((a, p) => [a[0] + P[p]![0] / t.puntos.length, a[1] + P[p]![1] / t.puntos.length] as Vec2, [0, 0] as Vec2);
      const g = grupo++;
      // Los anchos que pasan por su centro y la atraviesan entera (todos sus puntos entre los extremos
      // del ancho): el de una viga que acaba en el pilar deja lo que asoma sin forma de rectángulo
      const atraviesan =
        conAnchos && refino?.esquinas
          ? enAnchos(c).filter((i) => {
              const { A, B, u } = anchosP[i]!;
              const L = (B[0] - A[0]) * u[0] + (B[1] - A[1]) * u[1];
              return t.puntos.every((p) => {
                const sg = (P[p]![0] - A[0]) * u[0] + (P[p]![1] - A[1]) * u[1];
                return sg >= -tolTira && sg <= L + tolTira;
              });
            })
          : [];
      if (!atraviesan.length) {
        huellas.push({ puntos: t.puntos, lados: ladosT, grupo: g });
        idHuella.push(t.id);
        tiraHuella.push(false);
        centroHuella.push(c);
        return;
      }
      // A qué lado de cada ancho cae cada punto (0: dentro); las tiras, por su firma
      const firma = (p: number) =>
        atraviesan.map((i) => {
          const { A, u } = anchosP[i]!;
          const sd = -(P[p]![0] - A[0]) * u[1] + (P[p]![1] - A[1]) * u[0];
          const b2 = anchos[i]!.b / 2;
          return sd >= b2 - tolTira ? 1 : sd <= -b2 + tolTira ? -1 : 0;
        });
      const tiras = new Map<string, number[]>();
      for (const p of t.puntos) {
        const f = firma(p);
        if (f.includes(0)) continue;
        const clave = f.join(",");
        let v = tiras.get(clave);
        if (!v) tiras.set(clave, (v = []));
        v.push(p);
      }
      for (const [, puntos] of [...tiras].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        // Una tira fuera de las losas (lo que asoma de un pilar de borde hacia fuera) no es huella
        if (!puntos.some((p) => puntoEnLosa[p])) continue;
        const en = new Set(puntos);
        // Sus lados: los de la huella entre sus puntos y el trozo de la cara del ancho que la cierra
        // (un lado del ancho, no de la huella). Sin él, cuando la plantilla parte la cara (la celda
        // de la huella va partida, §7 de `rejilla.ts`) su nudo no estaba en la cadena del lado y la
        // malla salía con `malla/lado-perdido` (la retícula 5 con muros, LV2 §19)
        huellas.push({ puntos, lados: lados.flatMap((l, k) => (en.has(l.a) && en.has(l.b) ? [k] : [])), grupo: g, tira: true });
        idHuella.push(t.id);
        tiraHuella.push(true);
        centroHuella.push(c);
      }
    });
    const exactos = lados.map((l) => l.trazos.some((t) => arreglo.trazos[t]!.exacto));
    // Fase LV: las caras de los anchos de las vigas (sus lados paralelos al eje) son líneas fuertes de
    // la rejilla, y el eje de un pilar no lo es en la dirección de un ancho que pasa por su centro
    const e0 = losas[0]!.eje1;
    const traza = new Map(anchos.map((a, i) => [a.trazo, i] as const));
    const fuertes = conAnchos
      ? lados.map((l, k) => {
          if (!ladoA[k]!.relevante) return false;
          const [A, B] = [P[l.a]!, P[l.b]!];
          const L = Math.sqrt((B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
          return l.trazos.some((t) => {
            const i = traza.get(arreglo.trazos[t]!);
            if (i === undefined) return false;
            const { u } = anchosP[i]!;
            return Math.abs((B[0] - A[0]) * u[1] - (B[1] - A[1]) * u[0]) <= 1e-6 * L;
          });
        })
      : undefined;
    const sinEje = conAnchos
      ? huellas.map((_, kh): [boolean, boolean] => {
          const c = centroHuella[kh]!;
          const r: [boolean, boolean] = [false, false];
          for (const i of enAnchos(c)) {
            const { u } = anchosP[i]!;
            const du = Math.abs(u[0] * e0[0] + u[1] * e0[1]);
            // Un ancho a lo largo del eje 1 (u) tiene sus caras en v constante: sin la línea v del pilar
            if (du > 1 - 1e-9) r[1] = true;
            else if (du < 1e-9) r[0] = true;
          }
          return r;
        })
      : undefined;
    // Caras que se refinan, en los ejes de la rejilla: u a lo largo del eje 1 de la primera losa
    const e = losas[0]!.eje1;
    const refinoH = refino?.caras.size
      ? idHuella.map((id): RefinoHuella | null => {
          const cs = refino.caras.get(id);
          if (!cs?.length) return null;
          const u: [boolean, boolean] = [false, false];
          const v: [boolean, boolean] = [false, false];
          for (const { d, lado } of cs) {
            const du = d[0] * e[0] + d[1] * e[1];
            const dv = -d[0] * e[1] + d[1] * e[0];
            if (Math.abs(du) > 1 - 1e-9) u[lado * du > 0 ? 1 : 0] = true;
            else if (Math.abs(dv) > 1 - 1e-9) v[lado * dv > 0 ? 1 : 0] = true;
          }
          return u[0] || u[1] || v[0] || v[1] ? { u, v } : null;
        })
      : undefined;
    rj = rejillaPlanta({
      P,
      lados,
      ladoEnLosa,
      puntoEnLosa,
      fijos,
      exactos,
      huellas,
      ...(refinoH ? { refino: refinoH } : {}),
      ...(refinoH || (refino?.esquinas && fuertes) ? { separacionRefino: refino!.separacion } : {}),
      ...(fuertes ? { fuertes, sinEje, ...(refino?.esquinas ? { esquinas: true, huellasPilares: refino.huellas ?? [], tapadas: refino.tapadas ?? [] } : {}) } : {}),
      regiones,
      enLosa,
      O: origenes[0]!,
      e,
      h,
      epsGeom,
    });
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
  /** Lados de las tiras de huella (LV-8): sobre la cara de un ancho, con la triangulación al otro lado. */
  const ladosTira = new Set<number>();
  // Aristas de la rejilla que una plantilla refinada parte en más de dos (F2): sus nudos de una
  // punta a la otra, por la clave «p,q» de sus extremos en P
  const subdividida = new Map<string, number[]>();
  redes.forEach((red, t) => {
    for (const { n } of rj!.plantillas[t]!.quads)
      for (let m = 0; m < 4; m++) {
        const [x, y] = [red[n[m]!]!, red[n[(m + 1) % 4]!]!];
        if (typeof x !== "number" || typeof y !== "number") continue;
        aristasPlantilla.add(x < y ? `${x},${y}` : `${y},${x}`);
      }
    for (const sd of rj!.plantillas[t]!.subdivididas) {
      const [p, q] = [red[sd.a] as number, red[sd.b] as number];
      const medio = sd.nudos.map((i) => red[i] as number);
      subdividida.set(`${p},${q}`, medio);
      subdividida.set(`${q},${p}`, [...medio].reverse());
    }
    const anillo = rj!.plantillas[t]!.anillo.map((i) => red[i] as number);
    const n = anillo.length;
    const dePunto = new Set(anillo.filter((p) => p < nPuntos));
    for (const k of rj!.plantillas[t]!.huellaLados) {
      if (tiraHuella[rj!.plantillas[t]!.huella]) ladosTira.add(k);
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
  // Tramos sembrados de la CDT (clave «p,q» → su lado): los únicos que el refinamiento puede partir.
  // Los de los muros, la rejilla, la interfaz y las plantillas no se tocan
  const partible = new Map<string, number>();
  // Aristas obligatorias que no tocan losa (el eje de una viga dentro de su ancho, un borde de la
  // región dentro de él): su círculo diametral no cuenta en el refinamiento (LV2, §18)
  const sinLosa = new Set<string>();
  // Cadena de cada lado: sus extremos, los nudos de la rejilla que son esquina de una celda regular
  // y la siembra de los tramos que van por la CDT
  const cadenas: number[][] = lados.map((l, k) => {
    // Un lado entero fuera de las losas (el trozo de un ábaco, una zona o una banda que se sale, o
    // una viga sin losa) no se siembra ni es obligatorio: lo de fuera se descarta, y como los bordes
    // de las losas sí lo son, no cambia nada dentro. Con él, constrainautor fallaba en algunas
    // plantas giradas (C4)
    const [Aa, Bb] = [P[l.a]!, P[l.b]!];
    if (conAnchos && !ladoA[k]!.relevante) {
      // Un borde de la región dentro del ancho de una viga: obligatorio, sin sembrar
      if (ladoA[k]!.borde) {
        restringir(l.a, l.b);
        sinLosa.add(l.a < l.b ? `${l.a},${l.b}` : `${l.b},${l.a}`);
      }
      return [l.a, l.b];
    }
    if (!conAnchos && !l.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!)) && enLosa([(Aa[0] + Bb[0]) / 2, (Aa[1] + Bb[1]) / 2]) < 0) return [l.a, l.b];
    // Los lados de los ejes de los muros ya vienen sembrados (C3): sus puntos son las estaciones
    if (fijos[k]) {
      restringir(l.a, l.b);
      return [l.a, l.b];
    }
    const ch = cadenaHuella.get(k);
    if (ch) {
      // El lado de una tira de huella sobre la cara del ancho de una viga (LV2, LV-8): al otro lado
      // está el ancho, que malla la triangulación, así que es obligatorio
      if (ladosTira.has(k) && ladoA[k]!.borde) for (let m = 0; m + 1 < ch.length; m++) restringir(ch[m]!, ch[m + 1]!);
      return ch;
    }
    const el = rj?.enLinea[k];
    const borde = conAnchos ? ladoA[k]!.borde : l.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!));
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
      const sub = subdividida.get(`${x.p},${y.p}`);
      if (sub) {
        // Arista de la rejilla partida por una plantilla refinada: por sus nudos
        let ant = x.p;
        for (const q of [...sub, y.p]) {
          if (borde) restringir(ant, q);
          c.push(q);
          ant = q;
        }
        continue;
      }
      if (aristasPlantilla.has(x.p < y.p ? `${x.p},${y.p}` : `${y.p},${x.p}`)) {
        // Arista dentro de una plantilla (el tramo de viga entre la cara del pilar y el borde). Si va
        // por el borde de una losa (un pilar de esquina o de fachada), fuera de ella puede haber CDT
        // (lo que la cruce desde fuera: un ábaco, una zona o una banda) y tiene que ser obligatoria
        if (borde) restringir(x.p, y.p);
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
        partible.set(ant < q ? `${ant},${q}` : `${q},${ant}`, k);
        c.push(q);
        ant = q;
      }
    }
    return c;
  });
  // La interfaz entre la rejilla y la CDT. Una arista que una plantilla parte en más de dos (la cara
  // de una viga junto a una esquina de paño, LV2, con el ancho de la viga irregular al otro lado), por
  // sus nudos
  for (const [n1, n2] of rj?.interfaz ?? []) {
    const [p, q] = [pDe(n1), pDe(n2)];
    const c = [p, ...(subdividida.get(`${p},${q}`) ?? []), q];
    for (let m = 0; m + 1 < c.length; m++) restringir(c[m]!, c[m + 1]!);
  }

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
    const rIdx = regionesIdx[k]!;
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
        if (rIdx.dentro(q) && lejos(q) && !enRejilla(q) && !(conAnchos && enAnchos(q).length)) {
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
  // los de las aristas obligatorias y la retícula (y los que añada el refinamiento)
  const enCDT: number[] = Array.from({ length: P.length }, () => 0);
  for (let p = 0; p < nPuntos; p++) enCDT[p] = !rj || (!rj.absorbidos[p] && (rj.nudoPunto[p]! < 0 || rj.toca(rj.nudoPunto[p]!, IRREGULAR))) ? 1 : 0;
  for (const [p, q] of restricciones) enCDT[p] = enCDT[q] = 1;
  for (const p of reticula) enCDT[p] = 1;
  for (let p = nPuntos; p < P.length; p++) if (!rj) enCDT[p] = 1;
  // Con anchos, la triangulación da también sus piezas (sus celdas no son de la rejilla)
  const usarCDT = !rj || rj.estado.some((x) => x === IRREGULAR) || conAnchos;

  let orden: number[] = [];
  let tri: Uint32Array = new Uint32Array(0);
  let pasadas = 1;
  let sinEmpates = false;
  const triangular = (): string | null => {
    orden = P.map((_, i) => i)
      .filter((i) => usarCDT && enCDT[i])
      .sort((a, b) => P[a]![0] - P[b]![0] || P[a]![1] - P[b]![1]);
    tri = new Uint32Array(0);
    if (orden.length < 3) return null;
    const pos = new Int32Array(P.length).fill(-1);
    orden.forEach((p, i) => (pos[p] = i));
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
    } catch {
      // Respaldo: con rasgos casi degenerados (una línea de carga que se une a la cara del ancho de una
      // viga y sigue a 2° de ella, fase LV), los empates de `Restringidor` rompían el recorrido de
      // constrainautor. Sin ellos triangula, aunque la malla puede depender de la posición de la planta
      try {
        const d = new Delaunator(coords);
        new Restringidor(d).restringirSinEmpates(aristas);
        tri = d.triangles;
        sinEmpates = true;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
    return null;
  };

  // 4. Triángulos dentro de las losas y fuera de las celdas regulares (índices en P)
  const Q = (p: number) => P[p]!;
  type Triangulo = { v: [number, number, number]; c: Vec2; losa: number };
  /** Los triángulos en el ancho de una viga (fase LV), con su ancho; los rehace cada `quedan`. */
  let enAncho: (Triangulo & { ancho: number })[] = [];
  const quedan = (): Triangulo[] => {
    const r: Triangulo[] = [];
    enAncho = [];
    for (let t = 0; t < tri.length; t += 3) {
      let [a, b, c] = [orden[tri[t]!]!, orden[tri[t + 1]!]!, orden[tri[t + 2]!]!];
      const [A, B, C] = [Q(a), Q(b), Q(c)];
      const area2 = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      // Degenerados: entre la cadena sembrada de un lado recto (que en una dirección cualquiera no es
      // exactamente recta) y la envolvente convexa quedan triángulos de área de redondeo cuyo
      // centroide cae en el borde. Dentro de una losa no los hay: su lado libre se voltea.
      let L2 = 0;
      L2 = Math.max(L2, (B[0] - A[0]) * (B[0] - A[0]) + (B[1] - A[1]) * (B[1] - A[1]));
      L2 = Math.max(L2, (C[0] - B[0]) * (C[0] - B[0]) + (C[1] - B[1]) * (C[1] - B[1]));
      L2 = Math.max(L2, (A[0] - C[0]) * (A[0] - C[0]) + (A[1] - C[1]) * (A[1] - C[1]));
      if (!(Math.abs(area2) > 1e-10 * L2)) continue;
      if (area2 < 0) [b, c] = [c, b];
      const g: Vec2 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
      if (enRejilla(g)) continue;
      let losa = -1;
      for (let k = 0; k < losas.length && losa < 0; k++) {
        const cj = cajas[k]!;
        if (g[0] < cj[0] || g[0] > cj[2] || g[1] < cj[1] || g[1] > cj[3]) continue;
        if (regionesIdx[k]!.dentro(g)) losa = k;
      }
      if (losa < 0) continue;
      const ancho = conAnchos ? anchoDe(g) : -1;
      if (ancho >= 0) enAncho.push({ v: [a, b, c], c: g, losa, ancho });
      else r.push({ v: [a, b, c], c: g, losa });
    }
    return r;
  };
  const falloCDT = triangular();
  if (falloCDT) return { ok: false, mensaje: falloCDT };
  let triangulos = quedan();

  // 3b. Refinamiento de Delaunay (G-4). La siembra sólo se gradúa a lo largo de los lados y la
  // retícula es de 2h, así que junto a un rasgo pequeño (la huella de un pilar, el cruce de una viga,
  // un borde que pasa cerca) la CDT unía segmentos de centímetros con puntos a metros: triángulos
  // agudos que dan cuadriláteros con el jacobiano casi nulo. Mientras un triángulo que se queda
  // (fuera de las huellas, que son rígidas) dé un cuadrilátero con el jacobiano escalado por debajo
  // de JACOBIANO_OBJETIVO, se añade su circuncentro; si éste cae en el círculo diametral de una
  // arista obligatoria, se parte esa arista por su punto medio (Ruppert), si es un tramo sembrado
  // por la CDT. Nada se refina por debajo de PISO·tamaño local: con eso el bucle acaba aunque haya
  // ángulos pequeños en el arreglo. Los candidatos de cada ronda se aceptan en el
  // orden de los ejes de la primera losa, así que la malla no depende de la posición de la planta.
  let rondas = 0;
  if (usarCDT && orden.length >= 3) {
    const celdaDe = (q: Vec2) => `${Math.floor(q[0] / s)},${Math.floor(q[1] / s)}`;
    // Lo que hay en las celdas a menos de `radio` de q (todas las que toca el cuadrado de lado 2·radio):
    // la respuesta no depende de cómo caen las celdas, así que tampoco de la posición de la planta
    const alrededor = <T>(m: Map<string, T[]>, q: Vec2, radio: number): T[] => {
      const r: T[] = [];
      for (let a = Math.floor((q[0] - radio) / s); a <= Math.floor((q[0] + radio) / s); a++)
        for (let b = Math.floor((q[1] - radio) / s); b <= Math.floor((q[1] + radio) / s); b++) for (const x of m.get(`${a},${b}`) ?? []) r.push(x);
      return r;
    };
    const meter = <T>(m: Map<string, T[]>, k: string, x: T) => {
      let v = m.get(k);
      if (!v) m.set(k, (v = []));
      v.push(x);
    };
    // Tamaño local: el de cada punto del arreglo es la distancia al punto o al lado más cercano que
    // no es suyo (≤ 2h), y crece con pendiente CRECIMIENTO; lo más que vale es 2h
    const fuentes = new Map<string, { q: Vec2; t: number }[]>();
    for (let p = 0; p < nPuntos; p++) {
      let t = tam[p]!;
      for (const i of celdas.get(celda(P[p]![0], P[p]![1])) ?? []) {
        if (i >= lados.length || lados[i]!.a === p || lados[i]!.b === p) continue;
        t = Math.min(t, distanciaASegmento(P[p]!, segs[i]![0], segs[i]![1]));
      }
      if (t < s) meter(fuentes, celdaDe(P[p]!), { q: P[p]!, t });
    }
    const tamano = (q: Vec2): number => {
      let t = s;
      for (const f of alrededor(fuentes, q, s / CRECIMIENTO)) {
        const dx = f.q[0] - q[0];
        const dy = f.q[1] - q[1];
        t = Math.min(t, f.t + CRECIMIENTO * Math.sqrt(dx * dx + dy * dy));
      }
      return t;
    };
    // Huellas de los pilares (rígidas: su malla no importa)
    const huellas = arreglo.trazos
      .filter((t) => t.tipo === "huella")
      .map((t) => {
        const contorno = t.puntos.map((i) => P[i]!);
        return { r: { contorno, huecos: [] } as Region, caja: cajaDe(contorno) };
      });
    const enHuella = (q: Vec2) => huellas.some((x) => !(q[0] < x.caja[0] || q[0] > x.caja[2] || q[1] < x.caja[1] || q[1] > x.caja[3]) && puntoEnRegion(q, x.r));
    const [e1x, e1y] = losas[0]!.eje1;
    const O = origenes[0]!;
    const cuanto = 1e-6 * s;
    const claveCanonica = (q: Vec2): [number, number] => {
      const [dx, dy] = [q[0] - O[0], q[1] - O[1]];
      return [Math.round((-dx * e1y + dy * e1x) / cuanto), Math.round((dx * e1x + dy * e1y) / cuanto)];
    };
    for (; rondas < RONDAS_MAXIMAS; rondas++) {
      // Aristas obligatorias y puntos de la CDT por celdas de 2h
      const aristasCelda = new Map<string, number[]>();
      restricciones.forEach(([p, q], i) => {
        const [A, B] = [P[p]!, P[q]!];
        for (let cx = Math.floor(Math.min(A[0], B[0]) / s); cx <= Math.floor(Math.max(A[0], B[0]) / s); cx++)
          for (let cy = Math.floor(Math.min(A[1], B[1]) / s); cy <= Math.floor(Math.max(A[1], B[1]) / s); cy++) meter(aristasCelda, `${cx},${cy}`, i);
      });
      // La mitad de la arista obligatoria más larga: el radio de búsqueda de los círculos diametrales
      let mediaMax = 0;
      for (const [p, q] of restricciones) mediaMax = Math.max(mediaMax, Math.sqrt((P[q]![0] - P[p]![0]) * (P[q]![0] - P[p]![0]) + (P[q]![1] - P[p]![1]) * (P[q]![1] - P[p]![1])) / 2);
      const puntosCelda = new Map<string, Vec2[]>();
      for (const p of orden) meter(puntosCelda, celdaDe(P[p]!), P[p]!);
      const candidatos: { q: Vec2; parte: number; r: number; k: [number, number] }[] = [];
      // Primero, los tramos sembrados con un punto dentro de su círculo diametral (invadidos): un
      // triángulo apoyado en ellos es agudo, y su circuncentro cae fuera de la losa
      restricciones.forEach(([p, q], i) => {
        const k = partible.get(p < q ? `${p},${q}` : `${q},${p}`);
        if (k === undefined) return;
        const [U, V] = [P[p]!, P[q]!];
        const m: Vec2 = [(U[0] + V[0]) / 2, (U[1] + V[1]) / 2];
        const r2 = ((V[0] - U[0]) * (V[0] - U[0]) + (V[1] - U[1]) * (V[1] - U[1])) / 4;
        // Con losa a un solo lado (la cara del ancho de una viga), sólo invade lo de ese lado: lo del
        // otro no forma láminas con el tramo (un extremo de una carga lineal dentro del ancho, a 4 cm de
        // la cara, la partía sin fin junto a él, fase LV)
        const la = conAnchos ? ladoA[k]! : null;
        const [LA, LB] = [P[lados[k]!.a]!, P[lados[k]!.b]!];
        const delLado = (o: Vec2) => {
          if (!la || la.iz === la.de) return true;
          const x = (LB[0] - LA[0]) * (o[1] - LA[1]) - (LB[1] - LA[1]) * (o[0] - LA[0]);
          return la.iz ? x > 0 : x < 0;
        };
        const invadido = alrededor(puntosCelda, m, Math.sqrt(r2)).some((o) => o !== U && o !== V && (o[0] - m[0]) * (o[0] - m[0]) + (o[1] - m[1]) * (o[1] - m[1]) < r2 * (1 - 1e-6) && delLado(o));
        if (invadido && (conAnchos ? ladoA[k]!.relevante : lados[k]!.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!)) || enLosa(m) >= 0)) candidatos.push({ q: m, parte: i, r: Math.sqrt(r2), k: claveCanonica(m) });
      });
      /** La arista obligatoria más cercana en cuyo círculo diametral cae q, o −1. */
      // A igual distancia (el centro de un rectángulo estrecho entre dos aristas paralelas, como el de
      // una zona de carga junto a la cara de una viga), la de menor clave canónica de su punto medio: el
      // orden de las celdas depende de la posición de la planta
      const claveArista = (i: number): [number, number] => {
        const [U, V] = [P[restricciones[i]![0]]!, P[restricciones[i]![1]]!];
        return claveCanonica([(U[0] + V[0]) / 2, (U[1] + V[1]) / 2]);
      };
      // Con las esquinas de LV2, las aristas obligatorias que no tocan losa no cuentan: el eje de una
      // viga dentro de su ancho es una arista sin sembrar de varios metros, y su círculo diametral
      // (de radio la mitad de su largo) tapaba todo circuncentro de la losa a esa distancia, así
      // que la triangulación junto a las vigas se quedaba sin refinar: abanicos de jacobiano 0,12
      // desde la cara de una viga curva (sembrada a 0,15–0,3 m) hasta la retícula de 2h (§18)
      const ignorada = (i: number) => {
        if (!refino?.esquinas) return false;
        const [p, q] = restricciones[i]!;
        return sinLosa.has(p < q ? `${p},${q}` : `${q},${p}`);
      };
      // Una arista que no se parte (la interfaz con la rejilla, un muro, una plantilla) no puede
      // seguir la regla de Ruppert: su círculo diametral (una arista de interfaz de 1,4 m tapa 0,7 m
      // de losa) dejaba sin refinar la franja de triangulación junto a las vigas. Con las esquinas de
      // LV2 sólo la protege de lo que de verdad la estropea: un punto que forme con ella un
      // triángulo malo (§18)
      const esPartible = (i: number) => {
        const [p, q] = restricciones[i]!;
        return partible.has(p < q ? `${p},${q}` : `${q},${p}`);
      };
      /** La arista obligatoria más cercana que q invade, o −1; `jacActual`, el del triángulo que se refina. */
      const invasora = (q: Vec2, jacActual: number): number => {
        let [i0, d0] = [-1, Infinity];
        for (const i of new Set(alrededor(aristasCelda, q, mediaMax))) {
          if (ignorada(i)) continue;
          const [U, V] = [P[restricciones[i]![0]]!, P[restricciones[i]![1]]!];
          const [mx, my] = [(U[0] + V[0]) / 2 - q[0], (U[1] + V[1]) / 2 - q[1]];
          const r2 = ((V[0] - U[0]) * (V[0] - U[0]) + (V[1] - U[1]) * (V[1] - U[1])) / 4;
          const d = mx * mx + my * my;
          if (!(d < r2 * (1 - 1e-6))) continue;
          if (refino?.esquinas && !esPartible(i)) {
            // Lo que q formaría con la arista: vale si llega al objetivo o si al menos mejora
            // MEJORA_MINIMA veces el triángulo que se refina (una estación de un muro con la esquina de
            // una huella a 14 cm: ningún punto llega al objetivo, pero sí a 0,25 desde 0,14)
            // (con los vértices en sentido antihorario: el jacobiano lleva signo)
            const j = (V[0] - U[0]) * (q[1] - U[1]) - (V[1] - U[1]) * (q[0] - U[0]) > 0 ? jacobianoTriangulo(U, V, q) : jacobianoTriangulo(V, U, q);
            if (!(j < JACOBIANO_OBJETIVO * (1 - 1e-6)) || !(j < MEJORA_MINIMA * jacActual)) continue;
          }
          if (i0 < 0 || d < d0 * (1 - 1e-9)) [i0, d0] = [i, d];
          else if (d <= d0 * (1 + 1e-9)) {
            const [a, b] = [claveArista(i), claveArista(i0)];
            if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) [i0, d0] = [i, Math.min(d, d0)];
          }
        }
        return i0;
      };
      for (const t of triangulos) {
        if (enHuella(t.c)) continue;
        const [A, B, C] = t.v.map(Q) as [Vec2, Vec2, Vec2];
        const [ax, ay, bx, by] = [B[0] - A[0], B[1] - A[1], C[0] - A[0], C[1] - A[1]];
        const d = 2 * (ax * by - ay * bx);
        const [la, lb] = [ax * ax + ay * ay, bx * bx + by * by];
        const cc: Vec2 = [A[0] + (by * la - ay * lb) / d, A[1] + (ax * lb - bx * la) / d];
        const R = Math.sqrt((cc[0] - A[0]) * (cc[0] - A[0]) + (cc[1] - A[1]) * (cc[1] - A[1]));
        const jacT = jacobianoTriangulo(A, B, C);
        if (!(jacT < JACOBIANO_OBJETIVO * (1 - 1e-6))) continue;
        const invade = invasora(cc, jacT);
        if (invade >= 0) {
          // Invade una arista: se parte, si es un tramo sembrado
          const [p, q] = restricciones[invade]!;
          if (partible.has(p < q ? `${p},${q}` : `${q},${p}`)) {
            const m: Vec2 = [(P[p]![0] + P[q]![0]) / 2, (P[p]![1] + P[q]![1]) / 2];
            const r = Math.sqrt((P[q]![0] - P[p]![0]) * (P[q]![0] - P[p]![0]) + (P[q]![1] - P[p]![1]) * (P[q]![1] - P[p]![1])) / 2;
            candidatos.push({ q: m, parte: invade, r, k: claveCanonica(m) });
            continue;
          }
        } else if (enLosa(cc) >= 0 && !enRejilla(cc) && !enHuella(cc)) {
          candidatos.push({ q: cc, parte: -1, r: R, k: claveCanonica(cc) });
          continue;
        }
        // Si el circuncentro no vale (invade una arista que no se parte: la interfaz con la rejilla,
        // un muro o una plantilla), el «off-center» (Üngör): sobre la mediatriz de la arista más
        // corta, hacia el triángulo, a la altura del equilátero sobre ella (o en el circuncentro, si
        // está más cerca)
        const lados3: [Vec2, Vec2, Vec2][] = [
          [A, B, C],
          [B, C, A],
          [C, A, B],
        ];
        const largo2 = (x: Vec2, y: Vec2) => (y[0] - x[0]) * (y[0] - x[0]) + (y[1] - x[1]) * (y[1] - x[1]);
        const [X1, X2, X3] = lados3.reduce((a, b) => (largo2(b[0], b[1]) < largo2(a[0], a[1]) ? b : a));
        const l = Math.sqrt(largo2(X1, X2));
        const M: Vec2 = [(X1[0] + X2[0]) / 2, (X1[1] + X2[1]) / 2];
        let [nx, ny] = [-(X2[1] - X1[1]) / l, (X2[0] - X1[0]) / l];
        if (nx * (X3[0] - M[0]) + ny * (X3[1] - M[1]) < 0) [nx, ny] = [-nx, -ny];
        const dist = Math.min((l * Math.sqrt(3)) / 2, Math.sqrt(largo2(M, cc)));
        const oc: Vec2 = [M[0] + nx * dist, M[1] + ny * dist];
        if (invasora(oc, jacT) < 0 && enLosa(oc) >= 0 && !enRejilla(oc) && !enHuella(oc)) candidatos.push({ q: oc, parte: -1, r: Math.sqrt(largo2(oc, X1)), k: claveCanonica(oc) });
      }
      // En el mismo sitio (a 1e-6·2h), primero la arista partida y luego el menor r: el orden no
      // depende del de los triángulos, que sí depende de la posición de la planta
      candidatos.sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1] || Number(y.parte >= 0) - Number(x.parte >= 0) || x.r - y.r);
      const aceptados: typeof candidatos = [];
      const nuevosCelda = new Map<string, Vec2[]>();
      for (const c of candidatos) {
        // Suelo: nada por debajo de PISO·tamaño local (con ángulos pequeños en el arreglo, Ruppert
        // no acaba). Separación: SEPARACION·r (r, el circunradio o media arista)
        if (c.r < PISO * tamano(c.q) * (1 - 1e-4)) continue;
        const dmin = SEPARACION * c.r;
        const cerca = (o: Vec2) => (o[0] - c.q[0]) * (o[0] - c.q[0]) + (o[1] - c.q[1]) * (o[1] - c.q[1]) < dmin * dmin * (1 - 1e-4);
        // Una arista invadida se parte siempre (Ruppert): su punto medio sólo se separa de los nuevos
        if ((c.parte < 0 && alrededor(puntosCelda, c.q, dmin).some(cerca)) || alrededor(nuevosCelda, c.q, dmin).some(cerca)) continue;
        aceptados.push(c);
        meter(nuevosCelda, celdaDe(c.q), c.q);
      }
      if (!aceptados.length) break;
      for (const c of aceptados) {
        P.push(c.q);
        origen.push(-1);
        enCDT.push(1);
        if (c.parte < 0) continue;
        // La arista partida: dos tramos sembrados, en la cadena de su lado
        const m = P.length - 1;
        const [p, q] = restricciones[c.parte]!;
        const viejo = p < q ? `${p},${q}` : `${q},${p}`;
        const k = partible.get(viejo)!;
        partible.delete(viejo);
        restringidas.delete(viejo);
        restricciones[c.parte] = [p, m];
        restricciones.push([m, q]);
        for (const [x, y] of [
          [p, m],
          [m, q],
        ] as const) {
          restringidas.add(x < y ? `${x},${y}` : `${y},${x}`);
          partible.set(x < y ? `${x},${y}` : `${y},${x}`, k);
        }
        const cad = cadenas[k]!;
        for (let i = 0; i + 1 < cad.length; i++)
          if ((cad[i] === p && cad[i + 1] === q) || (cad[i] === q && cad[i + 1] === p)) {
            cad.splice(i + 1, 0, m);
            break;
          }
      }
      const fallo = triangular();
      if (fallo) return { ok: false, mensaje: fallo };
      triangulos = quedan();
    }
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
      const nd = (x: number | [number, number]) => (typeof x === "number" ? vertice(x) : medio(x[0], x[1]));
      const X = (x: number | [number, number]): Vec2 => (typeof x === "number" ? Q(x) : [(Q(x[0])[0] + Q(x[1])[0]) / 2, (Q(x[0])[1] + Q(x[1])[1]) / 2]);
      for (const cq of pl.quads) {
          const v = cq.n.map((i) => red[i]!);
          const k = cq.losa;
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

  // Piezas en el ancho de las vigas (fase LV): sus triángulos, que no son láminas. En orden canónico,
  // como las láminas (centroide cuantizado): el de la triangulación cambia con un redondeo de la
  // entrada (un pilar girado difiere en un ulp entre V8 y JavaScriptCore), y con él el de sus cargas
  const cq = (x: number) => Math.round(x / CUANTO_ORDEN);
  const piezasAncho: PiezaAncho[] = enAncho
    .map((t) => {
      const v = t.v.map(Q);
      const area = ((v[1]![0] - v[0]![0]) * (v[2]![1] - v[0]![1]) - (v[1]![1] - v[0]![1]) * (v[2]![0] - v[0]![0])) / 2;
      return { v, c: t.c, area, losa: t.losa, ancho: t.ancho };
    })
    .sort((a, b) => cq(a.c[0]) - cq(b.c[0]) || cq(a.c[1]) - cq(b.c[1]) || a.losa - b.losa || a.ancho - b.ancho);

  // 6. Validador
  const problemas: ProblemaMalla[] = [];
  if (!conformes) problemas.push({ losa: -1, severidad: "error", codigo: "malla/conformidad", mensaje: "La rejilla y la triangulación no parten igual una arista de la interfaz. Es un fallo del compilador." });
  if (rj?.sinRefinar.length) problemas.push(avisoSinRefinar(rj.sinRefinar.map((k) => idHuella[k]!), "su plantilla no admite el refinamiento con calidad"));
  if (rj?.tirasSinPlantilla.length) {
    const ids = [...new Set(rj.tirasSinPlantilla.map((k) => idHuella[k]!))].sort();
    problemas.push({
      objetos: ids,
      losa: -1,
      severidad: "aviso",
      codigo: "malla/pilar-asoma-sin-plantilla",
      mensaje: `${ids.join(", ")} ${ids.length > 1 ? "asoman" : "asoma"} del ancho de la viga que ${ids.length > 1 ? "los" : "lo"} atraviesa y lo que asoma no cabe en una plantilla de la rejilla (hay un hueco, una carga u otro rasgo cerca): lo malla la triangulación, con elementos peores junto a sus caras. El cálculo es válido; revise las franjas en esas caras o baje el tamaño de malla.`,
    });
  }
  for (const triangulacion of [true, false]) {
    const ids = (rj?.esquinasSinRefinar ?? []).filter((x) => x.triangulacion === triangulacion).map((x) => refino?.idsHuellas?.[x.huella] ?? `#${x.huella}`);
    if (ids.length) problemas.push(avisoEsquinaSinRefinar(ids, triangulacion ? "una esquina de su cruce cae en la triangulación (junto a un hueco, una carga u otro rasgo que no sigue la rejilla)" : "la plantilla de esquina no cabe o no tiene calidad"));
  }
  if (rj?.tapadasSinRefinar.length) {
    const ids = [...new Set(rj.tapadasSinRefinar.map((m) => refino?.idsHuellas?.[m] ?? `#${m}`))].sort();
    problemas.push({
      objetos: ids,
      losa: -1,
      severidad: "aviso",
      codigo: "malla/pilar-tapado-sin-refinar",
      mensaje: `La malla de la losa junto a las caras de la viga delante de ${ids.join(", ")} (${ids.length > 1 ? "pilares que el ancho de su viga tapa" : "un pilar que el ancho de su viga tapa"}) no se ha refinado: alguna celda no sigue la rejilla (un hueco, una carga u otro rasgo cerca) o la plantilla no tiene calidad. Allí la losa apoya con un solo elemento en el tramo rígido de la cara, y con el tamaño de malla por defecto el metro del pilar perpendicular a la viga puede salir hasta un 20 % bajo. El cálculo es válido; revise ahí las franjas o baje el tamaño de malla.`,
    });
  }
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
    // El motor exige además que sea estrictamente convexo (un ángulo de 180° deja el jacobiano
    // positivo en los puntos de Gauss)
    let convexo = true;
    for (let m = 0; m < 4; m++) {
      const [A, B, C] = [X[m]!, X[(m + 1) % 4]!, X[(m + 2) % 4]!];
      if (!((B[0] - A[0]) * (C[1] - B[1]) - (B[1] - A[1]) * (C[0] - B[0]) > 0)) convexo = false;
    }
    if (j <= 0 || !convexo) malos[q.losa]!++;
    else if (j < JACOBIANO_BAJO) bajos++;
  }
  // Con anchos, sus piezas cuentan en el área de la losa en la que caen
  for (const pa of piezasAncho) areas[pa.losa]! += pa.area;
  losas.forEach((l, k) => {
    const A = momentosRegion(regiones[k]!).A;
    const e = Math.abs(areas[k]! - A) / A;
    if (!(e <= 1e-9))
      problemas.push({ losa: k, severidad: "error", codigo: "malla/area", mensaje: `La malla de la losa ${l.id}${conAnchos ? " (con el ancho de sus vigas)" : ""} no cubre su área: ${areas[k]!.toPrecision(10)} m² frente a ${A.toPrecision(10)} m² (error ${e.toExponential(2)}).` });
    if (malos[k]! > 0)
      problemas.push({ losa: k, severidad: "error", codigo: "malla/jacobiano", mensaje: `La malla de la losa ${l.id} tiene ${malos[k]} cuadriláteros con el jacobiano ≤ 0 o no convexos (invertidos o degenerados).` });
  });
  // Lados y puntos que tienen que estar en la malla
  // Con anchos: los lados que tocan losa, y los puntos dentro de ella o en esos lados
  const extremoRelevante = new Set<number>();
  if (conAnchos) lados.forEach((l, i) => ladoA[i]!.relevante && (extremoRelevante.add(l.a), extremoRelevante.add(l.b)));
  lados.forEach((l, i) => {
    if (nudosLado[i]!.length) return;
    const [A, B] = [P[l.a]!, P[l.b]!];
    const borde = l.trazos.some((t) => trazoLosa.has(arreglo.trazos[t]!));
    const k = conAnchos ? enRegion([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]) : enLosa([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]);
    if (conAnchos ? ladoA[i]!.relevante : borde || k >= 0)
      problemas.push({ losa: k, severidad: "error", codigo: "malla/lado-perdido", mensaje: `Un lado de ${l.trazos.map((t) => arreglo.trazos[t]!.id).join(", ")} entre (${A[0].toFixed(3)}, ${A[1].toFixed(3)}) y (${B[0].toFixed(3)}, ${B[1].toFixed(3)}) no es arista de la malla.` });
  });
  const usados = new Set(nudos.filter((n) => n.punto >= 0).map((n) => n.punto));
  arreglo.puntos.forEach((p, i) => {
    if (usados.has(i)) return;
    const k = conAnchos ? (extremoRelevante.has(i) || !puntoAncho.has(i) ? enRegion([p.x, p.y]) : -1) : enLosa([p.x, p.y]);
    if (k >= 0 && (!conAnchos || extremoRelevante.has(i) || enLosa([p.x, p.y]) >= 0))
      problemas.push({ losa: k, severidad: "error", codigo: "malla/punto-perdido", mensaje: `El punto (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) de la losa ${losas[k]!.id} no es vértice de la malla.` });
  });
  if (pasadas < 0) problemas.push({ losa: -1, severidad: "aviso", codigo: "malla/empates", mensaje: "Los empates de la triangulación no se han resuelto en 50 pasadas: la malla puede depender de la posición de la planta." });
  if (sinEmpates) problemas.push({ losa: -1, severidad: "aviso", codigo: "malla/empates", mensaje: "La triangulación de esta planta se ha hecho sin resolver los empates de Delaunay (hay rasgos casi degenerados: dos líneas a menos de ε_snap que se juntan con un ángulo muy pequeño): la malla puede depender de la posición de la planta. El cálculo es válido." });
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
    piezasAncho,
    lados,
    nudosLado,
    regiones,
    calidad: { jacobianoMin: quads.length ? jacobianoMin : 1, bajos },
    rejilla: { celdas: celdasRejilla, plantillas, refinadas: rj?.plantillas.filter((p) => p.refinada).length ?? 0, quads: quads.length - 3 * triangulos.length, cobertura: areaRejilla / Math.max(1e-300, areas.reduce((s, a) => s + a, 0)) },
    problemas,
  };
}
