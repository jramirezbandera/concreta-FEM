/**
 * Diagramas de barras en el espacio (I4, `docs/fem3d/interfaz.md` §7): lo común al 3D del visor
 * (`src/visor/diagramas3d.ts`) y al alzado con resultados (`alzadoDiagramas.ts`).
 *
 * - Cada tramo flexible de una pieza (vigas, viguetas y pilares) va de i' a j' (los nudos con sus
 *   offsets rígidos), con los ejes locales del motor (`marcoBarra`: x = i'→j', z = el canto, y = z × x).
 * - Sus valores son los de `envolventeTramo` (A4): las mismas estaciones y los mismos números que la
 *   envolvente de la pieza en la planta y en el alzado de la pieza, bit a bit. Se guardan por
 *   resultados, barra y conjunto: cambiar de vista o de escala no los recalcula.
 * - Una curva se parte donde cambia de signo (en el cero, interpolado) en trozos de un solo signo,
 *   cada uno con el pie de cada punto en el eje y su punta. Se rellena lo de fuera de la envolvente:
 *   lo positivo de la curva máxima y lo negativo de la mínima (con una sola combinación, toda la
 *   curva); lo de dentro, que tapa la otra curva, va sólo como línea.
 * - El signo de lectura de una pieza (`signo`) es el de su sentido canónico, que da quien dibuja
 *   (en 3D, X, Y o Z crecientes; en un alzado, u o z crecientes): los cortantes y los axiles se
 *   dibujan del mismo lado sea cual sea el sentido en que se dibujó la pieza. Los momentos van
 *   siempre del lado de las tracciones.
 *
 * Puro: sin IO.
 */
import type { TramoFlexible } from "../../compilador/resultados.ts";
import { marcoBarra } from "../../elementos/barra.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { diagramaCombinado } from "../consultas.ts";
import { envolventeTramo, type PuntoEnvolvente, type ResultadosRender } from "./resultados.ts";

export type V3 = [number, number, number];

/** Ordenada (m) del mayor |valor| que se ve, con la escala 1. */
export const ORDENADA_DIAGRAMA = 1.5;

export interface TramoEspacio {
  pieza: string;
  tipo: "viga" | "pilar" | "vigueta";
  t: TramoFlexible;
  /** Planta del tramo: la de la cabeza en un pilar, la de su nudo i en una viga o una vigueta. */
  planta: string;
  /** i' y j' (m, globales). */
  a: V3;
  b: V3;
  /** Ejes locales del tramo (x, y, z), globales. */
  e1: V3;
  e2: V3;
  e3: V3;
  /** +1 si el tramo va en el sentido canónico de su pieza; si no, −1. */
  signo: 1 | -1;
}

