/**
 * Los ábacos de un forjado reticular en el editor (fase AC, `docs/fem3d/abacos.md`).
 *
 * - **Uno a uno (AC-c):** siguen en `reticular.abacos`, pero la app elige cada uno por su id de
 *   selección `<losa>/A<n>` (n, su orden en la lista). No es un id del modelo: no se guarda.
 * - **Unidos en el acto (AC-a, AC-b):** toda operación deja los ábacos de la losa como los resuelve el
 *   compilador (`abacosLosa`, MA-c): los que se solapan o quedan a menos de h/2, en su rectángulo
 *   envolvente según los nervios. Así el fichero tiene lo que se dibuja y lo que se calcula.
 * - **«Ábacos en los pilares»** (decisión del usuario, 2026-10-13): un rectángulo centrado en cada
 *   pilar que llega al forjado, orientado con sus nervios (su `eje1`). Un pilar cuyo eje ya está en un
 *   ábaco se deja; el que se solaparía con otro se une con él (AC-b; antes no se creaba).
 *
 * Puro: sin IO.
 */
import type { Losa, ModeloFisico, OpcionesCompilacion, Vec2 } from "../compilador/fisico.ts";
import { abacosLosa, idAbaco, pilaresEnLosa, rectanguloAbaco, TOLERANCIA_ABACOS } from "../compilador/abacos.ts";
import { areaConSigno, areaInterseccionRegiones, puntoEnPoligono, type Region } from "../compilador/poligonos.ts";
import type { Operacion } from "./operaciones.ts";
import { indiceIds } from "./referencias.ts";

const region = (p: readonly Vec2[]): Region => ({ contorno: p, huecos: [] });
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const igual = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** La tolerancia de unión del proyecto: la mitad de su tamaño de malla (la del compilador). */
export function toleranciaAbacos(o?: OpcionesCompilacion): number {
  return o?.tamanoMalla !== undefined ? o.tamanoMalla / 2 : TOLERANCIA_ABACOS;
}

// ─── Ids de selección ───────────────────────────────────────────────────────────────────────────

export { idAbaco };

/** El ábaco de un id de selección: su losa y su índice; null si no lo es (o es un id del modelo). */
export function leerIdAbaco(m: ModeloFisico, id: string): { losa: Losa; i: number } | null {
  const k = /^(.*)\/A([1-9]\d*)$/.exec(id);
  if (!k) return null;
  const l = (m.losas ?? []).find((x) => x.id === k[1]);
  const i = Number(k[2]) - 1;
  if (!l?.reticular || i >= (l.reticular.abacos ?? []).length) return null;
  if (indiceIds(m).has(id)) return null;
  return { losa: l, i };
}

export const esIdAbaco = (m: ModeloFisico, id: string): boolean => leerIdAbaco(m, id) !== null;

/** El nombre corto de un ábaco elegido: «A3 de L2». */
export function nombreAbaco(id: string): string {
  const k = /^(.*)\/(A\d+)$/.exec(id);
  return k ? `${k[2]} de ${k[1]}` : id;
}

// ─── Geometría según los nervios ────────────────────────────────────────────────────────────────

/** Los ejes de la losa: d según su eje1 (los nervios) y n, su perpendicular. */
export function ejesAbacos(l: Losa): { d: Vec2; n: Vec2 } {
  const g = ((l.eje1 ?? 0) * Math.PI) / 180;
  const d: Vec2 = [Math.cos(g), Math.sin(g)];
  return { d, n: [-d[1], d[0]] };
}

/** Un rectángulo según los nervios: su centro, a (según los nervios) y b (en perpendicular). */
export interface RectanguloAbaco {
  centro: Vec2;
  a: number;
  b: number;
}

/**
 * El rectángulo según los nervios que es el polígono p (cuatro vértices con los lados paralelos a d
 * y n, a 1e-9 de su tamaño), o null si no lo es.
 */
