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

const dos = (n: number) => String(n).padStart(2, "0");

/** Fecha de un proyecto o una versión del navegador (AL): «hoy 18:25», «ayer 9:05» o «22/10/2026 18:25». */
export function fechaCorta(ms: number, ahora = Date.now()): string {
  const d = new Date(ms);
  const hora = `${d.getHours()}:${dos(d.getMinutes())}`;
  const dia = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const hoy = new Date(ahora);
  if (dia(d) === dia(hoy)) return `hoy ${hora}`;
  if (dia(d) === dia(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1))) return `ayer ${hora}`;
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${hora}`;
}

/** Tamaño de un texto (caracteres ≈ bytes): «12 kB», «1,4 MB». */
export const tamano = (n: number): string => (n < 1e6 ? `${fmt(Math.max(1, Math.round(n / 1e3)), 0)} kB` : `${fmt(n / 1e6, 1)} MB`);

/** Un código interno de la investigación o de una fase (C1-d, RV-a, H43, E5, D4, CY3, fase LV…). */
export const CODIGO_INTERNO = /^(?:fase\s+)?(?:[A-Z]{1,3}\d{0,2}-[a-z0-9]{1,2}|H\d{2}|E[1-7]|D[1-9]|CY\d|LV\d?|AU-\d+|SP-\d+)$/;

/** Lo de dentro de unos paréntesis es sólo una lista de códigos internos («C1-d», «H52, C2-a, G-4»). */
export const soloCodigos = (dentro: string): boolean => {
  const partes = dentro.split(/\s*[,;]\s*|\s+y\s+/).filter(Boolean);
  return partes.length > 0 && partes.every((x) => CODIGO_INTERNO.test(x));
};

/** Las órdenes de la CLI que tienen su sitio en la app. */
const ORDENES: [RegExp, string][] = [
  [/,? con «fem consultar pieza»/g, ", en Resultados · Diagramas"],
  [/«fem validar» los da todos/g, "Diagnósticos los da todos"],
  [/\s*\((?:de |con |en )?«fem [^»]*»\)/g, ""],
  [/,? (?:de|con|en) «fem [^»]*»/g, ""],
];

/**
 * Un texto que viene del motor, del compilador o de las vistas de la CLI, como se enseña en la app
 * (UI-43 y UI-44): sin los códigos internos entre paréntesis («(C1-d)», «(H52, C2-a, G-4)»), sin
 * las órdenes de la CLI, con «la tolerancia de unión» por ε_snap y con coma decimal. Para el agente
 * y en el informe esos códigos dicen de dónde sale cada hipótesis; al ingeniero en la app, no.
 */
export function textoApp(t: string): string {
  let r = t;
  for (const [a, b] of ORDENES) r = r.replace(a, b);
  r = r.replace(/\s*\(([^()]*)\)/g, (todo, dentro: string) => {
    if (soloCodigos(dentro)) return "";
    // «(D2; P1, P2)»: sólo el código del principio
    const m = /^([^;]+);\s*(.*)$/.exec(dentro);
    if (m && CODIGO_INTERNO.test(m[1]!.trim())) return todo.replace(dentro, m[2]!);
    return todo;
  });
  return r
    .replace(/ a ε_snap/g, " a menos de la tolerancia de unión")
    .replace(/ε_snap/g, "la tolerancia de unión")
    .replace(/recuperad([oa]s?) por SPR/g, "suavizad$1")
    .replace(/(\d)\.(\d)/g, "$1,$2");
}

/** Un texto con números en punto decimal (las combinaciones, «0.8·G + 1.5·Q»), con coma (UI-44). */
export const coma = (t: string): string => t.replace(/(\d)\.(\d)/g, "$1,$2");
