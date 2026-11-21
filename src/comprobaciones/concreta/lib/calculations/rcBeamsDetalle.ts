// Detalle de Vigas de hormigón para el lienzo — lo que el motor ya calcula,
// expuesto con sus intermedios para que el dibujo enseñe las mismas cifras que
// la tabla, sin recomponerlas por su cuenta.
//
//   · detalleSeccionRC: geometría de barras, la rotura (solveAtULU) y el estado
//     con el Md tecleado (solveSectionAtMoment), el cortante por mecanismos
//     (calcRcShear) y la fisuración (fisuracionRC). Todo sale de las mismas
//     funciones que usa calcRCBeam.
//   · detalleFlechaRC: la comprobación de pieza, por esbeltez L/d o por el
//     cálculo directo, y en éste la flecha partida en su parte INSTANTÁNEA
//     (fisurada, sin fluencia) y DIFERIDA (lo que añade la fluencia), cuya
//     suma es la de plazo infinito que puntúa en la tabla.
//
// La flecha se rehace aquí con las mismas expresiones que el bloque de
// calcRCBeam (rcBeams.ts): `rcBeamsDetalle.test.ts` fija que la total y la
// utilización coinciden con la fila de la tabla en todos los sistemas y
// modos. El límite admisible se lee de esa misma fila (δ / utilización), no
// se vuelve a decidir aquí.

import type { RCBeamInputs } from '../../data/defaults.ts';
import { getConcrete, getFyd, Es, type ConcreteGrade } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';
import { COT_THETA_CORTANTE, wkMax } from '../../data/factors.ts';
import { rcElasticModulusMPa } from '../frame-core/sections.ts';
import { crackedDeflectionFactor } from './crackedDeflection.ts';
import { asMinRectangular, CUANTIA_MAXIMA } from './cuantiaMinima.ts';
import {
  calcRcShear, fisuracionRC, pickSectionInputs, psi2Quasi,
  type FisuracionRC, type RCBeamResult, type SectionInputs,
} from './rcBeams.ts';
import { solveAtULU, solveSectionAtMoment, type SectionAtMomentResult } from './rcBeamsSection.ts';

export type ZonaViga = 'vano' | 'apoyo';

export interface CortanteRC {
  /** Brazo mecánico del modelo de bielas, 0,9·d, mm. */
  z: number;
  cotTheta: number;
  /** Ángulo de las bielas, grados. */
  theta: number;
  /** Área de un cerco con todas sus ramas, mm². */
  Asw1: number;
  s: number;
  ramas: number;
  hayCercos: boolean;
  /** Cercos que cruza una fisura a θ: z·cot θ / s. */
  cercosCosidos: number;
  rhoW: number;
  rhoWMin: number;
  sMax: number;
  /** Separación transversal entre ramas y su máximo, mm. */
  sT: number;
  sTMax: number;
  VRdc: number;
  VRds: number;
  VRdmax: number;
  VRd: number;
}

export interface DetalleSeccionRC {
  zona: ZonaViga;
  si: SectionInputs;
  mat: ConcreteGrade;
  fyd: number;
  /** Canto útil y profundidad de la armadura comprimida, desde la cara comprimida. */
  d: number;
  dp: number;
  As: number;
  AsC: number;
  /** Eje de cada barra, mm desde la cara izquierda. */
  xsTraccion: number[];
  xsCompresion: number[];
  /** Hueco libre entre barras traccionadas (NaN con una sola). */
  libre: number;
  libreMin: number;
  libreMax: number;
  eyd: number;
  /** Profundidad a la que el acero dejaría de plastificar: εcu3/(εcu3 + εyd)·d. */
  xLim: number;
  AsMin: number;
  AsMax: number;
  rotura: SectionAtMomentResult & { M_kNm: number };
  conMd: SectionAtMomentResult;
  cortante: CortanteRC;
  fisura: FisuracionRC;
  wMax: number;
  lapLength: number;
}

/** Ejes de n barras de diámetro φ repartidas entre los cercos, mm desde la cara izquierda. */
function ejesBarras(n: number, phi: number, si: SectionInputs): number[] {
  if (n <= 0) return [];
  if (n === 1) return [si.b / 2];
  const x0 = si.cover + si.stirrupDiam + phi / 2;
  const paso = (si.b - 2 * si.cover - 2 * si.stirrupDiam - phi) / (n - 1);
  return Array.from({ length: n }, (_, i) => x0 + i * paso);
}

