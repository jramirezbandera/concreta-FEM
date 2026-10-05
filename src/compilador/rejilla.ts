/**
 * Rejilla alineada de las losas de una planta (H52, C2-a): las zonas regulares se mallan con
 * cuadriláteros de una rejilla en los ejes de la losa, y sólo el resto con la CDT de `mallado.ts`.
 *
 * 1. Ejes: los ejes 1-2 de la primera losa (u a lo largo del eje 1, v a lo largo del eje 2), con
 *    origen en su vértice canónico, así que la rejilla se traslada y gira con la planta.
 * 2. Líneas: cada lado del arreglo que toca una losa y va paralelo a un eje (a ≤ 10·ε_geom) propone
 *    su línea, con su longitud como prioridad (las de lados a ≤ 10·ε_geom se agrupan); el eje de
 *    cada huella rectangular alineada, con el doble de su lado, para que gane a sus caras. Dos
 *    líneas a menos de d_min no caben: se queda la más larga (y, a igual longitud, la de menor
 *    coordenada). Así un rasgo pequeño cerca de uno largo no llena la planta de franjas finas. Una
 *    línea larga (media planta o más) sólo cede a menos de d_min/4. Entre líneas, el hueco se reparte
 *    en partes iguales de ≤ 2h, y se añade un anillo de celdas alrededor.
 * 3. Nudos de la rejilla: un punto del arreglo a ≤ 10·ε_geom de un cruce de líneas es ese nudo. Un
 *    nudo sobre un lado de la rejilla va exactamente sobre él (el lado puede no ser del todo recto).
 * 4. Rasgos ajenos a la rejilla: los puntos que no son nudos, los lados que no van por una línea (y
 *    los de los ejes de los muros, ya sembrados). El trozo de un lado sobre una línea entre su
 *    extremo suelto y el primer nudo no cuenta: va por una sola arista, cuyas dos celdas ya son
 *    irregulares por el extremo.
 * 5. Plantillas de pilar: una huella rectangular alineada sin más rasgos cerca que los suyos se malla
 *    con una red de cuadriláteros. En cada dirección, la red va por las líneas de la rejilla del
 *    bloque de celdas que ocupa y, en cada celda, por la cara que cae dentro (a no más del 70 % de la
 *    celda desde la línea interior) o por su punto medio; una cara sobre una línea del borde del
 *    bloque necesita fuera de las losas al otro lado (un pilar de fachada enrasado). En el borde del
 *    bloque, los nudos son los de la rejilla partida; dentro, las esquinas de la huella, los puntos
 *    de sus caras sobre las líneas que la cruzan (por donde llegan las vigas) y, en el interior
 *    rígido, lo que haga falta. Sus celdas en una losa quedan cubiertas.
 * 6. Celdas: regular si su centro cae en una losa, no es del anillo y no tiene a menos de δ ningún
 *    rasgo ajeno (salvo los de una huella con plantilla), para que la CDT de al lado no tenga que unir
 *    un rasgo con una arista larga; fuera, si su centro no cae en una losa y no tiene rasgos cerca;
 *    irregular, el resto. Un grupo de menos de GRUPO_MINIMO celdas regulares seguidas, sin plantilla,
 *    vuelve a irregular: ahorra poco y obliga a la CDT a coserse a sus aristas. La CDT malla lo que no
 *    cubren las celdas regulares y las plantillas, y las aristas entre una celda cubierta y una
 *    irregular (la interfaz) son aristas obligatorias.
 * 7. División: cada celda regular se parte por los puntos medios de sus lados en 4, 2 o 1
 *    cuadriláteros. Un hueco de más de h se parte siempre; uno de ≤ h, sólo en los tramos de celdas
 *    cubiertas seguidas que tocan la interfaz o tienen una plantilla con una cara dentro, porque la
 *    CDT parte cada arista por su punto medio y un cuadrilátero con un nudo de más en un lado no
 *    existe (paridad). Así la malla es conforme: el punto medio de una arista de la interfaz es el
 *    mismo nudo a los dos lados.
 *
 * Puro y determinista; las comparaciones con umbral llevan holgura para que un ruido de ε_geom o el
 * redondeo de un giro no cambien la rejilla.
 */
import type { Vec2 } from "./fisico.ts";
import type { Region } from "./poligonos.ts";

/** Separación mínima entre dos líneas de la rejilla, en fracciones de h. */
export const SEPARACION_MINIMA = 0.4;

/**
 * Fracción de la planta que tiene que recorrer una línea para ser larga: una línea larga (la de una
 * viga de fachada a b/2 del borde) puede ir a d_min/4 de otra, porque la franja estrecha que deja
 * cuesta menos que mallar con la CDT todo lo que corre por ella.
 */
export const LINEA_LARGA = 0.5;

/** Distancia mínima de una celda regular a un rasgo ajeno a la rejilla (δ), en fracciones de 2h. */
export const HOLGURA_REJILLA = 0.45;

/** Distancia máxima de una cara de la huella al nudo N de su plantilla, en fracciones de su celda. */
export const CARA_PLANTILLA = 0.7;

/** Celdas regulares seguidas que hacen falta para que un grupo sin plantilla vaya en rejilla. */
export const GRUPO_MINIMO = 9;

