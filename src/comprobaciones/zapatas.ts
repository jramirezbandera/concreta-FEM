/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9): las zapatas aisladas de los pilares de un proyecto,
 * con las del proyecto (`armado.zapatas`) o con las que se proponen de las tablas, y el terreno de la
 * obra (`obra.terreno`). Lo que usan `fem comprobar` y `fem armar`, con las demás piezas.
 *
 * Llevan zapata los pilares con reacción en su base (no los apeados ni los que nacen en una losa de
 * cimentación). Un pilar sin zapata en el proyecto no se da por comprobado.
 */
import type { Consultas, Respuesta } from "../compilador/consultas.ts";
import { momentosInterseccion } from "../compilador/poligonos.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { ObraProyecto } from "../agente/obra.ts";
import { DATOS_ARMADO, textoZapata, tipoZapata, type Zapata } from "./armado.ts";
import { proponerZapata } from "./armar/zapatas.ts";
import { completa, comprobarZapata, datosZapata, type CentradoraZapata, type ComprobacionZapata, type FilaZapata, type OtroPilar } from "./comprobar/zapatas.ts";
import { demandasZapata, pilaresConZapata, type DemandasZapata } from "./demandas/zapatas.ts";

/** El hormigón de una zapata sin el suyo ni el de la obra: el menor del armado (CE). */
export const FCK_ZAPATA = 25;

export interface FilaResumenZapata {
  id: string;
  descripcion: string;
  articulo: string;
  /** null si la fila falla sin cociente. */
  aprovechamiento: number | null;
  estado: FilaZapata["estado"];
  comb?: string;
  valor?: string;
  limite?: string;
  informativa?: true;
}

export interface ZapataComprobada {
  pilar: string;
  planta: string;
  tipo: "centrada" | "medianera" | "esquina";
  /** De dónde sale: del proyecto, de la tabla, o el pilar no tiene zapata (o no tiene dimensiones o parrilla). */
  origen: "proyecto" | "propuesto" | "sin-zapata";
  zapata?: Zapata;
  /** «2,00 × 2,00 × 0,60 · inf. x Ø12/200, y Ø12/200». */
  texto?: string;
  /** El hormigón: su material, el de la obra o «HA-25». */
  hormigon: string;
  cumple: boolean;
  /** El de la fila que manda; null si falla sin cociente o no se ha comprobado. */
  aprovechamiento: number | null;
  manda?: FilaResumenZapata;
  /** Filas que fallan. */
  fallan: number;
  pendientes: { motivo: string; comb?: string }[];
  presion?: ComprobacionZapata["presion"];
  rigida?: boolean;
  centradoras: CentradoraZapata[];
  filas?: FilaResumenZapata[];
  /** Con una propuesta: las zapatas probadas. */
  probados?: number;
}

export interface ComprobacionZapatas {
  zapatas: ZapataComprobada[];
  resumen: { zapatas: number; cumplen: number; noCumplen: number; sinZapata: number; pendientes: number; llamadas: number };
}

export interface OpcionesZapatas {
  /** Sólo los de estos pilares (por defecto, todos los que llevan zapata). */
  ids?: readonly string[];
  /** Proponer de las tablas en vez de usar las del proyecto. */
  proponer?: boolean;
  /** Dar todas las filas. */
  filas?: boolean;
}

const finito = (x: number) => (Number.isFinite(x) ? x : null);

const fila = (f: FilaZapata): FilaResumenZapata => ({
  id: f.id,
  descripcion: f.descripcion,
  articulo: f.articulo,
  aprovechamiento: finito(f.aprovechamiento),
  estado: f.estado,
  ...(f.comb ? { comb: f.comb } : {}),
  ...(f.valor ? { valor: f.valor } : {}),
  ...(f.limite ? { limite: f.limite } : {}),
  ...(f.informativa ? { informativa: true as const } : {}),
});

