/**
 * Peso propio de los forjados aligerados (2026-10-28, a petición del usuario: «que el peso propio se
 * pusiera solo»). Por m² de planta, el hormigón de los nervios y la capa por su γ más el hueco entre
 * nervios por el peso aparente de lo que lo llena (el casetón o la bovedilla, con sus propios huecos):
 *
 *   pp = γ·V_hormigón + w·V_hueco
 *
 * - reticular (nervios iguales en las dos direcciones, intereje s, nervio bw, capa hf, canto h):
 *   V_hueco = (s − bw)²·(h − hf)/s², y V_hormigón = h − V_hueco (`volumenReticular`);
 * - unidireccional con una vigueta en T (alma bw, capa hf, canto h) cada s:
 *   V_hormigón = (s·hf + bw·(h − hf))/s y V_hueco = (s − bw)·(h − hf)/s. La capa cubre todo el
 *   intereje aunque el ala de la T sea otra.
 *
 * w es un peso específico aparente equivalente: kN por m³ del hueco geométrico entre nervios, no la
 * densidad del material de la pieza (que tiene sus propios huecos). Los de `PESO_CASETON` y
 * `PESO_BOVEDILLA` son estimaciones de predimensionamiento, no pesos certificados ni valores de
 * norma: con un reticular 25+5 a 80/12 de casetón de hormigón sale 4,3390625 kN/m², y con un
 * unidireccional 25+5 a 70 de bovedilla de hormigón, 3,564 kN/m².
 *
 * Lo que manda, de más a menos (sin sumar nunca dos; revisión del usuario del 2026-11-05):
 * 1. el `pp` escrito (un dato del sistema, de fabricante o del usuario), entero;
 * 2. el `relleno` dado: su peso aparente por el hueco, o el peso de sus piezas por m²;
 * 3. el estimado del casetón o la bovedilla.
 * Los ábacos de un reticular se modelan macizos (γ·canto): no se reparte ninguna «carga media».
 *
 * Modelo idealizado: nervios rectangulares iguales en las dos direcciones y capa continua. No es
 * la geometría de una pieza especial ni la de una vigueta pretensada: para eso, el `pp` del sistema.
 *
 * Puro: sin IO.
 */
import type { Losa, Material, PanoUnidireccional, Procedencia, Relleno, Seccion } from "./fisico.ts";
import { volumenReticular, type GeometriaReticular } from "./reticular.ts";
import { materialElastico } from "./secciones.ts";

/** Casetón de un reticular: "perdido" es el de un material sin decir (el pp es obligatorio, C4-i). */
export const CASETONES = ["hormigon", "ceramica", "poliestireno", "recuperable", "perdido"] as const;
export type Caseton = (typeof CASETONES)[number];
/** El casetón por defecto (2026-10-28; antes, "perdido"): el más común en obra. */
export const CASETON_POR_DEFECTO: Caseton = "hormigon";

/** Bovedilla de un unidireccional. */
export const BOVEDILLAS = ["hormigon", "ceramica", "poliestireno"] as const;
export type Bovedilla = (typeof BOVEDILLAS)[number];
export const BOVEDILLA_POR_DEFECTO: Bovedilla = "hormigon";

/**
 * Peso específico aparente equivalente del casetón, kN por m³ de hueco entre nervios ("perdido" no lo
 * tiene). Estimaciones de predimensionamiento, no de norma: se cambian con el `relleno` de la losa.
 * Aceptadas por el usuario el 2026-11-06 como tales (por pieza: el casetón de hormigón de un hueco de
 * 68 × 68 × 25 cm, ≈ 88 kg; una bovedilla de 60 × 25 × 20, ≈ 18 kg de hormigón y ≈ 10 de cerámica; el
 * poliestireno, ≈ 20 kg/m³), con el casetón de hormigón por contrastar con un catálogo.
 */
export const PESO_CASETON: Readonly<Record<Exclude<Caseton, "perdido">, number>> = { hormigon: 7.5, ceramica: 3.2, poliestireno: 0.2, recuperable: 0 };

/** Peso específico aparente equivalente de la bovedilla, kN por m³ de hueco entre viguetas. Estimaciones, como `PESO_CASETON`. */
export const PESO_BOVEDILLA: Readonly<Record<Bovedilla, number>> = { hormigon: 6, ceramica: 3.2, poliestireno: 0.2 };

/** De dónde sale el peso del relleno: el estimado del tipo, un peso aparente dado o el de sus piezas. */
export type MetodoRelleno = "estimado" | "aparente" | "piezas";

