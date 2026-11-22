// Isolated footing — sigma_adm input + stress distribution classification
//
// Loads: single set {N, Mx, My, H} + global toggle mayoradas/sin_mayorar + γ.
//   SLS  → bearing & distribution
//   ELU  → overturning, sliding, armado
//
// Posición del pilar (`tipo`): centrada, medianera (pilar enrasado con el
// lindero x = −B/2) o de esquina (enrasado con x = −B/2 e y = −L/2). En cada
// dirección excéntrica puede haber una VIGA CENTRADORA hacia el pilar interior,
// a la luz ℓ entre ejes. Con viga, la zapata trabaja centrada en esa dirección y
// la viga se lleva la excentricidad N·e y el momento del pilar; sin viga, la
// excentricidad la absorbe el terreno. Equilibrio del sistema (T. Cabrera, UPM,
// «La zapata de medianería», con R = reacción de las cargas, sin peso propio):
//   R·(1 − Σ e/ℓ) = N − Σ M/ℓ        ΔN = (R·e − M)/ℓ  (descarga al pilar interior)
//   medianera:  R = (N·ℓ − My)/(ℓ − e)        esquina con dos vigas: R = N/(1 − ex/ℓx − ey/ℓy)
//
// Distribution classification (per ex/B/6, ey/L/6):
//   trapezoidal           : ex ≤ B/6 AND ey ≤ L/6  (closed form)
//   bitriangular_uniaxial : exactly one excentr beyond core  (closed form Meyerhof)
//   bitriangular_biaxial  : both beyond core         (Newton-Raphson)
//   overturning_fail      : ex ≥ B/2 OR ey ≥ L/2 OR NR diverges
//
// Armado gating (CE Anejo 19 §6.5):
//   rigid    (v_max ≤ 2h) → strut-tie active, bending/shear/punching neutral
//   flexible (v_max > 2h) → strut-tie neutral, bending/shear/punching active
//
// Despegue → armadura superior: donde el terreno no apoya, la zapata cuelga
// con su peso y el de las tierras de encima y tracciona la cara de arriba.

import { type IsolatedFootingInputs, type PunchingPosition, type TipoZapata } from '../../data/defaults.ts';
import { getConcrete } from '../../data/materials.ts';
import { asMinRectangular } from './cuantiaMinima.ts';
import { getBarArea } from '../../data/rebar.ts';
import { betaForPosition } from './punching.ts';
import { type CheckRow, detailingStatus, makeCheck, makeCheckQty, makeCheckNeutral, makeDetailingCheck, toStatus } from './types.ts';
import { dec } from '../units/format.ts';

export type { CheckRow } from './types.ts';

export type DistributionType =
  | 'trapezoidal'
  | 'bitriangular_uniaxial'
  | 'bitriangular_biaxial'
  | 'overturning_fail';

/** Esfuerzos de una viga centradora (los de cálculo, para armarla en su módulo). */
export interface VigaCentradoraResult {
  /** m — excentricidad e: del eje del pilar al c.d.g. de la zapata. */
  e: number;
  /** m — luz ℓ entre ejes de pilares. */
  luz: number;
  /** kN — descarga al pilar interior en servicio, ΔN = (R·e − M)/ℓ con N completo. */
  dN_sls: number;
  /** kN — cortante de cálculo de la viga (constante entre zapatas) = ΔN en ELU. */
  Vd: number;
  /** kNm — flector de cálculo en la cara interior de la zapata, Vd·(ℓ − (B − bc/2)). */
  Md: number;
  /** m — distancia del eje del pilar a la cara interior de la zapata. */
  dCara: number;
  /** Cara traccionada de la viga: arriba si la viga tira del pilar interior (ΔN > 0). */
  traccion: 'superior' | 'inferior';
}

export interface IsolatedFootingResult {
  valid: boolean;
  error?: string;

  // ── Posición del pilar ──
  tipo: TipoZapata;
  /** m — eje del pilar respecto al c.d.g. de la zapata (≤ 0 en las direcciones excéntricas). */
  cx_pilar: number; cy_pilar: number;
  punchingPosition: PunchingPosition;

  // ── Cargas derivadas ──
  N_sls: number; Mx_sls: number; My_sls: number; H_sls: number;
  N_elu: number; Mx_elu: number; My_elu: number; H_elu: number;
  /** kN — reacción del terreno debida a las cargas (sin peso propio). = N sin vigas. */
  R_sls: number; R_elu: number;

  // ── Vigas centradoras ──
  vigaX: VigaCentradoraResult | null;
  vigaY: VigaCentradoraResult | null;

  // ── Excentricidad SLS ──
  ex_sls: number; ey_sls: number;
  /** m — posición CON SIGNO de la resultante respecto al c.d.g. (servicio, con peso propio). */
  exR_sls: number; eyR_sls: number;
  ex_over_B6: number;
  ey_over_L6: number;

  // ── Distribución ──
  distributionType: DistributionType;
  sigma_max: number;
  sigma_min: number;
  loaded_area_fraction: number;
  /** Ley lineal de servicio σ(x, y) = a + bx·x + by·y (kPa, m desde el c.d.g.,
   *  +y hacia el lindero opuesto), recortada a σ ≥ 0. Es la que da σmax: el
   *  lienzo la necesita para dibujar el corte A-A y la zona apoyada en planta,
   *  que con excentricidad en y o biaxial no se deducen de `loaded_area_fraction`
   *  (es una fracción de ÁREA, no una longitud). null en vuelco. */
  planoSls: PlanoPresiones | null;
  /** kPa — presión total bruta media sobre el área equivalente B*·L* (CTE
   *  DB-SE-C 4.3.1.3, ec. 4.4). Es la que se compara con σadm. ∞ en vuelco. */
  qb: number;
  /** m — lados del cimiento equivalente: B − 2·eB, o el lado real si e < lado/20. */
  B_eq: number; L_eq: number;
  /** Dirección en la que se ha supuesto H para la presión del terreno (la peor). */
  H_dir: 'x' | 'y' | null;
  bearing_check: { utilization: number; status: 'ok' | 'warn' | 'fail' };

  // ── Estabilidad ──
  W_footing: number; W_soil: number;
  M_stab_x: number; M_dest_x: number; FS_overturn_x: number;
  M_stab_y: number; M_dest_y: number; FS_overturn_y: number;
  Rd_slide: number; FS_sliding: number;

  // ── ELU armado ──
  sigma_Ed_uniform: number;
  /** m — resultante ELU (sin peso propio) respecto al c.d.g., CON SIGNO: centra el bloque de Meyerhof. */
  exE_elu: number; eyE_elu: number;
  /** ¿Vuelan como ménsula las barras de cada dirección? No las paralelas a la única viga centradora. */
  mensulaX: boolean; mensulaY: boolean;
  d_x: number; d_y: number;
  isRigid: boolean; v_max: number;

  // ── Cantilevers / spans (mm) ──
  /** mm — el mayor vuelo en cada dirección (en medianera, el único). */
  ax: number; ay: number;
  /** mm — vuelos a cada lado del pilar: −x, +x, −y, +y. */
  vuelos: { xNeg: number; xPos: number; yNeg: number; yPos: number };
  ell_x: number; ell_y: number;

  // ── Bending / strut-tie ──
  MEd_x: number; MEd_y: number;
  Td_x: number; Td_y: number;
  As_req_x: number; As_req_y: number;
  As_min_x: number; As_min_y: number;
  As_adopted_x: number; As_adopted_y: number;
  As_prov_x: number; As_prov_y: number;

  // ── Armadura superior (despegue) ──
  /** kNm/m — flector que tracciona la cara superior (0 si no hay despegue). */
  MEd_sup_x: number; MEd_sup_y: number;
  necesitaSup_x: boolean; necesitaSup_y: boolean;
  /** kNm/m — lo que la cara superior aguanta SIN armar: fct,d·(0,85·h)²/6. */
  M_fis_sup: number;
  As_sup_adopted_x: number; As_sup_adopted_y: number;
  As_prov_sup_x: number; As_prov_sup_y: number;

  // ── Shear ──
  VEd_x: number; VEd_y: number;
  VRd_x: number; VRd_y: number;

  // ── Punching ──
  d_avg: number;
  /** mm — perímetro a 2d del pilar (referencia). */
  u1: number;
  /** mm — distancia del pilar al perímetro crítico (≤ 2d) y su longitud. */
  a_punch: number; u_punch: number;
  /** MPa — en el perímetro crítico: tensión, resistencia base y resistencia ·2d/a. */
  vEd_punch: number; vRdc_punch: number; vRd_punch: number;

  checks: CheckRow[];
}

const GAMMA_C_RC = 25;       // kN/m³ — reinforced concrete unit weight
const GAMMA_G_DESF = 1.35;   // peso propio desfavorable (cuelga en la zona despegada)
const FS_VUELCO_MIN = 2.0;   // CTE DB-SE-C tabla 2.1 (vuelco): 1,8/0,9 sobre características
const FS_SLIDE_MIN = 1.5;    // CTE DB-SE-C tabla 2.1 (deslizamiento): γR = 1,5 con γF = 1
/** CE Anejo 19 §9.8.2.1(1): diámetro mínimo de la armadura principal de una zapata. */
const PHI_MIN_ZAPATA = 12;
const NR_MAX_ITER = 50;
const NR_TOL = 1e-7;         // dimensionless residuals (/N) tolerance
/** kNm/m — por debajo no se rotula la tracción superior (ruido del muestreo). */
const M_SUP_MIN = 0.5;
/** CE Anejo 19 §12.3.1: αct,pl del hormigón en masa (valor recomendado). */
const ALPHA_CT_PL = 0.8;