/** Fracción de un umbral que se tolera para que un valor justo en él no dependa del redondeo. */
const HOLGURA = 1e-4;

export const FUERA = 0;
export const IRREGULAR = 1;
export const REGULAR = 2;
export const PLANTILLA = 3;

/** ¿Celda cubierta por la rejilla (regular o de una plantilla)? */
export const cubierta = (x: number) => x === REGULAR || x === PLANTILLA;

export interface EntradaRejilla {
  /** Puntos del arreglo. */
  P: readonly Vec2[];
  lados: readonly { a: number; b: number }[];
  /** Lados que tocan una losa (dentro o en su borde). */
  ladoEnLosa: readonly boolean[];
  /** Puntos que tocan una losa. */
  puntoEnLosa: readonly boolean[];
  /** Lados que no pueden ir por la rejilla (los de los ejes de los muros, ya sembrados). */
  fijos: readonly boolean[];
  /** Huellas de los pilares: sus puntos, en orden, y sus lados. */
  huellas: readonly { puntos: readonly number[]; lados: readonly number[] }[];
  regiones: readonly Region[];
  /** Losa que contiene un punto, o −1. */
  enLosa: (q: Vec2) => number;
  /** Origen y eje 1 de la rejilla. */
  O: Vec2;
  e: Vec2;
  h: number;
  epsGeom: number;
}

/** Lado del arreglo que va por una línea de la rejilla. */
export interface LadoEnLinea {
  /** true: por una línea de v constante (a lo largo del eje 1). */
  horizontal: boolean;
  linea: number;
  /** Nudos de la rejilla sobre él, de a a b (los extremos, si son nudos). */
  nudos: number[];
}

/** Nudo de la red de una plantilla. */
export type NudoPlantilla = { tipo: "nudo"; n: number } | { tipo: "medio"; n1: number; n2: number } | { tipo: "punto"; p: number } | { tipo: "nuevo"; q: Vec2 };

/**
 * Eje de la red de una plantilla en una dirección: línea del borde del bloque («b»), línea por dentro
 * de la huella («n»), cara de la huella dentro de una celda («f»), cara apoyada en una línea del
 * borde («bf») o punto medio de una celda sin cara (dentro de la huella, «m»).
 */
interface EjePlantilla {
  t: "b" | "n" | "f" | "bf" | "m";
  /** Línea de la rejilla, o −1 en una cara. */
  g: number;
  x: number;
}

interface ModoPlantilla {
  ejes: EjePlantilla[];
  /** Celdas del bloque en esta dirección. */
  celdas: number[];
  /** Celdas al otro lado de las caras apoyadas en una línea. */
  apoyo: number[];
}

export interface Plantilla {
  huella: number;
  /** Nudos de la red por ejes (A × B), a + A·b, con a a lo largo del eje 1. */
  A: number;
  B: number;
  red: NudoPlantilla[];
  /** Losa de cada cuadrilátero de la red (a + (A − 1)·b), o −1 fuera de las losas. */
  losas: number[];
  /** Anillo de la huella en la red (índices), en sentido antihorario. */
  anillo: number[];
  /** Aristas de la rejilla del borde con su punto medio en la red, y la losa de su celda. */
  bordes: { n1: number; n2: number; losa: number }[];
  /** Lados del arreglo de la huella. */
  huellaLados: readonly number[];
}

export interface Rejilla {
  /** Coordenadas de las líneas (u a lo largo del eje 1, v a lo largo del eje 2). */
  U: number[];
  V: number[];
  /** Estado de cada celda (i + j·(nu − 1)). */
  estado: Uint8Array;
  /** Losa de cada celda regular, o −1. */
  losa: Int32Array;
  /** Punto del arreglo que es cada nudo (i + j·nu), o −1. */
  puntoNudo: Int32Array;
  /** Nudo de la rejilla que es cada punto del arreglo, o −1. */
  nudoPunto: Int32Array;
  /** Puntos del arreglo que van dentro de una plantilla (no entran en la CDT). */
  absorbidos: Uint8Array;
  /** Por lado del arreglo: la línea por la que va, o null. */
  enLinea: (LadoEnLinea | null)[];
  /** Aristas de la interfaz (pares de nudos). */
  interfaz: [number, number][];
  plantillas: Plantilla[];
  posicion(n: number): Vec2;
  /** Celda que contiene un punto (interior), o −1. */
  celdaDe(q: Vec2): number;
  /** ¿El nudo es esquina de alguna celda en ese estado? */
  toca(n: number, estado: number): boolean;
  /** ¿El nudo es esquina de alguna celda cubierta? */
  cubre(n: number): boolean;
  /** Estados de las dos celdas de la arista entre dos nudos contiguos, o null si no lo son. */
  estadosArista(n1: number, n2: number): [number, number] | null;
  /** ¿Está partida la arista entre dos nudos contiguos? */
  partida(n1: number, n2: number): boolean;
}

/** Índice i con L[i] ≤ x < L[i + 1], o −1 / L.length − 1 fuera. */
function tramo(L: readonly number[], x: number): number {
  let lo = -1;
  let hi = L.length;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (L[m]! <= x) lo = m;
    else hi = m;
  }
  return lo;
}

