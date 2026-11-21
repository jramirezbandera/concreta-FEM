// CE Table 39.1 — Concrete properties
export interface ConcreteGrade {
  fck: number;   // MPa
  fcd: number;   // MPa (αcc·fck/γc, αcc=1.0, γc=1.5)
  fctm: number;  // MPa mean tensile strength
  Ecm: number;   // GPa  secant modulus
  /** Strain at parabola plateau (CE 21.3.3, ε_c2). Default 0.002 for fck≤50.
   *  HSC: 0.002 + 0.000085·(fck-50)^0.53. */
  eps_c2: number;
  /** Ultimate concrete strain (CE 21.3.3, ε_cu2). Default 0.0035 for fck≤50.
   *  HSC: 0.0026 + 0.035·((90-fck)/100)^4. */
  eps_cu: number;
  /** Parabola exponent (CE 21.3.3). Default 2 for fck≤50.
   *  HSC: 1.4 + 23.4·((90-fck)/100)^4. */
  n: number;
}

// fctm = 0.30 * fck^(2/3) for fck <= 50 MPa
// fctm = 2.12 * ln(1 + (fcm/10)) for fck > 50 MPa, fcm = fck + 8
// Ecm = 22000 * ((fck+8)/10)^0.3  MPa → stored as GPa
// CE 21.3.3 ε_c2/ε_cu/n for fck≤50: 0.002 / 0.0035 / 2
//
// Cotejado el 2026-09-25 contra las fórmulas y contra la Tabla 3.1 del Anejo 19 del
// CE (que redondea Ecm al GPa: 27 29 30 31 33 34 35 36 37). Toda la columna Ecm es la
// de la fórmula con un decimal, salvo C16, que traía el 29 redondeado de la tabla en
// vez del 28,6 de la fórmula: corregido para que la columna tenga una sola fuente.
const concrete: ConcreteGrade[] = [
  { fck: 12, fcd: 8.0,  fctm: 1.57, Ecm: 27.1, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 16, fcd: 10.7, fctm: 1.90, Ecm: 28.6, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 20, fcd: 13.3, fctm: 2.21, Ecm: 30.0, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 25, fcd: 16.7, fctm: 2.56, Ecm: 31.5, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 30, fcd: 20.0, fctm: 2.90, Ecm: 32.8, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 35, fcd: 23.3, fctm: 3.21, Ecm: 34.1, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 40, fcd: 26.7, fctm: 3.51, Ecm: 35.2, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 45, fcd: 30.0, fctm: 3.80, Ecm: 36.3, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
  { fck: 50, fcd: 33.3, fctm: 4.07, Ecm: 37.3, eps_c2: 0.002, eps_cu: 0.0035, n: 2 },
];

export const availableFck = concrete.map((c) => c.fck);

export function getConcrete(fck: number): ConcreteGrade {
  const found = concrete.find((c) => c.fck === fck);
  if (found) return found;
  // Interpolate for non-standard values
  const fctm = fck <= 50
    ? 0.3 * Math.pow(fck, 2 / 3)
    : 2.12 * Math.log(1 + (fck + 8) / 10);
  const Ecm = (22000 * Math.pow((fck + 8) / 10, 0.3)) / 1000; // GPa
  // CE 21.3.3 parábola constants: para fck > 50 cambian.
  const eps_c2  = fck <= 50 ? 0.002  : 0.002 + 0.000085 * Math.pow(Math.max(0, fck - 50), 0.53);
  const eps_cu  = fck <= 50 ? 0.0035 : 0.0026 + 0.035 * Math.pow(Math.max(0, 90 - fck) / 100, 4);
  const n       = fck <= 50 ? 2      : 1.4 + 23.4 * Math.pow(Math.max(0, 90 - fck) / 100, 4);
  return { fck, fcd: fck / 1.5, fctm, Ecm, eps_c2, eps_cu, n };
}

// Steel reinforcement
export const Es = 200000; // MPa (200 GPa)
export const availableFyk = [400, 500, 600];

export function getFyd(fyk: number): number {
  return fyk / 1.15;
}

/**
 * Strain de cálculo último del acero ε_ud para el "diagrama de pivotes" CE 21.3.4.
 * Conservativo: B500S → ε_uk = 0.05 (mínimo CE Art. 32.2). ε_ud = ε_uk · 0.9 / γs
 * pero el valor práctico ampliamente adoptado en diseño es ε_ud = 0.010 (1%)
 * para acero de ductilidad normal (B/SD500S sin etiqueta de alta ductilidad).
 *
 * Pivot A (tension-controlled): ε_s_tens = ε_ud → x ≤ x_lim.
 * Pivot B (compression-controlled): ε_top = -ε_cu → x > x_lim.
 * x_lim/d = ε_cu / (ε_cu + ε_ud), define la frontera entre ambos regímenes.
 */
export function getEpsUd(_fyk: number): number {
  return 0.010; // 10‰, B500S/SD500S default conservativo
}
