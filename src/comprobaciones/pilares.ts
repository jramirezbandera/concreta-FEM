/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.6): los pilares de un proyecto, comprobados con el
 * armado que lleva (`armado.pilares`) o con el que se propone de la tabla. Lo que usan `fem comprobar`
 * y `fem armar`.
 *
 * Un tramo sin armado no cumple: se dice, y no se inventa uno para comprobarlo.
 */
import type { Consultas, Respuesta } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { areaDe, armadoPilar, barrasDe, DATOS_ARMADO, textoArmado, type ArmadoTramoPilar, type DatosArmado } from "./armado.ts";
import { aflojarCentro, diametroDe, domina, proponerTramo, subirTramo } from "./armar/pilares.ts";
import { comprobarTramo, type ComprobacionTramo, type FilaPilar, type Pendiente } from "./comprobar/pilares.ts";
import { demandasPilar, type DemandasTramo } from "./demandas/pilares.ts";
import { agotar, type Paso } from "./pasos.ts";

/** El armado de los pilares del proyecto: por pilar y por la planta de la cabeza de cada tramo. */
export type ArmadoPilares = Record<string, Record<string, ArmadoTramoPilar>>;

export interface FilaResumen {
  id: string;
  descripcion: string;
  articulo: string;
  /** null si la fila falla sin cociente. */
  aprovechamiento: number | null;
  estado: FilaPilar["estado"];
  comb: string;
  extremo: FilaPilar["extremo"];
  pesimos?: true;
  informativa?: true;
}

export interface TramoComprobado {
  /** La planta de la cabeza del tramo y la de su base. */
  planta: string;
  plantaBase: string;
  seccion: string;
  /** El tramo flexible, entre las caras de sus nudos, m (para sus zonas de cercos, CO1-f). */
  libre?: number;
  /** De dónde sale el armado: del proyecto, de la tabla, o no hay. */
  origen: "proyecto" | "propuesto" | "sin-armado";
  armado?: ArmadoTramoPilar;
  /** «4Ø16 + 4Ø12 (caras b) · cØ6/140». */
  texto?: string;
  cumple: boolean;
  /** El de la fila que manda; null si falla sin cociente o no hay armado. */
  aprovechamiento: number | null;
  /** La fila que falla, si falla alguna; si no, la de agotamiento (flexión, axil, cortante) de mayor aprovechamiento. */
  manda?: FilaResumen;
  pendientes: Pendiente[];
  /** Todas las filas, si se piden. */
  filas?: FilaResumen[];
  /** Con una propuesta: su posición en la tabla y los armados probados. */
  posicion?: number;
  probados?: number;
  /** Lo propuesto se subió por una regla de obra (CO1-e): por el tramo de encima o por su grupo. */
  ajuste?: "continuidad" | "agrupado";
}

export interface PilarComprobado {
  pilar: string;
  cumple: boolean;
  /** Combinaciones de ELU con las que se ha comprobado. */
  combinaciones: number;
  tramos: TramoComprobado[];
}

export interface ComprobacionPilares {
  pilares: PilarComprobado[];
  resumen: { pilares: number; tramos: number; cumplen: number; noCumplen: number; sinArmado: number; llamadas: number };
}

export interface OpcionesPilares {
  /** Sólo estos pilares (por defecto, todos). */
  ids?: readonly string[];
  /** Proponer de la tabla en vez de usar el armado del proyecto. */
  proponer?: boolean;
  /** Con `proponer`: sólo en los tramos que no tienen armado en el proyecto. */
  soloSinArmado?: boolean;
  /** Dar todas las filas de cada tramo. */
  filas?: boolean;
  /** Con `proponer`: las reglas de obra de CO1-e, continuidad en altura y agrupar (por defecto, sí). */
  reglasObra?: boolean;
  /** Con `proponer`: CO1-f, los cercos del centro del tramo más abiertos que los de sus extremos (por defecto, sí). */
  zonasCercos?: boolean;
}

const finito = (x: number) => (Number.isFinite(x) ? x : null);
const fila = (f: FilaPilar): FilaResumen => ({
  id: f.id,
  descripcion: f.descripcion,
  articulo: f.articulo,
  aprovechamiento: finito(f.aprovechamiento),
  estado: f.estado,
  comb: f.comb,
  extremo: f.extremo,
  ...(f.pesimos ? { pesimos: true as const } : {}),
  ...(f.informativa ? { informativa: true as const } : {}),
});

