// RC beam section solver — moment-driven analysis (CE 21.3.3)
// =============================================================================
//
// Resuelve la sección de hormigón armado a un MOMENTO DADO Md (no necesariamente
// al ELU). Devuelve strains y fuerzas movilizadas para visualizar cómo trabaja
// la sección bajo la carga real.
//
// Modelos constitutivos:
//   - Hormigón en compresión: parábola-rectángulo CE 21.3.3
//     σ_c(ε) = -fcd · [1 - (1 - ε/ε_c2)^n]   para 0 < ε < ε_c2
//     σ_c(ε) = -fcd                          para ε_c2 ≤ |ε| ≤ ε_cu
//     σ_c(ε) = 0                             para ε ≥ 0 (sección agrietada)
//   - Hormigón en tracción: cero (sección agrietada). Si Md < Mcrit usar
//     solveUncrackedSection en su lugar.
//   - Acero: bilineal elasto-plástico, σ_s = Es·ε si |ε| ≤ ε_yd, ±fyd si no.
//
// Hipótesis:
//   - Plane sections remain plane (Bernoulli)
//   - ε(y) = κ·(y - x): lineal a lo largo del canto
//     y = 0 (fibra superior) → ε = -κ·x  (compresión si κ > 0)
//     y = x (fibra neutra) → ε = 0
//     y = h (fibra inferior) → ε = κ·(h - x)  (tracción si κ > 0)
//   - Convención signos: ε > 0 = tracción, σ_c < 0 = compresión, F > 0 = tracción.
//
// Bisection on κ (curvatura): para cada κ, encontrar x por ΣF=0 (1D bisection
// sobre x). Luego computar M(x, κ). Bisection outer sobre κ ∈ [0, κ_MRd]
// hasta que M(κ) = M_target.
//
// La monotonía M(κ) NO está garantizada para secciones sobrearmadas
// (cuando As' yields en intermedio κ). Pre-sampling 20 puntos detecta y
// usa fallback de búsqueda local.

import { Es, getConcrete, getFyd, getEpsUd, type ConcreteGrade } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';
import type { SectionInputs } from './rcBeams.ts';

export interface SectionAtMomentResult {
  /** Solver mode used for transparency in tests/UI. */
  mode: 'uncracked' | 'cracked' | 'zero' | 'over-capacity';
  /** Applied moment (kNm). */
  M: number;
  /** Md user input (kNm) — preserved even when solver returns ULU state. */
  Md: number;
  /** True when M exceeded MRd; result shows section at the limit. */
  exceededCapacity: boolean;
  // Geometry
  x: number;       // neutral axis depth from top fiber (mm)
  d: number;       // effective depth (mm)
  r_s: number;     // compression rebar depth from top (mm)
  // Strains (positive = tension)
  epsilon_top: number;
  epsilon_s_comp: number;
  epsilon_s_tens: number;
  epsilon_bot: number;
  // Mobilized forces (kN, positive = tension)
  F_concrete: number;
  F_s_comp: number;
  F_s_tens: number;
  // Stresses (MPa, sign matches strain)
  sigma_s_comp: number;
  sigma_s_tens: number;
  // Material state flags
  steelYielded_tens: boolean;
  steelYielded_comp: boolean;
  concreteCrushed: boolean;
  /** ε_s_tens alcanza ε_ud → fallo por rotura del acero (pivot A en ELU). */
  steelRuptured: boolean;
  // Lever arms (mm from top)
  z_concrete: number;
  z_s_comp: number;
  z_s_tens: number;
}

// ─── Material laws ────────────────────────────────────────────────────────

/** CE 21.3.3 parábola-rectángulo. ε positiva = tracción, σ_c<0 = compresión. */
function sigma_c_pr(eps: number, fcd: number, eps_c2: number, eps_cu: number, n: number): number {
  if (eps >= 0) return 0;
  const eps_abs = -eps;
  if (eps_abs > eps_cu) return -fcd;
  if (eps_abs >= eps_c2) return -fcd;
  return -fcd * (1 - Math.pow(1 - eps_abs / eps_c2, n));
}

/** Bilineal elasto-plástico. σ negativa = compresión (consistente con ε). */
function sigma_s_bilinear(eps: number, fyd: number): number {
  const eps_yd = fyd / Es;
  if (Math.abs(eps) <= eps_yd) return Es * eps;
  return Math.sign(eps) * fyd;
}

// ─── Strip integration (Simpson on 20 strips) ─────────────────────────────

