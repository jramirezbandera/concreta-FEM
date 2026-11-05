/**
 * La carga de borde de losa (MA4, `docs/fem3d/modelado.md` §2.4): una carga lineal por el contorno
 * de una losa (y, con `huecos`, por el de sus huecos), menos los tramos de `excepto`.
 *
 * - Se resuelve en cargas lineales (`tipo: "lineal"`) sobre los tramos que la llevan, con el id de la
 *   carga (o `<id>:1`, `<id>:2`… si son varios tramos sueltos). Van por el borde, que ya está en la
 *   malla: un anillo entero, cerrado, y un tramo, de vértice a vértice del contorno, salvo donde
 *   empieza o acaba una excepción (ese punto sí se siembra).
 * - **Excepciones:** un segmento [desde, hasta] quita lo del borde que va por él (a ≤ ε_snap); un
 *   `{ junto: X }` quita lo del borde que toca en planta la losa X o cae sobre ella (a ≤ ε_snap de su
 *   contorno o dentro), aunque X esté en otra planta: el encuentro de dos cubiertas.
 * - Una carga que no se puede resolver (la losa no existe, una excepción mal formada, o se queda sin
 *   tramos) se deja como está y la rechaza el validador, que dice por qué (`problemaBorde`).
 *
 * `resolverBordes` se aplica antes de validar, en el compilador, y en lo que dibuja o reparte las
 * cargas sin compilar (sensatez, tributaria, render), así que todos ven las mismas.
 *
 * Puro: sin IO.
 */
import type { CargaFisica, Losa, ModeloFisico, Vec2 } from "./fisico.ts";
import { distanciaABorde, distanciaASegmento, puntoEnRegion } from "./poligonos.ts";

export type CargaBorde = Extract<CargaFisica, { tipo: "borde" }>;

/** ε por defecto: el ε_snap del compilador. */
const EPS = 0.05;

const esPunto = (q: unknown): q is Vec2 => Array.isArray(q) && q.length === 2 && q.every((x) => typeof x === "number" && Number.isFinite(x));
const esAnillo = (p: unknown): p is Vec2[] => Array.isArray(p) && p.length >= 3 && p.every(esPunto);
const esSegmento = (e: unknown): e is readonly [Vec2, Vec2] => Array.isArray(e) && e.length === 2 && e.every(esPunto);
const esJunto = (e: unknown): e is { junto: string } => typeof e === "object" && e !== null && !Array.isArray(e) && Object.keys(e).length === 1 && typeof (e as { junto?: unknown }).junto === "string";

/** Por qué una carga de borde no se puede resolver, o null. */
export function problemaBorde(m: ModeloFisico, c: CargaBorde): string | null {
  const l = (m.losas ?? []).find((x) => x.id === c.losa);
  if (!l) return `no hay ninguna losa «${String(c.losa)}»`;
  if (!esAnillo(l.contorno)) return `el contorno de la losa ${l.id} no es un polígono`;
  if (c.huecos !== undefined && typeof c.huecos !== "boolean") return "huecos tiene que ser true o false";
  if (c.excepto !== undefined) {
    if (!Array.isArray(c.excepto)) return "excepto tiene que ser una lista de segmentos [[x, y], [x, y]] o { junto: <losa> }";
    for (const e of c.excepto) {
      if (esSegmento(e)) continue;
      if (esJunto(e)) {
        if (!(m.losas ?? []).some((x) => x.id === e.junto)) return `excepto: no hay ninguna losa «${e.junto}»`;
        if (e.junto === c.losa) return "excepto: una losa no puede estar junto a sí misma";
        continue;
      }
      return "excepto tiene que ser una lista de segmentos [[x, y], [x, y]] o { junto: <losa> }";
    }
  }
  return null;
}

/** Los anillos de la losa X de un `junto`: su contorno y sus huecos, para la distancia a su borde. */
function regionJunto(m: ModeloFisico, id: string): { contorno: Vec2[]; huecos: Vec2[][] } | null {
  const x = (m.losas ?? []).find((l) => l.id === id);
  if (!x || !esAnillo(x.contorno)) return null;
  return { contorno: x.contorno as Vec2[], huecos: (Array.isArray(x.huecos) ? x.huecos : []).filter(esAnillo) as Vec2[][] };
}

/** Parámetro t de la proyección de q sobre ab (sin recortar). */
const proyeccion = (q: Vec2, a: Vec2, b: Vec2): number => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const L2 = dx * dx + dy * dy;
  return L2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
};
const enT = (a: Vec2, b: Vec2, t: number): Vec2 => (t === 0 ? a : t === 1 ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);

/** Corte propio de ab con cd: el t sobre ab, o null. */
function corte(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-15) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * Los tramos de una carga de borde (polilíneas; un anillo entero, cerrado: el primer punto repetido
 * al final), o null si no se puede resolver (`problemaBorde`).
 */
