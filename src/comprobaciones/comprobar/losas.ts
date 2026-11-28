/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §4.3): comprobar una losa maciza o reticular con un armado
 * dado.
 *
 * El juez es el módulo de forjados de Concreta (`calcForjados`, copiado sin tocar en `../concreta/`):
 * un metro de losa maciza o un nervio en T de un reticular, con su armadura base y un refuerzo por
 * cara. Su sección «vano» es aquí la cara inferior y su «apoyo», la superior.
 *
 * Las estaciones de las franjas de una dirección (`demandas/losas.ts`) se agrupan por la sección que
 * trabaja en ellas: la clase (maciza, nervio o ábaco), los refuerzos que las cubren en cada cara y,
 * en los nervios, sus cercos y la luz de su franja (de ella sale el ancho eficaz de la T, del que
 * dependen el momento resistente y la cuantía mínima).
 * Cada fila del módulo depende de un solo esfuerzo (la flexión, del momento de su cara; la
 * fisuración, del cuasipermanente; el cortante, del cortante), así que basta una llamada por grupo
 * con el mayor de cada uno: cada fila es la peor de las que darían sus estaciones una a una, y lleva
 * la franja, la estación y la combinación que la dan.
 *
 * Qué se le da al módulo:
 *  - maciza: la parrilla base (Ø y separación) y los refuerzos que cubren la estación;
 *  - nervio: las barras de montaje por nervio y los refuerzos de los nervios; los esfuerzos, por el
 *    ancho que lleva el nervio (el de su franja);
 *  - ábaco: la parrilla de los ábacos y sus refuerzos, como una maciza del canto total (las barras de
 *    los nervios que lo cruzan no se cuentan);
 *  - varios refuerzos sobre la misma estación y cara: su suma, como uno del mayor diámetro (en un
 *    nervio, sólo si son del mismo diámetro; si no, pendiente);
 *  - la dirección 2 (las armaduras Y) va por dentro de la 1. En una maciza y en los ábacos, su
 *    recubrimiento es el de la obra más el mayor diámetro de la base de la dirección 1. En un nervio,
 *    el módulo usa el mismo recubrimiento hacia abajo y hacia los lados, y con eso las barras dejarían
 *    de caber en su ancho: se le quita ese diámetro al canto, que da el mismo canto útil (la
 *    fisuración y la cuantía mínima salen entonces con el recubrimiento de la obra y ese canto);
 *  - la fisuración, con el momento cuasipermanente entero (`loadType: "custom"`, ψ₂ = 0);
 *  - el cortante, contra VRd,c; donde lo cubre una zona de cercos (`cercos`), con ellos (si la cubren
 *    varias, con la de más acero por metro): en los nervios, cercos de nervio; en los ábacos y en una
 *    maciza, cercos con sus ramas por metro de ancho (CO3-l).
 *
 * **El cortante sin cercos (CO3-l):** el módulo toma para ρl la menor armadura de las dos caras y el
 * menor canto útil. El Anejo 19 §6.2.2(1) pide la armadura **traccionada** (anclada lbd + d más allá de
 * la sección, que es lo que hace el despiece de los refuerzos): aquí VRd,c sale con la fórmula del
 * módulo y el As y el d que da el módulo de la cara que tracciona en cada estación (la de mayor
 * momento de ELU; si ninguna tracciona, la más débil). Las estaciones de un grupo se reparten por esa
 * cara y sale una fila por cara. En los ábacos y en una maciza la fila lleva la armadura de esa cara:
 * la arregla un refuerzo (o, si no basta con uno razonable, una zona de cercos; `../armar/losas.ts`).
 * Con cercos, las filas son las del módulo, más el canto mínimo de una losa con armadura de cortante
 * (§9.3.2(1)) y la separación transversal entre ramas (§9.3.2(4)) en los ábacos y las macizas.
 *
 * Qué filas se toman: las de la flexión de una cara (momento, cuantía mínima, fisuración), sólo si
 * esa cara tracciona en alguna estación del grupo; la separación y la cuantía máxima, siempre; la del
 * cortante, si alguna estación del grupo lo tiene (junto a los pilares es del punzonamiento, CO4).
 * Las longitudes de anclaje y las filas informativas del módulo (esbeltez, reparto) no se toman.
 *
 * Lo que no se comprueba no sale nunca como «cumple»: va a `pendientes`.
 *
 * **La armadura mínima reducida (CO3-k,** `obra.armado.minimaReducidaCimentacion`**):** sólo en una losa
 * de cimentación y sólo donde la del módulo no se cumple (§9.2.1.1, ec. 9.1). Su fila `as-min` se
 * sustituye por las dos de la alternativa del mismo apartado:
 *  - `as-min`: el suelo geométrico, As ≥ `cuantiaGeometrica`·b·h (una regla de armado);
 *  - `as-min-elu`: As ≥ 1,2 veces la necesaria en ELU, comprobada como 1,2·MEd ≤ MRd. Es del lado
 *    seguro: MRd es cóncavo en As, así que la armadura necesaria no pasa de As·MEd/MRd. Depende de la
 *    demanda, como la flexión: donde no cumple, hace falta un refuerzo.
 *
 * Unidades del armado: mm y MPa, las del módulo.
 */
