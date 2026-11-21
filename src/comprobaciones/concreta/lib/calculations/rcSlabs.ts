// Forjados — Reticular (sección T por nervio) + Losa maciza (franja 1m)
// CE Anejo 19 §5.3.2.1 (b_eff), §6.1 (flexión), §9.2.1.1 (cuantías), §6.2 (cortante),
// §7.3 (fisuración), §8.2 (separación barras).
// All units: mm, MPa, kN, kNm.

import { type ForjadosInputs } from '../../data/defaults.ts';
import { getConcrete, getFyd, Es } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';
import { COT_THETA_CORTANTE, GAMMA_C, wkMax } from '../../data/factors.ts';
import { getL0Factor } from '../../data/forjadoTipologias.ts';
import { solveTSection, solveRectangular, computeBEff } from './rcTSection.ts';
import { asMinRectangular, asMinTraccion, seccionT, CUANTIA_MAXIMA } from './cuantiaMinima.ts';
import { type CheckRow, detailingStatus, makeCheck as check, makeCheckQty as checkQ, makeDetailingCheck as regla } from './types.ts';
import { dec } from '../units/format.ts';

export type { CheckStatus, CheckRow } from './types.ts';

// ── Anchorage (CE Anejo 19 §8.4.2 a §8.4.4) ──────────────────────────────────
// lb_rqd = (Ø/4)·(σsd/fbd); lb_min = max(0.3·lb_rqd, 10·Ø, 100 mm).
// fbd = 2.25·η1·η2·fctd (8.2); fctd = αct·fctk,0.05/γc con fctk,0.05 = 0.7·fctm.
//
// Condiciones de adherencia, figura A19.8.2 (comprobada en el BOE el
// 2026-09-26, pág. 98407): con h ≤ 250 mm son «buenas» para todas las barras;
// con h > 250 mm, sólo para las de los 250 mm inferiores (y, con h > 600, las
// que quedan a 300 mm o más de la cara superior). Las barras superiores de un
// forjado de más de 250 mm tienen adherencia «mala»: η1 = 0,7.
//
// Hasta el 2026-09-26 el umbral era 300 mm: en un 25+5 (h = 300) o en una losa
// de 26 a 30 cm las barras superiores salían en posición I, con un anclaje un
// 30 % más corto del que pide el Código (Ø16: 647 mm en vez de 924).

export interface AnchorageInfo {
  phi:      number;
  lb_rqd:   number;
  lb_min:   number;
  position: 'I' | 'II';
}

/**
 * fctm con la que se calcula la adherencia. La (8.2) limita fctk,0.05 a la de
 * un hormigón de fck = 60 N/mm²: la adherencia no crece con la resistencia más
 * allá, porque el hormigón se vuelve más frágil.
 */
export function fctmAdherencia(fck: number): number {
  return getConcrete(Math.min(fck, 60)).fctm;
}

export function computeAnchorage(
  phi:  number,
  fctm: number,   // MPa — la de `fctmAdherencia(fck)`, ya topada
  fyd:  number,   // MPa
  cara: 'inf' | 'sup',
  h:    number,   // mm
  /** Tensión de la barra donde empieza el anclaje, MPa. Por defecto fyd. */
  sigmaSd: number = fyd,
): AnchorageInfo {
  const fctd = (0.7 * fctm) / 1.5;
  const position: 'I' | 'II' = cara === 'inf' || h <= 250 ? 'I' : 'II';
  const eta1 = position === 'I' ? 1.0 : 0.7;
  const eta2 = 1.0;   // Ø ≤ 32 mm
  const fbd = 2.25 * eta1 * eta2 * fctd;
  const lb_rqd = (phi / 4) * (sigmaSd / fbd);
  // El mínimo se toma con la barra a fyd aunque trabaje a menos: del lado de
  // la seguridad, y el mismo que el de las filas de anclaje.
  const lb_min = Math.max(0.3 * (phi / 4) * (fyd / fbd), 10 * phi, 100);
  return { phi, lb_rqd, lb_min, position };
}

export interface ForjadosSectionResult {
  valid:     boolean;
  error?:    string;
  // Geometry
  b:         number;  // width used for flexión (b_eff reticular vano / b_w reticular apoyo / 1000 maciza)
  d:         number;  // effective depth (mm)
  As:        number;  // tension steel (mm²), aggregate = AsBase + AsRef
  AsBase:    number;  // base bundle tension area (mm²)
  AsRef:     number;  // refuerzo bundle tension area (mm²)
  AsComp:    number;  // compression steel (mm²)
  // Bending
  x:         number;
  MRd:       number;
  branch:    'rect-bEff' | 'rect-bw' | 't-real' | 'rect';
  // Fisuración
  wk:        number;
  wkLim:     number;
  checks:    CheckRow[];
}

export interface ForjadosResult {
  valid:     boolean;
  error?:    string;
  /**
   * Campo de entrada que invalida el cálculo. El mensaje salía en el panel de
   * resultados, al otro lado de la pantalla, y el campo culpable no se
   * marcaba: en escritorio son 700 px entre la causa y el aviso.
   */
  errorField?: keyof ForjadosInputs;
  variant:   'reticular' | 'maciza';
  bEff:      number;   // mm — only meaningful for reticular vano (0 for maciza)
  L0:        number;   // mm — only meaningful for reticular (0 for maciza)
  vano:      ForjadosSectionResult;
  apoyo:     ForjadosSectionResult;
  // Shear (single VEd, computed once per variant with the governing section depth)
  VRdc:      number;
  VRds:      number;
  VRd:       number;
  VRdmax:    number;
  shearChecks: CheckRow[];
  infoChecks:  CheckRow[];  // non-blocking: armadura reparto (maciza), biaxial note, etc.
}

const PSI2_MAP: Record<string, number> = {
  residential: 0.3,
  office: 0.3,
  parking: 0.6,
  roof: 0.0,
  custom: 0.0,
};

function invalidSection(error: string): ForjadosSectionResult {
  return {
    valid: false, error,
    b: 0, d: 0, As: 0, AsBase: 0, AsRef: 0, AsComp: 0,
    x: 0, MRd: 0, branch: 'rect',
    wk: 0, wkLim: 0, checks: [],
  };
}