/** Las filas de agotamiento (las demás son reglas de armado: se cumplen o no). */
const AGOTAMIENTO = /^(bearing|overturn-|sliding|biela-tirante-|flexion-|cortante-|punzonamiento|armado-sup-|traccion-sup-)/;

/** La fila que manda: la que falla, si falla alguna; si no, la de agotamiento de mayor aprovechamiento. */
function manda(c: ComprobacionZapata): FilaZapata | undefined {
  let m: FilaZapata | undefined;
  const peso = (f: FilaZapata) => (f.estado === "fail" ? 2 : !f.informativa && AGOTAMIENTO.test(f.id) ? 1 : 0);
  for (const f of c.filas) if (!m || peso(f) > peso(m) || (peso(f) === peso(m) && f.aprovechamiento > m.aprovechamiento)) m = f;
  return m;
}

/** La planta de la zapata, en planta: su rectángulo con sus linderos, girado con el pilar. */
export function contornoZapata(D: Pick<DemandasZapata, "punto" | "giro" | "cx" | "cy" | "circular">, z: Zapata & { B: number; L: number }): Vec2[] {
  const [cx, cy] = D.circular ? [D.cx, D.cx] : [D.cx, D.cy];
  let [ox, oy] = [0, 0];
  for (const l of z.linderos ?? []) {
    const s = l[0] === "+" ? 1 : -1;
    // La cara «+x» del pilar, en el borde +B/2: el centro de la zapata, hacia −x
    if (l[1] === "x") ox = s * (cx / 2 - z.B / 2);
    else oy = s * (cy / 2 - z.L / 2);
  }
  const t = (D.giro * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const x = ox + (a! * z.B) / 2;
    const y = oy + (b! * z.L) / 2;
    return [D.punto[0] + c * x - s * y, D.punto[1] + s * x + c * y] as Vec2;
  });
}

