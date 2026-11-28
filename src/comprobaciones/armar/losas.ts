/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §4.4): proponer el armado de una losa maciza o reticular.
 *
 * Como en los pilares y las vigas, proponer es elegir de unas tablas y el juez es la comprobación
 * (`comprobarLosa`: el módulo de forjados de Concreta); aquí no hay ninguna fórmula de armado.
 * Determinista.
 *
 *  1. **La base** de cada armadura (x-inf, x-sup, y-inf, y-sup, en ese orden: la Y va por dentro de
 *     la X), la primera de su tabla con la que no falla ninguna regla de armado suya (cuantía mínima
 *     donde la cara tracciona, separación máxima, que las barras quepan en el nervio). Si se da un
 *     momento que tiene que cubrir (la armadura base de AB, kN·m/m), además la primera cuyo momento
 *     resistente no es menor. En un reticular, lo mismo con la parrilla de los ábacos.
 *  2. **Los cercos de los nervios** de un reticular: las estaciones de nervio en las que el cortante
 *     no cumple sin armadura transversal se agrupan en zonas, y cada una recibe los primeros cercos de
 *     su tabla con los que cumple. Van antes que los refuerzos porque el cerco cambia el canto útil y
 *     el hueco de las barras del nervio. Tras los refuerzos se repite, porque un refuerzo en segunda
 *     capa baja el canto útil del nervio y, con él, su cortante sin cercos.
 *  3. **Los refuerzos:** las estaciones en las que la flexión o la fisuración de una armadura no
 *     cumplen con la base se agrupan en zonas, como las de AB (`zonasRefuerzo`: conexas a lo largo de
 *     una franja y entre franjas vecinas). De las zonas sale el despiece (abajo), y cada refuerzo es
 *     el primero de la tabla con el que no falla ninguna fila de esa armadura en las estaciones que
 *     cubre.
 *
 * **El despiece** (CO6-g, `comprobaciones.md` §8.12): reglas de obra, que sólo añaden acero; el juez
 * sigue siendo la comprobación del armado entero.
 *  - **En los ábacos, uno por ábaco:** si alguna estación de un ábaco pide refuerzo en una armadura,
 *    el refuerzo es una parrilla en el ábaco entero (como se arma en obra), no en el trozo que falla.
 *  - **En los nervios y en una maciza,** el rectángulo que envuelve cada zona se alarga por cada punta
 *    el decalaje (el canto de la losa) más la longitud de anclaje de su barra (`computeAnchorage` del
 *    módulo de forjados, con su posición de adherencia), sin salir de la losa, y hasta `LARGO_MINIMO`.
 *    El anclaje depende del diámetro, que sale de dimensionar: se repite con el diámetro elegido.
 *  - **Se unen** dos rectángulos de la misma armadura que se tocan o se pisan si el que los envuelve a
 *    los dos no pasa de `HOLGURA_UNION` veces lo que cubren (trozos seguidos de un mismo nervio, nervios
 *    vecinos con casi la misma longitud); también si sus zonas se pisan de origen. Los que aun así se
 *    pisan (dos vanos seguidos) se cortan a mitad del hueco entre sus zonas: ningún refuerzo pisa a
 *    otro de su armadura y de su clase, y el solape entre los dos no se dibuja.
 *  - **Las puntas, a `MODULO_LARGO`** (5 cm), hacia fuera, salvo las que llegan al borde de la losa o
 *    a un corte.
 *  - **Los cercos,** igual, sin anclaje, con `LARGO_MINIMO_CERCOS` y uniéndose hasta `HOLGURA_UNION_CERCOS`.
 *
 * Las tablas:
 *  - parrillas (maciza y ábacos): Ø8 a Ø25 a 300, 250, 200, 150, 125 o 100 mm, de menos a más acero;
 *  - nervios: de 1 a 4 barras de Ø8 a Ø25, de menos a más acero (las que no caben las rechaza el
 *    módulo);
 *  - cercos de los nervios: de dos ramas, Ø6, Ø8 o Ø10 a 200, 150, 100 o 75 mm, de menos a más acero.
 *
 * **Con la armadura mínima reducida de las losas de cimentación (CO3-k):** la base es la primera que
 * cumple el suelo geométrico (y no la mínima del módulo), y donde no llega a 1,2 veces lo que pide el
 * ELU van refuerzos, como donde no llega la flexión.
 *
 * **El cortante de los ábacos y de una maciza (CO3-l, decidido por el usuario el 2026-11-28):** primero
 * con acero longitudinal y, si no basta con un armado razonable, con cercos.
 *  - Sin cercos, VRd,c depende del acero de la cara traccionada (`../comprobar/losas.ts`), así que sus
 *    estaciones entran en las zonas de refuerzo de esa cara, como las de la flexión. El refuerzo sólo
 *    se sube por el cortante hasta `DIAMETRO_MAXIMO_CORTANTE` (Ø16; a cualquier separación de la tabla,
 *    hasta 100 mm: unos 2 000 mm²/m); más allá, si la flexión no pide más, se queda el que pide la
 *    flexión, o ninguno.
 *  - Lo que aun así no cumple recibe una zona de cercos con sus ramas por metro (`tablaCercosLosa`),
 *    de la que menos acero tiene. Una losa de menos de 200 mm no admite armadura de cortante
 *    (§9.3.2(1)): queda sin propuesta, y hay que subir el canto.
 * Junto a los pilares, el cortante es del punzonamiento (CO4).
 */