/** Las filas de agotamiento (dependen de la demanda); las demás son reglas de armado: cumplen o no. */
const AGOTAMIENTO = /^(nm-|nd-max|biaxial-check|flexion-check|flexotraccion|traccion|cortante|biela)/;

/** La fila que manda: la que falla, si falla alguna; si no, la de agotamiento de mayor aprovechamiento. */
function manda(c: ComprobacionTramo): FilaPilar | undefined {
  let m: FilaPilar | undefined;
  const peso = (f: FilaPilar) => (f.estado === "fail" ? 2 : AGOTAMIENTO.test(f.id) ? 1 : 0);
  for (const f of c.filas) if (!f.informativa && (!m || peso(f) > peso(m) || (peso(f) === peso(m) && f.aprovechamiento > m.aprovechamiento))) m = f;
  return m;
}

function componer(base: Pick<TramoComprobado, "planta" | "plantaBase" | "seccion" | "libre">, origen: TramoComprobado["origen"], a: ArmadoTramoPilar | undefined, c: ComprobacionTramo | null, extra: Partial<TramoComprobado>, filas?: boolean): TramoComprobado {
  const m = c ? manda(c) : undefined;
  return {
    ...base,
    origen,
    ...(a ? { armado: a, texto: textoArmado(a) } : {}),
    cumple: c?.cumple ?? false,
    aprovechamiento: m ? finito(m.aprovechamiento) : null,
    ...(m ? { manda: fila(m) } : {}),
    pendientes: c?.pendientes ?? [],
    ...(filas && c ? { filas: c.filas.map(fila) } : {}),
    ...extra,
  };
}

interface Contexto {
  pilar: string;
  t: DemandasTramo;
  betaUno: boolean;
  /** Su índice en los tramos del pilar. */
  k: number;
}

/**
 * Con lo propuesto en un grupo (misma planta y misma sección), lo que tenga al menos esta fracción del
 * área del mayor sube hasta él (CO1-e).
 */
export const AGRUPAR_AREA = 0.8;

/** Cada pilar por su id (el primero, si se repite). */
function indicePilares(pilares: readonly PilarComprobado[]): Map<string, PilarComprobado> {
  const r = new Map<string, PilarComprobado>();
  for (const p of pilares) if (!r.has(p.pilar)) r.set(p.pilar, p);
  return r;
}

/**
 * Las reglas de obra de lo propuesto (CO1-e), que sólo suben armado y se comprueban siempre:
 *  - continuidad en altura: un tramo no lleva menos barras, de menor diámetro ni cercos más débiles
 *    que el de encima (el que arranca de su cabeza);
 *  - agrupar: en cada planta, los pilares de la misma sección con un armado parecido (≥ AGRUPAR_AREA
 *    del área del mayor del grupo), con el del mayor.
 * Se repiten hasta que nada cambia (cada pasada sólo sube, y la tabla se acaba).
 */
