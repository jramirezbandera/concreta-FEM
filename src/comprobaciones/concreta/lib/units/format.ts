import type { Quantity, UnitSystem } from "./types.ts";
import { CATALOG } from "./catalog.ts";
import { toDisplay, fromDisplay } from "./convert.ts";

export function getUnitLabel(quantity: Quantity, system: UnitSystem): string {
  const spec = CATALOG[quantity];
  return system === "si" ? spec.siUnit : spec.tecnicoUnit;
}

export function getPrecision(quantity: Quantity, system: UnitSystem): number {
  const spec = CATALOG[quantity];
  return system === "si" ? spec.precisionSi : spec.precisionTecnico;
}

/**
 * La coma decimal, que es la que se escribe en español.
 *
 * `toFixed` da siempre el punto de JavaScript, y los lienzos y las tablas que
 * formatean por su cuenta (`dec` en components/canvas/paleta) llevan coma desde
 * el principio. El resultado era una fila de Cargas por planta con «5.00» en la
 * caja y «7,50» tres columnas más allá, los dos números de la misma cuenta.
 * Aquí se decide una vez y vale para pantalla, lienzos y PDF.
 *
 * El camino de vuelta ya la aceptaba: `parseQuantity` normaliza la coma antes
 * de leer, igual que `parseLocaleNumber` de InlineEdit.
 */
export function conComaDecimal(texto: string): string {
  return texto.replace(".", ",");
}

/**
 * Un número suelto con la coma española: lo que `toFixed` debería dar aquí.
 *
 * Para lo que NO es una magnitud del catálogo y por tanto no pasa por
 * `formatQuantity`: cotas en metros, esbelteces, coeficientes de seguridad,
 * ángulos, cocientes. Es la única forma de escribir un decimal en pantalla.
 *
 * NO vale para coordenadas de SVG (`x`, `d`, `points`): ahí el punto es
 * sintaxis y la coma rompe el dibujo.
 */
export function dec(valor: number, decimales: number): string {
  return conComaDecimal(valor.toFixed(decimales));
}

/**
 * Como `dec`, con al menos `minimo` decimales y los que hagan falta hasta
 * `maximo` para no esconder cifras: 5000 mm → «5,00» m, pero 3055 mm →
 * «3,055» m y no un «3,06» que no es lo que se calcula.
 */
export function decMinimo(valor: number, minimo: number, maximo: number): string {
  for (let d = minimo; d < maximo; d++) {
    if (Math.abs(Number(valor.toFixed(d)) - valor) < 10 ** -(maximo + 1)) return dec(valor, d);
  }
  return dec(valor, maximo);
}

export function formatQuantity(
  valueSi: number,
  quantity: Quantity,
  system: UnitSystem,
  options?: { precision?: number; withUnit?: boolean }
): string {
  if (!Number.isFinite(valueSi)) {
    if (Number.isNaN(valueSi)) return "—";
    return valueSi > 0 ? "∞" : "-∞";
  }
  const display = toDisplay(valueSi, quantity, system);
  const precision = options?.precision ?? getPrecision(quantity, system);
  const withUnit = options?.withUnit ?? true;
  const num = conComaDecimal(display.toFixed(precision));
  if (!withUnit) return num;
  return `${num} ${getUnitLabel(quantity, system)}`;
}

export function formatNumber(
  valueSi: number,
  quantity: Quantity,
  system: UnitSystem,
  precision?: number
): string {
  return formatQuantity(valueSi, quantity, system, {
    precision,
    withUnit: false,
  });
}

const PARSE_REJECT = /[eE]|[a-zA-Z]/;

export function parseQuantity(
  input: string,
  quantity: Quantity,
  system: UnitSystem,
  // La mayoría de campos (resistencias, módulos, dimensiones, acciones de
  // diseño) son no negativos y el teclado los rechaza aquí — invariante del
  // que dependen los motores (p. ej. steelColumns documenta este rechazo).
  // Solo los campos que representan una CARGA con dirección (Fx/Fy/w del FEM,
  // viento) piden signo explícitamente activando este flag.
  allowNegative = false
): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (PARSE_REJECT.test(trimmed)) return null;
  const normalized = trimmed.replace(",", ".");
  const display = Number(normalized);
  if (!Number.isFinite(display)) return null;
  if (!allowNegative && display < 0) return null;
  return fromDisplay(display, quantity, system);
}