import { calcForjados, type ForjadosResult } from "../concreta/lib/calculations/rcSlabs.ts";
import { asMinRectangular } from "../concreta/lib/calculations/cuantiaMinima.ts";
import { getConcrete, getFyd } from "../concreta/data/materials.ts";
import { makeCheckQty, makeDetailingCheck, type CheckRow, type CheckStatus } from "../concreta/lib/calculations/types.ts";
import { GAMMA_C } from "../concreta/data/factors.ts";
import { forjadosDefaults, type ForjadosInputs } from "../concreta/data/defaults.ts";
import { areaBarra, cuantiaGeometrica, DATOS_ARMADO, FACTOR_MINIMA_REDUCIDA, ramasDe, type ArmadoForjado, type ArmaduraForjado, type BarrasForjado, type CercosForjado, type DatosArmado, type Exposicion, type RefuerzoForjado } from "../armado.ts";
import { armaduraDe, direccionArmadura, type DemandasLosa, type EstacionLosa, type SeccionLosa } from "../demandas/losas.ts";

/** El armado de una losa con los datos de la obra: lo que se le da a la comprobación. */
export interface ArmadoLosa extends ArmadoForjado {
  recubrimiento: number;
  fyk: number;
  exposicion: Exposicion;
  /** CO3-k: en una losa de cimentación, la armadura mínima reducida (1,2 veces la necesaria en ELU, con su suelo geométrico). */
  minimaReducida?: boolean;
}

/** CO3-k: ¿vale la alternativa de la armadura mínima en esta losa con este armado? */
export const conMinimaReducida = (d: Pick<DemandasLosa, "cimentacion">, a: Pick<ArmadoLosa, "minimaReducida">): boolean => !!a.minimaReducida && d.cimentacion;

export function armadoLosa(a: ArmadoForjado, d?: DatosArmado): ArmadoLosa {
  return { ...a, recubrimiento: d?.recubrimiento ?? DATOS_ARMADO.recubrimiento, fyk: d?.fyk ?? DATOS_ARMADO.fyk, exposicion: d?.exposicion ?? DATOS_ARMADO.exposicion, ...(d?.minimaReducidaCimentacion ? { minimaReducida: true } : {}) };
}

/**
 * Lo que hay que aumentar si una fila falla: la base de una armadura, la parrilla de los ábacos, un
 * refuerzo o una zona de cercos (su índice), el cortante sin cercos de un nervio (pide una zona de
 * cercos; el de un ábaco o una maciza va con su cara traccionada, CO3-l) o la sección (nada que
 * proponer).
 */
export type GrupoLosa = `base:${ArmaduraForjado}` | `abacos:${ArmaduraForjado}` | `refuerzo:${number}` | `cercos:${number}` | "cortante" | "seccion";

export interface FilaLosa {
  /** `<armadura>/<fila del módulo>` o, la del cortante, `<x|y>/shear`. */
  id: string;
  armadura?: ArmaduraForjado;
  direccion: 1 | 2;
  seccion: SeccionLosa;
  /** Los refuerzos (sus índices) que cubren las estaciones de la fila en su cara (en la del cortante, en las dos). */
  refuerzos: number[];
  descripcion: string;
  articulo: string;
  /** El del módulo; infinito si la fila falla sin cociente. */
  aprovechamiento: number;
  estado: CheckStatus;
  /** La estación y la combinación de la demanda de la fila (las reglas de armado no tienen). */
  franja?: string;
  s?: number;
  comb?: string;
  /** En la fila del momento: el resistente, kN·m por metro (el del nervio, entre su intereje). */
  resistente?: number;
  grupo: GrupoLosa;
  /** La fila del módulo, entera. */
  fila: CheckRow;
}

export interface ComprobacionLosa {
  losa: string;
  filas: FilaLosa[];
  /** El mayor de las filas (0 sin ninguna; infinito si alguna falla sin cociente). */
  aprovechamiento: number;
  pendientes: { motivo: string }[];
  /** Ninguna fila falla y nada queda pendiente. */
  cumple: boolean;
  /** Llamadas al módulo. */
  llamadas: number;
  /** Refuerzos (sus índices) que no cubren ninguna estación de su losa. */
  sinEstaciones: number[];
}

/** Por debajo de esto (kN·m/m), una cara no tracciona. */
export const MOMENTO_MINIMO = 1e-6;
const EPS = 1e-6;

const FILAS_TRACCION = new Set(["bending", "bending-over", "as-min", "cracking"]);

/** Lo que una clase de sección de la losa le pide al armado; o por qué no se puede comprobar. */
function baseDe(a: ArmadoLosa, seccion: SeccionLosa): Record<ArmaduraForjado, BarrasForjado> | null {
  return seccion === "abaco" ? (a.abacos ?? null) : a.base;
}