function* reglasObra(pilares: PilarComprobado[], contexto: Contexto[], datos: DatosArmado | undefined): Generator<Paso, void> {
  const de = new Map<TramoComprobado, Contexto>();
  const porId = indicePilares(pilares);
  for (const c of contexto) de.set(porId.get(c.pilar)!.tramos[c.k]!, c);
  // No se sabe cuántas subidas habrá: se avisa con las hechas (el total, las mismas)
  let subidas = 0;
  const subir = (x: TramoComprobado, minimo: ArmadoTramoPilar, porque: "continuidad" | "agrupado"): boolean => {
    const c = de.get(x)!;
    const s = subirTramo(c.t, x.armado!, minimo, datos, c.betaUno);
    if (!s) return false;
    const filas = x.filas !== undefined;
    const nuevo = componer({ planta: x.planta, plantaBase: x.plantaBase, seccion: x.seccion, ...(x.libre !== undefined ? { libre: x.libre } : {}) }, "propuesto", s.armado, s.comprobacion, { posicion: s.posicion, ...(x.probados !== undefined ? { probados: x.probados } : {}), ajuste: porque }, filas);
    for (const k of Object.keys(x) as (keyof TramoComprobado)[]) delete x[k];
    Object.assign(x, nuevo);
    return true;
  };
  for (let pasada = 0; pasada < 50; pasada++) {
    let cambio = false;
    // Continuidad: de cada tramo propuesto, el de encima es el del mismo pilar que arranca de su cabeza
    for (const p of pilares)
      for (const x of p.tramos) {
        if (x.origen !== "propuesto" || !x.armado) continue;
        const encima = p.tramos.find((y) => y.plantaBase === x.planta && y.armado);
        if (encima && !domina(x.armado, encima.armado!) && !!x.armado.anillo === !!encima.armado!.anillo) {
          if (subir(x, encima.armado!, "continuidad")) cambio = true;
          yield { fase: "reglas de obra", hecho: ++subidas, total: subidas, pieza: p.pilar };
        }
      }
    // Agrupar, por planta y sección
    const grupos = new Map<string, TramoComprobado[]>();
    for (const p of pilares)
      for (const x of p.tramos)
        if (x.origen === "propuesto" && x.armado) {
          const clave = `${x.planta}|${x.seccion}`;
          (grupos.get(clave) ?? grupos.set(clave, []).get(clave)!).push(x);
        }
    for (const g of grupos.values()) {
      const pendientes = [...g].sort((a, b) => areaDe(b.armado!) - areaDe(a.armado!));
      while (pendientes.length) {
        const lider = pendientes.shift()!;
        for (let i = pendientes.length - 1; i >= 0; i--) {
          const x = pendientes[i]!;
          // Sólo lo que el mayor ya cubre en barras y diámetro (si no, subir a él sería otro armado)
          if (areaDe(x.armado!) < AGRUPAR_AREA * areaDe(lider.armado!) || barrasDe(x.armado!) > barrasDe(lider.armado!) || diametroDe(x.armado!) > diametroDe(lider.armado!)) continue;
          pendientes.splice(i, 1);
          if (!domina(x.armado!, lider.armado!)) {
            if (subir(x, lider.armado!, "agrupado")) cambio = true;
            yield { fase: "reglas de obra", hecho: ++subidas, total: subidas };
          }
        }
      }
    }
    if (!cambio) return;
  }
}

export function comprobarPilares(q: Consultas, armado: ArmadoPilares | undefined, datos: DatosArmado | undefined, op: OpcionesPilares = {}): Respuesta<ComprobacionPilares> {
  return agotar(pasosPilares(q, armado, datos, op));
}

