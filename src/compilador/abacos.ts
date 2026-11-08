/**
 * Ábacos de un forjado reticular (MA2, `docs/fem3d/modelado.md` §2.2): los dados en
 * `reticular.abacos` y, con `reticular.abacosPilares`, uno en cada pilar que llega a la losa; los que
 * se solapan o quedan a menos de una tolerancia, unidos.
 *
 * - **Ábacos en los pilares** (`{ lado }` o `{ lados: [a, b] }`): un rectángulo de a × b (a según el
 *   `eje1` de la losa, b según su perpendicular) centrado en el eje del tramo del pilar que atraviesa
 *   el forjado (en la planta de su base, el de encima; PF). Llega a la losa un pilar que pasa por su
 *   planta (también si arranca o acaba en ella) y cuyo eje está en ella (dentro o en su borde, no en
 *   un hueco). Un pilar cuyo eje está ya en un ábaco dado no lleva otro. Lo que cae fuera de la losa
 *   no cuenta, como en los dados. La regla es la de «Ábacos» del editor (`editor/abacos.ts`).
 * - **Unión** (MA-c, MA-d): dos ábacos (dados o en pilares) que se solapan o quedan a menos de la
 *   tolerancia (h/2, la mitad del tamaño de malla) se sustituyen por su envolvente rectangular según
 *   los ejes de la losa, hasta que no quede ninguno así. Como las envolventes sólo crecen, el
 *   resultado no depende del orden. Con ábacos alineados (lo normal), la envolvente es la unión; en
 *   diagonal cubre zona que no es de ninguno. Lo dice el aviso `reticular/abacos-unidos`.
 * - Sin `abacosPilares` y sin nada que unir, la losa sale tal cual (el mismo objeto): los proyectos
 *   de antes de MA2 dan los mismos bits.
 *
 * `resolverAbacos` se aplica antes de validar, en el compilador, y en lo que dibuja o pesa el modelo
 * físico sin compilar (sensatez, render, sólido, tablas), así que todos ven los mismos ábacos. Un dato
 * mal formado se deja como está para que lo diga el validador.
 *
 * Puro: sin IO.
 */
import type { Diagnosticos } from "../motor/diagnosticos.ts";
import type { AbacosPilares, Losa, ModeloFisico, Seccion, Vec2 } from "./fisico.ts";
import { TAMANO_MALLA } from "./fisico.ts";
import { areaConSigno, areaInterseccionRegiones, distanciaABorde, distanciaEntreSegmentos, puntoEnPoligono, puntoEnRegion, trozosSegmento, type Region } from "./poligonos.ts";
import { ejeSeccion } from "./puntoFijo.ts";

/** Tolerancia de unión por defecto (MA-d): la mitad del tamaño de malla por defecto. */
export const TOLERANCIA_ABACOS = TAMANO_MALLA / 2;

/**
 * El id de selección del ábaco i (desde 0) de `reticular.abacos` de una losa (fase AC,
 * `docs/fem3d/abacos.md`): lo usan el dibujo y el editor para elegir cada ábaco. No es un id del
 * modelo: no se guarda.
 */
export const idAbaco = (losa: string, i: number): string => `${losa}/A${i + 1}`;

/** Un ábaco y de dónde sale: «ábaco 3» (el tercero dado) o el id del pilar. */
export interface AbacoOrigen {
  poligono: Vec2[];
  origen: string[];
}

