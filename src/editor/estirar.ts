/**
 * Estirar el modelo desde una cota de la cadena entre ejes (CT2, `docs/fem3d/cotas.md` §2.2), y
 * mover un pilar con sus vigas (CT3, §2.3: `moverPilar`, al final).
 *
 * La cota mide t = p·n entre dos ejes paralelos: el que se queda (`fijo`) y el que se mueve (`movil`).
 * Darle el valor L′ desplaza Δ = L′ − L, en perpendicular a los ejes, todo lo que está del lado del
 * móvil, en todas las plantas (CT-a, CT-c). Las demás cotas de la cadena no cambian.
 *
 * - **Línea de corte:** una paralela dentro del vano a min(L/4; 0,5 m) del eje móvil. Lo pegado a
 *   él va con él (la huella de sus pilares, una viga alineada a su cara interior, el borde de una
 *   losa en la cara de la viga); lo que está más allá se mueve entero y lo que la cruza se alarga.
 * - **Por vértices:** el punto de pilares, apoyos y cargas puntuales; cada vértice de vigas, muros,
 *   apoyos lineales, contornos y huecos de losas y paños, ábacos, cargas lineales, zonas de carga,
 *   bandas y ejes guardados. Un eje paralelo se mueve entero o se queda; uno perpendicular se alarga.
 * - **Estaciones** (cargas de viga con `desde`/`hasta`, huecos de muro y apoyos de banda): cada una
 *   se lleva a su punto, el punto se estira (en un tramo que cruza el corte, a su t estirado sobre el
 *   tramo nuevo) y se vuelve a medir sobre la pieza estirada. Un hueco de muro que cruza el corte
 *   cambia de ancho, y se avisa.
 * - **Exacto:** con los ejes paralelos a X o a Y, un punto que estaba en el eje móvil acaba en la
 *   coordenada del fijo más (o menos) el valor, y los demás en la suya más Δ, sin el ruido de la suma
 *   (`limpio`): el mismo double que da escribirlo en la tabla. En una planta girada, p + Δ·n.
 * - **Acortar** tiene un límite: lo que se mueve no puede pasar por encima de lo que se queda (el
 *   vértice que se queda más cerca del corte y el que se mueve más cerca de él, en todo el modelo).
 * - Sin ejes guardados (los propuestos), se mueve lo demás y los ejes se vuelven a proponer.
 *
 * Es un `lote` de `cambiar` (un paso de deshacer) que pasa por `aplicar` como cualquier otro. Lo que
 * no es geometría (secciones, plantas, cargas sin estaciones) no se toca.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { rotuloCota } from "../agente/render/ejes.ts";
import { huellaSeccion, PlantaFisica } from "../agente/render/modelo.ts";
import type { CargaFisica, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { distanciaABorde, puntoEnPoligono } from "../compilador/poligonos.ts";
import { limpio } from "./dibujo/cotas.ts";
import type { Operacion } from "./operaciones.ts";
import type { Coleccion, Objeto } from "./referencias.ts";

export interface Estiramiento {
  /** La normal de los ejes, unitaria: la cota mide t = p·n. */
  n: Vec2;
  /** t del eje que se queda y del que se mueve. */
  fijo: number;
  movil: number;
}

/** Lo más que se aleja el corte del eje móvil, m. */
export const CORTE_MAXIMO = 0.5;

/** A menos de esto del eje móvil, un punto está en él, m. */
const EN_EJE = 1e-9;

/** Lo que el estirado mueve entero y lo que alarga (ids, en el orden del modelo). */
export interface Afectados {
  mueven: string[];
  alargan: string[];
}

export type ResultadoEstirar = { ok: true; operacion: Operacion; avisos: string[]; afectados: Afectados } | { ok: false; mensaje: string };

const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];

/** La longitud de la cota. */
export const longitud = (e: Estiramiento): number => Math.abs(e.movil - e.fijo);

/** t de la línea de corte. */
export function corte(e: Estiramiento): number {
  const L = longitud(e);
  return e.movil - Math.sign(e.movil - e.fijo) * Math.min(L / 4, CORTE_MAXIMO);
}

