// RC Beam calculations — Codigo Estructural (CE) Spain
// All units: mm, MPa, kN, kNm unless noted.
//
// CE Anejo 19 §3.1     — Concrete material properties
// CE Anejo 19 §6.1     — Bending resistance (ELU Flexion simple)
// CE Anejo 19 §9.2.1.1   — Reinforcement limits
// CE Anejo 19 §6.2     — Shear resistance (ELU Cortante)
// CE Anejo 19 §9.2.2(5) — rho_w,min (minimum transverse reinforcement ratio)
// CE Anejo 19 §7.3 — Crack width (ELS Fisuracion)
// CE Anejo 19 §8.2   — Bar spacing
// CE Anejo 19 §8.7.3 — Lap lengths

import { type RCBeamInputs } from '../../data/defaults.ts';
import { getConcrete, getFyd, Es } from '../../data/materials.ts';
import { crackedDeflectionFactor } from './crackedDeflection.ts';
import { rcElasticModulusMPa } from '../frame-core/sections.ts';
import { getBarArea } from '../../data/rebar.ts';
import { COT_THETA_CORTANTE, GAMMA_C, wkMax } from '../../data/factors.ts';
import { type CheckRow, detailingStatus, toStatus, makeCheck as check, makeCheckQty, makeDetailingCheck as regla } from './types.ts';
import { solveAtULU } from './rcBeamsSection.ts';
import { asMinRectangular, CUANTIA_MAXIMA } from './cuantiaMinima.ts';
import { dec } from '../units/format.ts';

export type { CheckStatus, CheckRow } from './types.ts';

export interface RCBeamSectionResult {
  valid: boolean;
  error?: string;
  // Geometry
  d: number;        // effective depth (mm) — from compression face to tension steel centroid
  As: number;       // tension steel area (mm2)
  AsComp: number;   // compression steel area (mm2)
  Asw: number;      // stirrup area per unit length (mm2/mm)
  // Bending
  x: number;      // neutral axis depth (mm)
  MRd: number;    // design bending resistance (kNm)
  // Shear
  VRdc: number;   // shear without stirrups (kN)
  VRds: number;   // shear with stirrups (kN)
  VRd: number;    // governing shear resistance (kN)
  VRdmax: number; // max strut crushing (kN)
  // Cracking
  wk: number;     // crack width (mm)
  wkMax: number;  // limit for exposure class (mm)
  // Rebar info
  lapLength: number;     // minimum lap length (mm)
  rebarSchedule: string; // e.g. "4Ø16(t) + 2Ø12(c) + Ø8/c150 (2R)"
  checks: CheckRow[];
}

export interface RCBeamResult {
  valid: boolean;
  error?: string;
  vano: RCBeamSectionResult;    // midspan — positive bending M+
  apoyo: RCBeamSectionResult;   // support — negative bending M-
}

// psi2 quasi-permanent load combination factor (CE Table 12.1)
const PSI2_MAP: Record<string, number> = {
  residential: 0.3,
  office: 0.3,
  parking: 0.6,
  roof: 0.0,
  custom: 0.0, // overridden by psi2Custom when loadType='custom'
};


export interface SectionInputs {
  b: number;
  h: number;
  cover: number;
  stirrupDiam: number;
  stirrupLegs: number;
  fck: number;
  fyk: number;
  exposureClass: string;
  Md: number;
  VEd: number;
  Ms: number;             // quasi-permanent SLS moment (kNm)
  nBars: number;          // tension bars
  barDiam: number;        // tension bar diameter
  nBarsComp: number;      // compression bars
  barDiamComp: number;    // compression bar diameter
  stirrupSpacing: number;
  bondClass: 'good' | 'poor';
}

/**
 * Extracts SectionInputs (used by both calcRCBeam and solveSectionAtMoment)
 * from RCBeamInputs for the given section kind. M+ uses vano fields with
 * bottom-reinforcement-as-tension; M− uses apoyo fields with top-as-tension.
 *
 * Mode 'simple' V1: sagging only → use 'vano' kind (bottom = tension, top = compression).
 */
