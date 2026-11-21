/**
 * Fase CO2 (CO-h, `docs/fem3d/comprobaciones.md` §6): la torsión de una viga rectangular maciza de
 * hormigón, Código Estructural Anejo 19 §6.3 y §9.2.3 (los de la EN 1992-1-1).
 *
 * Código propio: Concreta no tiene módulo de torsión. Su oráculo, a mano, en `torsion.test.ts`.
 *
 * El modelo es la sección hueca eficaz de pared delgada (§6.3.2):
 *
 *   tef = A/u, y no menos que 2·c' (c', del paramento al eje de la armadura longitudinal)
 *   Ak = (b − tef)·(h − tef)        uk = 2·(b + h − 2·tef)
 *   TRd,máx = 2·ν·αcw·fcd·Ak·tef·sen θ·cos θ          (6.30), ν = 0,6·(1 − fck/250), αcw = 1
 *   TRd,c  = 2·Ak·tef·fctd                            (el torsor de fisuración, §6.3.2(5))
 *   cercos, por rama exterior:   Asw/s = TEd / (2·Ak·fywd·cot θ)
 *   longitudinal, en el perímetro: ΣAsl·fyd = TEd·uk·cot θ / (2·Ak)      (6.28)
 *
 * con el mismo ángulo de las bielas que el cortante (`COT_THETA_CORTANTE`, cot θ = 2, §6.3.2(2)).
 * Los materiales (fcd, fctm, fyd) salen de las tablas de Concreta, las del módulo de vigas: así la
 * interacción con el cortante usa los mismos números que su VRd,máx.
 *
 * Unidades: mm, MPa, kN y kN·m.
 */
import { COT_THETA_CORTANTE, GAMMA_C } from "../concreta/data/factors.ts";
import { getConcrete, getFyd } from "../concreta/data/materials.ts";
import { getBarArea } from "../concreta/data/rebar.ts";
import { detailingStatus, toStatus, type CheckRow } from "../concreta/lib/calculations/types.ts";
import { dec } from "../concreta/lib/units/format.ts";

export interface SeccionTorsion {
  /** mm */
  b: number;
  h: number;
  /** MPa */
  fck: number;
  fyk: number;
  /** Del paramento al eje de la armadura longitudinal, mm. */
  cPrima: number;
}

export interface TorsionRC {
  /** Espesor eficaz de la pared, mm. */
  tef: number;
  /** Área encerrada por la línea media de la pared, mm², y su perímetro, mm. */
  Ak: number;
  uk: number;
  /** Perímetro exterior de la sección, mm. */
  u: number;
  cotTheta: number;
  fyd: number;
  /** Agotamiento de las bielas y torsor de fisuración, kN·m. */
  TRdMax: number;
  TRdC: number;
}

/** Las propiedades a torsión de la sección; null si la pared eficaz no cabe (la sección es demasiado pequeña para su recubrimiento). */
export function torsionRC(s: SeccionTorsion): TorsionRC | null {
  const mat = getConcrete(s.fck);
  const A = s.b * s.h;
  const u = 2 * (s.b + s.h);
  const tef = Math.max(A / u, 2 * s.cPrima);
  if (!(tef < Math.min(s.b, s.h))) return null;
  const Ak = (s.b - tef) * (s.h - tef);
  const uk = 2 * (s.b + s.h - 2 * tef);
  const cotTheta = COT_THETA_CORTANTE;
  const nu = 0.6 * (1 - s.fck / 250);
  // sen θ·cos θ = cot θ / (1 + cot² θ)
  const TRdMax = (2 * nu * mat.fcd * Ak * tef * (cotTheta / (1 + cotTheta * cotTheta))) / 1e6;
  const fctd = (0.7 * mat.fctm) / GAMMA_C;
  const TRdC = (2 * Ak * tef * fctd) / 1e6;
  return { tef, Ak, uk, u, cotTheta, fyd: getFyd(s.fyk), TRdMax, TRdC };
}

/** Área de cerco por unidad de longitud que pide el torsor en cada rama exterior, mm²/mm. */
export function cercoTorsion(t: TorsionRC, TEd: number): number {
  return (TEd * 1e6) / (2 * t.Ak * t.fyd * t.cotTheta);
}

/** Fuerza de tracción longitudinal que pide el torsor en todo el perímetro, N (6.28). */
export function traccionTorsion(t: TorsionRC, TEd: number): number {
  return (TEd * 1e6 * t.uk * t.cotTheta) / (2 * t.Ak);
}

/** Lo de la sección que hace falta para comprobar la torsión con el cortante y la flexión de la misma demanda. */
export interface EstadoTorsion {
  /** kN·m y kN, en valor absoluto. */
  TEd: number;
  VEd: number;
  /** El momento de esa demanda, kN·m, en valor absoluto, y el resistente de su cara traccionada. */
  MEd: number;
  MRd: number;
  /** Del cortante de la misma sección (módulo de vigas), kN. */
  VRdMax: number;
  VRdC: number;
  /** Canto útil de la cara traccionada, mm. */
  d: number;
  /** Armadura de la cara traccionada y de la opuesta, mm². */
  AsTraccion: number;
  AsCompresion: number;
  /** Cercos: Ø, separación (mm) y ramas. */
  cercoDiametro: number;
  cercoSeparacion: number;
  ramas: number;
  /** Mayor separación entre barras longitudinales a lo largo del perímetro, mm. */
  separacionBarras: number;
}