/** Cómo sale un pp: lo del hormigón y lo del hueco, por m² de planta. */
export interface DesglosePeso {
  /** Hormigón, m³/m². */
  hormigon: number;
  /** Peso específico del hormigón, kN/m³. */
  gamma: number;
  /** Hueco entre nervios o viguetas, m³/m². */
  hueco: number;
  /** Peso específico aparente equivalente de lo que llena el hueco, kN/m³ (con piezas, relleno/hueco). */
  pesoHueco: number;
  /** Peso del relleno, kN/m² de forjado. */
  relleno: number;
  metodo: MetodoRelleno;
  /** Con piezas: su peso (kg) y cuántas por m². */
  piezas?: { pesoPieza: number; piezasM2: number };
  procedencia?: Procedencia;
  /** γ·hormigón + relleno, kN/m². */
  pp: number;
}

/** De kg de una pieza a kN (g = 9,80665 m/s²). */
export const G_KN_POR_KG = 9.80665 / 1000;

/** El peso del relleno por m² de forjado, kN/m², de un `relleno` dado: con piezas, pesoPieza·piezasM2·g; si no, pesoAparente·hueco. */
export function pesoRelleno(r: Relleno, hueco: number): number {
  return r.pesoPieza !== undefined ? r.pesoPieza * (r.piezasM2 ?? 0) * G_KN_POR_KG : (r.pesoAparente ?? 0) * hueco;
}

function desglose(hormigon: number, gamma: number, hueco: number, estimado: number, relleno?: Relleno): DesglosePeso {
  const base = { hormigon, gamma, hueco };
  if (!relleno) return { ...base, pesoHueco: estimado, relleno: estimado * hueco, metodo: "estimado", pp: gamma * hormigon + estimado * hueco };
  const w = pesoRelleno(relleno, hueco);
  const piezas = relleno.pesoPieza !== undefined ? { pesoPieza: relleno.pesoPieza, piezasM2: relleno.piezasM2 ?? 0 } : undefined;
  return {
    ...base,
    pesoHueco: piezas ? (hueco > 0 ? w / hueco : 0) : (relleno.pesoAparente ?? 0),
    relleno: w,
    metodo: piezas ? "piezas" : "aparente",
    ...(piezas ? { piezas } : {}),
    ...(relleno.procedencia ? { procedencia: relleno.procedencia } : {}),
    pp: gamma * hormigon + w,
  };
}

/**
 * El pp de la zona aligerada de un reticular: con `relleno`, el suyo; si no, el estimado del casetón.
 * undefined con casetón "perdido" (material sin decir) sin `relleno`.
 */
export function pesoReticular(g: GeometriaReticular, gamma: number, caseton: Caseton = CASETON_POR_DEFECTO, relleno?: Relleno): DesglosePeso | undefined {
  if (caseton === "perdido" && !relleno) return undefined;
  const hormigon = volumenReticular(g);
  return desglose(hormigon, gamma, g.h - hormigon, caseton === "perdido" ? 0 : PESO_CASETON[caseton], relleno);
}

/** Lo que hace falta de la vigueta: una T. */
export interface ViguetaT {
  hf: number;
  bw: number;
  h: number;
}

/** El pp de un unidireccional con una vigueta en T cada `intereje`: con `relleno`, el suyo; si no, el estimado de la bovedilla. */
export function pesoUnidireccional(t: ViguetaT, intereje: number, gamma: number, bovedilla: Bovedilla = BOVEDILLA_POR_DEFECTO, relleno?: Relleno): DesglosePeso {
  const s = intereje;
  return desglose((s * t.hf + t.bw * (t.h - t.hf)) / s, gamma, ((s - t.bw) * (t.h - t.hf)) / s, PESO_BOVEDILLA[bovedilla], relleno);
}

/**
 * El peso medio de un reticular con ábacos, kN/m²: (1 − f)·pp aligerado + f·pp macizo, con f la
 * fracción maciza de su área. Sólo informativo: el cálculo pesa cada zona con lo suyo (los ábacos,
 * modelados), y repartir este medio contaría los ábacos dos veces.
 */
export function pesoMedioConMacizo(ppAligerado: number, ppMacizo: number, fraccionMaciza: number): number {
  return (1 - fraccionMaciza) * ppAligerado + fraccionMaciza * ppMacizo;
}

/** Si la geometría de la T vale para `pesoUnidireccional` (alma más estrecha que el intereje, capa más delgada que el canto). */
export const viguetaPesable = (t: ViguetaT, intereje: number): boolean => t.bw > 0 && t.hf > 0 && t.bw < intereje && t.hf < t.h;