// ── Bar arrangement in the nervio (CE Anejo 19 §8.2) ─────────────────────────────
// Distributes the tension bars (montaje base + refuerzo) across up to maxLayers
// horizontal layers using REAL diameters per bar (not the max-Ø-for-all shortcut).
// Model: each bundle is one layer — base = outer layer at the tension face,
// refuerzo = inner layer stacked above it — matching how ForjadosSVG draws them
// and how a nervio is detailed in practice. Returns the steel-centroid depth so
// the caller computes d = h − dDepth: a forced 2nd layer raises the centroid and
// lowers d (→ lower MRd), which the single-layer formula silently ignored.
export interface BarBundleSpec { count: number; phi: number; }
export interface NervioArrangement {
  fits:     boolean;       // bars physically fit (real Ø + min clear spacing, ≤ maxLayers)
  nLayers:  number;
  dDepth:   number;        // steel centroid depth from the tension face (mm)
  governing: number | null; // tightest layer clear spacing (mm); null ⇒ every layer ≤1 bar
  minLimit: number;        // min clear spacing of the governing layer (mm)
  shortfall: number;       // mm the worst layer overflows the clear width (≤0 when it fits)
}

export function arrangeNervioBars(
  bundles:    BarBundleSpec[],  // ordered: base first, refuerzo second
  clearWidth: number,           // bWeb − 2·cover − 2·stirrup (free space inside the cage)
  baseline:   number,           // cover + stirrup — depth from face to the first bar surface
  h:          number,
  maxLayers = 2,
): NervioArrangement {
  const active = bundles.filter((b) => b.count > 0 && b.phi > 0);
  if (active.length === 0) {
    return { fits: true, nLayers: 0, dDepth: baseline, governing: null, minLimit: 20, shortfall: 0 };
  }
  const allPhis = active.flatMap((b) => Array.from({ length: b.count }, () => b.phi));
  const maxPhiAll = Math.max(...allPhis);

  // Row geometry — sMin is the bar's OWN diameter (CE 69.4: clear dist ≥ max(20, Ø)).
  const rowWidth = (phis: number[]): number =>
    phis.reduce((a, p) => a + p, 0) + Math.max(0, phis.length - 1) * Math.max(20, Math.max(...phis));
  const rowClear = (phis: number[]): number | null =>
    phis.length <= 1 ? null : (clearWidth - phis.reduce((a, p) => a + p, 0)) / (phis.length - 1);
  const rowMin = (phis: number[]): number => Math.max(20, Math.max(...phis));

  // Try a single layer (all bars in one row).
  if (rowWidth(allPhis) <= clearWidth) {
    return {
      fits: true, nLayers: 1,
      dDepth: baseline + maxPhiAll / 2,            // bars centred on the larger-Ø line
      governing: rowClear(allPhis),
      minLimit: rowMin(allPhis),
      shortfall: rowWidth(allPhis) - clearWidth,   // ≤ 0
    };
  }

  // Doesn't fit in one row → one layer per bundle (base outer, refuerzo inner).
  const layerPhis = active.map((b) => Array.from({ length: b.count }, () => b.phi));
  let surface = baseline;          // near surface of the current layer
  let areaSum = 0;
  let momentSum = 0;               // Σ(area · centreDepth)
  let worstOverflow = -Infinity;   // max(rowWidth − clearWidth) over layers
  let governing: number | null = null;
  let governingMin = 20;
  let farSurface = baseline;
  for (let i = 0; i < active.length; i++) {
    const phi  = active[i].phi;
    const phis = layerPhis[i];
    const center = surface + phi / 2;
    const area = active[i].count * getBarArea(phi);
    areaSum   += area;
    momentSum += area * center;
    worstOverflow = Math.max(worstOverflow, rowWidth(phis) - clearWidth);
    const clear = rowClear(phis);
    if (clear !== null && (governing === null || clear < governing)) {
      governing = clear; governingMin = rowMin(phis);
    }
    farSurface = surface + phi;
    // vertical clear to the next layer ≥ max(20, Ø) of the two adjacent layers.
    const nextPhi = i + 1 < active.length ? active[i + 1].phi : phi;
    surface = farSurface + Math.max(20, Math.max(phi, nextPhi));
  }
  const dDepth = areaSum > 0 ? momentSum / areaSum : baseline + maxPhiAll / 2;

  const layersFit      = active.every((_, i) => rowWidth(layerPhis[i]) <= clearWidth);
  const fitsVertically = farSurface <= h - baseline;   // stack stays inside the section
  const fits = active.length <= maxLayers && layersFit && fitsVertically;

  return { fits, nLayers: active.length, dDepth, governing, minLimit: governingMin, shortfall: worstOverflow };
}

interface SectionCalcInputs {
  // geometry branch
  variant: 'reticular' | 'maciza';
  zone:    'vano' | 'apoyo';
  b:       number;   // width used for flexión (b_eff / b_w / 1000)
  d:       number;
  h:       number;   // total depth, used for As,min on full b·h
  cover:   number;
  bEff:    number;   // only for reticular vano T-section; else === b
  /** Ala de la T bruta para las cuantías (§9.2.1.1): el ancho eficaz del
   *  vano en las dos zonas del nervio; en maciza, el ancho de la franja. */
  bFlange: number;
  bWeb:    number;
  hFlange: number;
  // materials
  fck: number; fyk: number;
  // steel
  As: number; AsBase: number; AsRef: number; AsComp: number;
  barDiamTens: number; nBarsTens: number;  // barDiamTens = max Ø tracción (drives srMax)
  arrangement?: NervioArrangement;          // reticular bar layout (real Ø, layers)
  // SLS for wk
  Ms: number;
  exposureClass: string;
  // maciza-only: main bar spacing (for spacing check)
  macSpacing: number;  // mm, 0 if reticular
}