import type { Vec2 } from "../../compilador/fisico.ts";
import { zonasRefuerzo, type FranjaTramos } from "../../agente/refuerzos.ts";
import { ARMADURAS_FORJADO, areaBarra, areaBarrasForjado, DATOS_ARMADO, type ArmadoForjado, type ArmaduraForjado, type BarrasForjado, type CercosForjado, type CercosViga, type DatosArmado, type RefuerzoForjado } from "../armado.ts";
import { getFyd } from "../concreta/data/materials.ts";
import { computeAnchorage, fctmAdherencia } from "../concreta/lib/calculations/rcSlabs.ts";
import { armadoLosa, comprobarLosa, cubre, cubreCercos, estacionesQueFallan, estacionesSinCortante, type ComprobacionLosa } from "../comprobar/losas.ts";
import { direccionArmadura, type DemandasLosa, type EstacionLosa, type SeccionLosa } from "../demandas/losas.ts";

export const DIAMETROS_LOSA = [8, 10, 12, 16, 20, 25] as const;
/** CO3-l: el mayor diámetro de un refuerzo de un ábaco o una maciza que se sube sólo por el cortante; más allá, cercos. */
export const DIAMETRO_MAXIMO_CORTANTE = 16;
/** CO3-l: los cercos de un ábaco o una maciza: diámetros, separaciones (mm) y ramas por metro de ancho. */
export const DIAMETROS_CERCOS_LOSA = [6, 8, 10] as const;
export const SEPARACIONES_CERCOS_LOSA = [200, 150, 100, 75] as const;
export const RAMAS_CERCOS_LOSA = [3, 4, 5, 6, 8, 10] as const;
export const SEPARACIONES_LOSA = [300, 250, 200, 150, 125, 100] as const;
export const BARRAS_NERVIO = [1, 2, 3, 4] as const;

const ordenada = (t: BarrasForjado[]): BarrasForjado[] =>
  t
    .map((b, i) => ({ b, i, a: areaBarrasForjado(b) }))
    .sort((p, q) => p.a - q.a || p.b.diametro - q.b.diametro || p.i - q.i)
    .map((x) => x.b);

/** Las parrillas (Ø y separación), de menos a más acero por metro (a igual acero, la del diámetro menor). */
export function tablaParrillas(): BarrasForjado[] {
  return ordenada(DIAMETROS_LOSA.flatMap((diametro) => SEPARACIONES_LOSA.map((separacion) => ({ diametro, separacion }))));
}

/** Las barras de un nervio, de menos a más acero (a igual acero, las del diámetro menor). */
export function tablaNervios(): BarrasForjado[] {
  return ordenada(DIAMETROS_LOSA.flatMap((diametro) => BARRAS_NERVIO.map((n) => ({ diametro, n }))));
}

export const DIAMETROS_CERCO_NERVIO = [6, 8, 10] as const;
export const SEPARACIONES_CERCO_NERVIO = [200, 150, 100, 75] as const;

/** CO3-l: los cercos de un ábaco o una maciza, con sus ramas por metro, de menos a más acero por m² (a igual acero, los más separados y con menos ramas). */
export function tablaCercosLosa(): CercosViga[] {
  const t: CercosViga[] = [];
  for (const diametro of DIAMETROS_CERCOS_LOSA) for (const separacion of SEPARACIONES_CERCOS_LOSA) for (const ramas of RAMAS_CERCOS_LOSA) t.push({ diametro, separacion, ramas });
  const acero = (c: CercosViga) => (c.ramas! * areaBarra(c.diametro)) / c.separacion;
  return t.sort((p, q) => acero(p) - acero(q) || q.separacion - p.separacion || p.ramas! - q.ramas! || p.diametro - q.diametro);
}