export function rectanguloDe(l: Losa, p: readonly Vec2[]): RectanguloAbaco | null {
  if (p.length !== 4) return null;
  const { d, n } = ejesAbacos(l);
  const s = p.map((q) => q[0] * d[0] + q[1] * d[1]);
  const t = p.map((q) => q[0] * n[0] + q[1] * n[1]);
  const [s0, s1, t0, t1] = [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
  const tol = 1e-9 * Math.max(1, s1 - s0, t1 - t0);
  if (!(s1 - s0 > tol && t1 - t0 > tol)) return null;
  // Cada vértice en una esquina distinta de la caja
  const esquinas = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const cs = Math.abs(s[i]! - s0) <= tol ? 0 : Math.abs(s[i]! - s1) <= tol ? 1 : -1;
    const ct = Math.abs(t[i]! - t0) <= tol ? 0 : Math.abs(t[i]! - t1) <= tol ? 1 : -1;
    if (cs < 0 || ct < 0) return null;
    esquinas.add(`${cs}${ct}`);
  }
  if (esquinas.size !== 4) return null;
  const [sc, tc] = [(s0 + s1) / 2, (t0 + t1) / 2];
  return { centro: [r6(sc * d[0] + tc * n[0]), r6(sc * d[1] + tc * n[1])], a: r6(s1 - s0), b: r6(t1 - t0) };
}

/** El rectángulo según los nervios con su centro y sus lados (el de «Ábacos en los pilares»). */
export function poligonoRectangulo(l: Losa, r: RectanguloAbaco): Vec2[] {
  const { d, n } = ejesAbacos(l);
  return rectanguloAbaco(r.centro, r.a, r.b, d, n);
}