function calcSection(inp: SectionCalcInputs): ForjadosSectionResult {
  const mat = getConcrete(inp.fck);
  const fcd = mat.fcd;
  const fyd = getFyd(inp.fyk);
  const checks: CheckRow[] = [];

  // BENDING ──────────────────────────────────────────────────────────────
  let x: number;
  let MRd: number;
  let branch: ForjadosSectionResult['branch'];

  if (inp.variant === 'reticular' && inp.zone === 'vano') {
    const sol = solveTSection(inp.bEff, inp.bWeb, inp.hFlange, inp.d, inp.As, fcd, fyd);
    x = sol.x; MRd = sol.MRd; branch = sol.branch;
  } else {
    // reticular apoyo → rectangular on b_w (nervio comprimido)
    // maciza ambos   → rectangular 1000 × d
    const sol = solveRectangular(inp.b, inp.d, inp.As, fcd, fyd);
    x = sol.x; MRd = sol.MRd;
    branch = inp.variant === 'reticular' ? 'rect-bw' : 'rect';
  }

  // Demand: caller injects via Md — we just render MRd vs 0 as placeholder
  // Actual Md check is aggregated by caller (needs access to input Md).
  // We push MRd row for PDF; caller will set utilization.
  // (Implementation: we push the flexión check from caller side via appendFlexionCheck.)

  // Over-reinforcement limit
  const ecu3 = 0.0035;
  const eyd = fyd / Es;
  const xLimit = (ecu3 / (ecu3 + eyd)) * inp.d;
  if (x > xLimit) {
    checks.push({
      id: 'bending-over',
      description: 'Sección sobrearmada (x > x,lim)',
      value: `x = ${x.toFixed(0)} mm`,
      limit: `x,lim = ${xLimit.toFixed(0)} mm`,
      utilization: x / xLimit,
      status: 'warn',
      article: 'CE Anejo 19 §6.1',
    });
  }

  // MIN REINFORCEMENT tension — CE Anejo 19 §9.2.1.1 (9.1), al que remite el
  // §9.3.1.1(1) para las losas ─────────────────────────────────────────────
  // As,min = W/z · fctm,fl/fyd, W de la sección BRUTA a la fibra traccionada.
  //  - maciza: la franja b × h.
  //  - reticular: la T del nervio con el ala eficaz del vano (§5.3.2.1); en
  //    el vano tracciona la fibra inferior y en el apoyo la superior, con el
  //    ala en tracción, así que ahí el mínimo sale mayor.
  // Hasta el 2026-09-25 el nervio usaba el 2,8 ‰·bw·h de la tabla 42.3.5 de
  // la EHE-08 y la maciza el valor recomendado del Eurocódigo (0,26·fctm/fyk·
  // b·d ≥ 0,0013·b·d), que el CE no adopta: un tercio menos en 20 cm.
  const T = inp.variant === 'reticular'
    ? seccionT({ bf: inp.bFlange, hf: inp.hFlange, bw: inp.bWeb, h: inp.h })
    : null;
  const AsMin = T
    ? asMinTraccion(inp.zone === 'vano' ? T.Winf : T.Wsup, inp.h, mat.fctm, fyd)
    : asMinRectangular(inp.b, inp.h, mat.fctm, fyd);
  const Ac = T ? T.A : inp.b * inp.h;

  checks.push(regla(
    'as-min',
    'Armadura mínima tracción',
    AsMin, inp.As,
    `As,min = ${AsMin.toFixed(0)} mm²`,
    `As = ${inp.As.toFixed(0)} mm²`,
    'CE Anejo 19 §9.2.1.1 (9.1)',
  ));

  // MAX REINFORCEMENT — CE Anejo 19 §9.2.1.1(3): la de tracción O la de
  // compresión ≤ 0,04·Ac de la sección bruta, cada una por su lado.
  const AsMaxCara = Math.max(inp.As, inp.AsComp);
  const AsMax = CUANTIA_MAXIMA * Ac;
  checks.push(regla(
    'as-max',
    'Armadura máxima (tracción o compresión)',
    AsMaxCara, AsMax,
    `As = ${AsMaxCara.toFixed(0)} mm²`,
    `As,max = ${AsMax.toFixed(0)} mm²`,
    'CE Anejo 19 §9.2.1.1(3)',
  ));

  // BAR SPACING (CE Anejo 19 §8.2) ──────────────────────────────────────────
  // Real Ø + multi-layer: the arrangement (built in calcForjados) reports whether
  // the bars fit (in ≤2 layers) and the tightest layer's clear spacing. The old
  // single-row max-Ø-for-all formula falsely failed nervios with mixed bars.
  if (inp.variant === 'reticular') {
    const arr = inp.arrangement;
    if (arr && inp.nBarsTens > 1) {
      const capas = arr.nLayers > 1 ? `, ${arr.nLayers} capas` : '';
      if (!arr.fits) {
        checks.push({
          id: 'bar-spacing-impossible',
          description: arr.nLayers > 1
            ? 'Barras no caben en el nervio (ni en 2 capas)'
            : 'Barras no caben en el nervio',
          value: `Exceso: ${arr.shortfall.toFixed(0)} mm`,
          limit: '≤ ancho libre',
          utilization: Infinity, status: 'fail',
          article: 'CE Anejo 19 §8.2',
        });
      } else if (arr.governing === null) {
        // every layer has ≤1 bar → no horizontal spacing to verify
        checks.push({
          id: 'bar-spacing',
          description: `Separación entre barras (nervio${capas})`,
          value: '1 barra/capa',
          limit: '—',
          utilization: 0, status: 'ok',
          article: 'CE Anejo 19 §8.2',
        });
      } else {
        // Min clear spacing governs in a narrow web (the 3·h max-spacing arm is a
        // slab crack-control rule and never governs here → dropped).
        // Regla CONSTRUCTIVA, no de agotamiento: se cumple o no, sin la franja
        // de advertencia al 95 % de las comprobaciones resistentes, y el caso
        // límite cumple («no inferior a», §8.2(2)). Con `toStatus`, s = 20 frente
        // a un mínimo de 20 salía INCUMPLE. La utilización se queda para la barra.
        const spacing  = arr.governing;
        const minLimit = arr.minLimit;
        const util = minLimit / spacing;
        const status = detailingStatus(util);
        checks.push({
          id: 'bar-spacing',
          description: `Separación entre barras (nervio${capas})`,
          value: `s = ${spacing.toFixed(0)} mm`,
          limit: `≥ ${minLimit} mm`,
          utilization: util, status, article: 'CE Anejo 19 §8.2',
        });
      }
    }
  } else {
    // Losa maciza: separación máxima de la armadura principal, CE Anejo 19
    // §9.3.1.1(3) (BOE pág. 98430, comprobado el 2026-09-26): «la separación
    // entre barras no debe superar s,max,slabs», con 300 mm y 3·h. Hasta
    // entonces el tope era 400, el valor recomendado del Eurocódigo que el CE
    // no adopta, y la fila citaba el §8.2, que es la separación MÍNIMA. Se
    // comprueba la parrilla base de la cara traccionada: es la que sigue sola
    // fuera de la zona de refuerzo.
    // Regla CONSTRUCTIVA, no de agotamiento: cumple o no, sin advertencia al
    // 95 %, y c/300 (el caso límite, que no la supera) cumple.
    const sMax = Math.min(3 * inp.h, 300);
    checks.push({
      id: 'bar-spacing-maciza',
      description: 'Separación máxima entre barras',
      value: `s = ${inp.macSpacing.toFixed(0)} mm`,
      limit: `s,max = ${sMax.toFixed(0)} mm`,
      utilization: inp.macSpacing / sMax,
      status: detailingStatus(inp.macSpacing / sMax),
      article: 'CE Anejo 19 §9.3.1.1(3)',
    });
  }

  // FISURACIÓN (CE Anejo 19 §7.3) — only when exposureClass ≠ XC1 ──────────
  let wk = 0;
  const wkLim = wkMax[inp.exposureClass] ?? 0.3;
  if (inp.exposureClass !== 'XC1' && inp.Ms > 0) {
    const Ecm_MPa = mat.Ecm * 1000;
    const n = Es / Ecm_MPa;
    // For wk we use bEff (reticular vano) or b (others) as the compression width
    const bWk = inp.variant === 'reticular' && inp.zone === 'vano' ? inp.bEff : inp.b;
    const A_coef = 0.5 * bWk;
    const B_coef = n * inp.As;
    const C_coef = -n * inp.As * inp.d;
    const xCr = (-B_coef + Math.sqrt(B_coef ** 2 - 4 * A_coef * C_coef)) / (2 * A_coef);
    const Icr = (bWk * xCr ** 3) / 3 + n * inp.As * (inp.d - xCr) ** 2;
    const sigmaS = (inp.Ms * 1e6 * (inp.d - xCr) * n) / Icr;
    // Effective tension area — use b_w for reticular (nervio), b for maciza
    const bEffTension = inp.variant === 'reticular' ? inp.bWeb : inp.b;
    const hMinusD = inp.h - inp.d;
    const AcEff = Math.min(
      2.5 * hMinusD * bEffTension,
      ((inp.h - xCr) / 3) * bEffTension,
      (inp.h / 2) * bEffTension,
    );
    const rhoEff = inp.As / AcEff;
    const srMax = 3.4 * inp.cover + 0.425 * 0.8 * 0.5 * (inp.barDiamTens / rhoEff);
    const kt = 0.4;
    const esmEcm1 = (sigmaS - kt * (mat.fctm / rhoEff) * (1 + n * rhoEff)) / Es;
    const esmEcm2 = (0.6 * sigmaS) / Es;
    wk = srMax * Math.max(esmEcm1, esmEcm2, 0);

    checks.push(check(
      'cracking',
      `Ancho de fisura wk ≤ wmax (${inp.exposureClass})`,
      wk, wkLim,
      `wk = ${dec(wk, 3)} mm`,
      `wmax = ${dec(wkLim, 2)} mm`,
      'CE Anejo 19 §7.3',
    ));
  }

  return {
    valid: true,
    b: inp.b, d: inp.d,
    As: inp.As, AsBase: inp.AsBase, AsRef: inp.AsRef, AsComp: inp.AsComp,
    x, MRd, branch, wk, wkLim, checks,
  };
}