/** ¿Cubre el refuerzo la estación? (su armadura es de la dirección de la estación: no se mira). */
export function cubre(r: RefuerzoForjado, e: Pick<EstacionLosa, "s" | "t0" | "t1" | "seccion">): boolean {
  const tc = (e.t0 + e.t1) / 2;
  if (e.seccion === "maciza" ? r.en !== undefined : r.en !== (e.seccion === "abaco" ? "abacos" : "nervios")) return false;
  return e.s >= r.s[0] - EPS && e.s <= r.s[1] + EPS && tc >= r.t[0] - EPS && tc <= r.t[1] + EPS;
}

/** ¿Cubre la zona de cercos la estación? (los de los nervios, sólo nervios; los de los ábacos, sólo ábacos; en una maciza, la losa). */
export function cubreCercos(c: CercosForjado, e: Pick<EstacionLosa, "s" | "t0" | "t1" | "seccion">): boolean {
  const tc = (e.t0 + e.t1) / 2;
  if (e.seccion === "abaco" ? c.en !== "abacos" : c.en !== undefined) return false;
  return e.s >= c.s[0] - EPS && e.s <= c.s[1] + EPS && tc >= c.t[0] - EPS && tc <= c.t[1] + EPS;
}

/** CO3-l: la cara que tracciona en una estación: la de mayor momento de ELU; null si ninguna. */
export function caraTraccionada(e: Pick<EstacionLosa, "inferior" | "superior">): "inferior" | "superior" | null {
  const cara = e.superior >= e.inferior ? "superior" : "inferior";
  return e[cara] > MOMENTO_MINIMO ? cara : null;
}

/**
 * CO3-l: VRd,c (kN, por metro o por nervio) con la armadura de una cara: la fórmula del módulo
 * (Anejo 19 §6.2.2, ec. 6.2a y 6.2b, con su vmín) con el As y el d de esa cara que da el módulo.
 * `b`, el ancho del cortante (mm): 1 000 en una maciza o un ábaco, el del nervio en un reticular.
 */
export function vrdcCara(sec: Pick<ForjadosResult["vano"], "As" | "d">, b: number, fck: number): number {
  const d = sec.d;
  if (!(d > 0)) return 0;
  const k = Math.min(1 + Math.sqrt(200 / d), 2);
  const rho = Math.min(sec.As / (b * d), 0.02);
  const v1 = ((0.18 / GAMMA_C) * k * Math.pow(100 * rho * fck, 1 / 3) * b * d) / 1000;
  const v2 = ((0.051 / GAMMA_C) * Math.pow(k, 1.5) * Math.sqrt(fck) * b * d) / 1000;
  return Math.max(v1, v2);
}

interface CortanteCara {
  cara: "inferior" | "superior";
  /** El mayor cortante de las estaciones de esa cara, kN (por metro o por nervio). */
  VEd: number;
  VRdc: number;
  de: EstacionLosa;
  estaciones: EstacionLosa[];
}

/** El cortante sin cercos de un grupo, por la cara que tracciona en cada estación (CO3-l). */
function cortantesPorCara(res: ForjadosResult, g: Pick<Grupo, "seccion" | "estaciones">, d: Pick<DemandasLosa, "material" | "reticular">): CortanteCara[] {
  const fck = d.material.tipo === "hormigon" ? d.material.fck : NaN;
  const b = g.seccion === "nervio" ? 1000 * d.reticular!.nervio : 1000;
  const vrdc = { inferior: vrdcCara(res.vano, b, fck), superior: vrdcCara(res.apoyo, b, fck) };
  const debil = vrdc.inferior <= vrdc.superior ? "inferior" : "superior";
  const r = new Map<"inferior" | "superior", CortanteCara>();
  for (const e of g.estaciones) {
    if (e.cortante === null) continue;
    const cara = caraTraccionada(e) ?? debil;
    const v = e.cortante * e.ancho;
    const x = r.get(cara);
    if (!x) r.set(cara, { cara, VEd: v, VRdc: vrdc[cara], de: e, estaciones: [e] });
    else {
      x.estaciones.push(e);
      if (v > x.VEd) [x.VEd, x.de] = [v, e];
    }
  }
  return (["inferior", "superior"] as const).flatMap((c) => (r.has(c) ? [r.get(c)!] : []));
}

/** La sección de un grupo de estaciones: su clase, los refuerzos que las cubren en cada cara y sus cercos (−1, sin ellos). */
interface Grupo {
  seccion: SeccionLosa;
  inf: number[];
  sup: number[];
  cercos: number;
  estaciones: EstacionLosa[];
}