/** Lo que hace el estirado con un punto, con Δ fijado. */
class Transformador {
  readonly sgn: number;
  readonly c: number;
  readonly L: number;
  /** Con ejes paralelos a X (k = 1) o a Y (k = 0): la coordenada que cambia y su sentido. */
  private readonly k: 0 | 1 | null;
  private readonly sigma: number;

  readonly e: Estiramiento;
  readonly valor: number;

  constructor(e: Estiramiento, valor: number) {
    this.e = e;
    this.valor = valor;
    this.sgn = Math.sign(e.movil - e.fijo);
    this.c = corte(e);
    this.L = longitud(e);
    const [nx, ny] = e.n;
    this.k = ny === 0 ? 0 : nx === 0 ? 1 : null;
    this.sigma = this.k === null ? 0 : Math.sign(e.n[this.k]);
  }

  get delta(): number {
    return this.valor - this.L;
  }

  /** Cuánto se ha pasado p del corte, hacia el lado del móvil (> 0: se mueve). */
  q(p: Vec2): number {
    return this.sgn * (dot(p, this.e.n) - this.c);
  }

  mueve(p: Vec2): boolean {
    return this.q(p) > 0;
  }

  /** El t estirado de un t. */
  t(t: number): number {
    if (this.sgn * (t - this.c) <= 0) return t;
    return Math.abs(t - this.e.movil) <= EN_EJE ? this.e.fijo + this.sgn * this.valor : t + this.sgn * this.delta;
  }

  /** p estirado (el mismo objeto si no se mueve). */
  punto(p: Vec2): Vec2 {
    if (!this.mueve(p)) return p;
    const { e } = this;
    if (this.k !== null) {
      const k = this.k;
      const u = p[k];
      // La coordenada, del fijo al móvil
      const [uf, um] = [this.sigma * e.fijo, this.sigma * e.movil];
      const s = Math.sign(um - uf);
      const v = Math.abs(u - um) <= EN_EJE ? limpio(uf + s * this.valor) : limpio(u + s * this.delta);
      return k === 0 ? [v, p[1]] : [p[0], v];
    }
    const t = dot(p, e.n);
    const d = this.t(t) - t;
    return [p[0] + d * e.n[0], p[1] + d * e.n[1]];
  }
}

/** Un recorrido de los vértices del modelo, con quién es cada uno. */
function vertices(m: ModeloFisico, f: (id: string, p: Vec2) => void): void {
  const lista = (id: string, ps: readonly Vec2[] | undefined) => ps?.forEach((p) => f(id, p));
  for (const p of m.pilares ?? []) f(p.id, [p.x, p.y]);
  for (const a of m.apoyos ?? []) f(a.id, [a.x, a.y]);
  for (const v of m.vigas ?? []) lista(v.id, v.puntos);
  for (const w of m.muros ?? []) lista(w.id, w.puntos);
  for (const a of m.apoyosLineales ?? []) lista(a.id, a.puntos);
  for (const l of m.losas ?? []) {
    lista(l.id, l.contorno);
    for (const h of l.huecos ?? []) lista(l.id, h);
    for (const h of l.reticular?.abacos ?? []) lista(l.id, h);
  }
  for (const l of m.panos ?? []) {
    lista(l.id, l.contorno);
    for (const h of l.huecos ?? []) lista(l.id, h);
  }
  for (const b of m.bandas ?? []) lista(b.id, [b.desde, b.hasta]);
  for (const c of m.cargas ?? []) {
    if (c.tipo === "puntual") f(c.id, [c.x, c.y]);
    else if (c.tipo === "lineal") lista(c.id, c.puntos);
    else if (c.tipo === "superficie") lista(c.id, c.zona);
  }
  for (const e of m.ejes ?? []) lista(e.id, [e.desde, e.hasta]);
}

/** Lo que se movería (entero) y lo que se alargaría, para resaltarlo antes de dar el valor. */
export function afectados(m: ModeloFisico, e: Estiramiento): Afectados {
  const tr = new Transformador(e, longitud(e));
  const cuenta = new Map<string, [number, number]>();
  vertices(m, (id, p) => {
    const x = cuenta.get(id) ?? [0, 0];
    if (tr.mueve(p)) x[0]++;
    x[1]++;
    cuenta.set(id, x);
  });
  const r: Afectados = { mueven: [], alargan: [] };
  for (const [id, [a, n]] of cuenta) if (a) (a === n ? r.mueven : r.alargan).push(id);
  return r;
}