/** Null si la sección no es válida (el panel de resultados dice por qué). */
export function detalleSeccionRC(state: RCBeamInputs, zona: ZonaViga, result: RCBeamResult): DetalleSeccionRC | null {
  const sec = result[zona];
  if (!result.valid || !sec.valid) return null;
  const si = pickSectionInputs(state, zona);
  const mat = getConcrete(si.fck);
  const fyd = getFyd(si.fyk);
  const d = sec.d;
  const dp = si.cover + si.stirrupDiam + si.barDiamComp / 2;
  const eyd = fyd / Es;
  const rotura = solveAtULU(si, mat);
  const conMd = solveSectionAtMoment(si, si.Md);

  const hayCercos = si.stirrupSpacing > 0;
  const Asw1 = si.stirrupLegs * getBarArea(si.stirrupDiam);
  const Asw = hayCercos ? Asw1 / si.stirrupSpacing : 0;
  const sh = calcRcShear({ b: si.b, d, fck: si.fck, fcd: mat.fcd, fyd, As: sec.As, Asw, hasStirrups: hayCercos, sigmaCp: 0 });
  const z = 0.9 * d;
  const cotTheta = COT_THETA_CORTANTE;
  const cortante: CortanteRC = {
    z, cotTheta, theta: (Math.atan(1 / cotTheta) * 180) / Math.PI,
    Asw1, s: si.stirrupSpacing, ramas: si.stirrupLegs, hayCercos,
    cercosCosidos: hayCercos ? (z * cotTheta) / si.stirrupSpacing : 0,
    rhoW: hayCercos ? Asw1 / (si.stirrupSpacing * si.b) : 0,
    rhoWMin: (0.08 * Math.sqrt(si.fck)) / si.fyk,
    sMax: Math.min(0.75 * d, 300),
    sT: si.stirrupLegs >= 2 ? (si.b - 2 * si.cover - 2 * si.stirrupDiam) / (si.stirrupLegs - 1) : NaN,
    sTMax: Math.min(0.75 * d, 600),
    VRdc: sh.VRdc, VRds: sh.VRds, VRdmax: sh.VRdmax, VRd: sh.VRd,
  };

  return {
    zona, si, mat, fyd, d, dp, As: sec.As, AsC: sec.AsComp,
    xsTraccion: ejesBarras(si.nBars, si.barDiam, si),
    xsCompresion: ejesBarras(si.nBarsComp, si.barDiamComp, si),
    libre: si.nBars > 1 ? (si.b - 2 * si.cover - 2 * si.stirrupDiam - si.nBars * si.barDiam) / (si.nBars - 1) : NaN,
    libreMin: Math.max(si.barDiam, 20),
    libreMax: Math.min(300, 3 * si.h),
    eyd,
    xLim: (0.0035 / (0.0035 + eyd)) * d,
    AsMin: asMinRectangular(si.b, si.h, mat.fctm, fyd),
    AsMax: CUANTIA_MAXIMA * si.b * si.h,
    rotura, conMd, cortante,
    fisura: fisuracionRC(si, sec.As, d),
    wMax: wkMax[si.exposureClass] ?? 0.3,
    lapLength: sec.lapLength,
  };
}

// ── Flecha ────────────────────────────────────────────────────────────────────

export type SistemaViga = RCBeamInputs['structSystem'];

export interface FlechaEsbeltez {
  metodo: 'ld';
  L: number;
  d: number;
  ld: number;
  K: number;
  rho: number;
  rho0: number;
  rhoP: number;
  /** Expresión que aplica: (7.16a) si ρ ≤ ρ0, (7.16b) si no. */
  expresion: 'a' | 'b';
  /** λ,lim antes de los dos factores, y los dos factores. */
  lamBase: number;
  factorAcero: number;
  factorLuz: number;
  lamLim: number;
  utilizacion: number;
}

export interface FlechaDirecta {
  metodo: 'direct';
  L: number;
  sistema: SistemaViga;
  /** El pórtico lee la sección de apoyo en ménsula; el resto, la de vano. */
  zona: ZonaViga;
  voladizo: boolean;
  phiEf: number;
  /** Momentos casi permanentes: el del vano, el del apoyo (sólo pórtico) y el que se usa. */
  McpVano: number;
  McpApoyo: number;
  /** Coeficiente del momento de apoyo que descarga el vano (0; 0,1; 0,2). */
  cApoyo: number;
  Mflecha: number;
  /** El momento con que se evalúa ζ (el mayor del miembro en pórtico). */
  Mzeta: number;
  Mcr: number;
  zeta: number;
  Ec: number;
  Ig: number;
  /** Flecha elástica con la sección bruta, mm. */
  deltaEl: number;
  /** Multiplicadores: sin fluencia (instantánea) y con φef (plazo infinito). */
  k0: number;
  k: number;
  deltaInst: number;
  deltaDif: number;
  deltaTotal: number;
  /** Límite de la tabla (L/300, o 2L/300 en voladizo si el motor así lo usa). */
  adm: number;
  limite: string;
  utilizacion: number;
}

export type DetalleFlechaRC = FlechaEsbeltez | FlechaDirecta;

