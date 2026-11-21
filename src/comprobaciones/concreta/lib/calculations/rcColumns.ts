// RC Column calculations — Codigo Estructural (CE) Spain
// Rectangular section under combined axial compression + biaxial bending.
// All units: mm, MPa, kN, kNm unless noted.
//
// CE Anejo 19 §3.1     — Concrete material properties
// CE Anejo 19 §6.1     — Bending resistance (ELU Flexocompresion)
// CE Anejo 19 §9.5.2   — Reinforcement limits for columns
// CE Anejo 19 §5.8     — Second-order effects (slenderness)
// CE Anejo 19 §5.8.8 — Nominal curvature method
// CE Anejo 19 §8.2   — Bar spacing
// CE Anejo 19 §9.5.3 — Transverse reinforcement for columns
// CE Anejo 19 §5.8.9 — Biaxial bending simplified criterion

import { type RCColumnInputs } from '../../data/defaults.ts';
import { getConcrete, getFyd, Es } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';
import { type CheckRow, toStatus, makeCheckQty, makeDetailingCheck } from './types.ts';
import { dec } from '../units/format.ts';

export type { CheckStatus, CheckRow } from './types.ts';

export interface RCColumnResult {
  valid: boolean;
  error?: string;
  // Geometry
  d_y: number;      // effective depth for y-axis bending (mm)
  d_z: number;      // effective depth for z-axis bending (mm)
  d_prime: number;  // compression bar centroid depth (same for both axes) (mm)
  As_total: number; // total steel area (mm²)
  // Slenderness
  lambda_y: number;
  lambda_z: number;
  Lk: number;       // effective buckling length (m)
  // Eccentricities — y-axis
  e1_y: number; e_imp_y: number; e2_y: number; e_tot_y: number;
  MEd_tot_y: number; // kNm
  // Eccentricities — z-axis
  e1_z: number; e_imp_z: number; e2_z: number; e_tot_z: number;
  MEd_tot_z: number; // kNm
  // N-M interaction
  NRd_max: number;   // kN
  x_star_y: number;  // neutral axis depth for y-axis (mm)
  x_star_z: number;  // neutral axis depth for z-axis (mm)
  MRdy: number;      // kNm
  MRdz: number;      // kNm
  ned: number;       // NEd / NRd_max
  a: number;         // biaxial exponent
  biaxialUtil: number; // (MEdy/MRdy)^a + (MEdz/MRdz)^a
  // Rebar info
  rebarSchedule: string;
  lapLength: number;
  // ── Circular section (aditivo; solo poblado cuando sectionType === 'circular') ──
  // Los campos rectangulares espejo (lambda_y/z, MRdy/z, d_y/z, biaxialUtil) se
  // rellenan también en circular para que los consumidores no ramifiquen donde no
  // es necesario. Estos son los específicos del círculo.
  sectionType: 'rectangular' | 'circular';
  D?: number;          // diámetro (mm)
  lambda?: number;     // esbeltez única = Lk/(D/4)
  d_circ?: number;     // canto eficaz curvatura = D/2 + i_s (mm)
  M_res?: number;      // momento resultante solicitante = hypot(MEd_tot_y, MEd_tot_z) (kNm)
  e_tot_res?: number;  // excentricidad total en la dirección resultante (mm)
  MRd?: number;        // momento resistente único (kNm) — mínimo sobre θ0
  x_star?: number;     // profundidad de fibra neutra circular (mm)
  theta_star?: number; // rotación gobernante del anillo (rad, en [0, π/n])
  resUtil?: number;    // M_res / MRd
  /** Lo que el lienzo dibuja partido en piezas; sólo en un resultado válido. */
  detalle?: RCColumnDetalle;
  // Checks
  checks: CheckRow[];
}

/** Una excentricidad de la sección crítica, término a término (mm). */
export interface RCExcentricidad {
  /** Momento de 1.er orden que se lleva a excentricidad (kNm; en circular, la resultante). */
  M0: number;
  e0: number;
  /** Excentricidad mínima max(canto/30, 20). */
  emin: number;
  /** max(e0, emin). */
  e1: number;
  /** Imperfección Lk/400. */
  ei: number;
  /** Segundo orden (curvatura nominal); 0 si λ ≤ λlím. */
  e2: number;
  etot: number;
  lambda: number;
  /** Radio de giro de la sección bruta (mm). */
  i: number;
  /** Canto útil de la curvatura (mm). */
  d: number;
  /** β = 0,35 + fck/200 − λ/150 de la (5.37). */
  betaPhi: number;
  Kphi: number;
  /** 1/r0 = εyd/(0,45·d), 1/mm. */
  invr0: number;
}

/** Una barra (o un grupo a la misma profundidad) en el agotamiento. */
export interface RCBarraAgotamiento {
  /** Profundidad desde la fibra más comprimida (mm). */
  y: number;
  area: number;
  eps: number;
  /** Tensión del acero, recortada a ±fyd (N/mm²). */
  sigma: number;
  /** Fuerza neta, descontado el hormigón desplazado (N; + compresión). */
  F: number;
}

/** El estado de agotamiento a N = NEd de un plano: deformaciones y fuerzas. */
export interface RCAgotamiento {
  x: number;
  depth: number;
  pivote: 'B' | 'C';
  epsTop: number;
  epsBot: number;
  /** Resultante del hormigón (N) y su profundidad (mm). */
  Fc: number;
  yc: number;
  barras: RCBarraAgotamiento[];
  /** Σ F (N) y Σ F·(depth/2 − y) (N·mm): NEd y MRd. */
  N: number;
  M: number;
}

export interface RCColumnDetalle {
  /** n = NEd/(Ac·fcd), el axil reducido de la (5.13N). */
  n: number;
  /** 20·A·B·C/√n con A = 0,7, B = 1,1, C = 0,7, antes del tope de 25. */
  lambdaLimRaw: number;
  lambdaLim: number;
  phiEf: number;
  fcd: number;
  fyd: number;
  epsC2: number;
  epsCu: number;
  nExp: number;
  /** En circular, las dos son la de la dirección resultante. */
  y: RCExcentricidad;
  z: RCExcentricidad;
  /** Plano y (en circular, el de la resultante con el anillo en θ*); null si agota por compresión pura. */
  agotY: RCAgotamiento | null;
  agotZ: RCAgotamiento | null;
  /** (MEd/MRd)^a de cada plano en la (5.39); 0 en circular. */
  terminoY: number;
  terminoZ: number;
  /** Factor de los momentos a NEd fijo hasta el contorno (NaN si no hay). */
  reserva: number;
  cercos: RCCercos;
}

/** Los cercos del alzado: las cifras de `stirrup-spacing` y `stirrup-densification`. */
export interface RCCercos {
  /** smax del §9.5.3(3), mm. */
  sMax: number;
  /** 0,6·smax del §9.5.3(4), mm. */
  sDens: number;
  /** Longitud de cada zona densificada junto a vigas o forjados: la mayor dimensión, mm. */
  zona: number;
  /** El solape también se densifica: alguna barra longitudinal pasa de Ø14. */
  densSolape: boolean;
  /**
   * Paso en las zonas densificadas: el introducido si ya cabe en 0,6·smax; si
   * no, 0,6·smax redondeado a 5 mm hacia abajo. El módulo calcula UN estribado
   * corrido y sólo avisa; esto es cómo se resuelve en el despiece.
   */
  sZona: number;
}

function cercosDetalle(s: number, sMax: number, zona: number, maxLongDiam: number): RCCercos {
  const sDens = 0.6 * sMax;
  return { sMax, sDens, zona, densSolape: maxLongDiam > 14, sZona: s <= sDens ? s : Math.floor(sDens / 5) * 5 };
}

/** One rebar layer of the fiber model. Exported for reuse by the FEM 2D beam
 *  M+N check (rcBeamMN.ts) — the primitives accept ARBITRARY (asymmetric)
 *  layouts; only buildSectionModel is coupled to the symmetric column cage. */
export interface BarGroup { y: number; area: number; }

// ── Modelo de fibras compartido (rectangular + circular) ─────────────────────
// Diagrama parábola-rectángulo del hormigón (Anejo 19 §3.1.7(1)) + diagrama de
// pivotes B/C (§6.1). Sustituye al bloque de Whitney con pivote B solo
// (migración 2026-07-01): aquel sobreestimaba MRd frente al diagrama de
// pivotes de forma creciente con el axil (rectangular: +3% a ned=0.5, +14% a
// ned=0.9; circular: hasta +32%, al faltar además el η·fcd −10% de §3.1.7(3)
// para anchos decrecientes — la integración exacta lo hace innecesario).

/** Parámetros del diagrama parábola-rectángulo (CE 21.3.3 / Anejo 19 §3.1.7). */
export interface PRDiagram { epsC2: number; epsCu: number; nExp: number }

/** Nº de tiras de la integración por fibras del hormigón. */
const N_STRIPS_FIBER = 240;

// Deformación a profundidad y (desde la fibra más comprimida) para fibra
// neutra x: pivote B (εcu en fibra extrema) mientras x ≤ depth; pivote C
// (εc2 fija a profundidad depth·(1−εc2/εcu), = 3h/7 con los valores por
// defecto) cuando toda la sección está comprimida.
function strainPivots(y: number, x: number, depth: number, pr: PRDiagram): number {
  if (x <= depth) return pr.epsCu * (x - y) / x;
  const yC = depth * (1 - pr.epsC2 / pr.epsCu);
  return pr.epsC2 * (x - y) / (x - yC);
}

// σc(ε) parábola-rectángulo: fcd·(1 − (1 − ε/εc2)^n) hasta εc2, plateau fcd.
function sigmaConcretePR(eps: number, fcd: number, pr: PRDiagram): number {
  if (eps <= 0) return 0;
  if (eps >= pr.epsC2) return fcd;
  return fcd * (1 - Math.pow(1 - eps / pr.epsC2, pr.nExp));
}