export function pickSectionInputs(state: RCBeamInputs, kind: 'vano' | 'apoyo'): SectionInputs {
  const isVano = kind === 'vano';
  // Los momentos se introducen como magnitudes (|M-| en apoyo). Se normaliza
  // el signo con Math.abs() — un M- tecleado con su signo natural no debe
  // desactivar checks en silencio ni romper solveSectionAtMoment (throw con
  // Md<0 durante el render del modo simple). Fix auditoría #60.
  return {
    b: state.b,
    h: state.h,
    cover: state.cover,
    stirrupDiam: isVano ? state.vano_stirrupDiam : state.apoyo_stirrupDiam,
    stirrupLegs: isVano ? state.vano_stirrupLegs : state.apoyo_stirrupLegs,
    fck: state.fck,
    fyk: state.fyk,
    exposureClass: state.exposureClass,
    Md: Math.abs(isVano ? state.vano_Md : state.apoyo_Md),
    VEd: Math.abs(isVano ? state.vano_VEd : state.apoyo_VEd),
    // Cuasipermanente = M_G + psi2·M_Q (NO psi2·(M_G+M_Q); fix auditoría #71),
    // idéntica a la de calcRCBeam.
    Ms: Math.abs(isVano
      ? (state.vano_M_G + psi2Quasi(state) * state.vano_M_Q)
      : (state.apoyo_M_G + psi2Quasi(state) * state.apoyo_M_Q)),
    nBars: isVano ? state.vano_bot_nBars : state.apoyo_top_nBars,
    barDiam: isVano ? state.vano_bot_barDiam : state.apoyo_top_barDiam,
    nBarsComp: isVano ? state.vano_top_nBars : state.apoyo_bot_nBars,
    barDiamComp: isVano ? state.vano_top_barDiam : state.apoyo_bot_barDiam,
    stirrupSpacing: isVano ? state.vano_stirrupSpacing : state.apoyo_stirrupSpacing,
    // CE Anejo 19 §8.4.2(2) y figura A19.8.2: bondClass depends on bar POSITION,
    // not user choice (hasta 2026-09-25 citaba «§69.5.1.2», numeración de la EHE-08).
    // Vano tension bars are at the bottom (favorable position → 'good'); apoyo
    // tension bars are at the top (unfavorable for h > 250 mm → 'poor').
    // Matches the hardcoded values in calcRCBeam at the two calcSection sites.
    bondClass: isVano ? 'good' : 'poor',
  };
}

/**
 * ψ₂ EFECTIVO de la combinación cuasipermanente (Tabla 12.1), resolviendo el
 * escape de `loadType: 'custom'` hacia `psi2Custom`. Exportado porque es la
 * magnitud que hay que vigilar en el guardarraíl del asistente: ni el enum ni
 * `psi2Custom` por separado dicen la verdad (ver ai/modules/rcBeams.ts, fuga 2).
 */
export function psi2Quasi(state: RCBeamInputs): number {
  const lt = state.loadType;
  if (lt === 'custom') return state.psi2Custom;
  return PSI2_MAP[lt] ?? 0.3;
}

// ── Cortante HA (CE Anejo 19 §6.2) — extraído de calcSection para compartirlo
// con el FEM 2D (cortante de PILARES con axil). Mismo orden aritmético que el
// bloque inline original: con sigmaCp = 0 y hasStirrups el resultado es
// float-idéntico (sumando literal +0 y factor ·1), anclado por los tests de
// paridad existentes (en los defaults, VRdmax ≈ 442.2 con cot θ = 2 y
// VRdc ≈ 66.7).
//
// El término de axil k1·σcp (EC2/CE §6.2.2(1), k1 = 0.15) entra CON SIGNO
// (σcp < 0 = tracción REDUCE VRd,c — truncarla a 0 sería inseguro en
// pilares-tirante), con cap superior +0.2·fcd y suelo VRdc ≥ 0. αcw
// (§6.2.3(3)) amplifica VRd,max solo con compresión (tramo 1+σcp/fcd, que es
// el único alcanzable con el cap 0.2·fcd).
//
// POLÍTICA VRd: la de VIGA (hasStirrups ? min(VRds, VRdmax) : VRdc) — el
// caller de pilar aplica la suya (max(VRdc, min(VRds, VRdmax)), §6.2.1(4):
// con VEd ≤ VRd,c no se exige armadura de cortante calculada).

export interface RcShearParams {
  b: number;            // mm
  d: number;            // mm
  fck: number;          // MPa
  fcd: number;          // MPa
  fyd: number;          // MPa (armadura transversal)
  As: number;           // mm² — armadura longitudinal TRACCIONADA (para ρl)
  Asw: number;          // mm²/mm (área de cercos por unidad de longitud)
  hasStirrups: boolean; // política de viga: sin cercos → VRd = VRdc
  /** σcp = NEd/Ac (MPa, + compresión, − tracción). Default 0. */
  sigmaCp?: number;
}

export interface RcShearResult {
  VRdc: number;    // kN
  VRds: number;    // kN
  VRdmax: number;  // kN
  VRd: number;     // kN — política de VIGA
  k: number;
  rhoL: number;
  nu1: number;
  alphaCw: number;
  sigmaCpEff: number; // MPa tras el cap +0.2·fcd
}