function grupos(a: ArmadoLosa, k: 1 | 2, estaciones: readonly EstacionLosa[]): Grupo[] {
  const [ai, as] = [armaduraDe(k, "inferior"), armaduraDe(k, "superior")];
  const suyos = (a.refuerzos ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.armadura === ai || r.armadura === as);
  const eje = k === 1 ? "x" : "y";
  const acero = (c: CercosForjado) => (ramasDe(c.cercos) * areaBarra(c.cercos.diametro)) / c.cercos.separacion;
  const susCercos = (a.cercos ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.direccion === eje);
  const porClave = new Map<string, Grupo>();
  for (const e of estaciones) {
    const inf: number[] = [];
    const sup: number[] = [];
    for (const { r, i } of suyos) if (cubre(r, e)) (r.armadura === ai ? inf : sup).push(i);
    // Los cercos de la zona de más acero por metro que la cubre (a igual acero, la primera)
    let cercos = -1;
    for (const { c, i } of susCercos) if (cubreCercos(c, e) && (cercos < 0 || acero(c) > acero(a.cercos![cercos]!))) cercos = i;
    // En un nervio, la luz de su franja al mm: es otra sección (otro ancho eficaz)
    const clave = `${e.seccion}|${inf.join(",")}|${sup.join(",")}|${cercos}|${e.seccion === "nervio" ? Math.round(1000 * e.luz) : ""}`;
    let g = porClave.get(clave);
    if (!g) porClave.set(clave, (g = { seccion: e.seccion, inf, sup, cercos, estaciones: [] }));
    g.estaciones.push(e);
  }
  return [...porClave.values()];
}

/** Varios refuerzos de una cara, como uno: la suma de sus áreas con el mayor diámetro. null si no se puede (nervio con diámetros distintos). */
function refuerzoEquivalente(rs: readonly BarrasForjado[], porNervio: boolean): BarrasForjado | null {
  if (!rs.length) return porNervio ? { diametro: 0, n: 0 } : { diametro: 0, separacion: 0 };
  if (rs.length === 1) return rs[0]!;
  const diametro = Math.max(...rs.map((r) => r.diametro));
  if (porNervio) return rs.every((r) => r.diametro === diametro) ? { diametro, n: rs.reduce((x, r) => x + (r.n ?? 0), 0) } : null;
  const As = rs.reduce((x, r) => x + (areaBarra(r.diametro) * 1000) / r.separacion!, 0);
  return { diametro, separacion: (areaBarra(diametro) * 1000) / As };
}

/** Los esfuerzos de un grupo, en lo que pide el módulo (por metro, o por nervio), con la estación que da cada uno. */
interface Esfuerzos {
  inferior: number;
  superior: number;
  cortante: number;
  cpInferior: number;
  cpSuperior: number;
  de: { inferior?: EstacionLosa; superior?: EstacionLosa; cortante?: EstacionLosa; cpInferior?: EstacionLosa; cpSuperior?: EstacionLosa };
  conCortante: boolean;
  luz: number;
}

function esfuerzosGrupo(g: Grupo): Esfuerzos {
  const r: Esfuerzos = { inferior: 0, superior: 0, cortante: 0, cpInferior: 0, cpSuperior: 0, de: {}, conCortante: false, luz: Infinity };
  for (const e of g.estaciones) {
    const w = e.ancho;
    for (const k of ["inferior", "superior", "cpInferior", "cpSuperior"] as const) if (e[k] * w > r[k]) [r[k], r.de[k]] = [e[k] * w, e];
    if (e.cortante !== null) {
      r.conCortante = true;
      if (e.cortante * w > r.cortante) [r.cortante, r.de.cortante] = [e.cortante * w, e];
    }
    r.luz = Math.min(r.luz, e.luz);
  }
  return r;
}