const longitudes = (ps: readonly Vec2[]): number[] => {
  const r = [0];
  for (let i = 1; i < ps.length; i++) r.push(r[i - 1]! + Math.hypot(ps[i]![0] - ps[i - 1]![0], ps[i]![1] - ps[i - 1]![1]));
  return r;
};

/** La estación s de la polilínea `ps`, medida otra vez sobre la estirada `qs`. */
function estacion(tr: Transformador, ps: readonly Vec2[], qs: readonly Vec2[], s: number): number {
  const l0 = longitudes(ps);
  const l1 = longitudes(qs);
  let i = 0;
  while (i < ps.length - 2 && s > l0[i + 1]!) i++;
  const [A, B, A2, B2] = [ps[i]!, ps[i + 1]!, qs[i]!, qs[i + 1]!];
  const largo = l0[i + 1]! - l0[i]!;
  let r: number;
  if (tr.mueve(A) === tr.mueve(B) || largo === 0) r = l1[i]! + (s - l0[i]!);
  else {
    // El tramo cruza el corte: el punto, a su t estirado sobre el tramo nuevo
    const lam = (s - l0[i]!) / largo;
    const P: Vec2 = [A[0] + lam * (B[0] - A[0]), A[1] + lam * (B[1] - A[1])];
    const [ta, tb] = [dot(A2, tr.e.n), dot(B2, tr.e.n)];
    const lam2 = (tr.t(dot(P, tr.e.n)) - ta) / (tb - ta);
    r = l1[i]! + lam2 * (l1[i + 1]! - l1[i]!);
  }
  return Math.min(Math.max(limpio(r), 0), l1[l1.length - 1]!);
}

/**
 * El estirado de la cota a `valor`, como una operación. Falla si el valor no es un número positivo,
 * si es el de ahora o si acorta tanto que lo que se mueve pasaría por encima de lo que se queda.
 */
