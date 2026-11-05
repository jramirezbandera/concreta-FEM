/**
 * Casi alineados y «Alinear» (MA5, `docs/fem3d/modelado.md` §2.5 y §7).
 *
 * Un dibujo calcado de un DXF trae descuadres de milímetros a centímetros (x = 4,26 / 4,28 / 4,2821;
 * un tramo de viga girado 0,1°). El compilador no los une (sólo a ε_geom) y la malla los resuelve con
 * láminas de décimas de milímetro: racimos de miles de nudos junto a las caras de franja y los anchos
 * de las vigas. El arreglo es en el dibujo, no en el mallador: este módulo dice qué está casi alineado
 * (el aviso `sensatez/casi-alineados` de `fem validar`) y propone dónde llevarlo (la orden «Alinear»
 * de la app y `fem alinear`, que sólo escribe si se le pide).
 *
 * - **Qué se mira:** los pilares (su punto fijo), los vértices de vigas, muros, apoyos lineales,
 *   losas (contorno, huecos y ábacos), paños y bandas, los apoyos, los extremos de las barras, las
 *   cargas (puntual, lineal y zona) y los ejes de replanteo guardados. Lo que ensucia la malla son
 *   las rectas según los ejes: un vértice de una polilínea o un anillo cuenta en una dirección sólo si
 *   uno de sus tramos va casi según ella (a ≤ 10°) y no es un trozo de curva (gira poco y hacia el
 *   mismo lado antes y después); los pilares, los puntos sueltos y los extremos de una polilínea
 *   abierta junto a algo (a menos de la tolerancia de un pilar o de un vértice de otra pieza, o de un
 *   tramo según la dirección que pasa por su lado: una viga que acaba a milímetros del borde de la
 *   losa) cuentan siempre. Dos vértices de dos arcos que coinciden por casualidad en una
 *   coordenada no son un casi alineado. Lo que está en el mismo punto que algo que se mueve, va con
 *   ello (una viga oblicua que acaba en un pilar).
 * - **En qué dirección:** las dos de los ejes (`direccionEjes`: X e Y salvo en una planta girada). En
 *   cada una, las coordenadas de todo el modelo, ordenadas, se agrupan si van seguidas a ≤ la
 *   tolerancia; un grupo más ancho que la tolerancia se parte por su mayor hueco hasta que ninguno lo
 *   es. Así nada se mueve más que la tolerancia en cada coordenada.
 * - **Qué coincide:** dos puntos de un grupo coinciden si tienen la misma coordenada (a 1e-9 m) o si
 *   comparten una cara: la de un pilar (su huella, con cada sección de sus tramos) o la de un tramo de
 *   viga o de muro que va según la otra dirección (eje ± b/2). Un pilar de 35 enrasado con otro de 30
 *   no está casi alineado, ni la losa que llega a la cara de una viga. Un grupo con más de una clase de
 *   puntos que coinciden es un casi alineado si dos de ellas están en una misma planta (un pilar está
 *   en las de sus tramos; un eje, en todas).
 * - **Adónde se lleva:** al eje guardado del grupo si lo hay (los ejes guardados no se mueven); si no,
 *   a la clase con más piezas (luego más puntos, luego el número más redondo y luego el menor). Cada
 *   otra clase se traslada entera lo que separa su valor más cercano del de la elegida, así que lo que
 *   coincidía sigue coincidiendo. Con los ejes según X e Y, el número que queda es el mismo double.
 * - **Tramos casi rectos:** un tramo con sus dos extremos en un grupo y en clases distintas (casi
 *   paralelo a un eje) se dice con su desvío y su ángulo; al alinear, queda recto.
 * - **Lo que se mide en un tramo:** los huecos de los muros y los tramos de las cargas de viga se
 *   vuelven a medir en su tramo (`reestacionar`); dos vértices seguidos que acaban en el mismo punto
 *   quedan en uno.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { anchoViga, huellaSeccion } from "../agente/render/modelo.ts";
import { direccionEjes } from "../compilador/ejes.ts";
import type { CargaFisica, ModeloFisico, Pilar, Vec2 } from "../compilador/fisico.ts";
import { reestacionar } from "./estaciones.ts";
import type { Operacion } from "./operaciones.ts";
import { conValor, indiceIds, lista, type Coleccion, type Objeto } from "./referencias.ts";

/** La tolerancia por defecto (MA-e, decidida el 2026-10-15), m. */
export const TOLERANCIA_ALINEAR = 0.03;
/** Dos coordenadas a menos de esto coinciden, m. */
export const COINCIDEN = 1e-9;
/** Un tramo con un desvío así o menor respecto a un eje es «casi recto», grados. */
const ANGULO_CASI_RECTO = 10;

type Ruta = readonly (string | number)[];

/** Un punto del modelo que se puede alinear: el objeto, dónde está en él y dónde está. */
export interface PuntoAlineable {
  coleccion: Coleccion;
  id: string;
  /** ["x"] (x e y del objeto), ["inicio"] o ["fin"] (barra), ["desde"] o ["hasta"] (banda, eje), o la ruta de un punto de una lista. */
  ruta: Ruta;
  p: Vec2;
}

interface Entrada extends PuntoAlineable {
  /** Las plantas en las que está (null: en todas, como un eje). */
  plantas: ReadonlySet<string> | null;
  /** Un eje guardado según esa dirección: manda y no se mueve. */
  ancla: [boolean, boolean];
  /** No cuenta en esa dirección (el extremo de un eje guardado, a lo largo de él). */
  omitir: [boolean, boolean];
  /** Las coordenadas que comparte con lo que coincide: la suya y sus caras. */
  rasgos: [number[], number[]];
}