/** El rectángulo según los nervios con dos esquinas opuestas p y q (null si tiene un lado nulo). */
export function rectanguloEsquinas(l: Losa, p: Vec2, q: Vec2): Vec2[] | null {
  const { d, n } = ejesAbacos(l);
  const [sp, tp, sq, tq] = [p[0] * d[0] + p[1] * d[1], p[0] * n[0] + p[1] * n[1], q[0] * d[0] + q[1] * d[1], q[0] * n[0] + q[1] * n[1]];
  const [s0, s1, t0, t1] = [Math.min(sp, sq), Math.max(sp, sq), Math.min(tp, tq), Math.max(tp, tq)];
  const v = (s: number, t: number): Vec2 => [r6(s * d[0] + t * n[0]), r6(s * d[1] + t * n[1])];
  const r = [v(s0, t0), v(s1, t0), v(s1, t1), v(s0, t1)];
  // Con ejes según X e Y, las esquinas dadas tal cual (lo tecleado o enganchado, sin redondeo)
  if (d[0] === 1 && d[1] === 0) {
    const [x0, x1, y0, y1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
    if (!(x1 > x0 && y1 > y0)) return null;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  return s1 - s0 > 1e-9 && t1 - t0 > 1e-9 ? r : null;
}

// ─── Unir y escribir ────────────────────────────────────────────────────────────────────────────

/** Los ábacos de una losa, unidos como en el compilador, y de qué índices de la entrada sale cada uno. */
export function unirComoCompilador(m: ModeloFisico, l: Losa, abacos: readonly Vec2[][], tolerancia = TOLERANCIA_ABACOS): { abacos: Vec2[][]; origen: number[][] } {
  const { abacosPilares: _, ...ret } = l.reticular!;
  const r = abacosLosa(m, { ...l, reticular: { ...ret, abacos } }, tolerancia);
  if (!r) return { abacos: abacos.map((p) => [...p]), origen: abacos.map((_, i) => [i]) };
  // Cada grupo, con los índices de sus «ábaco i» (desde 1); el compilador conserva el orden del primero
  const origen = r.abacos.map((p) => {
    const u = r.unidos.find((x) => x.poligono === p);
    return u ? u.origen.map((o) => Number(o.slice(6)) - 1) : [abacos.indexOf(p)];
  });
  return { abacos: r.abacos, origen };
}

/** Lo que hace una operación de ábacos: la operación, lo que hay que dejar elegido y lo que se dice. */
export type ResultadoAbacos = { ok: true; operacion: Operacion; elegidos: string[]; avisos: string[] } | { ok: false; mensaje: string };

/**
 * La operación que deja en la losa los ábacos `abacos`, unidos (AC-b). `marcados`: los índices de la
 * entrada que hay que dejar elegidos (donde acaben tras unir). null si no cambia nada.
 */
export function escribirAbacos(m: ModeloFisico, l: Losa, abacos: readonly Vec2[][], marcados: readonly number[], tolerancia = TOLERANCIA_ABACOS): ResultadoAbacos {
  const u = unirComoCompilador(m, l, abacos, tolerancia);
  const antes = l.reticular!.abacos ?? [];
  if (u.abacos.length === antes.length && u.abacos.every((p, i) => p.length === antes[i]!.length && p.every((q, k) => igual(q, antes[i]![k] as Vec2)))) return { ok: false, mensaje: "No cambia nada." };
  const elegidos: string[] = [];
  const unidos: string[] = [];
  u.origen.forEach((o, j) => {
    if (!o.some((i) => marcados.includes(i))) return;
    elegidos.push(idAbaco(l.id, j));
    if (o.length > 1) unidos.push(nombreAbaco(idAbaco(l.id, j)));
  });
  const avisos = unidos.length ? [`Unido con lo que solapaba o quedaba a menos de ${coma(tolerancia)} m, en su rectángulo según los nervios: ${unidos.join(", ")}.`] : [];
  const objeto = { ...l, reticular: { ...l.reticular!, abacos: u.abacos } };
  return { ok: true, operacion: { op: "cambiar", coleccion: "losas", id: l.id, objeto: objeto as never }, elegidos, avisos };
}

const reticularDe = (m: ModeloFisico, id: string): Losa | string => {
  const l = (m.losas ?? []).find((x) => x.id === id);
  if (!l) return `No hay ninguna losa «${id}».`;
  if (!l.reticular) return `${id} no es un forjado reticular: sólo los reticulares tienen ábacos.`;
  return l;
};

/** Un ábaco nuevo en la losa: se une con los que solapa (AC-b). */
export function crearAbaco(m: ModeloFisico, losa: string, poligono: readonly Vec2[], tolerancia = TOLERANCIA_ABACOS): ResultadoAbacos {
  const l = reticularDe(m, losa);
  if (typeof l === "string") return { ok: false, mensaje: l };
  if (poligono.length < 3 || !(Math.abs(areaConSigno(poligono)) > 1e-9)) return { ok: false, mensaje: "El ábaco no tiene área." };
  const antes = (l.reticular!.abacos ?? []) as Vec2[][];
  return escribirAbacos(m, l, [...antes, [...poligono]], [antes.length], tolerancia);
}

/** El ábaco `id` cambiado por `poligono`, unido con los que pase a solapar. */
export function cambiarAbaco(m: ModeloFisico, id: string, poligono: readonly Vec2[], tolerancia = TOLERANCIA_ABACOS): ResultadoAbacos {
  const x = leerIdAbaco(m, id);
  if (!x) return { ok: false, mensaje: `No hay ningún ábaco ${id}.` };
  if (poligono.length < 3 || !(Math.abs(areaConSigno(poligono)) > 1e-9)) return { ok: false, mensaje: "El ábaco no tiene área." };
  const abacos = [...((x.losa.reticular!.abacos ?? []) as Vec2[][])];
  abacos[x.i] = [...poligono];
  return escribirAbacos(m, x.losa, abacos, [x.i], tolerancia);
}

/** Varios ábacos de una o más losas cambiados a la vez (Mover, Girar…): una operación por losa. */
export function cambiarAbacos(m: ModeloFisico, cambios: ReadonlyMap<string, readonly Vec2[]>, tolerancia = TOLERANCIA_ABACOS, nuevos: ReadonlyMap<string, readonly (readonly Vec2[])[]> = new Map()): ResultadoAbacos {
  const porLosa = new Map<string, { l: Losa; abacos: Vec2[][]; marcados: number[] }>();
  const de = (l: Losa) => {
    let g = porLosa.get(l.id);
    if (!g) porLosa.set(l.id, (g = { l, abacos: [...((l.reticular!.abacos ?? []) as Vec2[][])], marcados: [] }));
    return g;
  };
  for (const [id, p] of cambios) {
    const x = leerIdAbaco(m, id);
    if (!x) return { ok: false, mensaje: `No hay ningún ábaco ${id}.` };
    const g = de(x.losa);
    g.abacos[x.i] = [...p];
    g.marcados.push(x.i);
  }
  for (const [losa, ps] of nuevos) {
    const l = reticularDe(m, losa);
    if (typeof l === "string") return { ok: false, mensaje: l };
    const g = de(l);
    for (const p of ps) {
      g.marcados.push(g.abacos.length);
      g.abacos.push([...p]);
    }
  }
  const ops: Operacion[] = [];
  const elegidos: string[] = [];
  const avisos: string[] = [];
  for (const { l, abacos, marcados } of porLosa.values()) {
    const r = escribirAbacos(m, l, abacos, marcados, tolerancia);
    if (!r.ok) continue;
    ops.push(r.operacion);
    elegidos.push(...r.elegidos);
    avisos.push(...r.avisos);
  }
  if (!ops.length) return { ok: false, mensaje: "No cambia nada." };
  return { ok: true, operacion: ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops }, elegidos, avisos };
}

/** Los ábacos `ids` quitados de sus losas. */
export function borrarAbacos(m: ModeloFisico, ids: readonly string[]): ResultadoAbacos {
  const porLosa = new Map<string, { l: Losa; quitar: Set<number> }>();
  for (const id of ids) {
    const x = leerIdAbaco(m, id);
    if (!x) continue;
    const g = porLosa.get(x.losa.id) ?? { l: x.losa, quitar: new Set<number>() };
    g.quitar.add(x.i);
    porLosa.set(x.losa.id, g);
  }
  if (!porLosa.size) return { ok: false, mensaje: "No hay ningún ábaco elegido." };
  const ops: Operacion[] = [...porLosa.values()].map(({ l, quitar }) => {
    const abacos = (l.reticular!.abacos ?? []).filter((_, i) => !quitar.has(i));
    return { op: "cambiar", coleccion: "losas", id: l.id, objeto: { ...l, reticular: { ...l.reticular!, abacos } } as never };
  });
  return { ok: true, operacion: ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops }, elegidos: [], avisos: [] };
}