const EMPTY: IsolatedFootingResult = {
  valid: false,
  tipo: 'centrada', cx_pilar: 0, cy_pilar: 0, punchingPosition: 'interior',
  N_sls: 0, Mx_sls: 0, My_sls: 0, H_sls: 0,
  N_elu: 0, Mx_elu: 0, My_elu: 0, H_elu: 0,
  R_sls: 0, R_elu: 0,
  vigaX: null, vigaY: null,
  ex_sls: 0, ey_sls: 0, exR_sls: 0, eyR_sls: 0, ex_over_B6: 0, ey_over_L6: 0,
  distributionType: 'trapezoidal',
  sigma_max: 0, sigma_min: 0, loaded_area_fraction: 0, planoSls: null,
  qb: 0, B_eq: 0, L_eq: 0, H_dir: null,
  bearing_check: { utilization: 0, status: 'ok' },
  W_footing: 0, W_soil: 0,
  M_stab_x: 0, M_dest_x: 0, FS_overturn_x: 0,
  M_stab_y: 0, M_dest_y: 0, FS_overturn_y: 0,
  Rd_slide: 0, FS_sliding: 0,
  sigma_Ed_uniform: 0, exE_elu: 0, eyE_elu: 0, mensulaX: true, mensulaY: true,
  d_x: 0, d_y: 0, isRigid: false, v_max: 0,
  ax: 0, ay: 0, vuelos: { xNeg: 0, xPos: 0, yNeg: 0, yPos: 0 }, ell_x: 0, ell_y: 0,
  MEd_x: 0, MEd_y: 0, Td_x: 0, Td_y: 0,
  As_req_x: 0, As_req_y: 0, As_min_x: 0, As_min_y: 0,
  As_adopted_x: 0, As_adopted_y: 0, As_prov_x: 0, As_prov_y: 0,
  MEd_sup_x: 0, MEd_sup_y: 0, necesitaSup_x: false, necesitaSup_y: false, M_fis_sup: 0,
  As_sup_adopted_x: 0, As_sup_adopted_y: 0, As_prov_sup_x: 0, As_prov_sup_y: 0,
  VEd_x: 0, VEd_y: 0, VRd_x: 0, VRd_y: 0,
  d_avg: 0, u1: 0, a_punch: 0, u_punch: 0, vEd_punch: 0, vRdc_punch: 0, vRd_punch: 0,
  checks: [],
};

function invalid(msg: string): IsolatedFootingResult {
  return { ...EMPTY, error: msg };
}

// ── Derive SLS / ELU loads from single input set + toggle ────────────────────
function deriveLoads(inp: IsolatedFootingInputs) {
  const f = inp.loadFactor;
  const factored = inp.loadsAreFactored;
  if (factored) {
    return {
      N_sls: inp.N / f, Mx_sls: inp.Mx / f, My_sls: inp.My / f, H_sls: inp.H / f,
      N_elu: inp.N,     Mx_elu: inp.Mx,     My_elu: inp.My,     H_elu: inp.H,
    };
  }
  return {
    N_sls: inp.N,     Mx_sls: inp.Mx,     My_sls: inp.My,     H_sls: inp.H,
    N_elu: inp.N * f, Mx_elu: inp.Mx * f, My_elu: inp.My * f, H_elu: inp.H * f,
  };
}

// ── Posición del pilar y vigas activas ───────────────────────────────────────

/** Eje del pilar respecto al c.d.g. de la zapata (m). Enrasado con el lindero. */
export function posicionPilar(inp: Pick<IsolatedFootingInputs, 'tipo' | 'B' | 'L' | 'bc' | 'hc'>): { cx: number; cy: number } {
  const tipo = inp.tipo ?? 'centrada';
  const cx = tipo === 'centrada' ? 0 : -(inp.B - inp.bc) / 2;
  const cy = tipo === 'esquina' ? -(inp.L - inp.hc) / 2 : 0;
  return { cx, cy };
}

/** Las vigas que cuentan: x en medianera y esquina, y sólo en esquina. */
export function vigasActivas(inp: Pick<IsolatedFootingInputs, 'tipo' | 'vigaX' | 'vigaY'>): { x: boolean; y: boolean } {
  const tipo = inp.tipo ?? 'centrada';
  return {
    x: tipo !== 'centrada' && !!inp.vigaX,
    y: tipo === 'esquina' && !!inp.vigaY,
  };
}

/**
 * Equilibrio de la zapata con sus vigas centradoras para un juego de cargas.
 * Devuelve la reacción del terreno debida a las cargas (R, sin peso propio),
 * las descargas a los pilares interiores y los momentos respecto al c.d.g. que
 * recibe el terreno (Mx_c → excentricidad en y, My_c → en x; 0 donde hay viga).
 * Convenio de signos: My > 0 comprime el lado +x (el interior en medianera).
 */
function equilibrio(
  N: number, Mx: number, My: number,
  cx: number, cy: number,
  vx: boolean, vy: boolean, luzX: number, luzY: number,
) {
  const ex0 = -cx;   // ≥ 0: del pilar al c.d.g., hacia el interior
  const ey0 = -cy;
  const den = 1 - (vx ? ex0 / luzX : 0) - (vy ? ey0 / luzY : 0);
  const R = (N - (vx ? My / luzX : 0) - (vy ? Mx / luzY : 0)) / den;
  const dNx = vx ? (R * ex0 - My) / luzX : 0;
  const dNy = vy ? (R * ey0 - Mx) / luzY : 0;
  // Momento respecto al c.d.g. que llega al terreno en las direcciones sin viga:
  // la viga de la OTRA dirección pasa por la línea del pilar, así que su fuerza
  // tiene el mismo brazo que N (de ahí R·c y no N·c).
  const My_c = vx ? 0 : R * cx + My;
  const Mx_c = vy ? 0 : R * cy + Mx;
  return { R, dNx, dNy, My_c, Mx_c, den };
}

// ── Classify distribution from ex, ey vs núcleo central ─────────────────────
// El núcleo central de un rectángulo es un ROMBO: hay contacto pleno solo si
// ex/B + ey/L ≤ 1/6 (se deduce de σmin = N/A·(1 − 6ex/B − 6ey/L) ≥ 0). La
// condición rectangular (ex ≤ B/6 Y ey ≤ L/6) clasificaba como trapezoidal
// casos biaxiales con despegue real (p.ej. ex=B/8, ey=L/8), subestimando σmax.
// Fuera del rombo: Meyerhof uniaxial solo si la excentricidad secundaria es
// despreciable; con ambas no nulas, contacto parcial general (Newton-Raphson).
function classifyDistribution(ex: number, ey: number, B: number, L: number): DistributionType {
  if (ex >= B / 2 || ey >= L / 2) return 'overturning_fail';
  const exRel = ex / B;
  const eyRel = ey / L;
  if (exRel + eyRel <= 1 / 6) return 'trapezoidal';
  if (Math.min(exRel, eyRel) < 1e-3) return 'bitriangular_uniaxial';
  return 'bitriangular_biaxial';
}

// ── Newton-Raphson for biaxial bitriangular ──────────────────────────────────
// Linear pressure: σ(x, y) = a + bx·x + by·y over the loaded region (σ ≥ 0).
// Three unknowns (a, bx, by), three equilibrium residuals (N, Mx, My).
// Loaded region = polygon where σ ≥ 0; integrals are exact (see `integrate`).
//
// Returns sigma_max, sigma_min (=0 by definition for partial contact),
// loaded_area_fraction and the plane (a, bx, by) with the high corner at
// (+B/2, +L/2), or null on divergence.
interface BiaxialNRResult {
  sigma_max: number;
  loaded_area_fraction: number;
  a: number; bx: number; by: number;
}

function solveBiaxialNR(
  N: number, Mx_app: number, My_app: number,
  B: number, L: number,
): BiaxialNRResult | null {
  // Coordinates: x ∈ [-B/2, B/2] (along B), y ∈ [-L/2, L/2] (along L).
  // Mx applied = moment about x-axis (positive y-side compressed)
  // My applied = moment about y-axis (positive x-side compressed)
  // Sign of moments collapsed to absolute since we already know the high-corner.
  // Place high corner at (+B/2, +L/2) by orienting eccentricities positive.
  const Mx = Math.abs(Mx_app);
  const My = Math.abs(My_app);

  // (ΣF, ΣMx, ΣMy) sobre la región apoyada para un plano (a, bx, by). EXACTA:
  // la región σ ≥ 0 es el rectángulo recortado por una recta —un polígono
  // convexo—, y σ, σ·x y σ·y son polinomios de grado ≤ 2, que la cuadratura de
  // los puntos medios de los lados integra sin error en cada triángulo. Antes
  // se sumaba sobre una malla de 16 × 16 celdas y σmax salía entre un 0,7 y un
  // 2 % por encima de la solución cerrada del triángulo de esquina.
  function integrate(a: number, bx: number, by: number) {
    const f = (x: number, y: number) => a + bx * x + by * y;
    const rect: Array<[number, number]> = [[-B / 2, -L / 2], [B / 2, -L / 2], [B / 2, L / 2], [-B / 2, L / 2]];
    const poli: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      const P = rect[i], Q = rect[(i + 1) % 4];
      const fp = f(P[0], P[1]), fq = f(Q[0], Q[1]);
      if (fp >= 0) poli.push(P);
      if ((fp >= 0) !== (fq >= 0)) {
        const t = fp / (fp - fq);
        poli.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      }
    }
    let F = 0, Mx_int = 0, My_int = 0, A_loaded = 0;
    for (let i = 1; i < poli.length - 1; i++) {
      const [x0, y0] = poli[0], [x1, y1] = poli[i], [x2, y2] = poli[i + 1];
      const area = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
      const w = area / 3;
      for (const [mx, my] of [[(x0 + x1) / 2, (y0 + y1) / 2], [(x1 + x2) / 2, (y1 + y2) / 2], [(x2 + x0) / 2, (y2 + y0) / 2]]) {
        const sg = f(mx, my);
        F      += sg * w;
        Mx_int += sg * my * w;   // moment about x-axis
        My_int += sg * mx * w;   // moment about y-axis
      }
      A_loaded += area;
    }
    return { F, Mx: Mx_int, My: My_int, A_loaded };
  }

  // Initial guess: assume full contact trapezoid
  const A = B * L;
  let a = N / A;
  let bx = (12 * My) / (A * B * B);   // σ-slope along x
  let by = (12 * Mx) / (A * L * L);   // σ-slope along y

  for (let iter = 0; iter < NR_MAX_ITER; iter++) {
    const f0 = integrate(a, bx, by);
    const r1 = (f0.F - N) / N;
    const r2 = (f0.Mx - Mx) / N;
    const r3 = (f0.My - My) / N;
    const maxRes = Math.max(Math.abs(r1), Math.abs(r2), Math.abs(r3));
    if (maxRes < NR_TOL) {
      // Compute σmax at corner (+B/2, +L/2) — guaranteed peak in loaded region
      const sigmaMax = a + bx * (B / 2) + by * (L / 2);
      if (sigmaMax <= 0 || !isFinite(sigmaMax)) return null;
      return { sigma_max: sigmaMax, loaded_area_fraction: f0.A_loaded / A, a, bx, by };
    }

    // Numeric Jacobian (forward differences on a, bx, by)
    const ha  = Math.max(Math.abs(a)  * 1e-4, 1e-3);
    const hbx = Math.max(Math.abs(bx) * 1e-4, 1e-3);
    const hby = Math.max(Math.abs(by) * 1e-4, 1e-3);

    const fa  = integrate(a + ha, bx, by);
    const fbx = integrate(a, bx + hbx, by);
    const fby = integrate(a, bx, by + hby);

    // Jacobian rows: ∂(F, Mx, My) / ∂(a, bx, by)
    const J = [
      [(fa.F  - f0.F)  / ha, (fbx.F  - f0.F)  / hbx, (fby.F  - f0.F)  / hby],
      [(fa.Mx - f0.Mx) / ha, (fbx.Mx - f0.Mx) / hbx, (fby.Mx - f0.Mx) / hby],
      [(fa.My - f0.My) / ha, (fbx.My - f0.My) / hbx, (fby.My - f0.My) / hby],
    ];
    const r = [-(f0.F - N), -(f0.Mx - Mx), -(f0.My - My)];

    const delta = solve3x3(J, r);
    if (!delta) return null;
    a  += delta[0];
    bx += delta[1];
    by += delta[2];

    if (!isFinite(a) || !isFinite(bx) || !isFinite(by)) return null;
  }
  return null; // did not converge
}

