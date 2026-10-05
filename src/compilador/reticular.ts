/**
 * Forjado reticular (C4, D3, H46): rigidez y peso de la zona aligerada, a partir de la sección en
 * T de un nervio (ala bf = s, capa hf, alma bw, canto total h) con nervios iguales en las dos
 * direcciones. Los ábacos son macizos (multiplicador 1) y los resuelve el compilador.
 *
 * Los multiplicadores reproducen el emparrillado de nervios (el modelo de CYPECAD, H46) sobre la
 * lámina maciza de canto h (C4-h):
 * - flexión: E·I_T/s por unidad de ancho, sin acoplamiento de Poisson (un emparrillado no lo tiene),
 *   así que la zona aligerada lleva ν = 0: m11 = m22 = I_T/(s·h³/12);
 * - membrana: E·A_T/s; el cortante en su plano lo lleva la capa: f11 = f22 = A_T/(s·h) y
 *   f12 = (G_c/G₀)·hf/h;
 * - torsión, igualando la energía de un alabeo γ = 2·∂²w/∂x∂y: la capa como placa (G·hf³/12) más
 *   las almas de los nervios de las dos direcciones (2 · ½·G·J_w/s·(γ/2)²), con J_w la de
 *   Saint-Venant del rectángulo bw × (h − hf): m12 = (G_c/G₀)·(hf³ + 6·J_w/s)/h³;
 * - cortante transversal, el alma: v13 = v23 = (G_c/G₀)·bw/s.
 * G_c = E/(2(1 + ν)) es el del hormigón y G₀ = E/2 el de la lámina con ν = 0: el cociente
 * devuelve al cortante y a la torsión el G del material.
 *
 * Con ν = 0,2 en la lámina y m11 = I_T/I_maciza (lo habitual con multiplicadores en SAP2000), la
 * flexión saldría un 4 % más rígida (1/(1 − ν²)) y acoplada como en una losa. Si el usuario da sus
 * multiplicadores, se aplican así, sobre la maciza con el ν del material (S5 #21).
 */
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import { seccionT, torsionRectangulo } from "../secciones/seccion3D.ts";

/** Geometría de los nervios, en m: canto total h, capa hf, ancho del nervio bw e intereje s. */
export interface GeometriaReticular {
  h: number;
  hf: number;
  bw: number;
  s: number;
}

/** Área y momento de inercia de la T bruta de un nervio (bf = s), en m² y m⁴. */
export function seccionNervio(g: GeometriaReticular): { A: number; I: number } {
  const t = seccionT(g.s, g.hf, g.bw, g.h, { E: 1, G: 1 }).seccion;
  return { A: t.A, I: t.Iy };
}

/**
 * Multiplicadores de la zona aligerada sobre la maciza de canto h, para una lámina con ν = 0
 * (C4-h). `nu` es el coeficiente de Poisson del hormigón (el de su G).
 */
export function multiplicadoresReticular(g: GeometriaReticular, nu: number): Required<MultiplicadoresLamina> {
  const { A, I } = seccionNervio(g);
  const kG = 1 / (1 + nu);
  const Jw = torsionRectangulo(g.bw, g.h - g.hf);
  const f = A / (g.s * g.h);
  const m = (12 * I) / (g.s * g.h ** 3);
  const v = (kG * g.bw) / g.s;
  return { f11: f, f22: f, f12: (kG * g.hf) / g.h, m11: m, m22: m, m12: (kG * (g.hf ** 3 + (6 * Jw) / g.s)) / g.h ** 3, v13: v, v23: v };
}

/** Volumen de hormigón por m² de la zona aligerada con casetón recuperable, m³/m². */
export function volumenReticular(g: GeometriaReticular): number {
  const c = g.s - g.bw;
  return g.h - (c * c * (g.h - g.hf)) / (g.s * g.s);
}