// ─── Del modelo físico ──────────────────────────────────────────────────────────────────────────

/**
 * El pp de una losa en su zona maciza o aligerada y en sus ábacos (C4-i), con γ el peso específico
 * de su material: en una maciza, el `pp` escrito o γ·canto; en un reticular, el `pp` escrito o el de
 * su casetón en la zona aligerada, y γ·h en los ábacos (MA3). undefined si es un reticular con casetón "perdido" sin `pp`.
 */
export function ppLosa(l: Losa, gamma: number): { pp: number; ppAbaco: number } | undefined {
  const maciza = gamma * l.espesor;
  // MA3 (MA-b): en un reticular, el pp escrito es el de la zona aligerada; los ábacos, γ·h
  if (l.pp !== undefined) return { pp: l.pp, ppAbaco: l.reticular ? maciza : l.pp };
  if (!l.reticular) return { pp: maciza, ppAbaco: maciza };
  const r = l.reticular;
  const d = pesoReticular({ h: l.espesor, hf: r.capa, bw: r.nervio, s: r.intereje }, gamma, r.caseton, r.relleno);
  return d && { pp: d.pp, ppAbaco: maciza };
}

/** Cómo sale el pp de un paño sin `pp`: de su vigueta en T, con su material, y su bovedilla. undefined si no es una T que valga. */
export function desglosePano(p: PanoUnidireccional, s: Seccion | undefined, m: Material | undefined): DesglosePeso | undefined {
  if (!s || s.forma !== "T" || !m || !viguetaPesable(s, p.intereje)) return undefined;
  return pesoUnidireccional(s, p.intereje, materialElastico(m).peso, p.bovedilla, p.relleno);
}

/** El pp de un paño: el escrito o el de `desglosePano`. undefined si no hay ninguno. */
export function ppPano(p: PanoUnidireccional, s: Seccion | undefined, m: Material | undefined): number | undefined {
  return p.pp ?? desglosePano(p, s, m)?.pp;
}

// ─── Lo que manda, en palabras ──────────────────────────────────────────────────────────────────

const coma = (v: number, d = 3) => String(Number(v.toFixed(d))).replace(".", ",");
const ORIGEN: Record<Procedencia["origen"], string> = { estimado: "estimado", fabricante: "de fabricante", usuario: "del usuario" };

/** «de fabricante: Ficha X, 2025». */
export function textoProcedencia(p: Procedencia | undefined): string {
  return p ? `${ORIGEN[p.origen]}${p.fuente ? `: ${p.fuente}` : ""}` : "";
}

const NOMBRE_RELLENO: Record<string, string> = { hormigon: "de hormigón", ceramica: "cerámico", poliestireno: "de poliestireno", recuperable: "recuperable" };

/**
 * Cómo sale el pp de un forjado aligerado, en una frase (las hipótesis): lo escrito, con su
 * procedencia, o γ·hormigón más el relleno y de dónde sale.
 */
export function textoOrigenPp(o: { pp?: number; ppProcedencia?: Procedencia; tipo: "reticular" | "unidireccional"; caseton?: string }, d: DesglosePeso | undefined): string {
  if (o.pp !== undefined) return `escrito, ${coma(o.pp)} kN/m²${o.ppProcedencia ? ` (${textoProcedencia(o.ppProcedencia)})` : ""}${o.tipo === "reticular" ? ", en la zona aligerada" : ""}`;
  if (!d) return "sin peso propio";
  const pieza = o.tipo === "reticular" ? "casetón" : "bovedilla";
  const rel =
    d.metodo === "estimado"
      ? `${pieza} ${NOMBRE_RELLENO[o.caseton ?? "hormigon"] ?? o.caseton} estimado, ${coma(d.pesoHueco)} kN/m³ aparente equivalente (de predimensionamiento)`
      : d.metodo === "aparente"
        ? `relleno dado, ${coma(d.pesoHueco)} kN/m³ aparente equivalente${d.procedencia ? ` (${textoProcedencia(d.procedencia)})` : ""}`
        : `relleno dado por piezas, ${coma(d.piezas!.pesoPieza)} kg × ${coma(d.piezas!.piezasM2)} /m²${d.procedencia ? ` (${textoProcedencia(d.procedencia)})` : ""}`;
  return `calculado, ${coma(d.pp)} kN/m²: γ·hormigón ${coma(d.gamma)} × ${coma(d.hormigon, 4)} m³/m² + ${rel} = ${coma(d.relleno)} kN/m²`;
}