/** Un casi alineado: los puntos de una recta de los ejes que no coinciden por menos de la tolerancia. */
export interface GrupoAlineado {
  /** 0: la coordenada según la dirección de los ejes con letra (x con los ejes según X); 1: la otra (y). */
  eje: 0 | 1;
  /** «x» o «y» (con los ejes girados, «s» y «t»). */
  nombre: string;
  /** Adónde se lleva todo. */
  valor: number;
  /** Cada valor distinto, con las piezas que están en él (por id) y si es un eje guardado. */
  valores: { valor: number; objetos: string[]; ancla: boolean }[];
  /** Lo que le falta a lo más alejado para coincidir, m. */
  falta: number;
  /** Las plantas en las que hay puntos que no coinciden. */
  plantas: string[];
  /** Los tramos casi rectos (casi paralelos a la recta): su desvío, m, y su ángulo, grados. */
  tramos: { id: string; de: Vec2; a: Vec2; desvio: number; angulo: number }[];
  /** Ejes guardados del grupo que no se mueven y no quedan en el valor. */
  fijos: string[];
}

/** Un punto que «Alinear» mueve. */
export interface Movimiento {
  coleccion: Coleccion;
  id: string;
  ruta: Ruta;
  de: Vec2;
  a: Vec2;
}

export interface PropuestaAlinear {
  tolerancia: number;
  /** La dirección de los ejes con letra, grados desde +X. */
  direccion: number;
  grupos: GrupoAlineado[];
  movimientos: Movimiento[];
  /** Lo que no se ha podido alinear y por qué. */
  avisos: string[];
  /** El lote de `cambiar` que lo hace (un paso de deshacer), o null si no hay nada que mover. */
  operacion: Operacion | null;
  /** El modelo alineado (el mismo objeto si no cambia nada). */
  modelo: ModeloFisico;
  /** Casi alineados que quedan en el modelo alineado (al partir un grupo ancho, o lo que no se pudo mover). */
  quedan: number;
}

// ─── Coordenadas ────────────────────────────────────────────────────────────────────────────────

/** Las dos direcciones: d (la de los ejes con letra) y n, y las coordenadas de un punto en ellas. */
class Ejes {
  readonly theta: number;
  readonly d: Vec2;
  readonly n: Vec2;
  constructor(theta: number) {
    this.theta = theta;
    const r = (theta * Math.PI) / 180;
    this.d = theta === 0 ? [1, 0] : [Math.cos(r), Math.sin(r)];
    this.n = theta === 0 ? [0, 1] : [-this.d[1], this.d[0]];
  }
  c(p: Vec2, k: 0 | 1): number {
    if (this.theta === 0) return p[k];
    const u = k === 0 ? this.d : this.n;
    return p[0] * u[0] + p[1] * u[1];
  }
  /** El punto p con su coordenada k desplazada `delta`. */
  mover(p: Vec2, k: 0 | 1, nuevo: number): Vec2 {
    if (this.theta === 0) return k === 0 ? [nuevo, p[1]] : [p[0], nuevo];
    const u = k === 0 ? this.d : this.n;
    const delta = nuevo - this.c(p, k);
    return [limpio(p[0] + delta * u[0]), limpio(p[1] + delta * u[1])];
  }
}

/** Sin el ruido de la suma: a 1e-6 m si está a menos de 1e-9 de él. */
function limpio(x: number): number {
  const r = Math.round(x * 1e6) / 1e6;
  return Math.abs(r - x) < 1e-9 ? r + 0 : x;
}

/** Cuántos decimales tiene un número (hasta 9): el más redondo, el de menos. */
function decimales(x: number): number {
  for (let k = 0; k <= 9; k++) {
    const e = 10 ** k;
    if (Math.abs(Math.round(x * e) - x * e) < 1e-6) return k;
  }
  return 10;
}

const igual = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

// ─── Los puntos del modelo ──────────────────────────────────────────────────────────────────────

interface Recogida {
  entradas: Entrada[];
  /** Tramos (dos entradas seguidas de una polilínea o un anillo), por id. */
  tramos: { id: string; a: number; b: number }[];
}