/** Índice de la línea a ≤ tol de x, o −1. */
function lineaEn(L: readonly number[], x: number, tol: number): number {
  const i = tramo(L, x);
  if (i >= 0 && x - L[i]! <= tol) return i;
  if (i + 1 < L.length && L[i + 1]! - x <= tol) return i + 1;
  return -1;
}

/** Distancia de un segmento PQ (en u, v) al rectángulo [u0, u1] × [v0, v1]. */
function distanciaSegmentoRect(P: Vec2, Q: Vec2, u0: number, v0: number, u1: number, v1: number): number {
  // ¿Lo corta? (Liang–Barsky)
  const d: Vec2 = [Q[0] - P[0], Q[1] - P[1]];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-d[0], P[0] - u0],
    [d[0], u1 - P[0]],
    [-d[1], P[1] - v0],
    [d[1], v1 - P[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) t1 = -1;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  if (t1 >= t0) return 0;
  const aRect = (X: Vec2) => {
    const du = Math.max(u0 - X[0], 0, X[0] - u1);
    const dv = Math.max(v0 - X[1], 0, X[1] - v1);
    return Math.sqrt(du * du + dv * dv);
  };
  const aSeg = (X: Vec2) => {
    const L2 = d[0] * d[0] + d[1] * d[1];
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((X[0] - P[0]) * d[0] + (X[1] - P[1]) * d[1]) / L2)) : 0;
    const dx = P[0] + t * d[0] - X[0];
    const dy = P[1] + t * d[1] - X[1];
    return Math.sqrt(dx * dx + dy * dy);
  };
  return Math.min(aRect(P), aRect(Q), aSeg([u0, v0]), aSeg([u1, v0]), aSeg([u1, v1]), aSeg([u0, v1]));
}

/**
 * Líneas de una dirección: agrupadas, elegidas por prioridad, repartidas a ≤ s y con anillo. Una
 * línea larga (de al menos la mitad de `extension`) sólo cede ante otra a menos de d_min/4.
 */
function lineas(cand: { c: number; L: number }[], tol: number, dMin: number, s: number, extension: number): number[] {
  if (!cand.length) return [];
  cand.sort((x, y) => x.c - y.c);
  // Grupos de candidatos a ≤ tol: la media ponderada por longitud y la longitud total
  const grupos: { c: number; L: number }[] = [];
  for (let k = 0; k < cand.length; ) {
    let m = k;
    let suma = 0;
    let L = 0;
    do {
      suma += cand[m]!.c * cand[m]!.L;
      L += cand[m]!.L;
      m++;
    } while (m < cand.length && cand[m]!.c - cand[m - 1]!.c <= tol);
    grupos.push({ c: suma / L, L });
    k = m;
  }
  // Una línea cede ante otra más larga a menos de d_min (a igual longitud, ante la de menor c)
  const tolL = 1e-4;
  const cede = (k: number, o: number) => grupos[o]!.L > grupos[k]!.L + tolL || (Math.abs(grupos[o]!.L - grupos[k]!.L) <= tolL && o < k);
  const elegidas: number[] = [];
  grupos.forEach((g, k) => {
    const lejos = (g.L >= LINEA_LARGA * extension ? dMin / 4 : dMin) * (1 - HOLGURA);
    for (let o = k - 1; o >= 0 && g.c - grupos[o]!.c < lejos; o--) if (cede(k, o)) return;
    for (let o = k + 1; o < grupos.length && grupos[o]!.c - g.c < lejos; o++) if (cede(k, o)) return;
    elegidas.push(g.c);
  });
  const r = [elegidas[0]! - s];
  for (let k = 0; k < elegidas.length; k++) {
    r.push(elegidas[k]!);
    if (k + 1 === elegidas.length) break;
    const g = elegidas[k + 1]! - elegidas[k]!;
    const n = Math.max(1, Math.ceil(g / s - HOLGURA));
    for (let m = 1; m < n; m++) r.push(elegidas[k]! + (g * m) / n);
  }
  r.push(elegidas[elegidas.length - 1]! + s);
  return r;
}

/** Rectángulo alineado de una huella en (u, v): su caja y la esquina de cada uno de sus puntos. */
function rectanguloHuella(W: readonly Vec2[], puntos: readonly number[], tol: number): { u0: number; v0: number; u1: number; v1: number } | null {
  let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of puntos) [u0, v0, u1, v1] = [Math.min(u0, W[p]![0]), Math.min(v0, W[p]![1]), Math.max(u1, W[p]![0]), Math.max(v1, W[p]![1])];
  if (!(u1 - u0 > 2 * tol && v1 - v0 > 2 * tol)) return null;
  // Todos sus puntos en el borde de la caja y sus cuatro esquinas entre ellos
  const esquinas = [0, 0, 0, 0];
  for (const p of puntos) {
    const [u, v] = W[p]!;
    const bu = Math.abs(u - u0) <= tol || Math.abs(u - u1) <= tol;
    const bv = Math.abs(v - v0) <= tol || Math.abs(v - v1) <= tol;
    if (!bu && !bv) return null;
    if (bu && bv) esquinas[(Math.abs(u - u0) <= tol ? 0 : 1) + (Math.abs(v - v0) <= tol ? 0 : 2)]++;
  }
  return esquinas.every((x) => x === 1) ? { u0, v0, u1, v1 } : null;
}