/**
 * Concrete + steel N-M capacity at neutral axis depth x — integración por
 * fibras (tiras horizontales, ancho constante) del parábola-rectángulo con
 * pivotes B/C. A las barras comprimidas se les descuenta el hormigón
 * desplazado (σs − σc), de modo que N(x→∞) → fcd·(b·h−As) + 400·As = NRd_max
 * exacto (pivote C puro: ε→εc2 ⇒ σs→Es·0.002 = 400).
 * @param x     neutral axis depth from compression face (mm)
 * @param width section dimension perpendicular to bending (mm)
 * @param depth section dimension in bending direction (mm)
 * @param bars  array of {y: distance from compression face (mm), area: mm²}
 */
export function calcNM(
  x: number,
  width: number,
  depth: number,
  bars: BarGroup[],
  fcd: number,
  fyd: number,
  pr: PRDiagram,
): { NRd: number; MRd: number } {
  const dy = depth / N_STRIPS_FIBER;
  let NRd = 0;
  let MRd = 0;
  for (let i = 0; i < N_STRIPS_FIBER; i++) {
    const y = (i + 0.5) * dy;
    const sc = sigmaConcretePR(strainPivots(y, x, depth, pr), fcd, pr);
    if (sc <= 0) break;               // tiras ordenadas: bajo la fibra neutra σ = 0
    NRd += sc * width * dy;
    MRd += sc * width * dy * (depth / 2 - y);
  }
  for (const bar of bars) {
    const eps = strainPivots(bar.y, x, depth, pr);
    const sigS = Math.max(-fyd, Math.min(fyd, Es * eps));
    const sig = sigS - sigmaConcretePR(eps, fcd, pr);   // descuenta hormigón desplazado
    NRd += bar.area * sig;
    MRd += bar.area * sig * (depth / 2 - bar.y);
  }
  return { NRd, MRd };
}

/**
 * El mismo equilibrio que `calcNM` / `calcNMCirc`, partido en piezas para el
 * dibujo: la resultante del hormigón y su profundidad, y cada barra con su
 * deformación, su tensión y su fuerza neta. `ancho(y)` es el ancho de la tira a
 * la profundidad y (constante en rectangular, la cuerda en circular).
 */
function desgloseNM(
  x: number, depth: number, ancho: (y: number) => number,
  bars: BarGroup[], fcd: number, fyd: number, pr: PRDiagram,
): RCAgotamiento {
  const dy = depth / N_STRIPS_FIBER;
  let Fc = 0, Mc = 0, Sy = 0;
  for (let i = 0; i < N_STRIPS_FIBER; i++) {
    const y = (i + 0.5) * dy;
    const sc = sigmaConcretePR(strainPivots(y, x, depth, pr), fcd, pr);
    if (sc <= 0) break;
    const f = sc * ancho(y) * dy;
    Fc += f;
    Mc += f * (depth / 2 - y);
    Sy += f * y;
  }
  const barras = bars.map((b) => {
    const eps = strainPivots(b.y, x, depth, pr);
    const sigma = Math.max(-fyd, Math.min(fyd, Es * eps));
    return { y: b.y, area: b.area, eps, sigma, F: b.area * (sigma - sigmaConcretePR(eps, fcd, pr)) };
  });
  return {
    x, depth, pivote: x <= depth ? 'B' : 'C',
    epsTop: strainPivots(0, x, depth, pr), epsBot: strainPivots(depth, x, depth, pr),
    Fc, yc: Fc > 0 ? Sy / Fc : 0, barras,
    N: Fc + barras.reduce((s, b) => s + b.F, 0),
    M: Mc + barras.reduce((s, b) => s + b.F * (depth / 2 - b.y), 0),
  };
}

/**
 * Binary search for x_star and resulting MRd for one bending axis.
 * N(x) es monótona creciente con asíntota NRd_max (pivote C): para
 * NEd < NRd_max siempre hay equilibrio — se expande el techo exponencialmente
 * antes de bisecar (la antigua zona gap de Whitney ya no existe).
 * También converge con NEd NEGATIVO (tracción): N(x→1e-3) = −As_tot·fyd
 * (todas las barras a −fyd, hormigón nulo), así que el bracketing cubre
 * (−NtRd, NRd_max). CONTRATO DEL CALLER: para NEd ≤ −NtRd NO hay equilibrio
 * (la bisección colapsaría a xLo con un MRd espurio) — el caller debe cortar
 * antes con su propio fail de tracción pura (ver rcBeamMN.ts).
 * Returns MRd in N·mm.
 */
export function computeAxis(
  NEd_N: number,
  depth: number,
  width: number,
  bars: BarGroup[],
  fcd: number,
  fyd: number,
  pr: PRDiagram,
  NRd_max: number,
): { MRd_Nmm: number; x_star: number; ndMaxFailed: boolean } {
  if (NEd_N >= NRd_max) {
    return { MRd_Nmm: 0, x_star: depth, ndMaxFailed: true };
  }
  let xLo = 1e-3;
  let xHi = 2 * depth;
  for (let g = 0; g < 24 && calcNM(xHi, width, depth, bars, fcd, fyd, pr).NRd < NEd_N; g++) {
    xHi *= 2;
  }
  for (let i = 0; i < 80; i++) {
    const xMid = (xLo + xHi) / 2;
    if (calcNM(xMid, width, depth, bars, fcd, fyd, pr).NRd < NEd_N) {
      xLo = xMid;
    } else {
      xHi = xMid;
    }
  }
  const x_star = (xLo + xHi) / 2;
  const { MRd } = calcNM(x_star, width, depth, bars, fcd, fyd, pr);
  return { MRd_Nmm: MRd, x_star, ndMaxFailed: false };
}

/** Interpolate biaxial exponent a from NEd/NRd_max (CE Anejo 19 §5.8.9(4)). */
function interpExponent(ned: number): number {
  if (ned <= 0.1) return 1.0;
  if (ned <= 0.7) return 1.0 + (ned - 0.1) / 0.6 * 0.5;  // 1.0 → 1.5
  if (ned <= 1.0) return 1.5 + (ned - 0.7) / 0.3 * 0.5;  // 1.5 → 2.0
  return 2.0; // clamp defensivo (ned < 1 siempre que nd-max no falle)
}

// ── Section model — geometry + materials + bar groups + axial capacities ────
// Construcción de barsY/barsZ + NRd_max extraída como helper
// compartido por calcRCColumn y buildColumnInteraction: una sola fuente para
// el modelo de sección, sin forkear el motor (autoplan eng review 2026-05-17).
interface SectionModel {
  mat: ReturnType<typeof getConcrete>;
  fcd: number;
  fyd: number;
  pr: PRDiagram;        // parábola-rectángulo del hormigón (εc2, εcu, n)
  As_total: number;
  d_prime: number;
  d_y: number;
  d_z: number;
  barsY: BarGroup[];
  barsZ: BarGroup[];
  NRd_max: number;      // N — compresión pura, área neta (CE Anejo 19 §3.1)
}

function buildSectionModel(inp: RCColumnInputs): SectionModel | { error: string } {
  const { b, h, cover, cornerBarDiam, nBarsX, barDiamX, nBarsY, barDiamY,
          stirrupDiam, fck, fyk } = inp;

  if (cornerBarDiam < 6) return { error: 'Diámetro de barra esquina debe ser ≥ 6 mm' };
  if (nBarsX < 0 || nBarsY < 0) return { error: 'El número de barras intermedias no puede ser negativo' };

  const mat = getConcrete(fck);
  const fcd = mat.fcd;
  const fyd = getFyd(fyk);
  const pr: PRDiagram = { epsC2: mat.eps_c2, epsCu: mat.eps_cu, nExp: mat.n };

  const cornerArea = getBarArea(cornerBarDiam);
  const areaX = getBarArea(barDiamX);
  const areaY = getBarArea(barDiamY);
  const As_total = 4 * cornerArea + 2 * nBarsX * areaX + 2 * nBarsY * areaY;

  const d_prime = cover + stirrupDiam + cornerBarDiam / 2;
  const d_y = h - cover - stirrupDiam - cornerBarDiam / 2; // y-axis, depth = h
  const d_z = b - cover - stirrupDiam - cornerBarDiam / 2; // z-axis, depth = b

  if (d_y <= d_prime) return { error: 'Canto insuficiente para el diámetro de barra esquina' };
  if (d_z <= d_prime) return { error: 'Ancho insuficiente para el diámetro de barra esquina' };

  // Y-axis: depth = h, width = b. Caras primarias sup/inf; barras laterales izq/der.
  const As_top = 2 * cornerArea + nBarsX * areaX;
  const barsY: BarGroup[] = [
    { y: d_prime, area: As_top },
    { y: d_y, area: As_top },
  ];
  for (let i = 1; i <= nBarsY; i++) {
    barsY.push({ y: d_prime + i * (h - 2 * d_prime) / (nBarsY + 1), area: 2 * areaY });
  }

  // Z-axis: depth = b, width = h. Caras primarias izq/der; barras laterales sup/inf.
  const As_left = 2 * cornerArea + nBarsY * areaY;
  const barsZ: BarGroup[] = [
    { y: d_prime, area: As_left },
    { y: d_z, area: As_left },
  ];
  for (let i = 1; i <= nBarsX; i++) {
    barsZ.push({ y: d_prime + i * (b - 2 * d_prime) / (nBarsX + 1), area: 2 * areaX });
  }

  // En compresión centrada εc se limita a εc2 = 0.002 (pivote C): la tensión
  // del acero no puede superar Es·0.002 = 400 N/mm² (f_yc,d). Para B500S
  // (fyd=434.8) usar fyd sobreestimaba NRd_max ~2% del lado inseguro;
  // coherente ahora con el check as-min-mech (CE Anejo 19 §6.1 / EHE art.40.2).
  // calcNM (fibras, hormigón desplazado descontado) tiende a este mismo valor
  // cuando x→∞, así que la bisección cubre todo NEd < NRd_max sin zona gap.
  const fyc_d_max = Math.min(fyd, 400);
  const NRd_max = fcd * (b * h - As_total) + fyc_d_max * As_total;

  return { mat, fcd, fyd, pr, As_total, d_prime, d_y, d_z, barsY, barsZ, NRd_max };
}

