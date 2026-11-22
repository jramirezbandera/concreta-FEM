/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §4.6): las losas macizas y reticulares de un proyecto,
 * comprobadas con el armado que llevan (`armado.forjados`) o con el que se propone de las tablas. Lo
 * que usan `fem comprobar` y `fem armar`, con los pilares (`pilares.ts`) y las vigas (`vigas.ts`).
 *
 * Una losa sin armado no cumple: se dice, y no se inventa uno para comprobarla.
 */
import { baseDe, type ArmadoProyecto } from "../agente/armaduraBase.ts";
import type { Consultas, Respuesta } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { ARMADURAS_FORJADO, DATOS_ARMADO, textoArmadoForjado, textoBarrasForjado, type ArmadoForjado, type ArmaduraForjado, type DatosArmado } from "./armado.ts";
import { proponerLosa } from "./armar/losas.ts";
import { armadoLosa, comprobarLosa, type ComprobacionLosa, type FilaLosa } from "./comprobar/losas.ts";
import { demandasLosa, type SeccionLosa } from "./demandas/losas.ts";

/** El armado de las losas del proyecto, por su id. */
export type ArmadoLosas = Record<string, ArmadoForjado>;

export interface FilaResumenLosa {
  id: string;
  armadura?: ArmaduraForjado;
  seccion: SeccionLosa;
  /** Lo que arma las estaciones de la fila: «base», «ábacos» o los refuerzos que las cubren («R3 Ø12/150»). */
  armado: string;
  descripcion: string;
  articulo: string;
  /** null si la fila falla sin cociente. */
  aprovechamiento: number | null;
  estado: FilaLosa["estado"];
  franja?: string;
  /** Estación de la demanda a lo largo de la franja, m. */
  s?: number;
  comb?: string;
}

export interface LosaComprobada {
  losa: string;
  planta: string;
  tipo: "maciza" | "reticular";
  /** De dónde sale el armado: del proyecto, de las tablas, o no hay. */
  origen: "proyecto" | "propuesto" | "sin-armado";
  armado?: ArmadoForjado;
  /** «x-inf Ø12/250 · … · 8 refuerzos». */
  texto?: string;
  cumple: boolean;
  /** El de la fila que manda; null si falla sin cociente o no hay armado. */
  aprovechamiento: number | null;
  /** La fila que falla, si falla alguna; si no, la de agotamiento (flexión, fisuración, cortante) de mayor aprovechamiento. */
  manda?: FilaResumenLosa;
  /** Filas que fallan. */
  fallan: number;
  pendientes: { motivo: string }[];
  /** Combinaciones de ELU con las que se ha comprobado. */
  combinaciones: number;
  /** Estaciones de sus franjas comprobadas. */
  estaciones: number;
  /** Todas las filas, si se piden. */
  filas?: FilaResumenLosa[];
  /** Con una propuesta: los armados probados y las zonas que se quedan sin refuerzo. */
  probados?: number;
  sinRefuerzo?: { armadura?: ArmaduraForjado; zona: string; motivo: string }[];
}

export interface ComprobacionLosas {
  losas: LosaComprobada[];
  resumen: { losas: number; cumplen: number; noCumplen: number; sinArmado: number; llamadas: number };
}

export interface OpcionesLosas {
  /** Sólo estas losas (por defecto, todas). */
  ids?: readonly string[];
  /** Proponer de las tablas en vez de usar el armado del proyecto. */
  proponer?: boolean;
  /** Con `proponer`: sólo en las losas que no tienen armado en el proyecto. */
  soloSinArmado?: boolean;
  /** Dar todas las filas de cada losa. */
  filas?: boolean;
  /** La armadura base de AB (kN·m/m): al proponer, la base en barras cubre al menos ese momento. */
  bases?: Pick<ArmadoProyecto, "base" | "losas">;
}

const finito = (x: number) => (Number.isFinite(x) ? x : null);
const AGOTAMIENTO = /\/(bending|cracking|shear|shear-max)$/;

function fila(f: FilaLosa, a: ArmadoForjado): FilaResumenLosa {
  const armado = f.refuerzos.length ? f.refuerzos.map((i) => `R${i + 1} ${textoBarrasForjado(a.refuerzos![i]!.barras)}`).join(" + ") : f.seccion === "abaco" ? "ábacos" : "base";
  return {
    id: f.id,
    ...(f.armadura ? { armadura: f.armadura } : {}),
    seccion: f.seccion,
    armado,
    descripcion: f.descripcion,
    articulo: f.articulo,
    aprovechamiento: finito(f.aprovechamiento),
    estado: f.estado,
    ...(f.franja ? { franja: f.franja } : {}),
    ...(f.s !== undefined ? { s: f.s } : {}),
    ...(f.comb ? { comb: f.comb } : {}),
  };
}

/** La fila que manda: la que falla, si falla alguna; si no, la de agotamiento de mayor aprovechamiento. */
function manda(c: ComprobacionLosa): FilaLosa | undefined {
  let m: FilaLosa | undefined;
  const peso = (f: FilaLosa) => (f.estado === "fail" ? 2 : AGOTAMIENTO.test(f.id) ? 1 : 0);
  for (const f of c.filas) if (!m || peso(f) > peso(m) || (peso(f) === peso(m) && f.aprovechamiento > m.aprovechamiento)) m = f;
  return m;
}

