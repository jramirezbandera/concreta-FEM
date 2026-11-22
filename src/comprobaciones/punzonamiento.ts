/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): el punzonamiento de las losas de un proyecto junto
 * a sus pilares, con el armado de las losas (`armado.forjados`) y la armadura de punzonamiento que
 * lleven (`armado.punzonamiento`) o la que se propone de la tabla. Lo que usan `fem comprobar` y
 * `fem armar`, con los pilares, las vigas y las losas.
 *
 * Una losa sin armado no se da por comprobada: la resistencia a punzonamiento depende de su armadura
 * de flexión.
 */
import type { Consultas, Respuesta } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { textoPunzonamiento, type ArmadoForjado, type ArmaduraPunzonamiento, type DatosArmado } from "./armado.ts";
import { proponerPunzonamiento } from "./armar/punzonamiento.ts";
import { armadoPunzonamiento, comprobarPunzonamiento, type CaraPunzonamiento, type ComprobacionPunzonamiento, type FilaPunzonamiento } from "./comprobar/punzonamiento.ts";
import { demandasPunzonamiento } from "./demandas/punzonamiento.ts";

/** La armadura de punzonamiento del proyecto: por pilar y por la planta de la losa. */
export type ArmadoPunzonamientos = Record<string, Record<string, ArmaduraPunzonamiento>>;

export interface FilaResumenPunzonamiento {
  id: string;
  cara: CaraPunzonamiento;
  descripcion: string;
  articulo: string;
  /** null si la fila falla sin cociente. */
  aprovechamiento: number | null;
  estado: FilaPunzonamiento["estado"];
  comb?: string;
}

export interface PunzonamientoComprobado {
  pilar: string;
  planta: string;
  losa: string;
  /** De dónde sale la armadura de punzonamiento: del proyecto, de la tabla, no lleva, o la losa no tiene armado. */
  origen: "proyecto" | "propuesto" | "sin-armadura" | "sin-armado";
  armadura?: ArmaduraPunzonamiento;
  /** «Ø8 2R/150 × 4 perímetros». */
  texto?: string;
  /** Con armadura: los perímetros de cercos y hasta dónde llegan desde la cara del pilar, mm. */
  perimetros?: number;
  alcance?: number;
  /** De la cara que manda: la posición, β, la demanda (kN; lo que la losa pasa al pilar), su combinación, el perímetro crítico eficaz y el canto útil (mm). */
  posicion?: "interior" | "borde" | "esquina";
  cara?: CaraPunzonamiento;
  beta?: number;
  VEd?: number;
  /** Como información: lo que en esa combinación le pasan las vigas planas, kN (no cuenta: es el cortante de la viga). */
  porVigasPlanas?: number;
  comb?: string;
  u1?: number;
  d?: number;
  cumple: boolean;
  /** El de la fila que manda; null si falla sin cociente o no se ha comprobado. */
  aprovechamiento: number | null;
  /** vEd/vRd,c: por encima de 1 hace falta armadura de punzonamiento. */
  sinArmadura: number | null;
  manda?: FilaResumenPunzonamiento;
  /** Filas que fallan. */
  fallan: number;
  pendientes: { motivo: string }[];
  /** Las vigas que le llegan, planas y no: lo que le pasan no cuenta. */
  vigasPlanas: string[];
  vigas: string[];
  filas?: FilaResumenPunzonamiento[];
  /** Con una propuesta: las armaduras probadas. */
  probados?: number;
}

export interface ComprobacionPunzonamientos {
  pilares: PunzonamientoComprobado[];
  resumen: { uniones: number; cumplen: number; noCumplen: number; conArmadura: number; sinArmadoLosa: number; pendientes: number; llamadas: number };
}

export interface OpcionesPunzonamiento {
  /** Sólo estos pilares (por defecto, todos). */
  ids?: readonly string[];
  /** Proponer de la tabla en vez de usar la armadura del proyecto. */
  proponer?: boolean;
  /** Dar todas las filas. */
  filas?: boolean;
}

