/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §4.6): las vigas de un proyecto, comprobadas con el armado
 * que lleva (`armado.vigas`) o con el que se propone de las tablas. Lo que usan `fem comprobar` y
 * `fem armar`, con los pilares (`pilares.ts`).
 *
 * Un vano sin armado no cumple: se dice, y no se inventa uno para comprobarlo.
 */
import type { Consultas, Respuesta } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { armadoViga, DATOS_ARMADO, textoArmadoViga, type ArmadoVanoViga, type DatosArmado } from "./armado.ts";
import { proponerVano, unificarApoyo, type LadoApoyo, type ZonasFijas } from "./armar/vigas.ts";
import { comprobarVano, type ComprobacionVano, type FilaViga, type PendienteViga } from "./comprobar/vigas.ts";
import { demandasViga, type DemandasVano, type DemandasViga, type ZonaViga } from "./demandas/vigas.ts";
import { agotar, type Paso } from "./pasos.ts";
import { porticosDe, type VanoPortico } from "./porticos.ts";

/** El armado de las vigas del proyecto: por viga, el de cada vano en su orden (null, el que no lo tiene). */
export type ArmadoVigas = Record<string, (ArmadoVanoViga | null)[]>;

export interface FilaResumenViga {
  id: string;
  zona?: ZonaViga;
  descripcion: string;
  articulo: string;
  /** null si la fila falla sin cociente. */
  aprovechamiento: number | null;
  estado: FilaViga["estado"];
  comb?: string;
  /** Estación de la demanda a lo largo de la viga, m. */
  s?: number;
  pesimos?: true;
  informativa?: true;
}

export interface VanoComprobado {
  /** El vano, en su orden a lo largo de la viga (desde 0), entre las caras de sus apoyos. */
  vano: number;
  desde: number;
  hasta: number;
  apoyos: [string | null, string | null];
  /** De dónde sale el armado: del proyecto, de las tablas, o no hay. */
  origen: "proyecto" | "propuesto" | "sin-armado";
  armado?: ArmadoVanoViga;
  /** «inf 3Ø16 · sup 2Ø12 (inicio 4Ø16) · cØ8/200». */
  texto?: string;
  cumple: boolean;
  /** El de la fila que manda; null si falla sin cociente o no hay armado. */
  aprovechamiento: number | null;
  /** La fila que falla, si falla alguna; si no, la de agotamiento (flexión, cortante, fisuración, flecha, torsión) de mayor aprovechamiento. */
  manda?: FilaResumenViga;
  pendientes: PendienteViga[];
  /** Todas las filas, si se piden. */
  filas?: FilaResumenViga[];
  /** Con una propuesta: los armados probados. */
  probados?: number;
}

export interface VigaComprobada {
  viga: string;
  seccion: string;
  cumple: boolean;
  /** Combinaciones de ELU con las que se ha comprobado. */
  combinaciones: number;
  vanos: VanoComprobado[];
}

export interface ComprobacionVigas {
  vigas: VigaComprobada[];
  resumen: { vigas: number; vanos: number; cumplen: number; noCumplen: number; sinArmado: number; llamadas: number };
}

export interface OpcionesVigas {
  /** Sólo estas vigas (por defecto, todas). */
  ids?: readonly string[];
  /** Proponer de las tablas en vez de usar el armado del proyecto. */
  proponer?: boolean;
  /** Con `proponer`: sólo en los vanos que no tienen armado en el proyecto. */
  soloSinArmado?: boolean;
  /** Dar todas las filas de cada vano. */
  filas?: boolean;
}

const finito = (x: number) => (Number.isFinite(x) ? x : null);
const fila = (f: FilaViga): FilaResumenViga => ({
  id: f.id,
  ...(f.zona ? { zona: f.zona } : {}),
  descripcion: f.descripcion,
  articulo: f.articulo,
  aprovechamiento: finito(f.aprovechamiento),
  estado: f.estado,
  ...(f.comb ? { comb: f.comb } : {}),
  ...(f.s !== undefined ? { s: f.s } : {}),
  ...(f.pesimos ? { pesimos: true as const } : {}),
  ...(f.informativa ? { informativa: true as const } : {}),
});

/** Las filas de agotamiento (dependen de la demanda); las demás son reglas de armado: cumplen o no. */
const AGOTAMIENTO = /(bending|shear|shear-max|cracking|flexotraccion|torsion-biela|torsion-cercos|torsion-longitudinal)$|^flecha-/;

/** La fila que manda: la que falla, si falla alguna; si no, la de agotamiento de mayor aprovechamiento. */
function manda(c: ComprobacionVano): FilaViga | undefined {
  let m: FilaViga | undefined;
  const peso = (f: FilaViga) => (f.estado === "fail" ? 2 : AGOTAMIENTO.test(f.id) ? 1 : 0);
  for (const f of c.filas) if (!f.informativa && (!m || peso(f) > peso(m) || (peso(f) === peso(m) && f.aprovechamiento > m.aprovechamiento))) m = f;
  return m;
}

