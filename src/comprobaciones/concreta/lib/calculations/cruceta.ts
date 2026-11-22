// Punzonamiento — modo "pilar metálico con crucetas UPN" (COMPAÑERO DE HAND-CALC).
//
// RECORTADO 2026-06-09 (design doc Javier-main-design-20260609-092620). Se eliminó el
// "diseñador automático" anterior (≈800 LOC, 27 checks): el reparto tipo shearhead con
// alcance L_dev —que tenía una INVERSIÓN DE SIGNO confirmada—, el apoyo confinado §6.7,
// el descuento de terreno, el crédito del brazo de borde y ~10 estados límite "verificar
// a mano". Aquello intentaba AUTOMATIZAR lo que el ingeniero hace (y debe hacer) a mano.
//
// Esta versión es HONESTA y simple. Hace solo lo que se puede defender 100%:
//   • Punzonamiento CONSERVADOR de la PLACA (placa = área cargada), reutilizando
//     calcPunching en modo 'pilar' (motor validado): u0 (aplastamiento) y u1 (vEd≤vRd,c).
//   • Clase y capacidades del UPN (EC3) como INFORMATIVO para el hand-calc del reparto.
//   • Cabida del ala del UPN en el hueco libre al borde (geometría).
//
// El REPARTO de la cruceta (que alarga u1 y baja vEd) lo verifica el INGENIERO a mano:
// esta herramienta da el punzonamiento conservador de la placa + la geometría + los datos
// del UPN. Verdict vinculante = u0 (aplastamiento) + clase UPN + cabida; el u1 de la placa
// se muestra INFORMATIVO ("sin reparto de cruceta, conservador") para que el verde NO
// dependa de un modelo de reparto.
//
// All units: mm, MPa, kN unless noted.

import { type PunchingInputs, type CrucetaSteel } from '../../data/defaults.ts';
import { getUPN, type UPNProfile } from '../../data/steelProfiles.ts';
import { type CheckRow, makeCheckNeutral, makeDetailingCheck, type CheckStatus } from './types.ts';
import { dec } from '../units/format.ts';
// ⚠ Import CIRCULAR con punching.ts (punching.ts importa calcCruceta para despachar el
// modo cruceta; aquí importamos calcPunching para el punzonamiento de la placa). Funciona
// porque ambos se usan SOLO en tiempo de llamada (dentro de funciones), nunca a nivel de
// módulo. NO referenciar calcPunching en el top level de este archivo (TDZ/undefined).
import {
  calcPunching,
  type PunchingResult,
  type CrucetaDetail,
  sidesForPosition,
} from './punching.ts';

// Re-export so existing importers (and tests) keep resolving from cruceta.
export { sidesForPosition } from './punching.ts';

const GAMMA_M0 = 1.05;
const STEEL_FY: Record<CrucetaSteel, number> = { S275: 275, S355: 355 };

// ─── Clase de sección UPN (CE Anejo 22 §5.5 Tabla 5.2, simplificado) ───────────────────
/** Clase de un UPN en flexión eje fuerte. Vuelo de ala + alma en flexión (conservador). */
function classifyUPN(upn: UPNProfile, fy: number): 1 | 2 | 3 | 4 {
  const eps = Math.sqrt(235 / fy);
  const cFlange = Math.max(upn.b - upn.tw, 0);
  const flangeRatio = cFlange / upn.tf;
  const flangeClass = flangeRatio <= 9 * eps ? 1 : flangeRatio <= 10 * eps ? 2 : flangeRatio <= 14 * eps ? 3 : 4;
  const cWeb = Math.max(upn.h - 2 * upn.tf, 0);
  const webRatio = cWeb / upn.tw;
  const webClass = webRatio <= 72 * eps ? 1 : webRatio <= 83 * eps ? 2 : webRatio <= 124 * eps ? 3 : 4;
  return Math.max(flangeClass, webClass) as 1 | 2 | 3 | 4;
}

function invalid(msg: string): PunchingResult {
  return {
    valid: false, error: msg, beta: 0, u0: 0, u1: 0, k: 0, rhoL: 0, rhoLMin: 0,
    rhoLClamped: false, vMin: 0, vRdc: 0, vRdmax: 0, vEd: 0, vEd0: 0, uout: 0, rOut: 0,
    asSup: 0, asInf: 0, aswPerRow: 0, checks: [],
  };
}

