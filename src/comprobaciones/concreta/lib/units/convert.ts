import type { Quantity, UnitSystem } from "./types.ts";
import { CATALOG } from "./catalog.ts";

export function toDisplay(
  valueSi: number,
  quantity: Quantity,
  system: UnitSystem
): number {
  const spec = CATALOG[quantity];
  if (system === "si") return valueSi * (spec.toSi ?? 1);
  return valueSi * spec.toTecnico;
}

export function fromDisplay(
  displayValue: number,
  quantity: Quantity,
  system: UnitSystem
): number {
  const spec = CATALOG[quantity];
  if (system === "si") return displayValue / (spec.toSi ?? 1);
  return displayValue / spec.toTecnico;
}