/**
 * Integra el bloque de hormigón comprimido [0, x] usando Simpson 1/3 con
 * 20 strips. Devuelve {F_c (kN), M_c (kN·mm) momento sobre fibra superior}.
 * Simpson es exacto para parábolas, así que para σ_c parabolic da error
 * de orden 0 (vs ~0.5% del midpoint).
 */
function integrateConcreteBlock(
  kappa: number, x: number, b: number, mat: ConcreteGrade,
): { F: number; M: number } {
  const N = 20;
  const dy = x / N;
  let F_sum = 0;
  let M_sum = 0;
  for (let i = 0; i <= N; i++) {
    const y = i * dy;
    const eps = kappa * (y - x);
    const weight = (i === 0 || i === N) ? 1 : (i % 2 === 0 ? 2 : 4);
    const sigma = sigma_c_pr(eps, mat.fcd, mat.eps_c2, mat.eps_cu, mat.n);
    F_sum += weight * sigma * b;
    M_sum += weight * sigma * b * y;
  }
  const F = F_sum * dy / 3 / 1000;          // N → kN
  const M = M_sum * dy / 3 / 1e6;           // N·mm → kN·m
  return { F, M };
}

// ─── solveSectionState — the primitive ────────────────────────────────────

/**
 * Dada una curvatura κ y la sección, encuentra x por ΣF = 0 y computa el
 * estado completo (strains, fuerzas, momento). Es la primitiva reusable —
 * solveSectionAtMoment es un consumer; M-κ curve sería otro; interaction
 * diagram sería otro.
 *
 * x bracket [1mm, h-1mm] (autoplan eng review #11: 1mm no 5mm; sección
 * con AsComp >> As puede tener x < 5mm cuando concreto saturado).
 */
export function solveSectionState(
  inp: SectionInputs, kappa: number,
): SectionAtMomentResult & { M_kNm: number } {
  const mat = getConcrete(inp.fck);
  const fyd = getFyd(inp.fyk);

  const d = inp.h - inp.cover - inp.stirrupDiam - inp.barDiam / 2;
  const r_s = inp.cover + inp.stirrupDiam + inp.barDiamComp / 2;
  const As = inp.nBars * getBarArea(inp.barDiam);
  const AsComp = inp.nBarsComp * getBarArea(inp.barDiamComp);

  // 1D bisection on x: ΣF = 0.
  let xLo = 1, xHi = inp.h - 1;
  let x = (xLo + xHi) / 2;
  for (let i = 0; i < 60; i++) {
    x = (xLo + xHi) / 2;
    const F = sumForces(kappa, x, inp.b, mat, fyd, d, r_s, As, AsComp);
    if (Math.abs(F) < 0.01) break;
    // F > 0 = net tension → necesita más hormigón comprimido → aumentar x
    if (F > 0) xLo = x; else xHi = x;
  }

  return buildResult(kappa, x, inp.b, inp.h, mat, fyd, d, r_s, As, AsComp);
}

function sumForces(
  kappa: number, x: number, b: number, mat: ConcreteGrade, fyd: number,
  d: number, r_s: number, As: number, AsComp: number,
): number {
  const { F: F_c } = integrateConcreteBlock(kappa, x, b, mat);
  const eps_s_comp = kappa * (r_s - x);
  const eps_s_tens = kappa * (d - x);
  const F_s_comp = AsComp * sigma_s_bilinear(eps_s_comp, fyd) / 1000;
  const F_s_tens = As * sigma_s_bilinear(eps_s_tens, fyd) / 1000;
  return F_c + F_s_comp + F_s_tens;
}