/** La entrada del módulo para una sección (la de un grupo de estaciones), sin sus esfuerzos; o por qué no se puede. */
export function entradaGrupo(d: Pick<DemandasLosa, "espesor" | "material" | "reticular">, a: ArmadoLosa, k: 1 | 2, g: Pick<Grupo, "seccion" | "inf" | "sup" | "cercos">): Omit<ForjadosInputs, "vano_Md" | "apoyo_Md" | "VEd" | "vano_M_G" | "apoyo_M_G" | "spanLength"> | { motivo: string } {
  const porNervio = g.seccion === "nervio";
  const base = baseDe(a, g.seccion);
  if (!base) return { motivo: "el armado no tiene la parrilla de los ábacos (abacos), y la losa tiene estaciones en ellos" };
  const [ai, as] = [armaduraDe(k, "inferior"), armaduraDe(k, "superior")];
  const [bi, bs] = [base[ai], base[as]];
  const ref = (ids: number[]) => refuerzoEquivalente(ids.map((i) => a.refuerzos![i]!.barras), porNervio);
  const [ri, rs] = [ref(g.inf), ref(g.sup)];
  if (!ri || !rs) return { motivo: `hay refuerzos de distinto diámetro solapados en los nervios (${[...g.inf, ...g.sup].map((i) => i + 1).join(", ")}): el módulo toma un solo refuerzo por cara` };
  // La dirección 2 va por dentro de la 1: pierde el mayor diámetro de la base de la 1, en el
  // recubrimiento (maciza y ábacos) o en el canto (nervios: el recubrimiento del módulo es también el lateral)
  const dentro = k === 2 ? Math.max(base["x-inf"].diametro, base["x-sup"].diametro) : 0;
  const cover = a.recubrimiento + (porNervio ? 0 : dentro);
  const comun = {
    ...forjadosDefaults,
    title: "",
    h: 1000 * d.espesor - (porNervio ? dentro : 0),
    cover,
    fck: d.material.tipo === "hormigon" ? d.material.fck : NaN,
    fyk: a.fyk,
    exposureClass: a.exposicion,
    stirrupsEnabled: false,
    tipoVano: "continuo-interior" as const,
    vano_M_Q: 0,
    apoyo_M_Q: 0,
    loadType: "custom",
    psi2Custom: 0,
  };
  const c = g.cercos >= 0 ? a.cercos![g.cercos]!.cercos : null;
  if (porNervio)
    return {
      ...comun,
      ...(c ? { stirrupsEnabled: true, vano_stirrupDiam: c.diametro, vano_stirrupSpacing: c.separacion, vano_stirrupLegs: ramasDe(c), apoyo_stirrupDiam: c.diametro, apoyo_stirrupSpacing: c.separacion, apoyo_stirrupLegs: ramasDe(c) } : {}),
      variant: "reticular",
      hFlange: 1000 * d.reticular!.capa,
      bWeb: 1000 * d.reticular!.nervio,
      intereje: 1000 * d.reticular!.intereje,
      base_inf_nBars: bi.n ?? 0,
      base_inf_barDiam: bi.diametro,
      base_sup_nBars: bs.n ?? 0,
      base_sup_barDiam: bs.diametro,
      refuerzo_vano_inf_nBars: ri.n ?? 0,
      refuerzo_vano_inf_barDiam: ri.diametro,
      refuerzo_apoyo_sup_nBars: rs.n ?? 0,
      refuerzo_apoyo_sup_barDiam: rs.diametro,
    };
  return {
    ...comun,
    ...(c ? { stirrupsEnabled: true, vano_stirrupDiam: c.diametro, vano_stirrupSpacing: c.separacion, vano_stirrupLegs: ramasDe(c), apoyo_stirrupDiam: c.diametro, apoyo_stirrupSpacing: c.separacion, apoyo_stirrupLegs: ramasDe(c) } : {}),
    variant: "maciza",
    base_inf_phi_mac: bi.diametro,
    base_inf_s_mac: bi.separacion ?? 0,
    base_sup_phi_mac: bs.diametro,
    base_sup_s_mac: bs.separacion ?? 0,
    refuerzo_vano_inf_phi_mac: ri.diametro,
    refuerzo_vano_inf_s_mac: ri.separacion ?? 0,
    refuerzo_apoyo_sup_phi_mac: rs.diametro,
    refuerzo_apoyo_sup_s_mac: rs.separacion ?? 0,
  };
}

/** La entrada entera del módulo: la del grupo con sus esfuerzos (kN·m y kN, por metro o por nervio) y la luz (m). */
export function entradaLosa(parcial: Omit<ForjadosInputs, "vano_Md" | "apoyo_Md" | "VEd" | "vano_M_G" | "apoyo_M_G" | "spanLength">, x: { inferior: number; superior: number; cortante: number; cpInferior: number; cpSuperior: number; luz: number }): ForjadosInputs {
  return { ...parcial, spanLength: 1000 * x.luz, vano_Md: x.inferior, apoyo_Md: x.superior, VEd: x.cortante, vano_M_G: x.cpInferior, apoyo_M_G: x.cpSuperior };
}

/** Las entradas del módulo de una losa, grupo a grupo (para las pruebas de identidad y para medir). */
export function entradasLosa(d: DemandasLosa, a: ArmadoLosa): { direccion: 1 | 2; seccion: SeccionLosa; inf: number[]; sup: number[]; cercos: number; estaciones: EstacionLosa[]; entrada: ForjadosInputs | null }[] {
  return ([1, 2] as const).flatMap((k) =>
    grupos(a, k, d.direcciones[k - 1]!.estaciones).map((g) => {
      const p = entradaGrupo(d, a, k, g);
      return { direccion: k, seccion: g.seccion, inf: g.inf, sup: g.sup, cercos: g.cercos, estaciones: g.estaciones, entrada: "motivo" in p ? null : entradaLosa(p, esfuerzosGrupo(g)) };
    }),
  );
}

export interface OpcionesComprobarLosa {
  /** Sólo estas estaciones de esta dirección (para proponer un refuerzo): sin los pendientes de la losa entera. */
  solo?: { direccion: 1 | 2; estaciones: readonly EstacionLosa[] };
}