export function comprobarLosas(q: Consultas, armado: ArmadoLosas | undefined, datos: DatosArmado | undefined, op: OpcionesLosas = {}): Respuesta<ComprobacionLosas> {
  const todas = (q.fisico.losas ?? []).map((l) => l.id);
  const ids = op.ids?.length ? op.ids : todas;
  const diagnosticos: Diagnostico[] = [];
  const vistos = new Set<string>();
  const losas: LosaComprobada[] = [];
  const resumen = { losas: 0, cumplen: 0, noCumplen: 0, sinArmado: 0, llamadas: 0 };
  let conPilares = false;
  for (const id of ids) {
    const d = demandasLosa(q, id);
    if (!d.valido) return d;
    for (const x of d.diagnosticos) {
      const clave = `${x.codigo}|${x.mensaje}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      diagnosticos.push(x);
    }
    const dem = d.valor;
    const estaciones = dem.direcciones[0].estaciones.length + dem.direcciones[1].estaciones.length;
    conPilares ||= dem.direcciones.some((x) => x.estaciones.some((e) => e.cortante === null));
    const base = { losa: id, planta: dem.planta, tipo: dem.reticular ? ("reticular" as const) : ("maciza" as const), combinaciones: dem.combinaciones, estaciones };
    const suyo = armado?.[id];
    let a: ArmadoForjado | undefined = suyo;
    let c: ComprobacionLosa | null = null;
    let origen: LosaComprobada["origen"] = suyo ? "proyecto" : "sin-armado";
    let extra: Partial<LosaComprobada> = {};
    if (op.proponer && !(op.soloSinArmado && suyo)) {
      const momentoBase: Partial<Record<ArmaduraForjado, number>> = {};
      for (const k of ARMADURAS_FORJADO) {
        const m = baseDe(op.bases, id, k);
        if (m !== null) momentoBase[k] = m;
      }
      const p = proponerLosa(dem, datos, { momentoBase });
      a = p.armado ?? undefined;
      c = p.comprobacion;
      origen = p.armado ? "propuesto" : "sin-armado";
      extra = { probados: p.probados, ...(p.sinRefuerzo.length ? { sinRefuerzo: p.sinRefuerzo } : {}) };
      if (!p.armado) {
        losas.push({ ...base, origen, cumple: false, aprovechamiento: null, fallan: 0, pendientes: [{ motivo: p.motivo ?? "sin propuesta" }], ...extra });
        continue;
      }
    } else if (suyo) {
      c = comprobarLosa(dem, armadoLosa(suyo, datos));
      if (c.sinEstaciones.length)
        diagnosticos.push({ codigo: "armado/refuerzo-sin-estaciones", severidad: "aviso", mensaje: `${c.sinEstaciones.length > 1 ? "Los refuerzos" : "El refuerzo"} ${c.sinEstaciones.map((i) => i + 1).join(", ")} de la losa ${id} no ${c.sinEstaciones.length > 1 ? "cubren" : "cubre"} ninguna estación de sus franjas: su rectángulo (s, t en los ejes de su armadura) cae fuera de la losa o de su clase de sección. No ${c.sinEstaciones.length > 1 ? "cuentan" : "cuenta"}.`, ids: [id] });
    } else {
      losas.push({ ...base, origen, cumple: false, aprovechamiento: null, fallan: 0, pendientes: [{ motivo: "la losa no tiene armado en el proyecto" }] });
      continue;
    }
    const m = c ? manda(c) : undefined;
    resumen.llamadas += c?.llamadas ?? 0;
    losas.push({
      ...base,
      origen,
      ...(a ? { armado: a, texto: textoArmadoForjado(a) } : {}),
      cumple: c?.cumple ?? false,
      aprovechamiento: m ? finito(m.aprovechamiento) : null,
      ...(m && a ? { manda: fila(m, a) } : {}),
      fallan: c?.filas.filter((f) => f.estado === "fail").length ?? 0,
      pendientes: c?.pendientes ?? [],
      ...(op.filas && c && a ? { filas: c.filas.map((f) => fila(f, a!)) } : {}),
      ...extra,
    });
  }
  for (const l of losas) {
    resumen.losas++;
    if (l.origen === "sin-armado") resumen.sinArmado++;
    if (l.cumple) resumen.cumplen++;
    else resumen.noCumplen++;
  }
  if (resumen.losas && datos?.exposicion === undefined)
    diagnosticos.push({ codigo: "comprobacion/losas-por-defecto", severidad: "aviso", mensaje: `Las losas se comprueban con la clase de exposición ${DATOS_ARMADO.exposicion} (fisura admisible de 0,3 mm), por defecto: confírmala o escríbela en obra.armado (exposicion; con XC1, en interiores secos, la fisuración no se comprueba).` });
  if (conPilares)
    diagnosticos.push({ codigo: "comprobacion/punzonamiento-aparte", severidad: "info", mensaje: "El cortante de las losas no se comprueba junto a los pilares (en su metro ni a menos de dos cantos de su cara): ahí es del punzonamiento, que se comprueba aparte, pilar a pilar." });
  if (resumen.sinArmado && !op.proponer)
    diagnosticos.push({ codigo: "comprobacion/sin-armado", severidad: "aviso", mensaje: `${resumen.sinArmado} de ${resumen.losas} losas no tienen armado en el proyecto (armado.forjados) y no se dan por comprobadas; «fem armar» propone uno.` });
  return { valido: true, valor: { losas, resumen }, diagnosticos };
}

/** El bloque `armado.forjados` con lo propuesto (y lo que ya había, donde no se propone). */
export function armadoPropuestoLosas(c: ComprobacionLosas, previo: ArmadoLosas | undefined): ArmadoLosas {
  const r: ArmadoLosas = { ...previo };
  for (const l of c.losas) if (l.armado && l.origen === "propuesto") r[l.losa] = l.armado;
  return r;
}