/** Rejilla de una planta, o null si no tiene ninguna celda cubierta. */
export function rejillaPlanta(E: EntradaRejilla): Rejilla | null {
  const { P, lados, h, O, e } = E;
  const s = 2 * h;
  const tol = 10 * E.epsGeom;
  const delta = HOLGURA_REJILLA * s;
  const uv = (q: Vec2): Vec2 => {
    const dx = q[0] - O[0];
    const dy = q[1] - O[1];
    return [dx * e[0] + dy * e[1], -dx * e[1] + dy * e[0]];
  };
  const xy = (u: number, v: number): Vec2 => [O[0] + u * e[0] - v * e[1], O[1] + u * e[1] + v * e[0]];
  const W = P.map(uv);

  // 2. Líneas
  const candU: { c: number; L: number }[] = [];
  const candV: { c: number; L: number }[] = [];
  lados.forEach((l, k) => {
    if (!E.ladoEnLosa[k] || E.fijos[k]) return;
    const [A, B] = [W[l.a]!, W[l.b]!];
    const du = Math.abs(A[0] - B[0]);
    const dv = Math.abs(A[1] - B[1]);
    if (dv <= tol && du > tol) candV.push({ c: (A[1] + B[1]) / 2, L: du });
    else if (du <= tol && dv > tol) candU.push({ c: (A[0] + B[0]) / 2, L: dv });
  });
  const rects = E.huellas.map((hh) => (hh.puntos.some((p) => E.puntoEnLosa[p]) ? rectanguloHuella(W, hh.puntos, tol) : null));
  for (const r of rects) {
    if (!r) continue;
    candU.push({ c: (r.u0 + r.u1) / 2, L: 2 * (r.v1 - r.v0) });
    candV.push({ c: (r.v0 + r.v1) / 2, L: 2 * (r.u1 - r.u0) });
  }
  const dMin = SEPARACION_MINIMA * h;
  // Extensión de lo que toca las losas en cada dirección
  let [eu0, ev0, eu1, ev1] = [Infinity, Infinity, -Infinity, -Infinity];
  W.forEach(([u, v], p) => {
    if (E.puntoEnLosa[p]) [eu0, ev0, eu1, ev1] = [Math.min(eu0, u), Math.min(ev0, v), Math.max(eu1, u), Math.max(ev1, v)];
  });
  const U = lineas(candU, tol, dMin, s, ev1 - ev0);
  const V = lineas(candV, tol, dMin, s, eu1 - eu0);
  const nu = U.length;
  const nv = V.length;
  if (nu < 4 || nv < 4) return null;
  const nc = (nu - 1) * (nv - 1);
  const celda = (i: number, j: number) => i + j * (nu - 1);

  // 3. Nudos que son puntos del arreglo
  const puntoNudo = new Int32Array(nu * nv).fill(-1);
  const nudoPunto = new Int32Array(P.length).fill(-1);
  P.forEach((_, p) => {
    if (!E.puntoEnLosa[p]) return;
    const i = lineaEn(U, W[p]![0], tol);
    const j = lineaEn(V, W[p]![1], tol);
    if (i < 0 || j < 0) return;
    puntoNudo[i + j * nu] = p;
    nudoPunto[p] = i + j * nu;
  });

  // 4. Lados por las líneas y rasgos ajenos a la rejilla, con su huella (−2 si no son de una)
  const huellaDePunto = new Int32Array(P.length).fill(-2);
  const huellaDeLado = new Int32Array(lados.length).fill(-2);
  E.huellas.forEach((hh, k) => {
    for (const p of hh.puntos) huellaDePunto[p] = huellaDePunto[p] === -2 ? k : -3;
    for (const l of hh.lados) huellaDeLado[l] = huellaDeLado[l] === -2 ? k : -3;
  });
  const ajenos: { A: Vec2; B: Vec2; huella: number }[] = [];
  P.forEach((_, p) => {
    if (E.puntoEnLosa[p] && nudoPunto[p]! < 0) ajenos.push({ A: W[p]!, B: W[p]!, huella: Math.max(-2, huellaDePunto[p]!) });
  });
  const nudoEnLado = new Map<number, number>();
  const enLinea: (LadoEnLinea | null)[] = lados.map((l, k) => {
    if (!E.ladoEnLosa[k]) return null;
    const [A, B] = [W[l.a]!, W[l.b]!];
    const ajeno = (): null => (ajenos.push({ A, B, huella: Math.max(-2, huellaDeLado[k]!) }), null);
    if (E.fijos[k]) return ajeno();
    // horizontal: v constante; c es la coordenada a lo largo del lado
    let horizontal: boolean;
    let linea: number;
    if (Math.abs(A[1] - B[1]) <= tol && (linea = lineaEn(V, A[1], tol)) >= 0 && lineaEn(V, B[1], tol) === linea) horizontal = true;
    else if (Math.abs(A[0] - B[0]) <= tol && (linea = lineaEn(U, A[0], tol)) >= 0 && lineaEn(U, B[0], tol) === linea) horizontal = false;
    else return ajeno();
    const L = horizontal ? U : V;
    const c = (X: Vec2) => (horizontal ? X[0] : X[1]);
    const nudo = (m: number) => (horizontal ? m + linea * nu : linea + m * nu);
    const [ca, cb] = [c(A), c(B)];
    // Nudos estrictamente entre los extremos
    const interiores: number[] = [];
    const [lo, hi] = cb > ca ? [ca, cb] : [cb, ca];
    for (let m = tramo(L, lo + tol) + 1; m < L.length && L[m]! < hi - tol; m++) interiores.push(m);
    if (cb < ca) interiores.reverse();
    const ea = nudoPunto[l.a]!;
    const eb = nudoPunto[l.b]!;
    // Un extremo que no es nudo es ya un rasgo ajeno (un punto), y el trozo hasta el primer nudo va
    // por una sola arista de la rejilla, cuyas dos celdas ya son irregulares por él: el trozo no
    // añade nada. Un lado sin nudos dentro y con un extremo suelto va entero por la CDT.
    if (!interiores.length && (ea < 0 || eb < 0)) return null;
    for (const m of interiores) nudoEnLado.set(nudo(m), k);
    return { horizontal, linea, nudos: [...(ea >= 0 ? [ea] : []), ...interiores.map(nudo), ...(eb >= 0 ? [eb] : [])] };
  });

  // Celdas con rasgos ajenos a menos de δ: −1 ninguno, k sólo de la huella k, −2 otros
  const cerca = new Int32Array(nc).fill(-1);
  for (const { A, B, huella } of ajenos) {
    const i0 = Math.max(0, tramo(U, Math.min(A[0], B[0]) - delta));
    const i1 = Math.min(nu - 2, tramo(U, Math.max(A[0], B[0]) + delta));
    const j0 = Math.max(0, tramo(V, Math.min(A[1], B[1]) - delta));
    const j1 = Math.min(nv - 2, tramo(V, Math.max(A[1], B[1]) + delta));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = celda(i, j);
        if (cerca[c] === -2 || cerca[c] === huella) continue;
        if (distanciaSegmentoRect(A, B, U[i]!, V[j]!, U[i + 1]!, V[j + 1]!) < delta) cerca[c] = cerca[c] === -1 ? huella : -2;
      }
  }
  const losaCelda = new Int32Array(nc);
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) losaCelda[celda(i, j)] = E.enLosa(xy((U[i]! + U[i + 1]!) / 2, (V[j]! + V[j + 1]!) / 2));
  const anillo = (i: number, j: number) => i <= 0 || j <= 0 || i >= nu - 2 || j >= nv - 2;

  // 5. Plantillas de pilar
  const ancho = h * (1 + HOLGURA);
  const cara = CARA_PLANTILLA * (1 - HOLGURA);
  /**
   * Ejes de la red de una plantilla en una dirección: las líneas de la rejilla del bloque (de la
   * última por debajo de la huella a la primera por encima) y, en cada celda, la cara que cae dentro
   * (a no más del 70 % de la celda de la línea interior) o, si no hay ninguna, su punto medio. Una
   * cara sobre una línea del borde se apoya en ella: al otro lado tiene que estar fuera de las losas.
   */
  const ejesDe = (L: readonly number[], f0: number, f1: number): ModoPlantilla | null => {
    const lo = tramo(L, f0 + tol);
    const hi = tramo(L, f1 - tol) + 1;
    if (lo < 0 || hi > L.length - 1 || hi <= lo) return null;
    const ejes: EjePlantilla[] = [];
    const apoyo: number[] = [];
    for (let m = lo; m <= hi; m++) {
      const cara0 = m === lo && Math.abs(L[m]! - f0) <= tol;
      const cara1 = m === hi && Math.abs(L[m]! - f1) <= tol;
      ejes.push({ t: m === lo || m === hi ? (cara0 || cara1 ? "bf" : "b") : "n", g: m, x: cara0 ? f0 : cara1 ? f1 : L[m]! });
      if (cara0) apoyo.push(m - 1);
      if (cara1) apoyo.push(m);
      if (m === hi) break;
      const dentro = [f0, f1].filter((f) => f > L[m]! + tol && f < L[m + 1]! - tol);
      if (dentro.length > 1) return null;
      if (dentro.length) {
        const f = dentro[0]!;
        // Desde la línea interior de la celda (la que cae dentro de la huella)
        if (!((f === f0 ? L[m + 1]! - f : f - L[m]!) <= cara * (L[m + 1]! - L[m]!))) return null;
        ejes.push({ t: "f", g: -1, x: f });
      } else ejes.push({ t: "m", g: -1, x: (L[m]! + L[m + 1]!) / 2 });
    }
    const celdas: number[] = [];
    for (let m = lo; m < hi; m++) celdas.push(m);
    return { ejes, celdas, apoyo };
  };
  const candidatas: { k: number; mu: ModoPlantilla; mv: ModoPlantilla }[] = [];
  rects.forEach((r, k) => {
    if (!r) return;
    const mu = ejesDe(U, r.u0, r.u1);
    const mv = ejesDe(V, r.v0, r.v1);
    if (!mu || !mv) return;
    // Sus puntos: las esquinas y los de sus caras sobre las líneas que la cruzan
    const enLinea = (m: ModoPlantilla, x: number) => m.ejes.some((e) => e.t === "n" && Math.abs(e.x - x) <= tol);
    for (const p of E.huellas[k]!.puntos) {
      const [u, v] = W[p]!;
      const bu = Math.abs(u - r.u0) <= tol || Math.abs(u - r.u1) <= tol;
      const bv = Math.abs(v - r.v0) <= tol || Math.abs(v - r.v1) <= tol;
      if (!(bu && bv) && !(bv && enLinea(mu, u)) && !(bu && enLinea(mv, v))) return;
    }
    // Sus celdas: en una losa y fuera del anillo, o fuera de las losas (un pilar de borde a ejes), y
    // sin más rasgos cerca que los de la huella
    let enLosa = 0;
    for (const a of mu.celdas)
      for (const b of mv.celdas) {
        const c = celda(a, b);
        if (cerca[c] !== -1 && cerca[c] !== k) return;
        if (losaCelda[c]! >= 0) {
          if (anillo(a, b)) return;
          enLosa++;
        }
      }
    // Al otro lado de una cara apoyada en una línea, fuera de las losas (un pilar de fachada enrasado)
    const dentroDeLosa = (a: number, b: number) => a >= 0 && b >= 0 && a <= nu - 2 && b <= nv - 2 && losaCelda[celda(a, b)]! >= 0;
    if (mu.apoyo.some((a) => mv.celdas.some((b) => dentroDeLosa(a, b)))) return;
    if (mv.apoyo.some((b) => mu.celdas.some((a) => dentroDeLosa(a, b)))) return;
    if (enLosa) candidatas.push({ k, mu, mv });
  });
  // Dos bloques que se solapan se quedan sin plantilla
  const uso = new Uint8Array(nc);
  const bloque = (x: { mu: ModoPlantilla; mv: ModoPlantilla }) => x.mu.celdas.flatMap((a) => x.mv.celdas.map((b) => celda(a, b)));
  for (const x of candidatas) for (const c of bloque(x)) uso[c]!++;
  const conPlantilla = new Uint8Array(E.huellas.length);
  const estado = new Uint8Array(nc);
  const elegidas = candidatas.filter((x) => bloque(x).every((c) => uso[c] === 1));
  for (const x of elegidas) {
    conPlantilla[x.k] = 1;
    for (const c of bloque(x)) if (losaCelda[c]! >= 0) estado[c] = PLANTILLA;
  }

  // 6. Estados
  const losa = new Int32Array(nc).fill(-1);
  let cubiertas = 0;
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const c = celda(i, j);
      const k = losaCelda[c]!;
      if (estado[c] === PLANTILLA) {
        losa[c] = k;
        cubiertas++;
        continue;
      }
      const limpia = cerca[c] === -1 || (cerca[c]! >= 0 && conPlantilla[cerca[c]!] === 1);
      if (k >= 0 && !anillo(i, j) && limpia) {
        estado[c] = REGULAR;
        losa[c] = k;
        cubiertas++;
      } else estado[c] = k < 0 && limpia ? FUERA : IRREGULAR;
    }
  // Los grupos de menos de GRUPO_MINIMO celdas regulares seguidas (sin plantilla) van por la CDT:
  // ahorran poco y obligan a la CDT a coserse a sus aristas
  const grupo = new Int32Array(nc).fill(-1);
  for (let c0 = 0; c0 < nc; c0++) {
    if (estado[c0] !== REGULAR || grupo[c0]! >= 0) continue;
    const pila = [c0];
    const celdas: number[] = [];
    grupo[c0] = c0;
    let plantilla = false;
    while (pila.length) {
      const c = pila.pop()!;
      celdas.push(c);
      const [i, j] = [c % (nu - 1), Math.floor(c / (nu - 1))];
      for (const [a, b] of [
        [i - 1, j],
        [i + 1, j],
        [i, j - 1],
        [i, j + 1],
      ] as const) {
        if (a < 0 || b < 0 || a > nu - 2 || b > nv - 2) continue;
        const d = celda(a, b);
        if (estado[d] === PLANTILLA) plantilla = true;
        if (estado[d] === REGULAR && grupo[d]! < 0) {
          grupo[d] = c0;
          pila.push(d);
        }
      }
    }
    if (!plantilla && celdas.length < GRUPO_MINIMO)
      for (const c of celdas) {
        estado[c] = IRREGULAR;
        losa[c] = -1;
        cubiertas--;
      }
  }
  if (!cubiertas) return null;
  const est = (i: number, j: number) => (i < 0 || j < 0 || i > nu - 2 || j > nv - 2 ? FUERA : estado[celda(i, j)]!);

  // Interfaz: aristas entre una celda cubierta y una irregular
  const interfaz: [number, number][] = [];
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      if (!cubierta(est(i, j))) continue;
      const n = i + j * nu;
      if (est(i, j - 1) === IRREGULAR) interfaz.push([n, n + 1]);
      if (est(i, j + 1) === IRREGULAR) interfaz.push([n + nu, n + nu + 1]);
      if (est(i - 1, j) === IRREGULAR) interfaz.push([n, n + nu]);
      if (est(i + 1, j) === IRREGULAR) interfaz.push([n + 1, n + nu + 1]);
    }

  // 7. División: por huecos anchos, por tramos de celdas cubiertas que tocan la interfaz o por las
  // celdas de una plantilla con una cara dentro (en esa dirección)
  const caraU = new Uint8Array(nc);
  const caraV = new Uint8Array(nc);
  const conCara = (m: ModoPlantilla) => {
    const r: number[] = [];
    let q = -1;
    for (const e of m.ejes) {
      if (e.t !== "f" && e.t !== "m") q++;
      else if (e.t === "f") r.push(m.celdas[q]!);
    }
    return r;
  };
  for (const { mu, mv } of elegidas) {
    for (const a of conCara(mu)) for (const b of mv.celdas) caraU[celda(a, b)] = 1;
    for (const b of conCara(mv)) for (const a of mu.celdas) caraV[celda(a, b)] = 1;
  }
  const partidaH = new Uint8Array((nu - 1) * nv);
  const partidaV = new Uint8Array(nu * (nv - 1));
  for (let i = 0; i < nu - 1; i++) {
    const siempre = U[i + 1]! - U[i]! > ancho;
    for (let j = 0; j < nv - 1; ) {
      if (!cubierta(est(i, j))) {
        j++;
        continue;
      }
      let j1 = j;
      while (cubierta(est(i, j1 + 1))) j1++;
      let p = siempre || est(i, j - 1) === IRREGULAR || est(i, j1 + 1) === IRREGULAR;
      for (let m = j; m <= j1 && !p; m++) p = caraU[celda(i, m)] === 1;
      for (let m = j; m <= j1 + 1; m++) partidaH[i + m * (nu - 1)] = p ? 1 : 0;
      j = j1 + 1;
    }
  }
  for (let j = 0; j < nv - 1; j++) {
    const siempre = V[j + 1]! - V[j]! > ancho;
    for (let i = 0; i < nu - 1; ) {
      if (!cubierta(est(i, j))) {
        i++;
        continue;
      }
      let i1 = i;
      while (cubierta(est(i1 + 1, j))) i1++;
      let p = siempre || est(i - 1, j) === IRREGULAR || est(i1 + 1, j) === IRREGULAR;
      for (let m = i; m <= i1 && !p; m++) p = caraV[celda(m, j)] === 1;
      for (let m = i; m <= i1 + 1; m++) partidaV[m + j * nu] = p ? 1 : 0;
      i = i1 + 1;
    }
  }

  // Redes de las plantillas
  const absorbidos = new Uint8Array(P.length);
  const enRejilla = (x: EjePlantilla) => x.t !== "f" && x.t !== "m";
  /** Celda (en una dirección) del cuadrilátero a de la red: la de la última línea de la rejilla ≤ a. */
  const celdaEje = (m: ModoPlantilla, a: number) => m.celdas[m.ejes.slice(0, a + 1).filter(enRejilla).length - 1]!;
  const plantillas: Plantilla[] = elegidas.map(({ k, mu: mu0, mv: mv0 }) => {
    // El punto medio de una celda sin cara, sólo si su tramo va partido (en el borde del bloque es el
    // punto medio de la arista de la rejilla)
    const [jb, ib] = [mv0.ejes[0]!.g, mu0.ejes[0]!.g];
    let q = -1;
    const mu = { ...mu0, ejes: mu0.ejes.filter((e) => (e.t !== "f" && e.t !== "m" ? (q++, true) : e.t === "f" || partidaH[mu0.celdas[q]! + jb * (nu - 1)] === 1)) };
    q = -1;
    const mv = { ...mv0, ejes: mv0.ejes.filter((e) => (e.t !== "f" && e.t !== "m" ? (q++, true) : e.t === "f" || partidaV[ib + mv0.celdas[q]! * nu] === 1)) };
    const r = rects[k]!;
    const pts = E.huellas[k]!.puntos;
    for (const p of pts) absorbidos[p] = 1;
    const [A, B] = [mu.ejes.length, mv.ejes.length];
    const g = (eu: EjePlantilla, ev: EjePlantilla) => eu.g + ev.g * nu;
    const punto = (u: number, v: number) => pts.find((p) => Math.abs(W[p]![0] - u) <= tol && Math.abs(W[p]![1] - v) <= tol);
    // Un punto del borde de la huella: el suyo, si lo hay, o uno nuevo sobre su cara, entre sus esquinas
    const enCara = (u: number, v: number): NudoPlantilla => {
      const p = punto(u, v);
      if (p !== undefined) return { tipo: "punto", p };
      const horizontal = Math.abs(v - r.v0) <= tol || Math.abs(v - r.v1) <= tol;
      const [p0, p1] = horizontal ? [punto(r.u0, v)!, punto(r.u1, v)!] : [punto(u, r.v0)!, punto(u, r.v1)!];
      const t = horizontal ? (u - r.u0) / (r.u1 - r.u0) : (v - r.v0) / (r.v1 - r.v0);
      return { tipo: "nuevo", q: [P[p0]![0] + t * (P[p1]![0] - P[p0]![0]), P[p0]![1] + t * (P[p1]![1] - P[p0]![1])] };
    };
    const red: NudoPlantilla[] = [];
    const bordes: Plantilla["bordes"] = [];
    const losaCuad = (a: number, b: number) => losa[celda(celdaEje(mu, Math.min(a, A - 2)), celdaEje(mv, Math.min(b, B - 2)))]!;
    for (let b = 0; b < B; b++)
      for (let a = 0; a < A; a++) {
        const [eu, ev] = [mu.ejes[a]!, mv.ejes[b]!];
        if (enRejilla(eu) && enRejilla(ev)) red.push({ tipo: "nudo", n: g(eu, ev) });
        else if (ev.t === "b") {
          // En el borde del bloque, el punto medio de la arista de la rejilla
          const [n1, n2] = [g(mu.ejes[a - 1]!, ev), g(mu.ejes[a + 1]!, ev)];
          red.push({ tipo: "medio", n1, n2 });
          bordes.push({ n1, n2, losa: losaCuad(a, b) });
        } else if (eu.t === "b") {
          const [n1, n2] = [g(eu, mv.ejes[b - 1]!), g(eu, mv.ejes[b + 1]!)];
          red.push({ tipo: "medio", n1, n2 });
          bordes.push({ n1, n2, losa: losaCuad(a, b) });
        } else {
          // En la huella: en su borde, un punto de su cara; dentro (todo rígido), uno nuevo
          const [u, v] = [eu.x, ev.x];
          const borde = Math.abs(u - r.u0) <= tol || Math.abs(u - r.u1) <= tol || Math.abs(v - r.v0) <= tol || Math.abs(v - r.v1) <= tol;
          red.push(borde ? enCara(u, v) : { tipo: "nuevo", q: xy(u, v) });
        }
      }
    const losas: number[] = [];
    for (let b = 0; b < B - 1; b++) for (let a = 0; a < A - 1; a++) losas.push(losaCuad(a, b));
    // Anillo de la huella: el borde del rectángulo de la red entre sus caras
    const cara_ = (x: EjePlantilla) => x.t === "f" || x.t === "bf";
    const [a0, a1] = [mu.ejes.findIndex(cara_), mu.ejes.findLastIndex(cara_)];
    const [b0, b1] = [mv.ejes.findIndex(cara_), mv.ejes.findLastIndex(cara_)];
    const anilloH: number[] = [];
    for (let a = a0; a < a1; a++) anilloH.push(a + A * b0);
    for (let b = b0; b < b1; b++) anilloH.push(a1 + A * b);
    for (let a = a1; a > a0; a--) anilloH.push(a + A * b1);
    for (let b = b1; b > b0; b--) anilloH.push(a0 + A * b);
    return { huella: k, A, B, red, losas, anillo: anilloH, bordes, huellaLados: E.huellas[k]!.lados };
  });

  const posicion = (n: number): Vec2 => {
    const p = puntoNudo[n]!;
    if (p >= 0) return P[p]!;
    const [i, j] = [n % nu, Math.floor(n / nu)];
    const k = nudoEnLado.get(n);
    if (k !== undefined) {
      // Exactamente sobre el lado
      const l = lados[k]!;
      const [A, B] = [P[l.a]!, P[l.b]!];
      const [WA, WB] = [W[l.a]!, W[l.b]!];
      const t = enLinea[k]!.horizontal ? (U[i]! - WA[0]) / (WB[0] - WA[0]) : (V[j]! - WA[1]) / (WB[1] - WA[1]);
      return [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
    }
    return xy(U[i]!, V[j]!);
  };
  const celdaDe = (q: Vec2): number => {
    const [u, v] = uv(q);
    const i = tramo(U, u);
    const j = tramo(V, v);
    return i < 0 || j < 0 || i > nu - 2 || j > nv - 2 ? -1 : celda(i, j);
  };
  const alrededor = (n: number) => {
    const [i, j] = [n % nu, Math.floor(n / nu)];
    return [est(i - 1, j - 1), est(i, j - 1), est(i - 1, j), est(i, j)];
  };
  const toca = (n: number, x: number): boolean => alrededor(n).includes(x);
  const cubre = (n: number): boolean => alrededor(n).some(cubierta);
  const estadosArista = (n1: number, n2: number): [number, number] | null => {
    const n = Math.min(n1, n2);
    const [i, j] = [n % nu, Math.floor(n / nu)];
    if (Math.abs(n1 - n2) === 1 && i < nu - 1) return [est(i, j - 1), est(i, j)];
    if (Math.abs(n1 - n2) === nu) return [est(i - 1, j), est(i, j)];
    return null;
  };
  const partida = (n1: number, n2: number): boolean => {
    const n = Math.min(n1, n2);
    const [i, j] = [n % nu, Math.floor(n / nu)];
    return Math.abs(n1 - n2) === 1 ? partidaH[i + j * (nu - 1)] === 1 : partidaV[i + j * nu] === 1;
  };
  return { U, V, estado, losa, puntoNudo, nudoPunto, absorbidos, enLinea, interfaz, plantillas, posicion, celdaDe, toca, cubre, estadosArista, partida };
}