/** «Unir»: los ábacos `ids` (dos o más, del mismo forjado) en su rectángulo envolvente según los nervios. */
export function unirAbacos(m: ModeloFisico, ids: readonly string[], tolerancia = TOLERANCIA_ABACOS): ResultadoAbacos {
  const xs = ids.map((id) => leerIdAbaco(m, id)).filter((x) => x !== null);
  const indices = [...new Set(xs.map((x) => x.i))];
  if (indices.length < 2) return { ok: false, mensaje: "Para unir hacen falta dos ábacos o más." };
  const l = xs[0]!.losa;
  if (xs.some((x) => x.losa.id !== l.id)) return { ok: false, mensaje: "Sólo se unen ábacos del mismo forjado." };
  const { d, n } = ejesAbacos(l);
  const abacos = (l.reticular!.abacos ?? []) as Vec2[][];
  let [s0, s1, t0, t1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const i of indices)
    for (const q of abacos[i]!) {
      const [s, t] = [q[0] * d[0] + q[1] * d[1], q[0] * n[0] + q[1] * n[1]];
      [s0, s1, t0, t1] = [Math.min(s0, s), Math.max(s1, s), Math.min(t0, t), Math.max(t1, t)];
    }
  const v = (s: number, t: number): Vec2 => [r6(s * d[0] + t * n[0]), r6(s * d[1] + t * n[1])];
  const primero = Math.min(...indices);
  const quedan: Vec2[][] = [];
  let marcado = -1;
  abacos.forEach((p, i) => {
    if (i === primero) {
      marcado = quedan.length;
      quedan.push([v(s0, t0), v(s1, t0), v(s1, t1), v(s0, t1)]);
    } else if (!indices.includes(i)) quedan.push(p);
  });
  const r = escribirAbacos(m, l, quedan, [marcado], tolerancia);
  return r.ok ? { ...r, avisos: [`${indices.length} ábacos unidos en un rectángulo de ${coma(s1 - s0)} × ${coma(t1 - t0)} m según los nervios.`, ...r.avisos.filter((a) => !a.startsWith("Se ha unido"))] } : r;
}

const coma = (x: number) => String(Number(x.toFixed(3))).replace(".", ",");

