/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.12): la zona de un refuerzo o de unos cercos de una losa,
 * editada en la planta. Puro.
 *
 * Un refuerzo y una zona de cercos son un rectángulo (s, t) en los ejes de su armadura (s a lo largo
 * de las barras o de los nervios, t en transversal; `ejesArmadura`). Aquí:
 *  - `zonaElemento`: ese rectángulo, con sus ejes, para dibujarlo;
 *  - `asasZona`: sus cinco asas (el medio de cada lado y el centro);
 *  - `zonaMovida`: la zona al llevar un asa de un punto a otro: la de un lado estira ese lado y la del
 *    centro la mueve entera. Lo que cambia va a `MODULO_ZONA` (5 cm) y ningún lado baja de
 *    `LADO_MINIMO_ZONA`;
 *  - `conZona`, `conElemento`: el armado de la losa con la zona cambiada o con un elemento más;
 *  - `zonaEntre`: la zona entre dos puntos de la planta (las esquinas opuestas de uno nuevo);
 *  - `lindesNervios`, `porNervios`: en un reticular, lo que va por nervios (un refuerzo de n barras por
 *    nervio, unos cercos) tiene sus lados transversales en los lindes entre nervios (a mitad de casetón):
 *    con ellos, `zonaMovida` y `zonaEntre` llevan t al linde más cercano, y la zona coge nervios enteros.
 */
import type { Vec2 } from "../compilador/fisico.ts";
import type { ArmadoForjado, ArmaduraForjado, CercosForjado, RefuerzoForjado } from "../comprobaciones/armado.ts";
import { ejesArmadura } from "../comprobaciones/dibujoArmado.ts";
import type { GrupoArmado } from "./armadoBarras.ts";

export type ElementoLosa = NonNullable<GrupoArmado["elemento"]>;

/** A lo que van las coordenadas que cambia el ratón, m. */
export const MODULO_ZONA = 0.05;
/** El menor lado de una zona, m. */
export const LADO_MINIMO_ZONA = 0.1;

export type AsaZona = "s0" | "s1" | "t0" | "t1" | "centro";

export interface Rango {
  s: [number, number];
  t: [number, number];
}

/** Una zona en la planta: sus ejes y su rectángulo en ellos. */
export interface ZonaPlanta extends Rango {
  d: Vec2;
  n: Vec2;
}

const limpio = (v: number) => Math.round(v * 1e6) / 1e6;
const alModulo = (v: number) => limpio(Math.round(v / MODULO_ZONA) * MODULO_ZONA);
const rango = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x)) && v[1] > v[0];
const enPlanta = (z: Pick<ZonaPlanta, "d" | "n">, s: number, t: number): Vec2 => [s * z.d[0] + t * z.n[0], s * z.d[1] + t * z.n[1]];
const enEjes = (z: Pick<ZonaPlanta, "d" | "n">, p: Vec2): [number, number] => [p[0] * z.d[0] + p[1] * z.d[1], p[0] * z.n[0] + p[1] * z.n[1]];

/**
 * Los lindes entre los nervios de una familia (§8.19): el punto medio entre cada dos ejes seguidos (la
 * mitad del casetón) y, por fuera del primero y del último, a la misma distancia. Entre dos lindes
 * seguidos hay un nervio. Vacío con menos de dos ejes.
 *
 * Con `bordes` (la coordenada transversal de los vértices del contorno de la losa), también ellos: lo
 * que llega al borde acaba en él y no a mitad de un casetón que no existe; y nada fuera de la losa.
 */
export function lindesNervios(ejes: readonly number[], bordes: readonly number[] = []): number[] {
  const e = [...ejes].sort((a, b) => a - b);
  if (e.length < 2) return [];
  const medios = e.slice(1).map((x, i) => (x + e[i]!) / 2);
  const l = [e[0]! - (medios[0]! - e[0]!), ...medios, e[e.length - 1]! + (e[e.length - 1]! - medios[medios.length - 1]!)].map(limpio);
  if (!bordes.length) return l;
  const [lo, hi] = [Math.min(...bordes), Math.max(...bordes)];
  const todos = [...l.filter((x) => x > lo + 1e-6 && x < hi - 1e-6), ...bordes.map(limpio)].sort((a, b) => a - b);
  return todos.filter((x, i) => i === 0 || x - todos[i - 1]! > 1e-6);
}

