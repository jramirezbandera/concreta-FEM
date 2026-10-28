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
 * Los pesos aparentes (`PESO_CASETON`, `PESO_BOVEDILLA`) son estimaciones de catálogo: con un
 * reticular 25+5 a 80/12 de casetón de hormigón sale 4,3 kN/m², y con un unidireccional 25+5 a 70
 * de bovedilla de hormigón, 3,6. Un `pp` escrito manda siempre.
 *
 * Puro: sin IO.
 */
import type { Losa, Material, PanoUnidireccional, Seccion } from "./fisico.ts";
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

/** Peso aparente del casetón por m³ de hueco entre nervios, kN/m³ ("perdido" no lo tiene). */
export const PESO_CASETON: Readonly<Record<Exclude<Caseton, "perdido">, number>> = { hormigon: 7.5, ceramica: 3.2, poliestireno: 0.2, recuperable: 0 };

/** Peso aparente de la bovedilla por m³ de hueco entre viguetas, kN/m³. */
export const PESO_BOVEDILLA: Readonly<Record<Bovedilla, number>> = { hormigon: 6, ceramica: 3.2, poliestireno: 0.2 };

/** Cómo sale un pp: lo del hormigón y lo del hueco, por m² de planta. */
export interface DesglosePeso {
  /** Hormigón, m³/m². */
  hormigon: number;
  /** Peso específico del hormigón, kN/m³. */
  gamma: number;
  /** Hueco entre nervios o viguetas, m³/m². */
  hueco: number;
  /** Peso aparente de lo que llena el hueco, kN/m³. */
  pesoHueco: number;
  /** γ·hormigón + pesoHueco·hueco, kN/m². */
  pp: number;
}

const desglose = (hormigon: number, gamma: number, hueco: number, pesoHueco: number): DesglosePeso => ({ hormigon, gamma, hueco, pesoHueco, pp: gamma * hormigon + pesoHueco * hueco });

/** El pp de la zona aligerada de un reticular, o undefined con casetón "perdido" (material sin decir). */
export function pesoReticular(g: GeometriaReticular, gamma: number, caseton: Caseton = CASETON_POR_DEFECTO): DesglosePeso | undefined {
  if (caseton === "perdido") return undefined;
  const hormigon = volumenReticular(g);
  return desglose(hormigon, gamma, g.h - hormigon, PESO_CASETON[caseton]);
}

/** Lo que hace falta de la vigueta: una T. */
export interface ViguetaT {
  hf: number;
  bw: number;
  h: number;
}

/** El pp de un unidireccional con una vigueta en T cada `intereje`. */
export function pesoUnidireccional(t: ViguetaT, intereje: number, gamma: number, bovedilla: Bovedilla = BOVEDILLA_POR_DEFECTO): DesglosePeso {
  const s = intereje;
  return desglose((s * t.hf + t.bw * (t.h - t.hf)) / s, gamma, ((s - t.bw) * (t.h - t.hf)) / s, PESO_BOVEDILLA[bovedilla]);
}

/** Si la geometría de la T vale para `pesoUnidireccional` (alma más estrecha que el intereje, capa más delgada que el canto). */
export const viguetaPesable = (t: ViguetaT, intereje: number): boolean => t.bw > 0 && t.hf > 0 && t.bw < intereje && t.hf < t.h;

// ─── Del modelo físico ──────────────────────────────────────────────────────────────────────────

/**
 * El pp de una losa en su zona maciza o aligerada y en sus ábacos (C4-i), con γ el peso específico
 * de su material: el `pp` escrito (en las dos), γ·canto en una maciza y, en un reticular, el de su
 * casetón (y γ·h en los ábacos). undefined si es un reticular con casetón "perdido" sin `pp`.
 */
export function ppLosa(l: Losa, gamma: number): { pp: number; ppAbaco: number } | undefined {
  if (l.pp !== undefined) return { pp: l.pp, ppAbaco: l.pp };
  const maciza = gamma * l.espesor;
  if (!l.reticular) return { pp: maciza, ppAbaco: maciza };
  const r = l.reticular;
  const d = pesoReticular({ h: l.espesor, hf: r.capa, bw: r.nervio, s: r.intereje }, gamma, r.caseton);
  return d && { pp: d.pp, ppAbaco: maciza };
}

/** Cómo sale el pp de un paño sin `pp`: de su vigueta en T, con su material, y su bovedilla. undefined si no es una T que valga. */
export function desglosePano(p: PanoUnidireccional, s: Seccion | undefined, m: Material | undefined): DesglosePeso | undefined {
  if (!s || s.forma !== "T" || !m || !viguetaPesable(s, p.intereje)) return undefined;
  return pesoUnidireccional(s, p.intereje, materialElastico(m).peso, p.bovedilla);
}

/** El pp de un paño: el escrito o el de `desglosePano`. undefined si no hay ninguno. */
export function ppPano(p: PanoUnidireccional, s: Seccion | undefined, m: Material | undefined): number | undefined {
  return p.pp ?? desglosePano(p, s, m)?.pp;
}