/** «Fijar como polígonos»: los ábacos de `abacosPilares` y los dados, en `reticular.abacos` tal como los calcula el compilador. */
export function fijarAbacosPilares(m: ModeloFisico, losa: string, tolerancia = TOLERANCIA_ABACOS): ResultadoAbacos {
  const l = reticularDe(m, losa);
  if (typeof l === "string") return { ok: false, mensaje: l };
  if (l.reticular!.abacosPilares === undefined) return { ok: false, mensaje: `${losa} no tiene ábacos en los pilares.` };
  const r = abacosLosa(m, l, tolerancia);
  if (!r) return { ok: false, mensaje: `Los ábacos en los pilares de ${losa} están mal escritos.` };
  const { abacosPilares: _, ...ret } = l.reticular!;
  return { ok: true, operacion: { op: "cambiar", coleccion: "losas", id: l.id, objeto: { ...l, reticular: { ...ret, abacos: r.abacos } } as never }, elegidos: [], avisos: [`${r.abacos.length} ábacos fijados en ${losa}: ya no siguen a los pilares.`] };
}

/**
 * El reticular de la planta donde cae el eje de un pilar, con ese eje (el del tramo que atraviesa el
 * forjado; la regla de MA2). null si el pilar no llega a ningún reticular de la planta.
 */
export function reticularDelPilar(m: ModeloFisico, planta: string, pilar: string): { losa: Losa; eje: Vec2 } | null {
  for (const l of m.losas ?? []) {
    if (l.planta !== planta || !l.reticular) continue;
    const x = pilaresEnLosa(m, l).find((p) => p.pilar === pilar);
    if (x) return { losa: l, eje: x.eje };
  }
  return null;
}

/** El reticular de la planta que contiene el punto (el primero; null si ninguno). */
export function reticularEn(m: ModeloFisico, planta: string, q: Vec2): Losa | null {
  for (const l of m.losas ?? []) if (l.planta === planta && l.reticular && puntoEnPoligono(q, l.contorno as Vec2[]) && !(l.huecos ?? []).some((h) => puntoEnPoligono(q, h as Vec2[]))) return l;
  return null;
}

// ─── Pinzamientos ───────────────────────────────────────────────────────────────────────────────

/** Un asa de un ábaco: un vértice (k) o el punto medio del lado k → k+1. */
export interface AsaAbaco {
  id: string;
  tipo: "vertice" | "lado";
  k: number;
  p: Vec2;
}

/** Las asas del ábaco `id`: sus vértices y, si es un rectángulo según los nervios, los medios de sus lados. */
export function asasAbaco(m: ModeloFisico, id: string): AsaAbaco[] {
  const x = leerIdAbaco(m, id);
  if (!x) return [];
  const p = x.losa.reticular!.abacos![x.i] as Vec2[];
  const r: AsaAbaco[] = p.map((q, k) => ({ id, tipo: "vertice", k, p: q }));
  if (rectanguloDe(x.losa, p))
    p.forEach((q, k) => {
      const s = p[(k + 1) % p.length]!;
      r.push({ id, tipo: "lado", k, p: [(q[0] + s[0]) / 2, (q[1] + s[1]) / 2] });
    });
  return r;
}

/**
 * El asa `a` llevada a q. En un rectángulo según los nervios, el vértice se mueve con el opuesto fijo
 * y el lado, en paralelo: sigue siendo un rectángulo. En otro polígono, el vértice se mueve solo y el
 * lado se traslada entero.
 */