export function calcRCColumn(inp: RCColumnInputs): RCColumnResult {
  // Fork por forma de sección. El camino rectangular queda intacto (true fork,
  // decisión D1/T1 de la revisión): el motor circular vive en calcRCColumnCirc
  // con su propio solver, sin tocar calcNM/computeAxis rectangulares.
  if ((inp.sectionType ?? 'rectangular') === 'circular') return calcRCColumnCirc(inp);

  const {
    b, h, cover,
    cornerBarDiam, nBarsX, barDiamX, nBarsY, barDiamY,
    stirrupDiam, stirrupSpacing,
    Nd, MEdy, MEdz,
    L, beta,
  } = inp;

  const Lk = L * beta;
  const Lk_mm = Lk * 1000;

  const invalid = (error: string): RCColumnResult => ({
    valid: false, error,
    d_y: 0, d_z: 0, d_prime: 0, As_total: 0,
    lambda_y: 0, lambda_z: 0, Lk: 0,
    e1_y: 0, e_imp_y: 0, e2_y: 0, e_tot_y: 0, MEd_tot_y: 0,
    e1_z: 0, e_imp_z: 0, e2_z: 0, e_tot_z: 0, MEd_tot_z: 0,
    NRd_max: 0, x_star_y: 0, x_star_z: 0, MRdy: 0, MRdz: 0,
    ned: 0, a: 0, biaxialUtil: 0,
    rebarSchedule: '', lapLength: 0,
    sectionType: 'rectangular',
    checks: [],
  });

  // ── Input validation ───────────────────────────────────────────────────────
  if (Nd < 1) return invalid('NEd debe ser \u2265 1 kN (m\u00f3dulo para flexocompresi\u00f3n)');

  const sm = buildSectionModel(inp);
  if ('error' in sm) return invalid(sm.error);
  const {
    mat, fcd, fyd, pr, As_total, d_prime, d_y, d_z, barsY, barsZ, NRd_max,
  } = sm;

  // ── Step 3: Slenderness per axis ───────────────────────────────────────────
  const lambda_y = Lk_mm / (h / Math.sqrt(12));  // strong axis (iy = h/√12)
  const lambda_z = Lk_mm / (b / Math.sqrt(12));  // weak axis  (iz = b/√12)

  // ── Step 4: Second-order eccentricities (CE Anejo 19 §5.8.8) ──────────────────
  const NEd_N = Nd * 1e3;  // N

  // Método de curvatura nominal: 1/r = Kr·Kφ·(1/r0) con 1/r0 = εyd/(0.45·d)
  // (CE Anejo 19 §5.8.8.3). Kr = 1 (lado seguro). Kφ = 1 + β·φef ≥ 1
  // (expr. 5.37, β = 0.35 + fck/200 − λ/150) corrige por fluencia — omitirlo
  // subestima e2 un 20-40% en el rango 25 < λ ≲ 70 donde el 2º orden gobierna.
  const phiEf = inp.phiEf ?? 2.0;
  const Kphi_y = Math.max(1, 1 + (0.35 + inp.fck / 200 - lambda_y / 150) * phiEf);
  const Kphi_z = Math.max(1, 1 + (0.35 + inp.fck / 200 - lambda_z / 150) * phiEf);

  // Umbral para despreciar el 2º orden: λ_lim = 20·A·B·C/√n (CE Anejo 19
  // expr. 5.13N; con los defaults A=0.7, B=1.1, C=0.7 → 10.78/√n) capado al
  // 25 anterior. El corte fijo en 25 solo es seguro con n ≤ ~0.19: con axil
  // alto la norma exige considerar e2 desde esbelteces menores.
  const n_ax = NEd_N / (b * h * fcd);
  const lambda_lim = Math.min(
    (20 * 0.7 * 1.1 * 0.7) / Math.sqrt(Math.max(n_ax, 1e-9)),
    25,
  );

  const e0y = Math.abs(MEdy) * 1e6 / NEd_N;
  const e1_y = Math.max(e0y, Math.max(h / 30, 20));
  const e_imp_y = Lk_mm / 400;
  const curv_y = Kphi_y * fyd / (Es * 0.45 * d_y);
  const e2_y = lambda_y > lambda_lim ? curv_y * Lk_mm * Lk_mm / 10 : 0;
  const e_tot_y = e1_y + e_imp_y + e2_y;
  const MEd_tot_y = NEd_N * e_tot_y / 1e6;  // kNm

  const e0z = Math.abs(MEdz) * 1e6 / NEd_N;
  const e1_z = Math.max(e0z, Math.max(b / 30, 20));
  const e_imp_z = Lk_mm / 400;
  const curv_z = Kphi_z * fyd / (Es * 0.45 * d_z);
  const e2_z = lambda_z > lambda_lim ? curv_z * Lk_mm * Lk_mm / 10 : 0;
  const e_tot_z = e1_z + e_imp_z + e2_z;
  const MEd_tot_z = NEd_N * e_tot_z / 1e6;  // kNm

  // ── Step 6: N-M interaction for both axes ─────────────────────────────────
  const axisY = computeAxis(NEd_N, h, b, barsY, fcd, fyd, pr, NRd_max);
  const axisZ = computeAxis(NEd_N, b, h, barsZ, fcd, fyd, pr, NRd_max);

  const ndMaxFailed = axisY.ndMaxFailed; // same result for both axes (same NRd_max)
  const MRdy = axisY.MRd_Nmm / 1e6;     // kNm
  const MRdz = axisZ.MRd_Nmm / 1e6;     // kNm

  // ── Step 7: Biaxial check (CE Anejo 19 §5.8.9) ────────────────────────
  const ned = NEd_N / NRd_max;
  const a   = interpExponent(ned);

  let biaxialUtil: number;
  if (ndMaxFailed) {
    biaxialUtil = Infinity;
  } else {
    const termY = MRdy > 0 ? Math.pow(MEd_tot_y / MRdy, a) : 0;
    const termZ = MRdz > 0 ? Math.pow(MEd_tot_z / MRdz, a) : 0;
    biaxialUtil = termY + termZ;
  }

  // ── Step 8: Conditions 5.38a/b ────────────────────────────────────────────
  const cond_a = (lambda_y / lambda_z <= 2) && (lambda_z / lambda_y <= 2);

  const ey_norm = e_tot_y / h;
  const ez_norm = e_tot_z / b;
  const eccRatio = Math.max(ey_norm, ez_norm) / Math.max(Math.min(ey_norm, ez_norm), 1e-9);
  const cond_b = eccRatio >= 5.0;

  // ── Rebar schedule & lap length ────────────────────────────────────────────
  let rebarSchedule = `4\u00d8${cornerBarDiam}c`;
  if (nBarsX > 0) rebarSchedule += ` + ${2 * nBarsX}\u00d8${barDiamX}x`;
  if (nBarsY > 0) rebarSchedule += ` + ${2 * nBarsY}\u00d8${barDiamY}y`;
  rebarSchedule += ` (\u00d8${stirrupDiam}/c${stirrupSpacing} mm)`;

  // Longitud de solape (CE Anejo 19 arts. 8.4.2 + 8.7.3):
  //   fctd = αct·fctk,0.05/γc = 0.7·fctm/1.5
  //   fbd = 2.25·η1·η2·fctd (η1 = 1.0: barras verticales de pilar, buena adherencia)
  //   l0 = α6·lb,rqd con α6 = 1.5 (100% de barras solapadas en la misma sección)
  //   l0,min = max(0.3·α6·lb,rqd, 15Ø, 200)
  const fctm = mat.fctm;
  const fctd = (0.7 * fctm) / 1.5;
  const fbd = 2.25 * fctd;
  const lb_rqd = (cornerBarDiam / 4) * (fyd / fbd);
  const alpha6 = 1.5;
  const l0 = alpha6 * lb_rqd;
  const l0_min = Math.max(0.3 * l0, 15 * cornerBarDiam, 200);
  const lapLength = Math.ceil(Math.max(l0, l0_min) / 5) * 5;

  // ── Checks ─────────────────────────────────────────────────────────────────
  type CheckStatus = 'ok' | 'warn' | 'fail';
  const checks: import('./types.ts').CheckRow[] = [];

  // lambda-y
  {
    const status: CheckStatus = lambda_y <= 100 ? 'ok' : 'warn';
    checks.push({
      id: 'lambda-y',
      // El corte es λlím (5.13N), no 25: con axil alto hay 2.º orden por debajo.
      description: `Esbeltez \u03bby = ${dec(lambda_y, 1)} — ${e2_y > 0 ? `2\u00ba orden, λ > λlím = ${dec(lambda_lim, 1)} (eje y)` : `sin 2\u00ba orden, λ ≤ λlím = ${dec(lambda_lim, 1)} (eje y)`}`,
      value: `\u03bby = ${dec(lambda_y, 1)}`,
      limit: '\u03bb \u2264 100',
      utilization: lambda_y / 100,
      status,
      article: 'CE Anejo 19 §5.8.8',
    });
  }

  // lambda-z
  {
    const status: CheckStatus = lambda_z <= 100 ? 'ok' : 'warn';
    checks.push({
      id: 'lambda-z',
      description: `Esbeltez \u03bbz = ${dec(lambda_z, 1)} — ${e2_z > 0 ? `2\u00ba orden, λ > λlím = ${dec(lambda_lim, 1)} (eje z)` : `sin 2\u00ba orden, λ ≤ λlím = ${dec(lambda_lim, 1)} (eje z)`}`,
      value: `\u03bbz = ${dec(lambda_z, 1)}`,
      limit: '\u03bb \u2264 100',
      utilization: lambda_z / 100,
      status,
      article: 'CE Anejo 19 §5.8.8',
    });
  }

  // nd-max
  checks.push(makeCheckQty(
    'nd-max',
    'NEd \u2264 NRd,max (aplastamiento por compresi\u00f3n pura)',
    NEd_N / 1e3,
    NRd_max / 1e3,
    'force',
    'CE Anejo 19 §6.1',
  ));

  // nm-y (informational)
  if (ndMaxFailed) {
    checks.push({
      id: 'nm-y',
      description: 'MEd,tot,y \u2264 MRdy \u2014 N/A (aplastamiento governa)',
      value: '\u2014', limit: '\u2014', utilization: NaN, status: 'fail',
      article: 'CE Anejo 19 §6.1 + §5.8',
    });
  } else {
    checks.push({
      ...makeCheckQty(
        'nm-y',
        'MEd,tot,y vs MRdy',
        MEd_tot_y, MRdy,
        'moment',
        'CE Anejo 19 §6.1 + §5.8',
      ),
      status: MRdy > 0 && MEd_tot_y <= MRdy ? 'ok' : 'fail',
    });
  }

  // nm-z (informational)
  if (ndMaxFailed) {
    checks.push({
      id: 'nm-z',
      description: 'MEd,tot,z \u2264 MRdz \u2014 N/A (aplastamiento governa)',
      value: '\u2014', limit: '\u2014', utilization: NaN, status: 'fail',
      article: 'CE Anejo 19 §6.1 + §5.8',
    });
  } else {
    checks.push({
      ...makeCheckQty(
        'nm-z',
        'MEd,tot,z vs MRdz',
        MEd_tot_z, MRdz,
        'moment',
        'CE Anejo 19 §6.1 + §5.8',
      ),
      status: MRdz > 0 && MEd_tot_z <= MRdz ? 'ok' : 'fail',
    });
  }

  // cond-5.38a (informational)
  checks.push({
    id: 'cond-5.38a',
    description: `Cond. 5.38a: \u03bby/\u03bbz \u2264 2 y \u03bbz/\u03bby \u2264 2 — ${cond_a ? 'cumple' : 'no cumple'}`,
    value: `${dec((lambda_y / lambda_z), 2)} / ${dec((lambda_z / lambda_y), 2)}`,
    limit: '\u2264 2,0',
    utilization: NaN,
    status: 'ok',  // informational only — never fails
    article: 'CE Anejo 19 §5.8.9',
  });

  // cond-5.38b (informational)
  checks.push({
    id: 'cond-5.38b',
    description: `Cond. 5.38b: ratio excentricidades = ${dec(eccRatio, 2)} — ${cond_b ? 'uniaxial dominante' : 'biaxial requerido'}`,
    value: eccRatio > 1000 ? '\u221e' : dec(eccRatio, 2),
    limit: '\u2265 5,0 \u00f3 \u2264 0,2',
    utilization: NaN,
    status: 'ok',  // informational only
    article: 'CE Anejo 19 §5.8.9',
  });

  // biaxial-check (governing)
  if (ndMaxFailed) {
    checks.push({
      id: 'biaxial-check',
      description: 'Flexi\u00f3n esviada (biaxial) \u2014 N/A (aplastamiento governa)',
      value: '\u2014', limit: '\u2264 1,0', utilization: Infinity, status: 'fail',
      article: 'CE Anejo 19 §5.8.9',
    });
  } else {
    checks.push({
      id: 'biaxial-check',
      description: `Flexi\u00f3n esviada: (MEdy/MRdy)\u1d43 + (MEdz/MRdz)\u1d43 \u2264 1,0  (a=${dec(a, 2)})`,
      value: dec(biaxialUtil, 3),
      limit: '\u2264 1,0',
      utilization: biaxialUtil,
      status: toStatus(biaxialUtil),
      article: 'CE Anejo 19 §5.8.9',
    });
  }

  // Cuantía geométrica mínima: el CE (§9.5.2) no fija ninguna, así que se
  // aplica la del Eurocódigo, EN 1992-1-1 §9.5.2(2), valor recomendado
  // 0,002·Ac. Criterio del usuario (2026-09-25): donde el CE no fija mínimo,
  // el del Eurocódigo, citado como tal.
  const As_min_geo = 0.002 * b * h;
  checks.push(makeDetailingCheck(
    'as-min',
    'Armadura mínima geométrica: As ≥ 0,002·Ac (Eurocódigo; el CE no la fija)',
    As_min_geo, As_total,
    `${As_total.toFixed(0)} mm²`,
    `≥ ${As_min_geo.toFixed(0)} mm²`,
    'EN 1992-1-1 §9.5.2(2)',
  ));

  // Cuantía mínima mecánica — CE Anejo 19 §9.5.2(2) (BOE, pág. 771 del PDF),
  // que sustituye la mecánica del Eurocódigo (0,10·N_Ed/f_yd). Pide, en el caso general, A's,min = 0,05·N_Ed/f_yc,d EN CADA
  // CARA (figura A19.9.11), con f_yc,d = f_yd ≤ 400 N/mm²; y en compresión
  // simple con armado simétrico —el rectangular lo es siempre— As,min =
  // 0,10·N_Ed/f_yd en total (9.12). Con flexión esviada se comprueban las
  // cuatro caras, así que manda la familia más floja; las esquinas cuentan en
  // las dos caras que forman.
  const NEd_comp = Math.max(0, NEd_N);
  const compresionSimple = MEdy === 0 && MEdz === 0;
  if (compresionSimple) {
    const As_min_912 = 0.10 * NEd_comp / fyd;
    checks.push(makeDetailingCheck(
      'as-min-mech',
      'Armadura m\u00ednima, compresi\u00f3n simple: As \u2265 0,10\u00b7N_Ed/f_yd',
      As_min_912, As_total,
      `${As_total.toFixed(0)} mm\u00b2`,
      `\u2265 ${As_min_912.toFixed(0)} mm\u00b2`,
      'CE Anejo 19 §9.5.2(2) (9.12)',
    ));
  } else {
    const fyc_d = Math.min(fyd, 400);                   // N/mm²
    const As_cara_min = 0.05 * NEd_comp / fyc_d;        // mm² por cara
    const As_cara_x = 2 * getBarArea(cornerBarDiam) + nBarsX * getBarArea(barDiamX);   // caras sup/inf
    const As_cara_y = 2 * getBarArea(cornerBarDiam) + nBarsY * getBarArea(barDiamY);   // caras izq/der
    const As_cara = Math.min(As_cara_x, As_cara_y);
    checks.push(makeDetailingCheck(
      'as-min-mech',
      'Armadura m\u00ednima por cara: A\u2032s \u2265 0,05\u00b7N_Ed/f_yc,d',
      As_cara_min, As_cara,
      `${As_cara.toFixed(0)} mm\u00b2 (cara m\u00e1s floja)`,
      `\u2265 ${As_cara_min.toFixed(0)} mm\u00b2`,
      'CE Anejo 19 §9.5.2(2)',
    ));
  }

  // Diámetro mínimo de las barras longitudinales — CE Anejo 19 §9.5.2(1): 12 mm.
  {
    const phiMin = Math.min(
      cornerBarDiam,
      nBarsX > 0 ? barDiamX : Infinity,
      nBarsY > 0 ? barDiamY : Infinity,
    );
    // Es un sí o no: Ø12 cumple (con makeCheck, 12/12 = 1,00 salía fallo).
    checks.push({
      id: 'long-bar-diam-min',
      description: 'Diámetro de las barras longitudinales ≥ 12 mm',
      value: `Ø${phiMin}`,
      limit: '≥ Ø12',
      utilization: 12 / phiMin,
      status: phiMin >= 12 ? 'ok' : 'fail',
      article: 'CE Anejo 19 §9.5.2(1)',
    });
  }

  // as-max
  const As_max = 0.04 * b * h;
  checks.push(makeDetailingCheck(
    'as-max',
    'Armadura m\u00e1xima: As \u2264 0,04\u00b7b\u00b7h',
    As_total, As_max,
    `${As_total.toFixed(0)} mm\u00b2`,
    `\u2264 ${As_max.toFixed(0)} mm\u00b2`,
    'CE Anejo 19 §9.5.2',
  ));

  // nBars-min: 4 corners + intermediates = at least 4
  const totalBars = 4 + 2 * nBarsX + 2 * nBarsY;
  {
    const status: CheckStatus = totalBars >= 4 ? 'ok' : 'fail';
    checks.push({
      id: 'nBars-min',
      description: 'M\u00ednimo 4 barras en secci\u00f3n rectangular',
      value: `${totalBars} barras`,
      limit: '\u2265 4 barras',
      utilization: 4 / Math.max(totalBars, 1),
      status,
      article: 'CE Anejo 19 §9.5.2',
    });
  }

  // bar-spacing-x: clear spacing on top/bottom faces
  {
    const nPerFaceX = 2 + nBarsX; // 2 corner bars + intermediates
    const innerX = b - 2 * (cover + stirrupDiam) - 2 * cornerBarDiam;
    let clearX: number;
    if (nBarsX === 0) {
      clearX = innerX; // only 2 corner bars, full inner width available
    } else {
      clearX = (innerX - nBarsX * barDiamX) / (nBarsX + 1);
    }
    const sMinX = Math.max(barDiamX, cornerBarDiam, 20);
    const effectiveClear = nPerFaceX <= 1 ? innerX : clearX;
    const status: CheckStatus = effectiveClear < 0 ? 'fail' : effectiveClear < sMinX ? 'fail' : 'ok';
    checks.push({
      id: 'bar-spacing-x',
      description: 'Separaci\u00f3n libre cara X (sup./inf.)',
      value: effectiveClear < 0 ? 'No caben' : `${effectiveClear.toFixed(0)} mm`,
      limit: `\u2265 ${sMinX} mm`,
      utilization: effectiveClear > 0 ? sMinX / effectiveClear : Infinity,
      status,
      article: 'CE Anejo 19 §9.5.3',
    });
  }

  // bar-spacing-y: clear spacing on left/right faces
  {
    const innerY = h - 2 * (cover + stirrupDiam) - 2 * cornerBarDiam;
    let clearY: number;
    if (nBarsY === 0) {
      clearY = innerY;
    } else {
      clearY = (innerY - nBarsY * barDiamY) / (nBarsY + 1);
    }
    const sMinY = Math.max(barDiamY, cornerBarDiam, 20);
    const status: CheckStatus = clearY < 0 ? 'fail' : clearY < sMinY ? 'fail' : 'ok';
    checks.push({
      id: 'bar-spacing-y',
      description: 'Separaci\u00f3n libre cara Y (laterales)',
      value: clearY < 0 ? 'No caben' : `${clearY.toFixed(0)} mm`,
      limit: `\u2265 ${sMinY} mm`,
      utilization: clearY > 0 ? sMinY / clearY : Infinity,
      status,
      article: 'CE Anejo 19 §9.5.3',
    });
  }

  // stirrup-diam: ≥ max(φ_max_long/4, 6mm) — CE Anejo 19 §9.5.3
  {
    const maxLongDiam = Math.max(cornerBarDiam, barDiamX, barDiamY);
    const stirrupDemand = Math.max(maxLongDiam / 4, 6);
    const status: CheckStatus = stirrupDiam >= stirrupDemand ? 'ok' : 'fail';
    checks.push({
      id: 'stirrup-diam',
      description: `Di\u00e1metro m\u00ednimo estribo \u2265 max(\u03c6max/4, 6 mm)`,
      value: `\u00d8${stirrupDiam} mm`,
      limit: `\u2265 \u00d8${stirrupDemand.toFixed(0)} mm`,
      utilization: stirrupDemand / stirrupDiam,
      status,
      article: 'CE Anejo 19 §9.5.3',
    });
  }

  // stirrup-spacing: ≤ min(15·φ_min, min(b,h), 300mm) — CE Anejo 19 §9.5.3(3)
  // El cerco arriostra la barra longitudinal MÁS FINA (la más propensa a
  // pandear): el límite usa el Ø mínimo presente, no el de esquina.
  // 15·φ y el techo de 300 mm son los valores del anejo español (el EC2 base
  // recomienda 20·φ/400 mm). Antes se usaba 12·φ "por conservadurismo", pero
  // suspendía como INCUMPLE armados que el CE acepta (p. ej. Ø8c/200 con
  // Ømin=16: límite real 240 mm, no 192).
  const longDiams = [cornerBarDiam, ...(nBarsX > 0 ? [barDiamX] : []), ...(nBarsY > 0 ? [barDiamY] : [])];
  const sMax = Math.min(15 * Math.min(...longDiams), Math.min(b, h), 300);
  {
    const status: CheckStatus = stirrupSpacing <= sMax ? 'ok' : 'fail';
    checks.push({
      id: 'stirrup-spacing',
      description: 'Separaci\u00f3n m\u00e1xima de estribos \u2264 min(15\u03c6c, min(b,h), 300 mm)',
      value: `${stirrupSpacing} mm`,
      limit: `\u2264 ${sMax} mm`,
      utilization: stirrupSpacing / sMax,
      status,
      article: 'CE Anejo 19 §9.5.3(3)',
    });

    // stirrup-densification: §9.5.3(4) — en una longitud igual a la mayor
    // dimensión de la sección por encima y por debajo de viga o forjado (y en
    // los solapes de barras de φ > 14 mm) la separación se reduce con el
    // factor 0.6. El módulo modela UN estribado corrido, así que si
    // s > 0.6·sMax se AVISA ('warn', nunca 'fail'): el despiece habitual
    // resuelve esas zonas densificando los extremos, no incumpliendo.
    {
      const sMaxDens = 0.6 * sMax;
      const densZone = Math.max(b, h);
      const densStatus: CheckStatus = stirrupSpacing <= sMaxDens ? 'ok' : 'warn';
      checks.push({
        id: 'stirrup-densification',
        description: `Densificación de estribos junto a vigas/forjados (${densZone.toFixed(0)} mm arriba/abajo) y en solapes: s ≤ 0,6·smax`,
        value: `${stirrupSpacing} mm`,
        limit: `≤ ${sMaxDens.toFixed(0)} mm`,
        utilization: stirrupSpacing / sMaxDens,
        status: densStatus,
        article: 'CE Anejo 19 §9.5.3(4)',
      });
    }
  }

  // ── Detalle para el lienzo: las mismas cifras, partidas ──────────────────
  const excentricidad = (
    M0: number, e0: number, canto: number, e1: number, ei: number, e2: number, etot: number,
    lambda: number, d: number,
  ): RCExcentricidad => {
    const betaPhi = 0.35 + inp.fck / 200 - lambda / 150;
    return {
      M0, e0, emin: Math.max(canto / 30, 20), e1, ei, e2, etot, lambda, i: canto / Math.sqrt(12), d,
      betaPhi, Kphi: Math.max(1, 1 + betaPhi * phiEf), invr0: fyd / (Es * 0.45 * d),
    };
  };
  const lambdaLimRaw = (20 * 0.7 * 1.1 * 0.7) / Math.sqrt(Math.max(n_ax, 1e-9));
  const detalle: RCColumnDetalle = {
    n: n_ax, lambdaLimRaw, lambdaLim: lambda_lim, phiEf,
    fcd, fyd, epsC2: pr.epsC2, epsCu: pr.epsCu, nExp: pr.nExp,
    y: excentricidad(Math.abs(MEdy), e0y, h, e1_y, e_imp_y, e2_y, e_tot_y, lambda_y, d_y),
    z: excentricidad(Math.abs(MEdz), e0z, b, e1_z, e_imp_z, e2_z, e_tot_z, lambda_z, d_z),
    agotY: ndMaxFailed ? null : desgloseNM(axisY.x_star, h, () => b, barsY, fcd, fyd, pr),
    agotZ: ndMaxFailed ? null : desgloseNM(axisZ.x_star, b, () => h, barsZ, fcd, fyd, pr),
    terminoY: ndMaxFailed || !(MRdy > 0) ? NaN : Math.pow(MEd_tot_y / MRdy, a),
    terminoZ: ndMaxFailed || !(MRdz > 0) ? NaN : Math.pow(MEd_tot_z / MRdz, a),
    reserva: Number.isFinite(biaxialUtil) && biaxialUtil > 0 ? Math.pow(biaxialUtil, -1 / a) : NaN,
    cercos: cercosDetalle(stirrupSpacing, sMax, Math.max(b, h), Math.max(...longDiams)),
  };

  return {
    valid: true,
    detalle,
    d_y, d_z, d_prime, As_total,
    lambda_y, lambda_z, Lk,
    e1_y, e_imp_y, e2_y, e_tot_y, MEd_tot_y,
    e1_z, e_imp_z, e2_z, e_tot_z, MEd_tot_z,
    NRd_max: NRd_max / 1e3,
    x_star_y: axisY.x_star,
    x_star_z: axisZ.x_star,
    MRdy, MRdz,
    ned, a, biaxialUtil,
    rebarSchedule, lapLength,
    sectionType: 'rectangular',
    checks,
  };
}