/** `comprobarPilares`, avisando tras cada pilar (`pasos.ts`). */
export function* pasosPilares(q: Consultas, armado: ArmadoPilares | undefined, datos: DatosArmado | undefined, op: OpcionesPilares = {}): Generator<Paso, Respuesta<ComprobacionPilares>> {
  const todos = (q.fisico.pilares ?? []).map((p) => p.id);
  const ids = op.ids?.length ? op.ids : todos;
  const diagnosticos: Diagnostico[] = [];
  const vistos = new Set<string>();
  const pilares: PilarComprobado[] = [];
  const contexto: Contexto[] = [];
  const resumen = { pilares: 0, tramos: 0, cumplen: 0, noCumplen: 0, sinArmado: 0, llamadas: 0 };
  for (const id of ids) {
    const d = demandasPilar(q, id);
    if (!d.valido) return d;
    for (const x of d.diagnosticos) {
      const clave = `${x.codigo}|${x.codigo === "comprobacion/beta-no-vale" ? "" : x.mensaje}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      diagnosticos.push(x.codigo === "comprobacion/beta-no-vale" ? { ...x, mensaje: x.mensaje.replace(`: ${id} no se da por comprobado.`, ": los pilares no se dan por comprobados."), ids: [] } : x);
    }
    const tramos: TramoComprobado[] = d.valor.tramos.map((t, k) => {
      contexto.push({ pilar: id, t, betaUno: d.valor.betaUno, k });
      const base = { planta: t.planta, plantaBase: t.plantaBase, seccion: t.seccion.id, libre: t.longitudLibre };
      const suyo = armado?.[id]?.[t.planta];
      let a: ArmadoTramoPilar | undefined = suyo;
      let c: ComprobacionTramo | null;
      let extra: Partial<TramoComprobado> = {};
      let origen: TramoComprobado["origen"] = suyo ? "proyecto" : "sin-armado";
      if (op.proponer && !(op.soloSinArmado && suyo)) {
        const p = proponerTramo(t, datos, d.valor.betaUno);
        a = p.armado ?? undefined;
        c = p.comprobacion;
        origen = p.armado ? "propuesto" : "sin-armado";
        extra = { ...(p.armado ? { posicion: p.posicion } : {}), probados: p.probados };
        if (!p.armado) return { ...base, origen, cumple: false, aprovechamiento: null, pendientes: [{ motivo: p.motivo ?? "sin propuesta", demandas: 0 }], ...extra };
      } else if (suyo) c = comprobarTramo(t, armadoPilar(suyo, datos), d.valor.betaUno);
      else return { ...base, origen, cumple: false, aprovechamiento: null, pendientes: [{ motivo: "el tramo no tiene armado en el proyecto", demandas: 0 }] };
      resumen.llamadas += c?.llamadas ?? 0;
      return componer(base, origen, a, c, extra, op.filas);
    });
    resumen.pilares++;
    pilares.push({ pilar: id, cumple: false, combinaciones: d.valor.combinaciones, tramos });
    yield { fase: op.proponer ? "armado de la tabla" : "comprobación", hecho: pilares.length, total: ids.length, pieza: id };
  }
  if (op.proponer && op.reglasObra !== false) yield* reglasObra(pilares, contexto, datos);
  // CO1-f: lo propuesto, con el centro de cada tramo más abierto si sigue cumpliendo
  if (op.proponer && op.zonasCercos !== false) {
    const porId = indicePilares(pilares);
    let hechos = 0;
    for (let i = 0; i < contexto.length; i++) {
      const c = contexto[i]!;
      // (un aviso por pilar: al acabar su último tramo)
      if (i > 0 && contexto[i - 1]!.pilar !== c.pilar) yield { fase: "cercos del centro", hecho: ++hechos, total: pilares.length, pieza: contexto[i - 1]!.pilar };
      const x = porId.get(c.pilar)!.tramos[c.k]!;
      if (x.origen !== "propuesto" || !x.armado) continue;
      const s = aflojarCentro(c.t, x.armado, datos, c.betaUno);
      if (!s) continue;
      const nuevo = componer({ planta: x.planta, plantaBase: x.plantaBase, seccion: x.seccion, ...(x.libre !== undefined ? { libre: x.libre } : {}) }, "propuesto", s.armado, s.comprobacion, { ...(x.posicion !== undefined ? { posicion: x.posicion } : {}), ...(x.probados !== undefined ? { probados: x.probados } : {}), ...(x.ajuste ? { ajuste: x.ajuste } : {}) }, x.filas !== undefined);
      for (const k of Object.keys(x) as (keyof TramoComprobado)[]) delete x[k];
      Object.assign(x, nuevo);
    }
  }
  for (const p of pilares) {
    p.cumple = p.tramos.every((t) => t.cumple);
    for (const t of p.tramos) {
      resumen.tramos++;
      if (t.origen === "sin-armado") resumen.sinArmado++;
      if (t.cumple) resumen.cumplen++;
      else resumen.noCumplen++;
    }
  }
  if (datos?.recubrimiento === undefined)
    diagnosticos.push({
      codigo: "comprobacion/recubrimiento-por-defecto",
      severidad: "aviso",
      mensaje: `Los pilares se comprueban con el recubrimiento por defecto, ${DATOS_ARMADO.recubrimiento} mm hasta el cerco, sin clase de exposición: confírmalo o escríbelo en obra.armado.recubrimiento (en fachada expuesta, ambiente agresivo o contacto con el terreno suele hacer falta más).`,
    });
  if (resumen.sinArmado && !op.proponer)
    diagnosticos.push({ codigo: "comprobacion/sin-armado", severidad: "aviso", mensaje: `${resumen.sinArmado} de ${resumen.tramos} tramos de pilar no tienen armado en el proyecto (armado.pilares) y no se dan por comprobados; «fem armar» propone uno.` });
  return { valido: true, valor: { pilares, resumen }, diagnosticos };
}

/** El bloque `armado.pilares` con lo propuesto (y lo que ya había, donde no se propone). */
export function armadoPropuesto(c: ComprobacionPilares, previo: ArmadoPilares | undefined): ArmadoPilares {
  const r: ArmadoPilares = {};
  for (const [id, tramos] of Object.entries(previo ?? {})) r[id] = { ...tramos };
  for (const p of c.pilares) for (const t of p.tramos) if (t.armado && t.origen === "propuesto") (r[p.pilar] ??= {})[t.planta] = t.armado;
  return r;
}