function recoger(m: ModeloFisico, E: Ejes, tol: number): Recogida {
  const orden = new Map(m.plantas.map((p, i) => [p.id, i]));
  const entradas: Entrada[] = [];
  const tramos: { id: string; a: number; b: number }[] = [];
  const extremos: number[] = [];
  /** Los tramos que van según cada dirección (los que cuentan en ella). */
  const segun: [[number, number][], [number, number][]] = [[], []];
  const una = (p: string) => new Set([p]);
  /** Las plantas de un objeto vertical, de la de su cabeza a la de su base (van de arriba abajo). */
  const entre = (desde: string, hasta: string): ReadonlySet<string> | null => {
    const [a, b] = [orden.get(desde), orden.get(hasta)];
    if (a === undefined || b === undefined) return new Set([desde, hasta]);
    return new Set(m.plantas.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id));
  };
  const nueva = (coleccion: Coleccion, id: string, ruta: Ruta, p: Vec2, plantas: ReadonlySet<string> | null): number => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return -1;
    entradas.push({ coleccion, id, ruta, p, plantas, ancla: [false, false], omitir: [false, false], rasgos: [[E.c(p, 0)], [E.c(p, 1)]] });
    return entradas.length - 1;
  };
  /**
   * Una lista de puntos (`anillo`, cerrada). Un vértice sólo cuenta en una dirección si uno de sus
   * tramos va casi según ella (a ≤ ANGULO_CASI_RECTO) y no es un trozo de una curva: lo que ensucia la
   * malla son las rectas según los ejes, no dos vértices de dos arcos que coinciden por casualidad en
   * una coordenada. Los extremos de una polilínea abierta, si acaban junto a algo (al final). Con
   * `ancho`, las caras de esos tramos (eje ± ancho/2) son rasgos de sus extremos.
   */
  const linea = (coleccion: Coleccion, id: string, campo: Ruta, ps: readonly Vec2[] | undefined, plantas: ReadonlySet<string> | null, anillo: boolean, ancho = 0) => {
    if (!ps) return;
    const ix = ps.map((p, i) => nueva(coleccion, id, [...campo, i], p, plantas));
    for (const i of ix) if (i >= 0) entradas[i]!.omitir = [true, true];
    // Los extremos de una polilínea abierta, por si acaban junto a un pilar (se mira al final)
    if (!anillo) for (const i of [ix[0], ix.at(-1)]) if (i !== undefined && i >= 0) extremos.push(i);
    const n = ix.length;
    const segs: [number, number][] = [];
    for (let i = 0; i + 1 < n || (anillo && n > 2 && i < n); i++) {
      const [a, b] = [ix[i]!, ix[(i + 1) % n]!];
      if (a < 0 || b < 0 || a === b || igual(entradas[a]!.p, entradas[b]!.p)) continue;
      segs.push([a, b]);
    }
    const dir = ([a, b]: [number, number]) => Math.atan2(entradas[b]!.p[1] - entradas[a]!.p[1], entradas[b]!.p[0] - entradas[a]!.p[0]);
    const giro = (s: [number, number], t: [number, number]) => {
      let g = ((dir(t) - dir(s)) * 180) / Math.PI;
      while (g > 180) g -= 360;
      while (g <= -180) g += 360;
      return g;
    };
    const cerrada = anillo && segs.length === n;
    segs.forEach((sg, j) => {
      const [a, b] = sg;
      tramos.push({ id, a, b });
      // Un trozo de curva: gira lo mismo, poco y hacia el mismo lado, antes y después
      const ant = j > 0 ? segs[j - 1] : cerrada ? segs.at(-1) : undefined;
      const sig = j + 1 < segs.length ? segs[j + 1] : cerrada ? segs[0] : undefined;
      if (ant && sig && ant[1] === a && sig[0] === b) {
        const [g1, g2] = [giro(ant, sg), giro(sg, sig)];
        const curva = (g: number) => Math.abs(g) > 0.5 && Math.abs(g) < 45;
        if (curva(g1) && curva(g2) && Math.sign(g1) === Math.sign(g2)) return;
      }
      for (const k of [0, 1] as const) {
        const [ca, cb] = [E.c(entradas[a]!.p, k), E.c(entradas[b]!.p, k)];
        const largo = Math.abs(E.c(entradas[a]!.p, (1 - k) as 0 | 1) - E.c(entradas[b]!.p, (1 - k) as 0 | 1));
        if (Math.abs(ca - cb) > tol || (Math.atan2(Math.abs(ca - cb), largo) * 180) / Math.PI > ANGULO_CASI_RECTO) continue;
        entradas[a]!.omitir[k] = entradas[b]!.omitir[k] = false;
        segun[k].push([a, b]);
        if (ancho <= 0) continue;
        entradas[a]!.rasgos[k].push(ca - ancho / 2, ca + ancho / 2);
        entradas[b]!.rasgos[k].push(cb - ancho / 2, cb + ancho / 2);
      }
    });
  };
  const seccion = (id: string) => m.secciones.find((s) => s.id === id);

  for (const p of m.pilares ?? []) {
    const i = nueva("pilares", p.id, ["x"], [p.x, p.y], entre(p.desde, p.hasta));
    if (i < 0) continue;
    const e = entradas[i]!;
    for (const sid of new Set([p.seccion, ...(p.tramos ?? []).map((t) => t.seccion)])) {
      const h = huellaSeccion(p as Pilar, seccion(sid));
      if (!h) continue;
      for (const k of [0, 1] as const) {
        if ("anillo" in h) {
          const cs = h.anillo.map((q) => E.c(q, k));
          const [a, b] = [Math.min(...cs), Math.max(...cs)];
          e.rasgos[k].push(a, b, (a + b) / 2);
        } else {
          const c = E.c(h.centro, k);
          e.rasgos[k].push(c - h.radio, c + h.radio, c);
        }
      }
    }
  }
  for (const v of m.vigas ?? []) linea("vigas", v.id, ["puntos"], v.puntos, una(v.planta), false, anchoViga(seccion(v.seccion)));
  for (const w of m.muros ?? []) linea("muros", w.id, ["puntos"], w.puntos, entre(w.desde, w.hasta), false, w.espesor);
  for (const a of m.apoyosLineales ?? []) linea("apoyosLineales", a.id, ["puntos"], a.puntos, una(a.planta), false);
  for (const l of m.losas ?? []) {
    linea("losas", l.id, ["contorno"], l.contorno, una(l.planta), true);
    (l.huecos ?? []).forEach((h, j) => linea("losas", l.id, ["huecos", j], h, una(l.planta), true));
    (l.reticular?.abacos ?? []).forEach((h, j) => linea("losas", l.id, ["reticular", "abacos", j], h, una(l.planta), true));
  }
  for (const l of m.panos ?? []) {
    linea("panos", l.id, ["contorno"], l.contorno, una(l.planta), true);
    (l.huecos ?? []).forEach((h, j) => linea("panos", l.id, ["huecos", j], h, una(l.planta), true));
  }
  for (const a of m.apoyos ?? []) nueva("apoyos", a.id, ["x"], [a.x, a.y], una(a.planta));
  for (const b of m.barras ?? []) {
    nueva("barras", b.id, ["inicio"], [b.inicio.x, b.inicio.y], una(b.inicio.planta));
    nueva("barras", b.id, ["fin"], [b.fin.x, b.fin.y], una(b.fin.planta));
  }
  for (const b of m.bandas ?? []) linea("bandas", b.id, [], [b.desde, b.hasta], una(b.planta), false);
  for (const c of m.cargas ?? []) {
    if (c.tipo === "puntual") nueva("cargas", c.id, ["x"], [c.x, c.y], una(c.planta));
    else if (c.tipo === "lineal") linea("cargas", c.id, ["puntos"], c.puntos, una(c.planta), false);
    else if (c.tipo === "superficie" && c.zona) linea("cargas", c.id, ["zona"], c.zona, una(c.planta), true);
  }
  for (const x of m.ejes ?? []) {
    const [a, b] = [nueva("ejes", x.id, ["desde"], x.desde, null), nueva("ejes", x.id, ["hasta"], x.hasta, null)];
    if (a < 0 || b < 0) continue;
    const [A, B] = [entradas[a]!, entradas[b]!];
    for (const k of [0, 1] as const)
      if (Math.abs(E.c(A.p, k) - E.c(B.p, k)) <= COINCIDEN) {
        // Un eje según una dirección manda en ella; a lo largo de él, sus extremos no cuentan
        A.ancla[k] = B.ancla[k] = true;
        A.omitir[(1 - k) as 0 | 1] = B.omitir[(1 - k) as 0 | 1] = true;
      }
    if (!A.ancla[0] && !A.ancla[1]) tramos.push({ id: x.id, a, b });
  }
  // El extremo de una polilínea abierta cuenta si acaba junto a algo: a ≤ tol de un pilar o de un vértice
  // de otra pieza (en las dos direcciones), o de un tramo según una dirección que pasa por su lado (una
  // viga que acaba a milímetros del borde de la losa; en ésa)
  // Junto a un pilar o a un vértice de otra pieza (por celdas de lado tol)
  const celda = (q: Vec2) => [Math.floor(q[0] / tol), Math.floor(q[1] / tol)] as const;
  const celdas = new Map<string, number[]>();
  entradas.forEach((e, i) => {
    if (e.coleccion === "ejes") return;
    const [cx, cy] = celda(e.p);
    const k = `${cx} ${cy}`;
    celdas.set(k, [...(celdas.get(k) ?? []), i]);
  });
  for (const i of extremos) {
    const e = entradas[i]!;
    const [cx, cy] = celda(e.p);
    let cerca = false;
    for (let dx = -1; dx <= 1 && !cerca; dx++)
      for (let dy = -1; dy <= 1 && !cerca; dy++)
        for (const j of celdas.get(`${cx + dx} ${cy + dy}`) ?? []) {
          const o = entradas[j]!;
          if (o.id === e.id && o.coleccion === e.coleccion) continue;
          if (Math.abs(o.p[0] - e.p[0]) <= tol && Math.abs(o.p[1] - e.p[1]) <= tol && comparten(e.plantas, o.plantas)) {
            cerca = true;
            break;
          }
        }
    if (cerca) e.omitir = [false, false];
  }
  for (const k of [0, 1] as const) {
    const o = (1 - k) as 0 | 1;
    const ts = segun[k].map(([a, b]) => {
      const [A, B] = [entradas[a]!.p, entradas[b]!.p];
      return { a, b, c: Math.min(E.c(A, k), E.c(B, k)), d: Math.max(E.c(A, k), E.c(B, k)), o0: Math.min(E.c(A, o), E.c(B, o)), o1: Math.max(E.c(A, o), E.c(B, o)) };
    });
    ts.sort((x, y) => x.c - y.c);
    const cs = ts.map((t) => t.c);
    for (const i of extremos) {
      const e = entradas[i]!;
      if (!e.omitir[k]) continue;
      const [v, w] = [E.c(e.p, k), E.c(e.p, o)];
      // Los tramos con su menor coordenada en [v − 2·tol, v + tol] (un tramo según k no se separa más de tol)
      let lo = 0;
      let hi = cs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cs[mid]! < v - 2 * tol) lo = mid + 1;
        else hi = mid;
      }
      for (let j = lo; j < ts.length && ts[j]!.c <= v + tol; j++) {
        const t = ts[j]!;
        if (t.a === i || t.b === i || v < t.c - tol || v > t.d + tol || w < t.o0 - tol || w > t.o1 + tol) continue;
        if (!comparten(e.plantas, entradas[t.a]!.plantas)) continue;
        e.omitir[k] = false;
        break;
      }
    }
  }
  // Las listas `bandas` usan la ruta [] con el índice: desde/hasta
  for (const e of entradas) if (e.coleccion === "bandas" && e.ruta.length === 1) e.ruta = [e.ruta[0] === 0 ? "desde" : "hasta"];
  return { entradas, tramos };
}