export function calcRcShear(p: RcShearParams): RcShearResult {
  const k = Math.min(1 + Math.sqrt(200 / p.d), 2.0);
  const rhoL = Math.min(p.As / (p.b * p.d), 0.02);
  // (100·rho_l·fck)^(1/3) — el 100 es parte de la formula EC2 6.2.a
  // (fix auditoría #68; mismo fix que rcSlabs #38).
  const VRdc1 = ((0.18 / GAMMA_C) * k * Math.pow(100 * rhoL * p.fck, 1 / 3) * p.b * p.d) / 1000;
  const VRdc2 = ((0.051 / GAMMA_C) * Math.pow(k, 1.5) * Math.sqrt(p.fck) * p.b * p.d) / 1000;
  const sigmaCpEff = Math.min(p.sigmaCp ?? 0, 0.2 * p.fcd);
  const VRdc = Math.max(Math.max(VRdc1, VRdc2) + (0.15 * sigmaCpEff * p.b * p.d) / 1000, 0);

  const z = 0.9 * p.d;
  // cot θ = 2, el tope del CE (Anejo 19 §6.2.3(2)); era 2,5, el del EC2.
  const cotTheta = COT_THETA_CORTANTE;
  const VRds = (p.Asw * z * p.fyd * cotTheta) / 1000;
  // VRd,max con el MISMO θ que VRd,s (CE Anejo 19 §6.2.3(3)): para cotθ=2
  // el divisor es (cotθ+tanθ)=2,5, no el 0.3·fcd·b·z de θ=45° (fix auditoría
  // #59; mismo fix que rcSlabs #3).
  const nu1 = 0.6 * (1 - p.fck / 250);
  const alphaCw = sigmaCpEff > 0 ? Math.min(1 + sigmaCpEff / p.fcd, 1.25) : 1;
  const VRdmax = (alphaCw * ((nu1 * p.fcd * p.b * z) / (cotTheta + 1 / cotTheta))) / 1000;
  const VRd = p.hasStirrups ? Math.min(VRds, VRdmax) : VRdc;

  return { VRdc, VRds, VRdmax, VRd, k, rhoL, nu1, alphaCw, sigmaCpEff };
}

// ── Fisuración (CE Anejo 19 §7.3) ────────────────────────────────────────────
// Fuera de calcSection para que el lienzo dibuje los MISMOS intermedios que
// dan el wk de la tabla (Ac,ef, sr,max, σs) en vez de recomponerlos.

/** Qué término fija la altura eficaz a tracción hc,ef (§7.3.2(3)). */
export type ReglaHcEf = 'h-d' | 'h-x' | 'h/2';

export interface FisuracionRC {
  /** Coeficiente de equivalencia Es/Ecm (corto plazo). */
  n: number;
  /** Fibra neutra de la sección fisurada en servicio, mm desde la cara comprimida. */
  xCr: number;
  /** Inercia fisurada homogeneizada, mm⁴ (sólo la armadura traccionada). */
  Icr: number;
  /** Momento casi permanente con el que se fisura, kNm. */
  Ms: number;
  /** Tensión del acero traccionado y del hormigón en la cara, N/mm². */
  sigmaS: number;
  sigmaC: number;
  /** Altura eficaz a tracción y cuál de los tres términos la fija. */
  hcEf: number;
  reglaHcEf: ReglaHcEf;
  AcEff: number;
  rhoEff: number;
  /** Recubrimiento de la armadura longitudinal (r + Øcerco), mm. */
  cLong: number;
  /** Separación entre ejes de barras, mm (∞ con una barra). */
  ejes: number;
  /** Barras a más de 5·(c + Ø/2): sr,max = 1,3·(h − x). */
  srLargo: boolean;
  srMax: number;
  /** Los dos términos de εsm − εcm, y el que manda. */
  epsDif1: number;
  epsDif2: number;
  epsDif: number;
  wk: number;
}

export function fisuracionRC(inp: SectionInputs, As: number, d: number): FisuracionRC {
  const mat = getConcrete(inp.fck);
  const Ecm_MPa = mat.Ecm * 1000; // GPa -> MPa
  const n = Es / Ecm_MPa;
  const A_coef = 0.5 * inp.b;
  const B_coef = n * As;
  const C_coef = -n * As * d;
  const xCr = (-B_coef + Math.sqrt(B_coef ** 2 - 4 * A_coef * C_coef)) / (2 * A_coef);
  const Icr = (inp.b * xCr ** 3) / 3 + n * As * (d - xCr) ** 2;

  const hMinusD = inp.h - d;
  const terminos: [number, ReglaHcEf][] = [[2.5 * hMinusD, 'h-d'], [(inp.h - xCr) / 3, 'h-x'], [inp.h / 2, 'h/2']];
  const [hcEf, reglaHcEf] = terminos.reduce((a, t) => (t[0] < a[0] ? t : a));
  // sr,max = 3.4*c + 0.425*k1*k2*(phi/rhoEff), k1=0.8 k2=0.5.
  // c = recubrimiento de la armadura LONGITUDINAL (cover + estribo), no el
  // recubrimiento nominal al estribo (EC2 7.3.4; fix auditoría #66).
  const cLong = inp.cover + inp.stirrupDiam;
  // Limite de validez EC2 7.3.4(3): la formula solo vale si la separacion
  // entre ejes de barras <= 5(c + phi/2); si no, sr,max = 1.3(h - x)
  // (fix auditoría #70). nBars=1 → separacion no definida → rama conservadora.
  const ejes = inp.nBars > 1
    ? (inp.b - 2 * cLong - inp.barDiam) / (inp.nBars - 1)
    : Infinity;
  const srLargo = ejes > 5 * (cLong + inp.barDiam / 2);

  let sigmaS = 0;
  let sigmaC = 0;
  let AcEff = hcEf * inp.b;
  let rhoEff = As / AcEff;
  let srMax = 0;
  let epsDif1 = 0;
  let epsDif2 = 0;
  let wk = 0;
  if (inp.Ms > 0) {
    sigmaS = (inp.Ms * 1e6 * (d - xCr) * n) / Icr;
    sigmaC = (inp.Ms * 1e6 * xCr) / Icr;
    AcEff = Math.min(
      2.5 * hMinusD * inp.b,
      ((inp.h - xCr) / 3) * inp.b,
      (inp.h / 2) * inp.b,
    );
    rhoEff = As / AcEff;
    srMax = 3.4 * cLong + 0.425 * 0.8 * 0.5 * (inp.barDiam / rhoEff);
    if (srLargo) {
      srMax = 1.3 * (inp.h - xCr);
    }
    const kt = 0.4;
    epsDif1 = (sigmaS - kt * (mat.fctm / rhoEff) * (1 + n * rhoEff)) / Es;
    epsDif2 = (0.6 * sigmaS) / Es;
    wk = srMax * Math.max(epsDif1, epsDif2, 0);
  }

  return {
    n, xCr, Icr, Ms: inp.Ms, sigmaS, sigmaC, hcEf, reglaHcEf, AcEff, rhoEff, cLong, ejes, srLargo, srMax,
    epsDif1, epsDif2, epsDif: Math.max(epsDif1, epsDif2, 0), wk,
  };
}