/** La comprobación de pieza que puntúa en la tabla, con sus intermedios; null si no la hay. */
export function detalleFlechaRC(state: RCBeamInputs, result: RCBeamResult): DetalleFlechaRC | null {
  const L = Math.abs(state.L ?? 0);
  const vano = result.vano;
  if (!result.valid || !vano.valid || L <= 0) return null;
  const fila = vano.checks.find((c) => c.id === 'deflection-cracked' || c.id === 'slenderness-ld');
  if (!fila) return null;
  const b = state.b;
  const h = state.h;

  if (fila.id === 'slenderness-ld') {
    const K_MAP: Record<string, number> = { ss: 1.0, end: 1.3, interior: 1.5, cantilever: 0.4 };
    const K = K_MAP[state.structSystem] ?? 1.0;
    const sq = Math.sqrt(state.fck);
    const rho0 = 1e-3 * sq;
    const rho = vano.As / (b * vano.d);
    const rhoP = vano.AsComp / (b * vano.d);
    const expresion = rho <= rho0 ? 'a' : 'b';
    const lamBase = expresion === 'a'
      ? K * (11 + 1.5 * sq * (rho0 / rho) + 3.2 * sq * Math.pow(rho0 / rho - 1, 1.5))
      : K * (11 + 1.5 * sq * rho0 / (rho - rhoP) + (sq / 12) * Math.sqrt(rhoP / rho0));
    const factorAcero = 500 / state.fyk;
    const factorLuz = Math.min(1, 7000 / L);
    const lamLim = lamBase * factorAcero * factorLuz;
    const ld = L / vano.d;
    return { metodo: 'ld', L, d: vano.d, ld, K, rho, rho0, rhoP, expresion, lamBase, factorAcero, factorLuz, lamLim, utilizacion: fila.utilization };
  }

  // Cálculo directo: las expresiones del bloque de calcRCBeam.
  const psi2 = psi2Quasi(state);
  const McpVano = Math.abs(state.vano_M_G + psi2 * state.vano_M_Q);
  const McpApoyo = Math.abs(state.apoyo_M_G + psi2 * state.apoyo_M_Q);
  const portico = state.mode === 'portico';
  const voladizo = state.structSystem === 'cantilever';
  const zona: ZonaViga = voladizo && portico ? 'apoyo' : 'vano';
  const sec = result[zona];
  const phiEf = Math.max(0, state.phiEf ?? 2.0);
  const Ec = rcElasticModulusMPa(state.fck);
  const Ig = (b * Math.pow(h, 3)) / 12;
  const B = Ec * Ig;
  let deltaEl: number;
  let Mflecha: number;
  let Mzeta: number;
  let cApoyo = 0;
  if (voladizo) {
    Mflecha = zona === 'apoyo' ? McpApoyo : McpVano;
    deltaEl = (Mflecha * 1e6 * L * L) / (4 * B);
    Mzeta = Mflecha;
  } else {
    const C_APOYO: Record<string, number> = { ss: 0, end: 0.1, interior: 0.2 };
    cApoyo = portico ? (C_APOYO[state.structSystem] ?? 0) : 0;
    Mflecha = Math.max(0, McpVano - cApoyo * McpApoyo);
    deltaEl = (5 / 48) * (Mflecha * 1e6 * L * L) / B;
    Mzeta = portico ? Math.max(McpVano, McpApoyo) : McpVano;
  }
  const comun = { b, h, fck: state.fck, As: sec.As, d: sec.d, Mcp: Mzeta };
  const inf = crackedDeflectionFactor({ ...comun, phiEf });
  const ins = crackedDeflectionFactor({ ...comun, phiEf: 0 });
  const deltaTotal = deltaEl === 0 ? 0 : deltaEl * inf.k;
  const deltaInst = deltaEl === 0 ? 0 : deltaEl * ins.k;
  const utilizacion = fila.utilization;
  // El límite es el que rotula la fila («L/300 = …» o «2L/300 = …»), también
  // con flecha nula: deducirlo de δ/η solo vale si η > 0, y uno propio aquí
  // se desincroniza del motor en cuanto cambie el suyo.
  const limite = (fila.limit ?? '').split('=')[0].trim() || 'L/300';
  const m = /^(\d*)L\/(\d+)$/.exec(limite);
  const adm = m
    ? (m[1] ? Number(m[1]) * L : L) / Number(m[2])
    : utilizacion > 0 && Number.isFinite(utilizacion) ? deltaTotal / utilizacion : L / 300;
  return {
    metodo: 'direct', L, sistema: state.structSystem, zona, voladizo, phiEf,
    McpVano, McpApoyo, cApoyo, Mflecha, Mzeta, Mcr: inf.Mcr, zeta: inf.zeta, Ec, Ig,
    deltaEl, k0: ins.k, k: inf.k, deltaInst, deltaDif: deltaTotal - deltaInst, deltaTotal,
    adm, limite, utilizacion,
  };
}