/** Los cercos de un nervio (dos ramas), de menos a más acero por metro (a igual acero, los más separados). */
export function tablaCercosNervio(): CercosViga[] {
  return DIAMETROS_CERCO_NERVIO.flatMap((diametro) => SEPARACIONES_CERCO_NERVIO.map((separacion) => ({ diametro, separacion })))
    .map((c, i) => ({ c, i, a: areaBarra(c.diametro) / c.separacion }))
    .sort((p, q) => p.a - q.a || q.c.separacion - p.c.separacion || p.i - q.i)
    .map((x) => x.c);
}

export interface PropuestaLosa {
  /** null si no hay base de las tablas que cumpla sus reglas. */
  armado: ArmadoForjado | null;
  /** La comprobación del propuesto. */
  comprobacion: ComprobacionLosa | null;
  /** Armados probados. */
  probados: number;
  /** Zonas que se quedan sin refuerzo (o sin cercos: sin `armadura`): ninguno de la tabla cumple. */
  sinRefuerzo: { armadura?: ArmaduraForjado; zona: string; en?: "abacos" | "nervios"; motivo: string }[];
  /** Por qué no hay propuesta. */
  motivo?: string;
}

export interface OpcionesProponerLosa {
  /** El momento que tiene que cubrir la base de cada armadura, kN·m/m (la armadura base de AB). */
  momentoBase?: Partial<Record<ArmaduraForjado, number>>;
}

/** Las filas que dependen de la demanda: las arregla un refuerzo, no la base (la mínima reducida de CO3-k, también). */
const DEMANDA = /\/(bending|cracking|as-min-elu|shear)$/;
/** CO3-l: la fila del cortante sin cercos de un ábaco o una maciza (con su armadura: la de su cara traccionada). */
const esCortante = (f: { id: string }) => f.id.endsWith("/shear");
const EPS = 1e-9;

/** El despiece (cabecera): las puntas de un refuerzo o de una zona de cercos van a este módulo, m. */
export const MODULO_LARGO = 0.05;
/** Largo mínimo de un refuerzo, m. */
export const LARGO_MINIMO = 1;
/** Largo mínimo de una zona de cercos, m. */
export const LARGO_MINIMO_CERCOS = 0.5;
/** Dos rectángulos se unen si el que los envuelve no pasa de esto por lo que cubren entre los dos. */
export const HOLGURA_UNION = 1.2;
/** Lo mismo para las zonas de cercos, que cuestan poco acero: hasta el doble. */
export const HOLGURA_UNION_CERCOS = 2;

/** Un rectángulo en los ejes de una armadura: a lo largo (s) y en transversal (t), m. */
export interface Rectangulo {
  s: [number, number];
  t: [number, number];
}

/** Una zona que pide refuerzo o cercos: el rectángulo de sus estaciones y hasta dónde llega la losa a lo largo. */
export interface PiezaDespiece<E = unknown> {
  nucleo: Rectangulo;
  limite: [number, number];
  estaciones: E[];
}

const solape = (x: readonly [number, number], y: readonly [number, number]) => Math.min(x[1], y[1]) - Math.max(x[0], y[0]);
const areaDe = (r: Rectangulo) => (r.s[1] - r.s[0]) * (r.t[1] - r.t[0]);
const envuelve = (x: Rectangulo, y: Rectangulo): Rectangulo => ({ s: [Math.min(x.s[0], y.s[0]), Math.max(x.s[1], y.s[1])], t: [Math.min(x.t[0], y.t[0]), Math.max(x.t[1], y.t[1])] });
const limpio = (v: number) => Math.round(v * 1e6) / 1e6;
/** Al módulo, hacia abajo o hacia arriba (lo que ya está en él, a 1e-6 del módulo, se queda). */
const alModulo = (v: number, arriba: boolean) => limpio((arriba ? Math.ceil(v / MODULO_LARGO - 1e-6) : Math.floor(v / MODULO_LARGO + 1e-6)) * MODULO_LARGO);

/**
 * El despiece de unas zonas de una armadura (cabecera): alargadas, unidas, cortadas donde se pisan y
 * con las puntas al módulo. `alarga` da lo que se alarga cada punta de una pieza (m), `minimo`, su
 * largo mínimo, y `holgura`, hasta cuánto se unen. Determinista: las piezas, en su orden.
 */