export function comprobarLosa(d: DemandasLosa, a: ArmadoLosa, op: OpcionesComprobarLosa = {}): ComprobacionLosa {
  const filas: FilaLosa[] = [];
  const pendientes: { motivo: string }[] = [];
  const motivos = new Set<string>();
  const pendiente = (motivo: string) => {
    if (motivos.has(motivo)) return;
    motivos.add(motivo);
    pendientes.push({ motivo });
  };
  let llamadas = 0;
  const fin = (): ComprobacionLosa => ({
    losa: d.losa,
    filas,
    aprovechamiento: filas.reduce((m, f) => Math.max(m, f.aprovechamiento), 0),
    pendientes,
    cumple: !pendientes.length && filas.every((f) => f.estado !== "fail"),
    llamadas,
    sinEstaciones: [],
  });
  if (d.material.tipo !== "hormigon") {
    pendiente(`el material ${d.material.id} no es hormigón`);
    return fin();
  }
  if (!op.solo && d.sinELS) pendiente("sin combinaciones de ELS cuasipermanente (casos sin acción), la fisuración no se comprueba");
  const cubiertas = new Set<number>();
  const cercosUsados = new Set<number>();
  for (const k of op.solo ? [op.solo.direccion] : ([1, 2] as const)) {
    const eje = k === 1 ? "x" : "y";
    for (const g of grupos(a, k, op.solo ? op.solo.estaciones : d.direcciones[k - 1]!.estaciones)) {
      for (const i of [...g.inf, ...g.sup]) cubiertas.add(i);
      if (g.cercos >= 0) cercosUsados.add(g.cercos);
      const parcial = entradaGrupo(d, a, k, g);
      if ("motivo" in parcial) {
        pendiente(parcial.motivo);
        continue;
      }
      const x = esfuerzosGrupo(g);
      const res: ForjadosResult = calcForjados(entradaLosa(parcial, x));
      llamadas++;
      if (!res.valid) {
        pendiente(`el módulo no admite la sección ${g.seccion === "abaco" ? "de los ábacos" : g.seccion === "nervio" ? "del nervio" : "de la losa"} en ${eje.toUpperCase()}: ${res.error ?? "entrada no válida"}`);
        continue;
      }
      const basico = (cara: "inferior" | "superior"): GrupoLosa => {
        const ids = cara === "inferior" ? g.inf : g.sup;
        return ids.length ? `refuerzo:${Math.min(...ids)}` : `${g.seccion === "abaco" ? "abacos" : "base"}:${armaduraDe(k, cara)}`;
      };
      const ancho = g.seccion === "nervio" ? d.reticular!.intereje : 1;
      for (const [cara, sec] of [
        ["inferior", res.vano],
        ["superior", res.apoyo],
      ] as const) {
        const armadura = armaduraDe(k, cara);
        const tracciona = x[cara] > MOMENTO_MINIMO;
        const flexion = sec.checks.find((f) => f.id === "bending");
        for (const f0 of sec.checks) {
          if (f0.id.startsWith("anchorage-")) continue;
          if (FILAS_TRACCION.has(f0.id) && !tracciona) continue;
          // CO3-k: donde la mínima del módulo no se cumple, las dos filas de su alternativa
          const alternativa = f0.id === "as-min" && f0.status === "fail" && conMinimaReducida(d, a) && flexion && Number.isFinite(flexion.utilization) && f0.utilization > 0 ? filasMinimaReducida(f0, flexion, 1000 * d.espesor, a.fyk, d.material.fck) : null;
          for (const f of alternativa ?? [f0]) {
          const de = f.id === "bending" || f.id === "as-min-elu" ? x.de[cara] : f.id === "cracking" ? x.de[cara === "inferior" ? "cpInferior" : "cpSuperior"] : undefined;
          filas.push({
            id: `${armadura}/${f.id}`,
            armadura,
            direccion: k,
            seccion: g.seccion,
            refuerzos: cara === "inferior" ? g.inf : g.sup,
            descripcion: f.description,
            articulo: f.article,
            aprovechamiento: f.utilization,
            estado: f.status,
            ...(de ? { franja: de.franja, s: de.s, comb: f.id === "bending" || f.id === "as-min-elu" ? (cara === "inferior" ? de.combInferior : de.combSuperior) : "ELS-CP" } : {}),
            ...(f.id === "bending" ? { resistente: sec.MRd / ancho } : {}),
            // La separación máxima de una maciza es de su parrilla base; la cuantía máxima no la arregla más acero
            grupo: f.id === "as-max" ? "seccion" : f.id === "bar-spacing-maciza" ? (`${g.seccion === "abaco" ? "abacos" : "base"}:${armadura}` as GrupoLosa) : basico(cara),
            fila: f,
          });
          }
        }
      }
      if (x.conCortante) {
        for (const f of res.shearChecks) {
          // Sin cercos, el cortante va por la cara traccionada (CO3-l), abajo
          if (f.id === "shear" && g.cercos < 0) continue;
          const de = x.de.cortante;
          filas.push({
            id: `${eje}/${f.id}`,
            direccion: k,
            seccion: g.seccion,
            refuerzos: [...new Set([...g.inf, ...g.sup])],
            descripcion: f.description,
            articulo: f.article,
            aprovechamiento: f.utilization,
            estado: f.status,
            ...(de ? { franja: de.franja, s: de.s, comb: de.combCortante } : {}),
            // La biela no la arreglan más cercos; el cortante sin cercos pide una zona de cercos (en un nervio)
            grupo: f.id === "shear-max" ? "seccion" : g.cercos >= 0 ? `cercos:${g.cercos}` : "cortante",
            fila: f,
          });
        }
        if (g.cercos < 0)
          for (const v of cortantesPorCara(res, g, d)) {
            const losa = g.seccion !== "nervio";
            const f = makeCheckQty("shear", `Cortante VEd ≤ VRd,c (sin cercos; ρl de la cara ${v.cara})`, v.VEd, v.VRdc, "force", "CE Anejo 19 §6.2.2");
            filas.push({
              id: `${eje}/shear`,
              ...(losa ? { armadura: armaduraDe(k, v.cara) } : {}),
              direccion: k,
              seccion: g.seccion,
              refuerzos: v.cara === "inferior" ? g.inf : g.sup,
              descripcion: f.description,
              articulo: f.article,
              aprovechamiento: f.utilization,
              estado: f.status,
              franja: v.de.franja,
              s: v.de.s,
              comb: v.de.combCortante,
              grupo: losa ? basico(v.cara) : "cortante",
              fila: f,
            });
          }
        else if (g.seccion !== "nervio") {
          // Las reglas de una losa con armadura de cortante (§9.3.2)
          const c = a.cercos![g.cercos]!.cercos;
          const h = 1000 * d.espesor;
          const dd = Math.min(res.vano.d, res.apoyo.d);
          const st = 1000 / ramasDe(c);
          const de = x.de.cortante;
          const reglas: [CheckRow, GrupoLosa][] = [
            [makeDetailingCheck("slab-stirrup-h", "Canto mínimo de una losa con armadura de cortante", 200, h, "h,mín = 200 mm", `h = ${h.toFixed(0)} mm`, "CE Anejo 19 §9.3.2(1)"), "seccion"],
            [makeDetailingCheck("slab-stirrup-st", "Separación transversal entre ramas", st, 1.5 * dd, `st = ${st.toFixed(0)} mm`, `st,máx = 1,5·d = ${(1.5 * dd).toFixed(0)} mm`, "CE Anejo 19 §9.3.2(4)"), `cercos:${g.cercos}`],
          ];
          for (const [f, grupo] of reglas)
            filas.push({ id: `${eje}/${f.id}`, direccion: k, seccion: g.seccion, refuerzos: [...new Set([...g.inf, ...g.sup])], descripcion: f.description, articulo: f.article, aprovechamiento: f.utilization, estado: f.status, ...(de ? { franja: de.franja, s: de.s, comb: de.combCortante } : {}), grupo, fila: f });
        }
      }
    }
  }
  const r = fin();
  if (!op.solo) r.sinEstaciones = (a.refuerzos ?? []).map((_, i) => i).filter((i) => !cubiertas.has(i));
  return r;
}