function solve3x3(A: number[][], b: number[]): number[] | null {
  // Cramer's rule for a 3×3 system
  function det3(m: number[][]): number {
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  }
  const D = det3(A);
  if (Math.abs(D) < 1e-12) return null;
  const M0 = [[b[0], A[0][1], A[0][2]], [b[1], A[1][1], A[1][2]], [b[2], A[2][1], A[2][2]]];
  const M1 = [[A[0][0], b[0], A[0][2]], [A[1][0], b[1], A[1][2]], [A[2][0], b[2], A[2][2]]];
  const M2 = [[A[0][0], A[0][1], b[0]], [A[1][0], A[1][1], b[1]], [A[2][0], A[2][1], b[2]]];
  return [det3(M0) / D, det3(M1) / D, det3(M2) / D];
}

// ── Solve stress (σmax, σmin, loaded fraction) for given distribution type ───
interface StressResult {
  sigma_max: number;
  sigma_min: number;
  loaded_area_fraction: number;
  distributionType: DistributionType;
}

function solveStress(
  dist: DistributionType,
  ex: number, ey: number,
  N: number, B: number, L: number,
): StressResult {
  if (dist === 'overturning_fail') {
    return { sigma_max: Infinity, sigma_min: 0, loaded_area_fraction: 0, distributionType: 'overturning_fail' };
  }

  const A = B * L;
  const sigma_c = N / A;

  if (dist === 'trapezoidal') {
    // Closed form: σ = N/A · (1 ± 6e/B ± 6e/L). Boundary ex=B/6 → σmin=0.
    const sigma_max = sigma_c * (1 + 6 * ex / B + 6 * ey / L);
    const sigma_min = sigma_c * (1 - 6 * ex / B - 6 * ey / L);
    return {
      sigma_max,
      sigma_min: Math.max(sigma_min, 0),
      loaded_area_fraction: 1.0,
      distributionType: 'trapezoidal',
    };
  }

  if (dist === 'bitriangular_uniaxial') {
    // One eccentricity beyond core. Meyerhof closed form on the dominant axis.
    // Loaded region is a triangle (in 1D: a strip of width = 3·(B/2 − ex)).
    // σmax = 2N / [3·L · (B/2 − ex)]  (when ex governs)
    let sigma_max: number;
    let loaded_fraction: number;
    if (ex > B / 6) {
      const lc = 3 * (B / 2 - ex);
      if (lc <= 0) return { sigma_max: Infinity, sigma_min: 0, loaded_area_fraction: 0, distributionType: 'overturning_fail' };
      sigma_max = (2 * N) / (3 * L * (B / 2 - ex));
      loaded_fraction = lc / B;
    } else {
      const lc = 3 * (L / 2 - ey);
      if (lc <= 0) return { sigma_max: Infinity, sigma_min: 0, loaded_area_fraction: 0, distributionType: 'overturning_fail' };
      sigma_max = (2 * N) / (3 * B * (L / 2 - ey));
      loaded_fraction = lc / L;
    }
    return {
      sigma_max,
      sigma_min: 0,
      loaded_area_fraction: loaded_fraction,
      distributionType: 'bitriangular_uniaxial',
    };
  }

  // bitriangular_biaxial → Newton-Raphson
  // Mx_app and My_app reconstructed from ex, ey, N
  const Mx_app = ey * N;
  const My_app = ex * N;
  const nr = solveBiaxialNR(N, Mx_app, My_app, B, L);
  if (!nr) {
    return { sigma_max: Infinity, sigma_min: 0, loaded_area_fraction: 0, distributionType: 'overturning_fail' };
  }
  return {
    sigma_max: nr.sigma_max,
    sigma_min: 0,
    loaded_area_fraction: nr.loaded_area_fraction,
    distributionType: 'bitriangular_biaxial',
  };
}

// ── Ley lineal de presiones (para el despegue) ───────────────────────────────
// σ(x, y) = max(0, a + bx·x + by·y) con la resultante V en (ex, ey) CON SIGNO.
// Devuelve null si la resultante sale de la zapata (vuelco).
export type PlanoPresiones = { a: number; bx: number; by: number };
type Plano = PlanoPresiones;

function planoPresiones(V: number, ex: number, ey: number, B: number, L: number): Plano | null {
  const sx = ex < 0 ? -1 : 1;
  const sy = ey < 0 ? -1 : 1;
  const ax = Math.abs(ex), ay = Math.abs(ey);
  const dist = classifyDistribution(ax, ay, B, L);
  if (dist === 'overturning_fail') return null;
  const A = B * L;
  let p: Plano;
  if (dist === 'trapezoidal') {
    p = { a: V / A, bx: (12 * V * ax) / (A * B * B), by: (12 * V * ay) / (A * L * L) };
  } else if (dist === 'bitriangular_uniaxial') {
    if (ax / B >= ay / L) {
      const lc = 3 * (B / 2 - ax);
      const sMax = (2 * V) / (3 * L * (B / 2 - ax));
      const bx = sMax / lc;
      p = { a: sMax - bx * (B / 2), bx, by: 0 };
    } else {
      const lc = 3 * (L / 2 - ay);
      const sMax = (2 * V) / (3 * B * (L / 2 - ay));
      const by = sMax / lc;
      p = { a: sMax - by * (L / 2), bx: 0, by };
    }
  } else {
    const nr = solveBiaxialNR(V, ay * V, ax * V, B, L);
    if (!nr) return null;
    p = { a: nr.a, bx: nr.bx, by: nr.by };
  }
  // Volver a los signos reales: el pico estaba en (+B/2, +L/2).
  return { a: p.a, bx: sx * p.bx, by: sy * p.by };
}

/**
 * Mayor flector que tracciona la cara SUPERIOR en la dirección dada, por metro
 * de ancho (kNm/m, positivo; 0 si no hay). Viga de ancho completo cargada con
 * el terreno hacia arriba y el peso (zapata + tierras, mayorado) hacia abajo,
 * con las secciones en los vuelos (de la cara del pilar al borde).
 */
function flectorSuperior(
  plano: Plano, qPeso: number, dir: 'x' | 'y',
  B: number, L: number, caraNeg: number, caraPos: number,
): number {
  const largo = dir === 'x' ? B : L;
  const ancho = dir === 'x' ? L : B;
  const n = 160, m = 60;
  const dt = largo / n, dw = ancho / m;
  // p(t): resultante por unidad de longitud a lo largo de `dir` (kN/m).
  const t: number[] = [], p: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = -largo / 2 + (i + 0.5) * dt;
    let s = 0;
    for (let j = 0; j < m; j++) {
      const wj = -ancho / 2 + (j + 0.5) * dw;
      const x = dir === 'x' ? ti : wj;
      const y = dir === 'x' ? wj : ti;
      s += Math.max(0, plano.a + plano.bx * x + plano.by * y) * dw;
    }
    t.push(ti);
    p.push(s - qPeso * ancho);
  }
  let peor = 0;
  // Vuelo positivo: secciones t0 ∈ [caraPos, largo/2].
  for (let k = 0; k <= 40; k++) {
    const t0 = caraPos + ((largo / 2 - caraPos) * k) / 40;
    let M = 0;
    for (let i = 0; i < n; i++) if (t[i] > t0) M += p[i] * (t[i] - t0) * dt;
    if (-M > peor) peor = -M;
  }
  // Vuelo negativo: secciones t0 ∈ [−largo/2, caraNeg].
  for (let k = 0; k <= 40; k++) {
    const t0 = -largo / 2 + ((caraNeg + largo / 2) * k) / 40;
    let M = 0;
    for (let i = 0; i < n; i++) if (t[i] < t0) M += p[i] * (t0 - t[i]) * dt;
    if (-M > peor) peor = -M;
  }
  return peor / ancho;
}

// ── Vuelos con un bloque de presión uniforme (Meyerhof) ─────────────────────
// Coordenada local t desde la cara del pilar hacia el borde: el bloque cubre
// [t1, t2] ∩ [0, vuelo]. Momento y cortante por metro de ancho (σ en kPa).
interface Vuelo { len: number; t1: number; t2: number }