// ─── Los grupos ─────────────────────────────────────────────────────────────────────────────────

/** Los rangos [lo, hi] de `vs` (ordenados) que van seguidos a ≤ tol. */
function cadenas(vs: readonly number[], tol: number): [number, number][] {
  const r: [number, number][] = [];
  let lo = 0;
  for (let i = 1; i <= vs.length; i++) {
    if (i === vs.length || vs[i]! - vs[i - 1]! > tol) {
      if (i - 1 > lo) r.push([lo, i - 1]);
      lo = i;
    }
  }
  return r;
}

interface Clase {
  miembros: number[];
  ids: Set<string>;
  plantas: Set<string> | null;
  ancla: boolean;
  /** Valores distintos (a COINCIDEN), con cuántos puntos tiene cada uno. */
  valores: { valor: number; n: number; ids: Set<string> }[];
  principal: number;
}

const comparten = (a: ReadonlySet<string> | null, b: ReadonlySet<string> | null) => !a || !b || [...a].some((x) => b.has(x));

/** Lo que es mejor para quedarse donde está: eje guardado, más piezas, más puntos, más redondo, menor. */
function mejor(a: Clase, b: Clase): number {
  return Number(b.ancla) - Number(a.ancla) || b.ids.size - a.ids.size || b.miembros.length - a.miembros.length || decimales(a.principal) - decimales(b.principal) || a.principal - b.principal;
}

