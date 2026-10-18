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
 *    bloque necesita fuera de las losas al otro lado (un pilar de fachada enrasado), salvo que esa
 *    línea sea la de una cara de banda (un trazo exacto, C5-g): entonces el bloque crece una celda
 *    más allá y la cara va por dentro, por la línea, que sigue recta de lado a lado. En el borde del
 *    bloque, los nudos son los de la rejilla partida; dentro, las esquinas de la huella, los puntos
 *    de sus caras sobre las líneas que la cruzan (por donde llegan las vigas) y, en el interior
 *    rígido, lo que haga falta. Sus celdas en una losa quedan cubiertas.
 *    Refinamiento (F2): junto a cada cara de un pilar de las franjas (`refino`), el primer tramo de
 *    la red se parte en tercios (PARTICION_REFINO) a lo largo de la huella (la cruz); el cuadrilátero
 *    de cada esquina va también en tercios si la transición cabe más allá dentro del bloque (la de 3
 *    a 1 en el siguiente) o fuera hay sólo celdas fuera de las losas, y si no lleva él la transición
 *    (la de esquina, de 5 cuadriláteros, o la de 3 a 1). El borde del bloque no cambia, así que la
 *    costura con la rejilla y la CDT es la de siempre. Los nudos nuevos se interpolan en su
 *    cuadrilátero de la red; un lado del arreglo que va por una arista partida sigue por sus nudos
 *    (`subdivididas`). Un lado cuyo primer tercio no llega a `separacionRefino` (2·ε_snap: un nudo
 *    más cerca sería de la huella) no se refina. Con la cara dentro de una celda, a unos centímetros
 *    de su línea interior (un pilar mayor que el menor de su alineación, F3), el primer tramo mide
 *    casi la celda: los tercios se toman de un largo de h como mucho, y si la transición de la
 *    esquina no cabe más allá en una dirección, la esquina va fina salvo su tramo exterior, que la
 *    lleva hasta el borde del bloque. Una plantilla refinada con algún cuadrilátero no convexo o por
 *    debajo de UMBRAL_REFINO se rehace como en F2 y, si tampoco, se queda sin refinar (`sinRefinar`,
 *    con aviso); una sin refinar por debajo de JACOBIANO_PLANTILLA no se usa (su pilar va por la CDT).
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
 * 8. Esquinas de los paños (fase LV2, `esquinas`): una celda de losa con una línea fuerte (la cara
 *    del ancho de una viga) en un lado u y otra en un lado v, y fuera de las losas al otro lado de las
 *    dos (por el centro de la celda), es la esquina de un paño entre vigas. Allí la losa concentra su
 *    reacción de esquina, y con un elemento de h junto a la cara la viga sale mal en la cara del pilar.
 *    La celda lleva una plantilla (`PLANTILLA_ESQUINA`): la graduada parte el elemento de la esquina
 *    (el cuarto de la celda, su mitad o la celda entera, según vaya partida) en 3 hacia ella (un cuarto
 *    y dos trapecios) `niveles` veces; la de tercios, sólo en una celda partida en 4, en 3 × 3 con
 *    transiciones de 3 a 1. Su borde hacia la losa es el de la celda, así que la costura no cambia; por
 *    las caras lleva sus nudos (`subdivididas`), sin nada al otro lado.
 *    Por cruces: las esquinas en diagonal con la celda de un cruce de vigas llevan todas la plantilla,
 *    con los mismos niveles, o ninguna. Refinada a un solo lado de una viga, la losa de ese lado toma
 *    menos momento que la del otro, la viga (con la torsión ×0,1 de D4) se tuerce, y la losa refinada
 *    pierde en la cara hasta un 30 % junto al pilar. Por lo mismo, un grupo de celdas regulares con
 *    una esquina no vuelve a la CDT por pequeño. Una esquina de la CDT no se refina: junto a un pilar
 *    deja su cruce sin refinar; lejos (el cruce de un zuncho), no. Se usan los niveles que quepan en
 *    todas: el elemento más pequeño, de al menos ε_snap, y ningún nudo nuevo que se haga rígido con un
 *    pilar (`huellasPilares`, también las tapadas por las vigas; C2-d): uno de las caras va a la viga
 *    salvo que caiga dentro de la huella, y uno de dentro de la losa, a menos de 1,2·ε_snap, sería
 *    suyo. Los pilares de un cruce que se queda sin plantilla van en `esquinasSinRefinar`, para el
 *    aviso `malla/esquina-sin-refinar` (LV2-g: refinar una esquina de la triangulación exigiría una
 *    plantilla propia para ella).
 * 9. Tiras de huella (fase LV2, LV-8): la huella de un pilar que el ancho de una viga atraviesa de
 *    lado a lado llega en tiras, una por lado del ancho (`tira`, del mismo `grupo`): lo que asoma de
 *    la viga (un 30 × 50 bajo una de 30). Cada tira es una huella de pilar de fachada enrasado
 *    contra el ancho (la cara sobre la línea fuerte de la viga, con el ancho, que no es losa, al otro
 *    lado) y lleva la plantilla de 5, con el refinamiento de sus caras. Los rasgos de una tira no son
 *    ajenos para las celdas de las otras, y un pilar lleva plantilla en todas sus tiras o en ninguna
 *    (`tirasSinPlantilla`, para el aviso `malla/pilar-asoma-sin-plantilla`: lo que asoma lo malla
 *    entonces la triangulación, con astillas). La celda de una tira cuenta como esquina refinada
 *    para su cruce (8). Sin tiras, lo que asomaba dejaba irregulares las celdas junto al pilar y la
 *    triangulación lo unía a las caras con astillas (jacobiano 0,11–0,19).
 * 10. Caras delante de un pilar tapado (fase LV2, LV-8, `tapadas`): un pilar que el ancho de su viga
 *    tapa salvo ≤ ε_snap (un 40 × 40 bajo una de 30) no se siembra ni lleva plantilla, pero los nudos
 *    de las caras de la viga delante de su huella son rígidos con él (C2-d): la losa está empotrada
 *    en el pilar, y su metro perpendicular a la viga (`esfuerzosFranjas.ts`, el escalón desde la cara)
 *    salía con h = 0,75 un 17 % por debajo de la malla de 0,25 con la celda entera contra el tramo
 *    rígido. Ahora, en cada cara de viga a ≤ `separacionRefino` de su huella, las celdas regulares de
 *    losa delante de ella (las que cruza la huella a lo largo de la cara) llevan una plantilla de cara:
 *    el primer tramo desde la cara (la mitad de la celda si va partida, o la celda) en tercios a lo
 *    largo del tramo, con la transición de 3 a 1 en las celdas de los extremos (en su mitad exterior
 *    si van partidas a lo largo de la cara, o en la celda entera). El borde hacia la losa y los extremos
 *    no cambian (sus esquinas y, si van partidos, sus puntos medios); por la cara lleva sus nudos
 *    (`subdivididas`), y las aristas entre dos celdas del tramo también (por ellas puede ir una cara de
 *    franja). Una sola celda sin partir a lo largo de la cara no se cierra con cuadriláteros (su
 *    contorno tendría un número impar de aristas): el tramo crece una celda a cada lado. Un pilar lleva
 *    la plantilla en todas sus caras o en ninguna (a un solo lado de la viga, la viga se tuerce, como en
 *    8); las celdas de esquina de un cruce van por 8. Si alguna celda no es regular, o la plantilla no
 *    tiene calidad o pondría un nudo rígido, el pilar va en `tapadasSinRefinar` (aviso
 *    `malla/pilar-tapado-sin-refinar`).
 *
 * Puro y determinista; las comparaciones con umbral llevan holgura para que un ruido de ε_geom o el
 * redondeo de un giro no cambien la rejilla.
 */
import type { Vec2 } from "./fisico.ts";
import { jacobianoEscalado, type Region } from "./poligonos.ts";

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
  /** Lados de los trazos exactos (las caras de las bandas, C5-g). Sin él, ninguno. */
  exactos?: readonly boolean[];
  /**
   * Huellas de los pilares: sus puntos, en orden, y sus lados. Con el ancho de las vigas (fase LV2,
   * LV-8), la huella que un ancho atraviesa va en tiras, una por lado (`tira`), todas del mismo
   * `grupo` (el pilar): un rasgo de una tira no es ajeno para las celdas de las otras, y el pilar
   * lleva plantilla en todas sus tiras o en ninguna. Sin `grupo`, cada huella es el suyo.
   */
  huellas: readonly { puntos: readonly number[]; lados: readonly number[]; grupo?: number; tira?: boolean }[];
  /** Caras que se refinan de cada huella (F2), o null. Sin él, ninguna. */
  refino?: readonly (RefinoHuella | null)[];
  /**
   * Distancia mínima a la cara del primer nudo nuevo del refinamiento (F2): un lado cuyo primer
   * tramo no llega a tres veces ella no se refina (el tramo ya es corto, y un nudo más cerca de la
   * huella que ε_snap sería de ella).
   */
  separacionRefino?: number;
  /**
   * Lados que proponen una línea fuerte (fase LV: las caras del ancho de una viga, que no es losa).
   * Una línea fuerte sólo cede ante otra fuerte más larga a menos de d_min/4, como una larga, y una
   * normal cede ante ella a menos de d_min: las dos caras de una viga más estrecha que d_min son
   * líneas, y las celdas entre ellas no son losa. Sin él, ninguno.
   */
  fuertes?: readonly boolean[];
  /**
   * Por huella, si su eje no propone línea en u o en v (fase LV: va por dentro del ancho de una viga
   * en esa dirección, cuyas caras son las líneas). Sin él, todos la proponen.
   */
  sinEje?: readonly (readonly [boolean, boolean])[];
  /**
   * Refinar las esquinas de los paños (fase LV2): con `fuertes`, cada celda regular en la que se
   * encuentran dos caras de viga lleva la plantilla de esquina (§8 de la cabecera).
   */
  esquinas?: boolean;
  /**
   * Huellas de todos los pilares de la planta, también las que tapan los anchos de las vigas (fase
   * LV2): ningún nudo nuevo de una plantilla de esquina a menos de `separacionRefino` de ellas, que
   * sería rígido (C2-d, F2-9).
   */
  huellasPilares?: readonly (readonly Vec2[])[];
  /**
   * Pilares de `huellasPilares` cuya huella tapa el ancho de su viga (fase LV2, LV-8): sin sembrar y
   * sin plantilla, las celdas delante de su huella junto a las caras de la viga llevan la plantilla de
   * cara (§10 de la cabecera).
   */
  tapadas?: readonly number[];
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
 * borde («bf»), cara sobre una línea por dentro del bloque («nf», la de una cara de banda) o punto
 * medio de una celda sin cara (dentro de la huella, «m»).
 */