export function comprobarVigas(q: Consultas, armado: ArmadoVigas | undefined, datos: DatosArmado | undefined, op: OpcionesVigas = {}): Respuesta<ComprobacionVigas> {
  return agotar(pasosVigas(q, armado, datos, op));
}

/** `comprobarVigas`, avisando tras cada viga (`pasos.ts`). */
export function* pasosVigas(q: Consultas, armado: ArmadoVigas | undefined, datos: DatosArmado | undefined, op: OpcionesVigas = {}): Generator<Paso, Respuesta<ComprobacionVigas>> {
  const todas = (q.fisico.vigas ?? []).map((v) => v.id);
  const ids = op.ids?.length ? op.ids : todas;
  const diagnosticos: Diagnostico[] = [];
  const vistos = new Set<string>();
  const vigas: VigaComprobada[] = [];
  const resumen = { vigas: 0, vanos: 0, cumplen: 0, noCumplen: 0, sinArmado: 0, llamadas: 0 };
  /** Lo de cada vano con armado, antes de resumirlo: el propuesto puede subir al igualar los apoyos (CO2-k). */
  interface Hecho {
    base: Pick<VanoComprobado, "vano" | "desde" | "hasta" | "apoyos">;
    d: DemandasViga;
    v: DemandasVano;
    origen: VanoComprobado["origen"];
    a: ArmadoVanoViga;
    c: ComprobacionVano | null;
    extra: Partial<VanoComprobado>;
  }
  const hechos = new Map<string, Hecho>();
  const porViga: { id: string; seccion: string; combinaciones: number; vanos: (VanoComprobado | Hecho)[] }[] = [];
  for (const id of ids) {
    const d = demandasViga(q, id);
    if (!d.valido) return d;
    for (const x of d.diagnosticos) {
      const clave = `${x.codigo}|${x.mensaje}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      diagnosticos.push(x);
    }
    const suyos = armado?.[id] ?? [];
    if (suyos.length > d.valor.vanos.length)
      diagnosticos.push({ codigo: "armado/vano", severidad: "aviso", mensaje: `El armado de la viga ${id} tiene ${suyos.length} vanos y la viga, ${d.valor.vanos.length}: los que sobran no se usan (los vanos van en su orden a lo largo de la viga, entre las caras de sus apoyos).`, ids: [id] });
    const vanos: (VanoComprobado | Hecho)[] = d.valor.vanos.map((v) => {
      const base = { vano: v.indice, desde: v.desde, hasta: v.hasta, apoyos: v.apoyos };
      const suyo = suyos[v.indice] ?? undefined;
      let a: ArmadoVanoViga | undefined = suyo;
      let c: ComprobacionVano | null;
      let extra: Partial<VanoComprobado> = {};
      let origen: VanoComprobado["origen"] = suyo ? "proyecto" : "sin-armado";
      if (op.proponer && !(op.soloSinArmado && suyo)) {
        const p = proponerVano(d.valor, v, datos);
        a = p.armado ?? undefined;
        c = p.comprobacion;
        origen = p.armado ? "propuesto" : "sin-armado";
        extra = { probados: p.probados };
        if (!p.armado) return { ...base, origen, cumple: false, aprovechamiento: null, pendientes: [{ motivo: p.motivo ?? "sin propuesta" }], ...extra };
      } else if (suyo) c = comprobarVano(d.valor, v, armadoViga(suyo, datos));
      else return { ...base, origen, cumple: false, aprovechamiento: null, pendientes: [{ motivo: "el vano no tiene armado en el proyecto" }] };
      resumen.llamadas += c?.llamadas ?? 0;
      const h: Hecho = { base, d: d.valor, v, origen, a: a!, c, extra };
      hechos.set(`${id}/${v.indice}`, h);
      return h;
    });
    porViga.push({ id, seccion: d.valor.seccion.id, combinaciones: d.valor.combinaciones, vanos });
    yield { fase: op.proponer ? "armado de las tablas" : "comprobación", hecho: porViga.length, total: ids.length, pieza: id };
  }

  // CO2-k: la misma armadura superior a los dos lados de cada apoyo por el que la viga continúa, para
  // que pase entera. Sólo sube lo que se propone ahora; lo del proyecto no se toca
  if (op.proponer) {
    /** Por vano, las zonas que ya se igualaron con el vecino: no se mueven al igualar la otra. */
    const fijas = new Map<string, ZonasFijas>();
    const zonaDe = (a: ArmadoVanoViga, campo: "superiorInicio" | "superiorFin") => a[campo] ?? a.superior;
    for (const p of porticosDe(q)) {
      const lado = (v: VanoPortico, l: 0 | 1): LadoApoyo | null => {
        const campo = (v.invertida ? l === 0 : l === 1) ? "superiorFin" : "superiorInicio";
        const h = hechos.get(v.clave);
        if (h) return { armado: h.a, campo, ...(h.origen === "propuesto" ? { libre: { d: h.d, v: h.v, fijas: fijas.get(v.clave) ?? {} } } : {}) };
        const suyo = armado?.[v.viga]?.[v.vano];
        return suyo ? { armado: suyo, campo } : null;
      };
      for (let i = 0; i < p.apoyos.length; i++) {
        const [vi, vd] = [p.vanos.find((v) => v.apoyos[1] === i), p.vanos.find((v) => v.apoyos[0] === i)];
        if (!vi || !vd || !vi.geometria || !vd.geometria) continue;
        const [li, ld] = [lado(vi, 1), lado(vd, 0)];
        if (!li || !ld) continue;
        const r = unificarApoyo(li, ld, datos);
        [vi, vd].forEach((v, k) => {
          const [u, h] = [r[k], hechos.get(v.clave)];
          if (!u || !h) return;
          resumen.llamadas += u.comprobacion.llamadas;
          h.a = u.armado;
          h.c = u.comprobacion;
        });
        // Si quedaron iguales, las dos zonas ya no se mueven
        const [ai, ad] = [hechos.get(vi.clave)?.a ?? li.armado, hechos.get(vd.clave)?.a ?? ld.armado];
        const [zi, zd] = [zonaDe(ai, li.campo), zonaDe(ad, ld.campo)];
        if (zi.n === zd.n && zi.diametro === zd.diametro) {
          fijas.set(vi.clave, { ...fijas.get(vi.clave), [li.campo]: zi });
          fijas.set(vd.clave, { ...fijas.get(vd.clave), [ld.campo]: zd });
        }
      }
    }
  }

  for (const g of porViga) {
    const vanos: VanoComprobado[] = g.vanos.map((x) => {
      if (!("d" in x)) return x;
      const m = x.c ? manda(x.c) : undefined;
      return {
        ...x.base,
        origen: x.origen,
        armado: x.a,
        texto: textoArmadoViga(x.a),
        cumple: x.c?.cumple ?? false,
        aprovechamiento: m ? finito(m.aprovechamiento) : null,
        ...(m ? { manda: fila(m) } : {}),
        pendientes: x.c?.pendientes ?? [],
        ...(op.filas && x.c ? { filas: x.c.filas.map(fila) } : {}),
        ...x.extra,
      };
    });
    for (const v of vanos) {
      resumen.vanos++;
      if (v.origen === "sin-armado") resumen.sinArmado++;
      if (v.cumple) resumen.cumplen++;
      else resumen.noCumplen++;
    }
    resumen.vigas++;
    vigas.push({ viga: g.id, seccion: g.seccion, cumple: vanos.every((v) => v.cumple), combinaciones: g.combinaciones, vanos });
  }
  // Lo que no está escrito en la obra y decide un veredicto: se dice, como el recubrimiento de los pilares (CO1-d)
  const porDefecto = [
    ...(datos?.exposicion === undefined ? [`la clase de exposición ${DATOS_ARMADO.exposicion} (fisura admisible de 0,3 mm)`] : []),
    ...(datos?.flechaActiva === undefined ? [`la flecha activa de L/${DATOS_ARMADO.flechaActiva}`] : []),
  ];
  if (resumen.vanos && porDefecto.length)
    diagnosticos.push({
      codigo: "comprobacion/vigas-por-defecto",
      severidad: "aviso",
      mensaje: `Las vigas se comprueban con ${porDefecto.join(" y ")}, por defecto: confírmalo o escríbelo en obra.armado (exposicion: XC1 en interiores secos, con 0,4 mm; flechaActiva: 500 con tabiques frágiles, 300 sin tabiquería).`,
    });
  if (resumen.sinArmado && !op.proponer)
    diagnosticos.push({ codigo: "comprobacion/sin-armado", severidad: "aviso", mensaje: `${resumen.sinArmado} de ${resumen.vanos} vanos de viga no tienen armado en el proyecto (armado.vigas) y no se dan por comprobados; «fem armar» propone uno.` });
  return { valido: true, valor: { vigas, resumen }, diagnosticos };
}

/** El bloque `armado.vigas` con lo propuesto (y lo que ya había, donde no se propone). */
export function armadoPropuestoVigas(c: ComprobacionVigas, previo: ArmadoVigas | undefined): ArmadoVigas {
  const r: ArmadoVigas = {};
  for (const [id, vanos] of Object.entries(previo ?? {})) r[id] = [...vanos];
  for (const g of c.vigas) {
    const lista = (r[g.viga] ??= []);
    // Sin huecos: los vanos de antes de uno propuesto que no tienen armado, null
    for (const v of g.vanos) {
      while (lista.length <= v.vano) lista.push(null);
      if (v.armado && v.origen === "propuesto") lista[v.vano] = v.armado;
    }
    while (lista.length && lista[lista.length - 1] === null) lista.pop();
    if (!lista.length) delete r[g.viga];
  }
  return r;
}
