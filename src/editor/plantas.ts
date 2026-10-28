/**
 * GE3 (`docs/fem3d/gestores.md` §3.5): añadir n plantas de altura h encima o debajo de una, como la
 * introducción de plantas de CYPECAD. Las plantas van de arriba abajo y la `altura` de cada una es
 * la que hay hasta la de encima (`Planta.altura`), así que:
 *
 * - **Encima de X:** X pasa a tener h hasta la primera nueva, cada nueva h hasta la siguiente, y la
 *   última nueva lo que X tenía hasta la de encima (nada, si X era la de arriba). Lo de encima sube n·h.
 * - **Debajo de X:** las nuevas van entre X y la de debajo, cada una con h hasta la de encima; la de
 *   debajo conserva su altura. X y lo de encima suben n·h.
 *
 * Una sola operación (un `lote`): un paso de deshacer.
 *
 * Puro: sin IO.
 */
import type { ModeloFisico, Planta, TipoPlanta } from "../compilador/fisico.ts";
import type { Operacion } from "./operaciones.ts";
import { indiceIds, type Objeto } from "./referencias.ts";

export interface PedidoPlantas {
  n: number;
  /** m, de forjado a forjado. */
  altura: number;
  donde: "encima" | "debajo";
  /** La planta de referencia. */
  de: string;
  /** Prefijo de los ids: «N» da los siguientes libres (N2, N3…). */
  prefijo?: string;
  tipo?: TipoPlanta;
}

export const MAX_PLANTAS_NUEVAS = 50;

export type InsercionPlantas = { ok: true; operacion: Operacion; ids: string[]; plantas: Planta[] } | { ok: false; mensaje: string };

export function insertarPlantas(m: ModeloFisico, p: PedidoPlantas): InsercionPlantas {
  const i = m.plantas.findIndex((x) => x.id === p.de);
  if (i < 0) return { ok: false, mensaje: `No hay ninguna planta «${p.de}».` };
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > MAX_PLANTAS_NUEVAS) return { ok: false, mensaje: `El número de plantas va de 1 a ${MAX_PLANTAS_NUEVAS}.` };
  if (!(Number.isFinite(p.altura) && p.altura > 0)) return { ok: false, mensaje: "La altura tiene que ser mayor que 0." };
  const prefijo = (p.prefijo ?? "N").trim();
  if (!prefijo) return { ok: false, mensaje: "Falta el prefijo de los ids." };

  // Los ids, del más cercano a X al más lejano
  const ocupados = indiceIds(m);
  const ids: string[] = [];
  for (let k = 1; ids.length < p.n; k++) if (!ocupados.has(`${prefijo}${k}`)) ids.push(`${prefijo}${k}`);
  const nueva = (id: string, altura: number | null): Planta => ({ id, ...(p.tipo ? { tipo: p.tipo } : {}), altura });

  const x = m.plantas[i]!;
  const operaciones: Operacion[] = [];
  let resultado: Planta[];
  if (p.donde === "encima") {
    // De abajo arriba: cada una delante (encima) de la anterior
    const nuevas = ids.map((id, k) => nueva(id, k < p.n - 1 ? p.altura : x.altura));
    operaciones.push({ op: "cambiar", coleccion: "plantas", id: x.id, objeto: { ...x, altura: p.altura } as unknown as Objeto });
    nuevas.forEach((q, k) => operaciones.push({ op: "crear", coleccion: "plantas", objeto: q as unknown as Objeto, antesDe: k === 0 ? x.id : nuevas[k - 1]!.id }));
    resultado = [...m.plantas.slice(0, i), ...[...nuevas].reverse(), { ...x, altura: p.altura }, ...m.plantas.slice(i + 1)];
  } else {
    // De arriba abajo, entre X y la de debajo
    const debajo = m.plantas[i + 1]?.id ?? null;
    const nuevas = ids.map((id) => nueva(id, p.altura));
    nuevas.forEach((q) => operaciones.push({ op: "crear", coleccion: "plantas", objeto: q as unknown as Objeto, antesDe: debajo }));
    resultado = [...m.plantas.slice(0, i + 1), ...nuevas, ...m.plantas.slice(i + 1)];
  }
  return { ok: true, operacion: operaciones.length === 1 ? operaciones[0]! : { op: "lote", operaciones }, ids, plantas: resultado };
}

export interface PedidoEdificio {
  /** Plantas sobre la de abajo (la cimentación), contando la que ya hay encima de ella. */
  n: number;
  /** m, de la cimentación a la primera. */
  alturaBaja: number;
  /** m, entre las demás. */
  altura: number;
  prefijo?: string;
}

/**
 * Las plantas de un proyecto que empieza (dos plantas: una sobre la cimentación, como el proyecto
 * nuevo): la primera a `alturaBaja` de la cimentación y n − 1 más encima, de `altura`. Un paso de
 * deshacer. Con más de dos plantas, se añaden con `insertarPlantas`.
 */
export function plantasEdificio(m: ModeloFisico, p: PedidoEdificio): InsercionPlantas {
  if (m.plantas.length !== 2) return { ok: false, mensaje: "Sólo para un proyecto con una planta sobre la cimentación." };
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > MAX_PLANTAS_NUEVAS + 1) return { ok: false, mensaje: `El número de plantas va de 1 a ${MAX_PLANTAS_NUEVAS + 1}.` };
  if (!(Number.isFinite(p.alturaBaja) && p.alturaBaja > 0)) return { ok: false, mensaje: "La altura de la primera tiene que ser mayor que 0." };
  const [primera, base] = m.plantas as [Planta, Planta];
  const baseNueva: Planta = { ...base, altura: p.alturaBaja };
  const operaciones: Operacion[] = base.altura === p.alturaBaja ? [] : [{ op: "cambiar", coleccion: "plantas", id: base.id, objeto: baseNueva as unknown as Objeto }];
  const m2: ModeloFisico = { ...m, plantas: [primera, baseNueva] };
  let ids: string[] = [];
  let plantas: Planta[] = [...m2.plantas];
  if (p.n > 1) {
    const r = insertarPlantas(m2, { n: p.n - 1, altura: p.altura, donde: "encima", de: primera.id, ...(p.prefijo !== undefined ? { prefijo: p.prefijo } : {}) });
    if (!r.ok) return r;
    operaciones.push(...(r.operacion.op === "lote" ? r.operacion.operaciones : [r.operacion]));
    ids = r.ids;
    plantas = r.plantas;
  }
  if (!operaciones.length) return { ok: false, mensaje: "Ya está así." };
  return { ok: true, operacion: operaciones.length === 1 ? operaciones[0]! : { op: "lote", operaciones }, ids, plantas };
}