export function estirar(m: ModeloFisico, e: Estiramiento, valor: number): ResultadoEstirar {
  const L = longitud(e);
  if (!(L > 0)) return { ok: false, mensaje: "Los dos ejes de la cota están en el mismo sitio." };
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, mensaje: "La cota tiene que ser un número mayor que cero." };
  const tr = new Transformador(e, valor);
  if (Math.abs(tr.delta) <= EN_EJE) return { ok: false, mensaje: `La cota ya mide ${rotuloCota(L)} m.` };

  // Acortar: lo que se mueve no puede pasar por encima de lo que se queda
  if (tr.delta < 0) {
    let quieto = { q: tr.sgn * (e.fijo - tr.c), id: "el otro eje" };
    let movido = { q: Infinity, id: "" };
    vertices(m, (id, p) => {
      const q = tr.q(p);
      if (q > 0) {
        if (q < movido.q) movido = { q, id };
      } else if (q > quieto.q) quieto = { q, id };
    });
    const minimo = L - (movido.q - quieto.q);
    if (movido.id && valor <= minimo + 1e-6)
      return { ok: false, mensaje: `La cota tiene que medir más de ${rotuloCota(minimo)} m: con menos, ${movido.id} pasaría por encima de ${quieto.id}.` };
  }

  const ops: Operacion[] = [];
  const avisos: string[] = [];
  const cambiar = (coleccion: Coleccion, antes: { id: string }, objeto: object) => ops.push({ op: "cambiar", coleccion, id: antes.id, objeto: objeto as Objeto });
  /** La polilínea estirada (la misma si no cambia ningún vértice). */
  const linea = <T extends readonly Vec2[]>(ps: T): T => {
    let cambia = false;
    const r = ps.map((p) => {
      const q = tr.punto(p);
      if (q !== p) cambia = true;
      return q;
    });
    return (cambia ? r : ps) as T;
  };
  const anillos = <T extends readonly (readonly Vec2[])[]>(hs: T | undefined): T | undefined => {
    if (!hs) return hs;
    const r = hs.map(linea);
    return (r.some((h, i) => h !== hs[i]) ? r : hs) as T;
  };

  for (const p of m.pilares ?? []) {
    const q = tr.punto([p.x, p.y]);
    if (q[0] !== p.x || q[1] !== p.y) cambiar("pilares", p, { ...p, x: q[0], y: q[1] });
  }
  for (const a of m.apoyos ?? []) {
    const q = tr.punto([a.x, a.y]);
    if (q[0] !== a.x || q[1] !== a.y) cambiar("apoyos", a, { ...a, x: q[0], y: q[1] });
  }
  const vigas = new Map<string, [readonly Vec2[], readonly Vec2[]]>();
  for (const v of m.vigas ?? []) {
    const ps = linea(v.puntos);
    if (ps === v.puntos) continue;
    vigas.set(v.id, [v.puntos, ps]);
    cambiar("vigas", v, { ...v, puntos: ps });
  }
  for (const w of m.muros ?? []) {
    const ps = linea(w.puntos);
    if (ps === w.puntos) continue;
    const huecos = w.huecos?.map((h) => {
      const [desde, hasta] = [estacion(tr, w.puntos, ps, h.desde), estacion(tr, w.puntos, ps, h.hasta)];
      if (limpio(hasta - desde) !== limpio(h.hasta - h.desde)) avisos.push(`El hueco de ${w.id} entre ${rotuloCota(h.desde)} y ${rotuloCota(h.hasta)} m cruza el corte: pasa de ${rotuloCota(h.hasta - h.desde)} a ${rotuloCota(hasta - desde)} m de ancho.`);
      return { ...h, desde, hasta };
    });
    cambiar("muros", w, { ...w, puntos: ps, ...(huecos ? { huecos } : {}) });
  }
  for (const a of m.apoyosLineales ?? []) {
    const ps = linea(a.puntos);
    if (ps !== a.puntos) cambiar("apoyosLineales", a, { ...a, puntos: ps });
  }
  for (const l of m.losas ?? []) {
    const contorno = linea(l.contorno);
    const huecos = anillos(l.huecos);
    const abacos = anillos(l.reticular?.abacos);
    if (contorno === l.contorno && huecos === l.huecos && abacos === l.reticular?.abacos) continue;
    cambiar("losas", l, { ...l, contorno, ...(huecos ? { huecos } : {}), ...(l.reticular ? { reticular: { ...l.reticular, ...(abacos ? { abacos } : {}) } } : {}) });
  }
  for (const l of m.panos ?? []) {
    const contorno = linea(l.contorno);
    const huecos = anillos(l.huecos);
    if (contorno !== l.contorno || huecos !== l.huecos) cambiar("panos", l, { ...l, contorno, ...(huecos ? { huecos } : {}) });
  }
  for (const b of m.bandas ?? []) {
    const ps = linea([b.desde, b.hasta] as const);
    if (ps[0] === b.desde && ps[1] === b.hasta) continue;
    const apoyos = b.apoyos?.map(([x, y]) => [estacion(tr, [b.desde, b.hasta], ps, x), estacion(tr, [b.desde, b.hasta], ps, y)] as const);
    cambiar("bandas", b, { ...b, desde: ps[0], hasta: ps[1], ...(apoyos ? { apoyos } : {}) });
  }
  for (const c of m.cargas ?? []) {
    const n = cargaEstirada(tr, c, vigas);
    if (n !== c) cambiar("cargas", c, n);
  }
  for (const x of m.ejes ?? []) {
    const ps = linea([x.desde, x.hasta] as const);
    if (ps[0] !== x.desde || ps[1] !== x.hasta) cambiar("ejes", x, { ...x, desde: ps[0], hasta: ps[1] });
  }
  if (!ops.length) return { ok: false, mensaje: "No hay nada del lado que se mueve." };
  return { ok: true, operacion: { op: "lote", operaciones: ops }, avisos, afectados: afectados(m, e) };
}

// ─── Mover un pilar (CT3, §2.3) ─────────────────────────────────────────────────────────────────

export type ResultadoMover = { ok: true; operacion: Operacion; avisos: string[]; vigas: string[] } | { ok: false; mensaje: string };

/**
 * El pilar `id` con su punto fijo en q, en todas sus plantas (una sola coordenada, así que en todas).
 * Con `conVigas` (CT-d, como CYPECAD), lo siguen las vigas de sus plantas con un vértice en su punto
 * fijo bit a bit: ese vértice pasa a ser q. Las que tienen un vértice en su huella sin estar en el
 * punto (alineadas a una cara, V2c-b) no lo siguen, y se avisa; sin `conVigas`, también de las que se
 * quedan. Los ejes guardados no se mueven. Un `lote` de `cambiar`: un paso de deshacer.
 */