/** ¿Va por nervios? Unos cercos que no son de los ábacos, o un refuerzo de n barras por nervio que no es de los ábacos. (En una maciza no hay nervios a los que ir.) */
export function porNervios(a: Pick<ArmadoForjado, "refuerzos" | "cercos"> | undefined, e: ElementoLosa): boolean {
  if (e.lista === "cercos") return a?.cercos?.[e.indice]?.en !== "abacos";
  const x = a?.refuerzos?.[e.indice];
  return !!x && x.en !== "abacos" && (x.barras as { n?: number }).n !== undefined;
}

/** El linde más cercano a t que cumple la condición; null si ninguno. */
function alLinde(lindes: readonly number[], t: number, vale: (l: number) => boolean = () => true): number | null {
  let mejor: number | null = null;
  for (const l of lindes) if (vale(l) && (mejor === null || Math.abs(l - t) < Math.abs(mejor - t))) mejor = l;
  return mejor;
}

/** La zona de un refuerzo o de unos cercos de una losa; null si no existe o no vale. */
export function zonaElemento(eje1: number | undefined, a: Pick<ArmadoForjado, "refuerzos" | "cercos"> | undefined, e: ElementoLosa): ZonaPlanta | null {
  const x = e.lista === "refuerzos" ? a?.refuerzos?.[e.indice] : a?.cercos?.[e.indice];
  if (!x || !rango(x.s) || !rango(x.t)) return null;
  const de = "armadura" in x ? x.armadura : x.direccion;
  if (typeof de !== "string" || !/^[xy]/.test(de)) return null;
  return { ...ejesArmadura(eje1, de as ArmaduraForjado), s: [x.s[0], x.s[1]], t: [x.t[0], x.t[1]] };
}

/** Las cuatro esquinas de una zona, en planta. */
export function esquinasZona(z: ZonaPlanta): [Vec2, Vec2, Vec2, Vec2] {
  return [enPlanta(z, z.s[0], z.t[0]), enPlanta(z, z.s[1], z.t[0]), enPlanta(z, z.s[1], z.t[1]), enPlanta(z, z.s[0], z.t[1])];
}

/** Las asas de una zona: el medio de cada lado (lo estira) y el centro (la mueve). */
export function asasZona(z: ZonaPlanta): { asa: AsaZona; p: Vec2 }[] {
  const [sm, tm] = [(z.s[0] + z.s[1]) / 2, (z.t[0] + z.t[1]) / 2];
  return [
    { asa: "s0", p: enPlanta(z, z.s[0], tm) },
    { asa: "s1", p: enPlanta(z, z.s[1], tm) },
    { asa: "t0", p: enPlanta(z, sm, z.t[0]) },
    { asa: "t1", p: enPlanta(z, sm, z.t[1]) },
    { asa: "centro", p: enPlanta(z, sm, tm) },
  ];
}

/** El asa de una zona a menos de `radio` de un punto (la más cercana); null si ninguna. */
export function asaEn(z: ZonaPlanta, p: Vec2, radio: number): AsaZona | null {
  let mejor: { asa: AsaZona; dist: number } | null = null;
  for (const a of asasZona(z)) {
    const dist = Math.hypot(a.p[0] - p[0], a.p[1] - p[1]);
    if (dist <= radio && (!mejor || dist < mejor.dist)) mejor = { asa: a.asa, dist };
  }
  return mejor?.asa ?? null;
}

/**
 * La zona al llevar un asa de `desde` a `hasta`. La de un lado lo lleva a la coordenada de `hasta` (al
 * módulo), sin pasar del lado de enfrente menos el lado mínimo; la del centro mueve la zona lo que va
 * de `desde` a `hasta` (al módulo en cada eje), sin cambiar su tamaño.
 *
 * Con `lindes` (lo que va por nervios), en transversal no va al módulo sino al linde más cercano: un
 * lado, al que deja al menos un nervio dentro; el centro, con su lado t0 en un linde y el mismo ancho.
 * Si ningún linde vale, como sin ellos.
 */