interface EjePlantilla {
  t: "b" | "n" | "f" | "bf" | "nf" | "m";
  /** Línea de la rejilla, o −1 en una cara. */
  g: number;
  x: number;
}

interface ModoPlantilla {
  ejes: EjePlantilla[];
  /** Celdas del bloque en esta dirección. */
  celdas: number[];
  /** Celda al otro lado de cada cara (la menor y la mayor) apoyada en una línea del borde, o null. */
  apoyo: [number | null, number | null];
}

export interface Plantilla {
  huella: number;
  /** Nudos de la red. Sin refinar, los de la red por ejes (A × B), a + A·b, con a a lo largo del eje 1. */
  red: NudoPlantilla[];
  /**
   * Cuadriláteros de la red (índices en `red`, antihorarios) con su losa, o −1 fuera de las losas.
   * Sin refinar, los de la red por ejes en orden (a + (A − 1)·b).
   */
  quads: { n: [number, number, number, number]; losa: number }[];
  /** Anillo de la huella en la red (índices), en sentido antihorario. */
  anillo: number[];
  /**
   * Aristas de la rejilla con su punto medio en la red (las del borde del bloque y las que cruzan una
   * celda ganada por una cara de banda), y la losa de su celda.
   */
  bordes: { n1: number; n2: number; losa: number }[];
  /**
   * Tramos de las líneas de la rejilla dentro del bloque que la red refinada parte en más de dos
   * (los de las caras), entre dos nudos de la rejilla o puntos del arreglo: sus extremos y sus nudos
   * intermedios, de a a b (índices en `red`). Un lado que va por ellos sigue entero por la red.
   */
  subdivididas: { a: number; b: number; nudos: number[] }[];
  /** Lados del arreglo de la huella. */
  huellaLados: readonly number[];
  /** ¿Lleva el refinamiento de sus caras (F2)? */
  refinada: boolean;
}

/**
 * Caras de una huella que se refinan (F2): en u y en v, el lado de menor y el de mayor coordenada.
 */
export interface RefinoHuella {
  u: readonly [boolean, boolean];
  v: readonly [boolean, boolean];
}

/** Posición de los dos nudos nuevos en el primer tramo junto a una cara refinada, desde la cara (F2). */
export const PARTICION_REFINO: [number, number] = [1 / 3, 2 / 3];

/**
 * Jacobiano escalado mínimo de una plantilla refinada; por debajo, se queda sin refinar (F2). El
 * mismo que el aviso de calidad de la malla (`JACOBIANO_BAJO` de `mallado.ts`): el refinamiento
 * nunca deja un cuadrilátero que lo dispare. Es un objeto para que las pruebas puedan forzar el
 * respaldo.
 */
export const UMBRAL_REFINO = { jacobiano: 0.2 };

/** Niveles de la plantilla de esquina (fase LV2): 1, tercios del elemento de la esquina; 2, y otra vez en su subelemento. */
export const PLANTILLA_ESQUINA: { tipo: "tercios" | "graduada"; niveles: number; nivelesSinPilar?: number } = { tipo: "graduada", niveles: 3 };

/** Jacobiano escalado mínimo de una plantilla; por debajo, el pilar va por la triangulación (F2). */
export const JACOBIANO_PLANTILLA = 0.2;

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
  /** Huellas con caras que refinar que se quedan con la plantilla sin refinar (F2: no cabía con calidad). */
  sinRefinar: number[];
  /**
   * Pilares (índice en `huellasPilares`) de los cruces de vigas cuyas esquinas se quedan sin plantilla
   * (fase LV2, LV2-g): `triangulacion` si es porque una esquina cae en la triangulación junto a él; si
   * no, la plantilla no cabe o no tiene calidad.
   */
  esquinasSinRefinar: { huella: number; triangulacion: boolean }[];
  /**
   * Huellas en tiras (un pilar que asoma del ancho de la viga que lo atraviesa, LV-8) sin plantilla
   * (la primera tira de cada pilar): su bloque tiene cerca un hueco, una carga u otro rasgo, o se
   * solapa con otra plantilla, y lo que asoma lo malla la triangulación, con astillas.
   */
  tirasSinPlantilla: number[];
  /**
   * Pilares tapados (índice en `huellasPilares`) con alguna cara de viga delante de su huella que se
   * queda sin la plantilla de cara (§10): una celda no es regular, o la plantilla no tiene calidad.
   */
  tapadasSinRefinar: number[];
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

