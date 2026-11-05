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
import { areaConSigno, areaInterseccionRegiones, distanciaABorde, distanciaEntreSegmentos, puntoEnPoligono, puntoEnRegion, type Region } from "./poligonos.ts";
import { ejeSeccion } from "./puntoFijo.ts";

/** Tolerancia de unión por defecto (MA-d): la mitad del tamaño de malla por defecto. */
export const TOLERANCIA_ABACOS = TAMANO_MALLA / 2;

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