export function despiece<E>(piezas: readonly PiezaDespiece<E>[], alarga: (p: PiezaDespiece<E>) => number, minimo: number, holgura = HOLGURA_UNION): { caja: Rectangulo; pieza: PiezaDespiece<E> }[] {
  const extendida = (p: PiezaDespiece<E>): Rectangulo => {
    const la = alarga(p);
    const [l0, l1] = p.limite;
    let [a, b] = [p.nucleo.s[0] - la, p.nucleo.s[1] + la];
    if (b - a < minimo) [a, b] = [(a + b - minimo) / 2, (a + b + minimo) / 2];
    // Dentro de la losa; lo que se recorta por un lado se da por el otro hasta el mínimo
    if (a < l0) [a, b] = [l0, Math.max(b, Math.min(l0 + minimo, b + (l0 - a)))];
    if (b > l1) [a, b] = [Math.min(a, Math.max(l1 - minimo, a - (b - l1))), l1];
    // Las puntas, al módulo hacia fuera (antes de unir y de cortar: el redondeo no hace que dos se pisen después)
    return { s: [Math.max(l0, alModulo(Math.max(a, l0), false)), Math.min(l1, alModulo(b, true))], t: [limpio(p.nucleo.t[0]), limpio(p.nucleo.t[1])] };
  };
  let ps = piezas.slice();
  for (;;) {
    const cs = ps.map(extendida);
    let par: [number, number] | null = null;
    busca: for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const [os, ot] = [solape(cs[i]!.s, cs[j]!.s), solape(cs[i]!.t, cs[j]!.t)];
        // A lo largo se pisan; en transversal, se pisan o se tocan
        if (os <= EPS || ot < -EPS) continue;
        const cubren = areaDe(cs[i]!) + areaDe(cs[j]!) - (ot > EPS ? os * ot : 0);
        const deOrigen = ot > EPS && solape(ps[i]!.nucleo.s, ps[j]!.nucleo.s) > EPS;
        if (deOrigen || areaDe(envuelve(cs[i]!, cs[j]!)) <= holgura * cubren) {
          par = [i, j];
          break busca;
        }
      }
    if (!par) break;
    const [pi, pj] = par;
    const [x, y] = [ps[pi]!, ps[pj]!];
    const unida: PiezaDespiece<E> = { nucleo: envuelve(x.nucleo, y.nucleo), limite: [Math.min(x.limite[0], y.limite[0]), Math.max(x.limite[1], y.limite[1])], estaciones: [...x.estaciones, ...y.estaciones] };
    ps = ps.flatMap((q, i) => (i === pi ? [unida] : i === pj ? [] : [q]));
  }
  const cs = ps.map(extendida);
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      if (solape(cs[i]!.s, cs[j]!.s) <= EPS || solape(cs[i]!.t, cs[j]!.t) <= EPS) continue;
      // Sus zonas no se pisan a lo largo (se habrían unido): el corte, a mitad del hueco entre ellas
      const [lo, hi] = ps[i]!.nucleo.s[0] <= ps[j]!.nucleo.s[0] ? [i, j] : [j, i];
      const [g0, g1] = [ps[lo]!.nucleo.s[1], ps[hi]!.nucleo.s[0]];
      let corte = alModulo((g0 + g1) / 2, false);
      if (corte < g0 - EPS || corte > g1 + EPS) corte = (g0 + g1) / 2;
      corte = limpio(corte);
      if (corte < cs[lo]!.s[1]) cs[lo]!.s[1] = corte;
      if (corte > cs[hi]!.s[0]) cs[hi]!.s[0] = corte;
    }
  return ps.map((pieza, i) => ({ caja: cs[i]!, pieza }));
}