/** ¿Está el punto dentro del polígono?, y su distancia al borde. */
function bordePoligono(q: Vec2, poli: readonly Vec2[]): { dentro: boolean; d: number } {
  let dentro = false;
  let d = Infinity;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [A, B] = [poli[j]!, poli[i]!];
    if (A[1] > q[1] !== B[1] > q[1] && q[0] < ((B[0] - A[0]) * (q[1] - A[1])) / (B[1] - A[1]) + A[0]) dentro = !dentro;
    const [dx, dy] = [B[0] - A[0], B[1] - A[1]];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / L2)) : 0;
    const [ex, ey] = [A[0] + t * dx - q[0], A[1] + t * dy - q[1]];
    d = Math.min(d, Math.sqrt(ex * ex + ey * ey));
  }
  return { dentro, d };
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
function lineas(cand: { c: number; L: number; fuerte?: boolean }[], tol: number, dMin: number, s: number, extension: number): number[] {
  if (!cand.length) return [];
  cand.sort((x, y) => x.c - y.c);
  // Grupos de candidatos a ≤ tol: la media ponderada por longitud y la longitud total
  const grupos: { c: number; L: number; fuerte: boolean }[] = [];
  for (let k = 0; k < cand.length; ) {
    let m = k;
    let suma = 0;
    let L = 0;
    let fuerte = false;
    do {
      suma += cand[m]!.c * cand[m]!.L;
      L += cand[m]!.L;
      fuerte ||= cand[m]!.fuerte === true;
      m++;
    } while (m < cand.length && cand[m]!.c - cand[m - 1]!.c <= tol);
    grupos.push({ c: suma / L, L, fuerte });
    k = m;
  }
  // Una línea cede ante otra más larga a menos de d_min (a igual longitud, ante la de menor c). Una
  // fuerte (fase LV) no cede ante una normal, y una normal cede siempre ante una fuerte
  const tolL = 1e-4;
  const cede = (k: number, o: number) =>
    grupos[o]!.fuerte !== grupos[k]!.fuerte ? grupos[o]!.fuerte : grupos[o]!.L > grupos[k]!.L + tolL || (Math.abs(grupos[o]!.L - grupos[k]!.L) <= tolL && o < k);
  const elegidas: number[] = [];
  grupos.forEach((g, k) => {
    const lejos = (g.fuerte || g.L >= LINEA_LARGA * extension ? dMin / 4 : dMin) * (1 - HOLGURA);
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

/**
 * Rejilla de una planta, o null si no tiene ninguna celda cubierta. Una plantilla con algún
 * cuadrilátero por debajo de JACOBIANO_PLANTILLA no se usa: se vuelve a montar la rejilla con ese
 * pilar en la triangulación (F2).
 */
export function rejillaPlanta(E: EntradaRejilla): Rejilla | null {
  const excluidas = new Set<number>();
  for (;;) {
    const r = montarRejilla(E, excluidas);
    if (!r || !("excluir" in r)) return r;
    for (const k of r.excluir) excluidas.add(k);
  }
}

function montarRejilla(E: EntradaRejilla, excluidas: ReadonlySet<number>): Rejilla | { excluir: number[] } | null {
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
  const candU: { c: number; L: number; fuerte?: boolean }[] = [];
  const candV: { c: number; L: number; fuerte?: boolean }[] = [];
  lados.forEach((l, k) => {
    if (!E.ladoEnLosa[k] || E.fijos[k]) return;
    const [A, B] = [W[l.a]!, W[l.b]!];
    const du = Math.abs(A[0] - B[0]);
    const dv = Math.abs(A[1] - B[1]);
    const f = E.fuertes?.[k] ? { fuerte: true } : {};
    if (dv <= tol && du > tol) candV.push({ c: (A[1] + B[1]) / 2, L: du, ...f });
    else if (du <= tol && dv > tol) candU.push({ c: (A[0] + B[0]) / 2, L: dv, ...f });
  });
  const rects = E.huellas.map((hh) => (hh.puntos.some((p) => E.puntoEnLosa[p]) ? rectanguloHuella(W, hh.puntos, tol) : null));
  rects.forEach((r, k) => {
    if (!r) return;
    if (!E.sinEje?.[k]?.[0]) candU.push({ c: (r.u0 + r.u1) / 2, L: 2 * (r.v1 - r.v0) });
    if (!E.sinEje?.[k]?.[1]) candV.push({ c: (r.v0 + r.v1) / 2, L: 2 * (r.u1 - r.u0) });
  });
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
  // (por grupos: las tiras de una huella atravesada por un ancho son del mismo pilar, LV-8)
  const grupoDe = (k: number) => E.huellas[k]!.grupo ?? k;
  const huellaDePunto = new Int32Array(P.length).fill(-2);
  const huellaDeLado = new Int32Array(lados.length).fill(-2);
  E.huellas.forEach((hh, k) => {
    for (const p of hh.puntos) huellaDePunto[p] = huellaDePunto[p] === -2 ? grupoDe(k) : -3;
    for (const l of hh.lados) huellaDeLado[l] = huellaDeLado[l] === -2 ? grupoDe(k) : -3;
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

  // Líneas de caras de banda (las que llevan un lado de un trazo exacto, C5-g) y aristas de la
  // rejilla que recorre un lado
  const corteU = new Uint8Array(nu);
  const corteV = new Uint8Array(nv);
  const aristaDeLado = new Set<string>();
  enLinea.forEach((el, k) => {
    if (!el) return;
    if (E.exactos?.[k]) (el.horizontal ? corteV : corteU)[el.linea] = 1;
    for (let m = 0; m + 1 < el.nudos.length; m++) {
      const [n1, n2] = [el.nudos[m]!, el.nudos[m + 1]!];
      aristaDeLado.add(n1 < n2 ? `${n1},${n2}` : `${n2},${n1}`);
    }
  });

  // Celdas con rasgos ajenos a menos de δ: −1 ninguno, g sólo del grupo de huellas g, −2 otros
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
   * Con `crecer` (la cara menor y la mayor), una cara sobre una línea de cara de banda (`corte`) no
   * se apoya: el bloque crece una celda más allá y la cara va por dentro («nf»).
   */
  const ejesDe = (L: readonly number[], f0: number, f1: number, corte: Uint8Array, crecer: readonly [boolean, boolean]): ModoPlantilla | null => {
    let lo = tramo(L, f0 + tol);
    let hi = tramo(L, f1 - tol) + 1;
    if (crecer[0] && lo >= 0 && corte[lo] === 1 && Math.abs(L[lo]! - f0) <= tol) lo--;
    if (crecer[1] && hi < L.length && corte[hi] === 1 && Math.abs(L[hi]! - f1) <= tol) hi++;
    if (lo < 0 || hi > L.length - 1 || hi <= lo) return null;
    const ejes: EjePlantilla[] = [];
    const apoyo: [number | null, number | null] = [null, null];
    for (let m = lo; m <= hi; m++) {
      const cara0 = Math.abs(L[m]! - f0) <= tol;
      const cara1 = Math.abs(L[m]! - f1) <= tol;
      const borde = m === lo || m === hi;
      ejes.push({ t: borde ? (cara0 || cara1 ? "bf" : "b") : cara0 || cara1 ? "nf" : "n", g: m, x: cara0 ? f0 : cara1 ? f1 : L[m]! });
      if (borde && cara0) apoyo[0] = m - 1;
      if (borde && cara1) apoyo[1] = m;
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
  const dentroDeLosa = (a: number, b: number) => a >= 0 && b >= 0 && a <= nu - 2 && b <= nv - 2 && losaCelda[celda(a, b)]! >= 0;
  rects.forEach((r, k) => {
    if (!r || excluidas.has(k)) return;
    // Una cara sobre una línea de cara de banda con losa al otro lado: el bloque crece por ese lado
    // (cada lado crece una vez como mucho, así que acaba)
    const crecerU: [boolean, boolean] = [false, false];
    const crecerV: [boolean, boolean] = [false, false];
    let mu: ModoPlantilla | null;
    let mv: ModoPlantilla | null;
    for (;;) {
      mu = ejesDe(U, r.u0, r.u1, corteU, crecerU);
      mv = ejesDe(V, r.v0, r.v1, corteV, crecerV);
      if (!mu || !mv) return;
      let cambio = false;
      for (const lado of [0, 1] as const) {
        const a = mu.apoyo[lado];
        if (a !== null && !crecerU[lado] && corteU[lado ? a : a + 1] === 1 && mv.celdas.some((b) => dentroDeLosa(a, b))) cambio = crecerU[lado] = true;
        const b = mv.apoyo[lado];
        if (b !== null && !crecerV[lado] && corteV[lado ? b : b + 1] === 1 && mu.celdas.some((a2) => dentroDeLosa(a2, b))) cambio = crecerV[lado] = true;
      }
      if (!cambio) break;
    }
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
        if (cerca[c] !== -1 && cerca[c] !== grupoDe(k)) return;
        if (losaCelda[c]! >= 0) {
          if (anillo(a, b)) return;
          enLosa++;
        }
      }
    // Al otro lado de una cara apoyada en una línea, fuera de las losas (un pilar de fachada enrasado)
    if (mu.apoyo.some((a) => a !== null && mv!.celdas.some((b) => dentroDeLosa(a, b)))) return;
    if (mv.apoyo.some((b) => b !== null && mu!.celdas.some((a) => dentroDeLosa(a, b)))) return;
    if (enLosa) candidatas.push({ k, mu, mv });
  });
  // Dos bloques que se solapan se quedan sin plantilla
  const uso = new Uint8Array(nc);
  const bloque = (x: { mu: ModoPlantilla; mv: ModoPlantilla }) => x.mu.celdas.flatMap((a) => x.mv.celdas.map((b) => celda(a, b)));
  for (const x of candidatas) for (const c of bloque(x)) uso[c]!++;
  const nGrupos = E.huellas.reduce((m, _, k) => Math.max(m, grupoDe(k) + 1), 0);
  const conPlantilla = new Uint8Array(nGrupos);
  const estado = new Uint8Array(nc);
  // Un pilar en tiras (LV-8) lleva plantilla en todas o en ninguna: si una no puede, las demás
  // dejarían sus rasgos sueltos junto a la triangulación
  const porGrupo = new Int32Array(nGrupos);
  const elegidasGrupo = new Int32Array(nGrupos);
  E.huellas.forEach((_, k) => porGrupo[grupoDe(k)]!++);
  for (const x of candidatas.filter((x) => bloque(x).every((c) => uso[c] === 1))) elegidasGrupo[grupoDe(x.k)]!++;
  const elegidas = candidatas.filter((x) => bloque(x).every((c) => uso[c] === 1) && elegidasGrupo[grupoDe(x.k)] === porGrupo[grupoDe(x.k)]);
  const tirasSinPlantilla: number[] = [];
  {
    const vistos = new Set<number>();
    E.huellas.forEach((hh, k) => {
      if (!hh.tira || vistos.has(grupoDe(k)) || elegidas.some((x) => x.k === k)) return;
      vistos.add(grupoDe(k));
      tirasSinPlantilla.push(k);
    });
  }
  /** Huella (índice en `E.huellas`) cuya plantilla cubre cada celda, o −1. */
  const huellaDeCelda = new Int32Array(nc).fill(-1);
  for (const x of elegidas) {
    conPlantilla[grupoDe(x.k)] = 1;
    for (const c of bloque(x))
      if (losaCelda[c]! >= 0) {
        estado[c] = PLANTILLA;
        huellaDeCelda[c] = x.k;
      }
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
  // Esquinas de los paños (fase LV2, §8): las líneas fuertes y, por celda, las esquinas [su, sv] con
  // una línea fuerte en un lado u y otra en un lado v y fuera de las losas al otro lado de las dos
  const fuerteEn = (cand: readonly { c: number; fuerte?: boolean }[], L: readonly number[]) => L.map((x) => cand.some((c) => c.fuerte === true && Math.abs(c.c - x) <= 2 * tol));
  const fU = fuerteEn(candU, U);
  const fV = fuerteEn(candV, V);
  // (lo de fuera, por su centro: la celda del ancho de una viga junto a un rasgo es irregular)
  const fueraDeLosas = (i: number, j: number) => i < 0 || j < 0 || i > nu - 2 || j > nv - 2 || losaCelda[celda(i, j)]! < 0;
  const esquinasDe = (i: number, j: number): [number, number][] => {
    const r: [number, number][] = [];
    if (!E.esquinas || !E.fuertes) return r;
    for (const su of [-1, 1])
      for (const sv of [-1, 1]) if (fU[su < 0 ? i : i + 1] && fV[sv < 0 ? j : j + 1] && fueraDeLosas(i + su, j) && fueraDeLosas(i, j + sv)) r.push([su, sv]);
    return r;
  };
  // Los grupos de menos de GRUPO_MINIMO celdas regulares seguidas (sin plantilla) van por la CDT:
  // ahorran poco y obligan a la CDT a coserse a sus aristas. Con el ancho de las vigas (fase LV), no
  // el que no toca ninguna celda irregular: un recuadro de losa entre las caras de sus vigas (2 × 4
  // celdas en el edificio objetivo) no se cose con nada. Con las esquinas de los paños (LV2), tampoco
  // el que tiene una: su plantilla tiene que ir igual a los dos lados de cada viga, o la viga se
  // tuerce (con la torsión ×0,1) y la losa del lado refinado pierde momento en la cara
  const grupo = new Int32Array(nc).fill(-1);
  for (let c0 = 0; c0 < nc; c0++) {
    if (estado[c0] !== REGULAR || grupo[c0]! >= 0) continue;
    const pila = [c0];
    const celdas: number[] = [];
    grupo[c0] = c0;
    let plantilla = false;
    let irregular = false;
    while (pila.length) {
      const c = pila.pop()!;
      celdas.push(c);
      const [i, j] = [c % (nu - 1), Math.floor(c / (nu - 1))];
      if (esquinasDe(i, j).length === 1) plantilla = true;
      for (const [a, b] of [
        [i - 1, j],
        [i + 1, j],
        [i, j - 1],
        [i, j + 1],
      ] as const) {
        if (a < 0 || b < 0 || a > nu - 2 || b > nv - 2) continue;
        const d = celda(a, b);
        if (estado[d] === PLANTILLA) plantilla = true;
        if (estado[d] === IRREGULAR) irregular = true;
        if (estado[d] === REGULAR && grupo[d]! < 0) {
          grupo[d] = c0;
          pila.push(d);
        }
      }
    }
    if (!plantilla && celdas.length < GRUPO_MINIMO && (!E.fuertes || irregular))
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
  /** Posición de un nudo de la red de una plantilla. */
  const posRed = (x: NudoPlantilla): Vec2 => {
    if (x.tipo === "nudo") return posicion(x.n);
    if (x.tipo === "punto") return P[x.p]!;
    if (x.tipo === "nuevo") return x.q;
    const [A, B] = [posicion(x.n1), posicion(x.n2)];
    return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  };
  // Redes de las plantillas
  const absorbidos = new Uint8Array(P.length);
  const enRejilla = (x: EjePlantilla) => x.t !== "f" && x.t !== "m";
  /** Celda (en una dirección) del cuadrilátero a de la red: la de la última línea de la rejilla ≤ a. */
  const celdaEje = (m: ModoPlantilla, a: number) => m.celdas[m.ejes.slice(0, a + 1).filter(enRejilla).length - 1]!;
  const redDe = (k: number, mu0: ModoPlantilla, mv0: ModoPlantilla, refino: RefinoHuella | null, f3 = true): Plantilla => {
    // El punto medio de una celda sin cara, sólo si su tramo va partido (en el borde del bloque es el
    // punto medio de la arista de la rejilla). Las celdas del bloque en las losas son un solo tramo,
    // así que vale cualquiera de sus líneas (la primera puede caer fuera de las losas)
    const lineasU = mu0.ejes.filter(enRejilla).map((e) => e.g);
    const lineasV = mv0.ejes.filter(enRejilla).map((e) => e.g);
    let q = -1;
    const mu = { ...mu0, ejes: mu0.ejes.filter((e) => (enRejilla(e) ? (q++, true) : e.t === "f" || lineasV.some((j) => partidaH[mu0.celdas[q]! + j * (nu - 1)] === 1))) };
    q = -1;
    const mv = { ...mv0, ejes: mv0.ejes.filter((e) => (enRejilla(e) ? (q++, true) : e.t === "f" || lineasU.some((i) => partidaV[i + mv0.celdas[q]! * nu] === 1))) };
    const r = rects[k]!;
    const pts = E.huellas[k]!.puntos;
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
    // Losa de alguno de los cuadriláteros que tocan el nudo (a, b) de la red, o −1
    const losaAlrededor = (a: number, b: number) => {
      let k = -1;
      for (const x of [a - 1, a]) for (const y of [b - 1, b]) if (x >= 0 && y >= 0 && x <= A - 2 && y <= B - 2) k = Math.max(k, losaCuad(x, y));
      return k;
    };
    // Punto medio de una celda que el bloque ha ganado por una cara de banda (fuera de la huella) o,
    // por una línea que cruza la huella, el de una arista de la rejilla que recorre un lado (una cara
    // de banda o un borde de losa que la atraviesan): un lado que va por esa línea sigue entero por
    // la red
    const medioEn = (x: EjePlantilla, f0: number, f1: number, y: EjePlantilla, n1: number, n2: number) =>
      x.t === "m" && (x.x < f0 - tol || x.x > f1 + tol || (y.t === "n" && aristaDeLado.has(n1 < n2 ? `${n1},${n2}` : `${n2},${n1}`)));
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
        } else if (enRejilla(eu) && b > 0 && b < B - 1 && medioEn(ev, r.v0, r.v1, eu, g(eu, mv.ejes[b - 1]!), g(eu, mv.ejes[b + 1]!))) {
          const [n1, n2] = [g(eu, mv.ejes[b - 1]!), g(eu, mv.ejes[b + 1]!)];
          red.push({ tipo: "medio", n1, n2 });
          bordes.push({ n1, n2, losa: losaAlrededor(a, b) });
        } else if (enRejilla(ev) && a > 0 && a < A - 1 && medioEn(eu, r.u0, r.u1, ev, g(mu.ejes[a - 1]!, ev), g(mu.ejes[a + 1]!, ev))) {
          const [n1, n2] = [g(mu.ejes[a - 1]!, ev), g(mu.ejes[a + 1]!, ev)];
          red.push({ tipo: "medio", n1, n2 });
          bordes.push({ n1, n2, losa: losaAlrededor(a, b) });
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
    const cara_ = (x: EjePlantilla) => x.t === "f" || x.t === "bf" || x.t === "nf";
    const [a0, a1] = [mu.ejes.findIndex(cara_), mu.ejes.findLastIndex(cara_)];
    const [b0, b1] = [mv.ejes.findIndex(cara_), mv.ejes.findLastIndex(cara_)];
    const anilloH: number[] = [];
    for (let a = a0; a < a1; a++) anilloH.push(a + A * b0);
    for (let b = b0; b < b1; b++) anilloH.push(a1 + A * b);
    for (let a = a1; a > a0; a--) anilloH.push(a + A * b1);
    for (let b = b1; b > b0; b--) anilloH.push(a0 + A * b);
    const quads: Plantilla["quads"] = [];
    const sinRef = (): Plantilla => {
      for (let b = 0; b < B - 1; b++) for (let a = 0; a < A - 1; a++) quads.push({ n: [a + A * b, a + 1 + A * b, a + 1 + A * (b + 1), a + A * (b + 1)], losa: losas[a + (A - 1) * b]! });
      return { huella: k, red, quads, anillo: anilloH, bordes, subdivididas: [], huellaLados: E.huellas[k]!.lados, refinada: false };
    };
    const sep = (E.separacionRefino ?? 0) / PARTICION_REFINO[0];
    // Los tercios se toman de un largo de h como mucho (F3): con la cara dentro de una celda, a unos
    // centímetros de su línea interior, el primer tramo mide casi la celda (hasta 2h)
    const largo = (d: number) => (f3 && Math.abs(d) > E.h * (1 + HOLGURA) ? Math.sign(d) * E.h : d);
    // Con holgura (R-7): un tramo de justo el mínimo no puede depender del redondeo de una traslación
    const cabe = (ejes: readonly EjePlantilla[], i: number, j: number) => Math.abs(largo(ejes[j]!.x - ejes[i]!.x)) >= sep * (1 - HOLGURA);
    /** ¿Es largo el primer tramo junto a la cara (tercios de h y un tramo exterior más ancho)? */
    const ancho_ = (ejes: readonly EjePlantilla[], i: number, j: number) => f3 && Math.abs(ejes[j]!.x - ejes[i]!.x) > E.h * (1 + HOLGURA);
    const refL = !!refino?.u[0] && a0 > 0 && cabe(mu.ejes, a0 - 1, a0);
    const refR = !!refino?.u[1] && a1 < A - 1 && cabe(mu.ejes, a1, a1 + 1);
    const refB = !!refino?.v[0] && b0 > 0 && cabe(mv.ejes, b0 - 1, b0);
    const refT = !!refino?.v[1] && b1 < B - 1 && cabe(mv.ejes, b1, b1 + 1);
    if (!(refL || refR || refB || refT)) return sinRef();

    // F2: en el primer tramo de la red junto a cada cara que se refina, sus tercios. La cruz (los
    // tramos junto a las caras, a lo largo de la huella) es una red por ejes; en las cuatro esquinas,
    // el cuadrilátero que toca la cruz por uno o dos lados lleva una plantilla de transición, así que
    // el borde del bloque no cambia
    const finos = (ejes: readonly EjePlantilla[], lo: boolean, i0: number, hi: boolean, i1: number) => {
      const x: number[] = [];
      const de: number[] = [];
      ejes.forEach((e, i) => {
        if (lo && i === i0) {
          const d = largo(e.x - ejes[i - 1]!.x);
          x.push(e.x - PARTICION_REFINO[1] * d, e.x - PARTICION_REFINO[0] * d);
        }
        de.push(x.length);
        x.push(e.x);
        if (hi && i === i1) {
          const d = largo(ejes[i + 1]!.x - e.x);
          x.push(e.x + PARTICION_REFINO[0] * d, e.x + PARTICION_REFINO[1] * d);
        }
      });
      const eje = new Int32Array(x.length).fill(-1);
      de.forEach((f, i) => (eje[f] = i));
      return { x, de, eje };
    };
    const fu = finos(mu.ejes, refL, a0, refR, a1);
    const fv = finos(mv.ejes, refB, b0, refT, b1);
    const NF = fu.x.length;
    const nodos: NudoPlantilla[] = [...red];
    const indice = new Map<number, number>();
    for (let b = 0; b < B; b++) for (let a = 0; a < A; a++) indice.set(fu.de[a]! + NF * fv.de[b]!, a + A * b);
    /** Nudo (i, j) de la red fina: el de la red por ejes o uno nuevo, sobre el lado que va por su línea. */
    // Eje de la red por ejes a la izquierda (o en) un índice fino, y la fracción del tramo hasta el
    // siguiente
    const tramoFino = (f: typeof fu, ejes: readonly EjePlantilla[], i: number): [number, number] => {
      let a = 0;
      while (a + 1 < f.de.length && f.de[a + 1]! <= i) a++;
      return f.eje[i]! >= 0 ? [a, 0] : [a, (f.x[i]! - ejes[a]!.x) / (ejes[a + 1]!.x - ejes[a]!.x)];
    };
    const lerp = (P0: Vec2, P1: Vec2, t: number): Vec2 => [P0[0] + t * (P1[0] - P0[0]), P0[1] + t * (P1[1] - P0[1])];
    const esquina = (a: number, b: number) => posRed(red[a + A * b]!);
    /**
     * Punto (tu, tv) del cuadrilátero (a, b) de la red por ejes, por interpolación bilineal de sus
     * cuatro nudos: no es siempre un rectángulo (con una cara dentro de una celda, sus nudos del
     * borde del bloque son los puntos medios de las aristas de la rejilla). En una arista sólo
     * cuentan sus dos extremos, así que un nudo nuevo en ella es el mismo desde los dos lados y, si la
     * arista va por un lado del arreglo, queda sobre él.
     */
    const enCuad = (a: number, b: number, tu: number, tv: number): Vec2 => {
      if (tv === 0) return tu === 0 ? esquina(a, b) : lerp(esquina(a, b), esquina(a + 1, b), tu);
      if (tu === 0) return lerp(esquina(a, b), esquina(a, b + 1), tv);
      return lerp(lerp(esquina(a, b), esquina(a + 1, b), tu), lerp(esquina(a, b + 1), esquina(a + 1, b + 1), tu), tv);
    };
    /** Nudo (i, j) de la red fina: el de la red por ejes o uno nuevo en su cuadrilátero. */
    const nudoF = (i: number, j: number): number => {
      const clave = i + NF * j;
      let n = indice.get(clave);
      if (n !== undefined) return n;
      const [a, tu] = tramoFino(fu, mu.ejes, i);
      const [b, tv] = tramoFino(fv, mv.ejes, j);
      nodos.push({ tipo: "nuevo", q: enCuad(a, b, tu, tv) });
      indice.set(clave, (n = nodos.length - 1));
      return n;
    };
    const cuad = (n: number[], invertir: boolean, losaQ: number) => quads.push({ n: (invertir ? [n[0]!, n[3]!, n[2]!, n[1]!] : n) as [number, number, number, number], losa: losaQ });
    /**
     * Plantilla de transición de un cuadrilátero de esquina, en sus ejes (ξ, η) desde la esquina de la
     * cruz: N(s, t) es el nudo en ξ = s/3, η = t/3 (los tercios, sólo en un lado fino). Con los dos
     * lados finos, la de esquina (5 cuadriláteros); con uno (el de ξ), la de 3 a 1 (4), con los dos
     * nudos de en medio a media altura (`medio`).
     */
    const transicion = (N: (s: number, t: number) => number, medio: (s: number) => number, dosLados: boolean, invertir: boolean, losaQ: number) => {
      if (dosLados) {
        cuad([N(0, 0), N(1, 0), N(1, 1), N(0, 1)], invertir, losaQ);
        cuad([N(1, 0), N(2, 0), N(2, 2), N(1, 1)], invertir, losaQ);
        cuad([N(2, 0), N(3, 0), N(3, 3), N(2, 2)], invertir, losaQ);
        cuad([N(2, 2), N(3, 3), N(0, 3), N(0, 2)], invertir, losaQ);
        cuad([N(1, 1), N(2, 2), N(0, 2), N(0, 1)], invertir, losaQ);
      } else {
        const [x1, x2] = [medio(1), medio(2)];
        cuad([N(0, 0), N(1, 0), x1, N(0, 3)], invertir, losaQ);
        cuad([N(1, 0), N(2, 0), x2, x1], invertir, losaQ);
        cuad([N(2, 0), N(3, 0), N(3, 3), x2], invertir, losaQ);
        cuad([x1, x2, N(3, 3), N(0, 3)], invertir, losaQ);
      }
    };
    const extra = new Map<string, number>();
    const nudoExtra = (clave: string, q: Vec2) => {
      let n = extra.get(clave);
      if (n === undefined) {
        nodos.push({ tipo: "nuevo", q });
        extra.set(clave, (n = nodos.length - 1));
      }
      return n;
    };
    // Qué lleva cada cuadrilátero de la red por ejes. La cruz va fina (con los tercios). El de cada
    // esquina, también si cabe la transición más allá, dentro del bloque: la de 3 a 1 en el siguiente
    // hacia fuera, por cada lado fino. Si no cabe, la transición va en el de esquina. Así la columna
    // pegada a la cara es fina hasta la mitad de la celda, donde cae el borde de la ventana de la
    // franja del otro sentido. Si no cabe en una sola dirección y allí el primer tramo es largo (con
    // tercios de h, F3), la esquina va fina salvo su tramo exterior, que lleva la transición hasta el
    // borde del bloque
    type Plan = { t: "fino" } | { t: "transicion"; dosLados: boolean; porU: boolean; su: number; sv: number } | { t: "finoBorde"; porU: boolean; su: number; sv: number };
    const plan = new Map<number, Plan>();
    const idq = (a: number, b: number) => a + (A - 1) * b;
    for (let b = b0; b < b1; b++) {
      if (refR) plan.set(idq(a1, b), { t: "fino" });
      if (refL) plan.set(idq(a0 - 1, b), { t: "fino" });
    }
    for (let a = a0; a < a1; a++) {
      if (refT) plan.set(idq(a, b1), { t: "fino" });
      if (refB) plan.set(idq(a, b0 - 1), { t: "fino" });
    }
    for (const su of [1, -1])
      for (const sv of [1, -1]) {
        const [ac, bc] = [su > 0 ? a1 : a0 - 1, sv > 0 ? b1 : b0 - 1];
        if (ac < 0 || ac > A - 2 || bc < 0 || bc > B - 2) continue;
        // Lado fino de la esquina a lo largo de u (el de la cruz en u) y a lo largo de v
        const [enU, enV] = [su > 0 ? refR : refL, sv > 0 ? refT : refB];
        if (!enU && !enV) continue;
        const [an, bn] = [ac + su, bc + sv];
        // Más allá de la esquina en cada dirección: un cuadrilátero de la red (la transición va en él
        // si está en una losa) o, pasado el borde del bloque, una celda fuera de las losas (la
        // esquina llega fina hasta el borde de la losa: no hay nada con lo que coserla)
        const masAlla = (enRed: boolean, fuera: () => boolean) => enRed || fuera();
        const libreV = masAlla(bn >= 0 && bn <= B - 2, () => est(celdaEje(mu, ac), sv > 0 ? mv.celdas[mv.celdas.length - 1]! + 1 : mv.celdas[0]! - 1) === FUERA);
        const libreU = masAlla(an >= 0 && an <= A - 2, () => est(su > 0 ? mu.celdas[mu.celdas.length - 1]! + 1 : mu.celdas[0]! - 1, celdaEje(mv, bc)) === FUERA);
        if ((!enU || libreV) && (!enV || libreU)) {
          plan.set(idq(ac, bc), { t: "fino" });
          if (enU && bn >= 0 && bn <= B - 2 && losas[idq(ac, bn)]! >= 0) plan.set(idq(ac, bn), { t: "transicion", dosLados: false, porU: true, su, sv });
          if (enV && an >= 0 && an <= A - 2 && losas[idq(an, bc)]! >= 0) plan.set(idq(an, bc), { t: "transicion", dosLados: false, porU: false, su, sv });
        } else if (enU && enV && libreV !== libreU && (libreV ? ancho_(mu.ejes, ac, ac + 1) : ancho_(mv.ejes, bc, bc + 1))) {
          plan.set(idq(ac, bc), { t: "finoBorde", porU: !libreU, su, sv });
          if (libreV && bn >= 0 && bn <= B - 2 && losas[idq(ac, bn)]! >= 0) plan.set(idq(ac, bn), { t: "transicion", dosLados: false, porU: true, su, sv });
          if (libreU && an >= 0 && an <= A - 2 && losas[idq(an, bc)]! >= 0) plan.set(idq(an, bc), { t: "transicion", dosLados: false, porU: false, su, sv });
        } else plan.set(idq(ac, bc), { t: "transicion", dosLados: enU && enV, porU: enU, su, sv });
      }
    for (let b = 0; b < B - 1; b++)
      for (let a = 0; a < A - 1; a++) {
        const kq = losas[a + (A - 1) * b]!;
        const [i0, i1, j0, j1] = [fu.de[a]!, fu.de[a + 1]!, fv.de[b]!, fv.de[b + 1]!];
        const pq = plan.get(idq(a, b));
        if (!pq) cuad([a + A * b, a + 1 + A * b, a + 1 + A * (b + 1), a + A * (b + 1)], false, kq);
        else if (pq.t === "fino") {
          for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) cuad([nudoF(i, j), nudoF(i + 1, j), nudoF(i + 1, j + 1), nudoF(i, j + 1)], false, kq);
        } else if (pq.t === "finoBorde") {
          // Fina salvo el tramo exterior (la columna, con `porU`, o la fila junto al borde del bloque),
          // que lleva la transición de 3 a 1 de las filas (columnas) finas hasta el borde
          const { su, sv, porU } = pq;
          const [ie, je] = [su > 0 ? i1 - 1 : i0, sv > 0 ? j1 - 1 : j0];
          for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (porU ? i !== ie : j !== je) cuad([nudoF(i, j), nudoF(i + 1, j), nudoF(i + 1, j + 1), nudoF(i, j + 1)], false, kq);
          /** Fracción en el cuadrilátero (a o b) del punto medio del tramo fino [q, q + 1]. */
          const enMedio = (f: typeof fu, ejes: readonly EjePlantilla[], q: number, c: number) => {
            const [c1, t1] = tramoFino(f, ejes, q + 1);
            return (tramoFino(f, ejes, q)[1] + (c1 > c ? 1 : t1)) / 2;
          };
          if (porU) {
            // ξ a lo largo de v desde la cara de la huella; η en u, de la columna fina al borde
            const iu = (t: number) => (su > 0 ? ie : ie + 1) + su * (t / 3);
            const jv = (s: number) => (sv > 0 ? j0 : j1) + sv * s;
            const fm = enMedio(fu, mu.ejes, ie, a);
            const medio = (s: number) => nudoExtra(`${ie},${ie + 1},${jv(s)}`, enCuad(a, b, fm, tramoFino(fv, mv.ejes, jv(s))[1]));
            transicion((s, t) => nudoF(iu(t), jv(s)), medio, false, su * sv > 0, kq);
          } else {
            const iu = (s: number) => (su > 0 ? i0 : i1) + su * s;
            const jv = (t: number) => (sv > 0 ? je : je + 1) + sv * (t / 3);
            const fm = enMedio(fv, mv.ejes, je, b);
            const medio = (s: number) => nudoExtra(`${iu(s)},${je},${je + 1}`, enCuad(a, b, tramoFino(fu, mu.ejes, iu(s))[1], fm));
            transicion((s, t) => nudoF(iu(s), jv(t)), medio, false, su * sv < 0, kq);
          }
        } else {
          // Ejes de la transición desde su esquina más cercana a la de la huella: ξ a lo largo del
          // lado fino (u si `porU`) y η en la otra; en una dirección sin tercios, s/3 salta de 0 a 1
          const { su, sv, porU, dosLados } = pq;
          const finaU = porU || dosLados;
          const finaV = !porU || dosLados;
          const iu = (s: number) => (su > 0 ? i0 : i1) + su * (finaU ? s : s / 3);
          const jv = (t: number) => (sv > 0 ? j0 : j1) + sv * (finaV ? t : t / 3);
          if (porU) {
            const N = (s: number, t: number) => nudoF(iu(s), jv(t));
            const medio = (s: number) => nudoExtra(`${iu(s)},${j0},${j1}`, enCuad(a, b, tramoFino(fu, mu.ejes, iu(s))[1], 0.5));
            transicion(N, medio, dosLados, su * sv < 0, kq);
          } else {
            const N = (s: number, t: number) => nudoF(iu(t), jv(s));
            const medio = (s: number) => nudoExtra(`${i0},${i1},${jv(s)}`, enCuad(a, b, 0.5, tramoFino(fv, mv.ejes, jv(s))[1]));
            transicion(N, medio, false, su * sv > 0, kq);
          }
        }
      }

    // Tramos de las líneas de la rejilla del bloque, entre nudos de la rejilla o puntos del arreglo
    // (las esquinas de la huella), partidos en más de dos: sus nudos intermedios (los puntos medios
    // que caen en ellos pasan a ser nudos de la red, y dejan de ser bordes)
    const subdivididas: Plantilla["subdivididas"] = [];
    const quitarBorde = new Set<string>();
    const recorrer = (enLaLinea: (m: number) => number | undefined, largo: number) => {
      let ini = -1;
      let medio: number[] = [];
      for (let m = 0; m < largo; m++) {
        const n = enLaLinea(m);
        if (n === undefined) continue;
        const x = nodos[n]!;
        if (x.tipo !== "nudo" && x.tipo !== "punto") {
          if (ini >= 0) medio.push(n);
          continue;
        }
        if (ini >= 0 && (medio.length > 1 || (medio.length === 1 && nodos[medio[0]!]!.tipo !== "medio"))) {
          for (const y of medio) {
            const z = nodos[y]!;
            if (z.tipo === "medio") {
              quitarBorde.add(`${z.n1},${z.n2}`);
              nodos[y] = { tipo: "nuevo", q: posRed(z) };
            }
          }
          subdivididas.push({ a: ini, b: n, nudos: medio });
        }
        ini = n;
        medio = [];
      }
    };
    const NV = fv.x.length;
    mv.ejes.forEach((e, b) => {
      if (enRejilla(e)) recorrer((i) => indice.get(i + NF * fv.de[b]!), NF);
    });
    mu.ejes.forEach((e, a) => {
      if (enRejilla(e)) recorrer((j) => indice.get(fu.de[a]! + NF * j), NV);
    });
    const bordesR = bordes.filter((x) => !quitarBorde.has(`${x.n1},${x.n2}`));
    return { huella: k, red: nodos, quads, anillo: anilloH, bordes: bordesR, subdivididas, huellaLados: E.huellas[k]!.lados, refinada: true };
  };
  /**
   * Plantilla de esquina (fase LV2) de la celda (i, j), con la esquina de las caras hacia su, sv. En
   * sus ejes (x, y) desde esa esquina, en 36avos de la celda: el elemento de la esquina (hasta 18), en
   * tercios (3 × 3); los dos tramos junto a las caras, con la transición de 3 a 1 (4 cuadriláteros
   * cada uno, con dos nudos a 27); y el cuarto de enfrente, entero. Con dos niveles
   * (`PLANTILLA_ESQUINA`), el subelemento de la esquina vuelve a ir en tercios, con sus transiciones.
   * Sus lados hacia la losa son los de la celda partida (los puntos medios, como «medio»); por las
   * caras, el primer tramo lleva sus nudos (`subdivididas`).
   */
  const plantillaEsquina = (i: number, j: number, su: number, sv: number, niveles: number, pu: 1 | 2 = 2, pv: 1 | 2 = 2): Plantilla => {
    const graduada = PLANTILLA_ESQUINA.tipo === "graduada";
    const dos = niveles > 1;
    const D = graduada ? 2 ** (niveles + 1) : 36;
    const g = (x: 0 | 1, y: 0 | 1) => (su < 0 ? i + x : i + 1 - x) + (sv < 0 ? j + y : j + 1 - y) * nu;
    const [P00, P10, P01, P11] = [posicion(g(0, 0)), posicion(g(1, 0)), posicion(g(0, 1)), posicion(g(1, 1))];
    const red: NudoPlantilla[] = [];
    const indice = new Map<number, number>();
    const nudo = (a: number, b: number): number => {
      const k = a + (D + 1) * b;
      let r = indice.get(k);
      if (r !== undefined) return r;
      const [x, y] = [a / D, b / D];
      if ((a === 0 || a === D) && (b === 0 || b === D)) red.push({ tipo: "nudo", n: g(a ? 1 : 0, b ? 1 : 0) });
      else if (a === D && 2 * b === D) red.push({ tipo: "medio", n1: g(1, 0), n2: g(1, 1) });
      else if (b === D && 2 * a === D) red.push({ tipo: "medio", n1: g(0, 1), n2: g(1, 1) });
      else
        red.push({
          tipo: "nuevo",
          q: [(1 - y) * ((1 - x) * P00[0] + x * P10[0]) + y * ((1 - x) * P01[0] + x * P11[0]), (1 - y) * ((1 - x) * P00[1] + x * P10[1]) + y * ((1 - x) * P01[1] + x * P11[1])],
        });
      indice.set(k, (r = red.length - 1));
      return r;
    };
    const losaQ = losa[celda(i, j)]!;
    const quads: Plantilla["quads"] = [];
    const cuad = (v: readonly (readonly [number, number])[]) => {
      const n = v.map(([a, b]) => nudo(a, b)) as [number, number, number, number];
      const X = n.map((k) => posRed(red[k]!));
      let area = 0;
      for (let m = 0; m < 4; m++) area += X[m]![0] * X[(m + 1) % 4]![1] - X[(m + 1) % 4]![0] * X[m]![1];
      quads.push({ n: area > 0 ? n : [n[0], n[3], n[2], n[1]], losa: losaQ });
    };
    /** Transición de 3 a 1 con el lado fino en x = xa (nudos y0…y3) y el grueso en x = xb, y su simétrica. */
    const transicion = (xa: number, xb: number, y: readonly number[]) => {
      const xm = (xa + xb) / 2;
      const t: [number, number][][] = [
        [[xa, y[0]!], [xa, y[1]!], [xm, y[1]!], [xb, y[0]!]],
        [[xa, y[1]!], [xa, y[2]!], [xm, y[2]!], [xm, y[1]!]],
        [[xa, y[2]!], [xa, y[3]!], [xb, y[3]!], [xm, y[2]!]],
        [[xm, y[1]!], [xm, y[2]!], [xb, y[3]!], [xb, y[0]!]],
      ];
      for (const q of t) {
        cuad(q);
        cuad(q.map(([a, b]) => [b, a] as [number, number]));
      }
    };
    if (graduada) {
      // El elemento de la esquina (el cuarto de la celda, su mitad o la celda entera, según vaya
      // partida en cada dirección), partido en 3 hacia la esquina `niveles` veces, en sus coordenadas
      // (ξ, η) de 0 a C; lo demás de la celda, entero
      const C = D / 2;
      const [fx, fy] = [pu === 2 ? 1 : 2, pv === 2 ? 1 : 2];
      const [Xc, Yc] = [C * fx, C * fy];
      const q = (v: readonly (readonly [number, number])[]) => cuad(v.map(([x, y]) => [x * fx, y * fy] as [number, number]));
      if (pu === 2 && pv === 2) {
        cuad([[Xc, 0], [D, 0], [D, Yc], [Xc, Yc]]);
        cuad([[0, Yc], [Xc, Yc], [Xc, D], [0, D]]);
        cuad([[Xc, Yc], [D, Yc], [D, D], [Xc, D]]);
      } else if (pv === 2) cuad([[0, Yc], [D, Yc], [D, D], [0, D]]);
      else if (pu === 2) cuad([[Xc, 0], [D, 0], [D, D], [Xc, D]]);
      const enCara: number[] = [C];
      for (let t = C; t > 1; t /= 2) {
        const m = t / 2;
        q([[m, 0], [t, 0], [t, t], [m, m]]);
        q([[0, m], [m, m], [t, t], [0, t]]);
        enCara.unshift(m);
      }
      q([[0, 0], [1, 0], [1, 1], [0, 1]]);
      // Por cada cara, sus nudos hasta el extremo del elemento de la esquina (si no es el de la celda)
      const enX = enCara.map((x) => x * fx).filter((x) => x < D);
      const enY = enCara.map((y) => y * fy).filter((y) => y < D);
      return {
        huella: -1,
        red,
        quads,
        anillo: [],
        bordes: [...(pv === 2 ? [{ n1: g(1, 0), n2: g(1, 1), losa: losaQ }] : []), ...(pu === 2 ? [{ n1: g(0, 1), n2: g(1, 1), losa: losaQ }] : [])],
        subdivididas: [
          { a: nudo(0, 0), b: nudo(D, 0), nudos: enX.map((x) => nudo(x, 0)) },
          { a: nudo(0, 0), b: nudo(0, D), nudos: enY.map((y) => nudo(0, y)) },
        ],
        huellaLados: [],
        refinada: true,
      };
    }
    const F = [0, 6, 12, 18];
    for (let b = 0; b < 3; b++)
      for (let a = 0; a < 3; a++) {
        if (dos && a + b === 0) continue;
        if (dos && a + b === 1) continue;
        cuad([[F[a]!, F[b]!], [F[a + 1]!, F[b]!], [F[a + 1]!, F[b + 1]!], [F[a]!, F[b + 1]!]]);
      }
    if (dos) {
      const f = [0, 2, 4, 6];
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) cuad([[f[a]!, f[b]!], [f[a + 1]!, f[b]!], [f[a + 1]!, f[b + 1]!], [f[a]!, f[b + 1]!]]);
      transicion(6, 12, f);
    }
    transicion(18, 36, F);
    cuad([[18, 18], [36, 18], [36, 36], [18, 36]]);
    const enCara = (dos ? [2, 4, 6, 12, 18] : [6, 12, 18]);
    return {
      huella: -1,
      red,
      quads,
      anillo: [],
      bordes: [
        { n1: g(1, 0), n2: g(1, 1), losa: losaQ },
        { n1: g(0, 1), n2: g(1, 1), losa: losaQ },
      ],
      subdivididas: [
        { a: nudo(0, 0), b: nudo(36, 0), nudos: enCara.map((x) => nudo(x, 0)) },
        { a: nudo(0, 0), b: nudo(0, 36), nudos: enCara.map((y) => nudo(0, y)) },
      ],
      huellaLados: [],
      refinada: true,
    };
  };
  /**
   * ¿Ningún nudo nuevo de la plantilla se haría rígido con un pilar (C2-d, como en `losas.ts`)? Uno
   * de las caras va a la viga aunque toque la huella, salvo que caiga dentro de ella; uno de dentro de
   * la losa, a ≤ ε_snap de una huella, sería rígido, y se pide 1,2·ε_snap (0,6 de separacionRefino):
   * la holgura es sólo para que no lo decida un redondeo.
   */
  const cajasHuellas = (E.huellasPilares ?? []).map((poli) => {
    const c = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of poli) {
      c[0] = Math.min(c[0]!, x);
      c[1] = Math.min(c[1]!, y);
      c[2] = Math.max(c[2]!, x);
      c[3] = Math.max(c[3]!, y);
    }
    return c as [number, number, number, number];
  });
  const lejosDeHuellas = (pl: Plantilla, propia = -1): boolean => {
    const sep = 0.6 * (E.separacionRefino ?? 0);
    if (!E.huellasPilares?.length || !(sep > 0)) return true;
    const enCara = new Set(pl.subdivididas.flatMap((x) => x.nudos));
    // Sólo las huellas cuya caja queda a menos de sep de la de los nudos nuevos: la distancia al borde
    // de una huella no baja de la distancia a su caja, así que las demás no cambian el resultado.
    // (Antes, cada nudo nuevo contra todas las huellas de la planta: la mitad del coste de la rejilla.)
    const holgura = sep + 1e-9;
    const cp = [Infinity, Infinity, -Infinity, -Infinity];
    for (const x of pl.red) {
      if (x.tipo !== "nuevo") continue;
      cp[0] = Math.min(cp[0]!, x.q[0]);
      cp[1] = Math.min(cp[1]!, x.q[1]);
      cp[2] = Math.max(cp[2]!, x.q[0]);
      cp[3] = Math.max(cp[3]!, x.q[1]);
    }
    const cerca: number[] = [];
    for (let m = 0; m < E.huellasPilares.length; m++) {
      const c = cajasHuellas[m]!;
      if (c[0] > cp[2]! + holgura || c[2] < cp[0]! - holgura || c[1] > cp[3]! + holgura || c[3] < cp[1]! - holgura) continue;
      cerca.push(m);
    }
    if (!cerca.length) return true;
    for (let k = 0; k < pl.red.length; k++) {
      const x = pl.red[k]!;
      if (x.tipo !== "nuevo") continue;
      for (const m of cerca) {
        // En la plantilla de cara de un pilar tapado (§10), un nudo de la cara dentro de su huella es
        // rígido con él, como los de la rejilla que ya había en ella
        if (enCara.has(k) && m === propia) continue;
        const c = cajasHuellas[m]!;
        if (x.q[0] < c[0] - holgura || x.q[0] > c[2] + holgura || x.q[1] < c[1] - holgura || x.q[1] > c[3] + holgura) continue;
        const b = bordePoligono(x.q, E.huellasPilares[m]!);
        if (enCara.has(k) ? b.dentro && b.d > 2 * E.epsGeom : b.dentro || b.d < sep) return false;
      }
    }
    return true;
  };
  /**
   * Jacobiano escalado mínimo de los cuadriláteros de una plantilla en las losas, o −1 si alguno no
   * es estrictamente convexo (el motor lo rechazaría: un ángulo de 180° deja el jacobiano positivo
   * en los puntos de Gauss).
   */
  const jacobianoMin = (pl: Plantilla) => {
    let j = Infinity;
    for (const q of pl.quads) {
      if (q.losa < 0) continue;
      const X = q.n.map((n) => posRed(pl.red[n]!));
      for (let m = 0; m < 4; m++) {
        const [A0, B0, C0] = [X[m]!, X[(m + 1) % 4]!, X[(m + 2) % 4]!];
        const [e1, e2] = [Math.hypot(B0[0] - A0[0], B0[1] - A0[1]), Math.hypot(C0[0] - B0[0], C0[1] - B0[1])];
        if (!((B0[0] - A0[0]) * (C0[1] - B0[1]) - (B0[1] - A0[1]) * (C0[0] - B0[0]) > 1e-6 * e1 * e2)) return -1;
      }
      j = Math.min(j, jacobianoEscalado(X));
    }
    return j;
  };
  const plantillas: Plantilla[] = [];
  const sinRefinar: number[] = [];
  const malas: number[] = [];
  for (const { k, mu, mv } of elegidas) {
    for (const p of E.huellas[k]!.puntos) absorbidos[p] = 1;
    const ref = E.refino?.[k] ?? null;
    let pl = redDe(k, mu, mv, ref);
    // Si la de F3 no tiene calidad (sus transiciones, más apretadas), la de F2; si tampoco, sin refinar
    if (pl.refinada && jacobianoMin(pl) < UMBRAL_REFINO.jacobiano) pl = redDe(k, mu, mv, ref, false);
    if (pl.refinada && jacobianoMin(pl) < UMBRAL_REFINO.jacobiano) {
      pl = redDe(k, mu, mv, null);
      sinRefinar.push(k);
    }
    if (jacobianoMin(pl) < JACOBIANO_PLANTILLA) malas.push(k);
    plantillas.push(pl);
  }
  if (malas.length) return { excluir: malas };

  // 8. Esquinas de los paños (fase LV2), por cruces de vigas: las celdas en diagonal con la del cruce
  // que son esquina hacia él llevan todas la plantilla, con los mismos niveles, o ninguna (§8 de la
  // cabecera)
  const esquinasSinRefinar: { huella: number; triangulacion: boolean }[] = [];
  if (E.esquinas && E.fuertes) {
    const sepE = (E.separacionRefino ?? 0) * (1 - HOLGURA);
    /** Partición de la celda (i, j) en u y en v (2: por los puntos medios), y su elemento más fino con k niveles. */
    const particion = (i: number, j: number, k: number) => {
      // La de la triangulación, como si fuera partida en 4
      const regular = estado[celda(i, j)] === REGULAR;
      const pu = !regular || partidaH[i + j * (nu - 1)] === 1 ? 2 : 1;
      const pv = !regular || partidaV[i + j * nu] === 1 ? 2 : 1;
      const lado = Math.min((U[i + 1]! - U[i]!) / pu, (V[j + 1]! - V[j]!) / pv);
      return { pu, pv, menor: PLANTILLA_ESQUINA.tipo === "graduada" ? lado / 2 ** k : lado / (k > 1 ? 9 : 3) } as const;
    };
    /**
     * Plantilla de esquina de la celda (i, j) hacia (su, sv) con k niveles, si cabe; si no, false. Una
     * celda de la triangulación no se refina: true si no impide refinar las demás de su cruce.
     */
    const intentar = (i: number, j: number, su: number, sv: number, k: number): Plantilla | boolean => {
      const c = celda(i, j);
      if (esquinasDe(i, j).length !== 1) return false;
      // Partida en u y en v (la graduada, también sin partir: el elemento de la esquina es entonces la
      // mitad o la celda entera). El elemento más pequeño, de al menos ε_snap
      const { pu, pv, menor } = particion(i, j, k);
      if (menor < sepE / 2) return false;
      // Una de la triangulación junto a un pilar deja su cruce sin refinar; lejos (el cruce de un
      // zuncho), no
      if (estado[c] === IRREGULAR) {
        const q = posicion((su < 0 ? i : i + 1) + (sv < 0 ? j : j + 1) * nu);
        return !(E.huellasPilares ?? []).some((poli) => {
          const b = bordePoligono(q, poli);
          return b.dentro || b.d < 2 * (E.separacionRefino ?? 0) + 2 * menor;
        });
      }
      // La plantilla de una tira de huella (un pilar que asoma del ancho de la viga, LV-8) ya es una
      // red estructurada en la esquina, con lo que asoma dentro: no impide refinar las demás
      if (estado[c] === PLANTILLA) return huellaDeCelda[c]! >= 0 && E.huellas[huellaDeCelda[c]!]!.tira === true;
      if (estado[c] !== REGULAR || (PLANTILLA_ESQUINA.tipo !== "graduada" && (pu !== 2 || pv !== 2))) return false;
      // Ningún nudo nuevo que se haga rígido, y con calidad
      const pl = plantillaEsquina(i, j, su, sv, k, pu, pv);
      return lejosDeHuellas(pl) && jacobianoMin(pl) >= UMBRAL_REFINO.jacobiano ? pl : false;
    };
    const vistos = new Set<number>();
    const sinEsquina = new Map<number, boolean>();
    for (let j = 0; j < nv - 1; j++)
      for (let i = 0; i < nu - 1; i++) {
        const opciones = esquinasDe(i, j);
        if (opciones.length !== 1 || losaCelda[celda(i, j)]! < 0) continue;
        // La celda del cruce y las esquinas hacia ella (en orden)
        const [su, sv] = opciones[0]!;
        const [xi, xj] = [i + su, j + sv];
        const x = xi < 0 || xj < 0 || xi > nu - 2 || xj > nv - 2 ? -1 - (i + j * (nu - 1)) : celda(xi, xj);
        if (vistos.has(x)) continue;
        vistos.add(x);
        const grupo: [number, number, number, number][] = [];
        for (const tv of [-1, 1])
          for (const tu of [-1, 1]) {
            const [a, b] = [xi + tu, xj + tv];
            if (a < 0 || b < 0 || a > nu - 2 || b > nv - 2 || losaCelda[celda(a, b)]! < 0) continue;
            if (esquinasDe(a, b).some(([p, q]) => p === -tu && q === -tv)) grupo.push([a, b, -tu, -tv]);
          }
        // Niveles del cruce: los de un cruce con pilar (alguna huella a menos de `lejos` de una de sus
        // esquinas, como en LV2-g) o, si se da, los de uno sin pilar (el cruce de un zuncho con una viga)
        const conPilar =
          PLANTILLA_ESQUINA.nivelesSinPilar === undefined ||
          grupo.some(([a, b, p, q]) => {
            const Q = posicion((p < 0 ? a : a + 1) + (q < 0 ? b : b + 1) * nu);
            const lejos = 2 * (E.separacionRefino ?? 0) + 2 * particion(a, b, 1).menor;
            return (E.huellasPilares ?? []).some((poli) => {
              const d = bordePoligono(Q, poli);
              return d.dentro || d.d < lejos;
            });
          });
        let k = conPilar ? PLANTILLA_ESQUINA.niveles : PLANTILLA_ESQUINA.nivelesSinPilar!;
        let pls: (Plantilla | boolean)[] = [];
        for (; k >= 1; k--) {
          pls = grupo.map(([a, b, p, q]) => intentar(a, b, p, q, k));
          if (pls.every((pl) => pl !== false)) break;
        }
        if (k < 1) {
          // LV2-g: los pilares del cruce (los que la triangulación tomaría como «junto a un pilar»)
          for (const [a, b, p, q] of grupo) {
            const Q = posicion((p < 0 ? a : a + 1) + (q < 0 ? b : b + 1) * nu);
            const lejos = 2 * (E.separacionRefino ?? 0) + 2 * particion(a, b, 1).menor;
            const triangulacion = estado[celda(a, b)] === IRREGULAR;
            (E.huellasPilares ?? []).forEach((poli, m) => {
              const d = bordePoligono(Q, poli);
              if (d.dentro || d.d < lejos) sinEsquina.set(m, (sinEsquina.get(m) ?? false) || triangulacion);
            });
          }
          continue;
        }
        grupo.forEach(([a, b], m) => {
          const pl = pls[m]!;
          if (typeof pl === "boolean") return;
          estado[celda(a, b)] = PLANTILLA;
          plantillas.push(pl);
        });
      }
    for (const [huella, triangulacion] of [...sinEsquina].sort((a, b) => a[0] - b[0])) esquinasSinRefinar.push({ huella, triangulacion });
  }

  // 10. Caras de las vigas delante de un pilar tapado (fase LV2, LV-8, §10 de la cabecera): la primera
  // fila de celdas a lo largo de la cara, en tercios hacia ella, con la transición en los extremos
  const tapadasSinRefinar: number[] = [];
  if (E.esquinas && E.fuertes && E.tapadas?.length && E.huellasPilares?.length) {
    const sepT = E.separacionRefino ?? 0;
    /**
     * Tramo de celdas junto a una cara: con `vertical`, la cara es la línea U[linea] y el tramo recorre
     * las filas a0…a1; si no, la línea V[linea] y las columnas. `s`: el lado de la losa.
     */
    interface TramoCara {
      vertical: boolean;
      linea: number;
      s: 1 | -1;
      a0: number;
      a1: number;
    }
    /** Nudo de la rejilla en la línea del tramo `a` sobre la cara (lado 0) o sobre la línea de enfrente (lado 1). */
    const nodoRej = (t: TramoCara, a: number, lado: 0 | 1) => {
      const l = lado === 0 ? t.linea : t.linea + t.s;
      return t.vertical ? l + a * nu : a + l * nu;
    };
    const celdaT = (t: TramoCara, a: number) => (t.vertical ? celda(t.s > 0 ? t.linea : t.linea - 1, a) : celda(a, t.s > 0 ? t.linea : t.linea - 1));
    const lerp = (P0: Vec2, P1: Vec2, x: number): Vec2 => [P0[0] + x * (P1[0] - P0[0]), P0[1] + x * (P1[1] - P0[1])];
    /** ¿Está partida la arista de la rejilla entre dos nudos contiguos? (como `partida`, que se define después) */
    const partida = (n1: number, n2: number): boolean => {
      const n = Math.min(n1, n2);
      const [i, j] = [n % nu, Math.floor(n / nu)];
      return Math.abs(n1 - n2) === 1 ? partidaH[i + j * (nu - 1)] === 1 : partidaV[i + j * nu] === 1;
    };
    /**
     * La plantilla de un tramo, en las coordenadas (a, na, nb) de cada celda: na, la fracción a lo
     * largo de la cara en cuartos; nb, la distancia a la cara en doceavos de la celda. Con la celda
     * partida hacia la losa, el primer tramo es su mitad (tercios en 2, 4 y 6); si no, la celda entera
     * (4, 8 y 12). O false si las celdas no van partidas igual hacia la losa, o es una sola sin partir
     * a lo largo de la cara.
     */
    const plantillaCara = (t: TramoCara): Plantilla | false => {
      const pu = partida(nodoRej(t, t.a0, 0), nodoRej(t, t.a0, 1));
      for (let a = t.a0 + 1; a <= t.a1 + 1; a++) if (partida(nodoRej(t, a, 0), nodoRej(t, a, 1)) !== pu) return false;
      const pv = (a: number) => partida(nodoRej(t, a, 0), nodoRej(t, a + 1, 0));
      const sola = t.a0 === t.a1;
      if (sola && !pv(t.a0)) return false;
      const red: NudoPlantilla[] = [];
      const indice = new Map<string, number>();
      const pos = (a: number, na: number, nb: number): Vec2 => {
        const [P00, P10, P01, P11] = [posicion(nodoRej(t, a, 0)), posicion(nodoRej(t, a, 1)), posicion(nodoRej(t, a + 1, 0)), posicion(nodoRej(t, a + 1, 1))];
        return lerp(lerp(P00, P10, nb / 12), lerp(P01, P11, nb / 12), na / 4);
      };
      const nudo = (a: number, na: number, nb: number): number => {
        if (na === 4) [a, na] = [a + 1, 0];
        const k = `${a},${na},${nb}`;
        let r = indice.get(k);
        if (r !== undefined) return r;
        if (na === 0 && nb === 0) red.push({ tipo: "nudo", n: nodoRej(t, a, 0) });
        else if (na === 0 && nb === 12) red.push({ tipo: "nudo", n: nodoRej(t, a, 1) });
        else if (na === 0 && nb === 6 && (a === t.a0 || a === t.a1 + 1)) red.push({ tipo: "medio", n1: nodoRej(t, a, 0), n2: nodoRej(t, a, 1) });
        else if (na === 2 && nb === 12) red.push({ tipo: "medio", n1: nodoRej(t, a, 1), n2: nodoRej(t, a + 1, 1) });
        else red.push({ tipo: "nuevo", q: pos(a, na, nb) });
        indice.set(k, (r = red.length - 1));
        return r;
      };
      const quads: Plantilla["quads"] = [];
      const cuad = (v: readonly (readonly [number, number, number])[], losaQ: number) => {
        const n = v.map(([a, na, nb]) => nudo(a, na, nb)) as [number, number, number, number];
        const X = n.map((k) => posRed(red[k]!));
        let area = 0;
        for (let m = 0; m < 4; m++) area += X[m]![0] * X[(m + 1) % 4]![1] - X[(m + 1) % 4]![0] * X[m]![1];
        quads.push({ n: area > 0 ? n : [n[0], n[3], n[2], n[1]], losa: losaQ });
      };
      const XF: [number, number, number, number] = pu ? [0, 2, 4, 6] : [0, 4, 8, 12];
      const bordes: Plantilla["bordes"] = [];
      const subdivididas: Plantilla["subdivididas"] = [];
      if (pu) for (const a of [t.a0, t.a1 + 1]) bordes.push({ n1: nodoRej(t, a, 0), n2: nodoRej(t, a, 1), losa: losa[celdaT(t, Math.min(a, t.a1))]! });
      for (let a = t.a0; a <= t.a1; a++) {
        const losaQ = losa[celdaT(t, a)]!;
        const p = pv(a);
        // Dónde va fina (los tercios de lado a lado) y dónde la transición [lado fino, lado grueso]
        let fino: [number, number][] = [];
        const trans: [number, number][] = [];
        if (sola) trans.push([2, 0], [2, 4]);
        else if (a === t.a0) {
          if (p) {
            trans.push([2, 0]);
            fino.push([2, 4]);
          } else trans.push([4, 0]);
        } else if (a === t.a1) {
          if (p) {
            fino.push([0, 2]);
            trans.push([2, 4]);
          } else trans.push([0, 4]);
        } else fino = p ? [[0, 2], [2, 4]] : [[0, 4]];
        for (const [y0, y1] of fino) for (let m = 0; m < 3; m++) cuad([[a, y0, XF[m]!], [a, y0, XF[m + 1]!], [a, y1, XF[m + 1]!], [a, y1, XF[m]!]], losaQ);
        for (const [yf, yc] of trans) {
          const ym = (yf + yc) / 2;
          const [x0, x1, x2, x3] = XF;
          cuad([[a, yf, x0], [a, yf, x1], [a, ym, x1], [a, yc, x0]], losaQ);
          cuad([[a, yf, x1], [a, yf, x2], [a, ym, x2], [a, ym, x1]], losaQ);
          cuad([[a, yf, x2], [a, yf, x3], [a, yc, x3], [a, ym, x2]], losaQ);
          cuad([[a, ym, x1], [a, ym, x2], [a, yc, x3], [a, yc, x0]], losaQ);
        }
        // Lo que queda de la celda hacia la losa, entero
        if (pu) {
          const ys = p ? [0, 2, 4] : [0, 4];
          for (let m = 0; m + 1 < ys.length; m++) cuad([[a, ys[m]!, 6], [a, ys[m]!, 12], [a, ys[m + 1]!, 12], [a, ys[m + 1]!, 6]], losaQ);
        }
        if (p) bordes.push({ n1: nodoRej(t, a, 1), n2: nodoRej(t, a + 1, 1), losa: losaQ });
        if (p) subdivididas.push({ a: nudo(a, 0, 0), b: nudo(a + 1, 0, 0), nudos: [nudo(a, 2, 0)] });
        // La arista entre dos celdas del tramo (por ella puede ir una cara de franja): por los tercios
        if (a > t.a0) subdivididas.push({ a: nudo(a, 0, 0), b: nudo(a, 0, 12), nudos: XF.slice(1, pu ? 4 : 3).map((nb) => nudo(a, 0, nb)) });
      }
      return { huella: -1, red, quads, anillo: [], bordes, subdivididas, huellaLados: [], refinada: true };
    };
    const usadas = new Set<number>();
    for (const m of E.tapadas) {
      const poli = E.huellasPilares[m];
      if (!poli) continue;
      let [bu0, bv0, bu1, bv1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const q of poli) {
        const [u, v] = uv(q);
        [bu0, bv0, bu1, bv1] = [Math.min(bu0, u), Math.min(bv0, v), Math.max(bu1, u), Math.max(bv1, v)];
      }
      const tramos: TramoCara[] = [];
      const enTramos = new Set<number>();
      let candidatas = false;
      let fallo = false;
      for (const vertical of [true, false]) {
        const [L, f, B0, B1, LA, A0, A1] = vertical ? [U, fU, bu0, bu1, V, bv0, bv1] : [V, fV, bv0, bv1, U, bu0, bu1];
        for (let l = 1; l < L.length - 1; l++) {
          if (!f[l] || L[l]! < B0 - sepT || L[l]! > B1 + sepT) continue;
          for (const s of [-1, 1] as const) {
            const t: TramoCara = { vertical, linea: l, s, a0: 0, a1: 0 };
            /**
             * La celda `a` junto a la cara: 0 si no es de losa con el ancho (fuera de las losas) al
             * otro lado, o es una esquina de paño (va por 8); 1 si es regular y libre; 2 si no.
             */
            const vale = (a: number): 0 | 1 | 2 => {
              if (a < 0 || a > LA.length - 2) return 0;
              const c = celdaT(t, a);
              const [ci, cj] = vertical ? [s > 0 ? l : l - 1, a] : [a, s > 0 ? l : l - 1];
              const otra = vertical ? [s > 0 ? l - 1 : l, a] : [a, s > 0 ? l - 1 : l];
              if (losaCelda[c]! < 0 || !fueraDeLosas(otra[0]!, otra[1]!) || esquinasDe(ci, cj).length) return 0;
              return estado[c] === REGULAR && !usadas.has(c) ? 1 : 2;
            };
            const filas: number[] = [];
            const lo = Math.max(0, tramo(LA, A0 + tol));
            const hi = Math.min(LA.length - 2, tramo(LA, A1 - tol));
            for (let a = lo; a <= hi; a++) {
              const v = vale(a);
              if (v === 0) continue;
              candidatas = true;
              if (v === 2) fallo = true;
              else filas.push(a);
            }
            // Las filas seguidas, un tramo cada una. Una sola celda sin partir a lo largo de la cara
            // no cabe: el tramo crece una celda a cada lado, si son también de losa junto al ancho y
            // regulares
            for (let i = 0; i < filas.length; ) {
              let j = i;
              while (j + 1 < filas.length && filas[j + 1] === filas[j]! + 1) j++;
              let [a0, a1] = [filas[i]!, filas[j]!];
              i = j + 1;
              if (a0 === a1 && !partida(nodoRej(t, a0, 0), nodoRej(t, a0 + 1, 0))) {
                if (vale(a0 - 1) === 1 && vale(a0 + 1) === 1 && !enTramos.has(celdaT(t, a0 - 1)) && !enTramos.has(celdaT(t, a0 + 1))) [a0, a1] = [a0 - 1, a0 + 1];
                else {
                  fallo = true;
                  continue;
                }
              }
              for (let a = a0; a <= a1; a++) enTramos.add(celdaT(t, a));
              tramos.push({ ...t, a0, a1 });
            }
          }
        }
      }
      const pls: Plantilla[] = [];
      for (const t of tramos) {
        if (fallo) break;
        const pl = plantillaCara(t);
        if (pl && lejosDeHuellas(pl, m) && jacobianoMin(pl) >= UMBRAL_REFINO.jacobiano) pls.push(pl);
        else fallo = true;
      }
      if (fallo) {
        if (candidatas) tapadasSinRefinar.push(m);
        continue;
      }
      tramos.forEach((t, i) => {
        for (let a = t.a0; a <= t.a1; a++) {
          const c = celdaT(t, a);
          estado[c] = PLANTILLA;
          usadas.add(c);
        }
        plantillas.push(pls[i]!);
      });
    }
  }

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
  return { U, V, estado, losa, puntoNudo, nudoPunto, absorbidos, enLinea, interfaz, plantillas, sinRefinar, esquinasSinRefinar, tirasSinPlantilla, tapadasSinRefinar, posicion, celdaDe, toca, cubre, estadosArista, partida };
}