// ── Circular section (true fork) ────────────────────────────────────────────
// Soporte de pilar de sección circular. Motor SEPARADO del rectangular
// (decisión D1/T1): calcNM/computeAxis rectangulares quedan byte-idénticos.
//
// Hipótesis (Anejo 19 / EC2):
//   · Hormigón por INTEGRACIÓN POR FIBRAS del diagrama parábola-rectángulo
//     (§3.1.7(1)) con pivotes B/C (§6.1). Sustituye al bloque de Whitney de la
//     1ª implementación (auditoría 2026-07-01): el bloque con fcd pleno exigía
//     la reducción η·fcd −10% de §3.1.7(3) (ancho decreciente hacia la fibra
//     comprimida) y con solo pivote B sobreestimaba MRd hasta +32% a axil alto.
//   · Esbeltez única i = D/4 (simetría polar); flexión esviada → momento
//     resultante M = √(MEdy²+MEdz²) ≤ MRd (como el módulo de acero CHS).
//   · n barras iguales en un anillo de radio r_s, en θ_i = θ0 + 2π·i/n. La
//     rotación real del anillo respecto al plano de flexión es desconocida en
//     obra ⇒ MRd = mínimo sobre θ0 ∈ [0, π/n] (θ0=0 fijo llegaba a +8.5%
//     inseguro con n=5; sustituye a la decisión D2).
//   · Nº mínimo de barras = 4 (Anejo 19 §9.5.2(4); el "6" era práctica EHE-08).