interface Analisis {
  grupos: GrupoAlineado[];
  /** Por entrada, su coordenada nueva en cada dirección (si se mueve). */
  nuevas: Map<number, [number | undefined, number | undefined]>;
  recogida: Recogida;
  ejes: Ejes;
}

function analizar(m: ModeloFisico, tol: number): Analisis {
  const E = new Ejes(direccionEjes(m));
  const rec = recoger(m, E, tol);
  const { entradas } = rec;
  const grupos: GrupoAlineado[] = [];
  const nuevas = new Map<number, [number | undefined, number | undefined]>();
  const tramosDe = new Map<number, number[]>();
  rec.tramos.forEach((t, i) => {
    for (const e of [t.a, t.b]) tramosDe.set(e, [...(tramosDe.get(e) ?? []), i]);
  });
  const ordenPlantas = new Map(m.plantas.map((p, i) => [p.id, i]));

  for (const k of [0, 1] as const) {
    const lista = entradas.map((e, i) => ({ v: E.c(e.p, k), i })).filter((x) => !entradas[x.i]!.omitir[k]);
    lista.sort((a, b) => a.v - b.v || a.i - b.i);
    const vs = lista.map((x) => x.v);
    for (const [lo, hi] of cadenas(vs, tol)) {
      if (vs[hi]! - vs[lo]! <= COINCIDEN) continue;
      const miembros = lista.slice(lo, hi + 1).map((x) => x.i);
      // Clases: lo que comparte una coordenada (la suya o una cara)
      const padre = miembros.map((_, j) => j);
      const raiz = (j: number): number => (padre[j] === j ? j : (padre[j] = raiz(padre[j]!)));
      const rs = miembros.flatMap((e, j) => entradas[e]!.rasgos[k].map((r) => ({ r, j })));
      rs.sort((a, b) => a.r - b.r || a.j - b.j);
      for (let i = 1; i < rs.length; i++) if (rs[i]!.r - rs[i - 1]!.r <= COINCIDEN) padre[raiz(rs[i]!.j)] = raiz(rs[i - 1]!.j);
      const porRaiz = new Map<number, number[]>();
      miembros.forEach((_, j) => porRaiz.set(raiz(j), [...(porRaiz.get(raiz(j)) ?? []), j]));
      if (porRaiz.size < 2) continue;
      const clases: Clase[] = [...porRaiz.values()].map((js) => {
        const ms = js.map((j) => miembros[j]!);
        let plantas: Set<string> | null = new Set();
        const valores: Clase["valores"] = [];
        for (const e of ms) {
          const x = entradas[e]!;
          if (!x.plantas) plantas = null;
          else if (plantas) for (const p of x.plantas) plantas.add(p);
          const v = E.c(x.p, k);
          const ya = valores.find((w) => Math.abs(w.valor - v) <= COINCIDEN);
          if (ya) {
            ya.n++;
            ya.ids.add(x.id);
          } else valores.push({ valor: v, n: 1, ids: new Set([x.id]) });
        }
        valores.sort((a, b) => b.n - a.n || decimales(a.valor) - decimales(b.valor) || a.valor - b.valor);
        return { miembros: ms, ids: new Set(ms.map((e) => entradas[e]!.id)), plantas, ancla: ms.some((e) => entradas[e]!.ancla[k]), valores, principal: valores[0]!.valor };
      });
      clases.sort(mejor);
      // Lo que separa dos clases: el par de valores más cercano (así lo que coincidía, una cara enrasada, sigue coincidiendo)
      const par = (a: Clase, b: Clase): [number, number] => {
        let r: [number, number] | null = null;
        for (const x of a.valores) for (const y of b.valores) if (!r || Math.abs(x.valor - y.valor) < Math.abs(r[0] - r[1]) - COINCIDEN) r = [x.valor, y.valor];
        return r!;
      };
      const dist = (a: Clase, b: Clase) => {
        const [x, y] = par(a, b);
        return Math.abs(x - y);
      };
      // Cada grupo, alrededor de la clase que recoge más piezas a ≤ tol (un eje guardado antes que nada); con lo que sobra, otra vez
      const quedan = new Set(clases);
      while (quedan.size > 1) {
        let centro: Clase | null = null;
        let recoge: Clase[] = [];
        let piezas = -1;
        for (const c of clases) {
          if (!quedan.has(c)) continue;
          const r = clases.filter((x) => x !== c && quedan.has(x) && !x.ancla && dist(c, x) <= tol);
          const n = new Set([c, ...r].flatMap((x) => [...x.ids])).size;
          if (!centro || Number(c.ancla) > Number(centro.ancla) || (c.ancla === centro.ancla && n > piezas)) [centro, recoge, piezas] = [c, r, n];
        }
        if (!centro || !recoge.length) break;
        quedan.delete(centro);
        for (const c of recoge) quedan.delete(c);
        const grupo = [centro, ...recoge];
        // Sólo si dos clases que no coinciden están en una misma planta
        const enPlantas = new Set<string>();
        let todas = false;
        for (let a = 0; a < grupo.length; a++)
          for (let b = a + 1; b < grupo.length; b++) {
            const [pa, pb] = [grupo[a]!.plantas, grupo[b]!.plantas];
            if (!comparten(pa, pb)) continue;
            if (!pa && !pb) todas = true;
            else for (const p of pa && pb ? [...pa].filter((x) => pb.has(x)) : [...(pa ?? pb)!]) enPlantas.add(p);
          }
        if (!todas && !enPlantas.size) continue;
        let falta = 0;
        for (const c of recoge) {
          const [va, vb] = par(centro, c);
          const delta = va - vb;
          falta = Math.max(falta, Math.abs(delta));
          for (const e of c.miembros) {
            const v = E.c(entradas[e]!.p, k);
            const nv = Math.abs(v - vb) <= COINCIDEN ? va : limpio(v + delta);
            const x = nuevas.get(e) ?? [undefined, undefined];
            x[k] = nv;
            nuevas.set(e, x);
          }
        }
        // Los ejes guardados a ≤ tol del valor que no se mueven
        const fijos = clases.filter((c) => c !== centro && c.ancla && dist(centro!, c) <= tol).flatMap((c) => c.miembros.filter((e) => entradas[e]!.ancla[k]).map((e) => entradas[e]!.id));
        // Los tramos casi rectos: sus dos extremos en el grupo y en clases distintas
        const claseDe = new Map<number, number>();
        grupo.forEach((c, ci) => c.miembros.forEach((e) => claseDe.set(e, ci)));
        const tramos: GrupoAlineado["tramos"] = [];
        const vistos = new Set<number>();
        for (const e of claseDe.keys())
          for (const ti of tramosDe.get(e) ?? []) {
            if (vistos.has(ti)) continue;
            vistos.add(ti);
            const t = rec.tramos[ti]!;
            const [ca, cb] = [claseDe.get(t.a), claseDe.get(t.b)];
            if (ca === undefined || cb === undefined || ca === cb) continue;
            const [A, B] = [entradas[t.a]!.p, entradas[t.b]!.p];
            const desvio = Math.abs(E.c(A, k) - E.c(B, k));
            const largo = Math.abs(E.c(A, (1 - k) as 0 | 1) - E.c(B, (1 - k) as 0 | 1));
            const angulo = (Math.atan2(desvio, largo) * 180) / Math.PI;
            if (angulo <= ANGULO_CASI_RECTO) tramos.push({ id: t.id, de: A, a: B, desvio, angulo });
          }
        tramos.sort((a, b) => b.desvio - a.desvio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const valores = grupo
          .flatMap((c) => c.valores.map((w) => ({ valor: w.valor, objetos: [...w.ids].sort(), ancla: c.miembros.some((e) => entradas[e]!.ancla[k] && Math.abs(E.c(entradas[e]!.p, k) - w.valor) <= COINCIDEN) })))
          .sort((a, b) => a.valor - b.valor);
        grupos.push({
          eje: k,
          nombre: E.theta === 0 ? (k === 0 ? "x" : "y") : k === 0 ? "s" : "t",
          valor: centro.principal,
          valores,
          falta,
          plantas: todas ? m.plantas.map((p) => p.id) : [...enPlantas].sort((a, b) => (ordenPlantas.get(a) ?? 0) - (ordenPlantas.get(b) ?? 0)),
          tramos,
          fijos: [...new Set(fijos)].sort(),
        });
      }
    }
  }
  // Lo que está en el mismo punto que algo que se mueve va con ello (una viga oblicua que acaba en un pilar)
  const porPunto = new Map<string, number[]>();
  entradas.forEach((e, i) => {
    const k = `${e.p[0]} ${e.p[1]}`;
    porPunto.set(k, [...(porPunto.get(k) ?? []), i]);
  });
  for (const [e, nv] of [...nuevas]) {
    const x = entradas[e]!;
    for (const o of porPunto.get(`${x.p[0]} ${x.p[1]}`) ?? []) {
      if (o === e) continue;
      const w = nuevas.get(o) ?? [undefined, undefined];
      for (const k of [0, 1] as const) if (nv[k] !== undefined && w[k] === undefined) w[k] = nv[k];
      nuevas.set(o, w);
    }
  }
  grupos.sort((a, b) => b.falta - a.falta || a.eje - b.eje || a.valor - b.valor);
  return { grupos, nuevas, recogida: rec, ejes: E };
}

/** Los casi alineados del modelo, de mayor a menor lo que les falta (el aviso `sensatez/casi-alineados`). */
export function casiAlineados(m: ModeloFisico, tolerancia = TOLERANCIA_ALINEAR): GrupoAlineado[] {
  return analizar(m, tolerancia).grupos;
}

// ─── Alinear ────────────────────────────────────────────────────────────────────────────────────

/** Sin dos puntos seguidos iguales (en un anillo, tampoco el último con el primero). */
function sinRepetidos(ps: readonly Vec2[], anillo: boolean): Vec2[] {
  const r: Vec2[] = [];
  for (const p of ps) if (!r.length || !igual(r[r.length - 1]!, p)) r.push(p);
  if (anillo) while (r.length > 1 && igual(r[0]!, r[r.length - 1]!)) r.pop();
  return r;
}

/** Las listas de puntos de un objeto de una colección: su ruta y si es un anillo. */
function listasDe(c: Coleccion, o: Objeto): { ruta: Ruta; anillo: boolean }[] {
  switch (c) {
    case "vigas":
    case "muros":
    case "apoyosLineales":
      return [{ ruta: ["puntos"], anillo: false }];
    case "losas":
    case "panos": {
      const r: { ruta: Ruta; anillo: boolean }[] = [{ ruta: ["contorno"], anillo: true }];
      ((o.huecos as unknown[] | undefined) ?? []).forEach((_, j) => r.push({ ruta: ["huecos", j], anillo: true }));
      (((o.reticular as { abacos?: unknown[] } | undefined)?.abacos as unknown[] | undefined) ?? []).forEach((_, j) => r.push({ ruta: ["reticular", "abacos", j], anillo: true }));
      return r;
    }
    case "cargas": {
      const t = (o as unknown as CargaFisica).tipo;
      return t === "lineal" ? [{ ruta: ["puntos"], anillo: false }] : t === "superficie" && o.zona ? [{ ruta: ["zona"], anillo: true }] : [];
    }
    default:
      return [];
  }
}

const en = (o: unknown, ruta: Ruta): unknown => ruta.reduce<unknown>((x, k) => (x as Record<string | number, unknown>)?.[k], o);

/**
 * Lo que «Alinear» haría con la tolerancia `tolerancia` (m): los grupos casi alineados, los puntos
 * que mueve y el lote que lo hace. No cambia nada: la app lo aplica al pulsar y `fem alinear`, con
 * `--escribir`.
 */
export function proponerAlinear(m: ModeloFisico, tolerancia = TOLERANCIA_ALINEAR): PropuestaAlinear {
  const an = analizar(m, tolerancia);
  const { entradas } = an.recogida;
  const E = an.ejes;
  const movimientos: Movimiento[] = [];
  const porObjeto = new Map<string, { c: Coleccion; id: string; ms: { ruta: Ruta; a: Vec2 }[] }>();
  for (const [e, [n0, n1]] of [...an.nuevas].sort((a, b) => a[0] - b[0])) {
    const x = entradas[e]!;
    let q = x.p;
    if (n0 !== undefined) q = E.mover(q, 0, n0);
    if (n1 !== undefined) q = E.mover(q, 1, n1);
    if (igual(q, x.p)) continue;
    movimientos.push({ coleccion: x.coleccion, id: x.id, ruta: x.ruta, de: x.p, a: q });
    const k = `${x.coleccion}\u0000${x.id}`;
    const y = porObjeto.get(k) ?? { c: x.coleccion, id: x.id, ms: [] };
    y.ms.push({ ruta: x.ruta, a: q });
    porObjeto.set(k, y);
  }
  const avisos: string[] = [];
  const idx = indiceIds(m);
  const cambios = new Map<string, { c: Coleccion; o: Objeto }>();
  const ops: Operacion[] = [];
  for (const { c, id, ms } of porObjeto.values()) {
    const pos = idx.get(id);
    if (!pos || pos.coleccion !== c) continue;
    const o0 = lista(m, c)[pos.indice]!;
    let o: Objeto = o0;
    for (const { ruta, a } of ms) {
      if (ruta[0] === "x" && ruta.length === 1) o = { ...o, x: a[0], y: a[1] };
      else if ((ruta[0] === "inicio" || ruta[0] === "fin") && ruta.length === 1) o = { ...o, [ruta[0]]: { ...(o[ruta[0]] as object), x: a[0], y: a[1] } };
      else o = conValor(o, ruta, a);
    }
    // Lo que se mide a lo largo de la polilínea, otra vez en su tramo
    if (c === "muros" && o0.huecos) {
      const [ps, qs] = [o0.puntos as Vec2[], o.puntos as Vec2[]];
      o = { ...o, huecos: (o0.huecos as { desde: number; hasta: number }[]).map((h) => ({ ...h, desde: reestacionar(ps, qs, h.desde), hasta: reestacionar(ps, qs, h.hasta) })) };
    }
    if (c === "vigas")
      for (const q of m.cargas ?? []) {
        if (q.tipo !== "viga" || q.viga !== id || (q.desde === undefined && q.hasta === undefined)) continue;
        const [ps, qs] = [o0.puntos as Vec2[], o.puntos as Vec2[]];
        const nq = { ...q, ...(q.desde !== undefined ? { desde: reestacionar(ps, qs, q.desde) } : {}), ...(q.hasta !== undefined ? { hasta: reestacionar(ps, qs, q.hasta) } : {}) };
        const ya = cambios.get(`cargas\u0000${q.id}`);
        cambios.set(`cargas\u0000${q.id}`, { c: "cargas", o: { ...(ya?.o ?? {}), ...nq } as unknown as Objeto });
      }
    // Dos puntos seguidos en el mismo sitio quedan en uno
    let degenerado = false;
    for (const { ruta, anillo } of listasDe(c, o)) {
      const ps = en(o, ruta) as Vec2[] | undefined;
      if (!ps) continue;
      const qs = sinRepetidos(ps, anillo);
      if (qs.length < (anillo ? 3 : 2)) degenerado = true;
      else if (qs.length !== ps.length) o = conValor(o, ruta, qs);
    }
    if (degenerado) {
      avisos.push(`${id} quedaría con dos de sus puntos en el mismo sitio y sin forma: no se mueve (corríjalo a mano).`);
      continue;
    }
    cambios.set(`${c}\u0000${id}`, { c, o });
  }
  for (const { c, o } of cambios.values()) ops.push({ op: "cambiar", coleccion: c, id: o.id, objeto: o });
  // Los movimientos de lo que no se mueve, fuera
  const quedanFuera = new Set(avisos.length ? [...porObjeto.keys()].filter((k) => !cambios.has(k)) : []);
  const movs = quedanFuera.size ? movimientos.filter((x) => !quedanFuera.has(`${x.coleccion}\u0000${x.id}`)) : movimientos;
  const modelo = ops.length ? conCambios(m, cambios) : m;
  const quedan = ops.length ? analizar(modelo, tolerancia).grupos.length : an.grupos.length;
  return {
    tolerancia,
    direccion: E.theta,
    grupos: an.grupos,
    movimientos: movs,
    avisos,
    operacion: ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops },
    modelo,
    quedan,
  };
}