export function moverAsaAbaco(m: ModeloFisico, a: AsaAbaco, q: Vec2, tolerancia = TOLERANCIA_ABACOS): ResultadoAbacos {
  if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) return { ok: false, mensaje: "La posición tiene que ser un número." };
  if (igual(a.p, q)) return { ok: false, mensaje: "El punto no se ha movido." };
  const x = leerIdAbaco(m, a.id);
  if (!x) return { ok: false, mensaje: `No hay ningún ábaco ${a.id}.` };
  const p = x.losa.reticular!.abacos![x.i] as Vec2[];
  const rect = rectanguloDe(x.losa, p);
  let nuevo: Vec2[] | null;
  if (a.tipo === "vertice" && rect) nuevo = rectanguloEsquinas(x.losa, p[(a.k + 2) % 4]!, q);
  else if (a.tipo === "vertice") {
    nuevo = [...p];
    nuevo[a.k] = q;
  } else {
    const [i, j] = [a.k, (a.k + 1) % p.length];
    const e: Vec2 = [p[j]![0] - p[i]![0], p[j]![1] - p[i]![1]];
    const L = Math.hypot(e[0], e[1]);
    // Sólo lo perpendicular al lado: se mueve en paralelo
    const nn: Vec2 = [-e[1] / L, e[0] / L];
    const dd = (q[0] - a.p[0]) * nn[0] + (q[1] - a.p[1]) * nn[1];
    const mueve = (v: Vec2): Vec2 => (rect ? [r6(v[0] + dd * nn[0]), r6(v[1] + dd * nn[1])] : [v[0] + dd * nn[0], v[1] + dd * nn[1]]);
    nuevo = [...p];
    if (rect && Math.abs(nn[0]) === 1) {
      // Con ejes según X e Y, el lado va a la coordenada de q tal cual (lo tecleado o enganchado)
      nuevo[i] = [q[0], p[i]![1]];
      nuevo[j] = [q[0], p[j]![1]];
    } else if (rect && Math.abs(nn[1]) === 1) {
      nuevo[i] = [p[i]![0], q[1]];
      nuevo[j] = [p[j]![0], q[1]];
    } else {
      nuevo[i] = mueve(p[i]!);
      nuevo[j] = mueve(p[j]!);
    }
    if (rect && !rectanguloDe(x.losa, nuevo)) nuevo = null;
  }
  if (!nuevo || !(Math.abs(areaConSigno(nuevo)) > 1e-9)) return { ok: false, mensaje: "El ábaco se quedaría sin área." };
  return cambiarAbaco(m, a.id, nuevo, tolerancia);
}

// ─── «Ábacos en los pilares» ────────────────────────────────────────────────────────────────────

export interface PropuestaAbacos {
  losa: string;
  /** Los ábacos nuevos, con el pilar de cada uno, en el orden de los pilares del modelo. */
  nuevos: { pilar: string; poligono: Vec2[] }[];
  /** Pilares que ya tienen un ábaco (su eje dentro de uno): se dejan. */
  conAbaco: string[];
  /** Pilares cuyo ábaco nuevo se solapa con otro (nuevo o de antes): se unen (AC-b). */
  solapados: string[];
  /** Pilares cuyo ábaco nuevo se sale del forjado (cuenta su parte dentro). */
  fuera: string[];
}

/** Los ábacos de `a` × `b` m (según los nervios y su perpendicular) en los pilares que llegan al reticular `losaId`. */
export function proponerAbacos(m: ModeloFisico, losaId: string, a: number, b: number): PropuestaAbacos | { error: string } {
  const l = reticularDe(m, losaId);
  if (typeof l === "string") return { error: l };
  if (!(a > 0 && b > 0)) return { error: "El ábaco tiene que tener las dos medidas mayores que 0." };
  const R: Region = { contorno: l.contorno, huecos: l.huecos ?? [] };
  const { d, n } = ejesAbacos(l);
  const existentes = (l.reticular!.abacos ?? []).map((p) => p as Vec2[]);
  const r: PropuestaAbacos = { losa: losaId, nuevos: [], conAbaco: [], solapados: [], fuera: [] };
  // Los pilares que llegan al forjado, con el eje del tramo que lo atraviesa (la regla de MA2)
  for (const { pilar, eje: c } of pilaresEnLosa(m, l)) {
    if (existentes.some((e) => puntoEnPoligono(c, e))) {
      r.conAbaco.push(pilar);
      continue;
    }
    const poligono = rectanguloAbaco(c, a, b, d, n);
    if ([...existentes, ...r.nuevos.map((x) => x.poligono)].some((e) => areaInterseccionRegiones(region(e), region(poligono)) > 1e-9)) r.solapados.push(pilar);
    r.nuevos.push({ pilar, poligono });
    if (areaInterseccionRegiones(R, region(poligono)) < Math.abs(areaConSigno(poligono)) - 1e-9) r.fuera.push(pilar);
  }
  return r;
}

/** La operación que añade los ábacos de la propuesta a su losa, unidos (null si no hay ninguno nuevo). */
export function operacionAbacos(m: ModeloFisico, p: PropuestaAbacos, tolerancia = TOLERANCIA_ABACOS): Operacion | null {
  const l = (m.losas ?? []).find((x) => x.id === p.losa);
  if (!l?.reticular || !p.nuevos.length) return null;
  const antes = (l.reticular.abacos ?? []) as Vec2[][];
  const r = escribirAbacos(m, l, [...antes, ...p.nuevos.map((x) => x.poligono)], [], tolerancia);
  return r.ok ? r.operacion : null;
}
