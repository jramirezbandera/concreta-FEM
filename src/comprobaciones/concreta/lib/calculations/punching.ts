// Punching shear — Código Estructural (CE) Spain art. 6.4
// All units: mm, MPa, kN unless noted.
//
// CE Anejo 19 §6.4.2 — Critical perimeter u1 (at 2d from loaded area)
// CE Anejo 19 §6.4.3 — β eccentricity factor (simplified by position)
// CE Anejo 19 §6.4.4 — vRd,c (without shear reinforcement)
// CE Anejo 19 §6.4.5 — vRd,max (absolute max) and vRd,cs (with stirrups, α=90°),
//                       vRd,cs ≤ kmax·vRd,c con kmax = 1,5 (6.52)
// CE Anejo 19 §9.2.1.1 (9.1) — ρl,min (minimum flexural reinforcement, ver cuantiaMinima.ts)

import { type PunchingInputs, type CrucetaSteel, type PunchingPosition } from '../../data/defaults.ts';
import { getConcrete, getFyd } from '../../data/materials.ts';
import { asMinRectangular } from './cuantiaMinima.ts';
import { getBarArea } from '../../data/rebar.ts';
import { type CheckRow, detailingStatus, makeCheckQty } from './types.ts';
import { calcCruceta } from './cruceta.ts';
import { areaCargada, perimetroADistancia } from './punchingGeometria.ts';
import { dec } from '../units/format.ts';

export type { CheckRow } from './types.ts';

// ── Position helpers (CE Anejo 19 §6.4) — single source for punching + cruceta ─────
/**
 * β eccentricity factor by column position (CE Anejo 19 / EC2 fig. 6.21N,
 * simplified — válido para estructuras arriostradas con luces adyacentes que
 * no difieren más del 25%).
 *
 * Fix auditoría #132: interior era 1.0 — el simplificado del Anejo 19 es
 * **1.15** cuando hay transferencia de momento (pilar). 1.0 solo es
 * defendible para carga puntual sin momento (mode='carga-puntual').
 */
export function betaForPosition(position: PunchingPosition, momentTransfer = true): number {
  if (position === 'borde') return 1.4;
  if (position === 'esquina') return 1.5;
  return momentTransfer ? 1.15 : 1.0;
}
/** Number of loaded sides / cruceta arms by position (interior 4, borde 3, esquina 2). */
export function sidesForPosition(position: PunchingPosition): number {
  return position === 'interior' ? 4 : position === 'borde' ? 3 : 2;
}

/**
 * Cruceta-mode result detail (mode='pilar-cruceta'). Nested optional sub-object
 * on PunchingResult so existing pilar/carga-puntual consumers are untouched
 * (eng-review decision 3A). All forces kN, lengths mm, stresses MPa.
 */
/**
 * Cruceta-mode detail — RECORTADO 2026-06-09 a "compañero de hand-calc". Solo lo que
 * la herramienta defiende: el perfil UPN (clase + capacidades, informativo) y los
 * perímetros de la PLACA (de calcPunching). El reparto/alcance lo verifica el ingeniero
 * a mano (ver cruceta.ts). Todo lo del antiguo diseñador automático se eliminó.
 */
export interface CrucetaDetail {
  upnSize:    number;
  steelGrade: CrucetaSteel;
  upnClass:   1 | 2 | 3 | 4;
  MRd:        number;   // kN·m — UPN bending resistance (informativo para el hand-calc)
  VplRd:      number;   // kN — UPN plastic shear resistance (informativo)
  u0:         number;   // mm — plate-face perimeter (crushing), de calcPunching
  u1:         number;   // mm — plate control perimeter at 2d, de calcPunching
  beta:       number;
  position:   PunchingPosition;
  nArms:      number;   // brazos del detalle (interior 4 / borde 3 / esquina 2) — display
}