function vuelo(cara: number, borde: number, blq1: number, blq2: number): Vuelo {
  const len = Math.abs(borde - cara);
  const s = borde >= cara ? 1 : -1;
  // Pasar el bloque a coordenada t = s·(x − cara).
  const a = s * (blq1 - cara), b = s * (blq2 - cara);
  const t1 = Math.max(0, Math.min(a, b));
  const t2 = Math.min(len, Math.max(a, b));
  return { len, t1, t2: Math.max(t1, t2) };
}

const momentoVuelo = (v: Vuelo, sigma: number) => (sigma * (v.t2 * v.t2 - v.t1 * v.t1)) / 2;
const cortanteVuelo = (v: Vuelo, sigma: number, d: number) =>
  v.t2 > d ? sigma * (v.t2 - Math.max(v.t1, d)) : 0;

/**
 * Tracción del tirante de un lado (EHE-08 58.4.1.1): Td = R1d·(x1 − 0,25a)/(0,85d),
 * con R1d la resultante de las presiones del eje del pilar al borde y x1 su
 * distancia al eje. Con zapata centrada se reduce al σ·L·B·(B − bc)/(6,8d) clásico.
 */
function tiranteLado(
  eje: number, borde: number, blq1: number, blq2: number,
  sigma: number, anchoTransversal: number, a: number, d_m: number,
): number {
  const v = vuelo(eje, borde, blq1, blq2);
  const largo = v.t2 - v.t1;
  if (largo <= 0) return 0;
  const R1d = sigma * anchoTransversal * largo;
  const x1 = (v.t1 + v.t2) / 2;
  const brazo = x1 - 0.25 * a;
  return brazo > 0 ? (R1d * brazo) / (0.85 * d_m) : 0;
}

/** Ø y separación (múltiplo de 25 mm, entre 100 y 300) que dan al menos As (mm²/m). */
function proponerBarras(As: number): string {
  for (const phi of [12, 16, 20, 25]) {
    const s = Math.min(300, Math.floor((getBarArea(phi) * 1000) / As / 25) * 25);
    if (s >= 100) return `Ø${phi} c/${s}`;
  }
  return 'Ø25 c/100';
}