/** Nº mínimo de barras longitudinales en pilar circular — Anejo 19 §9.5.2(4). */
export const NBARS_MIN_CIRC = 4;
/** Nº de orientaciones del anillo ensayadas en [0, π/n] para hallar la pésima. */
const N_RING_ROTATIONS = 9;

/** Anillo de n barras de área Abar en radio r_s, rotado θ0 (θ=0 = fibra más comprimida). */
function ringBarsCirc(D: number, r_s: number, n: number, Abar: number, theta0: number): BarGroup[] {
  const R = D / 2;
  const bars: BarGroup[] = [];
  for (let i = 0; i < n; i++) {
    bars.push({ y: R - r_s * Math.cos(theta0 + (2 * Math.PI * i) / n), area: Abar });
  }
  return bars;
}

/**
 * N-M de la sección circular para una profundidad de fibra neutra x.
 * Integración por fibras (tiras horizontales) del hormigón + barras discretas.
 * A las barras comprimidas se les descuenta el hormigón desplazado (σs − σc),
 * de modo que N(x→∞) → fcd·(Ac−As) + 400·As = NRd_max exacto (pivote C puro:
 * ε→εc2 ⇒ σs→Es·0.002 = 400). Momentos referidos al centro de la sección (D/2).
 */
function calcNMCirc(
  x: number, D: number, bars: BarGroup[], fcd: number, fyd: number, pr: PRDiagram,
): { NRd: number; MRd: number } {
  const R = D / 2;
  const dy = D / N_STRIPS_FIBER;
  let NRd = 0;
  let MRd = 0;
  for (let i = 0; i < N_STRIPS_FIBER; i++) {
    const y = (i + 0.5) * dy;
    const sc = sigmaConcretePR(strainPivots(y, x, D, pr), fcd, pr);
    if (sc <= 0) break;               // tiras ordenadas: bajo la fibra neutra σ = 0
    const w = 2 * Math.sqrt(Math.max(0, R * R - (y - R) * (y - R)));
    NRd += sc * w * dy;
    MRd += sc * w * dy * (R - y);
  }
  for (const bar of bars) {
    const eps = strainPivots(bar.y, x, D, pr);
    const sigS = Math.max(-fyd, Math.min(fyd, Es * eps));
    const sig = sigS - sigmaConcretePR(eps, fcd, pr);   // descuenta hormigón desplazado
    NRd += bar.area * sig;
    MRd += bar.area * sig * (R - bar.y);
  }
  return { NRd, MRd };
}