/**
 * CO3-k: las dos filas de la armadura mínima reducida de una cara, de la fila `as-min` del módulo (que
 * no cumple: su aprovechamiento es As,mín/As) y de la de su flexión (MEd/MRd). `h`, el canto, mm.
 */
function filasMinimaReducida(minima: CheckRow, flexion: CheckRow, h: number, fyk: number, fck: number): CheckRow[] {
  // El acero de la cara, de la cuenta del módulo: su fila es As,mín/As, con As,mín el de (9.1) en un metro de losa
  const As = asMinRectangular(1000, h, getConcrete(fck).fctm, getFyd(fyk)) / minima.utilization;
  const geo = cuantiaGeometrica(fyk) * 1000 * h;
  const uGeo = As > 0 ? geo / As : Infinity;
  const uElu = FACTOR_MINIMA_REDUCIDA * flexion.utilization;
  const estado = (u: number): CheckStatus => (u <= 1 + 1e-9 ? "ok" : "fail");
  return [
    { ...minima, description: `Armadura mínima de tracción reducida: suelo geométrico (${(1000 * cuantiaGeometrica(fyk)).toFixed(1).replace(".", ",")} ‰ de la sección)`, value: `As,geo = ${geo.toFixed(0)} mm²`, limit: `As = ${Number.isFinite(As) ? As.toFixed(0) : "—"} mm²`, utilization: uGeo, status: estado(uGeo), article: "CE Anejo 19 §9.2.1.1(1), alternativa; suelo de la EHE-08, tabla 42.3.5" },
    { ...minima, id: "as-min-elu", description: `Armadura mínima de tracción reducida: ${String(FACTOR_MINIMA_REDUCIDA).replace(".", ",")} veces la necesaria en ELU (${String(FACTOR_MINIMA_REDUCIDA).replace(".", ",")}·MEd ≤ MRd)`, value: `${String(FACTOR_MINIMA_REDUCIDA).replace(".", ",")}·MEd/MRd = ${uElu.toFixed(3).replace(".", ",")}`, limit: "≤ 1,0", utilization: uElu, status: estado(uElu), article: "CE Anejo 19 §9.2.1.1(1), alternativa" },
  ];
}

/**
 * Las estaciones de una dirección en las que el cortante no cumple con el armado dado (las que piden
 * cercos), de las secciones dadas (los nervios, por defecto): sin cercos, las que pasan del VRd,c de
 * su cara traccionada (CO3-l); con cercos, las que no quedan por debajo del resistente del grupo. Un
 * grupo cumple sus filas del cortante si y sólo si no falla ninguna de sus estaciones.
 */