function buildResult(
  kappa: number, x: number, b: number, h: number, mat: ConcreteGrade, fyd: number,
  d: number, r_s: number, As: number, AsComp: number,
): SectionAtMomentResult & { M_kNm: number } {
  const { F: F_c, M: M_c_top } = integrateConcreteBlock(kappa, x, b, mat);
  const eps_top = -kappa * x;
  const eps_s_comp = kappa * (r_s - x);
  const eps_s_tens = kappa * (d - x);
  const eps_bot = kappa * (h - x);

  const sigma_s_comp = sigma_s_bilinear(eps_s_comp, fyd);
  const sigma_s_tens = sigma_s_bilinear(eps_s_tens, fyd);
  const F_s_comp = AsComp * sigma_s_comp / 1000;
  const F_s_tens = As * sigma_s_tens / 1000;

  const M_kNm = M_c_top + F_s_comp * r_s / 1000 + F_s_tens * d / 1000;

  // Centroid of concrete block (for SVG force diagram). M_c_top is in kNm
  // and F_c in kN, so z_c (in mm) = (M_c_top * 1e6) / (F_c * 1000) = M/F * 1000.
  const z_c = Math.abs(F_c) > 1e-9 ? Math.abs(M_c_top * 1000 / F_c) : x / 2;

  const eps_yd = fyd / Es;
  // eps_ud no se importa aquí (fyk no está disponible en buildResult). El flag
  // steelRuptured se rellena correctamente en solveAtULU; en cracked normal,
  // si ε_s > ε_ud algo está mal — usamos 0.010 como threshold conservativo.
  const STEEL_RUPTURE_THRESHOLD = 0.010;
  return {
    mode: 'cracked',
    M: M_kNm,
    Md: M_kNm,
    exceededCapacity: false,
    x, d, r_s,
    epsilon_top: eps_top,
    epsilon_s_comp: eps_s_comp,
    epsilon_s_tens: eps_s_tens,
    epsilon_bot: eps_bot,
    F_concrete: F_c,
    F_s_comp,
    F_s_tens,
    sigma_s_comp,
    sigma_s_tens,
    steelYielded_tens: Math.abs(eps_s_tens) > eps_yd,
    steelYielded_comp: Math.abs(eps_s_comp) > eps_yd,
    concreteCrushed: Math.abs(eps_top) >= mat.eps_cu - 1e-9,
    steelRuptured: eps_s_tens >= STEEL_RUPTURE_THRESHOLD - 1e-9,
    z_concrete: z_c,
    z_s_comp: r_s,
    z_s_tens: d,
    M_kNm,
  };
}

// ─── solveSectionAtMoment — the consumer ──────────────────────────────────

/**
 * Resuelve la sección para un momento Md dado. Devuelve strains + fuerzas.
 *
 * Algoritmo:
 *   1. Si Md < Mcrit (= fctm·Wg): closed-form sección no fisurada.
 *   2. Si Md ≈ 0: return zero-strain state.
 *   3. Si Md < 0: throw (V1 sagging only).
 *   4. Si Md > MRd: return ULU state + exceededCapacity flag.
 *   5. Otherwise: bisection on κ ∈ [0, κ_MRd] hasta M(κ) = Md.
 *      Si M(κ) no es monotónica (sobrearmada), fallback a búsqueda en
 *      samples (20 puntos pre-sampled).
 */
export function solveSectionAtMoment(inp: SectionInputs, M_kNm: number): SectionAtMomentResult {
  const mat = getConcrete(inp.fck);

  // Early-return degenerados.
  if (Math.abs(M_kNm) < 0.1) {
    return zeroResult(inp, mat, M_kNm);
  }
  if (M_kNm < 0) {
    throw new Error('solveSectionAtMoment: Md < 0 no soportado en V1 (modo sagging only)');
  }

  // Sub-Mcrit: usar solver no fisurado closed-form (autoplan CEO consensus).
  const Mcrit = computeMcrit(inp, mat);
  if (M_kNm < Mcrit) {
    return solveUncrackedSection(inp, mat, M_kNm);
  }

  // ULU pre-solve para fijar κ_MRd (bracket monotónico).
  const ulu = solveAtULU(inp, mat);

  // Si Md > MRd: devolver estado ULU + exceededCapacity.
  if (M_kNm > ulu.M_kNm * 1.0001) {
    return { ...ulu, mode: 'over-capacity', M: M_kNm, Md: M_kNm, exceededCapacity: true };
  }

  // Sample 20 puntos para validar monotonía (autoplan eng review #4).
  // Si no monotónica (sobrearmada con As' yielding intermedio), fallback
  // a bracketing entre samples adyacentes que contengan M_kNm.
  const N = 20;
  const samples: { kappa: number; M: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const k = (i / N) * ulu.kappa;
    const s = solveSectionState(inp, k);
    samples.push({ kappa: k, M: s.M_kNm });
  }
  const isMonotonic = samples.every((s, i) => i === 0 || s.M >= samples[i - 1].M - 1e-3);

  let kappaLo: number, kappaHi: number;
  if (isMonotonic) {
    kappaLo = 1e-7;  // floor: floating-point noise guard
    kappaHi = ulu.kappa;
  } else {
    // Buscar el bracket local que contiene M_kNm.
    let idx = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      if (samples[i].M <= M_kNm && samples[i + 1].M >= M_kNm) { idx = i; break; }
    }
    kappaLo = samples[idx].kappa;
    kappaHi = samples[Math.min(idx + 1, samples.length - 1)].kappa;
    console.warn('solveSectionAtMoment: M(κ) no monotónica — bracketing local entre samples',
                 { M_kNm, idx, kappaLo, kappaHi });
  }

  // Bisection.
  const tolM = Math.max(0.05, 0.001 * M_kNm);
  let result = solveSectionState(inp, (kappaLo + kappaHi) / 2);
  for (let i = 0; i < 60; i++) {
    const kappa = (kappaLo + kappaHi) / 2;
    result = solveSectionState(inp, kappa);
    if (Math.abs(result.M_kNm - M_kNm) < tolM) break;
    if (result.M_kNm < M_kNm) kappaLo = kappa; else kappaHi = kappa;
  }
  result.Md = M_kNm;
  result.M = result.M_kNm;
  return result;
}