/** Búsqueda binaria de x* y MRd para UNA orientación del anillo.
 *  N(x) es monótona creciente con asíntota NRd_max (pivote C), así que para
 *  NEd < NRd_max siempre hay solución: se expande el techo exponencialmente
 *  antes de bisecar (no hay zona gap — el diagrama de pivotes cubre todo). */
function computeAxisCirc(
  NEd_N: number, D: number, bars: BarGroup[], fcd: number, fyd: number,
  pr: PRDiagram, NRd_max: number,
): { MRd_Nmm: number; x_star: number; ndMaxFailed: boolean } {
  if (NEd_N >= NRd_max) {
    return { MRd_Nmm: 0, x_star: D, ndMaxFailed: true };
  }
  let xLo = 1e-3;
  let xHi = 2 * D;
  for (let g = 0; g < 24 && calcNMCirc(xHi, D, bars, fcd, fyd, pr).NRd < NEd_N; g++) {
    xHi *= 2;
  }
  for (let i = 0; i < 80; i++) {
    const xMid = (xLo + xHi) / 2;
    if (calcNMCirc(xMid, D, bars, fcd, fyd, pr).NRd < NEd_N) xLo = xMid;
    else xHi = xMid;
  }
  const x_star = (xLo + xHi) / 2;
  const { MRd } = calcNMCirc(x_star, D, bars, fcd, fyd, pr);
  return { MRd_Nmm: MRd, x_star, ndMaxFailed: false };
}

/** MRd en la dirección resultante = mínimo sobre la rotación θ0 del anillo
 *  (periodo π/n por simetría). Devuelve también la orientación gobernante θ0*
 *  para que la envolvente N-M se dibuje con el mismo anillo. */
function computeAxisCircWorst(
  NEd_N: number, sm: CircSectionModel,
): { MRd_Nmm: number; x_star: number; theta_star: number; ndMaxFailed: boolean } {
  const { D, r_s, nBars, Abar, fcd, fyd, pr, NRd_max } = sm;
  if (NEd_N >= NRd_max) {
    return { MRd_Nmm: 0, x_star: D, theta_star: 0, ndMaxFailed: true };
  }
  let best: { MRd_Nmm: number; x_star: number; theta_star: number; ndMaxFailed: boolean } | null = null;
  for (let k = 0; k < N_RING_ROTATIONS; k++) {
    const theta0 = (k / (N_RING_ROTATIONS - 1)) * (Math.PI / nBars);
    const bars = ringBarsCirc(D, r_s, nBars, Abar, theta0);
    const r = computeAxisCirc(NEd_N, D, bars, fcd, fyd, pr, NRd_max);
    if (best === null || r.MRd_Nmm < best.MRd_Nmm) {
      best = { ...r, theta_star: theta0 };
    }
  }
  return best!;
}

interface CircSectionModel {
  mat: ReturnType<typeof getConcrete>;
  fcd: number;
  fyd: number;
  pr: PRDiagram;        // parábola-rectángulo del hormigón (εc2, εcu, n)
  As_total: number;
  Abar: number;         // área de una barra del anillo (mm²)
  D: number;
  r_s: number;          // radio del anillo de barras (mm)
  d_circ: number;       // canto eficaz curvatura = D/2 + i_s
  nBars: number;
  circBarDiam: number;
  Ac: number;
  NRd_max: number;
}

function buildSectionModelCirc(inp: RCColumnInputs): CircSectionModel | { error: string } {
  const D = inp.D ?? 350;
  const n = inp.nBarsCirc ?? NBARS_MIN_CIRC;
  const circBarDiam = inp.circBarDiam ?? 16;
  const { cover, stirrupDiam, fck, fyk } = inp;

  if (circBarDiam < 6) return { error: 'Diámetro de barra debe ser ≥ 6 mm' };
  if (n < NBARS_MIN_CIRC) return { error: `Mínimo ${NBARS_MIN_CIRC} barras en sección circular (Anejo 19 §9.5.2)` };

  const mat = getConcrete(fck);
  const fcd = mat.fcd;
  const fyd = getFyd(fyk);
  const pr: PRDiagram = { epsC2: mat.eps_c2, epsCu: mat.eps_cu, nExp: mat.n };

  const R = D / 2;
  const r_s = (D - 2 * cover - 2 * stirrupDiam - circBarDiam) / 2;
  if (r_s <= 0) return { error: 'Diámetro insuficiente para el recubrimiento y las barras' };

  const Abar = getBarArea(circBarDiam);
  const As_total = n * Abar;

  const i_s = r_s / Math.SQRT2;        // I_s = As·r_s²/2 ⇒ i_s = r_s/√2 (EC2 §5.8.8.3)
  const d_circ = R + i_s;
  const Ac = Math.PI * R * R;

  // εc2 = 0.002 limita σ_acero a 400 N/mm² en compresión centrada (= rectangular).
  // calcNMCirc (fibras, hormigón desplazado descontado) tiende a este mismo
  // valor cuando x→∞, así que la bisección cubre todo NEd < NRd_max sin zona gap.
  const fyc_d_max = Math.min(fyd, 400);
  const NRd_max = fcd * (Ac - As_total) + fyc_d_max * As_total;

  return { mat, fcd, fyd, pr, As_total, Abar, D, r_s, d_circ, nBars: n, circBarDiam, Ac, NRd_max };
}

