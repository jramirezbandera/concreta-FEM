// Shared check types for every calculation module (RC, steel, timber, geo).
//
// Status taxonomy
// ───────────────
//   ok / warn / fail  → utilization-driven verdicts.
//   neutral           → informational rows (e.g. "CLASE 1") with no bar.
//
// Display path
// ────────────
// A check row carries the value/limit twice when possible:
//   • valueNum + valueQty (and limitNum + limitQty) — SI numeric, converted
//     and formatted at render time via lib/units/format.formatQuantity().
//   • valueStr + limitStr — pre-formatted string fallback for cases that do
//     not fit a single Quantity (e.g. "∞", "3 barras", boolean flags,
//     dimensionless ratios). Renderers prefer the numeric path when both
//     fields are present.
//
// Both paths are optional so legacy rows that still carry the old
// `value`/`limit` strings keep working until the per-module sweep upgrades
// them. The renderer falls back to those string fields when nothing else
// is set.

import type { Quantity } from "../units/types.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "neutral";

export interface CheckRow {
  id: string;
  description: string;

  /** SI numeric value (preferred — converts and formats at render time). */
  valueNum?: number;
  /** Quantity for `valueNum`; required when `valueNum` is set. */
  valueQty?: Quantity;
  /** Pre-formatted fallback when the value is not a single Quantity. */
  valueStr?: string;

  /** SI numeric limit (preferred). */
  limitNum?: number;
  /** Quantity for `limitNum`; required when `limitNum` is set. */
  limitQty?: Quantity;
  /** Pre-formatted limit fallback. */
  limitStr?: string;

  /** Legacy pre-formatted value (kept until the sweep migrates each module). */
  value?: string;
  /** Legacy pre-formatted limit. */
  limit?: string;

  utilization: number;
  status: CheckStatus;
  article: string;

  /** Classification row — render with no utilization bar. */
  neutral?: boolean;
  /** Short tag rendered next to the description (e.g. 'CLASE 1'). */
  tag?: string;
}

/**
 * Utilization thresholds — single source of truth for the whole app.
 *
 *   util < WARN_UTIL          -> 'ok'   (cumple holgado, verde)
 *   WARN_UTIL <= util < 1.0   -> 'warn' (cumple al borde, ámbar; <5% de margen)
 *   util >= 1.0               -> 'fail' (incumple, rojo)
 *
 * WARN_UTIL was 0.8, but 80% de utilización es buen diseño, no un aviso: el
 * ámbar saltaba en casi todos los números y se leía como fallo. Subido a 0.95
 * para que el aviso solo aparezca cuando el margen es realmente escaso.
 * Tanto la clasificación por check (toStatus) como los veredictos/colores de
 * la UI, el PDF y los SVG derivan de esta constante.
 */
export const WARN_UTIL = 0.95;

export function toStatus(util: number): Exclude<CheckStatus, "neutral"> {
  if (util < WARN_UTIL) return "ok";
  if (util < 1.0) return "warn";
  return "fail";
}

/**
 * Reglas constructivas — cuantías mínimas y máximas, separaciones, diámetros,
 * número de barras, cantos y distancias mínimas: se cumplen o no. El caso
 * límite CUMPLE («no debe superar 300» → c/300 cumple) y no hay franja de
 * advertencia, que es de las comprobaciones de agotamiento (`toStatus`): una
 * separación al 96 % de la máxima no deja la pieza «casi agotada».
 *
 * `util` es valor/límite en las de máximo y límite/valor en las de mínimo,
 * así que ≤ 1 cumple en las dos. La tolerancia absorbe el redondeo de un
 * cociente que tendría que dar 1 exacto.
 */
export function detailingStatus(util: number): "ok" | "fail" {
  return util <= 1 + 1e-9 ? "ok" : "fail";
}

// Inverse RC bending solver — shared by retainingWall.ts and other modules.
// Returns As_req (mm²) to resist MEd_kNm in a rectangular section (b × d).
// Returns Infinity if the section is over-reinforced (m ≥ 0.5).
export function solveRCBending(
  MEd_kNm: number,
  b: number,    // mm
  d: number,    // mm
  fcd: number,  // MPa
  fyd: number,  // MPa
): number {
  if (MEd_kNm <= 0) return 0;
  const m = (MEd_kNm * 1e6) / (b * d * d * fcd);
  if (m >= 0.5) return Infinity;
  return (1 - Math.sqrt(1 - 2 * m)) * b * d * fcd / fyd;
}

export function makeCheck(
  id: string,
  description: string,
  demand: number,
  capacity: number,
  demandStr: string,
  capacityStr: string,
  article: string,
): CheckRow {
  const util = capacity > 0 ? demand / capacity : Infinity;
  return {
    id,
    description,
    value: demandStr,
    limit: capacityStr,
    utilization: util,
    status: toStatus(util),
    article,
  };
}

/**
 * Build a check row from SI numeric demand and capacity, pinned to a Quantity
 * so the renderer can format both values in the active unit system.
 */
export function makeCheckQty(
  id: string,
  description: string,
  demandSi: number,
  capacitySi: number,
  quantity: Quantity,
  article: string,
): CheckRow {
  const util = capacitySi > 0 ? demandSi / capacitySi : Infinity;
  return {
    id,
    description,
    valueNum: demandSi,
    valueQty: quantity,
    limitNum: capacitySi,
    limitQty: quantity,
    utilization: util,
    status: toStatus(util),
    article,
  };
}

/** `makeCheck` para una regla constructiva: cumple o no (`detailingStatus`). */
export function makeDetailingCheck(
  id: string,
  description: string,
  demand: number,
  capacity: number,
  demandStr: string,
  capacityStr: string,
  article: string,
): CheckRow {
  const row = makeCheck(id, description, demand, capacity, demandStr, capacityStr, article);
  return { ...row, status: detailingStatus(row.utilization) };
}

/** `makeCheckQty` para una regla constructiva: cumple o no (`detailingStatus`). */
export function makeDetailingCheckQty(
  id: string,
  description: string,
  demandSi: number,
  capacitySi: number,
  quantity: Quantity,
  article: string,
): CheckRow {
  const row = makeCheckQty(id, description, demandSi, capacitySi, quantity, article);
  return { ...row, status: detailingStatus(row.utilization) };
}

/** Informational check with no utilization bar (e.g. section classification). */
export function makeCheckNeutral(
  id: string,
  description: string,
  tag: string,
  article: string,
): CheckRow {
  return {
    id,
    description,
    value: "",
    limit: "",
    utilization: 0,
    status: "neutral",
    article,
    neutral: true,
    tag,
  };
}