export function comprobarZapatas(q: Consultas, zapatas: Record<string, Zapata> | undefined, obra: ObraProyecto | undefined, op: OpcionesZapatas = {}): Respuesta<ComprobacionZapatas> {
  const todos = pilaresConZapata(q);
  const ids = op.ids ? todos.filter((id) => op.ids!.includes(id)) : todos;
  const diagnosticos: Diagnostico[] = [];
  const resumen = { zapatas: 0, cumplen: 0, noCumplen: 0, sinZapata: 0, pendientes: 0, llamadas: 0 };
  const lista: ZapataComprobada[] = [];
  if (!ids.length) return { valido: true, valor: { zapatas: lista, resumen }, diagnosticos };
  const terreno = obra?.terreno;
  const armado = obra?.armado;
  const materiales = new Map(q.fisico.materiales.map((m) => [m.id, m]));
  const hormigon = (z: Zapata | undefined): { fck: number; nombre: string; defecto: boolean } => {
    const id = z?.material ?? obra?.materiales?.zapatas;
    const m = id !== undefined ? materiales.get(id) : undefined;
    return m && m.tipo === "hormigon" ? { fck: m.fck, nombre: m.id, defecto: false } : { fck: FCK_ZAPATA, nombre: `HA-${FCK_ZAPATA}`, defecto: true };
  };
  // Los ejes de los pilares a los que pueden ir las vigas centradoras: el de su base o, sin base, su posición
  const otros: OtroPilar[] = [];
  const cache = new Map<string, OtroPilar>();
  const otro = (id: string): OtroPilar | undefined => {
    if (cache.has(id)) return cache.get(id);
    const p = q.fisico.pilares?.find((x) => x.id === id);
    if (!p) return undefined;
    const r = (p.base ?? "empotrado") !== "ninguno" ? q.reacciones(id) : null;
    const x: OtroPilar = { id, punto: r?.valido ? [r.valor.punto[0], r.valor.punto[1]] : [p.x, p.y] };
    cache.set(id, x);
    return x;
  };
  let porDefecto = 0;
  const contornos: { pilar: string; c: Vec2[] }[] = [];
  for (const id of ids) {
    const dz = demandasZapata(q, id);
    if (!dz.valido) return dz;
    for (const x of dz.diagnosticos) if (!diagnosticos.some((y) => y.codigo === x.codigo && y.mensaje === x.mensaje)) diagnosticos.push(x);
    const D = dz.valor;
    const previa = zapatas?.[id];
    const h = hormigon(previa);
    if (h.defecto) porDefecto++;
    const d = datosZapata(h.fck, armado, terreno, previa?.tierras);
    otros.length = 0;
    for (const c of previa?.centradoras ?? []) {
      const x = otro(c);
      if (x) otros.push(x);
    }
    const base = { pilar: id, planta: D.planta, tipo: tipoZapata(previa ?? {}), hormigon: h.nombre };
    let c: ComprobacionZapata;
    let zapata: Zapata | undefined = previa;
    let origen: ZapataComprobada["origen"] = "proyecto";
    let extra: Partial<ZapataComprobada> = {};
    if (op.proponer) {
      const p = proponerZapata(D, previa, d, otros);
      c = p.comprobacion;
      zapata = p.zapata ?? previa;
      origen = p.zapata ? "propuesto" : completa(previa) ? "proyecto" : "sin-zapata";
      extra = { probados: p.probados };
      if (p.motivo && !c.pendientes.some((x) => !x.arranque && p.motivo!.includes(x.motivo))) c = { ...c, pendientes: [...c.pendientes, { motivo: `sin propuesta: ${p.motivo}` }], cumple: false };
      else if (p.motivo) c = { ...c, cumple: false };
    } else if (!completa(previa)) {
      lista.push({ ...base, origen: "sin-zapata", ...(previa ? { zapata: previa } : {}), cumple: false, aprovechamiento: null, fallan: 0, centradoras: [], pendientes: [{ motivo: previa ? "la zapata del proyecto no tiene sus dimensiones (B, L, h) o su parrilla inferior" : "el pilar no tiene zapata en el proyecto (armado.zapatas)" }] });
      continue;
    } else c = comprobarZapata(D, previa, d, otros);
    resumen.llamadas += c.llamadas;
    const m = manda(c);
    if (zapata && completa(zapata)) contornos.push({ pilar: id, c: contornoZapata(D, zapata) });
    lista.push({
      ...base,
      origen,
      ...(zapata ? { zapata, texto: textoZapata(zapata) } : {}),
      cumple: c.cumple,
      aprovechamiento: m ? finito(m.aprovechamiento) : null,
      ...(m ? { manda: fila(m) } : {}),
      fallan: c.filas.filter((f) => f.estado === "fail").length,
      pendientes: c.pendientes,
      ...(c.presion ? { presion: c.presion } : {}),
      ...(c.rigida !== undefined ? { rigida: c.rigida } : {}),
      centradoras: c.centradoras,
      ...(op.filas ? { filas: c.filas.map(fila) } : {}),
      ...extra,
    });
  }
  for (const z of lista) {
    resumen.zapatas++;
    if (z.origen === "sin-zapata") resumen.sinZapata++;
    if (z.pendientes.length) resumen.pendientes++;
    if (z.cumple) resumen.cumplen++;
    else resumen.noCumplen++;
  }
  // Avisos
  if (terreno?.tensionAdmisible === undefined)
    diagnosticos.push({ codigo: "comprobacion/sin-tension-admisible", severidad: "aviso", mensaje: "Sin la tensión admisible del terreno (obra.terreno.tensionAdmisible, del estudio geotécnico), las zapatas no se comprueban frente al terreno (presión, vuelco y deslizamiento) ni se proponen." });
  const faltan = [
    ...(terreno?.pesoEspecifico === undefined ? ["el peso específico de las tierras (18 kN/m³)"] : []),
    ...(terreno?.rozamiento === undefined ? ["el rozamiento con el terreno (0,5)"] : []),
    ...(terreno?.tierras === undefined && lista.some((z) => z.zapata?.tierras === undefined) ? ["las tierras sobre las zapatas (ninguna)"] : []),
    ...(armado?.recubrimientoZapatas === undefined ? [`el recubrimiento de sus parrillas (${DATOS_ARMADO.recubrimientoZapatas} mm)`] : []),
  ];
  if (faltan.length) diagnosticos.push({ codigo: "comprobacion/zapatas-por-defecto", severidad: "aviso", mensaje: `Las zapatas se comprueban con valores por defecto de lo que no está en la obra: ${faltan.join(", ")} (obra.terreno, obra.armado).`, detalles: { faltan } });
  if (porDefecto) diagnosticos.push({ codigo: "comprobacion/zapatas-hormigon-por-defecto", severidad: "aviso", mensaje: `${porDefecto} zapata${porDefecto > 1 ? "s van" : " va"} con HA-${FCK_ZAPATA}: no tienen hormigón propio ni de la obra (obra.materiales.zapatas).` });
  if (!op.proponer && resumen.sinZapata) diagnosticos.push({ codigo: "comprobacion/sin-zapata", severidad: "aviso", mensaje: `${resumen.sinZapata} de los ${resumen.zapatas} pilares con zapata no la tienen en el proyecto, o le faltan sus dimensiones o su parrilla (armado.zapatas): no se comprueban. «fem armar» las propone.` });
  const conCentradora = lista.filter((z) => z.centradoras.length).map((z) => z.pilar);
  if (conCentradora.length)
    diagnosticos.push({ codigo: "comprobacion/centradoras-sin-comprobar", severidad: "info", mensaje: `Las vigas centradoras de ${conCentradora.join(", ")} se resuelven con el módulo de zapatas (se llevan la excentricidad en su dirección), pero no se comprueban: su cortante y su momento van como información. La descarga que dan al pilar interior no se descuenta de su zapata.`, ids: conCentradora });
  // Dos zapatas que se pisan: no son aisladas
  const caja = (c: Vec2[]) => [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))] as const;
  const solapadas: string[][] = [];
  for (let i = 0; i < contornos.length; i++)
    for (let j = i + 1; j < contornos.length; j++) {
      const [a, b] = [caja(contornos[i]!.c), caja(contornos[j]!.c)];
      if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
      if (momentosInterseccion({ contorno: contornos[i]!.c, huecos: [] }, contornos[j]!.c).A > 1e-6) solapadas.push([contornos[i]!.pilar, contornos[j]!.pilar]);
    }
  if (solapadas.length)
    diagnosticos.push({ codigo: "comprobacion/zapatas-solapadas", severidad: "aviso", mensaje: `Se pisan las zapatas de ${solapadas.map((p) => p.join(" y ")).join("; ")}: no son aisladas (hace falta una zapata combinada o una losa, que no se comprueban).`, ids: [...new Set(solapadas.flat())] });
  const muros = q.objetosReaccion().filter((o) => o.tipo === "muro").map((o) => o.id);
  if (muros.length && !op.ids) diagnosticos.push({ codigo: "comprobacion/muros-sin-cimentacion", severidad: "info", mensaje: `La cimentación de los muros (${muros.join(", ")}) no se comprueba: una zapata corrida no es de esta fase.`, ids: muros });
  return { valido: true, valor: { zapatas: lista, resumen }, diagnosticos };
}

/** El bloque `armado.zapatas` con lo propuesto: donde se propone, lo de antes se sustituye (su posición, hormigón y tierras se quedan). */
export function armadoPropuestoZapatas(c: ComprobacionZapatas, previo: Record<string, Zapata> | undefined): Record<string, Zapata> {
  const r: Record<string, Zapata> = { ...(previo ?? {}) };
  for (const z of c.zapatas) if (z.origen === "propuesto" && z.zapata) r[z.pilar] = z.zapata;
  return r;
}