export interface PunchingResult {
  valid:        boolean;
  error?:       string;
  // Intermediate parameters
  beta:         number;   // eccentricity factor (simplified)
  u0:           number;   // mm — column-face perimeter (for vRd,max check)
  u1:           number;   // mm — critical perimeter at 2d
  k:            number;   // size factor min(1+√(200/d), 2.0)
  rhoL:         number;   // effective flexural ratio (dimensionless, clamped)
  rhoLMin:      number;   // minimum ratio CE 9.1
  rhoLClamped:  boolean;  // true if clamp was applied
  vMin:         number;   // MPa — vmin = 0.035·k^1.5·√fck
  vRdc:         number;   // MPa — resistance without shear reinf
  /** MPa — la (6.47) sin el suelo vmin: si queda por debajo, manda vmin. */
  vRdcFormula?: number;
  vRdmax:       number;   // MPa — absolute maximum resistance
  vRdcs?:       number;   // MPa — resistance with stirrups (only if hasShearReinf), ya topada
  /** MPa — 0,75·vRd,c + aportación de los cercos, antes del tope kmax·vRd,c de la (6.52). */
  vRdcsBruto?:  number;
  vEd:          number;   // MPa — design shear stress at u1
  vEd0:         number;   // MPa — design shear stress at u0 (column face)
  uout:         number;   // mm — perimeter beyond which no shear reinf needed
  rOut:         number;   // mm — equivalent radius of uout circle (approx for borde/esquina)
  asSup:        number;   // mm²/mm — top face As per unit width (from Ø+s)
  asInf:        number;   // mm²/mm — bottom face As per unit width
  aswPerRow:    number;   // mm² — stirrup area at one radial row (derived)
  checks:       CheckRow[];
  /** Cruceta-mode detail — only present when mode='pilar-cruceta'. */
  cruceta?:     CrucetaDetail;
}

/** C_Rd,c = 0,18/γc de la (6.47). */
export const C_RD_C = 0.18 / 1.5;

/** kmax de la (6.52): lo más que los cercos pueden subir la resistencia, en veces vRd,c. */
export const K_MAX_CS = 1.5;

const EMPTY_RESULT: PunchingResult = {
  valid: false, beta: 0, u0: 0, u1: 0, k: 0, rhoL: 0, rhoLMin: 0,
  rhoLClamped: false, vMin: 0, vRdc: 0, vRdmax: 0, vEd: 0, vEd0: 0, uout: 0, rOut: 0,
  asSup: 0, asInf: 0, aswPerRow: 0,
  checks: [],
};

function invalid(msg: string): PunchingResult {
  return { ...EMPTY_RESULT, error: msg };
}