export function calcIsolatedFooting(inp: IsolatedFootingInputs): IsolatedFootingResult {
  // ── Validation ────────────────────────────────────────────────────────────
  const B  = inp.B, L = inp.L, h = inp.h, bc = inp.bc, hc = inp.hc, Df = inp.Df;
  const cover = inp.cover;
  const tipo: TipoZapata = inp.tipo ?? 'centrada';

  if (B <= 0 || L <= 0 || h <= 0) return invalid('B, L y h deben ser > 0');
  if (bc <= 0 || hc <= 0) return invalid('bc y hc deben ser > 0');
  if (bc >= B || hc >= L) return invalid('El pilar debe ser menor que la zapata');
  if (Df <= 0) return invalid('Df debe ser > 0');
  if (h > Df) return invalid('El canto h no puede superar la profundidad Df');
  if (cover <= 0) return invalid('Recubrimiento debe ser > 0');
  if (inp.s_x <= 0 || inp.s_y <= 0) return invalid('Separación de barras debe ser > 0');
  if (inp.phi_x <= 0 || inp.phi_y <= 0) return invalid('Diámetro de barras debe ser > 0');
  if (inp.sigma_adm <= 0) return invalid('σadm debe ser > 0');
  if (inp.loadFactor <= 0) return invalid('Factor de mayoración debe ser > 0');
  if (inp.N <= 0) return invalid('N debe ser > 0 (compresión)');

  const { cx, cy } = posicionPilar(inp);
  const vigas = vigasActivas(inp);
  const luzX = inp.luzX ?? 0, luzY = inp.luzY ?? 0;
  // La cara interior de la zapata, medida desde el eje del pilar.
  const caraX = B / 2 - cx;
  const caraY = L / 2 - cy;
  if (vigas.x && !(luzX > caraX)) {
    return invalid(`La luz de la viga centradora en x debe superar ${dec(caraX, 2)} m: el pilar interior ha de quedar fuera de la zapata`);
  }
  if (vigas.y && !(luzY > caraY)) {
    return invalid(`La luz de la viga centradora en y debe superar ${dec(caraY, 2)} m: el pilar interior ha de quedar fuera de la zapata`);
  }
  const usaSup = !!inp.supLleva;
  if (usaSup && (!(inp.phi_sup_x > 0) || !(inp.phi_sup_y > 0) || !(inp.s_sup_x > 0) || !(inp.s_sup_y > 0))) {
    return invalid('Diámetro y separación de la armadura superior deben ser > 0');
  }

  // ── Loads ─────────────────────────────────────────────────────────────────
  const { N_sls, Mx_sls, My_sls, H_sls, N_elu, Mx_elu, My_elu, H_elu } = deriveLoads(inp);

  const eqS = equilibrio(N_sls, Mx_sls, My_sls, cx, cy, vigas.x, vigas.y, luzX, luzY);
  const eqE = equilibrio(N_elu, Mx_elu, My_elu, cx, cy, vigas.x, vigas.y, luzX, luzY);
  if (eqS.den <= 0 || eqS.R <= 0 || eqE.R <= 0) {
    return invalid('Las vigas centradoras no equilibran la zapata: la reacción del terreno saldría nula o negativa');
  }
  const R_sls = eqS.R, R_elu = eqE.R;

  // ── Self weights ──────────────────────────────────────────────────────────
  const W_footing = GAMMA_C_RC * B * L * h;
  const W_soil = inp.gamma_soil_kN_m3 * Math.max(Df - h, 0) * (B * L - bc * hc);

  // ── Presión del terreno (servicio) ────────────────────────────────────────
  // N, M y H se dan en la base del pilar: en la base de la zapata H añade un
  // momento H·h. H no tiene dirección, así que se prueba en cada una —en el
  // sentido que aumenta la excentricidad— y se queda la peor. En una dirección
  // con viga centradora ese momento es de la viga. Antes H·h entraba en el
  // vuelco y no en la presión.
  const Ntot_sls = R_sls + W_footing + W_soil;
  const signo = (v: number) => (v < 0 ? -1 : 1);
  const momentosBase = (My_c: number, Mx_c: number, H: number, dir: 'x' | 'y' | null) => ({
    My: My_c + (dir === 'x' ? signo(My_c) * Math.abs(H) * h : 0),
    Mx: Mx_c + (dir === 'y' ? signo(Mx_c) * Math.abs(H) * h : 0),
  });
  // CTE DB-SE-C 4.3.1.3: cimiento equivalente B* = B − 2·eB, L* = L − 2·eL
  // (4.2, 4.3) y presión total bruta media qb = V/(B*·L*) (4.4). Con e < lado/20
  // vale la sección real (punto 5).
  const ladoEq = (e: number, lado: number) => (e < lado / 20 ? lado : lado - 2 * e);
  const casoSls = (dir: 'x' | 'y' | null) => {
    const m = momentosBase(eqS.My_c, eqS.Mx_c, H_sls, dir);
    const exR = m.My / Ntot_sls, eyR = m.Mx / Ntot_sls;
    const ex = Math.abs(exR), ey = Math.abs(eyR);
    const st = solveStress(classifyDistribution(ex, ey, B, L), ex, ey, Ntot_sls, B, L);
    const Beq = ladoEq(ex, B), Leq = ladoEq(ey, L);
    const q = st.distributionType === 'overturning_fail' || Beq <= 0 || Leq <= 0 ? Infinity : Ntot_sls / (Beq * Leq);
    return { dir, exR, eyR, st, Beq, Leq, q };
  };
  let caso = casoSls(null);
  if (Math.abs(H_sls) > 0) {
    for (const dir of ['x', 'y'] as const) {
      if (dir === 'x' ? vigas.x : vigas.y) continue;
      const c = casoSls(dir);
      if (caso.dir === null || c.q > caso.q || (c.q === caso.q && c.st.sigma_max > caso.st.sigma_max)) caso = c;
    }
  }
  const H_dir = caso.dir;
  const exR_sls = caso.exR;
  const eyR_sls = caso.eyR;
  const ex_sls = Math.abs(exR_sls);
  const ey_sls = Math.abs(eyR_sls);
  const ex_over_B6 = ex_sls / (B / 6);
  const ey_over_L6 = ey_sls / (L / 6);
  const stress = caso.st;
  const planoSls = stress.distributionType === 'overturning_fail'
    ? null
    : planoPresiones(Ntot_sls, exR_sls, eyR_sls, B, L);
  const qb = caso.q;
  const B_eq = Math.max(caso.Beq, 0), L_eq = Math.max(caso.Leq, 0);

  const bearing_util = qb === Infinity ? Infinity : qb / inp.sigma_adm;
  const bearing_status: 'ok' | 'warn' | 'fail' = toStatus(bearing_util);

  // ── EQU overturning (CTE DB-SE-C Tabla 2.1) ──────────────────────────────
  // Acciones CARACTERÍSTICAS con γ_dst = 1.8 / γ_stb = 0.9 → FS equivalente
  // sobre características = 2.0. El axil N es la PRINCIPAL acción
  // estabilizadora de una zapata (antes se omitía y además se acumulaba
  // γ_ELU=1.35 × FS=1.5 ≈ 2.0 sobre el desestabilizador: falsos fallos de
  // vuelco con la resultante dentro del núcleo central).
  // Respecto a cada borde: el axil (con las descargas de las vigas de la otra
  // dirección, que pasan por la línea del pilar) estabiliza con su brazo REAL
  // hasta ese borde —en medianera, bc/2 hasta el lindero—, el peso con B/2; el
  // momento que empuja hacia ese borde y H·h desestabilizan. Se toma el peor
  // borde. En una dirección con viga centradora no hay vuelco: lo impide la viga.
  // Convention: FS_overturn_x = tipping in x direction (about y-axis edge).
  const W_tot = W_footing + W_soil;
  const vuelcoDir = (M: number, c: number, semi: number) => {
    let peor = { stab: 0, dest: 0, FS: Infinity };
    for (const s of [1, -1]) {
      const dest = Math.max(s * M, 0) + Math.abs(H_sls) * h;
      if (dest <= 0) continue;
      const stab = R_sls * (semi - s * c) + W_tot * semi;
      const FS = stab / dest;
      if (FS < peor.FS) peor = { stab, dest, FS };
    }
    return peor;
  };
  const vx_ = vigas.x ? { stab: 0, dest: 0, FS: Infinity } : vuelcoDir(My_sls, cx, B / 2);
  const vy_ = vigas.y ? { stab: 0, dest: 0, FS: Infinity } : vuelcoDir(Mx_sls, cy, L / 2);
  const M_dest_x = vx_.dest, M_stab_x = vx_.stab, FS_overturn_x = vx_.FS;
  const M_dest_y = vy_.dest, M_stab_y = vy_.stab, FS_overturn_y = vy_.FS;

  // ── Deslizamiento (CTE DB-SE-C 4.2.2.1.2 y tabla 2.1) ─────────────────────
  // γR = 1,5 con γF = 1: acciones CARACTERÍSTICAS. Antes se comparaban las de
  // cálculo, con el peso sin mayorar: un 4 % del lado seguro y otro criterio
  // que el del vuelco.
  const Rd_slide = inp.mu_friction * (R_sls + W_footing + W_soil);
  const FS_sliding = Math.abs(H_sls) > 0 ? Rd_slide / Math.abs(H_sls) : Infinity;

  // ── ELU armado: effective uniform pressure on Meyerhof B'×L' ──────────────
  // Sin peso propio (el peso no flecta la zapata). En una dirección con viga
  // centradora el terreno trabaja centrado: B' = B.
  const mE = momentosBase(eqE.My_c, eqE.Mx_c, H_elu, H_dir);
  const exE = mE.My / R_elu;
  const eyE = mE.Mx / R_elu;
  const ex_Ed = Math.abs(exE);
  const ey_Ed = Math.abs(eyE);
  const B_Ed  = Math.max(B - 2 * ex_Ed, 0.01);
  const L_Ed  = Math.max(L - 2 * ey_Ed, 0.01);
  const sigma_Ed_uniform = R_elu / (B_Ed * L_Ed);  // kPa
  // Bloque de Meyerhof, pegado al lado hacia el que va la resultante.
  const blqX: [number, number] = exE >= 0 ? [B / 2 - B_Ed, B / 2] : [-B / 2, -B / 2 + B_Ed];
  const blqY: [number, number] = eyE >= 0 ? [L / 2 - L_Ed, L / 2] : [-L / 2, -L / 2 + L_Ed];

  // ── Effective depths (mm) ─────────────────────────────────────────────────
  const d_x = h * 1000 - cover - inp.phi_x / 2;
  const d_y = h * 1000 - cover - inp.phi_x - inp.phi_y / 2;
  if (d_x <= 0 || d_y <= 0) return invalid('Canto insuficiente para el recubrimiento indicado');

  // ── Materials ─────────────────────────────────────────────────────────────
  const mat = getConcrete(inp.fck);
  const fcd = mat.fcd;
  const fctm = mat.fctm;
  const fyd = inp.fyk / 1.15;

  // ── Vuelos a cada lado (m) ────────────────────────────────────────────────
  const caraXneg = cx - bc / 2, caraXpos = cx + bc / 2;
  const caraYneg = cy - hc / 2, caraYpos = cy + hc / 2;
  const vXneg = vuelo(caraXneg, -B / 2, blqX[0], blqX[1]);
  const vXpos = vuelo(caraXpos,  B / 2, blqX[0], blqX[1]);
  const vYneg = vuelo(caraYneg, -L / 2, blqY[0], blqY[1]);
  const vYpos = vuelo(caraYpos,  L / 2, blqY[0], blqY[1]);
  const vuelos = {
    xNeg: vXneg.len * 1000, xPos: vXpos.len * 1000,
    yNeg: vYneg.len * 1000, yPos: vYpos.len * 1000,
  };
  const ax = Math.max(vuelos.xNeg, vuelos.xPos);
  const ay = Math.max(vuelos.yNeg, vuelos.yPos);

  // ¿Trabajan las barras de cada dirección como ménsula? No las paralelas a una
  // viga centradora sin viga en la otra dirección: esa flexión es de la viga
  // (la zapata es su ensanche) y la parrilla queda en cuantía mínima. Con dos
  // vigas (esquina), cada parrilla vuela desde la viga de la otra dirección.
  const mensulaX = !(vigas.x && !vigas.y);
  const mensulaY = !(vigas.y && !vigas.x);

  // ── Rigid/flexible classification ─────────────────────────────────────────
  const v_max = Math.max(mensulaX ? ax / 1000 : 0, mensulaY ? ay / 1000 : 0);
  const isRigid = v_max <= 2 * h;

  // ── Bending at column face (always computed; check active only if flexible)
  const MEd_x = mensulaX ? Math.max(momentoVuelo(vXneg, sigma_Ed_uniform), momentoVuelo(vXpos, sigma_Ed_uniform)) : 0;   // kNm/m
  const MEd_y = mensulaY ? Math.max(momentoVuelo(vYneg, sigma_Ed_uniform), momentoVuelo(vYpos, sigma_Ed_uniform)) : 0;

  function reqAs(MEd: number, d: number): number {
    if (MEd <= 0) return 0;
    const mu_dim = (MEd * 1e6) / (1000 * d * d * fcd);
    if (mu_dim >= 0.5) return Infinity;
    const omega = 1 - Math.sqrt(1 - 2 * mu_dim);
    return (omega * 1000 * d * fcd) / fyd;
  }
  // As,min por metro, CE Anejo 19 §9.2.1.1 (9.1) sobre la franja 1000 × h de
  // la zapata (hasta el 2026-09-25, el 0,26·fctm/fyk·b·d del Eurocódigo, que
  // el CE no adopta). Es el mismo en las dos direcciones: depende de h, no de d.
  const As_min_franja = asMinRectangular(1000, h * 1000, fctm, fyd);

  const As_req_bend_x = reqAs(MEd_x, d_x);
  const As_req_bend_y = reqAs(MEd_y, d_y);

  // ── Strut-tie tie force (EHE-08 art. 58.4.1.1), el peor lado ──────────────
  // El ancho transversal es el del BLOQUE de presiones (L′, B′): con momento en
  // las dos direcciones, usar L y B contaba una reacción mayor que R.
  const Td_x = mensulaX ? Math.max(
    tiranteLado(cx, -B / 2, blqX[0], blqX[1], sigma_Ed_uniform, L_Ed, bc, d_x / 1000),
    tiranteLado(cx,  B / 2, blqX[0], blqX[1], sigma_Ed_uniform, L_Ed, bc, d_x / 1000),
  ) : 0;   // kN
  const Td_y = mensulaY ? Math.max(
    tiranteLado(cy, -L / 2, blqY[0], blqY[1], sigma_Ed_uniform, B_Ed, hc, d_y / 1000),
    tiranteLado(cy,  L / 2, blqY[0], blqY[1], sigma_Ed_uniform, B_Ed, hc, d_y / 1000),
  ) : 0;
  const As_req_tie_x = (Td_x * 1000 / fyd) / L;   // mm²/m (spread across L)
  const As_req_tie_y = (Td_y * 1000 / fyd) / B;   // mm²/m (spread across B)

  const As_req_x = isRigid ? As_req_tie_x : As_req_bend_x;
  const As_req_y = isRigid ? As_req_tie_y : As_req_bend_y;
  const As_min_x = As_min_franja;
  const As_min_y = As_min_franja;
  const As_adopted_x = Math.max(As_req_x, As_min_x);
  const As_adopted_y = Math.max(As_req_y, As_min_y);
  const As_prov_x = (getBarArea(inp.phi_x) / inp.s_x) * 1000;
  const As_prov_y = (getBarArea(inp.phi_y) / inp.s_y) * 1000;

  // ── Armadura superior por despegue ────────────────────────────────────────
  // Ley LINEAL en ELU con el peso mayorado (no el bloque de Meyerhof, que daría
  // «despegue» con cualquier excentricidad). Sólo en las direcciones sin viga:
  // con viga el terreno apoya entero en esa dirección.
  const qPeso = GAMMA_G_DESF * (GAMMA_C_RC * h + inp.gamma_soil_kN_m3 * Math.max(Df - h, 0));   // kPa
  const V_sup = R_elu + GAMMA_G_DESF * W_tot;
  const plano = planoPresiones(V_sup, mE.My / V_sup, mE.Mx / V_sup, B, L);
  const MEd_sup_x = plano && !vigas.x ? flectorSuperior(plano, qPeso, 'x', B, L, caraXneg, caraXpos) : 0;
  const MEd_sup_y = plano && !vigas.y ? flectorSuperior(plano, qPeso, 'y', B, L, caraYneg, caraYpos) : 0;
  // La parrilla superior la pide el flector que el hormigón en masa NO
  // aguanta. Es el criterio de la zapata sin armar del CE Anejo 19 §12.9.3
  // —0,85·hF/a ≥ √(3σgd/fct,d) es M ≤ fct,d·(0,85·h)²/6 con σgd·a²/2—, con
  // fct,d = αct,pl·fctk,0,05/γc (§12.3.1). Antes bastaba con 0,5 kNm/m: una
  // zapata centrada de 0,60 m con la resultante apenas fuera del núcleo pedía
  // parrilla, e INCUMPLÍA, por 1,2 kNm/m frente a unos 40 que aguanta.
  const fctd_pl = (ALPHA_CT_PL * 0.7 * fctm) / 1.5;               // MPa
  const M_fis_sup = (fctd_pl * 1000 * (0.85 * h) ** 2) / 6;      // kNm/m
  const necesitaSup_x = MEd_sup_x > Math.max(M_fis_sup, M_SUP_MIN);
  const necesitaSup_y = MEd_sup_y > Math.max(M_fis_sup, M_SUP_MIN);
  const phiSupX = inp.phi_sup_x > 0 ? inp.phi_sup_x : 12;
  const phiSupY = inp.phi_sup_y > 0 ? inp.phi_sup_y : 12;
  const d_sup_x = h * 1000 - cover - phiSupX / 2;
  const d_sup_y = h * 1000 - cover - phiSupX - phiSupY / 2;
  const As_sup_adopted_x = necesitaSup_x ? Math.max(reqAs(MEd_sup_x, d_sup_x), As_min_franja) : 0;
  const As_sup_adopted_y = necesitaSup_y ? Math.max(reqAs(MEd_sup_y, d_sup_y), As_min_franja) : 0;
  const As_prov_sup_x = usaSup ? (getBarArea(inp.phi_sup_x) / inp.s_sup_x) * 1000 : 0;
  const As_prov_sup_y = usaSup ? (getBarArea(inp.phi_sup_y) / inp.s_sup_y) * 1000 : 0;

  // ── Shear (CE Anejo 19 §6.2, at d from column face) ─────────────────────────────
  const ell_x = Math.max(ax - d_x, 0);
  const ell_y = Math.max(ay - d_y, 0);
  const VEd_x = mensulaX ? Math.max(cortanteVuelo(vXneg, sigma_Ed_uniform, d_x / 1000), cortanteVuelo(vXpos, sigma_Ed_uniform, d_x / 1000)) : 0;   // kN/m
  const VEd_y = mensulaY ? Math.max(cortanteVuelo(vYneg, sigma_Ed_uniform, d_y / 1000), cortanteVuelo(vYpos, sigma_Ed_uniform, d_y / 1000)) : 0;

  const k_sh_x = Math.min(1 + Math.sqrt(200 / d_x), 2.0);
  const rhoL_x = Math.min(As_prov_x / (1000 * d_x), 0.02);
  const vRdc_x = Math.max(
    (0.18 / 1.5) * k_sh_x * Math.pow(100 * rhoL_x * inp.fck, 1 / 3),
    0.035 * Math.pow(k_sh_x, 1.5) * Math.sqrt(inp.fck),
  );
  const k_sh_y = Math.min(1 + Math.sqrt(200 / d_y), 2.0);
  const rhoL_y = Math.min(As_prov_y / (1000 * d_y), 0.02);
  const vRdc_y = Math.max(
    (0.18 / 1.5) * k_sh_y * Math.pow(100 * rhoL_y * inp.fck, 1 / 3),
    0.035 * Math.pow(k_sh_y, 1.5) * Math.sqrt(inp.fck),
  );
  // VRd por metro de ancho = vRdc [N/mm²] · d [mm] → kN/m
  const VRd_x = vRdc_x * d_x;
  const VRd_y = vRdc_y * d_y;

  // ── Punching (CE Anejo 19 §6.4) ───────────────────────────────────────────
  // Posición: medianera = borde (el lindero corta el perímetro), esquina =
  // esquina. Convenio del §6.4.5(3): c2 paralelo al borde libre, c1 perpendicular.
  //
  // §6.4.4(2): en la base de un pilar se comprueban los perímetros situados
  // DENTRO de 2d, no sólo el de 2d. A la distancia a del pilar la resistencia
  // crece con 2d/a (6.50), pero el perímetro se acorta y el terreno descuenta
  // menos (6.48): el crítico suele caer hacia a ≈ d. Comprobar sólo a 2d daba
  // entre 1,2 y 1,9 veces menos aprovechamiento del real (auditoría 2026-11-05).
  const punchingPosition: PunchingPosition =
    tipo === 'medianera' ? 'borde' : tipo === 'esquina' ? 'esquina' : 'interior';
  const d_avg = (d_x + d_y) / 2;
  const dm = d_avg / 1000;
  const bcm = bc * 1000, hcm = hc * 1000;
  const perimetro = (a: number) =>            // m
    punchingPosition === 'borde'   ? hc + 2 * bc + Math.PI * a
    : punchingPosition === 'esquina' ? bc + hc + (Math.PI * a) / 2
    : 2 * (bc + hc) + 2 * Math.PI * a;
  // Área común del contorno a distancia a del pilar (el pilar dilatado con
  // esquinas redondeadas), la zapata y el bloque de presiones. En borde y
  // esquina el pilar está enrasado con el lindero, así que recortar con la
  // zapata deja el contorno abierto de la figura A19.6.21. Antes se tomaba el
  // mínimo de las dos áreas, que con el bloque desplazado deducía terreno que
  // queda fuera de la intersección (revisión de Copilot, 2026-11-05).
  const areaComun = (a: number, rx: [number, number], ry: [number, number]) => {   // m²
    const x0 = Math.max(rx[0], caraXneg - a), x1 = Math.min(rx[1], caraXpos + a);
    if (!(x1 > x0) || !(ry[1] > ry[0])) return 0;
    const alto = (x: number) => {
      const fuera = Math.max(caraXneg - x, x - caraXpos, 0);
      const g = fuera >= a ? 0 : Math.sqrt(a * a - fuera * fuera);
      return Math.max(0, Math.min(ry[1], caraYpos + g) - Math.max(ry[0], caraYneg - g));
    };
    // Tramo recto exacto; las esquinas redondeadas, por puntos medios en
    // x = cara ± a·sen θ, que quita la singularidad de la raíz en el borde.
    const tramo = (cara: number, s: 1 | -1, t0: number, t1: number) => {
      const th0 = Math.asin(Math.min(1, t0 / a)), th1 = Math.asin(Math.min(1, t1 / a));
      if (!(th1 > th0)) return 0;
      const n = 256;
      let suma = 0;
      for (let i = 0; i < n; i++) {
        const th = th0 + ((i + 0.5) * (th1 - th0)) / n;
        suma += alto(cara + s * a * Math.sin(th)) * a * Math.cos(th);
      }
      return (suma * (th1 - th0)) / n;
    };
    const m0 = Math.max(x0, caraXneg), m1 = Math.min(x1, caraXpos);
    return (a > 0 ? tramo(caraXneg, -1, Math.max(0, caraXneg - Math.min(x1, caraXneg)), caraXneg - x0) : 0)
      + (m1 > m0 ? (m1 - m0) * alto((m0 + m1) / 2) : 0)
      + (a > 0 ? tramo(caraXpos, 1, Math.max(0, Math.max(x0, caraXpos) - caraXpos), x1 - caraXpos) : 0);
  };
  const u1_rect = perimetro(2 * dm) * 1000;   // mm — el de 2d, de referencia
  // β por transferencia de momento, (6.43): β = 1 + 1,8·√[(ey/bz)² + (ez/by)²],
  // con la excentricidad según un eje dividida por la dimensión del perímetro
  // según EL OTRO (antes iban emparejadas, que sólo coincide con pilar
  // cuadrado). La excentricidad es la del MOMENTO DEL PILAR (M/N), no la del
  // pilar respecto a la zapata. En borde y esquina, al menos los 1,4 / 1,5 de
  // la figura A19.6.21.
  const eColX = Math.abs(My_elu) / N_elu;     // m, a lo largo de x
  const eColY = Math.abs(Mx_elu) / N_elu;     // m, a lo largo de y
  const betaEn = (a: number) => {
    const formula = 1 + 1.8 * Math.hypot(eColX / (hc + 2 * a), eColY / (bc + 2 * a));
    return punchingPosition === 'interior' ? formula : Math.max(formula, betaForPosition(punchingPosition));
  };
  const beta_punch = betaEn(2 * dm);
  const k_p = Math.min(1 + Math.sqrt(200 / d_avg), 2.0);
  const rhoL_avg = Math.min((As_prov_x + As_prov_y) / 2 / (1000 * d_avg), 0.02);
  const vRdc_punch = Math.max(
    (0.18 / 1.5) * k_p * Math.pow(100 * rhoL_avg * inp.fck, 1 / 3),
    0.035 * Math.pow(k_p, 1.5) * Math.sqrt(inp.fck),
  );
  // ΔVEd (6.48): la reacción neta del terreno dentro del perímetro, sólo la
  // que cae DENTRO de la zapata y del bloque de presiones.
  // La carga que baja al perímetro es R, no N: con viga centradora la viga
  // entrega su descarga ΔN = R − N en el nudo del pilar (sin vigas, R = N).
  const apoyoX: [number, number] = [Math.max(-B / 2, blqX[0]), Math.min(B / 2, blqX[1])];
  const apoyoY: [number, number] = [Math.max(-L / 2, blqY[0]), Math.min(L / 2, blqY[1])];
  const punzEn = (a: number) => {
    const A_ded = areaComun(a, apoyoX, apoyoY);
    const VEd_red = Math.max(0, R_elu - sigma_Ed_uniform * A_ded);
    const beta = betaEn(a);
    // (6.51): vEd = VEd,red/(u·d) + k·MEd/(W·d). El término del momento NO se
    // reduce con el terreno: (β − 1)·VEd. En borde y esquina β es un mínimo
    // forfatario de reparto, que sí acompaña al cortante neto.
    const V_ef = punchingPosition === 'interior' ? VEd_red + (beta - 1) * R_elu : beta * VEd_red;
    const vEd = V_ef / (perimetro(a) * dm) / 1000;      // MPa
    const vRd = vRdc_punch * (2 * dm) / a;              // MPa, (6.50)
    return { a, vEd, vRd, util: vEd / vRd };
  };
  // El perímetro tiene que caber en la zapata: más allá del borde libre más
  // cercano deja de ser un perímetro cerrado y lo que queda es cortante de viga
  // ancha, que tiene su propia comprobación.
  const vuelosLibres = [
    vXpos.len, vYpos.len,
    ...(punchingPosition === 'interior' ? [vXneg.len] : []),
    ...(punchingPosition === 'esquina' ? [] : [vYneg.len]),
  ];
  const a_max_punch = Math.min(2 * dm, ...vuelosLibres);
  let punz = punzEn(a_max_punch);
  for (let k = 1; k < 80; k++) {
    const p = punzEn((a_max_punch * k) / 80);
    if (p.util > punz.util) punz = p;
  }
  const vEd_punch = punz.vEd;
  const vRd_punch = punz.vRd;
  const a_punch = punz.a * 1000;                        // mm
  const u_punch = perimetro(punz.a) * 1000;             // mm
  // vEd ≤ vRd,max en el perímetro del pilar u0 (6.53) — obligatoria; VEd
  // completo (sin deducción) en u0. vRd,max = 0,4·ν·fcd: es el valor del CE
  // (hasta el 2026-11-05 se usaba 0,5, que no es de este Código).
  const u0_punch =
    punchingPosition === 'borde'   ? Math.min(hcm + 3 * d_avg, hcm + 2 * bcm)
    : punchingPosition === 'esquina' ? Math.min(3 * d_avg, bcm + hcm)
    : 2 * (bc + hc) * 1000;
  const nu_punch = 0.6 * (1 - inp.fck / 250);
  const vRd_max_punch = 0.4 * nu_punch * fcd;
  const vEd_u0_punch = (beta_punch * R_elu * 1000) / (u0_punch * d_avg);

  // ── Anclaje de la armadura (CE Anejo 19 §8.4 y §9.8.2.1) ──────────────────
  // lbd = (φ/4)·(σsd/fbd) con σsd proporcional a As,req/As,prov, suelo
  // lb,min = max(0.3·lb(fyd), 10φ, 100). Longitud disponible: vuelo − cover
  // lateral. Sin input de patilla: si la recta no cabe pero la patilla sí
  // (α1 = 0.7) → warn 'detallar con patilla'; si ni con patilla → fail.
  const fctd_anch = (0.7 * fctm) / 1.5;
  const fbd_anch = 2.25 * fctd_anch;   // η1 = 1.0 (posición I, parrilla inferior)
  const anchorageRow = (
    id: string, descr: string, phi: number,
    As_need: number, As_prov: number, vuelo_mm: number,
  ): CheckRow => {
    const sigma_sd = fyd * Math.min(1, As_need / Math.max(As_prov, 1e-9));
    const lb_full = (phi / 4) * (fyd / fbd_anch);
    const lbd = Math.max((phi / 4) * (sigma_sd / fbd_anch), 0.3 * lb_full, 10 * phi, 100);
    const disponible = Math.max(vuelo_mm - cover, 1);
    const util = lbd / disponible;
    const fitsHook = 0.7 * lbd <= disponible;   // patilla: α1 = 0.7
    // Regla constructiva: la recta cabe o no (lbd = disponible cabe, y sin
    // advertencia al 95 %); si no cabe pero cabe con patilla, aviso de detalle.
    const status: 'ok' | 'warn' | 'fail' =
      detailingStatus(util) === 'ok' ? 'ok' : fitsHook ? 'warn' : 'fail';
    return {
      id,
      description: util > 1 && fitsHook
        ? `${descr} — recta no cabe: detallar con patilla`
        : descr,
      value: `lbd = ${lbd.toFixed(0)} mm`,
      limit: `disp. = ${disponible.toFixed(0)} mm`,
      utilization: util,
      status,
      article: 'CE Anejo 19 §8.4 y §9.8.2.1',
    };
  };

  // ── Vigas centradoras ─────────────────────────────────────────────────────
  const vigaRes = (dN_s: number, dN_e: number, e: number, luz: number, dCara: number): VigaCentradoraResult => ({
    e, luz, dN_sls: dN_s, Vd: Math.abs(dN_e),
    Md: Math.abs(dN_e) * (luz - dCara),
    dCara,
    traccion: dN_e >= 0 ? 'superior' : 'inferior',
  });
  const vigaX = vigas.x ? vigaRes(eqS.dNx, eqE.dNx, -cx, luzX, caraX) : null;
  const vigaY = vigas.y ? vigaRes(eqS.dNy, eqE.dNy, -cy, luzY, caraY) : null;

  // ── Build checks[] ────────────────────────────────────────────────────────
  const checks: CheckRow[] = [];

  // Presión del terreno: qb sobre el área equivalente frente a σadm.
  const ART_PRESION = 'CTE DB-SE-C 4.3.1.3 y 4.2.2.1.1';
  if (qb === Infinity) {
    checks.push({
      id: 'bearing',
      description: 'Presión sobre el terreno — la resultante cae fuera de la zapata',
      valueStr: '∞',
      limitNum: inp.sigma_adm,
      limitQty: 'soilPressure',
      utilization: Infinity,
      status: 'fail',
      article: ART_PRESION,
    });
  } else {
    checks.push(makeCheckQty(
      'bearing', 'Presión sobre el área equivalente, qb ≤ σadm',
      qb, inp.sigma_adm,
      'soilPressure', ART_PRESION,
    ));
    // Excentricidad grande: no es un incumplimiento, pero el Eurocódigo 7 pide
    // precauciones especiales por encima de un tercio del lado.
    for (const [dir, e, lado, nombre] of [['x', ex_sls, B, 'B'], ['y', ey_sls, L, 'L']] as const) {
      if (e > lado / 3) {
        checks.push({
          id: `excentricidad-${dir}`,
          description: `Excentricidad en ${dir} mayor que ${nombre}/3: requiere precauciones especiales`,
          value: `e = ${dec(e, 2)} m`,
          limit: `${nombre}/3 = ${dec(lado / 3, 2)} m`,
          utilization: e / (lado / 3),
          status: 'warn',
          article: 'UNE-EN 1997-1 §6.5.4',
        });
      }
    }
  }

  // Overturning x (only if destabilizing moment exists)
  const ART_VUELCO = 'CTE DB-SE-C 4.2.2.1.3 (tabla 2.1)';
  if (M_dest_x > 0) {
    const u_x = FS_VUELCO_MIN / FS_overturn_x;
    checks.push({
      id: 'overturn-x',
      description: 'Vuelco dir. x (FS ≥ 2,0)',
      value: `FS = ${dec(FS_overturn_x, 2)}`,
      limit: `≥ ${dec(FS_VUELCO_MIN, 2)}`,
      utilization: u_x,
      status: toStatus(u_x),
      article: ART_VUELCO,
    });
  }
  if (M_dest_y > 0) {
    const u_y = FS_VUELCO_MIN / FS_overturn_y;
    checks.push({
      id: 'overturn-y',
      description: 'Vuelco dir. y (FS ≥ 2,0)',
      value: `FS = ${dec(FS_overturn_y, 2)}`,
      limit: `≥ ${dec(FS_VUELCO_MIN, 2)}`,
      utilization: u_y,
      status: toStatus(u_y),
      article: ART_VUELCO,
    });
  }

  // Sliding (only if H > 0)
  if (Math.abs(H_sls) > 0) {
    const u_s = FS_SLIDE_MIN / FS_sliding;
    checks.push({
      id: 'sliding',
      description: 'Deslizamiento (FS ≥ 1,5)',
      value: `FS = ${dec(FS_sliding, 2)}`,
      limit: `≥ ${dec(FS_SLIDE_MIN, 2)}`,
      utilization: u_s,
      status: toStatus(u_s),
      article: 'CTE DB-SE-C 4.2.2.1.2 (tabla 2.1)',
    });
  }

  // ── ELU group: armado (gated by isRigid) ──────────────────────────────────
  // Flexible: bending + shear + punching active, strut-tie neutral
  // Rigid:    strut-tie active, bending + shear + punching neutral
  // Una dirección sin ménsula (paralela a la única viga centradora) va entera
  // a neutro: su flexión y su cortante son de la viga.
  const NA_VIGA = 'viga centradora — N/A';
  const pushDir = (dir: 'x' | 'y') => {
    const ensula = dir === 'x' ? mensulaX : mensulaY;
    const As_ad = dir === 'x' ? As_adopted_x : As_adopted_y;
    const As_pr = dir === 'x' ? As_prov_x : As_prov_y;
    const As_rq = dir === 'x' ? As_req_x : As_req_y;
    if (!ensula) {
      checks.push(makeCheckNeutral(`biela-tirante-${dir}`, `Armadura dir. ${dir} (biela-tirante)`, NA_VIGA, 'CE Anejo 19 §6.5'));
      checks.push(makeCheckNeutral(`flexion-${dir}`, `Flexión dir. ${dir}`, NA_VIGA, 'CE Anejo 19 §9.2.1.1'));
      checks.push(makeCheckNeutral(`cortante-${dir}`, `Cortante dir. ${dir}`, NA_VIGA, 'CE Anejo 19 §6.2'));
      return;
    }
    if (isRigid) {
      pushBendingOrTie(checks, `biela-tirante-${dir}`, `Armadura dir. ${dir} (biela-tirante)`, As_ad, As_pr, As_rq, 'CE Anejo 19 §6.5 (EHE-08 58.4.1.1)');
      checks.push(makeCheckNeutral(`flexion-${dir}`, `Flexión dir. ${dir}`, 'rígida — N/A', 'CE Anejo 19 §9.2.1.1'));
      checks.push(makeCheckNeutral(`cortante-${dir}`, `Cortante dir. ${dir}`, 'rígida — N/A', 'CE Anejo 19 §6.2'));
      return;
    }
    checks.push(makeCheckNeutral(`biela-tirante-${dir}`, `Armadura dir. ${dir} (biela-tirante)`, 'flexible — N/A', 'CE Anejo 19 §6.5'));
    pushBendingOrTie(checks, `flexion-${dir}`, `Armadura flexión dir. ${dir}`, As_ad, As_pr, As_rq, 'CE Anejo 19 §9.2.1.1');
    const ell = dir === 'x' ? ell_x : ell_y;
    if (ell > 0) {
      checks.push(makeCheckQty(`cortante-${dir}`, `Cortante dir. ${dir} (a d del pilar)`,
        dir === 'x' ? VEd_x : VEd_y, dir === 'x' ? VRd_x : VRd_y, 'linearLoad', 'CE Anejo 19 §6.2'));
    } else {
      checks.push(makeCheckNeutral(`cortante-${dir}`, `Cortante dir. ${dir}`, `d ≥ a${dir} — N/A`, 'CE Anejo 19 §6.2'));
    }
  };
  pushDir('x');
  pushDir('y');
  // Mantener el orden histórico de las filas: biela x, biela y, flexión x, flexión y, cortante x, cortante y.
  const orden = ['biela-tirante-x', 'biela-tirante-y', 'flexion-x', 'flexion-y', 'cortante-x', 'cortante-y'];
  const armado = checks.splice(checks.length - 6, 6).sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
  checks.push(...armado);

  // Punzonamiento: también en zapata rígida. El «no hace falta» era de la
  // EHE-08; el CE (§6.4.4(2)) lo pide en la base de todo pilar.
  {
    const pos = punchingPosition === 'interior' ? '' : punchingPosition === 'borde' ? ', borde' : ', esquina';
    checks.push(makeCheckQty(
      'punzonamiento', `Punzonamiento (perímetro crítico a ${dec(a_punch / d_avg, 2)}·d${pos})`,
      vEd_punch, vRd_punch, 'stress', 'CE Anejo 19 §6.4.4(2)',
    ));
    checks.push(makeCheckQty('punzonamiento-max', 'Punzonamiento vRd,max (perímetro u0)', vEd_u0_punch, vRd_max_punch, 'stress', 'CE Anejo 19 §6.4.5(3)'));
  }

  // Anclaje de la armadura (always active — exigido en rígida y flexible)
  // Se comprueba con el vuelo mayor. En la dirección de un lindero el otro
  // extremo muere bajo el pilar, sin vuelo: ahí la barra va con patilla.
  const enLindero = (dir: 'x' | 'y') => (dir === 'x' ? tipo !== 'centrada' : tipo === 'esquina');
  const descrAnclaje = (dir: 'x' | 'y') => `Anclaje armadura dir. ${dir}${enLindero(dir) ? ' (en el lindero, patilla)' : ''}`;
  checks.push(anchorageRow('anclaje-x', descrAnclaje('x'), inp.phi_x, As_adopted_x, As_prov_x, ax));
  checks.push(anchorageRow('anclaje-y', descrAnclaje('y'), inp.phi_y, As_adopted_y, As_prov_y, ay));

  // Cuantía mínima x/y (always active). Reglas constructivas: cumplen o no.
  checks.push(makeDetailingCheck(
    'cuantia-min-x', 'Cuantía mínima dir. x',
    As_min_x, As_prov_x,
    `${As_min_x.toFixed(0)} mm²/m`, `${As_prov_x.toFixed(0)} mm²/m`,
    'CE Anejo 19 §9.2.1.1 (9.1)',
  ));
  checks.push(makeDetailingCheck(
    'cuantia-min-y', 'Cuantía mínima dir. y',
    As_min_y, As_prov_y,
    `${As_min_y.toFixed(0)} mm²/m`, `${As_prov_y.toFixed(0)} mm²/m`,
    'CE Anejo 19 §9.2.1.1 (9.1)',
  ));

  // Separación x/y (always active, max 300 mm). Regla constructiva: c/300
  // cumple y c/290 no es una advertencia.
  const s_max = 300;
  checks.push({
    id: 'separacion-x',
    description: 'Separación barras dir. x',
    value: `${inp.s_x.toFixed(0)} mm`,
    limit: `${s_max} mm`,
    utilization: inp.s_x / s_max,
    status: detailingStatus(inp.s_x / s_max),
    article: 'CE Anejo 19 §9.3.1.1(3)',
  });
  checks.push({
    id: 'separacion-y',
    description: 'Separación barras dir. y',
    value: `${inp.s_y.toFixed(0)} mm`,
    limit: `${s_max} mm`,
    utilization: inp.s_y / s_max,
    status: detailingStatus(inp.s_y / s_max),
    article: 'CE Anejo 19 §9.3.1.1(3)',
  });

  // Diámetro mínimo de la armadura principal (el menor de los dispuestos).
  const phiMenor = Math.min(inp.phi_x, inp.phi_y, ...(usaSup ? [inp.phi_sup_x, inp.phi_sup_y] : []));
  checks.push({
    id: 'diametro-min',
    description: 'Diámetro mínimo de la armadura',
    value: `Ø${phiMenor} mm`,
    limit: `≥ Ø${PHI_MIN_ZAPATA} mm`,
    utilization: PHI_MIN_ZAPATA / phiMenor,
    status: detailingStatus(PHI_MIN_ZAPATA / phiMenor),
    article: 'CE Anejo 19 §9.8.2.1(1)',
  });

  // ── Armadura superior ─────────────────────────────────────────────────────
  // Sólo aparece si el despegue la pide o si la zapata la lleva. Pedida y no
  // puesta: no cumple, con el área necesaria y unas barras que la dan.
  const filaSup = (dir: 'x' | 'y') => {
    const necesita = dir === 'x' ? necesitaSup_x : necesitaSup_y;
    const As_ad = dir === 'x' ? As_sup_adopted_x : As_sup_adopted_y;
    const As_pr = dir === 'x' ? As_prov_sup_x : As_prov_sup_y;
    const MEd_sup = dir === 'x' ? MEd_sup_x : MEd_sup_y;
    const id = `armado-sup-${dir}`;
    const art = 'CE Anejo 19 §9.8.2.1(3)';
    if (!necesita) {
      // Hay tracción arriba pero la aguanta el hormigón: se comprueba como tal.
      if (MEd_sup > M_SUP_MIN) {
        checks.push(makeCheck(
          `traccion-sup-${dir}`, `Tracción cara superior dir. ${dir} (hormigón sin armar)`,
          MEd_sup, M_fis_sup,
          `${dec(MEd_sup, 1)} kNm/m`, `${dec(M_fis_sup, 1)} kNm/m`,
          'CE Anejo 19 §9.8.2.1(3) y §12.9.3',
        ));
      }
      if (usaSup) {
        checks.push(makeCheckNeutral(id, `Armadura superior dir. ${dir}`,
          MEd_sup > M_SUP_MIN ? 'la tracción la aguanta el hormigón — no necesaria' : 'sin despegue — no necesaria', art));
      }
      return;
    }
    if (!usaSup) {
      checks.push({
        id,
        description: `Armadura superior ${dir}: la pide el despegue (p. ej. ${proponerBarras(As_ad)})`,
        value: `${As_ad.toFixed(0)} mm²/m`,
        limit: 'no lleva',
        utilization: 2,
        status: 'fail',
        article: art,
      });
      return;
    }
    checks.push(makeCheck(
      id, `Armadura superior dir. ${dir} (despegue)`,
      As_ad, As_pr,
      `${As_ad.toFixed(0)} mm²/m`, `${As_pr.toFixed(0)} mm²/m`,
      art,
    ));
  };
  filaSup('x');
  filaSup('y');
  if (usaSup) {
    for (const dir of ['x', 'y'] as const) {
      const s = dir === 'x' ? inp.s_sup_x : inp.s_sup_y;
      checks.push({
        id: `separacion-sup-${dir}`,
        description: `Separación armadura superior dir. ${dir}`,
        value: `${s.toFixed(0)} mm`,
        limit: `${s_max} mm`,
        utilization: s / s_max,
        status: detailingStatus(s / s_max),
        article: 'CE Anejo 19 §9.3.1.1(3)',
      });
    }
  }

  // Las vigas centradoras NO van como filas: no son comprobaciones de la
  // zapata, y sus esfuerzos (vigaX/vigaY) tienen su propio bloque en
  // resultados y en el PDF. Como filas «N/A» repetían esos datos y en el PDF
  // se iban solas a una segunda página.

  const overall_fail = checks.some((c) => c.status === 'fail');

  return {
    valid: !overall_fail,
    tipo, cx_pilar: cx, cy_pilar: cy, punchingPosition,
    N_sls, Mx_sls, My_sls, H_sls,
    N_elu, Mx_elu, My_elu, H_elu,
    R_sls, R_elu,
    vigaX, vigaY,
    ex_sls, ey_sls, exR_sls, eyR_sls, ex_over_B6, ey_over_L6,
    distributionType: stress.distributionType,
    sigma_max: stress.sigma_max,
    sigma_min: stress.sigma_min,
    loaded_area_fraction: stress.loaded_area_fraction,
    planoSls,
    qb, B_eq, L_eq, H_dir,
    bearing_check: { utilization: bearing_util, status: bearing_status },
    W_footing, W_soil,
    M_stab_x, M_dest_x, FS_overturn_x,
    M_stab_y, M_dest_y, FS_overturn_y,
    Rd_slide, FS_sliding,
    sigma_Ed_uniform, exE_elu: exE, eyE_elu: eyE, mensulaX, mensulaY,
    d_x, d_y, isRigid, v_max,
    ax, ay, vuelos, ell_x, ell_y,
    MEd_x, MEd_y, Td_x, Td_y,
    As_req_x, As_req_y, As_min_x, As_min_y,
    As_adopted_x, As_adopted_y, As_prov_x, As_prov_y,
    MEd_sup_x, MEd_sup_y, necesitaSup_x, necesitaSup_y, M_fis_sup,
    As_sup_adopted_x, As_sup_adopted_y, As_prov_sup_x, As_prov_sup_y,
    VEd_x, VEd_y, VRd_x, VRd_y,
    d_avg, u1: u1_rect, a_punch, u_punch, vEd_punch, vRdc_punch, vRd_punch,
    checks,
  };
}

function pushBendingOrTie(
  checks: CheckRow[],
  id: string, description: string,
  As_adopted: number, As_prov: number, As_req: number,
  article: string,
): void {
  if (As_req === Infinity) {
    checks.push({
      id, description: `${description} — sección sobrearmada`,
      value: '∞', limit: `${As_prov.toFixed(0)} mm²/m`,
      utilization: 2, status: 'fail', article,
    });
    return;
  }
  checks.push(makeCheck(
    id, description,
    As_adopted, As_prov,
    `${As_adopted.toFixed(0)} mm²/m`, `${As_prov.toFixed(0)} mm²/m`,
    article,
  ));
}