export function calcCruceta(inp: PunchingInputs): PunchingResult {
  // ── Validación ─────────────────────────────────────────────────────────────
  if (inp.plateA <= 0 || inp.plateB <= 0) return invalid('Dimensiones de placa deben ser > 0');
  const upn = getUPN(inp.upnSize);
  if (!upn) return invalid(`Perfil UPN ${inp.upnSize} no encontrado`);
  if (inp.position !== 'interior' && inp.edgeY <= 0) {
    return invalid('Distancia al borde libre debe ser > 0');
  }
  if (inp.position === 'esquina' && inp.edgeX <= 0) {
    return invalid('Distancia al 2º borde libre debe ser > 0 (esquina)');
  }

  // ── Punzonamiento CONSERVADOR de la placa (reusa el motor plano validado) ────
  // La PLACA es el área cargada. mode='pilar' (NUNCA 'pilar-cruceta' → recursión en
  // punching.ts). cx/cy = dimensiones de placa. Sin armado de punzonamiento (cercos)
  // en este modo: el detalle de la cruceta no es una losa fina con cercos radiales.
  const plateInp: PunchingInputs = {
    ...inp,
    mode: 'pilar',
    cx: inp.plateA,
    cy: inp.plateB,
    isCircular: false,
    hasShearReinf: false,
  };
  const base = calcPunching(plateInp);
  if (base.error) return base; // propaga un error de validación de la placa (d, fck, armado…)

  // ── UPN (EC3) — informativo para el hand-calc del reparto ────────────────────
  // fy reducido para tf > 16 mm (UPN320 tf=17.5, UPN400 tf=18 — fix #137)
  const fy_base = STEEL_FY[inp.steelGrade];
  const fy = upn.tf > 16 ? fy_base - 10 : fy_base;
  const upnClass = classifyUPN(upn, fy);
  const W = (upnClass <= 2 ? upn.Wpl_y : upn.Wel_y) * 1000;          // mm³
  const MRd = (W * fy) / GAMMA_M0 / 1e6;                            // kN·m
  const VplRd = (upn.h * upn.tw * fy) / (Math.sqrt(3) * GAMMA_M0) / 1000; // kN

  // ── Checks ───────────────────────────────────────────────────────────────────
  // Del punzonamiento de la placa: punz-ved-max (u0, aplastamiento) y punz-rho-min
  // VINCULAN (fail). punz-ved-vrdc (u1) se DE-GATEA a AMBAR cuando no pasa: la placa
  // SOLA casi siempre no pasa (por eso se pone la cruceta), así que NO es fail (no
  // bloquea — el reparto del ingeniero lo rescata). Pero se muestra en ámbar con su %
  // real y barra (NO en gris): así el verdict NO sale verde fingiendo que cumple, y la
  // etiqueta deja claro que falta el hand-calc del reparto (eng-review 2026-06-09, H1).
  const checks: CheckRow[] = base.checks.map((c) => {
    if (c.id !== 'punz-ved-vrdc') return c;
    const fails = c.status === 'fail';
    return {
      ...c,
      status: fails ? ('warn' as CheckStatus) : c.status,
      description: fails
        ? 'vEd > vRd,c en la PLACA SOLA — REQUIERE el reparto de la cruceta (verificar a mano)'
        : 'vEd ≤ vRd,c en la placa (sin reparto de cruceta, conservador)',
    };
  });

  // Clase UPN (vinculante: clase 4 no soportada).
  checks.push({
    id: 'cru-class',
    description: 'Clase de sección UPN ≤ 3 (EC3)',
    value: `Clase ${upnClass}`, limit: '≤ 3',
    utilization: upnClass <= 3 ? upnClass / 4 : 1,
    status: upnClass <= 3 ? 'ok' : 'fail',
    article: 'CE Anejo 22 §5.5',
  });

  // Capacidades del UPN — informativo (el ingeniero comprueba el reparto/flexión a mano).
  checks.push(makeCheckNeutral(
    'cru-upn-cap',
    'Capacidades del UPN (dato para el hand-calc del reparto)',
    `M_Rd ${dec(MRd, 1)} kN·m · Vpl,Rd ${dec(VplRd, 0)} kN`,
    'CE Anejo 22 §6.2',
  ));

  // Cabida del ala en el hueco libre al borde (geometría, vinculante): cabe o
  // no cabe, y el ala que llena el hueco justo cabe.
  if (inp.position !== 'interior') {
    checks.push(makeDetailingCheck(
      'cru-edge-fit', 'Ancho de ala b ≤ hueco libre al borde',
      upn.b, inp.edgeY, `b = ${upn.b} mm`, `hueco = ${inp.edgeY.toFixed(0)} mm`, 'geometría del detalle',
    ));
    if (inp.position === 'esquina') {
      checks.push(makeDetailingCheck(
        'cru-edge-fit-2', 'Ancho de ala b ≤ hueco al 2º borde (esquina)',
        upn.b, inp.edgeX, `b = ${upn.b} mm`, `hueco = ${inp.edgeX.toFixed(0)} mm`, 'geometría del detalle',
      ));
    }
  }

  const valid = checks.every((c) => c.status !== 'fail');

  const cruceta: CrucetaDetail = {
    upnSize: inp.upnSize,
    steelGrade: inp.steelGrade,
    upnClass,
    MRd,
    VplRd,
    u0: base.u0,
    u1: base.u1,
    beta: base.beta,
    position: inp.position,
    nArms: sidesForPosition(inp.position),
  };

  return { ...base, valid, checks, cruceta };
}