function invalidSection(error: string): RCBeamSectionResult {
  return {
    valid: false, error,
    d: 0, As: 0, AsComp: 0, Asw: 0, x: 0,
    MRd: 0, VRdc: 0, VRds: 0, VRd: 0, VRdmax: 0,
    wk: 0, wkMax: 0, lapLength: 0, rebarSchedule: '',
    checks: [],
  };
}

function calcSection(inp: SectionInputs): RCBeamSectionResult {
  // Per-section geometry validation
  if (inp.h <= inp.cover + inp.stirrupDiam + inp.barDiam / 2)
    return invalidSection('Canto insuficiente para el diametro de barra');

  const mat = getConcrete(inp.fck);
  const fcd = mat.fcd;
  const fyd = getFyd(inp.fyk);

  // Effective depth: d = h - cover - stirrupDiam - barDiam/2  (CE Anejo 19 §6.1)
  const d = inp.h - inp.cover - inp.stirrupDiam - inp.barDiam / 2;

  const barArea = getBarArea(inp.barDiam);
  const As = inp.nBars * barArea;

  const barAreaComp = getBarArea(inp.barDiamComp);
  const AsComp = inp.nBarsComp * barAreaComp;

  const stirrupArea = getBarArea(inp.stirrupDiam);
  const Asw_total = inp.stirrupLegs * stirrupArea; // mm2 per stirrup set
  const hasStirrups = inp.stirrupSpacing > 0;
  const Asw = hasStirrups ? Asw_total / inp.stirrupSpacing : 0; // mm2/mm

  const checks: CheckRow[] = [];

  // BENDING (CE Anejo 19 §6.1) ────────────────────────────────────────────────
  // Over-reinforcement limit: x <= xLimit = ecu3/(ecu3+eyd) * d
  const ecu3 = 0.0035;
  const eyd = fyd / Es;
  const xLimit = (ecu3 / (ecu3 + eyd)) * d;

  // MRd y x salen del solver de compatibilidad de deformaciones — parábola-
  // rectángulo CE 21.3.3 + diagrama de pivotes CE 21.3.4 (solveAtULU). Es la
  // ÚNICA fuente de verdad para la capacidad última: el mismo motor que
  // alimenta los diagramas de fuerzas de la vista simple, así que header y
  // dibujo nunca discrepan. Resuelve correctamente secciones infra- y
  // sobre-armadas (en éstas el acero no plastifica) e incluye la contribución
  // del acero comprimido. Sustituye al bloque de Whitney As·fyd/(0.8·b·fcd),
  // que para secciones sobrearmadas divergía (x → ∞, MRd negativo).
  const ulu = solveAtULU(inp, mat);
  const x = ulu.x;
  const MRd = ulu.M_kNm;

  checks.push(makeCheckQty(
    'bending',
    'Momento resistente MRd >= Md',
    inp.Md, MRd,
    'moment',
    'CE Anejo 19 §6.1',
  ));

  // Over-reinforcement warn — fixes P2 silent gap in TODOS.md
  if (x > xLimit) {
    checks.push({
      id: 'bending-over',
      description: 'Seccion sobrearmada (x > x,lim)',
      value: `x = ${x.toFixed(0)} mm`,
      limit: `x,lim = ${xLimit.toFixed(0)} mm`,
      utilization: x / xLimit,
      status: 'warn',
      article: 'CE Anejo 19 §6.1',
    });
  }

  // MIN REINFORCEMENT tension — CE Anejo 19 §9.2.1.1 (9.1) ─────────────────
  // As,min = W/z · fctm,fl/fyd con W = b·h²/6 de la sección bruta y z = 0,8·h
  // (ver cuantiaMinima.ts). Hasta el 2026-09-25 era el 2,8 ‰·b·h de la tabla
  // 42.3.5 de la EHE-08, que el CE no tiene: el doble en una viga 30×50.
  const AsMin = asMinRectangular(inp.b, inp.h, mat.fctm, fyd);

  checks.push(regla(
    'as-min',
    'Armadura minima traccion',
    AsMin, As,
    `As,min = ${AsMin.toFixed(0)} mm\u00b2`,
    `As = ${As.toFixed(0)} mm\u00b2`,
    'CE Anejo 19 §9.2.1.1 (9.1)',
  ));

  // Ya no hay mínimo de compresión: el 0,001·b·d «constructivo» citaba el
  // §9.2.1.1, que no fija ninguno, y hacía INCUMPLIR una viga sin montaje.

  // MAX REINFORCEMENT — CE Anejo 19 §9.2.1.1(3): la de tracción O la de
  // compresión ≤ 0,04·Ac, cada una por su lado (antes se sumaban).
  const AsMaxCara = Math.max(As, AsComp);
  const AsMax = CUANTIA_MAXIMA * inp.b * inp.h;
  checks.push(regla(
    'as-max',
    'Armadura maxima (traccion o compresion)',
    AsMaxCara, AsMax,
    `As = ${AsMaxCara.toFixed(0)} mm\u00b2`,
    `As,max = ${AsMax.toFixed(0)} mm\u00b2`,
    'CE Anejo 19 §9.2.1.1(3)',
  ));

  // SHEAR (CE Anejo 19 §6.2) — delega en calcRcShear (compartida con el
  // cortante de pilares del FEM 2D); sigmaCp = 0 ⇒ float-idéntico al bloque
  // inline histórico (anclado por los tests de paridad).
  const { VRdc, VRds, VRdmax, VRd } = calcRcShear({
    b: inp.b, d, fck: inp.fck, fcd, fyd, As, Asw, hasStirrups, sigmaCp: 0,
  });

  checks.push(makeCheckQty(
    'shear',
    'Cortante VEd <= VRd',
    inp.VEd, VRd,
    'force',
    'CE Anejo 19 §6.2',
  ));

  if (hasStirrups) {
    checks.push(makeCheckQty(
      'shear-max',
      'Aplastamiento biela comprimida VEd <= VRd,max',
      inp.VEd, VRdmax,
      'force',
      'CE Anejo 19 §6.2',
    ));
  }

  // rho_w,min (CE Anejo 19 / EC2 §9.2.2 ec. 9.5N: 0.08·√fck/fyk) ─────────
  if (hasStirrups) {
    const rhoWMin = (0.08 * Math.sqrt(inp.fck)) / inp.fyk;
    const rhoW = Asw_total / (inp.stirrupSpacing * inp.b);
    const rhoWUtil = rhoWMin / rhoW; // ≤ 1 = rhoW >= rhoWMin = ok

    // Regla constructiva: cumple o no, y ρw = ρw,min cumple. Hasta el
    // 2026-09-27 el caso límite salía INCUMPLE, la fila advertía también
    // cuando s > 0,75·d (eso lo dice la fila de separación, justo debajo) y
    // citaba el §6.2.3, que es el cálculo de la armadura, no su mínimo.
    checks.push({
      id: 'rho-w-min',
      description: 'Cuantia minima de armadura transversal',
      value: `\u03c1w = ${dec(rhoW, 5)}`,
      limit: `\u03c1w,min = ${dec(rhoWMin, 5)}`,
      utilization: rhoWUtil,
      status: detailingStatus(rhoWUtil),
      article: 'CE Anejo 19 §9.2.2(5)',
    });

    // MAX STIRRUP SPACING (CE Anejo 19 §9.2.2(6)) ─────────────────────────────
    const sMax = Math.min(0.75 * d, 300);
    checks.push(regla(
      'stirrup-spacing-max',
      'Separacion maxima entre estribos',
      inp.stirrupSpacing, sMax,
      `s = ${inp.stirrupSpacing} mm`,
      `s,max = ${sMax.toFixed(0)} mm`,
      'CE Anejo 19 §9.2.2(6)',
    ));

    // TRANSVERSE STIRRUP LEG SPACING (CE Anejo 19 §9.2.2(8)) ─────────
    // stirrupLegs >= 2 garantizado por la UI; el guard evita la division por
    // cero (s_t = Infinity) si llega un 1 por via programatica (auditoría #64).
    if (inp.stirrupLegs >= 2) {
      const innerWidth = inp.b - 2 * inp.cover - 2 * inp.stirrupDiam;
      const s_t = innerWidth / (inp.stirrupLegs - 1);
      const s_t_max = Math.min(0.75 * d, 600);
      checks.push(regla(
        'stirrup-legs-spacing',
        'Separacion transversal de ramas de cercos',
        s_t, s_t_max,
        `s_t = ${s_t.toFixed(0)} mm`,
        `s_t,max = ${s_t_max.toFixed(0)} mm`,
        'CE Anejo 19 §9.2.2(8)',
      ));
    }
  } else {
    // Sin cercos: en vigas la armadura transversal minima es OBLIGATORIA
    // (CE Anejo 19 §9.2.2(4)-(5)) — no es una configuracion verificable.
    // Fila fail explicita en vez de silencio (fix auditoría #69).
    const rhoWMin = (0.08 * Math.sqrt(inp.fck)) / inp.fyk;
    checks.push({
      id: 'rho-w-min',
      description: 'Cuantia minima de armadura transversal (obligatoria en vigas)',
      value: 'ρw = 0 (sin cercos)',
      limit: `ρw,min = ${dec(rhoWMin, 5)}`,
      utilization: Infinity,
      status: 'fail',
      article: 'CE Anejo 19 §9.2.2(5)',
    });
  }

  // BAR SPACING (CE Anejo 19 §8.2) ──────────────────────────────────────────
  if (inp.nBars === 1) {
    checks.push({
      id: 'bar-spacing',
      description: 'Separacion entre barras',
      value: 'N/A',
      limit: 'Barra unica',
      utilization: 0,
      status: 'ok',
      article: 'CE Anejo 19 §8.2',
    });
  } else {
    // Net space remaining after placing all bars side-by-side within stirrups
    const available = inp.b - 2 * inp.cover - 2 * inp.stirrupDiam - inp.nBars * inp.barDiam;

    if (available <= 0) {
      checks.push({
        id: 'bar-spacing-impossible',
        description: 'Barras no caben en la seccion',
        value: `Espacio disponible: ${available.toFixed(0)} mm`,
        limit: '> 0 mm',
        utilization: Infinity,
        status: 'fail',
        article: 'CE Anejo 19 §8.2',
      });
    } else {
      const spacing = available / (inp.nBars - 1);
      const minLimit = Math.max(inp.barDiam, 20);
      const maxLimit = Math.min(300, 3 * inp.h);

      // Regla constructiva: dentro del intervalo cumple, los dos extremos
      // incluidos, y sin advertencia al 95 % del máximo.
      const spacingUtil = spacing < minLimit
        ? minLimit / spacing  // > 1 = fail (too narrow)
        : spacing / maxLimit; // > 1 = fail (too wide)
      const spacingStatus = detailingStatus(spacingUtil);

      checks.push({
        id: 'bar-spacing',
        description: 'Separacion entre barras',
        value: `s = ${spacing.toFixed(0)} mm`,
        limit: `${minLimit}-${maxLimit} mm`,
        utilization: spacingUtil,
        status: spacingStatus,
        article: 'CE Anejo 19 §8.2',
      });
    }
  }

  // CRACKING (CE Anejo 19 §7.3) ────────────────────────────────────────────
  const { wk } = fisuracionRC(inp, As, d);

  const wkLim = wkMax[inp.exposureClass] ?? 0.3;

  checks.push(check(
    'cracking',
    `Ancho de fisura wk <= wmax (clase ${inp.exposureClass})`,
    wk, wkLim,
    `wk = ${dec(wk, 3)} mm`,
    `wmax = ${dec(wkLim, 2)} mm`,
    'CE Anejo 19 §7.3',
  ));

  // LAP LENGTH (CE Anejo 19 §8.7.3 / EC2) ────────────────────────────────
  // l0 = α6·lb,rqd ≥ l0,min con lb,rqd = (φ/4)·(σsd/fbd), σsd = fyd,
  // fbd = 2.25·η1·η2·fctd, fctd = 0.7·fctm/γc, α6 = 1.5 (100% solapado),
  // l0,min = max(0.3·α6·lb,rqd; 15φ; 200 mm).
  // Antes: 60φ/84φ fijos, calibrados solo para C25+B500 — quedaban cortos
  // para fck<25 o B600 (fix auditoría #65).
  const eta1 = inp.bondClass === 'good' ? 1.0 : 0.7;
  const eta2 = inp.barDiam <= 32 ? 1.0 : (132 - inp.barDiam) / 100;
  const fctd = (0.7 * mat.fctm) / GAMMA_C;
  const fbd = 2.25 * eta1 * eta2 * fctd;
  const alpha6 = 1.5;
  const lbRqd = (inp.barDiam / 4) * (fyd / fbd);
  // Se entrega redondeado HACIA ARRIBA al múltiplo de 5 mm, como en pilares: es
  // una cota que alguien va a medir en la obra, y 970,496894409938 mm no es una
  // longitud, es el resultado de una división. Hacia arriba porque es un
  // mínimo: hacia abajo se estaría pidiendo menos de lo que exige la norma.
  const lapLength = Math.ceil(Math.max(alpha6 * lbRqd, 15 * inp.barDiam, 200) / 5) * 5;

  // REBAR SCHEDULE ───────────────────────────────────────────────────────
  const rebarSchedule =
    `${inp.nBars}\u00d8${inp.barDiam}(t) + ${inp.nBarsComp}\u00d8${inp.barDiamComp}(c) + \u00d8${inp.stirrupDiam}/c${inp.stirrupSpacing} mm (${inp.stirrupLegs}R)`;

  return {
    valid: true,
    d, As, AsComp, Asw, x, MRd,
    VRdc, VRds, VRd, VRdmax,
    wk, wkMax: wkLim,
    lapLength, rebarSchedule,
    checks,
  };
}

