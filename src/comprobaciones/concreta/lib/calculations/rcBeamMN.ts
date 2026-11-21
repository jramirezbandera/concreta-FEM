// Flexión compuesta (M+N) de secciones de VIGA HA — armado asimétrico
// arriba/abajo, para el chequeo de vigas/cordones con axil del FEM 2D.
//
// Reutiliza los primitivos de fibras EXPORTADOS del motor de pilares
// (calcNM/computeAxis: parábola-rectángulo CE Anejo 19 §3.1.7 + pivotes B/C
// §6.1, anclados contra una referencia independiente de 4000 tiras — ver
// test/calc/rcColumns.test.ts). Aquí solo se construye el layout de barras de
// viga (2 capas: tracción y compresión de la ORIENTACIÓN que se comprueba) y
// se aplican los guards que computeAxis delega en el caller:
//
//   - NEd ≥ NRd_max  → 'nd-max' (aplastamiento por compresión pura)
//   - NEd ≤ −NtRd    → 'nt-max' (tracción pura agota la armadura; la
//                       bisección de computeAxis colapsaría a x→0 con un MRd
//                       espurio — cortar ANTES, contrato documentado allí)
//   - MRd ≤ 0        → el caller lo trata como fail (η = ∞), nunca divide
//
// Convención de `cover`: recubrimiento geométrico AL ESTRIBO (la de ambos
// motores: d = h − cover − φw − φ/2, rcBeams calcSection / rcColumns
// buildSectionModel), NO el mecánico del comentario de RcSection — así el
// MRd(N=0) de fibras casa con el del motor de vigas.
//
// NRd_max con el mismo límite que buildSectionModel (σs a εc2 = Es·0.002 =
// 400 MPa ⇒ min(fyd, 400)·As): N(x→∞) → NRd_max exacto.

import { computeAxis, type BarGroup, type PRDiagram } from './rcColumns.ts';
import { getConcrete, getFyd } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';

export interface BeamMNSection {
  b: number;             // mm
  h: number;             // mm
  fck: number;           // MPa
  fyk: number;           // MPa
  cover: number;         // mm (geométrico al estribo — ver nota de cabecera)
  stirrupDiam: number;   // mm
  /** Cara TRACCIONADA de la orientación comprobada. */
  tensNBars: number;
  tensBarDiam: number;   // mm
  /** Cara opuesta (comprimida). */
  compNBars: number;
  compBarDiam: number;   // mm
}

export interface BeamMNResult {
  /** Capacidad a flexión con el axil aplicado (kN·m). ≤ 0 ⇒ fail del caller. */
  MRd: number;
  /** Tracción pura: As_tot·fyd (kN). */
  NtRd: number;
  /** Compresión pura: fcd·(Ac−As) + min(fyd,400)·As (kN). */
  NRdMax: number;
  mode: 'ok' | 'nd-max' | 'nt-max';
  xStar: number;         // mm (0 en los modos de fallo directo)
}

/** NEd_kN CON SIGNO: + compresión (convención calcNM/computeAxis). */
export function beamMNCapacity(sec: BeamMNSection, NEd_kN: number): BeamMNResult {
  const mat = getConcrete(sec.fck);
  const fcd = mat.fcd;
  const fyd = getFyd(sec.fyk);
  const pr: PRDiagram = { epsC2: mat.eps_c2, epsCu: mat.eps_cu, nExp: mat.n };

  const AsTens = sec.tensNBars * getBarArea(sec.tensBarDiam);
  const AsComp = sec.compNBars * getBarArea(sec.compBarDiam);
  const AsTot = AsTens + AsComp;

  // y medido desde la fibra MÁS COMPRIMIDA (= cara de compresión de la
  // orientación): compresión arriba a d', tracción abajo a d.
  const yComp = sec.cover + sec.stirrupDiam + sec.compBarDiam / 2;
  const yTens = sec.h - sec.cover - sec.stirrupDiam - sec.tensBarDiam / 2;
  const bars: BarGroup[] = [
    { y: yComp, area: AsComp },
    { y: yTens, area: AsTens },
  ];

  const NRdMax = (fcd * (sec.b * sec.h - AsTot) + Math.min(fyd, 400) * AsTot) / 1000; // kN
  const NtRd = (AsTot * fyd) / 1000; // kN

  if (NEd_kN >= NRdMax) return { MRd: 0, NtRd, NRdMax, mode: 'nd-max', xStar: 0 };
  if (NEd_kN <= -NtRd) return { MRd: 0, NtRd, NRdMax, mode: 'nt-max', xStar: 0 };

  const { MRd_Nmm, x_star } = computeAxis(
    NEd_kN * 1000, sec.h, sec.b, bars, fcd, fyd, pr, NRdMax * 1000,
  );
  return { MRd: MRd_Nmm / 1e6, NtRd, NRdMax, mode: 'ok', xStar: x_star };
}
