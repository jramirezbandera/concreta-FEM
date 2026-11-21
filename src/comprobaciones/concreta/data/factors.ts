// CE partial safety factors and material coefficients
export const GAMMA_C = 1.5;   // concrete
export const GAMMA_S = 1.15;  // steel reinforcement
export const GAMMA_M0 = 1.05; // steel sections
export const GAMMA_M1 = 1.05; // steel sections (stability)
export const ALPHA_CC = 1.0;  // long-term concrete strength coefficient (CE Anejo 19 §3.1.6)

/**
 * Inclinación de las bielas del cortante con armadura transversal: el CE
 * limita 0,5 ≤ cot θ ≤ 2 (Anejo 19 §6.2.3(2), expresión 6.7, BOE 10-08-2021
 * pág. 98362). El 2,5 es el valor recomendado del EC2, que el CE no adopta;
 * hasta la auditoría de 2026-11 se usaba aquí y sobrestimaba VRd,s un 25 %.
 * Única fuente para VRd,s, VRd,max, el decalaje a_l = z·cot θ/2 y el lienzo.
 */
export const COT_THETA_CORTANTE = 2.0;

// Derived design values helper
export const fcd = (fck: number) => (ALPHA_CC * fck) / GAMMA_C;
export const fyd = (fyk: number) => fyk / GAMMA_S;

// Límite de abertura de fisura wk por clase de exposición
// (CE Anejo 19 Tabla 7.1N / EC2 Tabla 7.1N, combinación cuasipermanente).
// XC2-XC4 → 0.3 mm; el 0.2 corresponde a clases con cloruros (XD/XS).
export const wkMax: Record<string, number> = {
  XC1: 0.4,
  XC2: 0.3,
  XC3: 0.3,
  XC4: 0.3,
};