function calcRCColumnCirc(inp: RCColumnInputs): RCColumnResult {
  const { cover, stirrupDiam, stirrupSpacing, Nd, MEdy, MEdz, L, beta } = inp;
  const Lk = L * beta;
  const Lk_mm = Lk * 1000;

  const invalid = (error: string): RCColumnResult => ({
    valid: false, error,
    d_y: 0, d_z: 0, d_prime: 0, As_total: 0,
    lambda_y: 0, lambda_z: 0, Lk: 0,
    e1_y: 0, e_imp_y: 0, e2_y: 0, e_tot_y: 0, MEd_tot_y: 0,
    e1_z: 0, e_imp_z: 0, e2_z: 0, e_tot_z: 0, MEd_tot_z: 0,
    NRd_max: 0, x_star_y: 0, x_star_z: 0, MRdy: 0, MRdz: 0,
    ned: 0, a: 0, biaxialUtil: 0,
    rebarSchedule: '', lapLength: 0,
    sectionType: 'circular',
    checks: [],
  });

  if (Nd < 1) return invalid('NEd debe ser ≥ 1 kN (módulo para flexocompresión)');

  const sm = buildSectionModelCirc(inp);
  if ('error' in sm) return invalid(sm.error);
  const {
    mat, fcd, fyd, As_total, D, r_s, d_circ, nBars, circBarDiam, Ac, NRd_max,
  } = sm;

  const NEd_N = Nd * 1e3;

  // ── Esbeltez única (simetría polar): i = D/4 ───────────────────────────────
  const lambda = Lk_mm / (D / 4);

  // ── 2º orden en la dirección RESULTANTE (decisión T2) ──────────────────────
  // Se aplica UNA sola vez la excentricidad mínima, la imperfección y e2 sobre
  // el momento de 1er orden resultante M1 = √(MEdy²+MEdz²). NO se combinan dos
  // e_tot por eje con hypot (eso metía un √2 fantasma con momento en un eje).
  const phiEf = inp.phiEf ?? 2.0;
  const Kphi = Math.max(1, 1 + (0.35 + inp.fck / 200 - lambda / 150) * phiEf);
  const n_ax = NEd_N / (Ac * fcd);
  const lambda_lim = Math.min((20 * 0.7 * 1.1 * 0.7) / Math.sqrt(Math.max(n_ax, 1e-9)), 25);

  const M1 = Math.hypot(MEdy, MEdz);                       // 1er orden resultante (kNm)
  const e0 = (M1 * 1e6) / NEd_N;                            // mm
  const e1 = Math.max(e0, Math.max(D / 30, 20));           // excentricidad mínima (única)
  const e_imp = Lk_mm / 400;                                // imperfección (única)
  const curv = (Kphi * fyd) / (Es * 0.45 * d_circ);
  const e2 = lambda > lambda_lim ? (curv * Lk_mm * Lk_mm) / 10 : 0;
  const e_tot = e1 + e_imp + e2;
  const M_res = (NEd_N * e_tot) / 1e6;                      // kNm

  // ── Capacidad N-M (dirección resultante, orientación pésima del anillo) ────
  const axis = computeAxisCircWorst(NEd_N, sm);
  const ndMaxFailed = axis.ndMaxFailed;
  const MRd = axis.MRd_Nmm / 1e6;                           // kNm
  const resUtil = ndMaxFailed ? Infinity : (MRd > 0 ? M_res / MRd : Infinity);
  const d_prime = cover + stirrupDiam + circBarDiam / 2;

  // ── Despiece + solape (geometría-agnóstico, usa circBarDiam) ───────────────
  const rebarSchedule = `${nBars}Ø${circBarDiam} (Ø${stirrupDiam}/c${stirrupSpacing} mm)`;
  const fctm = mat.fctm;
  const fctd = (0.7 * fctm) / 1.5;
  const fbd = 2.25 * fctd;
  const lb_rqd = (circBarDiam / 4) * (fyd / fbd);
  const l0 = 1.5 * lb_rqd;
  const l0_min = Math.max(0.3 * l0, 15 * circBarDiam, 200);
  const lapLength = Math.ceil(Math.max(l0, l0_min) / 5) * 5;

  // ── Checks ─────────────────────────────────────────────────────────────────
  type CheckStatus = 'ok' | 'warn' | 'fail';
  const checks: CheckRow[] = [];

  // lambda (única)
  checks.push({
    id: 'lambda',
    description: `Esbeltez λ = ${dec(lambda, 1)} — ${e2 > 0 ? `2º orden, λ > λlím = ${dec(lambda_lim, 1)}` : `sin 2º orden, λ ≤ λlím = ${dec(lambda_lim, 1)}`}`,
    value: `λ = ${dec(lambda, 1)}`,
    limit: 'λ ≤ 100',
    utilization: lambda / 100,
    status: (lambda <= 100 ? 'ok' : 'warn') as CheckStatus,
    article: 'CE Anejo 19 §5.8.8',
  });

  // nd-max
  checks.push(makeCheckQty(
    'nd-max',
    'NEd ≤ NRd,max (aplastamiento por compresión pura)',
    NEd_N / 1e3, NRd_max / 1e3, 'force', 'CE Anejo 19 §6.1',
  ));

  // flexion-check (gobernante)
  if (ndMaxFailed) {
    checks.push({
      id: 'flexion-check',
      description: 'Flexocompresión (M_res ≤ MRd) — N/A (aplastamiento gobierna)',
      value: '—', limit: '≤ 1,0', utilization: Infinity, status: 'fail',
      article: 'CE Anejo 19 §6.1 + §5.8',
    });
  } else {
    checks.push({
      id: 'flexion-check',
      description: 'Flexocompresión: M_res = √(MEdy²+MEdz²) ≤ MRd',
      valueNum: M_res, valueQty: 'moment',
      limitNum: MRd, limitQty: 'moment',
      utilization: resUtil,
      status: toStatus(resUtil),
      article: 'CE Anejo 19 §6.1 + §5.8',
    });
  }

  // nm-res (informativo)
  checks.push({
    id: 'nm-res',
    description: `Momento resultante M_res / MRd  (λ=${lambda.toFixed(0)}, e_tot=${e_tot.toFixed(0)} mm)`,
    valueNum: M_res, valueQty: 'moment',
    limitNum: MRd, limitQty: 'moment',
    utilization: ndMaxFailed ? Infinity : resUtil,
    status: 'ok',
    article: 'CE Anejo 19 §5.8.8',
  });

  // Cuantía geométrica mínima del Eurocódigo, que el CE no fija (ver la
  // sección rectangular): EN 1992-1-1 §9.5.2(2), 0,002·Ac.
  const As_min_geo = 0.002 * Ac;
  checks.push(makeDetailingCheck(
    'as-min',
    'Armadura mínima geométrica: As ≥ 0,002·Ac (Eurocódigo; el CE no la fija)',
    As_min_geo, As_total,
    `${As_total.toFixed(0)} mm²`, `≥ ${As_min_geo.toFixed(0)} mm²`,
    'EN 1992-1-1 §9.5.2(2)',
  ));

  // Cuantía mínima mecánica — CE Anejo 19 §9.5.2(2) (ver la sección rectangular). En compresión simple, (9.12): As,min =
  // 0,10·N_Ed/f_yd. Con flexión, el CE da 0,05·N_Ed/f_yc,d por cara y un anillo
  // no tiene caras: se exige el total equivalente a las dos opuestas,
  // 0,10·N_Ed/f_yc,d (f_yc,d = f_yd ≤ 400 N/mm²).
  const NEd_comp = Math.max(0, NEd_N);
  const compresionSimple = MEdy === 0 && MEdz === 0;
  const fyc_d = Math.min(fyd, 400);
  const As_min_mech = compresionSimple ? (0.10 * NEd_comp) / fyd : (0.10 * NEd_comp) / fyc_d;
  checks.push(makeDetailingCheck(
    'as-min-mech',
    compresionSimple
      ? 'Armadura mínima, compresión simple: As ≥ 0,10·N_Ed/f_yd'
      : 'Armadura mínima: As ≥ 2 · 0,05·N_Ed/f_yc,d (dos caras opuestas)',
    As_min_mech, As_total,
    `${As_total.toFixed(0)} mm²`, `≥ ${As_min_mech.toFixed(0)} mm²`,
    compresionSimple ? 'CE Anejo 19 §9.5.2(2) (9.12)' : 'CE Anejo 19 §9.5.2(2)',
  ));

  // Diámetro mínimo de las barras longitudinales — CE Anejo 19 §9.5.2(1): 12 mm.
  // Es un sí o no: Ø12 cumple (con makeCheck, 12/12 = 1,00 salía fallo).
  checks.push({
    id: 'long-bar-diam-min',
    description: 'Diámetro de las barras longitudinales ≥ 12 mm',
    value: `Ø${circBarDiam}`,
    limit: '≥ Ø12',
    utilization: 12 / circBarDiam,
    status: circBarDiam >= 12 ? 'ok' : 'fail',
    article: 'CE Anejo 19 §9.5.2(1)',
  });

  // as-max
  const As_max = 0.04 * Ac;
  checks.push(makeDetailingCheck(
    'as-max',
    'Armadura máxima: As ≤ 0,04·Ac',
    As_total, As_max,
    `${As_total.toFixed(0)} mm²`, `≤ ${As_max.toFixed(0)} mm²`,
    'CE Anejo 19 §9.5.2',
  ));

  // nBars-min (Anejo 19 §9.5.2(4): mínimo 4 en sección circular)
  {
    const status: CheckStatus = nBars >= NBARS_MIN_CIRC ? 'ok' : 'fail';
    checks.push({
      id: 'nBars-min',
      description: `Mínimo ${NBARS_MIN_CIRC} barras en sección circular`,
      value: `${nBars} barras`,
      limit: `≥ ${NBARS_MIN_CIRC} barras`,
      utilization: NBARS_MIN_CIRC / Math.max(nBars, 1),
      status,
      article: 'CE Anejo 19 §9.5.2',
    });
  }

  // bar-spacing-circ: separación libre por CUERDA entre barras adyacentes del anillo
  {
    const clear = 2 * r_s * Math.sin(Math.PI / nBars) - circBarDiam;
    const sMin = Math.max(circBarDiam, 20);
    const status: CheckStatus = clear < 0 ? 'fail' : clear < sMin ? 'fail' : 'ok';
    checks.push({
      id: 'bar-spacing-circ',
      description: 'Separación libre entre barras del anillo (cuerda)',
      value: clear < 0 ? 'No caben' : `${clear.toFixed(0)} mm`,
      limit: `≥ ${sMin} mm`,
      utilization: clear > 0 ? sMin / clear : Infinity,
      status,
      article: 'CE Anejo 19 §9.5.3',
    });
  }

  // stirrup-diam: ≥ max(φ_long/4, 6 mm)
  {
    const stirrupDemand = Math.max(circBarDiam / 4, 6);
    const status: CheckStatus = stirrupDiam >= stirrupDemand ? 'ok' : 'fail';
    checks.push({
      id: 'stirrup-diam',
      description: 'Diámetro mínimo cerco ≥ max(φ/4, 6 mm)',
      value: `Ø${stirrupDiam} mm`,
      limit: `≥ Ø${stirrupDemand.toFixed(0)} mm`,
      utilization: stirrupDemand / stirrupDiam,
      status,
      article: 'CE Anejo 19 §9.5.3',
    });
  }

  // stirrup-spacing: ≤ min(15·φ, D, 300 mm) — CE Anejo 19 §9.5.3(3)
  // El término least-dimension es D para sección circular. 15·φ y 300 mm son
  // los valores del anejo español (antes se usaba 12·φ "por conservadurismo",
  // pero suspendía como INCUMPLE armados que el CE acepta).
  const sMax = Math.min(15 * circBarDiam, D, 300);
  {
    const status: CheckStatus = stirrupSpacing <= sMax ? 'ok' : 'fail';
    checks.push({
      id: 'stirrup-spacing',
      description: 'Separación máxima de cercos ≤ min(15φ, D, 300 mm)',
      value: `${stirrupSpacing} mm`,
      limit: `≤ ${sMax} mm`,
      utilization: stirrupSpacing / sMax,
      status,
      article: 'CE Anejo 19 §9.5.3(3)',
    });

    // stirrup-densification: §9.5.3(4) — mismo aviso que en rectangular; la
    // longitud de la zona densificada junto a vigas/forjados es D.
    {
      const sMaxDens = 0.6 * sMax;
      const densStatus: CheckStatus = stirrupSpacing <= sMaxDens ? 'ok' : 'warn';
      checks.push({
        id: 'stirrup-densification',
        description: `Densificación de cercos junto a vigas/forjados (${D.toFixed(0)} mm arriba/abajo) y en solapes: s ≤ 0,6·smax`,
        value: `${stirrupSpacing} mm`,
        limit: `≤ ${sMaxDens.toFixed(0)} mm`,
        utilization: stirrupSpacing / sMaxDens,
        status: densStatus,
        article: 'CE Anejo 19 §9.5.3(4)',
      });
    }
  }

  // ── Detalle para el lienzo (dirección resultante, anillo en θ*) ──────────
  const betaPhi = 0.35 + inp.fck / 200 - lambda / 150;
  const exc: RCExcentricidad = {
    M0: M1, e0, emin: Math.max(D / 30, 20), e1, ei: e_imp, e2, etot: e_tot, lambda, i: D / 4, d: d_circ,
    betaPhi, Kphi, invr0: fyd / (Es * 0.45 * d_circ),
  };
  const R0 = D / 2;
  const detalle: RCColumnDetalle = {
    n: n_ax, lambdaLimRaw: (20 * 0.7 * 1.1 * 0.7) / Math.sqrt(Math.max(n_ax, 1e-9)), lambdaLim: lambda_lim, phiEf,
    fcd, fyd, epsC2: sm.pr.epsC2, epsCu: sm.pr.epsCu, nExp: sm.pr.nExp,
    y: exc, z: exc,
    agotY: ndMaxFailed ? null : desgloseNM(
      axis.x_star, D, (y) => 2 * Math.sqrt(Math.max(0, R0 * R0 - (y - R0) * (y - R0))),
      ringBarsCirc(D, r_s, nBars, sm.Abar, axis.theta_star), fcd, fyd, sm.pr,
    ),
    agotZ: null,
    terminoY: 0, terminoZ: 0,
    reserva: Number.isFinite(resUtil) && resUtil > 0 ? 1 / resUtil : NaN,
    cercos: cercosDetalle(stirrupSpacing, sMax, D, circBarDiam),
  };

  return {
    valid: true,
    detalle,
    d_y: d_circ, d_z: d_circ, d_prime, As_total,
    lambda_y: lambda, lambda_z: lambda, Lk,
    e1_y: e1, e_imp_y: e_imp, e2_y: e2, e_tot_y: e_tot, MEd_tot_y: M_res,
    e1_z: e1, e_imp_z: e_imp, e2_z: e2, e_tot_z: e_tot, MEd_tot_z: M_res,
    NRd_max: NRd_max / 1e3,
    x_star_y: axis.x_star, x_star_z: axis.x_star,
    MRdy: MRd, MRdz: MRd,
    ned: NEd_N / NRd_max, a: 1, biaxialUtil: resUtil,
    rebarSchedule, lapLength,
    sectionType: 'circular',
    D, lambda, d_circ, M_res, e_tot_res: e_tot, MRd, x_star: axis.x_star,
    theta_star: axis.theta_star, resUtil,
    checks,
  };
}