export const SEPARACION_BARRAS_TORSION = 350;

/**
 * Las filas de la torsión de equilibrio de una sección con una demanda (TEd con su VEd y su MEd):
 *
 *  - `torsion-biela`: TEd/TRd,máx + VEd/VRd,máx ≤ 1 (6.29);
 *  - `torsion-cercos`: en cada rama exterior, lo del cortante (entre todas sus ramas) más lo del
 *    torsor, contra el área de una rama por unidad de longitud;
 *  - `torsion-longitudinal`: la tracción del torsor (6.28) se reparte a medias entre el cordón
 *    superior y el inferior (la viga no cuenta con barras en las caras para esto). En el traccionado se
 *    suma a la de la flexión, MEd/MRd + (F/2)/(As·fyd) ≤ 1; en el comprimido, (F/2)/(As'·fyd) ≤ 1, sin
 *    descontar la compresión de la flexión (§6.3.2(3) lo permite: del lado seguro);
 *  - `torsion-separacion`: los cercos, a no más de u/8 ni de la menor dimensión (§9.2.3(3));
 *  - `torsion-barras`: barras longitudinales a no más de 350 mm en el perímetro (§9.2.3(4)).
 */
export function filasTorsion(t: TorsionRC, s: SeccionTorsion, e: EstadoTorsion): CheckRow[] {
  const filas: CheckRow[] = [];
  const fila = (id: string, description: string, u: number, value: string, limit: string, article: string, regla = false): void => {
    filas.push({ id, description, value, limit, utilization: u, status: regla ? detailingStatus(u) : toStatus(u), article });
  };
  const biela = e.TEd / t.TRdMax + (e.VRdMax > 0 ? e.VEd / e.VRdMax : Infinity);
  fila("torsion-biela", "Torsion con cortante: TEd/TRd,max + VEd/VRd,max <= 1", biela, Number.isFinite(biela) ? dec(biela, 3) : "—", "≤ 1,0", "CE Anejo 19 §6.3.2(4)");

  const z = 0.9 * e.d;
  const pide = (e.VEd * 1000) / (e.ramas * z * t.fyd * t.cotTheta) + cercoTorsion(t, e.TEd);
  const hay = e.cercoSeparacion > 0 ? getBarArea(e.cercoDiametro) / e.cercoSeparacion : 0;
  fila("torsion-cercos", "Cercos a cortante y torsion, por rama exterior", hay > 0 ? pide / hay : Infinity, `${dec(pide * 1000, 0)} mm²/m`, `${dec(hay * 1000, 0)} mm²/m`, "CE Anejo 19 §6.3.2(2)");

  const F = traccionTorsion(t, e.TEd);
  const cordon = (As: number) => (As > 0 ? F / 2 / (As * t.fyd) : Infinity);
  const traccionado = (e.MRd > 0 ? e.MEd / e.MRd : Infinity) + cordon(e.AsTraccion);
  const comprimido = cordon(e.AsCompresion);
  const longitudinal = Math.max(traccionado, comprimido);
  fila(
    "torsion-longitudinal",
    "Armadura longitudinal a flexion y torsion",
    longitudinal,
    Number.isFinite(longitudinal) ? `${dec(longitudinal, 3)} (${traccionado >= comprimido ? "cordón traccionado" : "cordón comprimido"})` : "—",
    "≤ 1,0",
    "CE Anejo 19 §6.3.2(3)",
  );

  const sMax = Math.min(t.u / 8, s.b, s.h);
  fila("torsion-separacion", "Separacion de los cercos de torsion", e.cercoSeparacion / sMax, `s = ${dec(e.cercoSeparacion, 0)} mm`, `s,max = ${dec(sMax, 0)} mm`, "CE Anejo 19 §9.2.3(3)", true);
  fila("torsion-barras", "Separacion de las barras longitudinales en el perimetro", e.separacionBarras / SEPARACION_BARRAS_TORSION, `${dec(e.separacionBarras, 0)} mm`, `${SEPARACION_BARRAS_TORSION} mm`, "CE Anejo 19 §9.2.3(4)", true);
  return filas;
}

/**
 * La torsión de compatibilidad (§6.3.1(2)): no se comprueba en ELU. Una fila informativa con su
 * valor y la condición (6.31), TEd/TRd,c + VEd/VRd,c ≤ 1: si se cumple, la sección no fisura por
 * torsión y cortante; si no, la fisuración la controla la armadura mínima (cercos cerrados, §9.2).
 */
export function filaTorsionCompatibilidad(t: TorsionRC, TEd: number, VEd: number, VRdC: number): CheckRow {
  const c = TEd / t.TRdC + (VRdC > 0 ? VEd / VRdC : Infinity);
  return {
    id: "torsion-compatibilidad",
    description: "Torsion de compatibilidad (no se comprueba): TEd/TRd,c + VEd/VRd,c",
    value: `TEd = ${dec(TEd, 1)} kN·m; ${Number.isFinite(c) ? dec(c, 2) : "—"}`,
    limit: c <= 1 ? "≤ 1: sin fisurar" : "> 1: armadura mínima",
    utilization: 0,
    status: "neutral",
    neutral: true,
    article: "CE Anejo 19 §6.3.1(2) y §6.3.2(5)",
  };
}