function globalInvalid(error: string): RCBeamResult {
  return {
    valid: false, error,
    vano: invalidSection(error),
    apoyo: invalidSection(error),
  };
}

export function calcRCBeam(inp: RCBeamInputs): RCBeamResult {
  // Global input validation (invalidates both sections)
  if ((inp.b as number) <= 0) return globalInvalid('Ancho b debe ser > 0 mm');
  if ((inp.h as number) <= 0) return globalInvalid('Canto h debe ser > 0 mm');
  if ((inp.cover as number) <= 0) return globalInvalid('Recubrimiento debe ser > 0 mm');
  if ((inp.fck as number) < 12 || (inp.fck as number) > 90) return globalInvalid('fck fuera de rango (12-90 MPa)');
  if (!(inp.exposureClass in wkMax)) return globalInvalid(`Clase de exposicion invalida: ${inp.exposureClass}`);
  if ((inp.vano_bot_nBars as number) <= 0) return globalInvalid('Numero de barras de vano (traccion) debe ser > 0');
  if ((inp.apoyo_top_nBars as number) <= 0) return globalInvalid('Numero de barras de apoyo (traccion) debe ser > 0');

  // Quasi-permanent load factor psi2
  const psi2 = inp.loadType === 'custom'
    ? (inp.psi2Custom as number)
    : (PSI2_MAP[inp.loadType as string] ?? 0.3);

  // Los momentos se introducen como magnitudes (|M-| en apoyo). Math.abs()
  // evita que un valor negativo (M- con su signo natural) desactive en
  // silencio la fisuración (Ms>0) o dé utilización negativa → verde en
  // flexión (fix auditoría #60; mismo patrón que rcSlabs #53).
  const vanoMs  = Math.abs((inp.vano_M_G  as number) + psi2 * (inp.vano_M_Q  as number));
  const apoyoMs = Math.abs((inp.apoyo_M_G as number) + psi2 * (inp.apoyo_M_Q as number));

  const vano = calcSection({
    b:              inp.b as number,
    h:              inp.h as number,
    cover:          inp.cover as number,
    stirrupDiam:    inp.vano_stirrupDiam as number,
    stirrupLegs:    inp.vano_stirrupLegs as number,
    fck:            inp.fck as number,
    fyk:            inp.fyk as number,
    exposureClass:  inp.exposureClass as string,
    Md:             Math.abs(inp.vano_Md as number),
    VEd:            Math.abs(inp.vano_VEd as number),
    Ms:             vanoMs,
    nBars:          inp.vano_bot_nBars as number,
    barDiam:        inp.vano_bot_barDiam as number,
    nBarsComp:      inp.vano_top_nBars as number,
    barDiamComp:    inp.vano_top_barDiam as number,
    stirrupSpacing: inp.vano_stirrupSpacing as number,
    bondClass:      'good',
  });

  const apoyo = calcSection({
    b:              inp.b as number,
    h:              inp.h as number,
    cover:          inp.cover as number,
    stirrupDiam:    inp.apoyo_stirrupDiam as number,
    stirrupLegs:    inp.apoyo_stirrupLegs as number,
    fck:            inp.fck as number,
    fyk:            inp.fyk as number,
    exposureClass:  inp.exposureClass as string,
    Md:             Math.abs(inp.apoyo_Md as number),
    VEd:            Math.abs(inp.apoyo_VEd as number),
    Ms:             apoyoMs,
    nBars:          inp.apoyo_top_nBars as number,
    barDiam:        inp.apoyo_top_barDiam as number,
    nBarsComp:      inp.apoyo_bot_nBars as number,
    barDiamComp:    inp.apoyo_bot_barDiam as number,
    stirrupSpacing: inp.apoyo_stirrupSpacing as number,
    bondClass:      'poor',
  });

  // DEFLECTION — comprobación de pieza (no de sección), emitida en
  // vano.checks. L=0 = no comprobar (estados antiguos sin el campo). Dos
  // métodos EXCLUYENTES según deflMethod (§7.4.2 exime del cálculo directo
  // cuando L/d cumple — solo el método elegido puntúa):
  //   'ld' (default) → esbeltez L/d sin cálculo directo (CE Anejo 19 §7.4.2,
  //       fix auditoría #67), armadura de VANO (centro de luz). 310/σs se
  //       aproxima por 500/fyk (As,prov = As,req, lado seguro) y para
  //       L > 7 m se aplica 7/L (tabiquería frágil — conservador).
  //   'direct' → flecha diferida cuasipermanente con sección fisurada:
  //       δ_dif = δ_el·k con k de crackedDeflectionFactor (§7.4.3, mismo
  //       motor que la fila 'deflection-cracked' del FEM 2D) contra L/300
  //       (apariencia, CTE DB-SE 4.3.3). Sin solver ni cargas, δ_el se
  //       deriva de los MOMENTOS cuasipermanentes con la MISMA base rígida
  //       B = Ec_base·Ig que usa el factor (no fisurada ⇒ δ_el·(1+φef)
  //       exacto): UDL + momentos de extremo δ = 5L²/48B·(Mc + 0.1·ΣM_ext)
  //       con M_ext hogging < 0 → c = 0 (biapoyada) / 0.1 (vano extremo) /
  //       0.2 (interior) sobre |M_apoyo|; ménsula δ = |M_ap|·L²/4B (UDL).
  //       Los momentos de APOYO solo entran en modo 'portico': en 'simple'
  //       el usuario no los ve (estado oculto) y un dato fantasma nunca debe
  //       REDUCIR la flecha → isostática con datos de vano (conservador).
  //       ζ se evalúa con el máx Mcp del miembro (sección más fisurada,
  //       paridad FEM 2D) y la armadura de la cara traccionada que gobierna
  //       la flecha (vano; ménsula en pórtico → apoyo).
  const L = Math.abs((inp.L as number) ?? 0);
  const deflMethod = (inp.deflMethod as string | undefined) ?? 'ld';
  if (L > 0 && deflMethod === 'direct') {
    const isPortico = inp.mode === 'portico'; // backcompat: sin mode → simple
    const isCant = inp.structSystem === 'cantilever';
    const useApoyo = isCant && isPortico;
    const sec = useApoyo ? apoyo : vano;
    if (vano.valid && sec.valid) {
      const b = inp.b as number;
      const h = inp.h as number;
      const phiEf = Math.max(0, (inp.phiEf as number | undefined) ?? 2.0);
      const Bsol = rcElasticModulusMPa(inp.fck as number) * (b * Math.pow(h, 3)) / 12; // N·mm²
      let deltaEl: number; // mm
      let Mzeta: number;   // kN·m
      if (isCant) {
        const M = useApoyo ? apoyoMs : vanoMs;
        deltaEl = (M * 1e6 * L * L) / (4 * Bsol);
        Mzeta = M;
      } else {
        const C_APOYO: Record<string, number> = { ss: 0, end: 0.1, interior: 0.2 };
        const c = isPortico ? (C_APOYO[inp.structSystem as string] ?? 0) : 0;
        // El hogging descarga el centro de vano; la flecha nunca es < 0.
        const Mnet = Math.max(0, vanoMs - c * apoyoMs);
        deltaEl = (5 / 48) * (Mnet * 1e6 * L * L) / Bsol;
        Mzeta = isPortico ? Math.max(vanoMs, apoyoMs) : vanoMs;
      }
      const fis = crackedDeflectionFactor({
        b, h,
        fck: inp.fck as number,
        As: sec.As,
        d: sec.d,
        Mcp: Mzeta,
        phiEf,
      });
      // 0 × ∞ (sin flecha cp pero k = ∞ por As = 0) debe leer 0, no NaN.
      const deltaDif = deltaEl === 0 ? 0 : deltaEl * fis.k;
      // En voladizo, luz 2L (DB SE 4.3.3.1(4): entre dos puntos cualesquiera,
      // con luz el doble de su distancia; aquí el arranque y la punta), como
      // en vigas de acero y madera. Hasta el 2026-09-28, L: el doble de estricto.
      const adm = (isCant ? 2 * L : L) / 300;
      const util = deltaDif / adm;
      vano.checks.push({
        id: 'deflection-cracked',
        description: 'Flecha diferida (ELS-cp, seccion fisurada)',
        value: `δ = ${dec(deltaDif, 1)} mm (k = ${Number.isFinite(fis.k) ? dec(fis.k, 2) : '∞'}, ζ = ${dec(fis.zeta, 2)})`,
        limit: `${isCant ? '2L' : 'L'}/300 = ${dec(adm, 1)} mm`,
        utilization: util,
        status: toStatus(util),
        article: 'CE Anejo 19 §7.4.3 · CTE DB-SE 4.3.3',
      });
    }
  } else if (L > 0 && vano.valid) {
    const K_MAP: Record<string, number> = { ss: 1.0, end: 1.3, interior: 1.5, cantilever: 0.4 };
    const K = K_MAP[inp.structSystem as string] ?? 1.0;
    const fck = inp.fck as number;
    const sqrtFck = Math.sqrt(fck);
    const b = inp.b as number;
    const rho0 = 1e-3 * sqrtFck;
    const rho  = vano.As / (b * vano.d);
    const rhoP = vano.AsComp / (b * vano.d);
    let lambdaLim: number;
    if (rho <= rho0) {
      // Expr. 7.16a
      lambdaLim = K * (11 + 1.5 * sqrtFck * (rho0 / rho) + 3.2 * sqrtFck * Math.pow(rho0 / rho - 1, 1.5));
    } else {
      // Expr. 7.16b
      lambdaLim = K * (11 + 1.5 * sqrtFck * rho0 / (rho - rhoP) + (sqrtFck / 12) * Math.sqrt(rhoP / rho0));
    }
    lambdaLim *= 500 / (inp.fyk as number);   // ≈ 310/σs con As,prov = As,req
    lambdaLim *= Math.min(1, 7000 / L);       // luces > 7 m con tabiquería
    const ld = L / vano.d;
    vano.checks.push({
      id: 'slenderness-ld',
      description: 'Esbeltez L/d (flecha sin calculo directo)',
      value: `L/d = ${dec(ld, 1)}`,
      limit: `λ,lim = ${dec(lambdaLim, 1)}`,
      utilization: ld / lambdaLim,
      status: toStatus(ld / lambdaLim),
      article: 'CE Anejo 19 §7.4.2',
    });
  }

  return { valid: true, vano, apoyo };
}