/** El modelo con los objetos cambiados (por colección e id). */
function conCambios(m: ModeloFisico, cambios: Map<string, { c: Coleccion; o: Objeto }>): ModeloFisico {
  const r: Record<string, unknown> = { ...m };
  const porColeccion = new Map<Coleccion, Map<string, Objeto>>();
  for (const { c, o } of cambios.values()) porColeccion.set(c, (porColeccion.get(c) ?? new Map()).set(o.id, o));
  for (const [c, xs] of porColeccion) r[c] = lista(m, c).map((o) => xs.get(o.id) ?? o);
  return r as unknown as ModeloFisico;
}

// ─── Textos ─────────────────────────────────────────────────────────────────────────────────────

/** Una coordenada en m, con coma y hasta 4 decimales: «4,2821». */
export const metros = (x: number): string => String(Math.round(x * 1e4) / 1e4 + 0).replace(".", ",");

/** Una distancia pequeña: «2,1 cm», «0,4 mm». */
export function distancia(x: number): string {
  if (x >= 0.01) return `${String(Math.round(x * 1000) / 10).replace(".", ",")} cm`;
  const mm = x * 1000;
  return `${String(mm >= 0.1 ? Math.round(mm * 10) / 10 : Number(mm.toPrecision(1))).replace(".", ",")} mm`;
}