export function moverPilar(m: ModeloFisico, id: string, q: Vec2, conVigas = true): ResultadoMover {
  const p = m.pilares?.find((x) => x.id === id);
  if (!p) return { ok: false, mensaje: `No hay ningún pilar ${id}.` };
  if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) return { ok: false, mensaje: "La posición tiene que ser un número." };
  if (q[0] === p.x && q[1] === p.y) return { ok: false, mensaje: `${id} ya está ahí.` };
  const ops: Operacion[] = [{ op: "cambiar", coleccion: "pilares", id, objeto: { ...p, x: q[0], y: q[1] } as Objeto }];
  const siguen: string[] = [];
  const quedan: string[] = [];
  const cara: string[] = [];
  for (const pl of m.plantas) {
    const planta = new PlantaFisica(m, pl.id);
    const x = planta.pilares().find((r) => r.p.id === id);
    if (!x) continue;
    const h = huellaSeccion(p, x.seccion);
    const enHuella = (v: Vec2) => (h ? ("anillo" in h ? puntoEnPoligono(v, h.anillo) || distanciaABorde(v, h.anillo) <= EN_EJE : Math.hypot(v[0] - h.centro[0], v[1] - h.centro[1]) <= h.radio + EN_EJE) : false);
    for (const v of planta.enPlanta(m.vigas)) {
      if (v.puntos.some((r) => r[0] === p.x && r[1] === p.y)) {
        if (!conVigas) {
          quedan.push(v.id);
          continue;
        }
        siguen.push(v.id);
        ops.push({ op: "cambiar", coleccion: "vigas", id: v.id, objeto: { ...v, puntos: v.puntos.map((r) => (r[0] === p.x && r[1] === p.y ? q : r)) } as Objeto });
      } else if (v.puntos.some(enHuella)) cara.push(v.id);
    }
  }
  const avisos: string[] = [];
  const lista = (ids: string[]) => ids.join(", ");
  if (quedan.length) avisos.push(`${quedan.length > 1 ? `Las vigas ${lista(quedan)} acaban` : `La viga ${quedan[0]} acaba`} en ${id} y se ${quedan.length > 1 ? "quedan" : "queda"} donde estaba${quedan.length > 1 ? "n" : ""}.`);
  if (cara.length) avisos.push(`${cara.length > 1 ? `Las vigas ${lista(cara)} llegan` : `La viga ${cara[0]} llega`} a ${id} sin acabar en su punto fijo (alineada${cara.length > 1 ? "s" : ""} a una cara) y no lo ${cara.length > 1 ? "siguen" : "sigue"}.`);
  return { ok: true, operacion: ops.length > 1 ? { op: "lote", operaciones: ops } : ops[0]!, avisos, vigas: siguen };
}

function cargaEstirada(tr: Transformador, c: CargaFisica, vigas: ReadonlyMap<string, [readonly Vec2[], readonly Vec2[]]>): CargaFisica {
  switch (c.tipo) {
    case "puntual": {
      const q = tr.punto([c.x, c.y]);
      return q[0] !== c.x || q[1] !== c.y ? { ...c, x: q[0], y: q[1] } : c;
    }
    case "lineal": {
      const ps = c.puntos.map((p) => tr.punto(p));
      return ps.some((p, i) => p !== c.puntos[i]) ? { ...c, puntos: ps } : c;
    }
    case "superficie": {
      if (!c.zona) return c;
      const ps = c.zona.map((p) => tr.punto(p));
      return ps.some((p, i) => p !== c.zona![i]) ? { ...c, zona: ps } : c;
    }
    case "viga": {
      const v = vigas.get(c.viga);
      if (!v || (c.desde === undefined && c.hasta === undefined)) return c;
      const [ps, qs] = v;
      const desde = c.desde === undefined ? undefined : estacion(tr, ps, qs, c.desde);
      const hasta = c.hasta === undefined ? undefined : estacion(tr, ps, qs, c.hasta);
      return desde === c.desde && hasta === c.hasta ? c : { ...c, ...(desde !== undefined ? { desde } : {}), ...(hasta !== undefined ? { hasta } : {}) };
    }
    default:
      return c;
  }
}