const finito = (x: number) => (Number.isFinite(x) ? x : null);
const AGOTAMIENTO = /\/punz-ved-(max|vrdc|vrdcs)$/;

const fila = (f: FilaPunzonamiento): FilaResumenPunzonamiento => ({ id: f.id, cara: f.cara, descripcion: f.descripcion, articulo: f.articulo, aprovechamiento: finito(f.aprovechamiento), estado: f.estado, ...(f.comb ? { comb: f.comb } : {}) });

/** La fila que manda: la que falla, si falla alguna; si no, la de agotamiento de mayor aprovechamiento. */
function manda(c: ComprobacionPunzonamiento): FilaPunzonamiento | undefined {
  let m: FilaPunzonamiento | undefined;
  const peso = (f: FilaPunzonamiento) => (f.estado === "fail" ? 2 : AGOTAMIENTO.test(f.id) && !f.informativa ? 1 : 0);
  for (const f of c.filas) if (!m || peso(f) > peso(m) || (peso(f) === peso(m) && f.aprovechamiento > m.aprovechamiento)) m = f;
  return m;
}

export function comprobarPunzonamientos(q: Consultas, forjados: Record<string, ArmadoForjado> | undefined, armaduras: ArmadoPunzonamientos | undefined, datos: DatosArmado | undefined, op: OpcionesPunzonamiento = {}): Respuesta<ComprobacionPunzonamientos> {
  const d = demandasPunzonamiento(q, op.ids);
  if (!d.valido) return d;
  const diagnosticos: Diagnostico[] = [...d.diagnosticos];
  const pilares: PunzonamientoComprobado[] = [];
  const resumen = { uniones: 0, cumplen: 0, noCumplen: 0, conArmadura: 0, sinArmadoLosa: 0, pendientes: 0, llamadas: 0 };
  const conVigas = new Set<string>();
  const conPlanas = new Set<string>();
  const cimentacion = new Set<string>();
  for (const D of d.valor.demandas) {
    const base = { pilar: D.pilar, planta: D.planta, losa: D.losa, vigasPlanas: D.vigasPlanas, vigas: D.vigas };
    if (D.vigas.length) conVigas.add(D.pilar);
    if (D.vigasPlanas.length) conPlanas.add(D.pilar);
    if (D.cimentacion) cimentacion.add(D.losa);
    const losa = forjados?.[D.losa];
    if (!losa) {
      pilares.push({ ...base, origen: "sin-armado", cumple: false, aprovechamiento: null, sinArmadura: null, fallan: 0, pendientes: [{ motivo: `la losa ${D.losa} no tiene armado en el proyecto (la resistencia a punzonamiento depende de su armadura de flexión)` }] });
      continue;
    }
    const suya = armaduras?.[D.pilar]?.[D.planta];
    let c: ComprobacionPunzonamiento;
    let armadura: ArmaduraPunzonamiento | undefined = suya;
    let origen: PunzonamientoComprobado["origen"] = suya ? "proyecto" : "sin-armadura";
    let extra: Partial<PunzonamientoComprobado> = {};
    if (op.proponer) {
      const p = proponerPunzonamiento(D, armadoPunzonamiento(losa, undefined, datos));
      c = p.comprobacion;
      armadura = p.armadura ?? undefined;
      origen = p.armadura ? "propuesto" : "sin-armadura";
      extra = { probados: p.probados };
      if (p.motivo && !c.pendientes.length) c = { ...c, pendientes: [{ motivo: `sin propuesta: ${p.motivo}` }], cumple: false };
    } else c = comprobarPunzonamiento(D, armadoPunzonamiento(losa, suya, datos));
    resumen.llamadas += c.llamadas;
    // Sin combinaciones que carguen el pilar no hay nada que comprobar
    if (!c.casos.length && !c.pendientes.length) continue;
    const m = manda(c);
    const caso = c.casos.find((x) => x.cara === m?.cara) ?? c.casos[0];
    pilares.push({
      ...base,
      origen,
      ...(armadura ? { armadura, texto: `${textoPunzonamiento(armadura)}${caso?.perimetros ? ` × ${caso.perimetros} perímetros` : ""}` } : {}),
      ...(armadura && caso?.perimetros ? { perimetros: caso.perimetros, alcance: caso.alcance! } : {}),
      ...(caso ? { posicion: caso.posicion, cara: caso.cara, beta: caso.beta, VEd: caso.VEd, ...(D.vigasPlanas.length ? { porVigasPlanas: caso.vigasPlanas } : {}), comb: caso.comb, u1: caso.u1Eficaz, d: caso.d } : {}),
      cumple: c.cumple,
      aprovechamiento: m ? finito(m.aprovechamiento) : null,
      sinArmadura: c.casos.length ? c.sinArmadura : null,
      ...(m ? { manda: fila(m) } : {}),
      fallan: c.filas.filter((f) => f.estado === "fail").length,
      pendientes: c.pendientes,
      ...(op.filas ? { filas: c.filas.map(fila) } : {}),
      ...extra,
    });
  }
  for (const p of pilares) {
    resumen.uniones++;
    if (p.origen === "sin-armado") resumen.sinArmadoLosa++;
    if (p.armadura) resumen.conArmadura++;
    if (p.pendientes.length) resumen.pendientes++;
    if (p.cumple) resumen.cumplen++;
    else resumen.noCumplen++;
  }
  if (resumen.sinArmadoLosa)
    diagnosticos.push({ codigo: "comprobacion/sin-armado", severidad: "aviso", mensaje: `El punzonamiento de ${resumen.sinArmadoLosa} de ${resumen.uniones} uniones de pilar y losa no se comprueba: su losa no tiene armado en el proyecto (armado.forjados); «fem armar» propone uno.` });
  if (conVigas.size || conPlanas.size) {
    const todos = [...new Set([...conVigas, ...conPlanas])].sort();
    diagnosticos.push({
      codigo: "comprobacion/punzonamiento-con-vigas",
      severidad: "info",
      mensaje: `A ${todos.length} de los pilares comprobados les llegan vigas${conPlanas.size ? ` (a ${conPlanas.size}, vigas planas)` : ""}: el punzonamiento se comprueba sólo con lo que la losa les pasa por su huella; lo que les llega por las vigas es el cortante de la viga, que se comprueba con ella. Los pilares a los que la losa no llega (van dentro del ancho de sus vigas) no tienen comprobación de punzonamiento.`,
      ids: todos,
    });
  }
  if (cimentacion.size)
    diagnosticos.push({ codigo: "comprobacion/punzonamiento-cimentacion", severidad: "info", mensaje: `En las losas de cimentación (${[...cimentacion].sort().join(", ")}) no se descuenta la reacción del terreno dentro del perímetro crítico: del lado de la seguridad.`, ids: [...cimentacion].sort() });
  return { valido: true, valor: { pilares, resumen }, diagnosticos };
}

/** El bloque `armado.punzonamiento` con lo propuesto: donde se propone, lo de antes se sustituye (o se quita, si ya no hace falta). */
export function armadoPropuestoPunzonamiento(c: ComprobacionPunzonamientos, previo: ArmadoPunzonamientos | undefined): ArmadoPunzonamientos {
  const r: ArmadoPunzonamientos = {};
  for (const [id, t] of Object.entries(previo ?? {})) r[id] = { ...t };
  for (const p of c.pilares) {
    if (p.origen === "sin-armado") continue;
    if (p.origen === "propuesto" && p.armadura) (r[p.pilar] ??= {})[p.planta] = p.armadura;
    else if (r[p.pilar]) delete r[p.pilar]![p.planta];
  }
  for (const id of Object.keys(r)) if (!Object.keys(r[id]!).length) delete r[id];
  return r;
}