export function proponerLosa(d: DemandasLosa, datos?: DatosArmado, op: OpcionesProponerLosa = {}): PropuestaLosa {
  if (d.material.tipo !== "hormigon") return { armado: null, comprobacion: null, probados: 0, sinRefuerzo: [], motivo: `el material ${d.material.id} no es hormigón` };
  const parrillas = tablaParrillas();
  const nervios = tablaNervios();
  const reticular = d.reticular !== null;
  const tablaBase = reticular ? nervios : parrillas;
  const cuatro = (b: BarrasForjado): Record<ArmaduraForjado, BarrasForjado> => ({ "x-inf": b, "x-sup": b, "y-inf": b, "y-sup": b });
  const conAbacos = reticular && d.direcciones.some((x) => x.estaciones.some((e) => e.seccion === "abaco"));
  const a: ArmadoForjado = { base: cuatro(tablaBase[0]!), ...(conAbacos ? { abacos: cuatro(parrillas[0]!) } : {}) };
  let probados = 0;
  const probar = (solo?: { direccion: 1 | 2; estaciones: readonly EstacionLosa[] }) => {
    probados++;
    return comprobarLosa(d, armadoLosa(a, datos), solo ? { solo } : {});
  };

  // ─── 1. La base ───────────────────────────────────────────────────────────────────────────────
  for (const [donde, tabla] of [["base", tablaBase], ...(conAbacos ? [["abacos", parrillas] as const] : [])] as const) {
    for (const arm of ARMADURAS_FORJADO) {
      const k = direccionArmadura(arm);
      const estaciones = d.direcciones[k - 1]!.estaciones;
      const M = op.momentoBase?.[arm];
      let vale = false;
      let ultimo: ComprobacionLosa | null = null;
      for (const b of tabla) {
        a[donde]![arm] = b;
        const c = (ultimo = probar({ direccion: k, estaciones }));
        const suyas = c.filas.filter((f) => f.armadura === arm && (donde === "abacos") === (f.seccion === "abaco"));
        if (c.pendientes.length || suyas.some((f) => f.estado === "fail" && !DEMANDA.test(f.id) && f.grupo !== "seccion")) continue;
        if (M !== undefined && donde === "base" && suyas.some((f) => f.resistente !== undefined && f.resistente < M)) continue;
        vale = true;
        break;
      }
      if (!vale) {
        const p = ultimo?.pendientes[0]?.motivo;
        const f = ultimo?.filas.find((x) => x.armadura === arm && x.estado === "fail" && !DEMANDA.test(x.id));
        return { armado: null, comprobacion: ultimo, probados, sinRefuerzo: [], motivo: p ?? `ninguna ${donde === "abacos" ? "parrilla de ábacos" : "armadura base"} ${arm} de la tabla cumple${f ? ` «${f.descripcion}»` : M !== undefined ? ` el momento de ${M} kN·m/m` : ""}` };
      }
    }
  }

  const sinRefuerzo: PropuestaLosa["sinRefuerzo"] = [];
  /** Las zonas de AB (`zonasRefuerzo`) de unas estaciones de una dirección, con «falla» en lugar de la demanda sobre la base. */
  const zonasDe = (k: 1 | 2, arm: ArmaduraForjado, fallan: ReadonlySet<EstacionLosa>): { id: string; estaciones: EstacionLosa[] }[] => {
    const dir = d.direcciones[k - 1]!;
    const de = new Map<string, EstacionLosa>();
    const porFranja = new Map<string, EstacionLosa[]>();
    for (const e of dir.estaciones) {
      de.set(`${e.franja}#${e.indice}`, e);
      (porFranja.get(e.franja) ?? porFranja.set(e.franja, []).get(e.franja)!).push(e);
    }
    const P = (s: number, t: number): Vec2 => [s * dir.d[0] + t * dir.n[0], s * dir.d[1] + t * dir.n[1]];
    const fs: FranjaTramos[] = dir.franjas.map((f) => ({
      franja: f,
      tramos: (porFranja.get(f.id) ?? []).filter((e) => e.b > e.a).map((e) => ({ franja: f.id, losa: d.losa, estacion: e.indice, s: e.s, a: e.a, b: e.b, t0: e.t0, t1: e.t1, v: fallan.has(e) ? 1 : 0, comb: "", rectangulo: [P(e.a, e.t0), P(e.b, e.t0), P(e.b, e.t1), P(e.a, e.t1)] })),
    }));
    const enZona = new Set<EstacionLosa>();
    const zonas = zonasRefuerzo(d.losa, arm, 0.5, fs).map((z) => ({ id: z.id, estaciones: z.tramos.map((t) => de.get(`${t.franja}#${t.estacion}`)!) }));
    for (const z of zonas) for (const e of z.estaciones) enZona.add(e);
    // Una estación que falla sin tramo que colorear (b ≤ a): su zona, ella sola
    for (const e of dir.estaciones) if (fallan.has(e) && !enZona.has(e)) zonas.push({ id: `${d.losa}:${arm}:${e.franja}@${e.s.toFixed(3)}`, estaciones: [e] });
    return zonas;
  };
  /** El rectángulo que envuelve los tramos de unas estaciones. */
  const caja = (es: readonly EstacionLosa[]): Rectangulo => {
    const s: [number, number] = [Math.min(...es.map((e) => Math.min(e.a, e.s))), Math.max(...es.map((e) => Math.max(e.b, e.s)))];
    return { s: s[1] > s[0] + EPS ? s : [s[0] - 0.05, s[1] + 0.05], t: [Math.min(...es.map((e) => e.t0)), Math.max(...es.map((e) => e.t1))] };
  };
  /** La pieza del despiece de unas estaciones de una dirección: su caja y hasta dónde llegan sus franjas. */
  const piezaDe = (k: 1 | 2, es: EstacionLosa[]): PiezaDespiece<EstacionLosa> => {
    const suyas = new Set(es.map((e) => e.franja));
    const fs = d.direcciones[k - 1]!.franjas.filter((f) => suyas.has(f.id));
    const nucleo = caja(es);
    return { nucleo, limite: [Math.min(nucleo.s[0], ...fs.map((f) => f.s0)), Math.max(nucleo.s[1], ...fs.map((f) => f.s1))], estaciones: es };
  };

  // ─── 2. Los cercos de los nervios, zona a zona ────────────────────────────────────────────────
  const tabla = tablaCercosNervio();
  const cercos: CercosForjado[] = [];
  a.cercos = cercos;
  /**
   * Cercos en las zonas de nervios sin cortante. `conFlexion`: tras los refuerzos, los cercos tampoco
   * pueden hacer fallar la flexión (cambian el canto útil y el hueco de las barras).
   */
  /** Las estaciones que han pedido cercos en cada dirección, en todas las pasadas. */
  const pidenCercos: [Set<EstacionLosa>, Set<EstacionLosa>] = [new Set(), new Set()];
  const pasoCercos = (conFlexion: boolean) => {
    for (const k of [1, 2] as const) {
      const eje = k === 1 ? ("x" as const) : ("y" as const);
      const fallan = estacionesSinCortante(d, armadoLosa(a, datos), k);
      if (!fallan.length) continue;
      // Las zonas de la dirección se rehacen con todo lo que ha pedido cercos, para unirlas con las de antes
      for (const e of fallan) pidenCercos[k - 1].add(e);
      for (let i = cercos.length - 1; i >= 0; i--) if (cercos[i]!.direccion === eje && cercos[i]!.en === undefined) cercos.splice(i, 1);
      const piezas = zonasDe(k, `${eje}-inf`, pidenCercos[k - 1]).map((z) => piezaDe(k, z.estaciones));
      for (const { caja: rect } of despiece(piezas, () => 0, LARGO_MINIMO_CERCOS, HOLGURA_UNION_CERCOS)) {
        const c: CercosForjado = { direccion: eje, ...rect, cercos: tabla[0]! };
        const cubiertas = d.direcciones[k - 1]!.estaciones.filter((e) => cubreCercos(c, e));
        cercos.push(c);
        let vale = false;
        let motivo = "";
        for (const x of tabla) {
          c.cercos = x;
          const r = probar({ direccion: k, estaciones: cubiertas });
          // Con los cercos no puede fallar el cortante ni ninguna regla de la base (que sus barras sigan cabiendo)
          const f = r.filas.find((y) => y.estado === "fail" && (conFlexion || y.armadura === undefined || !DEMANDA.test(y.id)) && y.grupo !== "cortante");
          const pe = r.pendientes[0];
          if (!f && !pe) {
            vale = true;
            break;
          }
          motivo = pe?.motivo ?? `«${f!.descripcion}»`;
        }
        if (!vale) {
          cercos.pop();
          sinRefuerzo.push({ zona: `${d.losa}:${eje}:C${conFlexion ? "b" : ""}@${rect.s[0].toFixed(2)},${rect.t[0].toFixed(2)}`, motivo: `ningunos cercos de la tabla cumplen ${motivo}: la sección no basta` });
        }
      }
    }
  };
  if (reticular) pasoCercos(false);

  // ─── 3. Los refuerzos ─────────────────────────────────────────────────────────────────────────
  const refuerzos: RefuerzoForjado[] = (a.refuerzos = []);
  const fyd = getFyd(datos?.fyk ?? DATOS_ARMADO.fyk);
  const fctm = fctmAdherencia(d.material.fck);
  /** Lo que se alarga cada punta de un refuerzo: el decalaje (el canto) más el anclaje de su barra, m. */
  const alarga = (diametro: number, arm: ArmaduraForjado) => d.espesor + computeAnchorage(diametro, fctm, fyd, arm.endsWith("inf") ? "inf" : "sup", 1000 * d.espesor).lb_rqd / 1000;
  /**
   * El primer refuerzo de la tabla que cumple en su rectángulo; si ninguno, queda dicho. El cortante sin
   * cercos (CO3-l) sólo sube el refuerzo hasta `DIAMETRO_MAXIMO_CORTANTE`: si con eso no cumple, se
   * queda el primero con el que cumple la flexión (o ninguno, si la flexión no lo pide), y el cortante
   * va a los cercos.
   */
  const dimensionar = (arm: ArmaduraForjado, rect: Rectangulo, en: "abacos" | "nervios" | undefined, zona: string): RefuerzoForjado | null => {
    const k = direccionArmadura(arm);
    const r: RefuerzoForjado = { armadura: arm, s: rect.s, t: rect.t, barras: parrillas[0]!, ...(en ? { en } : {}) };
    const cubiertas = d.direcciones[k - 1]!.estaciones.filter((e) => cubre(r, e));
    refuerzos.push(r);
    let motivo = "";
    let flexion: BarrasForjado | null = null;
    for (const b of en === "nervios" ? nervios : parrillas) {
      r.barras = b;
      const c = probar({ direccion: k, estaciones: cubiertas });
      const p = c.pendientes[0];
      if (p) {
        motivo = p.motivo;
        continue;
      }
      const fs = c.filas.filter((x) => x.armadura === arm && x.estado === "fail" && x.grupo !== "seccion");
      const f = fs.find((x) => !esCortante(x));
      if (!f && !flexion) flexion = b;
      if (!fs.length && (b === flexion || b.diametro <= DIAMETRO_MAXIMO_CORTANTE)) return r;
      // Cumple, pero sólo por el cortante y con más de Ø16: eso es de los cercos
      if (fs.length) motivo = `«${(f ?? fs[0])!.descripcion}»`;
    }
    if (flexion) {
      // El cortante no se arregla con un refuerzo razonable: ¿lo pide la flexión?
      refuerzos.pop();
      const sin = probar({ direccion: k, estaciones: cubiertas });
      if (!sin.pendientes.length && !sin.filas.some((x) => x.armadura === arm && x.estado === "fail" && x.grupo !== "seccion" && !esCortante(x))) return null;
      refuerzos.push(r);
      r.barras = flexion;
      return r;
    }
    refuerzos.pop();
    sinRefuerzo.push({ armadura: arm, zona, ...(en ? { en } : {}), motivo: `ningún refuerzo de la tabla cumple ${motivo}: la sección no basta` });
    return null;
  };
  for (const arm of ARMADURAS_FORJADO) {
    const k = direccionArmadura(arm);
    const dir = d.direcciones[k - 1]!;
    const fallan = new Set(estacionesQueFallan(d, armadoLosa(a, datos), arm));
    if (!fallan.size) continue;
    const zonas = zonasDe(k, arm, fallan);
    // En los ábacos, uno por ábaco: la parrilla del ábaco entero
    if (reticular) {
      const cajas = d.abacos.map((p): Rectangulo => {
        const [ss, ts] = [p.map((v) => v[0] * dir.d[0] + v[1] * dir.d[1]), p.map((v) => v[0] * dir.n[0] + v[1] * dir.n[1])];
        return { s: [Math.min(...ss), Math.max(...ss)], t: [Math.min(...ts), Math.max(...ts)] };
      });
      const fuera = (c: Rectangulo, e: EstacionLosa) => Math.hypot(Math.max(0, c.s[0] - e.s, e.s - c.s[1]), Math.max(0, c.t[0] - (e.t0 + e.t1) / 2, (e.t0 + e.t1) / 2 - c.t[1]));
      const porAbaco = new Map<number, EstacionLosa[]>();
      for (const e of dir.estaciones) {
        if (!fallan.has(e) || e.seccion !== "abaco") continue;
        let cual = -1;
        cajas.forEach((c, i) => {
          if (cual < 0 || fuera(c, e) < fuera(cajas[cual]!, e) - EPS) cual = i;
        });
        (porAbaco.get(cual) ?? porAbaco.set(cual, []).get(cual)!).push(e);
      }
      for (const [i, es] of [...porAbaco].sort((x, y) => x[0] - y[0])) {
        // El ábaco y, por si alguna cae fuera de él, sus estaciones
        const puntos: Rectangulo = { s: [Math.min(...es.map((e) => e.s)), Math.max(...es.map((e) => e.s))], t: [Math.min(...es.map((e) => (e.t0 + e.t1) / 2)), Math.max(...es.map((e) => (e.t0 + e.t1) / 2))] };
        let rect = i >= 0 ? envuelve(cajas[i]!, puntos) : caja(es);
        if (i >= 0) {
          // Un ábaco de borde sale de la losa: hasta donde llegan las franjas que lo cruzan
          const cruzan = dir.franjas.filter((f) => f.t1 > rect.t[0] + EPS && f.t0 < rect.t[1] - EPS && f.s1 > rect.s[0] + EPS && f.s0 < rect.s[1] - EPS);
          if (cruzan.length)
            rect = {
              s: [Math.max(rect.s[0], Math.min(...cruzan.map((f) => f.s0))), Math.min(rect.s[1], Math.max(...cruzan.map((f) => f.s1)))],
              t: [Math.max(rect.t[0], Math.min(...cruzan.map((f) => f.t0))), Math.min(rect.t[1], Math.max(...cruzan.map((f) => f.t1)))],
            };
          rect = envuelve(rect, puntos);
        }
        dimensionar(arm, { s: [limpio(rect.s[0]), limpio(rect.s[1])], t: [limpio(rect.t[0]), limpio(rect.t[1])] }, "abacos", `${d.losa}:${arm}:ábaco ${i + 1}`);
      }
    }
    // En los nervios y en una maciza: las zonas, con su despiece
    const clase: SeccionLosa = reticular ? "nervio" : "maciza";
    const en = reticular ? ("nervios" as const) : undefined;
    const piezas = zonas.flatMap((z) => {
      const suyas = z.estaciones.filter((e) => e.seccion === clase);
      return suyas.length ? [piezaDe(k, suyas)] : [];
    });
    if (!piezas.length) continue;
    // El anclaje depende del diámetro, que sale de dimensionar: se repite mientras alguno crezca
    const supuesto = new Map<EstacionLosa, number>();
    const [desde, sinDesde] = [refuerzos.length, sinRefuerzo.length];
    for (let ronda = 0; ronda < 4; ronda++) {
      refuerzos.length = desde;
      sinRefuerzo.length = sinDesde;
      let crece = false;
      for (const { caja: rect, pieza } of despiece(piezas, (p) => alarga(Math.max(DIAMETROS_LOSA[0], ...p.estaciones.map((e) => supuesto.get(e) ?? 0)), arm), LARGO_MINIMO)) {
        const r = dimensionar(arm, rect, en, `${d.losa}:${arm}@${rect.s[0].toFixed(2)},${rect.t[0].toFixed(2)}`);
        if (!r) continue;
        for (const e of pieza.estaciones)
          if ((supuesto.get(e) ?? DIAMETROS_LOSA[0]) < r.barras.diametro) {
            supuesto.set(e, r.barras.diametro);
            crece = true;
          }
      }
      if (!crece) break;
    }
  }
  // Un refuerzo en segunda capa baja el canto útil del nervio, y con él su cortante sin cercos: otra pasada
  if (reticular && refuerzos.length) pasoCercos(true);

  // ─── 4. Los cercos de los ábacos y de una maciza (CO3-l): el cortante que el longitudinal no arregla ──
  const tablaLosa = tablaCercosLosa();
  const clave = (f: { id: string; franja?: string; s?: number }) => `${f.id}|${f.franja ?? ""}|${f.s ?? ""}`;
  for (const k of [1, 2] as const) {
    const eje = k === 1 ? ("x" as const) : ("y" as const);
    const fallan = estacionesSinCortante(d, armadoLosa(a, datos), k, reticular ? ["abaco"] : ["maciza"]);
    if (!fallan.length) continue;
    if (d.espesor < 0.2 - EPS) {
      sinRefuerzo.push({ zona: `${d.losa}:${eje}:cortante`, ...(reticular ? { en: "abacos" as const } : {}), motivo: `el cortante no cumple sin cercos ni con un refuerzo de hasta Ø${DIAMETRO_MAXIMO_CORTANTE}, y una losa de ${Math.round(1000 * d.espesor)} mm no admite armadura de cortante (h < 200 mm, CE Anejo 19 §9.3.2(1)): hay que subir el canto` });
      continue;
    }
    const piezas = zonasDe(k, `${eje}-inf`, new Set(fallan)).flatMap((z) => {
      const es = z.estaciones.filter((e) => e.seccion !== "nervio");
      return es.length ? [piezaDe(k, es)] : [];
    });
    for (const { caja: rect } of despiece(piezas, () => 0, LARGO_MINIMO_CERCOS, HOLGURA_UNION_CERCOS)) {
      const c: CercosForjado = { direccion: eje, s: rect.s, t: rect.t, cercos: tablaLosa[0]!, ...(reticular ? { en: "abacos" as const } : {}) };
      const cubiertas = d.direcciones[k - 1]!.estaciones.filter((e) => cubreCercos(c, e));
      // Lo que ya fallaba sin ellos (y no es el cortante) no lo tienen que arreglar los cercos
      const antes = new Set(probar({ direccion: k, estaciones: cubiertas }).filas.filter((f) => f.estado === "fail" && !esCortante(f)).map(clave));
      cercos.push(c);
      let vale = false;
      let motivo = "";
      for (const x of tablaLosa) {
        c.cercos = x;
        const r = probar({ direccion: k, estaciones: cubiertas });
        const f = r.filas.find((y) => y.estado === "fail" && !antes.has(clave(y)));
        const pe = r.pendientes[0];
        if (!f && !pe) {
          vale = true;
          break;
        }
        motivo = pe?.motivo ?? `«${f!.descripcion}»`;
      }
      if (!vale) {
        cercos.pop();
        sinRefuerzo.push({ zona: `${d.losa}:${eje}:C${reticular ? "a" : "m"}@${rect.s[0].toFixed(2)},${rect.t[0].toFixed(2)}`, ...(reticular ? { en: "abacos" as const } : {}), motivo: `ningunos cercos de la tabla cumplen ${motivo}: la sección no basta` });
      }
    }
  }
  if (!cercos.length) delete a.cercos;
  if (!refuerzos.length) delete a.refuerzos;
  return { armado: a, comprobacion: probar(), probados, sinRefuerzo };
}