/**
 * Solves at ULU usando el "diagrama de pivotes" CE 21.3.4.
 *
 * Detección automática del pivote limitante:
 *   - Pivot B (concrete-controlled): ε_top = -ε_cu fixed. Si la x resultante
 *     produce ε_s_tens ≤ ε_ud, la sección falla por aplastamiento → pivot B.
 *   - Pivot A (steel-controlled): ε_s_tens = ε_ud fixed at y=d. Si pivot B
 *     produce ε_s_tens > ε_ud, la sección habría roto antes por el acero.
 *     Re-resolver con ε_s_tens = ε_ud (sec. infra-armada típica).
 *
 * Esto evita el bug visual donde ε_bot mostraba valores físicamente
 * imposibles (30‰+) en secciones tension-controlled.
 */
export function solveAtULU(inp: SectionInputs, mat: ConcreteGrade): SectionAtMomentResult & { M_kNm: number; kappa: number } {
  const fyd = getFyd(inp.fyk);
  const eps_ud = getEpsUd(inp.fyk);
  const d = inp.h - inp.cover - inp.stirrupDiam - inp.barDiam / 2;
  const r_s = inp.cover + inp.stirrupDiam + inp.barDiamComp / 2;
  const As = inp.nBars * getBarArea(inp.barDiam);
  const AsComp = inp.nBarsComp * getBarArea(inp.barDiamComp);

  // 1) Intento pivot B: ε_top = -ε_cu fijo, x libre por equilibrio.
  let xLo = 1, xHi = inp.h - 1;
  let x = (xLo + xHi) / 2;
  for (let i = 0; i < 80; i++) {
    x = (xLo + xHi) / 2;
    const kappa = mat.eps_cu / x;
    const F = sumForces(kappa, x, inp.b, mat, fyd, d, r_s, As, AsComp);
    if (Math.abs(F) < 0.01) break;
    if (F > 0) xLo = x; else xHi = x;
  }
  const kappa_B = mat.eps_cu / x;
  const eps_s_at_B = kappa_B * (d - x);

  // Si en pivot B el acero NO ha roto (ε_s ≤ ε_ud), pivot B es el ELU real.
  if (eps_s_at_B <= eps_ud + 1e-9) {
    // buildResult directo con (κ_B, x_B) para preservar exactamente el pivote.
    // No usar solveSectionState que re-bisecciona x.
    const state = buildResult(kappa_B, x, inp.b, inp.h, mat, fyd, d, r_s, As, AsComp);
    return { ...state, M_kNm: state.M_kNm, kappa: kappa_B };
  }

  // 2) Pivot A: ε_s_tens = ε_ud fijo en y=d → κ = ε_ud / (d - x). x libre.
  // ε_top = -κ·x = -ε_ud · x / (d - x). Crece con x, max |ε_top| < ε_cu.
  xLo = 1; xHi = inp.h - 1;
  let x_A = (xLo + xHi) / 2;
  for (let i = 0; i < 80; i++) {
    x_A = (xLo + xHi) / 2;
    if (x_A >= d) { xHi = x_A; continue; } // singularidad d-x=0
    const kappa = eps_ud / (d - x_A);
    const F = sumForces(kappa, x_A, inp.b, mat, fyd, d, r_s, As, AsComp);
    if (Math.abs(F) < 0.01) break;
    if (F > 0) xLo = x_A; else xHi = x_A;
  }
  const kappa_A = eps_ud / (d - x_A);
  // buildResult directo con (κ_A, x_A) — solveSectionState re-bisectaría x
  // con κ fijo, lo cual rompería la condición pivote A (ε_s = ε_ud).
  const state = buildResult(kappa_A, x_A, inp.b, inp.h, mat, fyd, d, r_s, As, AsComp);
  return { ...state, M_kNm: state.M_kNm, kappa: kappa_A };
}