export const punto = (a: V3, b: V3, f: number): V3 => [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
export const pv = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const pe = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const por = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** El sentido canónico en 3D: Z creciente si la pieza va más en vertical; si no, X creciente (o Y si va más en Y). */
export function canonico3D(d: V3): 1 | -1 {
  const h = Math.hypot(d[0], d[1]);
  const c = Math.abs(d[2]) > h ? d[2] : Math.abs(d[0]) >= Math.abs(d[1]) ? d[0] : d[1];
  return c < 0 ? -1 : 1;
}

/** Los tramos flexibles de una pieza en el espacio, en su orden. `canonico`: el sentido de lectura de la pieza por su dirección de principio a fin. */
export function tramosEspacio(r: ResultadosRender, pieza: string, canonico: (d: V3) => 1 | -1): TramoEspacio[] {
  const m = r.c.modelo;
  const mapeo = r.c.mapeo;
  const plantas = r.q.fisico.plantas.map((p) => p.id);
  const ts = r.ep.tramos(pieza);
  const r0 = ts.map((t) => {
    const barra = m.barras![t.barra]!;
    const mb = mapeo.barras[t.barra]!;
    const [ni, nj] = barra.nudos.map((n) => m.nudos[n]!);
    const [oi, oj] = [barra.offsets?.i ?? [0, 0, 0], barra.offsets?.j ?? [0, 0, 0]];
    const a: V3 = [ni!.x + oi[0], ni!.y + oi[1], ni!.z + oi[2]];
    const b: V3 = [nj!.x + oj[0], nj!.y + oj[1], nj!.z + oj[2]];
    const { R } = marcoBarra(a, b, barra.vz);
    const planta = mb.tipo === "pilar" ? (plantas[mb.tramo] ?? "") : mapeo.nudos[barra.nudos[0]]!.planta;
    return { pieza, tipo: mb.tipo, t, planta, a, b, e1: [R[0]!, R[1]!, R[2]!] as V3, e2: [R[3]!, R[4]!, R[5]!] as V3, e3: [R[6]!, R[7]!, R[8]!] as V3 };
  });
  if (!r0.length) return [];
  // La dirección de la pieza, de su primer i' a su último j' (la del primer tramo si cierra sobre sí)
  let D: V3 = [r0[r0.length - 1]!.b[0] - r0[0]!.a[0], r0[r0.length - 1]!.b[1] - r0[0]!.a[1], r0[r0.length - 1]!.b[2] - r0[0]!.a[2]];
  if (Math.hypot(...D) < 1e-9) D = r0[0]!.e1;
  const S = canonico(D);
  return r0.map((x) => ({ ...x, signo: (S * (pe(x.e1, D) >= 0 ? 1 : -1)) as 1 | -1 }));
}

const CACHE = new WeakMap<ResultadosRender, Map<string, PuntoEnvolvente[]>>();

/**
 * `envolventeTramo` guardada. `clave` distingue lo que se evalúa: el conjunto y la componente (o los
 * coeficientes de una combinación de componentes).
 */
export function envolventeGuardada(r: ResultadosRender, t: TramoFlexible, conjunto: ConjuntoCombinaciones, comp: number | readonly (readonly [number, number])[]): PuntoEnvolvente[] {
  let m = CACHE.get(r);
  if (!m) CACHE.set(r, (m = new Map()));
  const clave = JSON.stringify([t.barra, conjunto.descripcion, conjunto.nombres, comp]);
  let x = m.get(clave);
  if (!x) {
    const f = typeof comp === "number" ? comp : comp.length === 1 && comp[0]![1] === 1 ? comp[0]![0] : (e: readonly number[]) => comp.reduce((s, [c, k]) => s + k * e[c]!, 0);
    m.set(clave, (x = envolventeTramo(r, t, conjunto, f)));
  }
  return x;
}

/** Un trozo de una curva de un solo signo: el pie de cada punto en el eje y su punta. */
export interface Trozo {
  signo: 1 | -1;
  /** Se rellena (lo de fuera de la envolvente) o va sólo como línea. */
  relleno: boolean;
  pies: V3[];
  puntas: V3[];
}

/**
 * Los trozos de las curvas de un tramo. `d`: la dirección (unitaria) de los valores positivos;
 * `k`: m por unidad. Con `una` (una sola combinación), la curva mínima es la máxima y no se repite.
 */
export function trozosTramo(tr: TramoEspacio, puntos: readonly PuntoEnvolvente[], d: V3, k: number, una: boolean): Trozo[] {
  const L = tr.t.s1 - tr.t.s0;
  const pie = (s: number) => punto(tr.a, tr.b, L > 0 ? (s - tr.t.s0) / L : 0);
  const r: Trozo[] = [];
  for (const curva of una ? (["max"] as const) : (["max", "min"] as const)) {
    // Los puntos, con un cero interpolado donde la curva cruza el eje
    const P: { pie: V3; v: number }[] = [];
    puntos.forEach((p, i) => {
      const v = p[curva];
      if (i > 0) {
        const [s0, v0] = [puntos[i - 1]!.s, puntos[i - 1]![curva]];
        if ((v0 > 0 && v < 0) || (v0 < 0 && v > 0)) {
          const f = v0 / (v0 - v);
          P.push({ pie: pie(s0 + f * (p.s - s0)), v: 0 });
        }
      }
      P.push({ pie: pie(p.s), v });
    });
    let actual: Trozo | null = null;
    for (let i = 0; i + 1 < P.length; i++) {
      const [p, q] = [P[i]!, P[i + 1]!];
      const s = Math.sign(p.v + q.v);
      if (s === 0) {
        actual = null;
        continue;
      }
      if (!actual || actual.signo !== s) {
        const relleno: boolean = una || (curva === "max" ? s > 0 : s < 0);
        actual = { signo: s as 1 | -1, relleno, pies: [p.pie], puntas: [sumar(p.pie, d, p.v * k)] };
        r.push(actual);
      }
      actual.pies.push(q.pie);
      actual.puntas.push(sumar(q.pie, d, q.v * k));
    }
  }
  return r;
}

const sumar = (p: V3, d: V3, f: number): V3 => [p[0] + d[0] * f, p[1] + d[1] * f, p[2] + d[2] * f];

/** El máximo de la curva máxima y el mínimo de la mínima de un tramo, con su estación y su lado. */
export function extremosCurva(puntos: readonly PuntoEnvolvente[]): { max: { v: number; s: number; i: number } | null; min: { v: number; s: number; i: number } | null } {
  let max: { v: number; s: number; i: number } | null = null;
  let min: { v: number; s: number; i: number } | null = null;
  puntos.forEach((p, i) => {
    if (!max || p.max > max.v) max = { v: p.max, s: p.s, i };
    if (!min || p.min < min.v) min = { v: p.min, s: p.s, i };
  });
  return { max, min };
}

/**
 * La combinación que da `objetivo` en la estación s de un tramo (la primera, en el orden del
 * conjunto), o null si ninguna lo da exactamente.
 */
export function combinacionEn(r: ResultadosRender, t: TramoFlexible, conjunto: ConjuntoCombinaciones, comp: number | readonly (readonly [number, number])[], s: number, objetivo: number): string | null {
  const x = Math.min(t.s1 - t.s0, Math.max(0, s - t.s0));
  const valor = (e: readonly number[]) => (typeof comp === "number" ? e[comp]! : comp.length === 1 && comp[0]![1] === 1 ? e[comp[0]![0]]! : comp.reduce((a, [c, k]) => a + k * e[c]!, 0));
  for (let k = 0; k < conjunto.factores.length; k++) {
    const dg = diagramaCombinado(r.ep, t.barra, conjunto.factores[k]!);
    for (const lado of [-1, 1] as const) if (valor(dg.esfuerzosEn(x, lado)) === objetivo) return conjunto.nombres[k]!;
  }
  return null;
}

/** Una viga o una vigueta en el plano de un diafragma rígido: su axil no tiene valor (C1-d) y no se dibuja. */
export function axilSinValor(r: ResultadosRender, tr: TramoEspacio): boolean {
  if (tr.tipo === "pilar") return false;
  const v = r.q.viga(tr.pieza);
  return v.valido && v.valor.axilSinValor;
}

/** Las piezas con diagrama (vigas, viguetas y pilares), por id. */
export function piezasConDiagrama(r: ResultadosRender): string[] {
  return Object.keys(r.c.mapeo.piezas).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