export function zonaMovida(z: ZonaPlanta, asa: AsaZona, desde: Vec2, hasta: Vec2, lindes: readonly number[] = []): Rango {
  const [s, t] = enEjes(z, hasta);
  const r: Rango = { s: [z.s[0], z.s[1]], t: [z.t[0], z.t[1]] };
  if (asa === "s0") r.s[0] = Math.min(alModulo(s), limpio(z.s[1] - LADO_MINIMO_ZONA));
  else if (asa === "s1") r.s[1] = Math.max(alModulo(s), limpio(z.s[0] + LADO_MINIMO_ZONA));
  else if (asa === "t0") r.t[0] = alLinde(lindes, t, (l) => l <= z.t[1] - LADO_MINIMO_ZONA + 1e-9) ?? Math.min(alModulo(t), limpio(z.t[1] - LADO_MINIMO_ZONA));
  else if (asa === "t1") r.t[1] = alLinde(lindes, t, (l) => l >= z.t[0] + LADO_MINIMO_ZONA - 1e-9) ?? Math.max(alModulo(t), limpio(z.t[0] + LADO_MINIMO_ZONA));
  else {
    const [s0, t0] = enEjes(z, desde);
    const ds = alModulo(s - s0);
    const linde = alLinde(lindes, z.t[0] + t - t0);
    const dt = linde === null ? alModulo(t - t0) : linde - z.t[0];
    r.s = [limpio(z.s[0] + ds), limpio(z.s[1] + ds)];
    r.t = [limpio(z.t[0] + dt), limpio(z.t[1] + dt)];
  }
  return r;
}

/** ¿Cambia algo la zona? (a 1e-9). */
export function mismaZona(a: Rango, b: Rango): boolean {
  return [a.s[0] - b.s[0], a.s[1] - b.s[1], a.t[0] - b.t[0], a.t[1] - b.t[1]].every((x) => Math.abs(x) < 1e-9);
}

/** El armado de la losa con la zona de un elemento cambiada (lo demás, igual). */
export function conZona<T extends Pick<ArmadoForjado, "refuerzos" | "cercos">>(armado: T, e: ElementoLosa, zona: Rango): T {
  const a = structuredClone(armado);
  const x = a[e.lista]?.[e.indice];
  if (x) {
    x.s = [zona.s[0], zona.s[1]];
    x.t = [zona.t[0], zona.t[1]];
  }
  return a;
}

/** El armado de la losa con un refuerzo o una zona de cercos más, al final de su lista, y su elemento. */
export function conElemento<T extends Pick<ArmadoForjado, "refuerzos" | "cercos">>(armado: T, nuevo: RefuerzoForjado | CercosForjado): { armado: T; elemento: ElementoLosa } {
  const a = structuredClone(armado);
  if ("armadura" in nuevo) {
    a.refuerzos = [...(a.refuerzos ?? []), nuevo];
    return { armado: a, elemento: { lista: "refuerzos", indice: a.refuerzos.length - 1 } };
  }
  a.cercos = [...(a.cercos ?? []), nuevo];
  return { armado: a, elemento: { lista: "cercos", indice: a.cercos.length - 1 } };
}

/**
 * La zona entre dos puntos de la planta (sus esquinas opuestas), en los ejes de una armadura o de una
 * dirección de nervios, con sus lados al módulo; null si alguno no llega al lado mínimo. Con `lindes`
 * (lo que va por nervios), los lados transversales van a los lindes que encierran los nervios entre los
 * dos puntos: al menos, el nervio en el que caen.
 */
export function zonaEntre(eje1: number | undefined, de: ArmaduraForjado | "x" | "y", p: Vec2, q: Vec2, lindes: readonly number[] = []): Rango | null {
  const ejes = ejesArmadura(eje1, de);
  const [[sa, ta], [sb, tb]] = [enEjes(ejes, p), enEjes(ejes, q)];
  const s: [number, number] = [alModulo(Math.min(sa, sb)), alModulo(Math.max(sa, sb))];
  let t: [number, number] = [alModulo(Math.min(ta, tb)), alModulo(Math.max(ta, tb))];
  if (lindes.length) {
    const [a, b] = [alLinde(lindes, Math.min(ta, tb))!, alLinde(lindes, Math.max(ta, tb))!];
    if (b > a + 1e-9) t = [a, b];
    else {
      // Los dos puntos van al mismo linde: el nervio del lado en el que cae su medio (o el que haya)
      const antes = alLinde(lindes, a, (l) => l < a - 1e-9);
      const despues = alLinde(lindes, a, (l) => l > a + 1e-9);
      if ((ta + tb) / 2 < a && antes !== null) t = [antes, a];
      else if (despues !== null) t = [a, despues];
      else if (antes !== null) t = [antes, a];
    }
  }
  return s[1] - s[0] >= LADO_MINIMO_ZONA - 1e-9 && t[1] - t[0] >= LADO_MINIMO_ZONA - 1e-9 ? { s, t } : null;
}