export function estacionesSinCortante(d: DemandasLosa, a: ArmadoLosa, k: 1 | 2, secciones: readonly SeccionLosa[] = ["nervio"]): EstacionLosa[] {
  const r: EstacionLosa[] = [];
  if (d.material.tipo !== "hormigon") return r;
  for (const g of grupos(a, k, d.direcciones[k - 1]!.estaciones)) {
    if (!secciones.includes(g.seccion)) continue;
    const parcial = entradaGrupo(d, a, k, g);
    if ("motivo" in parcial) continue;
    const x = esfuerzosGrupo(g);
    if (!x.conCortante) continue;
    const res = calcForjados(entradaLosa(parcial, x));
    if (!res.valid) continue;
    if (g.cercos < 0) {
      for (const v of cortantesPorCara(res, g, d)) if (v.VEd >= v.VRdc) for (const e of v.estaciones) if (e.cortante! * e.ancho >= v.VRdc) r.push(e);
    } else if (res.shearChecks.some((f) => f.id === "shear" && f.status === "fail")) for (const e of g.estaciones) if (e.cortante !== null && e.cortante * e.ancho >= res.VRd) r.push(e);
  }
  return r;
}

/**
 * Las estaciones de una armadura en las que su flexión o su fisuración no cumplen con el armado dado
 * (las que piden un refuerzo). De cada grupo, el momento resistente y el mayor momento cuasipermanente
 * con el que la fisura cumple (por bisección sobre el módulo: la abertura crece con el momento); la
 * estación falla si su momento pasa de uno de los dos. Con ello, un grupo cumple esas dos filas si y
 * sólo si no falla ninguna de sus estaciones.
 *
 * Con la armadura mínima reducida (CO3-k) y un grupo que no llega a la mínima del módulo, el momento
 * no puede pasar de MRd/1,2 (la fila `as-min-elu`).
 *
 * En los ábacos y en una maciza sin cercos, también las del cortante sin cercos cuya cara traccionada es
 * la de esta armadura (CO3-l): las arregla más acero en esa cara.
 */
export function estacionesQueFallan(d: DemandasLosa, a: ArmadoLosa, armadura: ArmaduraForjado): EstacionLosa[] {
  const k = direccionArmadura(armadura);
  const inferior = armadura.endsWith("inf");
  const r: EstacionLosa[] = [];
  if (d.material.tipo !== "hormigon") return r;
  for (const g of grupos(a, k, d.direcciones[k - 1]!.estaciones)) {
    const parcial = entradaGrupo(d, a, k, g);
    if ("motivo" in parcial) continue;
    const x = esfuerzosGrupo(g);
    const con = (m: number, cp: number) => {
      const res = calcForjados(entradaLosa(parcial, { ...x, inferior: inferior ? m : 0, superior: inferior ? 0 : m, cpInferior: inferior ? cp : 0, cpSuperior: inferior ? 0 : cp, cortante: 0 }));
      return res.valid ? (inferior ? res.vano : res.apoyo) : null;
    };
    const [M, Mcp] = inferior ? [x.inferior, x.cpInferior] : [x.superior, x.cpSuperior];
    const falla = (sec: NonNullable<ReturnType<typeof con>>, id: string) => sec.checks.some((f) => f.id === id && f.status === "fail");
    // CO3-l: el cortante sin cercos de un ábaco o una maciza, por la cara traccionada
    if (g.seccion !== "nervio" && g.cercos < 0 && x.conCortante) {
      const res = calcForjados(entradaLosa(parcial, x));
      if (res.valid)
        for (const v of cortantesPorCara(res, g, d))
          if (v.cara === (inferior ? "inferior" : "superior") && v.VEd >= v.VRdc) for (const e of v.estaciones) if (e.cortante! * e.ancho >= v.VRdc) r.push(e);
    }
    const sec = con(M, Mcp);
    if (!sec) continue;
    // CO3-k: sin la mínima del módulo, la alternativa: 1,2·MEd ≤ MRd
    const reducida = conMinimaReducida(d, a) && M > MOMENTO_MINIMO && falla(sec, "as-min");
    const fallaM = reducida ? FACTOR_MINIMA_REDUCIDA * M > sec.MRd * (1 + 1e-9) : falla(sec, "bending");
    // El mayor momento cuasipermanente con el que la fisura cumple
    let cpLimite = Infinity;
    if (falla(sec, "cracking")) {
      let [lo, hi] = [0, Mcp];
      for (let i = 0; i < 40 && hi - lo > 1e-9 * Mcp; i++) {
        const m = (lo + hi) / 2;
        if (falla(con(0, m)!, "cracking")) hi = m;
        else lo = m;
      }
      cpLimite = lo;
    }
    if (!fallaM && cpLimite === Infinity) continue;
    for (const e of g.estaciones) {
      const [m, cp] = inferior ? [e.inferior, e.cpInferior] : [e.superior, e.cpSuperior];
      // «falla» del módulo: aprovechamiento ≥ 1
      if ((fallaM && (reducida ? FACTOR_MINIMA_REDUCIDA * m * e.ancho > sec.MRd * (1 + 1e-9) : m * e.ancho >= sec.MRd)) || cp * e.ancho > cpLimite) if (!r.includes(e)) r.push(e);
    }
  }
  return r;
}