// === N-M interaction diagram (capacity envelope) ============================
// Sweeps the calcNM primitive over neutral-axis depth x to trace the column's
// N-M capacity envelope. Consumed by RCColumnInteractionSVG.

export interface InteractionPoint {
  N: number;  // axial force (kN, compression positive)
  M: number;  // bending moment (kN.m)
}

export interface AxisInteraction {
  axis: 'y' | 'z';
  reinforced: InteractionPoint[];  // envelope with the actual rebar
  plain: InteractionPoint[];       // envelope of the plain concrete section
  applied: InteractionPoint;       // (NEd, MEd_tot) for this axis
  inside: boolean;                 // applied point within the reinforced envelope
  utilization: number;             // applied.M / capacity-M at applied.N
  governing: boolean;              // the higher-utilization axis
}

export interface ColumnInteractionResult {
  valid: boolean;
  y: AxisInteraction | null;
  z: AxisInteraction | null;
}

// Traces one N-M capacity envelope by sweeping the neutral-axis depth x.
//
// Con el modelo de fibras N(x) es estrictamente creciente con asíntota
// NRd_max (pivote C), así que la curva nunca sobrepasa el punto de cierre;
// las muestras del arranque (x minúsculo, acero clamped, hormigón sin tiras
// comprimidas — la integración por tiras cuantiza el inicio) repiten N y se
// SALTAN (continue), no cortan la curva (break).
//
// Sampling is non-uniform (x ~ t^2) so the high-curvature tension nose near
// x->0 is well resolved. Only the M >= 0 quadrant is drawn.
function sweepEnvelope(
  depth: number, width: number, bars: BarGroup[],
  fcd: number, fyd: number, pr: PRDiagram, compressionN: number,
): InteractionPoint[] {
  const pts: InteractionPoint[] = [];
  const AsTot = bars.reduce((sum, bar) => sum + bar.area, 0);

  // Pure-tension endpoint: all steel yielded in tension, concrete cracked out.
  if (AsTot > 0) pts.push({ N: -AsTot * fyd / 1e3, M: 0 });

  const N_SAMPLES = 80;
  const xMax = 1.6 * depth;
  const compN = compressionN / 1e3;
  let prevN = AsTot > 0 ? -AsTot * fyd / 1e3 : -Infinity;
  let started = false;
  for (let i = 1; i <= N_SAMPLES; i++) {
    const t = i / N_SAMPLES;
    const x = t * t * xMax + depth / 4000;   // non-uniform: dense near x->0
    const { NRd, MRd } = calcNM(x, width, depth, bars, fcd, fyd, pr);
    const N = NRd / 1e3;
    const M = MRd / 1e6;
    if (started && N > compN) break;         // salvaguarda: no sobrepasar el cierre
    if (N <= prevN + 1e-6) continue;         // dedupe muestras planas
    if (M < 0) {
      if (started) break;
      continue;
    }
    pts.push({ N, M });
    prevN = N;
    started = true;
  }

  // Pure-compression endpoint, M=0 — closes the curve on the N axis.
  // Reinforced: NRd_max (net area + steel). Plain: fcd·area (gross concrete).
  pts.push({ N: compressionN / 1e3, M: 0 });
  return pts;
}

// Versión circular del barrido (depth = D, fibras parábola-rectángulo).
// N(x) tiende asintóticamente a NRd_max (pivote C), así que la curva nunca
// sobrepasa el punto de cierre (NRd_max, 0); el recorte en compN queda como
// salvaguarda de monotonía.
function sweepEnvelopeCirc(
  D: number, bars: BarGroup[], fcd: number, fyd: number, pr: PRDiagram, compressionN: number,
): InteractionPoint[] {
  const pts: InteractionPoint[] = [];
  const AsTot = bars.reduce((sum, bar) => sum + bar.area, 0);
  if (AsTot > 0) pts.push({ N: -AsTot * fyd / 1e3, M: 0 });

  const N_SAMPLES = 80;
  const xMax = 1.6 * D;
  const compN = compressionN / 1e3;
  // Seed en el punto de tracción pura: las primeras muestras del barrido (x
  // minúsculo, acero clamped, hormigón aún sin tiras comprimidas) repiten ese
  // N — la integración por tiras cuantiza el arranque del hormigón, así que
  // las muestras planas se SALTAN (continue), no cortan la curva (break).
  let prevN = AsTot > 0 ? -AsTot * fyd / 1e3 : -Infinity;
  let started = false;
  for (let i = 1; i <= N_SAMPLES; i++) {
    const t = i / N_SAMPLES;
    const x = t * t * xMax + D / 4000;
    const { NRd, MRd } = calcNMCirc(x, D, bars, fcd, fyd, pr);
    const N = NRd / 1e3;
    const M = MRd / 1e6;
    if (started && N > compN) break;
    if (N <= prevN + 1e-6) continue;         // dedupe muestras planas
    if (M < 0) { if (started) break; continue; }
    pts.push({ N, M });
    prevN = N;
    started = true;
  }
  pts.push({ N: compressionN / 1e3, M: 0 });
  return pts;
}

// M capacity of an envelope at axial N (linear interpolation). null if N out of range.
function envelopeCapacityM(curve: InteractionPoint[], N: number): number | null {
  if (curve.length < 2) return null;
  if (N < curve[0].N || N > curve[curve.length - 1].N) return null;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const c = curve[i + 1];
    if (N >= a.N && N <= c.N) {
      if (c.N - a.N < 1e-9) return Math.max(a.M, c.M);
      const f = (N - a.N) / (c.N - a.N);
      return a.M + f * (c.M - a.M);
    }
  }
  return null;
}

// Builds both N-M interaction diagrams (y and z axes) for a column.
// `inside` is derived from the drawn curve itself (interpolating the reinforced
// envelope at N = NEd), never from the engine N-M check, so the marker can
// never contradict the curve.
export function buildColumnInteraction(
  inp: RCColumnInputs, result: RCColumnResult,
): ColumnInteractionResult {
  if (!result.valid) return { valid: false, y: null, z: null };

  // ── Circular: una sola envolvente (simetría polar) → se devuelve como `y`,
  // con z: null. Los consumidores renderizan POSITIVAMENTE este caso de un
  // diagrama (no se apoyan en el guard y && z, que lo suprimiría).
  if ((inp.sectionType ?? 'rectangular') === 'circular') {
    const smc = buildSectionModelCirc(inp);
    if ('error' in smc) return { valid: false, y: null, z: null };
    const { fcd, fyd, pr, D, r_s, nBars, Abar, NRd_max, Ac } = smc;
    // La envolvente se dibuja con el anillo en la orientación gobernante θ0*
    // a N = NEd (la misma que usa el motor para MRd): la curva y el check
    // flexion-check coinciden exactamente en el punto aplicado.
    const worst = computeAxisCircWorst(inp.Nd * 1e3, smc);
    const barsAtWorst = ringBarsCirc(D, r_s, nBars, Abar, worst.theta_star);
    const reinforced = sweepEnvelopeCirc(D, barsAtWorst, fcd, fyd, pr, NRd_max);
    const plain = sweepEnvelopeCirc(D, [], fcd, fyd, pr, fcd * Ac);
    const applied: InteractionPoint = { N: inp.Nd, M: result.M_res ?? result.MEd_tot_y };
    const Mcap = envelopeCapacityM(reinforced, applied.N);
    const inside = Mcap !== null && applied.M <= Mcap + 1e-9;
    const utilization = Mcap !== null && Mcap > 1e-9 ? applied.M / Mcap : Infinity;
    const y: AxisInteraction = { axis: 'y', reinforced, plain, applied, inside, utilization, governing: true };
    return { valid: true, y, z: null };
  }

  const sm = buildSectionModel(inp);
  if ('error' in sm) return { valid: false, y: null, z: null };
  const { fcd, fyd, pr, barsY, barsZ, NRd_max } = sm;

  const buildAxis = (
    axis: 'y' | 'z', depth: number, width: number,
    bars: BarGroup[], MEd_tot: number,
  ): AxisInteraction => {
    const reinforced = sweepEnvelope(depth, width, bars, fcd, fyd, pr, NRd_max);
    // Plain concrete: pure-compression capacity is fcd·(gross area) = fcd·depth·width.
    const plain = sweepEnvelope(depth, width, [], fcd, fyd, pr, fcd * depth * width);
    const applied: InteractionPoint = { N: inp.Nd, M: MEd_tot };
    const Mcap = envelopeCapacityM(reinforced, applied.N);
    const inside = Mcap !== null && applied.M <= Mcap + 1e-9;
    const utilization = Mcap !== null && Mcap > 1e-9 ? applied.M / Mcap : Infinity;
    return { axis, reinforced, plain, applied, inside, utilization, governing: false };
  };

  const y = buildAxis('y', inp.h, inp.b, barsY, result.MEd_tot_y);
  const z = buildAxis('z', inp.b, inp.h, barsZ, result.MEd_tot_z);
  if (y.utilization >= z.utilization) y.governing = true;
  else z.governing = true;

  return { valid: true, y, z };
}