const listaIds = (ids: readonly string[], max = 3): string => (ids.length <= max ? (ids.length > 1 ? `${ids.slice(0, -1).join(", ")} y ${ids.at(-1)}` : (ids[0] ?? "")) : `${ids.slice(0, max).join(", ")} y ${ids.length - max} más`);

const punto = (p: Vec2) => `(${metros(p[0])}; ${metros(p[1])})`;

/** El aviso de un casi alineado, en una frase (lo dice `fem validar` y la app). */
export function textoGrupo(g: GrupoAlineado, direccion = 0): string {
  const recta = `${g.nombre} = ${metros(g.valor)}${direccion ? ` (en los ejes a ${metros(direccion)}°)` : ""}`;
  const plantas = g.plantas.length ? ` (${g.plantas.join(", ")})` : "";
  const otros = g.valores.filter((v) => Math.abs(v.valor - g.valor) > COINCIDEN);
  const destino = g.valores.filter((v) => Math.abs(v.valor - g.valor) <= COINCIDEN).flatMap((v) => v.objetos);
  const fuera = otros.map((v) => `${metros(v.valor)} (${listaIds(v.objetos)})`);
  const lista = fuera.length > 1 ? `${fuera.slice(0, -1).join(", ")} y ${fuera.at(-1)}` : fuera[0]!;
  let t = `Casi alineados en ${recta}${plantas}: ${lista} frente a ${listaIds([...new Set(destino)])}; les falta hasta ${distancia(g.falta)} para coincidir.`;
  const tr = g.tramos.slice(0, 3);
  if (tr.length)
    t += ` ${tr.map((x) => `El tramo de ${x.id} de ${punto(x.de)} a ${punto(x.a)} se desvía ${distancia(x.desvio)} (${String(Number(x.angulo.toPrecision(2))).replace(".", ",")}°)`).join("; ")}${g.tramos.length > 3 ? ` (y ${g.tramos.length - 3} más)` : ""}.`;
  if (g.fijos.length) t += ` ${g.fijos.length > 1 ? "Los ejes" : "El eje"} ${listaIds(g.fijos)} no se ${g.fijos.length > 1 ? "mueven" : "mueve"}: ${g.fijos.length > 1 ? "están" : "está"} guardado${g.fijos.length > 1 ? "s" : ""} a menos de la tolerancia de otro.`;
  t += ` «Alinear» los pone en ${metros(g.valor)} (con «fem alinear --escribir»); si son distintos de verdad, sepárelos más.`;
  return t;
}
