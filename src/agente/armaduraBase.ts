/**
 * Armadura base de las losas (fase AB, `docs/fem3d/armado.md` §2.5): el momento que cubre la
 * armadura base de cada losa y armadura (kN·m/m), que el ingeniero da para ver sólo lo que queda por
 * encima (las zonas de refuerzo). Va en el `proyecto.json` fuera del modelo, como las vistas: no entra
 * en la huella ni en el cálculo.
 *
 * La base de una losa y una armadura es la de la losa si la tiene; si no, la común; si no, no hay.
 *
 * Puro: sin IO.
 */
import type { ModeloFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";

/** Las cuatro armaduras de una losa: X (su dirección 1) o Y (la 2), inferior o superior. */
export const ARMADURAS = ["x-inf", "x-sup", "y-inf", "y-sup"] as const;
export type Armadura = (typeof ARMADURAS)[number];

/** El momento que cubre la armadura base de cada armadura, kN·m/m (≥ 0). La que no se da, no hay. */
export interface BasesArmado {
  "x-inf"?: number;
  "x-sup"?: number;
  "y-inf"?: number;
  "y-sup"?: number;
}

/** AB: la armadura base de las losas (kN·m/m). No entra en la huella ni en el cálculo. */
export interface ArmadoProyecto {
  /** La base común a todas las losas, por armadura. */
  base?: BasesArmado;
  /** Por losa (su id), lo que difiere de la común. */
  losas?: Record<string, BasesArmado>;
}

/** La base de una losa en una armadura (kN·m/m), o null si no hay. */
export function baseDe(a: ArmadoProyecto | undefined, losa: string, armadura: Armadura): number | null {
  return a?.losas?.[losa]?.[armadura] ?? a?.base?.[armadura] ?? null;
}

/** ¿Hay alguna base en esta armadura (común o de alguna losa)? */
export const hayBase = (a: ArmadoProyecto | undefined, armadura: Armadura): boolean => a?.base?.[armadura] !== undefined || Object.values(a?.losas ?? {}).some((b) => b[armadura] !== undefined);

/**
 * Lo que el esquema no ve: los valores, finitos y ≥ 0, y cada losa, una del modelo (las losas del
 * modelo son las macizas y las reticulares: las que tienen franjas).
 */
export function comprobarArmado(a: ArmadoProyecto | undefined, m: ModeloFisico): Diagnostico[] {
  if (!a) return [];
  const r: Diagnostico[] = [];
  const losas = new Set((m.losas ?? []).map((l) => l.id));
  const valores = (b: BasesArmado, donde: string, ids: string[]) => {
    for (const k of ARMADURAS) {
      const v = b[k];
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) r.push({ codigo: "armado/base", severidad: "error", mensaje: `La armadura base ${k} de ${donde} tiene que ser un número ≥ 0 (kN·m/m), y es ${String(v)}.`, ...(ids.length ? { ids } : {}), detalles: { armadura: k } });
    }
  };
  if (a.base) valores(a.base, "todas las losas", []);
  for (const [id, b] of Object.entries(a.losas ?? {})) {
    if (!losas.has(id)) r.push({ codigo: "armado/losa", severidad: "error", mensaje: `La armadura base es de «${id}», que no es una losa del modelo (las franjas son de las losas macizas y reticulares).`, ids: [id] });
    else valores(b, `la losa ${id}`, [id]);
  }
  return r;
}

/** El bloque sin lo vacío (una losa sin valores, un bloque sin nada): undefined si no queda nada. */
export function limpiarArmado(a: ArmadoProyecto | undefined): ArmadoProyecto | undefined {
  if (!a) return undefined;
  const limpio = (b: BasesArmado | undefined): BasesArmado | undefined => {
    if (!b) return undefined;
    // Una clave que no es una armadura se queda, para que la rechace el esquema
    const c: Record<string, number> = {};
    for (const [k, v] of Object.entries(b)) if (v !== undefined) c[k] = v;
    return Object.keys(c).length ? c : undefined;
  };
  const base = limpio(a.base);
  const losas: Record<string, BasesArmado> = {};
  for (const id of Object.keys(a.losas ?? {}).sort()) {
    const b = limpio(a.losas![id]);
    if (b) losas[id] = b;
  }
  const r: ArmadoProyecto = { ...(base ? { base } : {}), ...(Object.keys(losas).length ? { losas } : {}) };
  return Object.keys(r).length ? r : undefined;
}

/**
 * El bloque tras una operación del editor que cambia el modelo de `antes` a `despues`: las losas
 * renombradas (`viejo → nuevo`) con su nuevo id, y sin las que se borraron. Lo que ya no era una losa
 * antes se queda como está (lo dice `comprobarArmado`; no se pierde en silencio).
 */
export function seguirLosas(a: ArmadoProyecto | undefined, renombres: ReadonlyMap<string, string>, antes: ModeloFisico, despues: ModeloFisico): ArmadoProyecto | undefined {
  if (!a?.losas) return a;
  const eran = new Set((antes.losas ?? []).map((l) => l.id));
  const son = new Set((despues.losas ?? []).map((l) => l.id));
  const losas: Record<string, BasesArmado> = {};
  for (const [id, b] of Object.entries(a.losas)) {
    const n = renombres.get(id) ?? id;
    if (eran.has(id) && !son.has(n)) continue;
    losas[n] = b;
  }
  return limpiarArmado({ ...a, losas });
}