export interface AbacosResueltos {
  /** Los ábacos de la losa, ya unidos (los dados que no cambian, tal cual). */
  abacos: Vec2[][];
  /** Los ábacos en los pilares, antes de unir, en el orden de los pilares del modelo. */
  enPilares: { pilar: string; poligono: Vec2[] }[];
  /** Las uniones: lo que se unió y el rectángulo que queda. */
  unidos: AbacoOrigen[];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const region = (p: readonly Vec2[]): Region => ({ contorno: p, huecos: [] });
const esPunto = (q: unknown): q is Vec2 => Array.isArray(q) && q.length === 2 && q.every((x) => typeof x === "number" && Number.isFinite(x));
const esPoligono = (p: unknown): p is Vec2[] => Array.isArray(p) && p.length >= 3 && p.every(esPunto);
const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Los lados [a, b] de `abacosPilares`, o null si no es { lado } ni { lados: [a, b] } con medidas > 0. */
export function ladosAbacos(a: AbacosPilares | undefined): [number, number] | null {
  if (typeof a !== "object" || a === null) return null;
  const o = a as { lado?: unknown; lados?: unknown };
  const claves = Object.keys(o);
  if (claves.length === 1 && claves[0] === "lado" && pos(o.lado)) return [o.lado, o.lado];
  if (claves.length === 1 && claves[0] === "lados" && Array.isArray(o.lados) && o.lados.length === 2 && o.lados.every(pos)) return [o.lados[0] as number, o.lados[1] as number];
  return null;
}

/** Ejes de la losa: d según su eje1 y n, la perpendicular. */
function ejesLosa(l: Losa): { d: Vec2; n: Vec2 } {
  const g = ((l.eje1 ?? 0) * Math.PI) / 180;
  const d: Vec2 = [Math.cos(g), Math.sin(g)];
  return { d, n: [-d[1], d[0]] };
}

/** El rectángulo de a × b centrado en c, según los ejes de la losa, con los vértices al µm. */
export function rectanguloAbaco(c: Vec2, a: number, b: number, d: Vec2, n: Vec2): Vec2[] {
  const v = (s: number, t: number): Vec2 => [r6(c[0] + (s * a * d[0] + t * b * n[0]) / 2), r6(c[1] + (s * a * d[1] + t * b * n[1]) / 2)];
  return [v(-1, -1), v(1, -1), v(1, 1), v(-1, 1)];
}

/**
 * Los pilares que llegan a la losa, con el eje del tramo que la atraviesa: los que pasan por su
 * planta y tienen el eje en la losa (dentro o en su borde, no en un hueco), en el orden del modelo.
 */
export function pilaresEnLosa(m: ModeloFisico, l: Losa): { pilar: string; eje: Vec2 }[] {
  const ids = m.plantas.map((p) => p.id);
  const k = ids.indexOf(l.planta);
  if (k < 0 || !esPoligono(l.contorno)) return [];
  const huecos = (Array.isArray(l.huecos) ? l.huecos : []).filter(esPoligono);
  const R: Region = { contorno: l.contorno, huecos };
  const enForjado = (q: Vec2) => (puntoEnRegion(q, R) || distanciaABorde(q, l.contorno) < 1e-6) && !huecos.some((h) => puntoEnPoligono(q, h) && distanciaABorde(q, h) > 1e-6);
  const secciones = new Map<string, Seccion>((m.secciones ?? []).map((s) => [s.id, s]));
  const r: { pilar: string; eje: Vec2 }[] = [];
  for (const p of m.pilares ?? []) {
    // Las plantas van de arriba abajo: el pilar ocupa de la de su cabeza (hasta) a la de su base (desde)
    const [ia, ib] = [ids.indexOf(p.hasta), ids.indexOf(p.desde)];
    if (ia < 0 || ib < 0 || k < Math.min(ia, ib) || k > Math.max(ia, ib)) continue;
    // El eje del tramo que atraviesa el forjado (o, en la planta de su base, el de encima; PF)
    const cabeza = ids[k === ib ? k - 1 : k];
    const s = secciones.get(p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion);
    if (!(typeof p.x === "number" && typeof p.y === "number")) continue;
    const c = ejeSeccion(p, s);
    if (esPunto(c) && enForjado(c)) r.push({ pilar: p.id, eje: c });
  }
  return r;
}

/**
 * La retícula de casetones de un reticular en una dirección: celdas de c = s − bw (s, el intereje;
 * bw, el nervio) cada s, las enteras centradas en [a, b] (la caja de la losa según esa dirección).
 * Devuelve el inicio x0 de la celda 0 y la primera y la última que tocan [a, b]: la celda i va de
 * x0 + i·s a x0 + i·s + c. Es la del sólido (`visor/solido.ts`) y la de los ábacos por luces
 * (`editor/abacos.ts`), así que un ábaco redondeado a ella cubre casetones enteros en el dibujo.
 *
 * Con `paso` (la coordenada según esa dirección del punto de paso de los nervios, `Reticular.paso`),
 * un eje de nervio pasa por él: las celdas empiezan a medio nervio, (s − c)/2, de cada eje. Sin él,
 * las celdas enteras van centradas, como antes.
 */
export function reticulaCasetones(a: number, b: number, s: number, c: number, paso?: number): [number, number, number] {
  let x0: number;
  if (paso === undefined) {
    const k = Math.max(1, Math.floor((b - a - c) / s + 1e-9) + 1);
    x0 = (a + b) / 2 - ((k - 1) * s + c) / 2;
  } else {
    // El eje de nervio del punto de paso, llevado al primero que no pasa de a
    const e = paso - Math.floor((paso - a) / s) * s;
    x0 = e + (s - c) / 2;
  }
  return [x0, Math.floor((a - x0) / s), Math.ceil((b - x0 - c) / s)];
}

/**
 * Los ejes de los nervios de un reticular en una dirección, en coordenadas según ella: los de
 * `reticulaCasetones` (entre dos celdas, a medio nervio de cada una) que caen dentro de (a, b).
 */
export function ejesNervios(a: number, b: number, s: number, c: number, paso?: number): number[] {
  const [x0, i0, i1] = reticulaCasetones(a, b, s, c, paso);
  const r: number[] = [];
  for (let i = i0; i <= i1 + 1; i++) {
    const x = x0 + i * s - (s - c) / 2;
    if (x > a && x < b) r.push(x);
  }
  return r;
}

/** (cos, sen) del ángulo en grados, exactos en los múltiplos de 90° (como el sólido y `direccionEje1`). */
function direccionGrados(grados: number): Vec2 {
  const g = ((grados % 360) + 360) % 360;
  const q = g / 90;
  return Number.isInteger(q) ? (([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[q] as Vec2) : [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
}

/**
 * Los ejes de los nervios de un reticular en planta: los trozos de cada eje (de las dos familias,
 * según el `eje1` y su perpendicular, por el punto de paso) que caen en la zona aligerada, la losa sin
 * sus huecos ni sus ábacos (los que tiene la losa: se le pasa ya resuelta). Es la retícula del sólido.
 * Vacío si la losa no es un reticular bien formado.
 */
export function nerviosLosa(l: Losa): [Vec2, Vec2][] {
  const ret = l.reticular;
  if (!ret || !(ret.intereje > 0 && ret.nervio > 0 && ret.nervio < ret.intereje) || l.contorno.length < 3) return [];
  const s = ret.intereje;
  const c = s - ret.nervio;
  const d = direccionGrados(l.eje1 ?? 0);
  const n: Vec2 = [-d[1], d[0]];
  const huecos = (l.huecos ?? []) as Vec2[][];
  const abacos = (ret.abacos ?? []) as Vec2[][];
  const R: Region = { contorno: l.contorno, huecos };
  const aligerada = (q: Vec2) => puntoEnRegion(q, R) && !abacos.some((a) => puntoEnPoligono(q, a));
  const anillos = [l.contorno as Vec2[], ...huecos, ...abacos];
  const S = (q: readonly number[]) => q[0]! * d[0] + q[1]! * d[1];
  const T = (q: readonly number[]) => q[0]! * n[0] + q[1]! * n[1];
  const [ls, lt] = [l.contorno.map(S), l.contorno.map(T)];
  const [X0, X1, Y0, Y1] = [Math.min(...ls), Math.max(...ls), Math.min(...lt), Math.max(...lt)];
  const g = (x: number, y: number): Vec2 => [x * d[0] + y * n[0], x * d[1] + y * n[1]];
  const P = ret.paso;
  const r: [Vec2, Vec2][] = [];
  for (const x of ejesNervios(X0, X1, s, c, P && S(P))) r.push(...trozosSegmento(g(x, Y0), g(x, Y1), anillos, aligerada));
  for (const y of ejesNervios(Y0, Y1, s, c, P && T(P))) r.push(...trozosSegmento(g(X0, y), g(X1, y), anillos, aligerada));
  return r;
}

/**
 * El punto de paso de los nervios de un reticular: el dado o, sin él, el cruce de nervios de la
 * retícula centrada más cercano al centro de la caja de la losa (por donde se coge para moverla).
 * null si la losa no es un reticular bien formado o no le cabe ningún nervio.
 */
export function puntoPasoNervios(l: Losa): Vec2 | null {
  const ret = l.reticular;
  if (!ret || !(ret.intereje > 0 && ret.nervio > 0 && ret.nervio < ret.intereje) || l.contorno.length < 3) return null;
  if (ret.paso) return ret.paso;
  const d = direccionGrados(l.eje1 ?? 0);
  const n: Vec2 = [-d[1], d[0]];
  const ls = l.contorno.map((q) => q[0] * d[0] + q[1] * d[1]);
  const lt = l.contorno.map((q) => q[0] * n[0] + q[1] * n[1]);
  const c = ret.intereje - ret.nervio;
  const cerca = (a: number, b: number) => {
    const xs = ejesNervios(a, b, ret.intereje, c);
    const m = (a + b) / 2;
    return xs.length ? xs.reduce((x, y) => (Math.abs(y - m) < Math.abs(x - m) - 1e-9 ? y : x)) : null;
  };
  const x = cerca(Math.min(...ls), Math.max(...ls));
  const y = cerca(Math.min(...lt), Math.max(...lt));
  return x === null || y === null ? null : [x * d[0] + y * n[0], x * d[1] + y * n[1]];
}

/** Distancia entre dos polígonos: 0 si se cortan o uno contiene al otro. */
function distanciaPoligonos(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (puntoEnPoligono(a[0]!, b) || puntoEnPoligono(b[0]!, a)) return 0;
  let d = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      d = Math.min(d, distanciaEntreSegmentos(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!));
      if (d === 0) return 0;
    }
  return d;
}

/**
 * Los ábacos de una losa reticular: los dados, los de sus pilares y las uniones (ver la cabecera).
 * `tolerancia`: la distancia por debajo de la cual dos ábacos se unen (h/2). null si la losa no es un
 * reticular o sus ábacos están mal formados (lo dice el validador).
 */
export function abacosLosa(m: ModeloFisico, l: Losa, tolerancia = TOLERANCIA_ABACOS, epsGeom = 1e-9): AbacosResueltos | null {
  const ret = l.reticular;
  if (typeof ret !== "object" || ret === null) return null;
  const dados = ret.abacos ?? [];
  if (!Array.isArray(dados) || !dados.every(esPoligono)) return null;
  const { d, n } = ejesLosa(l);
  const enPilares: AbacosResueltos["enPilares"] = [];
  const lados = ret.abacosPilares === undefined ? null : ladosAbacos(ret.abacosPilares);
  if (ret.abacosPilares !== undefined && !lados) return null;
  if (lados)
    for (const { pilar, eje } of pilaresEnLosa(m, l)) {
      if (dados.some((e) => puntoEnPoligono(eje, e))) continue;
      enPilares.push({ pilar, poligono: rectanguloAbaco(eje, lados[0], lados[1], d, n) });
    }
  // Unión hasta que no quede ningún par a menos de la tolerancia. Cada grupo guarda los polígonos de
  // origen: la envolvente se calcula siempre de ellos, sin acumular redondeos.
  type Grupo = { poligono: Vec2[]; miembros: Vec2[][]; origen: string[] };
  const grupos: Grupo[] = [...dados.map((p, i) => ({ poligono: p as Vec2[], miembros: [p as Vec2[]], origen: [`ábaco ${i + 1}`] })), ...enPilares.map((x) => ({ poligono: x.poligono, miembros: [x.poligono], origen: [x.pilar] }))];
  const caja = (p: readonly Vec2[]) => p.reduce(([x0, y0, x1, y1], q) => [Math.min(x0, q[0]), Math.min(y0, q[1]), Math.max(x1, q[0]), Math.max(y1, q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const cerca = (a: Grupo, b: Grupo) => {
    const [ca, cb] = [caja(a.poligono), caja(b.poligono)];
    if (ca[0] - cb[2] >= tolerancia || cb[0] - ca[2] >= tolerancia || ca[1] - cb[3] >= tolerancia || cb[1] - ca[3] >= tolerancia) return false;
    const dist = distanciaPoligonos(a.poligono, b.poligono);
    if (dist < tolerancia) return true;
    if (dist > 0) return false;
    // Tolerancia 0 y se tocan: un solape de área (los dados pueden no ser convexos)
    return areaInterseccionRegiones(region(a.poligono), region(b.poligono)) > epsGeom * Math.min(Math.abs(areaConSigno(a.poligono)), Math.abs(areaConSigno(b.poligono)));
  };
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (let i = 0; i < grupos.length && !cambio; i++)
      for (let j = i + 1; j < grupos.length && !cambio; j++) {
        const [a, b] = [grupos[i]!, grupos[j]!];
        if (!cerca(a, b)) continue;
        const miembros = [...a.miembros, ...b.miembros];
        let [s0, s1, t0, t1] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const p of miembros)
          for (const q of p) {
            const s = q[0] * d[0] + q[1] * d[1];
            const t = q[0] * n[0] + q[1] * n[1];
            [s0, s1, t0, t1] = [Math.min(s0, s), Math.max(s1, s), Math.min(t0, t), Math.max(t1, t)];
          }
        const v = (s: number, t: number): Vec2 => [r6(s * d[0] + t * n[0]), r6(s * d[1] + t * n[1])];
        const poligono = [v(s0, t0), v(s1, t0), v(s1, t1), v(s0, t1)];
        grupos.splice(j, 1);
        grupos[i] = { poligono, miembros, origen: [...a.origen, ...b.origen] };
        cambio = true;
      }
  }
  return {
    abacos: grupos.map((g) => g.poligono),
    enPilares,
    unidos: grupos.filter((g) => g.origen.length > 1).map((g) => ({ poligono: g.poligono, origen: g.origen })),
  };
}

/**
 * El modelo con los ábacos de cada reticular resueltos en `reticular.abacos` (sin `abacosPilares`),
 * y lo resuelto por losa. Sin nada que resolver, el mismo objeto.
 */
export function resolverAbacos(m: ModeloFisico, tolerancia = TOLERANCIA_ABACOS, epsGeom = 1e-9): { modelo: ModeloFisico; porLosa: Map<string, AbacosResueltos> } {
  try {
    return resolver(m, tolerancia, epsGeom);
  } catch {
    // Un modelo mal formado de otra manera (lo dice el validador): sin resolver
    return { modelo: m, porLosa: new Map() };
  }
}

function resolver(m: ModeloFisico, tolerancia: number, epsGeom: number): { modelo: ModeloFisico; porLosa: Map<string, AbacosResueltos> } {
  const porLosa = new Map<string, AbacosResueltos>();
  if (!Array.isArray(m.losas)) return { modelo: m, porLosa };
  let cambia = false;
  const losas = m.losas.map((l) => {
    if (typeof l !== "object" || l === null || typeof l.reticular !== "object" || l.reticular === null) return l;
    const r = abacosLosa(m, l, tolerancia, epsGeom);
    if (!r) return l;
    porLosa.set(l.id, r);
    if (l.reticular.abacosPilares === undefined && !r.unidos.length) return l;
    cambia = true;
    const { abacosPilares: _, ...ret } = l.reticular;
    return { ...l, reticular: { ...ret, abacos: r.abacos } };
  });
  return { modelo: cambia ? { ...m, losas } : m, porLosa };
}

/** Los ábacos de una losa tal como los usa el cálculo (los de `abacosLosa`, o los dados si no se pueden resolver). */
export function abacosDe(m: ModeloFisico, l: Losa, tolerancia = TOLERANCIA_ABACOS): readonly (readonly Vec2[])[] {
  return abacosLosa(m, l, tolerancia)?.abacos ?? (Array.isArray(l.reticular?.abacos) ? l.reticular!.abacos : []);
}

/**
 * Los pilares que llegan a cada reticular sin un ábaco (AC-d, decisión del usuario del 2026-11-07:
 * un reticular lleva siempre un ábaco macizo en cada pilar). Llega a la losa lo que da
 * `pilaresEnLosa`; tiene ábaco si su eje cae en uno de los resueltos (dentro o en su borde), la regla
 * con la que `abacosPilares` se salta un pilar que ya lo tiene. Por losa, en el orden del modelo.
 */
export function pilaresSinAbaco(m: ModeloFisico, porLosa: ReadonlyMap<string, AbacosResueltos>): { losa: string; pilares: string[] }[] {
  const r: { losa: string; pilares: string[] }[] = [];
  if (typeof m !== "object" || m === null || !Array.isArray(m.losas)) return r;
  for (const l of m.losas) {
    const res = typeof l === "object" && l !== null ? porLosa.get(l.id) : undefined;
    if (!res) continue;
    let sin: string[];
    try {
      sin = pilaresEnLosa(m, l)
        .filter(({ eje }) => !res.abacos.some((a) => puntoEnPoligono(eje, a) || distanciaABorde(eje, a) < 1e-6))
        .map((x) => x.pilar);
    } catch {
      // Pilares mal formados de otra manera: lo dice el validador
      continue;
    }
    if (sin.length) r.push({ losa: l.id, pilares: sin });
  }
  return r;
}

/** El error `reticular/pilar-sin-abaco` de cada reticular con pilares sin ábaco (`pilaresSinAbaco`). */
export function errorPilaresSinAbaco(m: ModeloFisico, porLosa: ReadonlyMap<string, AbacosResueltos>, diag: Diagnosticos): void {
  for (const { losa, pilares } of pilaresSinAbaco(m, porLosa))
    diag.error(
      "reticular/pilar-sin-abaco",
      `${losa}: ${pilares.length > 1 ? `los pilares ${lista(pilares)} llegan` : `el pilar ${pilares[0]} llega`} al forjado reticular sin ábaco. Un reticular lleva un ábaco macizo en cada pilar: póngaselo con la herramienta Ábaco (un clic en el pilar, o «En todos los pilares…» de su plantilla), o en el proyecto con reticular.abacos o reticular.abacosPilares.`,
      [losa, ...pilares],
    );
}

const lista = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const coma = (x: number) => String(Number(x.toFixed(3))).replace(".", ",");

/** El aviso `reticular/abacos-unidos` de cada unión (MA-c), con lo que se unió y el rectángulo que queda. */
export function avisarAbacosUnidos(porLosa: ReadonlyMap<string, AbacosResueltos>, tolerancia: number, diag: Diagnosticos): void {
  for (const [losa, r] of porLosa)
    for (const u of r.unidos) {
      const [a, b, c] = [u.poligono[0]!, u.poligono[1]!, u.poligono[3]!];
      const [la, lb] = [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1])];
      const pilares = u.origen.filter((o) => !o.startsWith("ábaco "));
      const dados = u.origen.filter((o) => o.startsWith("ábaco "));
      const que = [pilares.length ? `los de ${pilares.length > 1 ? "los pilares" : "el pilar"} ${lista(pilares)}` : "", dados.length ? `${dados.length > 1 ? "los ábacos dados" : "el ábaco dado"} ${lista(dados.map((d) => d.slice(6)))}` : ""].filter(Boolean).join(" y ");
      diag.aviso(
        "reticular/abacos-unidos",
        `${losa}: ${que} se solapan o quedan a menos de ${coma(tolerancia)} m y van unidos en un ábaco de ${coma(la)} × ${coma(lb)} m, su rectángulo envolvente según los nervios (MA2). Si no es eso, dé los ábacos a mano en reticular.abacos.`,
        [losa, ...pilares],
        { poligono: u.poligono, origen: u.origen },
      );
    }
}