function globalInvalid(error: string, variant: 'reticular' | 'maciza', errorField?: keyof ForjadosInputs): ForjadosResult {
  const sec = invalidSection(error);
  return {
    valid: false, error, errorField, variant, bEff: 0, L0: 0,
    vano: sec, apoyo: sec,
    VRdc: 0, VRds: 0, VRd: 0, VRdmax: 0,
    shearChecks: [], infoChecks: [],
  };
}

export function calcForjados(inp: ForjadosInputs): ForjadosResult {
  // ── Input validation ─────────────────────────────────────────────────
  const variant = inp.variant as 'reticular' | 'maciza';
  if ((inp.h as number) <= 0) return globalInvalid('Canto h debe ser > 0 mm', variant, 'h');
  if ((inp.cover as number) <= 0) return globalInvalid('Recubrimiento debe ser > 0 mm', variant, 'cover');
  if ((inp.fck as number) < 12 || (inp.fck as number) > 90)
    return globalInvalid('fck fuera de rango (12–90 MPa)', variant, 'fck');
  if (!(inp.exposureClass in wkMax))
    return globalInvalid(`Clase de exposición inválida: ${inp.exposureClass}`, variant, 'exposureClass');

  if (variant === 'reticular') {
    if ((inp.bWeb as number) <= 0) return globalInvalid('b_w debe ser > 0 mm', variant, 'bWeb');
    if ((inp.intereje as number) <= 0) return globalInvalid('Intereje debe ser > 0 mm', variant, 'intereje');
    if ((inp.hFlange as number) <= 0) return globalInvalid('Capa de compresión h_f debe ser > 0 mm', variant, 'hFlange');
    if ((inp.spanLength as number) <= 0) return globalInvalid('La luz L debe ser mayor que 0', variant, 'spanLength');
    // Base es obligatoria (montaje continuo); refuerzos pueden ser 0.
    if ((inp.base_inf_nBars as number) <= 0) return globalInvalid('Barras montaje inferior > 0', variant, 'base_inf_nBars');
    if ((inp.base_sup_nBars as number) <= 0) return globalInvalid('Barras montaje superior > 0', variant, 'base_sup_nBars');
  } else {
    // Parrilla base obligatoria en ambas caras; refuerzos pueden ser 0.
    if ((inp.base_inf_phi_mac as number) <= 0) return globalInvalid('Ø parrilla inferior > 0 mm', variant, 'base_inf_phi_mac');
    if ((inp.base_inf_s_mac   as number) <= 0) return globalInvalid('Separación parrilla inferior > 0 mm', variant, 'base_inf_s_mac');
    if ((inp.base_sup_phi_mac as number) <= 0) return globalInvalid('Ø parrilla superior > 0 mm', variant, 'base_sup_phi_mac');
    if ((inp.base_sup_s_mac   as number) <= 0) return globalInvalid('Separación parrilla superior > 0 mm', variant, 'base_sup_s_mac');
  }

  const h       = inp.h as number;
  const cover   = inp.cover as number;
  const fck     = inp.fck as number;
  const fyk     = inp.fyk as number;
  const exposureClass = inp.exposureClass as string;

  // Los momentos se introducen como magnitudes (|M-| en apoyo). Se normaliza
  // el signo con Math.abs() para que un valor negativo (M- con su signo
  // natural, alcanzable vía URL/llamada programática) no desactive en
  // silencio la fisuración (Ms>0) ni dé utilización negativa → verde en
  // flexión (fix auditoría #53).
  const vano_Md  = Math.abs(inp.vano_Md  as number);
  const apoyo_Md = Math.abs(inp.apoyo_Md as number);

  // SLS Ms per zone (for wk when XC2+)
  const psi2 = inp.loadType === 'custom' ? (inp.psi2Custom as number) : (PSI2_MAP[inp.loadType as string] ?? 0.3);
  const vanoMs  = Math.abs((inp.vano_M_G  as number) + psi2 * (inp.vano_M_Q  as number));
  const apoyoMs = Math.abs((inp.apoyo_M_G as number) + psi2 * (inp.apoyo_M_Q as number));

  // Material
  const mat = getConcrete(fck);
  const fcd = mat.fcd;
  const fyd = getFyd(fyk);

  // ── Reticular vs maciza geometry + As ─────────────────────────────────
  let bEff = 0;
  let L0 = 0;
  let bFlexVano:  number;
  let bFlexApoyo: number;
  let bWeb:       number;
  let hFlange:    number;
  let dVano:      number;
  let dApoyo:     number;
  let AsVano:      number;
  let AsVanoBase:  number;
  let AsVanoRef:   number;
  let AsVanoComp:  number;
  let AsApoyo:     number;
  let AsApoyoBase: number;
  let AsApoyoRef:  number;
  let AsApoyoComp: number;
  let barDiamVano:  number;
  let nBarsVano:    number;
  let barDiamApoyo: number;
  let nBarsApoyo:   number;
  let arrVano:  NervioArrangement | undefined;
  let arrApoyo: NervioArrangement | undefined;
  let macSpacingVano  = 0;
  let macSpacingApoyo = 0;

  // Active bar bundles tracked for anchorage checks (only bundles with area > 0).
  interface BarBundle {
    id:   'base-inf' | 'base-sup' | 'refuerzo-vano-inf' | 'refuerzo-apoyo-sup';
    label: string;          // e.g. "Montaje inferior 2Ø12"
    phi:   number;          // max Ø of the bundle (driver of lb_rqd)
    cara:  'inf' | 'sup';
    zone:  'vano' | 'apoyo'; // which section's checks list to append
  }
  const bundlesVano:  BarBundle[] = [];
  const bundlesApoyo: BarBundle[] = [];

  if (variant === 'reticular') {
    bWeb    = inp.bWeb as number;
    hFlange = inp.hFlange as number;
    const intereje   = inp.intereje as number;
    const spanLength = inp.spanLength as number;
    const l0Factor   = getL0Factor(inp.tipoVano as 'biapoyado' | 'continuo-extremo' | 'continuo-interior' | 'voladizo');
    L0   = l0Factor * spanLength;
    bEff = computeBEff(intereje, spanLength, l0Factor, bWeb);

    // vano: T-section (b_eff for rect branch, b_w for web)
    // apoyo: rectangular on b_w
    bFlexVano  = bEff;
    bFlexApoyo = bWeb;

    // Base reticular — montaje continuo del nervio (sup + inf).
    const nBaseInf   = inp.base_inf_nBars   as number;
    const phiBaseInf = inp.base_inf_barDiam as number;
    const nBaseSup   = inp.base_sup_nBars   as number;
    const phiBaseSup = inp.base_sup_barDiam as number;
    const AsBaseInf  = nBaseInf * getBarArea(phiBaseInf);
    const AsBaseSup  = nBaseSup * getBarArea(phiBaseSup);

    // Refuerzos zonales — adicionales a la base en cara traccionada.
    const nRefV   = inp.refuerzo_vano_inf_nBars    as number;
    const phiRefV = inp.refuerzo_vano_inf_barDiam  as number;
    const nRefA   = inp.refuerzo_apoyo_sup_nBars   as number;
    const phiRefA = inp.refuerzo_apoyo_sup_barDiam as number;
    const AsRefV  = nRefV * getBarArea(phiRefV);
    const AsRefA  = nRefA * getBarArea(phiRefA);

    // Vano (M+): tracción en cara inferior = base_inf + refuerzo_vano_inf; comp = base_sup.
    AsVanoBase  = AsBaseInf;
    AsVanoRef   = AsRefV;
    AsVano      = AsBaseInf + AsRefV;
    AsVanoComp  = AsBaseSup;
    // Apoyo (M−): tracción en cara superior = base_sup + refuerzo_apoyo_sup; comp = base_inf.
    AsApoyoBase = AsBaseSup;
    AsApoyoRef  = AsRefA;
    AsApoyo     = AsBaseSup + AsRefA;
    AsApoyoComp = AsBaseInf;

    // d uses the max Ø of the tension face (conservative — centroid hugs the larger bar).
    const phiTensVano  = nRefV > 0 ? Math.max(phiBaseInf, phiRefV) : phiBaseInf;
    const phiTensApoyo = nRefA > 0 ? Math.max(phiBaseSup, phiRefA) : phiBaseSup;
    barDiamVano  = phiTensVano;
    nBarsVano    = nBaseInf + nRefV;
    barDiamApoyo = phiTensApoyo;
    nBarsApoyo   = nBaseSup + nRefA;

    const stirrupV = inp.stirrupsEnabled ? (inp.vano_stirrupDiam  as number) : 0;
    const stirrupA = inp.stirrupsEnabled ? (inp.apoyo_stirrupDiam as number) : 0;
    // Bar layout (real Ø, ≤2 layers) drives both the spacing check and d: a forced
    // 2nd layer raises the steel centroid → d = h − dDepth shrinks (CE Anejo 19 §8.2).
    arrVano = arrangeNervioBars(
      [{ count: nBaseInf, phi: phiBaseInf }, { count: nRefV, phi: phiRefV }],
      bWeb - 2 * cover - 2 * stirrupV, cover + stirrupV, h,
    );
    arrApoyo = arrangeNervioBars(
      [{ count: nBaseSup, phi: phiBaseSup }, { count: nRefA, phi: phiRefA }],
      bWeb - 2 * cover - 2 * stirrupA, cover + stirrupA, h,
    );
    dVano  = h - arrVano.dDepth;
    dApoyo = h - arrApoyo.dDepth;

    // Bundles for anchorage — skip bundles with zero area.
    if (AsBaseInf > 0) bundlesVano.push({
      id: 'base-inf', label: `Montaje inferior ${nBaseInf}Ø${phiBaseInf}`,
      phi: phiBaseInf, cara: 'inf', zone: 'vano',
    });
    if (AsRefV > 0) bundlesVano.push({
      id: 'refuerzo-vano-inf', label: `Refuerzo vano inferior ${nRefV}Ø${phiRefV}`,
      phi: phiRefV, cara: 'inf', zone: 'vano',
    });
    if (AsBaseSup > 0) bundlesApoyo.push({
      id: 'base-sup', label: `Montaje superior ${nBaseSup}Ø${phiBaseSup}`,
      phi: phiBaseSup, cara: 'sup', zone: 'apoyo',
    });
    if (AsRefA > 0) bundlesApoyo.push({
      id: 'refuerzo-apoyo-sup', label: `Refuerzo apoyo superior ${nRefA}Ø${phiRefA}`,
      phi: phiRefA, cara: 'sup', zone: 'apoyo',
    });
  } else {
    // Losa maciza — franja 1000 mm.
    bWeb       = 1000;
    hFlange    = 0;
    bFlexVano  = 1000;
    bFlexApoyo = 1000;

    // Parrilla base Ø/s → As = (π·Ø²/4) · (1000 / s) por metro.
    const phiBI = inp.base_inf_phi_mac as number;
    const sBI   = inp.base_inf_s_mac   as number;
    const phiBS = inp.base_sup_phi_mac as number;
    const sBS   = inp.base_sup_s_mac   as number;
    const AsBaseInf = getBarArea(phiBI) * (1000 / sBI);
    const AsBaseSup = getBarArea(phiBS) * (1000 / sBS);

    // Refuerzos zonales — parrillas extra superpuestas (phi=0 ó s=0 ⇒ sin refuerzo).
    const phiRV = inp.refuerzo_vano_inf_phi_mac   as number;
    const sRV   = inp.refuerzo_vano_inf_s_mac     as number;
    const phiRA = inp.refuerzo_apoyo_sup_phi_mac  as number;
    const sRA   = inp.refuerzo_apoyo_sup_s_mac    as number;
    const AsRefV = phiRV > 0 && sRV > 0 ? getBarArea(phiRV) * (1000 / sRV) : 0;
    const AsRefA = phiRA > 0 && sRA > 0 ? getBarArea(phiRA) * (1000 / sRA) : 0;

    AsVanoBase  = AsBaseInf;
    AsVanoRef   = AsRefV;
    AsVano      = AsBaseInf + AsRefV;
    AsApoyoBase = AsBaseSup;
    AsApoyoRef  = AsRefA;
    AsApoyo     = AsBaseSup + AsRefA;
    AsVanoComp  = 0;
    AsApoyoComp = 0;

    const phiTensVano  = AsRefV > 0 ? Math.max(phiBI, phiRV) : phiBI;
    const phiTensApoyo = AsRefA > 0 ? Math.max(phiBS, phiRA) : phiBS;
    barDiamVano  = phiTensVano;  nBarsVano  = Math.floor(1000 / sBI);
    barDiamApoyo = phiTensApoyo; nBarsApoyo = Math.floor(1000 / sBS);
    // Spacing check uses base grid spacing (governs — parrilla base is continuous).
    macSpacingVano  = sBI;
    macSpacingApoyo = sBS;

    const stirrupV = inp.stirrupsEnabled ? (inp.vano_stirrupDiam  as number) : 0;
    const stirrupA = inp.stirrupsEnabled ? (inp.apoyo_stirrupDiam as number) : 0;
    dVano  = h - cover - stirrupV - phiTensVano  / 2;
    dApoyo = h - cover - stirrupA - phiTensApoyo / 2;

    if (AsBaseInf > 0) bundlesVano.push({
      id: 'base-inf', label: `Parrilla inferior Ø${phiBI}/${sBI} mm`,
      phi: phiBI, cara: 'inf', zone: 'vano',
    });
    if (AsRefV > 0) bundlesVano.push({
      id: 'refuerzo-vano-inf', label: `Refuerzo vano inferior Ø${phiRV}/${sRV} mm`,
      phi: phiRV, cara: 'inf', zone: 'vano',
    });
    if (AsBaseSup > 0) bundlesApoyo.push({
      id: 'base-sup', label: `Parrilla superior Ø${phiBS}/${sBS} mm`,
      phi: phiBS, cara: 'sup', zone: 'apoyo',
    });
    if (AsRefA > 0) bundlesApoyo.push({
      id: 'refuerzo-apoyo-sup', label: `Refuerzo apoyo superior Ø${phiRA}/${sRA} mm`,
      phi: phiRA, cara: 'sup', zone: 'apoyo',
    });
  }

  if (dVano  <= 0) return globalInvalid('Canto útil vano ≤ 0 — revise h, recubrimiento, Ø', variant, 'h');
  if (dApoyo <= 0) return globalInvalid('Canto útil apoyo ≤ 0', variant, 'h');

  // ── Section calcs ─────────────────────────────────────────────────────
  const vano = calcSection({
    variant, zone: 'vano',
    b: bFlexVano, d: dVano, h, cover,
    bEff: variant === 'reticular' ? bEff : bFlexVano,
    bFlange: variant === 'reticular' ? bEff : bFlexVano,
    bWeb, hFlange,
    fck, fyk,
    As: AsVano, AsBase: AsVanoBase, AsRef: AsVanoRef, AsComp: AsVanoComp,
    barDiamTens: barDiamVano, nBarsTens: nBarsVano, arrangement: arrVano,
    Ms: vanoMs, exposureClass,
    macSpacing: macSpacingVano,
  });
  const apoyo = calcSection({
    variant, zone: 'apoyo',
    b: bFlexApoyo, d: dApoyo, h, cover,
    bEff: bFlexApoyo,
    bFlange: variant === 'reticular' ? bEff : bFlexApoyo,
    bWeb, hFlange,
    fck, fyk,
    As: AsApoyo, AsBase: AsApoyoBase, AsRef: AsApoyoRef, AsComp: AsApoyoComp,
    barDiamTens: barDiamApoyo, nBarsTens: nBarsApoyo, arrangement: arrApoyo,
    Ms: apoyoMs, exposureClass,
    macSpacing: macSpacingApoyo,
  });

  // ── Flexión check rows (prepend to each section's checks) ─────────────
  vano.checks.unshift(checkQ(
    'bending',
    variant === 'reticular' ? 'Momento vano MRd ≥ Md (sección T)' : 'Momento vano MRd ≥ Md',
    vano_Md, vano.MRd, 'moment',
    'CE Anejo 19 §6.1',
  ));
  apoyo.checks.unshift(checkQ(
    'bending',
    variant === 'reticular' ? 'Momento apoyo MRd ≥ |M-| (b_w)' : 'Momento apoyo MRd ≥ |M-|',
    apoyo_Md, apoyo.MRd, 'moment',
    'CE Anejo 19 §6.1',
  ));

  // ── Anchorage (CE Anejo 19 §8.4.4) — longitud a detallar, no comprobacion ──
  // No son comprobaciones: el modulo no pregunta por la longitud disponible,
  // asi que no hay nada contra lo que comprobar. Se emiten con `neutral` para
  // que el panel las pinte sin barra ni porcentaje: antes salian con un chip
  // verde al 0 %, que se lee como «sobra margen» cuando lo que dicen es
  // «detalla 485 mm». El valor y el limite siguen ahi para el PDF.
  const appendAnchorage = (sec: ForjadosSectionResult, bundles: BarBundle[]) => {
    for (const b of bundles) {
      const a = computeAnchorage(b.phi, fctmAdherencia(fck), fyd, b.cara, h);
      sec.checks.push({
        id: `anchorage-${b.id}`,
        description: `Anclaje ${b.label} — Pos. ${a.position}`,
        value: `lb,rqd = ${a.lb_rqd.toFixed(0)} mm`,
        limit: `lb,min = ${a.lb_min.toFixed(0)} mm`,
        utilization: 0,
        status: 'ok',
        neutral: true,
        tag: `lb = ${a.lb_rqd.toFixed(0)} mm`,
        article: 'CE Anejo 19 §8.4.4',
      });
    }
  };
  appendAnchorage(vano,  bundlesVano);
  appendAnchorage(apoyo, bundlesApoyo);

  // ── Shear (CE Anejo 19 §6.2) — single VEd, governing section depth ──────────
  // Use the smaller d (more conservative), and b = b_w (reticular) or 1000 (maciza).
  const dShear = Math.min(dVano, dApoyo);
  const bShear = variant === 'reticular' ? bWeb : 1000;
  const AsShear = Math.min(AsVano, AsApoyo);  // conservative: lower rhoL
  const k = Math.min(1 + Math.sqrt(200 / dShear), 2.0);
  const rhoL = Math.min(AsShear / (bShear * dShear), 0.02);
  const VRdc1 = ((0.18 / GAMMA_C) * k * Math.pow(100 * rhoL * fck, 1 / 3) * bShear * dShear) / 1000;
  const VRdc2 = ((0.051 / GAMMA_C) * Math.pow(k, 1.5) * Math.sqrt(fck) * bShear * dShear) / 1000;
  const VRdc = Math.max(VRdc1, VRdc2);

  const shearChecks: CheckRow[] = [];
  const VEd = inp.VEd as number;
  let VRds = 0;
  let VRdmax = 0;
  let VRd = VRdc;

  if (inp.stirrupsEnabled) {
    // Use apoyo stirrup config (where cortante typically governs)
    const stirrupDiam    = inp.apoyo_stirrupDiam as number;
    const stirrupLegs    = inp.apoyo_stirrupLegs as number;
    const stirrupSpacing = inp.apoyo_stirrupSpacing as number;
    const Asw_total = stirrupLegs * getBarArea(stirrupDiam);
    const Asw = stirrupSpacing > 0 ? Asw_total / stirrupSpacing : 0;
    const z = 0.9 * dShear;
    const cotTheta = COT_THETA_CORTANTE;   // tope del CE, §6.2.3(2)
    VRds   = (Asw * z * fyd * cotTheta) / 1000;
    // CE Anejo 19 §6.2.3(3): VRd,max = ν1·fcd·b·z/(cotθ+tanθ), con el MISMO θ
    // que VRd,s. Para cotθ=2 → divisor 2,5 (no el 0.3·… de θ=45°).
    const nu1 = 0.6 * (1 - fck / 250);
    VRdmax = (nu1 * fcd * bShear * z / (cotTheta + 1 / cotTheta)) / 1000;
    VRd    = Math.min(VRds, VRdmax);

    shearChecks.push(checkQ(
      'shear',
      'Cortante VEd ≤ VRd (con cercos)',
      VEd, VRd, 'force',
      'CE Anejo 19 §6.2',
    ));
    shearChecks.push(checkQ(
      'shear-max',
      'Aplastamiento biela VEd ≤ VRd,max',
      VEd, VRdmax, 'force',
      'CE Anejo 19 §6.2',
    ));

    // ρw,min
    // CE Anejo 19 / EC2 §9.2.2 ec. (9.5N): ρw,min = 0.08·√fck/fyk
    // Regla constructiva: cumple o no, y ρw = ρw,min cumple. Hasta el
    // 2026-09-27 el caso límite salía INCUMPLE, la fila advertía también
    // cuando s > 0,75·d (eso ya lo dice la fila de separación, abajo) y citaba
    // el §6.2.3, que es el cálculo de la armadura, no su mínimo.
    const rhoWMin = (0.08 * Math.sqrt(fck)) / fyk;
    const rhoW = Asw_total / (stirrupSpacing * bShear);
    const rhoWUtil = rhoWMin / rhoW;
    shearChecks.push({
      id: 'rho-w-min',
      description: 'Cuantía mínima armadura transversal',
      value: `ρw = ${dec(rhoW, 5)}`,
      limit: `ρw,min = ${dec(rhoWMin, 5)}`,
      utilization: rhoWUtil, status: detailingStatus(rhoWUtil),
      article: 'CE Anejo 19 §9.2.2(5)',
    });

    // Max stirrup spacing
    const sMax = Math.min(0.75 * dShear, 300);
    shearChecks.push(regla(
      'stirrup-spacing-max',
      'Separación máxima entre cercos',
      stirrupSpacing, sMax,
      `s = ${stirrupSpacing.toFixed(0)} mm`,
      `s,max = ${sMax.toFixed(0)} mm`,
      'CE Anejo 19 §9.2.2(6)',
    ));
  } else {
    shearChecks.push(checkQ(
      'shear',
      'Cortante VEd ≤ VRd,c (sin cercos)',
      VEd, VRdc, 'force',
      'CE Anejo 19 §6.2',
    ));
  }

  // ── Esbeltez L/d — exención del cálculo de flecha (fix auditoría #37) ──
  // CE Anejo 19 §7.4.2 (EC2 Tabla 7.4N / EHE 50.2.2.1): si L/d ≤ (L/d)lim el
  // ELS de deformación se da por satisfecho sin calcular la flecha. Si se
  // excede, el motor NO calcula flecha (roadmap art. 50) → se emite 'warn'
  // explícito en lugar del silencio anterior (la flecha suele gobernar el
  // canto en forjados).
  const K_LD: Record<string, number> = {
    biapoyado: 1.0, 'continuo-extremo': 1.3, 'continuo-interior': 1.5, voladizo: 0.4,
  };
  const K_ld_base = K_LD[inp.tipoVano as string] ?? 1.0;
  // Sección en T con b_eff/b_w > 3 → ×0.8 (EC2 §7.4.2(2))
  const K_ld = variant === 'reticular' && bWeb > 0 && bEff / bWeb > 3
    ? K_ld_base * 0.8 : K_ld_base;
  const rho_ld = AsVano / (bFlexVano * dVano);
  const rho0 = Math.sqrt(fck) * 1e-3;
  const sqfck = Math.sqrt(fck);
  const span_ld = inp.spanLength as number;
  const ld_lim = (rho_ld <= rho0
    ? K_ld * (11 + 1.5 * sqfck * rho0 / rho_ld + 3.2 * sqfck * Math.pow(rho0 / rho_ld - 1, 1.5))
    : K_ld * (11 + 1.5 * sqfck * rho0 / rho_ld)   // ρ' = 0 (sin compresión computada)
  ) * (span_ld > 7000 ? 7000 / span_ld : 1);
  const ld_actual = span_ld / dVano;
  const ld_util = ld_lim > 0 ? ld_actual / ld_lim : 0;

  // ── Info-only checks (non-blocking) ───────────────────────────────────
  const infoChecks: CheckRow[] = [];
  infoChecks.push({
    id: 'esbeltez-flecha',
    description: ld_util <= 1
      ? 'Esbeltez L/d — exento de comprobar flecha'
      : 'Esbeltez L/d excede la exención — comprobar flecha aparte',
    value: `L/d = ${dec(ld_actual, 1)}`,
    limit: `(L/d)lim = ${dec(ld_lim, 1)} (K=${dec(K_ld, 2)})`,
    utilization: ld_util,
    status: ld_util <= 1 ? 'ok' : 'warn',
    article: 'CE Anejo 19 §7.4.2',
  });
  if (variant === 'maciza') {
    // Armadura de reparto (CE Anejo 19 §9.3.1.1) ≥ 20% armadura principal
    const AsMainPerM = AsVano; // mm²/m
    const AsRepMin = 0.2 * AsMainPerM;
    infoChecks.push({
      id: 'armadura-reparto',
      description: 'Armadura de reparto (≥ 20% principal) — verificar en plano',
      value: `—`,
      limit: `As,rep,min ≈ ${AsRepMin.toFixed(0)} mm²/m`,
      utilization: 0, status: 'ok',
      article: 'CE Anejo 19 §9.3.1.1',
    });
  }
  if (variant === 'reticular') {
    infoChecks.push({
      id: 'biaxial-note',
      description: 'Verifica una dirección — bidireccional requiere 2 ejecuciones',
      value: `—`,
      limit: `Info`,
      utilization: 0, status: 'ok',
      neutral: true,
      tag: 'Una dirección',
      // Sin artículo: es una nota de alcance del módulo, no un artículo del
      // Código. Decía 'v1', que se pintaba en el mismo hueco monoespaciado
      // donde el resto de las filas cita «CE Anejo 19 §…» y se leía como una
      // referencia normativa. La cadena vacía es el centinela de «sin
      // artículo» que ya usa lib/ai/resultsSummary.ts y que todos los
      // renderizadores guardan.
      article: '',
    });
  }

  return {
    valid: true, variant, bEff, L0,
    vano, apoyo,
    VRdc, VRds, VRd, VRdmax,
    shearChecks, infoChecks,
  };
}