export function calcPunching(inp: PunchingInputs): PunchingResult {
  // Cruceta mode delegates to its own calculator (eng-review Approach B).
  if (inp.mode === 'pilar-cruceta') return calcCruceta(inp);

  // ── Input validation ─────────────────────────────────────────────────────
  if (inp.d <= 0)  return invalid('d debe ser > 0');
  if (inp.VEd <= 0) return invalid('VEd debe ser > 0');
  if (inp.sSup <= 0 || inp.sInf <= 0) return invalid('Las separaciones de armado deben ser > 0');
  if (inp.barDiamSup <= 0 || inp.barDiamInf <= 0) return invalid('Los diámetros de armado deben ser > 0');
  if (inp.fck < 12 || inp.fck > 90) return invalid('fck fuera de rango (12–90 MPa)');
  if (inp.betaMode === 'custom' && !(inp.betaManual >= 1)) {
    return invalid('β personalizado debe ser ≥ 1,0 (no hay excentricidad que reduzca la demanda por debajo de la carga concéntrica)');
  }
  if (inp.hasShearReinf && inp.sr <= 0) return invalid('Separación radial sr debe ser > 0');
  if (inp.hasShearReinf && inp.swLegs <= 0) return invalid('Nº de ramas debe ser > 0');
  if (inp.hasShearReinf && inp.swDiam <= 0) return invalid('Diámetro del cerco debe ser > 0');

  const mat = getConcrete(inp.fck);
  const fcd = mat.fcd;   // MPa
  const fctm = mat.fctm; // MPa

  // ── Geometry ─────────────────────────────────────────────────────────────
  const d = inp.d;       // mm — effective depth
  const cx = inp.cx;     // mm — column/area dim x (parallel to free edge for borde)
  const cy = inp.cy;     // mm — column/area dim y (perpendicular to free edge for borde)

  // isCircular only valid for interior position
  const useCircular = inp.isCircular && inp.position === 'interior';

  // ── β — eccentricity factor (CE Anejo 19 §6.4.3) ─────────────────────────
  // 'auto' = simplificado por posición ('pilar' transfiere momento → 1.15
  // interior; 'carga-puntual' no → 1.0). 'custom' = β afinado que introduce el
  // proyectista (método general §6.4.3: β = 1 + k·MEd·u1/(VEd·W1)).
  const beta = inp.betaMode === 'custom'
    ? inp.betaManual
    : betaForPosition(inp.position, inp.mode !== 'carga-puntual');

  // ── Critical perimeter u1 (CE Anejo 19 §6.4.2, figuras A19.6.13 y A19.6.15) ─
  // El perímetro de la misma forma a 2d; la geometría (y el convenio de bordes:
  // cx paralelo al borde libre) vive en punchingGeometria.ts, que es también de
  // donde lo dibuja el lienzo.
  //   interior 2(cx + cy) + 4πd · circular π(Ø + 4d)
  //   borde    cx + 2cy + 2πd  · esquina  cx + cy + πd
  const u1 = perimetroADistancia(areaCargada(inp), 2 * d);

  // ── Column-face perimeter u0 (CE Anejo 19 §6.4.5(3) / EC2 §6.4.5(3)) ──────────
  // vRd,max crushing check is done at the column face, NOT at u1. Checking
  // it at u1 gives a vEd ~ order of magnitude smaller and effectively
  // disables the column-face crushing check.
  //   interior : u0 = 2·(cx + cy)         [circular: π·Ø]
  //   borde    : u0 = cx + 3d,  ≤ cx + 2·cy
  //   esquina  : u0 = 3d,       ≤ cx + cy
  let u0: number;
  if (useCircular) {
    u0 = Math.PI * cx;
  } else {
    switch (inp.position) {
      case 'interior':
        u0 = 2 * (cx + cy);
        break;
      case 'borde':
        u0 = Math.min(cx + 3 * d, cx + 2 * cy);
        break;
      case 'esquina':
        u0 = Math.min(3 * d, cx + cy);
        break;
      default:
        u0 = 2 * (cx + cy);
    }
  }

  // ── Design shear stress (CE Anejo 19 §6.4.3) ──────────────────────────────────
  // vEd = β · VEd[kN] · 1000 / (u1[mm] · d[mm])   → MPa = N/mm²
  // ×1000 converts kN → N
  const vEd  = beta * inp.VEd * 1000 / (u1 * d);
  const vEd0 = beta * inp.VEd * 1000 / (u0 * d);

  // ── k — size factor ───────────────────────────────────────────────────────
  const k = Math.min(1 + Math.sqrt(200 / d), 2.0);

  // ── Flexural reinforcement — As per unit width ────────────────────────────
  // Tension face: top bars for pilar (column below slab), bottom for carga-puntual
  const asSup = getBarArea(inp.barDiamSup) / inp.sSup; // mm²/mm
  const asInf = getBarArea(inp.barDiamInf) / inp.sInf; // mm²/mm
  const asTension = inp.mode === 'pilar' ? asSup : asInf;

  // ── ρl — effective flexural ratio ─────────────────────────────────────────
  // ρl = As_tension / d (dimensionless). Supuesto: malla IGUAL en ambas
  // direcciones ortogonales (ρl = √(ρx·ρy) colapsa a ρ) — documentado en UI.
  const rhoLRaw = asTension / d;

  // ρl,min de la losa por la cuantía mínima del CE, Anejo 19 §9.2.1.1 (9.1):
  // As,min = W/z · fctm,fl/fyd sobre la franja 1000 × h, dividido entre 1000·d.
  // Depende del canto TOTAL h; si h no supera a d (estado anterior al campo,
  // que recibe h = 250 de los defaults) la fila queda pendiente. Hasta el
  // 2026-09-25 era el max(0,26·fctm/fyk, 0,0013) del Eurocódigo, que el CE no
  // adopta: un tercio menos en una losa de 20 cm.
  const hLosa = inp.h;
  const conCanto = hLosa > d;
  const rhoLMin = conCanto
    ? asMinRectangular(1000, hLosa, fctm, getFyd(inp.fyk)) / (1000 * d)
    : 0;
  const rhoLClamped = rhoLRaw < rhoLMin;
  // Fix auditoría #136: la fórmula usa el ρl REAL (cap 0.02), sin suelo en
  // ρl,min — elevar al mínimo inflaba vRd,c con armado bajo mínimos (vmin lo
  // enmascaraba casi siempre, pero la dirección era anti-conservadora).
  // ρl,min queda como fila aparte (regla constructiva: cumple o no).
  const rhoL = Math.min(rhoLRaw, 0.02);

  // ── vmin ─────────────────────────────────────────────────────────────────
  const vMin = 0.035 * Math.pow(k, 1.5) * Math.sqrt(inp.fck); // MPa

  // ── vRd,c — resistance without shear reinforcement (CE Anejo 19 §6.4.4) ───────
  const vRdcFormula = C_RD_C * k * Math.pow(100 * rhoL * inp.fck, 1 / 3);
  const vRdc = Math.max(vRdcFormula, vMin);

  // ── vRd,max — absolute maximum resistance (CE Anejo 19 §6.4.5) ────────────────
  const nu = 0.6 * (1 - inp.fck / 250);          // effectiveness factor
  const vRdmax = 0.4 * nu * fcd;

  // ── Shear reinforcement — tipo viga, α=90° ────────────────────────────────
  // At each radial row: n_sides stirrups (one per column face side), each with
  // swLegs legs → Asw = n_sides × swLegs × As_sw
  const nSides = sidesForPosition(inp.position);
  const aswPerRow = nSides * inp.swLegs * getBarArea(inp.swDiam); // mm²

  // ── vRd,cs — resistance with shear reinforcement (CE Anejo 19 §6.4.5) ─────────
  // α = 90° always → sin(α) = 1
  //   vRd,cs = 0,75·vRd,c + 1,5·(d/sr)·Asw·fywd,ef/(u1·d) ≤ kmax·vRd,c   (6.52)
  // kmax = 1,5 lo fija el CE (el EC2 base no lo trae). Hasta el 2026-09-26 el
  // tope no se aplicaba: con cercos generosos vRd,cs llegaba a 2,3·vRd,c.
  let vRdcs: number | undefined;
  let vRdcsBruto: number | undefined;
  if (inp.hasShearReinf) {
    // fywd,ef = min(250 + 0.25·d, fywk/1.15)   d in mm, result in MPa
    const fywd_ef = Math.min(250 + 0.25 * d, inp.fywk / 1.15);
    vRdcsBruto = 0.75 * vRdc + 1.5 * (d / inp.sr) * aswPerRow / (u1 * d) * fywd_ef;
    vRdcs = Math.min(vRdcsBruto, K_MAX_CS * vRdc);
  }

  // ── uout — perimeter beyond which no shear reinf needed ──────────────────
  // uout = β·VEd[kN]·1000 / (vRdc·d)
  const uout = beta * inp.VEd * 1000 / (vRdc * d);
  // rOut: equivalent radius of circle with perimeter=uout (approx for borde/esquina)
  const rOut = uout / (2 * Math.PI);

  // ── Checks ────────────────────────────────────────────────────────────────
  const checks: CheckRow[] = [];

  // punz-rho-min: ρl ≥ ρl,min
  // Always show; status=warn when clamp was applied (user's rho < min)
  if (!conCanto) {
    checks.push({
      id:          'punz-rho-min',
      description: 'ρl ≥ ρl,min',
      value:       `ρl = ${dec(rhoLRaw, 4)}`,
      limit:       `falta el canto total h de la losa (h = ${hLosa} mm no supera a d = ${d} mm)`,
      utilization: 0,
      status:      'neutral',
      article:     'CE Anejo 19 §9.2.1.1 (9.1)',
    });
  } else {
    // Fix #136: utilización REAL ρmin/ρ (antes 0.85 hardcodeada al clampar)
    const rhoDisplay = rhoLRaw;
    const util = rhoDisplay > 0 ? rhoLMin / rhoDisplay : Infinity;
    checks.push({
      id:          'punz-rho-min',
      description: 'ρl ≥ ρl,min',
      value:       `ρl = ${dec(rhoDisplay, 4)}`,
      limit:       `ρl,min = ${dec(rhoLMin, 4)} (h = ${hLosa} mm)`,
      utilization: util,
      // Regla constructiva: por debajo del mínimo no cumple, y el caso límite
      // cumple. Hasta el 2026-09-27 bajo mínimos salía ADVERTENCIA y, cerca
      // del mínimo, la franja del 95 % de las de agotamiento.
      status:      detailingStatus(util),
      article:     'CE Anejo 19 §9.2.1.1 (9.1)',
    });
  }

  // punz-sr-max: sr ≤ 0.75·d (CE Anejo 19 §9.4.3) — only when shear reinf is active
  if (inp.hasShearReinf) {
    const srMax = 0.75 * d;
    const util = inp.sr / srMax; // ≤1 = ok, >1 = violation
    // Regla constructiva: cumple o no, sin advertencia al 95 %.
    const srStatus = detailingStatus(util);
    checks.push({
      id:          'punz-sr-max',
      description: 'sr ≤ 0,75·d (separación radial)',
      value:       `sr = ${inp.sr.toFixed(0)} mm`,
      limit:       `0,75d = ${srMax.toFixed(0)} mm`,
      utilization: util,
      status:      srStatus,
      article:     'CE Anejo 19 §9.4.3',
    });
  }

  // punz-ved-max: vEd0 ≤ vRd,max at column-face perimeter u0 (CE Anejo 19 §6.4.5(3))
  // Tensiones por la Quantity 'stress' → se muestran en N/mm² y convierten con el
  // toggle N/mm²↔kg/cm² (consistente con el resto de la app).
  checks.push(makeCheckQty(
    'punz-ved-max',
    'vEd,0 ≤ vRd,max (en u0, cara del pilar)',
    vEd0, vRdmax, 'stress', 'CE Anejo 19 §6.4.5(3)',
  ));

  // punz-ved-vrdc: vEd ≤ vRd,c. SIN cercos es vinculante; CON cercos pasa a
  // informativo (fail→warn): vEd > vRd,c es exactamente la situación que
  // motiva los cercos y el binding es vRd,cs + vRd,max (fix auditoría #133 —
  // antes invalidaba el resultado justo cuando los cercos eran necesarios;
  // mismo degateo que ya hacía cruceta.ts con esta fila).
  {
    const row = makeCheckQty(
      'punz-ved-vrdc',
      'vEd ≤ vRd,c (sin armado)',
      vEd, vRdc, 'stress', 'CE Anejo 19 §6.4.4',
    );
    if (inp.hasShearReinf && row.status === 'fail') {
      row.status = 'warn';
      row.description = 'vEd > vRd,c — los cercos toman el exceso (vinculan vRd,cs y vRd,max)';
    }
    checks.push(row);
  }

  // punz-ved-vrdcs: vEd ≤ vRd,cs (with stirrups) — only if hasShearReinf
  if (inp.hasShearReinf && vRdcs !== undefined) {
    const topado = vRdcsBruto !== undefined && vRdcsBruto > vRdcs;
    checks.push(makeCheckQty(
      'punz-ved-vrdcs',
      topado ? 'vEd ≤ vRd,cs (con cercos, topada a 1,5·vRd,c)' : 'vEd ≤ vRd,cs (con cercos)',
      vEd, vRdcs, 'stress', 'CE Anejo 19 §6.4.5 (6.52)',
    ));

    // Nota de DISPOSICIÓN (fix auditoría #134): la ec. 6.52 presupone el
    // detalle correcto, que este motor no comprueba (no se pide nº de filas).
    checks.push({
      id: 'punz-layout-note',
      description: `Disposición a verificar a mano: perímetro exterior de cercos hasta uout−1.5d (uout=${uout.toFixed(0)} mm), 1ª fila a 0.3-0.5·d de la cara, separación tangencial ≤1.5d (en u1) / 2d (fuera), Asw,min §9.4.3`,
      value: '',
      limit: '',
      utilization: 0,
      status: 'neutral',
      article: 'CE Anejo 19 §6.4.5(4) / §9.4.3',
      neutral: true,
      tag: 'DETALLE',
    });
  }

  // Validez del β (fix auditoría #138/#132). En 'custom' el β lo fija el
  // proyectista (método general §6.4.3) y la responsabilidad del valor es suya.
  checks.push(
    inp.betaMode === 'custom'
      ? {
          id: 'punz-beta-note',
          description: `β=${dec(beta, 2)} personalizado — introducido por el proyectista (método general §6.4.3: β=1+k·MEd·u1/(VEd·W1)); la app no verifica su cálculo`,
          value: '',
          limit: '',
          utilization: 0,
          status: 'neutral',
          article: 'CE Anejo 19 §6.4.3',
          neutral: true,
          tag: 'HIPÓTESIS',
        }
      : {
          id: 'punz-beta-note',
          description: `β=${dec(beta, 2)} simplificado — válido para estructura arriostrada con luces adyacentes que no difieren >25%; si no, calcular β con la transferencia de momento real`,
          value: '',
          limit: '',
          utilization: 0,
          status: 'neutral',
          article: 'CE Anejo 19 §6.4.3 (fig. 6.21N)',
          neutral: true,
          tag: 'HIPÓTESIS',
        },
  );

  const valid = checks.every((c) => c.status !== 'fail');

  return {
    valid,
    beta,
    u0,
    u1,
    k,
    rhoL,
    rhoLMin,
    rhoLClamped,
    vMin,
    vRdc,
    vRdcFormula,
    vRdmax,
    vRdcs,
    vRdcsBruto,
    vEd,
    vEd0,
    uout,
    rOut,
    asSup,
    asInf,
    aswPerRow,
    checks,
  };
}