export function tramosBorde(m: ModeloFisico, c: CargaBorde, eps = EPS): Vec2[][] | null {
  if (problemaBorde(m, c)) return null;
  const l = (m.losas ?? []).find((x) => x.id === c.losa) as Losa;
  const anillos: Vec2[][] = [l.contorno as Vec2[], ...(c.huecos ? (Array.isArray(l.huecos) ? l.huecos : []).filter(esAnillo).map((h) => h as Vec2[]) : [])];
  const segmentos = (c.excepto ?? []).filter(esSegmento);
  const juntos = (c.excepto ?? []).filter(esJunto).flatMap((e) => {
    const r = regionJunto(m, e.junto);
    return r ? [r] : [];
  });
  const fuera = (q: Vec2): boolean =>
    segmentos.some(([a, b]) => distanciaASegmento(q, a, b) <= eps) ||
    juntos.some((r) => puntoEnRegion(q, r) || distanciaABorde(q, r.contorno) <= eps || r.huecos.some((h) => distanciaABorde(q, h) <= eps));
  const tramos: Vec2[][] = [];
  for (const anillo of anillos) {
    const n = anillo.length;
    // Los trozos de cada lado, entre los puntos donde puede cambiar si lleva la carga
    type Trozo = { a: Vec2; b: Vec2; lleva: boolean; vA: boolean; vB: boolean };
    const trozos: Trozo[] = [];
    for (let k = 0; k < n; k++) {
      const [a, b] = [anillo[k]!, anillo[(k + 1) % n]!];
      const ts = new Set<number>([0, 1]);
      const cerca = (q: Vec2) => {
        const t = proyeccion(q, a, b);
        if (t > 0 && t < 1 && distanciaASegmento(q, a, b) <= eps) ts.add(t);
      };
      for (const [p, q] of segmentos) {
        cerca(p);
        cerca(q);
      }
      for (const r of juntos)
        for (const R of [r.contorno, ...r.huecos])
          for (let j = 0; j < R.length; j++) {
            const [p, q] = [R[j]!, R[(j + 1) % R.length]!];
            cerca(p);
            const t = corte(a, b, p, q);
            if (t !== null) ts.add(t);
          }
      const orden = [...ts].sort((x, y) => x - y);
      for (let i = 0; i + 1 < orden.length; i++) {
        const [t0, t1] = [orden[i]!, orden[i + 1]!];
        if (t1 - t0 < 1e-12) continue;
        const [p, q] = [enT(a, b, t0), enT(a, b, t1)];
        trozos.push({ a: p, b: q, lleva: !fuera(enT(a, b, (t0 + t1) / 2)), vA: t0 === 0, vB: t1 === 1 });
      }
    }
    if (trozos.every((t) => t.lleva)) {
      tramos.push([...anillo, anillo[0]!]);
      continue;
    }
    // Empezar tras un trozo sin carga y juntar los seguidos con carga; los puntos de dentro de un lado
    // (los de las excepciones) sólo quedan donde empieza o acaba un tramo
    const i0 = trozos.findIndex((t) => !t.lleva);
    let actual: Vec2[] | null = null;
    for (let s = 1; s <= trozos.length; s++) {
      const t = trozos[(i0 + s) % trozos.length]!;
      if (!t.lleva) {
        if (actual) tramos.push(actual);
        actual = null;
        continue;
      }
      if (!actual) actual = [t.a];
      if (t.vB) actual.push(t.b);
      else {
        const sig = trozos[(i0 + s + 1) % trozos.length]!;
        if (!sig.lleva) actual.push(t.b);
      }
    }
    if (actual) tramos.push(actual);
  }
  return tramos.filter((t) => t.length >= 2);
}

/** La carga de borde resuelta: sus cargas lineales, con el id de la carga o `<id>:k`. */
export function lineasBorde(m: ModeloFisico, c: CargaBorde, eps = EPS): Extract<CargaFisica, { tipo: "lineal" }>[] | null {
  const tramos = tramosBorde(m, c, eps);
  if (!tramos || !tramos.length) return null;
  const l = (m.losas ?? []).find((x) => x.id === c.losa)!;
  return tramos.map((puntos, k) => ({ tipo: "lineal", id: tramos.length > 1 ? `${c.id}:${k + 1}` : c.id, caso: c.caso, planta: l.planta, puntos, q: c.q }));
}

/**
 * El modelo con cada carga de borde resuelta en cargas lineales (las que no se pueden resolver se
 * quedan para el validador), y de qué carga de borde sale cada id. Sin cargas de borde, el mismo
 * objeto.
 */
export function resolverBordes(m: ModeloFisico, eps = EPS): { modelo: ModeloFisico; origen: Map<string, string> } {
  const origen = new Map<string, string>();
  if (typeof m !== "object" || m === null || !Array.isArray(m.cargas) || !m.cargas.some((c) => typeof c === "object" && c !== null && c.tipo === "borde")) return { modelo: m, origen };
  try {
    const cargas = m.cargas.flatMap((c): CargaFisica[] => {
      if (c?.tipo !== "borde") return [c];
      const ls = lineasBorde(m, c, eps);
      if (!ls) return [c];
      for (const x of ls) origen.set(x.id, c.id);
      return ls;
    });
    return { modelo: { ...m, cargas }, origen };
  } catch {
    return { modelo: m, origen: new Map() };
  }
}
