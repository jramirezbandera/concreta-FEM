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
 *     una franja y entre franjas vecinas). Cada zona recibe un refuerzo en el rectángulo que la
 *     envuelve (en un reticular, uno para sus ábacos y otro para sus nervios): el primero de la tabla
 *     con el que no falla ninguna fila de esa armadura en las estaciones que cubre. Las zonas van en
 *     orden, y cada una cuenta con los refuerzos ya puestos que la pisan.
 *
 * Las tablas:
 *  - parrillas (maciza y ábacos): Ø8 a Ø25 a 300, 250, 200, 150, 125 o 100 mm, de menos a más acero;
 *  - nervios: de 1 a 4 barras de Ø8 a Ø25, de menos a más acero (las que no caben las rechaza el
 *    módulo);
 *  - cercos de los nervios: de dos ramas, Ø6, Ø8 o Ø10 a 200, 150, 100 o 75 mm, de menos a más acero.
 *
 * En una maciza y en los ábacos no propone armadura transversal: una fila de cortante que falla ahí
 * deja la losa sin cumplir (junto a los pilares es del punzonamiento, CO4).
 */
import type { Vec2 } from "../../compilador/fisico.ts";
import { zonasRefuerzo, type FranjaTramos } from "../../agente/refuerzos.ts";
import { ARMADURAS_FORJADO, areaBarra, areaBarrasForjado, type ArmadoForjado, type ArmaduraForjado, type BarrasForjado, type CercosForjado, type CercosViga, type DatosArmado, type RefuerzoForjado } from "../armado.ts";
import { armadoLosa, comprobarLosa, cubre, cubreCercos, estacionesQueFallan, estacionesSinCortante, type ComprobacionLosa } from "../comprobar/losas.ts";
import { direccionArmadura, type DemandasLosa, type EstacionLosa, type SeccionLosa } from "../demandas/losas.ts";

export const DIAMETROS_LOSA = [8, 10, 12, 16, 20, 25] as const;
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

const DEMANDA = /\/(bending|cracking)$/;
const EPS = 1e-9;

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
  const caja = (es: readonly EstacionLosa[]): { s: [number, number]; t: [number, number] } => {
    const s: [number, number] = [Math.min(...es.map((e) => Math.min(e.a, e.s))), Math.max(...es.map((e) => Math.max(e.b, e.s)))];
    return { s: s[1] > s[0] + EPS ? s : [s[0] - 0.05, s[1] + 0.05], t: [Math.min(...es.map((e) => e.t0)), Math.max(...es.map((e) => e.t1))] };
  };

  // ─── 2. Los cercos de los nervios, zona a zona ────────────────────────────────────────────────
  const tabla = tablaCercosNervio();
  const cercos: CercosForjado[] = [];
  if (reticular) a.cercos = cercos;
  /**
   * Cercos en las zonas de nervios sin cortante. `conFlexion`: tras los refuerzos, los cercos tampoco
   * pueden hacer fallar la flexión (cambian el canto útil y el hueco de las barras).
   */
  const pasoCercos = (conFlexion: boolean) => {
    for (const k of [1, 2] as const) {
      const eje = k === 1 ? ("x" as const) : ("y" as const);
      const fallan = new Set(estacionesSinCortante(d, armadoLosa(a, datos), k));
      if (!fallan.size) continue;
      for (const z of zonasDe(k, `${eje}-inf`, fallan)) {
        const c: CercosForjado = { direccion: eje, ...caja(z.estaciones), cercos: tabla[0]! };
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
          sinRefuerzo.push({ zona: z.id.replace(`:${eje}-inf:R`, `:${eje}:C${conFlexion ? "b" : ""}`), motivo: `ningunos cercos de la tabla cumplen ${motivo}: la sección no basta` });
        }
      }
    }
  };
  if (reticular) pasoCercos(false);

  // ─── 3. Los refuerzos, zona a zona ────────────────────────────────────────────────────────────
  const refuerzos: RefuerzoForjado[] = (a.refuerzos = []);
  for (const arm of ARMADURAS_FORJADO) {
    const k = direccionArmadura(arm);
    const dir = d.direcciones[k - 1]!;
    const fallan = new Set(estacionesQueFallan(d, armadoLosa(a, datos), arm));
    if (!fallan.size) continue;
    for (const z of zonasDe(k, arm, fallan)) {
      const clases: SeccionLosa[] = reticular ? ["abaco", "nervio"] : ["maciza"];
      for (const clase of clases) {
        const suyas = z.estaciones.filter((e) => e.seccion === clase);
        if (!suyas.length) continue;
        const en = clase === "abaco" ? ("abacos" as const) : clase === "nervio" ? ("nervios" as const) : undefined;
        const r: RefuerzoForjado = { armadura: arm, ...caja(suyas), barras: parrillas[0]!, ...(en ? { en } : {}) };
        const cubiertas = dir.estaciones.filter((e) => cubre(r, e));
        refuerzos.push(r);
        let vale = false;
        let motivo = "";
        for (const b of clase === "nervio" ? nervios : parrillas) {
          r.barras = b;
          const c = probar({ direccion: k, estaciones: cubiertas });
          const f = c.filas.find((x) => x.armadura === arm && x.estado === "fail" && x.grupo !== "seccion");
          const p = c.pendientes[0];
          if (!f && !p) {
            vale = true;
            break;
          }
          motivo = p?.motivo ?? `«${f!.descripcion}»`;
        }
        if (!vale) {
          refuerzos.pop();
          sinRefuerzo.push({ armadura: arm, zona: z.id, ...(en ? { en } : {}), motivo: `ningún refuerzo de la tabla cumple ${motivo}: la sección no basta` });
        }
      }
    }
  }
  // Un refuerzo en segunda capa baja el canto útil del nervio, y con él su cortante sin cercos: otra pasada
  if (reticular && refuerzos.length) pasoCercos(true);
  if (!cercos.length) delete a.cercos;
  if (!refuerzos.length) delete a.refuerzos;
  return { armado: a, comprobacion: probar(), probados, sinRefuerzo };
}