// ─── Mcrit + uncracked closed-form (sub-cracking) ─────────────────────────

/** Mcrit ≈ fctm · W_g (gross section modulus). kNm. */
function computeMcrit(inp: SectionInputs, mat: ConcreteGrade): number {
  const W_g = (inp.b * inp.h * inp.h) / 6;  // mm³ (gross, no rebars)
  return (mat.fctm * W_g) / 1e6;            // N·mm → kNm
}

/**
 * Closed-form sección no fisurada (Bernoulli + Hooke). Para Md < Mcrit:
 * la sección bruta sigue trabajando elásticamente. Aproximación: ignora
 * el cambio de rigidez por las armaduras (homogeneización), suficientemente
 * preciso para el rango Md < Mcrit donde los strains son pequeños.
 *
 * Resuelve elásticamente: σ_top = -M·c_top/I, σ_bot = M·c_bot/I, neutral
 * axis al centroide (h/2 para rect bruta), strains lineales.
 */
function solveUncrackedSection(
  inp: SectionInputs, mat: ConcreteGrade, M_kNm: number,
): SectionAtMomentResult {
  const Ec = mat.Ecm * 1000;                // MPa
  const I_g = (inp.b * Math.pow(inp.h, 3)) / 12; // mm⁴
  const c_top = inp.h / 2;                  // centroide en h/2
  const M_Nmm = M_kNm * 1e6;
  const sigma_top = -M_Nmm * c_top / I_g;   // negativa = compresión
  const eps_top = sigma_top / Ec;

  const d = inp.h - inp.cover - inp.stirrupDiam - inp.barDiam / 2;
  const r_s = inp.cover + inp.stirrupDiam + inp.barDiamComp / 2;
  const x = inp.h / 2;                      // fibra neutra en centroide (no fisurado)
  const kappa = -eps_top / x;               // ε_top = -κ·x → κ = -ε_top/x

  const eps_s_comp = kappa * (r_s - x);
  const eps_s_tens = kappa * (d - x);
  const eps_bot = kappa * (inp.h - x);

  const fyd = getFyd(inp.fyk);
  const sigma_s_comp = sigma_s_bilinear(eps_s_comp, fyd);
  const sigma_s_tens = sigma_s_bilinear(eps_s_tens, fyd);
  const As = inp.nBars * getBarArea(inp.barDiam);
  const AsComp = inp.nBarsComp * getBarArea(inp.barDiamComp);
  const F_s_comp = AsComp * sigma_s_comp / 1000;
  const F_s_tens = As * sigma_s_tens / 1000;
  const F_c = -(F_s_comp + F_s_tens);  // equilibrio: F_c = -(F_s' + F_s) en uncracked

  return {
    mode: 'uncracked',
    M: M_kNm, Md: M_kNm,
    exceededCapacity: false,
    x, d, r_s,
    epsilon_top: eps_top,
    epsilon_s_comp: eps_s_comp,
    epsilon_s_tens: eps_s_tens,
    epsilon_bot: eps_bot,
    F_concrete: F_c,
    F_s_comp,
    F_s_tens,
    sigma_s_comp,
    sigma_s_tens,
    steelYielded_tens: Math.abs(eps_s_tens) > fyd / Es,
    steelYielded_comp: Math.abs(eps_s_comp) > fyd / Es,
    concreteCrushed: false,
    steelRuptured: false,
    z_concrete: x / 2,
    z_s_comp: r_s,
    z_s_tens: d,
  };
}

function zeroResult(inp: SectionInputs, mat: ConcreteGrade, M_kNm: number): SectionAtMomentResult {
  void mat;
  const d = inp.h - inp.cover - inp.stirrupDiam - inp.barDiam / 2;
  const r_s = inp.cover + inp.stirrupDiam + inp.barDiamComp / 2;
  return {
    mode: 'zero',
    M: M_kNm, Md: M_kNm, exceededCapacity: false,
    x: 0, d, r_s,
    epsilon_top: 0, epsilon_s_comp: 0, epsilon_s_tens: 0, epsilon_bot: 0,
    F_concrete: 0, F_s_comp: 0, F_s_tens: 0,
    sigma_s_comp: 0, sigma_s_tens: 0,
    steelYielded_tens: false, steelYielded_comp: false, concreteCrushed: false,
    steelRuptured: false,
    z_concrete: 0, z_s_comp: r_s, z_s_tens: d,
  };
}
