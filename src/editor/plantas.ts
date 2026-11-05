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
import { cotasPlantas } from "../compilador/cotas.ts";
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

/** Un campo de una planta que cambia al escribir una cota (`moverCota`). */
export interface CambioCota {
  id: string;
  campo: "altura" | "tipo";
  /** El tipo «planta» es el de por defecto: se quita el campo. */
  valor: number | TipoPlanta;
}

export type EfectoCota = { ok: true; cambios: CambioCota[] } | { ok: false; mensaje: string };

/** A 1e-9 m: las alturas que salen de restar cotas, sin el ruido de la suma (4,3, no 4,300000000000001). */
const redondear = (x: number): number => Math.round(x * 1e9) / 1e9;
const EPS = 1e-9;
const textoCota = (c: number): string => (Math.abs(c) < EPS ? "±0,00" : `${c > 0 ? "+" : "−"}${Math.abs(c).toFixed(2).replace(".", ",")}`);

/**
 * Escribir la cota de la planta `id` (la de la cara superior de su forjado). Las cotas no se guardan
 * (`cotasPlantas`): salen de las alturas y de qué planta es la ±0,00 (la más baja que no es sótano),
 * así que lo que cambia son esos datos:
 *
 * - **En general,** se mueve sólo ese forjado: cambian su altura (hasta la de encima) y la de la de
 *   debajo, y las demás se quedan donde están. Tiene que quedar entre la de encima y la de debajo.
 * - **0 en otra planta** la hace la ±0,00: las de debajo pasan a sótanos (y ella deja de serlo). Las
 *   alturas no cambian; todas las cotas bajan o suben lo mismo.
 * - **La ±0,00** sólo puede bajar, si la de encima no es un sótano: pasa a sótano, a esa profundidad
 *   bajo la de encima, que es la ±0,00 nueva (la cimentación a −4,30 bajo la planta baja).
 *
 * Los cambios incluyen los de la propia planta.
 */
export function moverCota(plantas: readonly Planta[], id: string, cota: number): EfectoCota {
  const i = plantas.findIndex((p) => p.id === id);
  if (i < 0) return { ok: false, mensaje: `No hay ninguna planta «${id}».` };
  if (!Number.isFinite(cota)) return { ok: false, mensaje: "La cota tiene que ser un número." };
  const cotas = cotasPlantas(plantas);
  const c = cotas[i];
  if (c === null || c === undefined || cotas.some((x) => x === null)) return { ok: false, mensaje: "Falta la altura de alguna planta: sin ella no se sabe dónde están las cotas." };
  if (Math.abs(cota - c) < EPS) return { ok: true, cambios: [] };
  let origen = 0;
  for (let k = plantas.length - 1; k >= 0; k--)
    if (plantas[k]!.tipo !== "sotano") {
      origen = k;
      break;
    }
  const x = plantas[i]!;
  const arriba = plantas[i - 1];
  const abajo = plantas[i + 1];

  if (i === origen) {
    if (cota < 0 && arriba && arriba.tipo !== "sotano")
      return { ok: true, cambios: [{ id, campo: "tipo", valor: "sotano" }, { id, campo: "altura", valor: redondear(-cota) }] };
    return {
      ok: false,
      mensaje: `${id} es la ±0,00 (la planta más baja que no es sótano): las demás cotas se miden desde ella.${arriba && arriba.tipo !== "sotano" ? " Puede bajarla (una cota negativa la hace sótano y la ±0,00 pasa a " + arriba.id + ")," : ""} Para que la ±0,00 sea otra planta, escriba 0 en su cota.`,
    };
  }
  if (Math.abs(cota) < EPS) {
    // La ±0,00 pasa a x: ella deja de ser sótano y las de debajo lo son
    const cambios: CambioCota[] = [];
    if (x.tipo === "sotano") cambios.push({ id, campo: "tipo", valor: "planta" });
    for (const p of plantas.slice(i + 1)) if (p.tipo !== "sotano") cambios.push({ id: p.id, campo: "tipo", valor: "sotano" });
    return { ok: true, cambios };
  }
  const cArriba = arriba ? cotas[i - 1]! : null;
  const cAbajo = abajo ? cotas[i + 1]! : null;
  if ((cArriba !== null && !(cota < cArriba - EPS)) || (cAbajo !== null && !(cota > cAbajo + EPS))) {
    const entre =
      cArriba !== null && cAbajo !== null
        ? `entre la de ${abajo!.id} (${textoCota(cAbajo)}) y la de ${arriba!.id} (${textoCota(cArriba)})`
        : cArriba !== null
          ? `por debajo de la de ${arriba!.id} (${textoCota(cArriba)})`
          : `por encima de la de ${abajo!.id} (${textoCota(cAbajo!)})`;
    return { ok: false, mensaje: `Se mueve sólo el forjado de ${id}, así que su cota tiene que quedar ${entre}. Para cambiar varias, cambie las alturas.` };
  }
  const cambios: CambioCota[] = [];
  if (cArriba !== null) cambios.push({ id, campo: "altura", valor: redondear(cArriba - cota) });
  if (cAbajo !== null) cambios.push({ id: abajo!.id, campo: "altura", valor: redondear(cota - cAbajo) });
  return { ok: true, cambios };
}

/** Una planta con los cambios de `moverCota` que son suyos. */
export function conCambiosCota<T extends Pick<Planta, "id" | "tipo" | "altura">>(p: T, cambios: readonly CambioCota[]): T {
  let r = p;
  for (const c of cambios) {
    if (c.id !== p.id) continue;
    if (c.campo === "altura") r = { ...r, altura: c.valor as number };
    else if (c.valor === "planta") {
      const { tipo: _, ...resto } = r;
      r = resto as T;
    } else r = { ...r, tipo: c.valor as TipoPlanta };
  }
  return r;
}

export interface PedidoEdificio {
  /** Plantas sobre la de abajo (la cimentación), contando la que ya hay encima de ella. */
  n: number;
  /** m, de la cimentación a la primera. */
  alturaBaja: number;
  /** m, entre las demás. */
  altura: number;
  prefijo?: string;
  /**
   * Dónde va la ±0,00: en la cimentación (por defecto, como el proyecto nuevo) o en la primera
   * planta, con la cimentación como sótano a −`alturaBaja`.
   */
  cero?: "cimentacion" | "primera";
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
  let baseNueva: Planta = { ...base, altura: p.alturaBaja };
  if (p.cero === "primera") baseNueva = { ...baseNueva, tipo: "sotano" };
  else if (p.cero === "cimentacion" && base.tipo === "sotano") baseNueva = conCambiosCota(baseNueva, [{ id: base.id, campo: "tipo", valor: "planta" }]);
  const igual = base.altura === baseNueva.altura && base.tipo === baseNueva.tipo;
  const operaciones: Operacion[] = igual ? [] : [{ op: "cambiar", coleccion: "plantas", id: base.id, objeto: baseNueva as unknown as Objeto }];
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
