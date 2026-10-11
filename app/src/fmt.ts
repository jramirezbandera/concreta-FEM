/**
 * Números en pantalla: coma decimal, signo menos tipográfico y espacio fino de miles, como en los
 * prototipos. Lo que se formatea es siempre el valor de una consulta (criterio 1 de V1); el test de
 * DOM compara el texto con este formato del valor.
 */
const MENOS = "−";
const MILES = " ";

/** `v` con `dec` decimales. */
export function fmt(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : `${MENOS}∞`;
  const t = Math.abs(v).toFixed(dec);
  const [ent, frac] = t.split(".");
  const conMiles = ent!.length > 4 ? ent!.replace(/\B(?=(\d{3})+(?!\d))/g, MILES) : ent!;
  const cero = Number(t) === 0;
  return `${v < 0 && !cero ? MENOS : ""}${conMiles}${frac ? `,${frac}` : ""}`;
}

/** Fracción «1/n» de un cociente pequeño (desplomes, flechas relativas). */
export function fraccion(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (x <= 0) return "0";
  return `1/${fmt(Math.round(1 / x), 0)}`;
}

/** m → mm. */
export const mm = (m: number | null | undefined, dec = 2): string => (m === null || m === undefined ? "—" : fmt(m * 1000, dec));

/** Cota con signo: +18,00. */
export const cota = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${fmt(v, 2)}`);
