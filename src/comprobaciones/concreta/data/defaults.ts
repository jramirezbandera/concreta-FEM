// FTUX defaults — all produce CUMPLE at ~65-80% utilization on first open.
// Override order: URL query params > localStorage > these defaults.

import type {
  ApplicationType,
  ConnectionType,
  CorrosionEnv,
  DesignLifeYears,
  Duration,
  EffortType,
  ExecutionType,
  SoilType,
} from './micropileLookups.ts';

export interface RCBeamInputs {
  /** UI mode: 'simple' renderiza una sola sección + 3 SVGs (deformación /
   *  sección / fuerzas) resuelta al momento Md — modo por defecto.
   *  'portico' renderiza VANO + APOYO lado a lado (pórtico clásico).
   *  El motor calcRCBeam solo lo lee para la flecha directa (deflMethod
   *  'direct'): en 'simple' la pieza es UNA sección y los momentos de apoyo
   *  (ocultos al usuario) NUNCA entran en la flecha; el resto del motor es
   *  agnóstico al campo.
   *  Required en la interface; el consumer (RCBeamsInputs / rc-beams index)
   *  defensiva con `state.mode === 'portico' ? 'portico' : 'simple'` cubre
   *  los casos de localStorage state antiguo donde el campo puede llegar
   *  como undefined a runtime aunque TS lo tipa como required. */
  mode: 'simple' | 'portico';
  /** Nombre del elemento ("Viga 1", "Dintel de ventana"). Metadato de DOCUMENTO,
   *  no input de cálculo: se captura en el TitlePromptModal al exportar, se usa
   *  como H1 de la cabecera del PDF y como nombre de archivo. Vive aquí para que
   *  useModuleState lo persista (localStorage) y lo lleve en el enlace compartido
   *  gratis; el motor calcRCBeam lo ignora. RESERVADO: al propagar a módulos que
   *  muestran hash, debe excluirse de inputsFingerprint() (no es input del cálculo). */
  title: string;
  // Shared geometry + materials
  b: number;              // width (mm)
  h: number;              // total depth (mm)
  cover: number;          // mechanical cover (mm)
  fck: number;            // characteristic concrete strength (MPa)
  fyk: number;            // characteristic steel strength (MPa)
  exposureClass: string;  // XC1–XC4
  loadType: string;       // 'residential'|'office'|'parking'|'roof'|'custom'
  psi2Custom: number;     // psi2 value when loadType='custom'
  /** Luz del vano (mm) para la comprobación de flecha (esbeltez L/d o cálculo
   *  directo según deflMethod). 0 = no comprobar. */
  L: number;
  /** Sistema estructural. En 'ld' fija la K de la Tabla 7.4N (biapoyada 1.0,
   *  vano extremo 1.3, interior 1.5, ménsula 0.4); en 'direct' fija el
   *  coeficiente de la flecha elástica y la corrección por momentos de apoyo. */
  structSystem: 'ss' | 'end' | 'interior' | 'cantilever';
  /** Método de comprobación de flecha (con L > 0): 'ld' = esbeltez L/d sin
   *  cálculo directo (CE Anejo 19 §7.4.2, exime del cálculo si cumple),
   *  'direct' = flecha diferida cuasipermanente con sección fisurada y
   *  fluencia (§7.4.3) contra L/300 (apariencia, CTE DB-SE 4.3.3).
   *  Opcional: estados guardados antiguos no lo traen → 'ld'. */
  deflMethod?: 'ld' | 'direct';
  /** Coeficiente de fluencia efectivo φef de la flecha diferida (solo método
   *  'direct'): Ec,ef = Ec/(1+φef). Típico edificación ≈ 2.0. Opcional:
   *  estados guardados antiguos no lo traen → 2.0. */
  phiEf?: number;
  // Vano (midspan) — positive bending M+
  vano_Md: number;               // design moment (kNm)
  vano_VEd: number;              // design shear (kN)
  vano_M_G: number;              // SLS moment from permanent loads (kNm)
  vano_M_Q: number;              // SLS moment from variable loads (kNm)
  vano_bot_nBars: number;        // tension bars (bottom, M+)
  vano_bot_barDiam: number;
  vano_top_nBars: number;        // compression bars (top, M+)
  vano_top_barDiam: number;
  vano_stirrupDiam: number;
  vano_stirrupSpacing: number;
  vano_stirrupLegs: number;
  // Apoyo (support) — negative bending M-
  apoyo_Md: number;
  apoyo_VEd: number;
  apoyo_M_G: number;
  apoyo_M_Q: number;
  apoyo_top_nBars: number;       // tension bars (top, M-)
  apoyo_top_barDiam: number;
  apoyo_bot_nBars: number;       // compression bars (bottom, M-)
  apoyo_bot_barDiam: number;
  apoyo_stirrupDiam: number;
  apoyo_stirrupSpacing: number;
  apoyo_stirrupLegs: number;
}

export interface RCColumnInputs {
  /** Nombre del elemento para el PDF (metadato de documento, no input de
   *  cálculo). Reservado: excluir de inputsFingerprint(). Ver RCBeamInputs.title. */
  title: string;
  b: number;
  h: number;
  cover: number;
  cornerBarDiam: number;   // mm — 4 corner bars (always present)
  nBarsX: number;          // intermediate bars per face on top/bottom faces (≥ 0)
  barDiamX: number;        // mm — diameter of top/bottom intermediate bars
  nBarsY: number;          // intermediate bars per face on left/right faces (≥ 0)
  barDiamY: number;        // mm — diameter of left/right intermediate bars
  stirrupDiam: number;
  stirrupSpacing: number;
  fck: number;
  fyk: number;
  Nd: number;    // design axial force (kN), compression positive
  MEdy: number;  // design moment about y-axis (kNm), uses h dimension
  MEdz: number;  // design moment about z-axis (kNm), uses b dimension
  L: number;     // real column length (m)
  beta: number;  // effective length factor β — Lk = L × β
  /** Coeficiente de fluencia efectivo φef para Kφ (CE Anejo 19 expr. 5.37).
   *  Típico en edificación ≈ 2.0. Opcional: estados guardados antiguos no lo traen. */
  phiEf?: number;
  /** Forma de la sección. Ausente ⇒ 'rectangular' (compat. estados antiguos de
   *  localStorage/URL). El motor lee siempre `inp.sectionType ?? 'rectangular'`. */
  sectionType?: 'rectangular' | 'circular';
  /** Diámetro de la sección circular (mm). Solo se usa cuando sectionType === 'circular'. */
  D?: number;
  /** Nº de barras longitudinales repartidas en el anillo (circular). */
  nBarsCirc?: number;
  /** Diámetro de las barras del anillo (mm) — circular. Campo dedicado (no se
   *  reutiliza cornerBarDiam, que es semántica rectangular). */
  circBarDiam?: number;
}

export type BeamType = 'ss' | 'cantilever' | 'fp' | 'ff';

/** ELS serviceability combination for deflection check (CTE DB-SE Tabla 4.2). */
export type ElsCombo = 'characteristic' | 'frequent' | 'quasi-permanent';

/** Familia de perfil del módulo de vigas — I/H laminados + cajón 2UPN + tubos. */
export type SteelBeamSectionType = 'IPE' | 'HEA' | 'HEB' | 'IPN' | '2UPN' | 'SHS' | 'RHS' | 'CHS';

export interface SteelBeamInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  tipo: SteelBeamSectionType;
  /** Size key — mm for IPE/HEA/HEB/IPN/2UPN. Ignored for SHS/RHS/CHS (tube dims below). */
  size: number;
  steel: 'S275' | 'S355';
  /** CHS only — outer diameter (mm). */
  chs_D: number;
  /** CHS only — wall thickness (mm). */
  chs_t: number;
  /** SHS/RHS only — overall depth h (mm). SHS uses h for both dims. */
  rhs_h: number;
  /** RHS only — overall width b (mm). */
  rhs_b: number;
  /** SHS/RHS only — wall thickness (mm). */
  rhs_t: number;
  /** Tubos (SHS/RHS/CHS) — EN 10210 hot-finished (curva a) vs EN 10219 cold-formed (curva c). */
  tube_process: CHSProcess;
  beamType: BeamType;
  MEd: number;
  VEd: number;
  /**
   * @internal — always overridden by effectiveInputs in index.tsx.
   * Do not read from raw state. Set by deriveFromLoads() per beam type.
   */
  VEd_interaction: number;
  Lcr: number;
  Mser: number;
  L: number;
  deflLimit: number;   // denominator of L/n admissible deflection limit (e.g. 300)
  elsCombo: ElsCombo;  // ELS combination type for deflection
  // Load generator
  useCategory: string;  // 'A1'|'A2'|'B'|'C1'|'C2'|'C3'|'D1'|'E1'|'G1'|'custom'
  gk: number;           // additional permanent surface load (kN/m2)
  qk: number;           // variable surface load (kN/m2) — prefilled from category
  bTrib: number;        // tributary width (m)
}

export interface FootingInputs {
  bc: number;   // column width (mm)
  hc: number;   // column depth (mm)
  a: number;    // footing length (mm)
  b: number;    // footing width (mm)
  h: number;    // footing depth (mm)
  cover: number;
  nBars: number;
  barDiam: number;
  fck: number;
  fyk: number;
  Nd: number;   // column axial load (kN)
  qadm: number; // admissible soil pressure (kPa)
}

export const rcBeamDefaults: RCBeamInputs = {
  mode: 'simple',
  title: '',
  b: 300,
  h: 500,
  cover: 30,
  fck: 25,
  fyk: 500,
  exposureClass: 'XC1',
  loadType: 'residential',
  psi2Custom: 0.3,
  L: 6000,
  structSystem: 'ss',
  deflMethod: 'ld',   // FTUX inalterado: el cálculo directo es opt-in
  phiEf: 2.0,
  // Vano — tension bottom d=500-30-8-8=454mm, compression top 2Ø12
  vano_Md: 85,
  vano_VEd: 65,
  vano_M_G: 45,
  vano_M_Q: 20,
  vano_bot_nBars: 4,
  vano_bot_barDiam: 16,
  vano_top_nBars: 2,
  vano_top_barDiam: 12,
  vano_stirrupDiam: 8,
  vano_stirrupSpacing: 150,
  vano_stirrupLegs: 2,
  // Apoyo — tension top 3Ø16, compression bottom 2Ø12
  apoyo_Md: 65,
  apoyo_VEd: 65,
  apoyo_M_G: 35,
  apoyo_M_Q: 15,
  apoyo_top_nBars: 3,
  apoyo_top_barDiam: 16,
  apoyo_bot_nBars: 2,
  apoyo_bot_barDiam: 12,
  apoyo_stirrupDiam: 8,
  apoyo_stirrupSpacing: 100,
  apoyo_stirrupLegs: 2,
};

export const rcColumnDefaults: RCColumnInputs = {
  title: '',
  b: 300,
  h: 300,
  cover: 30,
  cornerBarDiam: 16,
  nBarsX: 0,
  barDiamX: 12,
  nBarsY: 0,
  barDiamY: 12,
  stirrupDiam: 6,
  // c/140 ≤ 0.6·min(15·16, 300, 300) = 144 mm: el estribado corrido por
  // defecto cumple también la zona densificada junto a vigas/forjados
  // (A19.9.5.3(4)) → FTUX verde, sin el aviso de densificación.
  stirrupSpacing: 140,
  fck: 25,
  fyk: 500,
  Nd: 500,
  MEdy: 30,
  MEdz: 10,
  L: 3.5,
  beta: 1,
  phiEf: 2.0,
  // Sección — rectangular por defecto (FTUX inalterado). Circular: anillo de 6Ø16.
  sectionType: 'rectangular',
  D: 350,
  nBarsCirc: 6,
  circBarDiam: 16,
};

export const steelBeamDefaults: SteelBeamInputs = {
  title: '',
  tipo: 'IPE',
  size: 300,
  steel: 'S275',
  chs_D: 168.3,
  chs_t: 8,
  rhs_h: 150,
  rhs_b: 100,
  rhs_t: 8,
  tube_process: 'cold-formed',
  beamType: 'ss',
  MEd: 80,
  VEd: 60,
  VEd_interaction: 0,
  Lcr: 6000,   // autoLcr = 1.0 x L = 6000mm for ss default
  Mser: 50,
  L: 6000,
  deflLimit: 300,
  elsCombo: 'characteristic',
  useCategory: 'A1',
  gk: 1.0,
  qk: 2.0,
  bTrib: 3.0,
};

export type ColumnBCType = 'ff' | 'pp' | 'pf' | 'fc' | 'custom';
export type SteelColumnSectionType = 'HEA' | 'HEB' | 'IPE' | 'IPN' | '2UPN' | 'SHS' | 'RHS' | 'CHS';
export type CHSProcess = 'hot-finished' | 'cold-formed';

export interface SteelColumnInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  sectionType: SteelColumnSectionType;
  /** Size key — mm for HEA/HEB/IPE/2UPN. Ignored when sectionType='CHS'. */
  size: number;
  steel: 'S275' | 'S355';
  /** CHS only — outer diameter (mm). */
  chs_D: number;
  /** CHS only — wall thickness (mm). */
  chs_t: number;
  /** CHS only — EN 10210 hot-finished (curve a) vs EN 10219 cold-formed (curve c). */
  chs_process: CHSProcess;
  /** SHS/RHS only — overall depth h (mm). SHS uses h for both dims. */
  rhs_h: number;
  /** RHS only — overall width b (mm). */
  rhs_b: number;
  /** SHS/RHS only — wall thickness (mm). */
  rhs_t: number;
  /** SHS/RHS only — proceso (curva a caliente / curva c frío). */
  rhs_process: CHSProcess;
  // Geometry — independent unbraced lengths per axis
  Ly: number;      // unbraced length y-y (strong axis) in mm
  Lz: number;      // unbraced length z-z (weak axis) in mm
  bcType: ColumnBCType;
  /** β about y-y — only editable when bcType='custom' */
  beta_y: number;
  /** β about z-z — only editable when bcType='custom' */
  beta_z: number;
  // Loads (ULS)
  Ned: number;    // axial force (kN), positive = compression
  My_Ed: number;  // major-axis moment (kNm)
  Mz_Ed: number;  // minor-axis moment (kNm)
}

export const steelColumnDefaults: SteelColumnInputs = {
  title: '',
  sectionType: 'HEB',
  size: 200,
  steel: 'S275',
  chs_D: 168.3,
  chs_t: 8,
  chs_process: 'hot-finished',
  rhs_h: 150,
  rhs_b: 100,
  rhs_t: 8,
  rhs_process: 'cold-formed',
  Ly: 3500,
  Lz: 3500,
  bcType: 'pp',
  beta_y: 1.0,
  beta_z: 1.0,
  Ned: 400,
  My_Ed: 50,
  Mz_Ed: 8,
};

export interface RetainingWallInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  // Geometry (m)
  H: number;        // clear stem height above footing top
  hf: number;       // footing thickness
  tFuste: number;   // stem thickness (uniform)
  bPunta: number;   // toe projection
  bTalon: number;   // heel projection
  df: number;       // depth of soil ABOVE top of footing on the front (toe) side (m)
                    // Soil column over toe weight = γ·df·bP. Passive embedment = df + hf.
  // Materials
  fck: number;      // N/mm²
  fyk: number;      // N/mm²
  cover: number;    // mm (v2 2026-07-13: antes en m — único módulo que lo almacenaba así)
  // Backfill
  gammaSuelo: number;   // dry/bulk unit weight (kN/m³)
  gammaSat: number;     // saturated unit weight (kN/m³)
  phi: number;          // internal friction angle (°)
  delta: number;        // wall friction angle (°)
  q: number;            // uniform surcharge on backfill (kN/m²)
  sigmaAdm: number;     // admissible bearing capacity (kPa)
  mu: number;           // base friction coefficient
  // Sliding restrained (base coaccionada — p.ej. muro atado por una solera a otra
  // estructura): true desactiva la comprobación de deslizamiento (estática y sísmica).
  slidingRestrained: boolean;
  // Passive resistance (CTE DB-SE-C §9.3.3 — user-decided inclusion)
  usePassive: boolean;  // when true, include Ep = ½·Kp·γ·(df+hf)² in stability
  // Water table
  hasWater: boolean; // toggle: true = water table active
  hw: number;        // depth to water table from top of wall (m), used when hasWater=true
  // Seismic (NCSP-07 / NCSE-02) — kh and kv are derived internally
  Ab: number;       // aceleración sísmica básica (fraction of g, from hazard map)
  S: number;        // coeficiente de amplificación del terreno (NCSE-02 §2.2)
  // Rebar — ø (mm) + spacing (mm) per zone; 0 = zone not specified (sizing mode)
  diam_fv_int: number;  sep_fv_int: number;  // fuste vertical, cara trasdós (main bending)
  diam_fv_ext: number;  sep_fv_ext: number;  // fuste vertical, cara intradós (compression face)
  diam_fh:     number;  sep_fh:     number;  // fuste horizontal, per face (shrinkage)
  diam_zs:     number;  sep_zs:     number;  // zapata superior — talón (tension on top)
  diam_zi:     number;  sep_zi:     number;  // zapata inferior — punta (tension on bottom)
  diam_zt_inf: number;  sep_zt_inf: number;  // zapata transversal — cara inferior
  diam_zt_sup: number;  sep_zt_sup: number;  // zapata transversal — cara superior (opcional)
}

export const retainingWallDefaults: RetainingWallInputs = {
  title: '',
  H: 3.0,
  hf: 0.5,
  tFuste: 0.3,
  bPunta: 0.6,
  bTalon: 1.5,
  df: 0,
  fck: 25,
  fyk: 500,
  cover: 40,
  gammaSuelo: 18,
  gammaSat: 20,
  phi: 30,
  delta: 10,
  q: 0,
  sigmaAdm: 200,
  mu: 0.40,
  slidingRestrained: false,
  usePassive: false,
  hasWater: false,
  hw: 2.0,
  Ab: 0,
  S: 1.0,
  // Rebar — all default 0 (sizing mode)
  diam_fv_int: 0, sep_fv_int: 200,
  diam_fv_ext: 0, sep_fv_ext: 200,
  diam_fh:     0, sep_fh:     200,
  diam_zs:     0, sep_zs:     200,
  diam_zi:     0, sep_zi:     200,
  diam_zt_inf: 0, sep_zt_inf: 200,
  diam_zt_sup: 0, sep_zt_sup: 200,
};

// ── Muro de escollera / gaviones (Guía Fomento 2006 + CTE DB-SE-C) ───────────────

export type RockfillWallType = 'escollera' | 'gaviones';
/** Cómo se define el ángulo de rozamiento interno del material del muro:
 *  'directo' = valor introducido por el proyectista; 'guia' = φ = φb + Δφe − Δφn
 *  según la Guía de escolleras Fomento 2006 §4.1.3 (φb por litología, Δφn por
 *  tensión normal en la base). */
export type RockfillPhiMode = 'directo' | 'guia';
/** Litologías de la tabla 4.2 de la Guía Fomento 2006 (ángulo básico φb). */
export type RockfillLitologia =
  | 'granito' | 'gneis' | 'cuarcita' | 'basalto' | 'riolita'
  | 'granodiorita' | 'caliza' | 'conglomerado' | 'arenisca';
/** Alineación de las filas de cajas de gaviones: 'front' = paramento visto plano
 *  (escalones al trasdós); 'back' = trasdós plano (escalones vistos). */
export type GavionAlign = 'front' | 'back';

export interface RockfillWallInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  wallType: RockfillWallType;
  // Cuerpo del muro (m, común)
  H: number;            // altura del cuerpo sobre la cara superior del cimiento
  a: number;            // ancho de coronación
  // Cuerpo — escollera (taludes en m de avance horizontal por m de altura)
  mIntra: number;       // batter del intradós hacia el trasdós subiendo (0.33 = 1H:3V)
  mTras: number;        // batter del trasdós hacia el relleno subiendo (0 = vertical)
  alphaHiladas: number; // contrainclinación de las hiladas (°); 18.4 = 3H:1V
  // Cuerpo — gaviones
  hCaja: number;        // altura de cada fila de cajas (m), típ. 0.5 o 1.0
  stepCaja: number;     // incremento de ancho por fila hacia abajo (m)
  stepAlign: GavionAlign;
  alphaBatter: number;  // contrainclinación global de la pila de cajas (°), típ. 6–10
  // Cimiento (escollera hormigonada — bloque rígido)
  hz: number;           // canto (m); la Guía recomienda ≥ 1 m
  x0: number;           // vuelo de puntera (m)
  xT: number;           // vuelo de talón (m)
  alphaBase: number;    // contrainclinación del plano de apoyo (°); 18.4 = 3H:1V
  df: number;           // empotramiento frontal sobre cara superior del cimiento (m)
  // Material del muro
  gammaAp: number;      // peso específico aparente γap = γd·(1−n) (kN/m³)
  phiMode: RockfillPhiMode;
  phi: number;          // φ del material del muro, modo 'directo' (°)
  litologia: RockfillLitologia;  // modo 'guia' → φb (tabla 4.2)
  dPhiE: number;        // Δφe por características de la colocación (°), 1–3
  contactoMejorado: boolean;  // true → rozamiento entre hiladas tan(φ); false → tan(⅔φ)
  // Relleno del trasdós / terreno
  gammaSuelo: number;   // peso específico del relleno (kN/m³)
  gammaSat: number;     // peso específico saturado (kN/m³)
  phiRelleno: number;   // φ del relleno del trasdós (°)
  delta: number;        // rozamiento muro-relleno δ en el plano virtual (°)
  beta: number;         // inclinación del terreno sobre coronación (°)
  q: number;            // sobrecarga uniforme en trasdós (kN/m²)
  sigmaAdm: number;     // tensión admisible del terreno (kPa)
  muBase: number;       // coef. rozamiento cimiento-terreno (≈ tan ⅔·φ apoyo)
  // Empuje pasivo frontal (CTE DB-SE-C §9.3.3 — decisión del proyectista)
  usePassive: boolean;
  // Nivel freático
  hasWater: boolean;
  hw: number;           // profundidad del NF desde coronación (m)
  // Sismo (NCSE-02 / NCSP-07) — kh y kv derivados internamente
  Ab: number;           // aceleración sísmica básica (fracción de g)
  S: number;            // coeficiente de amplificación del terreno
}

export const rockfillWallDefaults: RockfillWallInputs = {
  title: '',
  wallType: 'escollera',
  H: 4.0,
  a: 2.0,
  mIntra: 0.34,
  mTras: 0,
  alphaHiladas: 18.43,
  hCaja: 1.0,
  stepCaja: 0.5,
  stepAlign: 'back',
  alphaBatter: 6,
  hz: 1.0,
  x0: 0.15,
  xT: 0,
  alphaBase: 18.43,
  df: 0,
  gammaAp: 18,
  phiMode: 'directo',
  phi: 40,
  litologia: 'caliza',
  dPhiE: 2,
  contactoMejorado: false,
  gammaSuelo: 18,
  gammaSat: 20,
  phiRelleno: 30,
  delta: 20,
  beta: 0,
  q: 0,
  sigmaAdm: 200,
  muBase: 0.43,
  usePassive: false,
  hasWater: false,
  hw: 2.0,
  Ab: 0,
  S: 1.0,
};

// ── Punching shear (CE Anejo 19 §6.4) ─────────────────────────────────────────────

export type PunchingMode = 'pilar' | 'carga-puntual' | 'pilar-cruceta';
export type PunchingPosition = 'interior' | 'borde' | 'esquina';
/** Origen del coeficiente β: 'auto' = simplificado por posición (Anejo 19 fig.
 *  6.21N); 'custom' = β afinado introducido por el proyectista (§6.4.3). */
export type PunchingBetaMode = 'auto' | 'custom';
// Cruceta v1: only HEB/HEA/IPE columns (rectangular footprint) + zapata substrate.
export type CrucetaColType = 'HEB' | 'HEA' | 'IPE';
export type CrucetaSteel = 'S275' | 'S355';

export interface PunchingInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title:         string;
  mode:          PunchingMode;      // 'pilar' | 'carga-puntual' | 'pilar-cruceta'
  cx:            number;            // mm — column/area dim x (or Ø if circular)
  cy:            number;            // mm — column/area dim y (= cx if circular)
  isCircular:    boolean;           // only active when position='interior'
  d:             number;            // mm — effective depth of slab
  /** mm — canto TOTAL de la losa. Sólo interviene en la cuantía mínima de la
   *  armadura de flexión (CE Anejo 19 §9.2.1.1 (9.1)), que depende del canto y
   *  no del canto útil. Estados guardados antes del 2026-09-25 lo reciben de
   *  los defaults (250); si no supera a d, la fila queda pendiente. */
  h:             number;
  fck:           number;            // MPa
  fyk:           number;            // MPa — flexural reinforcement steel
  barDiamSup:    number;            // mm — top face rebar diameter
  sSup:          number;            // mm — top face bar spacing
  barDiamInf:    number;            // mm — bottom face rebar diameter
  sInf:          number;            // mm — bottom face bar spacing
  VEd:           number;            // kN — design force ELU (= axil N for cruceta)
  position:      PunchingPosition;  // 'interior' | 'borde' | 'esquina'
  betaMode:      PunchingBetaMode;  // 'auto' (simplificado por posición) | 'custom' (β del proyectista)
  betaManual:    number;            // β introducido a mano (solo con betaMode='custom')
  hasShearReinf: boolean;
  swDiam:        number;            // mm — stirrup bar diameter
  swLegs:        number;            // number of stirrup legs per stirrup group
  sr:            number;            // mm — radial spacing between stirrup rows
  fywk:          number;            // MPa — stirrup characteristic strength
  // ── Cruceta mode (mode='pilar-cruceta') ──────────────────────────────────
  colType:       CrucetaColType;    // steel column profile family
  colSize:       number;            // profile size key (e.g. 200 for HEB 200)
  // Modo RECORTADO a "compañero de hand-calc" (2026-06-09): solo punzonamiento
  // conservador de la placa + datos del UPN. El reparto lo verifica el ingeniero.
  plateA:        number;            // mm — end plate dim x (área cargada)
  plateB:        number;            // mm — end plate dim y
  plateT:        number;            // mm — end plate thickness (informativo)
  steelGrade:    CrucetaSteel;      // cruceta steel grade (clase/capacidades UPN)
  upnSize:       number;            // chosen UPN profile size key
  weldThroat:    number;            // mm — fillet weld throat a (informativo)
  edgeY:         number;            // mm — clear dist plate face → free edge (borde/esquina)
  edgeX:         number;            // mm — clear dist 2nd free edge (esquina only)
}

export const punchingDefaults: PunchingInputs = {
  title:         '',
  mode:          'pilar',
  cx:            300,
  cy:            300,
  isCircular:    false,
  d:             200,     // mm — solid slab h≈250, cover≈40, rebar≈10
  h:             250,     // mm — canto total de esa losa
  fck:           25,
  fyk:           500,
  barDiamSup:    12,     // Ø12@150 → As=0.754mm²/mm → ρl≈0.377% → vRdc≈0.507MPa
  sSup:          150,
  barDiamInf:    12,
  sInf:          150,
  VEd:           260,    // kN — ~79% util en vRd,c con β=1.15 (fix #132; antes 300 con β=1.0)
  position:      'interior',
  betaMode:      'auto', // β simplificado por posición; 'custom' para el β afinado del §6.4.3
  betaManual:    1.15,   // valor inicial del β personalizado (= interior con transferencia de momento)
  hasShearReinf: false,
  swDiam:        8,      // mm — typical stirrup diameter
  swLegs:        2,
  sr:            100,    // mm — radial spacing between stirrup rows
  fywk:          500,
  // Cruceta defaults — HEB 200 + plate 300×300×20, zapata d=400, N high enough
  // that the bare plate punches and the cruceta is actually needed.
  colType:       'HEB',
  colSize:       200,
  plateA:        300,
  plateB:        300,
  plateT:        20,
  steelGrade:    'S275',
  upnSize:       160,
  weldThroat:    6,
  edgeY:         500,    // mm — clear dist to free edge (used in borde/esquina)
  edgeX:         500,
};

// ── Composite steel section (Steiner + EC3 classification) ───────────────────

export type CompositeSectionMode = 'custom' | 'reinforced';
export type CompositePlatePos = 'top' | 'bottom' | 'left' | 'right' | 'custom';
export type SteelGrade = 'S235' | 'S275' | 'S355' | 'S450';

/** Anclaje de una chapa lateral (left/right) en modo reinforced. */
export type CompositePlateLateralAnchor = 'web' | 'flange';

export interface PlateEntry {
  id: string;
  b: number;             // mm — horizontal width in cross-section
  t: number;             // mm — vertical dimension (ignored for left/right). El espesor para fy es min(b, t)
  posType: CompositePlatePos;
  customYBottom: number; // mm — only used when posType='custom'
  /**
   * Solo left/right. 'web' (def.) = pegada al alma, altura libre entre acuerdos
   * (comportamiento histórico). 'flange' = pegada a la punta del ala, altura
   * total h → cierra cajón ala-a-ala. Opcional para compatibilidad hacia atrás.
   */
  lateralAnchor?: CompositePlateLateralAnchor;
  /** Solo left/right. Desfase fino hacia afuera desde el anclaje (mm). Def. 0. */
  lateralOffset?: number;
}

export interface CompositeSectionInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  mode: CompositeSectionMode;
  profileType: 'IPE' | 'HEA' | 'HEB';
  profileSize: number;
  grade: SteelGrade;
  plates: PlateEntry[];
  // Compresión / pandeo (solo modo reinforced) — luces de pandeo por eje
  Ly: number;        // mm — luz de pandeo eje y (fuerte)
  Lz: number;        // mm — luz de pandeo eje z (débil)
  bcType: ColumnBCType;
  beta_y: number;    // β eje y — editable solo si bcType='custom'
  beta_z: number;    // β eje z — editable solo si bcType='custom'
  Ned: number;       // kN — axil de compresión opcional (0 = solo capacidad)
}

export const compositeSectionDefaults: CompositeSectionInputs = {
  title: '',
  mode: 'reinforced',
  profileType: 'IPE',
  profileSize: 300,
  grade: 'S275',
  plates: [
    { id: 'p1', b: 200, t: 15, posType: 'top', customYBottom: 0 },
  ],
  Ly: 3500,
  Lz: 3500,
  bcType: 'pp',
  beta_y: 1.0,
  beta_z: 1.0,
  Ned: 0,
};

// ── Pile caps — Encepados de micropilotes (CE Anejo 19 §6.5 / CTE DB-SE-C §5.1.4) ──

export interface PileCapInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title:    string;
  n:        number;  // 2 | 3 | 4 | 6 — number of micropiles (6 = retícula 2 × 3)
  d_p:      number;  // mm — pile diameter
  /** true → placa de reparto en cabeza de micro: el nodo comprimido de la biela
   *  apoya en la placa (área mayor), no en la sección del tubo. */
  plate_on: boolean;
  /** Forma de la placa de reparto: 'circ' (Ø d_plate) o 'cuad' (lado d_plate). */
  plate_shape: 'circ' | 'cuad';
  d_plate:  number;  // mm — Ø (circ) o lado (cuad) de la placa de reparto
  s:        number;  // mm — pile spacing c/c (n=6: entre filas, dirección y)
  s_x:      number;  // mm — n=6: separación entre las dos columnas (dirección x)
  h_enc:    number;  // mm — cap depth
  /** true → Lx/Ly automáticas (e_min a borde, redondeo a 5 cm); false → usa L_x/L_y. */
  dims_auto: boolean;
  L_x:      number;  // mm — cap plan dimension x (solo modo manual)
  L_y:      number;  // mm — cap plan dimension y (solo modo manual)
  /** n=3: distancia de eje de pilote a borde e (cota «C» del plano; solo modo manual).
   *  La planta triangular achaflanada queda definida por s, e y h. */
  e_man:    number;  // mm
  b_col:    number;  // mm — column width (x)
  h_col:    number;  // mm — column depth (y)
  fck:      number;  // MPa
  fyk:      number;  // MPa
  cover:    number;  // mm — bottom cover to tie bar centroid
  phi_tie:  number;  // mm — tie bar diameter
  /** true → el nº de barras del tirante lo pone el programa (el mínimo que
   *  cubre la demanda); false → lo pone el usuario en `n_bar_x` / `n_bar_y`.
   *
   *  Por qué existe: el automático redondea al alza el ÚLTIMO redondo, así que
   *  la utilización queda pegada al 100 % por construcción y la comprobación
   *  sale en ámbar («cumple al borde») sin que el usuario pudiera hacer nada
   *  —sólo podía cambiar el diámetro, que salta de golpe—. Con el manual, una
   *  barra más baja la utilización y el aviso desaparece. */
  bars_auto: boolean;
  n_bar_x:  number;  // ud — barras del tirante ∥ x (n=3: por lado); modo manual
  n_bar_y:  number;  // ud — barras del tirante ∥ y (n=4 y n=6); modo manual
  /** Armadura secundaria (EHE-08 art. 58.4.1.2; el CE no fija mínimos propios),
   *  dispuesta por el usuario y comprobada frente al mínimo: superior y retícula
   *  lateral (2 pilotes); retícula inferior entre bandas y cercos de banda (3 y 4). */
  phi_top:  number;  // mm — barras superiores (por banda)
  n_top:    number;  // ud — barras superiores por banda
  phi_cv:   number;  // mm — cercos verticales
  s_cv:     number;  // mm — separación de cercos a lo largo del encepado
  n_cv:     number;  // ud — ramas verticales de cada cerco
  phi_ch:   number;  // mm — armadura horizontal de las caras laterales
  s_ch:     number;  // mm — separación vertical entre horizontales
  phi_g:    number;  // mm — malla genérica de las caras superior e inferior
  s_g:      number;  // mm — separación de la malla (≤ 300: hormigón sin armar)
  N_Ed:     number;  // kN — design axial (compression > 0)
  Mx_Ed:    number;  // kNm — moment about x-axis (Navier)
  My_Ed:    number;  // kNm — moment about y-axis
  R_adm:    number;  // kN — admissible pile capacity
}

// FTUX defaults: all checks CUMPLE at ~60-75% utilization on first open.
// Verified hand-calc (modelo B&T CE Anejo 19 §6.5, geometría ex-EHE, fix
// adenda 2 + dims auto redondeadas a 5 cm): Lx×Ly = 1950×1150, e_borde=375;
// W_cap=44.85 kN → R_max=180.3 kN (72% de R_adm); θ=51.3°; σ_strut=6.08 vs
// σ_Rd=9.02 → 67%; tirante 361/1131 mm² → 32% (fyd = min(fyk/γs, 400), tope
// EHE-08 40.2); anclaje lb,req≈310 vs 1015 mm → 31%.
// L_x/L_y por defecto = valores auto (semilla al pasar a modo manual).
export const pileCapDefaults: PileCapInputs = {
  title:   '',
  n:       2,
  d_p:     220,
  plate_on: false,
  plate_shape: 'circ',
  d_plate: 320,      // semilla al activar la placa (≈ d_p + 100, redondeado)
  s:       1200,
  s_x:     2400,     // n=6: el plano tipo lleva el doble entre columnas que entre filas
  h_enc:   800,
  dims_auto: true,
  L_x:     1950,
  L_y:     1150,
  e_man:   400,      // e auto para d_p=220 con n=3 (semilla al pasar a manual)
  b_col:   400,
  h_col:   400,
  fck:     25,
  fyk:     500,
  cover:   60,
  phi_tie: 12,
  // Nº de barras automático. Los manuales son SEMILLA: al pasar a manual, el
  // panel los reescribe con el óptimo que acaba de calcular el motor.
  bars_auto: true,
  n_bar_x: 4,
  n_bar_y: 4,
  // Secundaria (n=2, EHE-08 58.4.1.2.1.2): b_ref = min(1150, 400) = 400 → 4‰ =
  // 1600 mm²/m; Ø12 c/100 con 2 ramas = 2262 mm²/m (71 %); superior 2Ø12 = 226
  // vs 113 mm² (50 %). Retícula inferior Ø12 c/100 sólo cuenta con n ≥ 3.
  phi_top: 12,
  n_top:   2,
  phi_cv:  12,
  s_cv:    100,
  n_cv:    2,
  phi_ch:  12,
  s_ch:    100,
  phi_g:   12,
  s_g:     100,
  N_Ed:    300,
  Mx_Ed:   0,
  My_Ed:   0,
  R_adm:   250,
};

// ── Empresillado — RC column jacketed with 4 equal-leg L-angles (CE Anejo 22 §6.4) ──

export interface EmpresalladoInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  // Existing column geometry
  bc: number;       // column width parallel to x-axis (cm)
  hc: number;       // column depth parallel to y-axis (cm)
  L: number;        // free height / inter-storey height (m)
  // Design loads (ULS)
  N_Ed: number;     // axial compression (kN)
  Mx_Ed: number;    // bending about x-axis (kNm)
  My_Ed: number;    // bending about y-axis (kNm)
  Vd: number;       // design shear in column section (kN); se SUMA a π·M_Ed/L (CE Anejo 22 §6.4.1(7))
  // L-angle profile
  perfil: string;   // AngleProfile key, e.g. 'L100x10'
  fy: number;       // steel yield strength (MPa), typically 275 or 355
  // Global buckling length factors (frame boundary conditions, independent of batten fixity)
  // Chord local buckling uses lk = s (c/c between battens, conservative — see engine; fix #130)
  beta_x: number;   // global buckling factor x-axis (0.5=fixed-fixed, 0.7=pin-fixed, 1.0=pin-pin)
  beta_y: number;   // global buckling factor y-axis
  // Batten plates (pletinas)
  s: number;        // batten spacing c/c (cm)
  lp: number;       // canto de la presilla, a lo largo del pilar (cm) — must be < s
  tp: number;       // batten thickness (mm)
}

export const empresalladoDefaults: EmpresalladoInputs = {
  title: '',
  bc: 30,    // cm
  hc: 30,    // cm
  L: 3.0,   // m
  N_Ed: 500,
  Mx_Ed: 20,
  My_Ed: 10,
  Vd: 0,
  perfil: 'L100x10',
  fy: 275,
  beta_x: 0.5,
  beta_y: 0.5,
  s: 40,    // cm
  lp: 12,   // cm
  tp: 10,   // mm
};

export const footingDefaults: FootingInputs = {
  bc: 300,
  hc: 300,
  a: 1200,
  b: 1200,
  h: 500,
  cover: 50,
  nBars: 5,
  barDiam: 12,
  fck: 25,
  fyk: 500,
  Nd: 450,
  qadm: 200,
};

// ── Isolated footing (CTE DB-SE-C 4.4 + CE armado) ───────────────────────────
// User-input sigma_adm + single load set with mayoradas/sin_mayorar toggle.
// Calc derives the other set via loadFactor (default 1.35).

export interface IsolatedFootingInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title:              string;
  // Geometry (m)
  B:                  number;  // footing width — x direction
  L:                  number;  // footing length — y direction
  h:                  number;  // footing height
  bc:                 number;  // column width x
  hc:                 number;  // column depth y
  Df:                 number;  // foundation depth from ground surface (only for W_soil)
  cover:              number;  // mm — recubrimiento geométrico (a cara de barra); d = h − cover − φ/2
  // Bearing capacity (user input from geotechnical report)
  sigma_adm:          number;  // kPa
  // Loads — single set with toggle
  loadsAreFactored:   boolean; // false = SLS input, true = ELU input
  loadFactor:         number;  // global γ (default 1.35)
  N:                  number;  // kN — vertical (compression +)
  Mx:                 number;  // kNm — moment about x axis (→ eccentricity in y)
  My:                 number;  // kNm — moment about y axis (→ eccentricity in x)
  H:                  number;  // kN — horizontal (for sliding check)
  // Materials
  fck:                number;  // MPa
  fyk:                number;  // MPa
  // Reinforcement (user-defined)
  phi_x:              number;  // mm — bar diameter, x-direction (parallel to B)
  s_x:                number;  // mm — spacing x bars
  phi_y:              number;  // mm — bar diameter, y-direction (parallel to L)
  s_y:                number;  // mm — spacing y bars
  // Soil context (no Meyerhof — sigma_adm is user-input)
  gamma_soil_kN_m3:   number;  // kN/m³ — unit weight of soil over footing (W_soil only)
  mu_friction:        number;  // — friction coefficient at footing base (sliding)
  // Posición del pilar. Convenio fijo: el lindero de la medianera es el borde
  // x = −B/2 (izquierda en planta) y la esquina es la de abajo a la izquierda
  // (x = −B/2, y = −L/2). El pilar queda ENRASADO con el lindero.
  tipo:               TipoZapata;
  /** Viga centradora en dirección x (hacia el pilar interior en +x). Sólo cuenta en medianera y esquina. */
  vigaX:              boolean;
  /** m — luz de la viga centradora x, entre ejes del pilar y del pilar interior. */
  luzX:               number;
  /** Viga centradora en dirección y (hacia el pilar interior en +y). Sólo cuenta en esquina. */
  vigaY:              boolean;
  /** m — luz de la viga centradora y, entre ejes de pilares. */
  luzY:               number;
  // Armadura superior (parrilla en la cara de arriba). La pide el despegue.
  supLleva:           boolean;
  phi_sup_x:          number;  // mm
  s_sup_x:            number;  // mm
  phi_sup_y:          number;  // mm
  s_sup_y:            number;  // mm
}

export type TipoZapata = 'centrada' | 'medianera' | 'esquina';

// FTUX defaults — trapezoidal distribution, all checks CUMPLE at ~50-75% on first open.
// N=300 kN sin_mayorar, σadm=200 kPa, B=L=1.8 m, h=0.6 m, Df=0.8 m, Mx=My=0.
//   N_total = 300 + W_footing + W_soil ≈ 300 + 48.6 + 12.96 = 361.6 kN
//   σmax = σmin = 361.6 / (1.8·1.8) = 111.6 kPa → util = 55.8% → OK (state-ok)
export const isolatedFootingDefaults: IsolatedFootingInputs = {
  title: '',
  B: 1.8, L: 1.8, h: 0.6, bc: 0.4, hc: 0.4, Df: 0.8, cover: 60,
  sigma_adm: 200,
  loadsAreFactored: false, loadFactor: 1.35,
  N: 300, Mx: 0, My: 0, H: 0,
  fck: 25, fyk: 500,
  phi_x: 16, s_x: 200, phi_y: 16, s_y: 200,
  gamma_soil_kN_m3: 18,
  mu_friction: 0.5,
  tipo: 'centrada',
  vigaX: false, luzX: 5,
  vigaY: false, luzY: 5,
  supLleva: false,
  phi_sup_x: 12, s_sup_x: 200, phi_sup_y: 12, s_sup_y: 200,
};

// ── Timber Beams (EC5 EN 1995-1-1) ───────────────────────────────────────────

export interface TimberBeamInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  gradeId: string;       // 'C24', 'GL28h', etc.
  b: number;             // mm — section width
  h: number;             // mm — section depth (bending depth; b > h admitido: sección apaisada)
  beamType: BeamType;
  L: number;             // m — span
  gk: number;            // kN/m — permanent UDL
  qk: number;            // kN/m — variable UDL
  /** kN — carga puntual PERMANENTE característica. P_G = P_Q = 0 ⇒ no hay carga puntual
   *  (el centinela es la física: una puntual de valor cero no produce ningún efecto). */
  P_G: number;
  /** kN — carga puntual VARIABLE característica. */
  P_Q: number;
  /** m — posición de la carga puntual desde el extremo IZQUIERDO, que es el
   *  empotramiento en ménsula y en articulada-empotrada. Se ignora si P_G = P_Q = 0. */
  aP: number;
  serviceClass: 1 | 2 | 3;
  loadDuration: string;  // LoadDurationClass
  loadType: string;      // 'residential'|'office'|'parking'|'roof'|'custom' (+ 'storage' de obras antiguas, ver migrarUsoAlmacen)
  psi2Custom: number;
  fireResistance: string;  // FireResistance
  exposedFaces: number;    // 3 | 4
  isSystem: boolean;       // EC5 §6.6 — ksys=1.10 when part of load-sharing system
  /** Tabiquería soportada — fija el límite de INTEGRIDAD (flecha activa) de
   *  CTE DB-SE 4.3.3.1: frágiles L/500, ordinarios L/400, sin tabiques L/300. */
  partitionType: 'fragile' | 'ordinary' | 'none';
}

// FTUX defaults: C24 150×400, L=5m biart., g=2kN/m q=3kN/m → ~70% util
export const timberBeamDefaults: TimberBeamInputs = {
  title: '',
  gradeId: 'C24',
  b: 150,
  h: 400,
  beamType: 'ss',
  L: 5,
  gk: 2.0,
  qk: 3.0,
  P_G: 0,
  P_Q: 0,
  aP: 2.5,
  serviceClass: 1,
  loadDuration: 'medium',
  loadType: 'residential',
  psi2Custom: 0.30,
  fireResistance: 'R0',
  exposedFaces: 3,
  isSystem: false,
  partitionType: 'ordinary',
};

// ── Timber Columns (EC5 EN 1995-1-1 §6.3) ────────────────────────────────────

export interface TimberColumnInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  gradeId: string;          // 'C24', 'GL28h', etc.
  b: number;                // mm — section width
  h: number;                // mm — section height
  L: number;                // m — column height
  beta_y: number;           // effective length factor — strong axis (y-y, buckling in h-direction)
  beta_z: number;           // effective length factor — weak axis  (z-z, buckling in b-direction)
  Nd: number;               // kN — design axial compression (user-factored)
  Vd: number;               // kN — design shear (user-factored)
  Md: number;               // kNm — design moment (user-factored)
  momentAxis: string;       // 'strong' | 'weak' — axis moment acts on
  serviceClass: 1 | 2 | 3;
  loadDuration: string;     // LoadDurationClass
  fireResistance: string;   // 'R0'|'R30'|'R60'|'R90'|'R120'
  exposedFaces: number;     // 3 | 4
  etaFi: number;            // fire load reduction factor (0–1); used only when fireResistance !== 'R0'
}

// ── Forjados (reticular + losa maciza) — CE Anejo 19 §5.3.2.1, §6.1, §6.2 ──────────────────

export type ForjadosVariant = 'reticular' | 'maciza';
export type ForjadosTipologia = '25+5' | '30+5' | '35+5' | '40+5' | '35+10' | 'custom';
export type ForjadosTipoVano = 'biapoyado' | 'continuo-extremo' | 'continuo-interior' | 'voladizo';

export interface ForjadosInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  variant: ForjadosVariant;

  // Geometría compartida
  h:       number;  // canto total (mm)
  cover:   number;  // recubrimiento mecánico (mm)

  // Materiales
  fck:           number;
  fyk:           number;
  exposureClass: string;  // XC1..XC4

  // Reticular — tipología + geometría T
  tipologia:  ForjadosTipologia;
  hFlange:    number;         // espesor capa de compresión (mm)
  bWeb:       number;         // ancho nervio (mm)
  intereje:   number;         // separación entre nervios (mm)
  spanLength: number;         // luz L (mm) — usada para b_eff
  tipoVano:   ForjadosTipoVano;

  // Armado base reticular — compartido vano/apoyo (montaje continuo del nervio)
  base_sup_nBars:  number;  base_sup_barDiam:  number;
  base_inf_nBars:  number;  base_inf_barDiam:  number;
  // Refuerzos zonales reticular — adicionales a la base
  refuerzo_vano_inf_nBars:   number;  refuerzo_vano_inf_barDiam:   number;  // extra en vano (M+)
  refuerzo_apoyo_sup_nBars:  number;  refuerzo_apoyo_sup_barDiam:  number;  // extra en apoyo (M-)

  // Parrilla base maciza — uniforme en toda la losa
  base_sup_phi_mac: number;  base_sup_s_mac: number;
  base_inf_phi_mac: number;  base_inf_s_mac: number;
  // Refuerzos zonales maciza — parrillas extra superpuestas
  refuerzo_vano_inf_phi_mac:   number;  refuerzo_vano_inf_s_mac:   number;
  refuerzo_apoyo_sup_phi_mac:  number;  refuerzo_apoyo_sup_s_mac:  number;

  // Cortante — toggle + configuración por sección
  stirrupsEnabled:       boolean;
  vano_stirrupDiam:      number;  vano_stirrupSpacing:  number;  vano_stirrupLegs:  number;
  apoyo_stirrupDiam:     number;  apoyo_stirrupSpacing: number;  apoyo_stirrupLegs: number;

  // Esfuerzos de cálculo
  vano_Md:   number;  // kNm (M+ vano)
  apoyo_Md:  number;  // kNm (|M-| apoyo)
  VEd:       number;  // kN (cortante único)
  // SLS (for fisuración when exposureClass !== XC1)
  vano_M_G:  number;  vano_M_Q:  number;
  apoyo_M_G: number;  apoyo_M_Q: number;
  loadType:  string;   // 'residential'|'office'|'parking'|'roof'|'custom'
  psi2Custom: number;
}

// FTUX defaults: reticular 30+5, montaje 2Ø12 + refuerzo 2Ø16 (se arman en 2
// capas en el nervio b_w=120 → d≈292 mm, CE Anejo 19 §8.2), Md+=35, M-=25, VEd=22 kN.
// Abre en CUMPLE: el cortante gobierna (~80% de VRd,c≈27 kN sin cercos); flexión
// ~45%, separación de barras OK en 2 capas (s≈28 mm). VEd se bajó de 30→22 porque
// con d reducido VRd,c≈27 kN < 30 (antes daba INCUMPLE de cortante en el demo).
export const forjadosDefaults: ForjadosInputs = {
  title: '',
  variant: 'reticular',

  h:       350,
  cover:   30,

  fck:           25,
  fyk:           500,
  exposureClass: 'XC1',

  tipologia:  '30+5',
  hFlange:    50,
  bWeb:       120,
  intereje:   820,
  spanLength: 5000,
  tipoVano:   'continuo-interior',

  // Reticular: montaje 2Ø12 sup + 2Ø12 inf (base), refuerzos 2Ø16 en vano y apoyo
  base_sup_nBars:  2, base_sup_barDiam:  12,
  base_inf_nBars:  2, base_inf_barDiam:  12,
  refuerzo_vano_inf_nBars:  2, refuerzo_vano_inf_barDiam:  16,
  refuerzo_apoyo_sup_nBars: 2, refuerzo_apoyo_sup_barDiam: 16,

  // Maciza: parrilla Ø10/200 ambas caras; refuerzo apoyo Ø12/200, refuerzo vano vacío
  base_sup_phi_mac: 10, base_sup_s_mac: 200,
  base_inf_phi_mac: 10, base_inf_s_mac: 200,
  refuerzo_vano_inf_phi_mac:  0, refuerzo_vano_inf_s_mac:  200,
  refuerzo_apoyo_sup_phi_mac: 12, refuerzo_apoyo_sup_s_mac: 200,

  stirrupsEnabled:       false,
  vano_stirrupDiam:      6,  vano_stirrupSpacing:  200, vano_stirrupLegs:  2,
  apoyo_stirrupDiam:     6,  apoyo_stirrupSpacing: 150, apoyo_stirrupLegs: 2,

  vano_Md:  35,
  apoyo_Md: 25,
  VEd:      22,

  vano_M_G:  18, vano_M_Q:  10,
  apoyo_M_G: 13, apoyo_M_Q: 7,
  loadType:  'residential',
  psi2Custom: 0.3,
};

// FTUX defaults: C24 160×160, L=3m, Nd=80kN wind moment → ~65% util
// FTUX recalibrado (fix auditoría #121): con Md=8 el comb-623 daba 1.187 —
// INCUMPLE en rojo al primer open (el fix de la forma lineal de 6.23 nunca
// recalibró la demo). Con Md=3: comb-623 ≈ 0.69, comb-624 ≈ 0.60 → verde ~70%.
export const timberColumnDefaults: TimberColumnInputs = {
  title: '',
  gradeId: 'C24',
  b: 160,
  h: 160,
  L: 3.0,
  beta_y: 1.0,
  beta_z: 1.0,
  Nd: 80,
  Vd: 5,
  Md: 3,
  momentAxis: 'strong',
  serviceClass: 1,
  loadDuration: 'medium',
  fireResistance: 'R0',
  exposedFaces: 4,
  etaFi: 0.65,
};

// ──────────────── Anchor plate (Placas de anclaje) ────────────────
// PR-3/PR-4: rebar-based anchors (B400S/B500S), anclaje inferior y conexión
// superior modelados como campos independientes (ortogonales).

/** I/H laminados y, desde 2026-09-23, el cajón de dos UPN soldadas por las
 *  puntas de las alas: el pilar habitual de las láminas tipo del estudio. */
export type AnchorPlateSectionType = 'IPE' | 'HEA' | 'HEB' | 'IPN' | '2UPN';
export type AnchorPlateSteel = 'S235' | 'S275' | 'S355';
export type PedestalSurface = 'smooth' | 'roughened';
// Re-export the rebar / anchor types for consumers that previously pulled them from here.
export type { RebarGrade, RebarDiam, BottomAnchorage, TopConnection } from './anchorBars.ts';
import type { RebarGrade, RebarDiam, BottomAnchorage, TopConnection } from './anchorBars.ts';

export interface AnchorPlateInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title: string;
  // Perfil (reusa del módulo steel-columns)
  sectionType: AnchorPlateSectionType;
  sectionSize: number;              // e.g. 200 for HEB-200; en 2UPN, la de cada UPN (2UPN 200 → 200)

  // Solicitaciones (ELU, compresión positiva)
  NEd:   number;                      // kN — axil total ELU (combinación más desfavorable)
  NEd_G: number;                      // kN — axil cuasi-permanente (para fricción μ·Nc,G, EN 1992-4 §6.2.2)
  Mx:    number;                      // kNm (eje fuerte)
  My:    number;                      // kNm (eje débil)
  VEd:   number;                      // kN — magnitud cortante. Legacy. Vx/Vy lo reemplazan progresivamente (PR0/PR8a).
  Vx:    number;                      // kN — cortante eje fuerte (introducido en PR0, default = VEd, usado a partir de PR8a)
  Vy:    number;                      // kN — cortante eje débil (introducido en PR0, default = 0)

  // Placa
  plate_a:      number;              // mm (paralela al eje fuerte)
  plate_b:      number;              // mm (paralela al eje débil)
  plate_t:      number;              // mm
  plate_steel:  AnchorPlateSteel;

  // Barras de anclaje (EHE-08 / EC2)
  // 4 esquinas · 6 tres por extremo del eje fuerte · 8 anillo · 12 anillo con
  // pares. La 9 (retícula 3×3, con la barra central bajo el pilar) se retiró
  // el 2026-09-23 y un estado guardado con 9 se lee como 8.
  bar_nLayout:    4 | 6 | 8 | 12;
  bar_diam:       RebarDiam;
  bar_grade:      RebarGrade;
  bar_spacing_x:  number;            // mm — separación entre las dos barras de cada par central de los lados paralelos al eje fuerte (sólo disposición 12)
  bar_spacing_y:  number;            // mm — ídem, pares de los lados paralelos al eje débil (sólo disposición 12)
  bar_edge_x:     number;            // mm (barra al borde de placa, eje fuerte)
  bar_edge_y:     number;            // mm (idem, eje débil)
  bar_hef:           number;         // mm (profundidad útil de anclaje)
  bottom_anchorage:  BottomAnchorage; // prolongación recta / patilla / gancho / arandela+tuerca (transferencia al hormigón)
  top_connection:    TopConnection;   // soldada / tuerca+arandela (detalle barra↔placa, sin check)
  washer_od:         number;         // mm — diámetro exterior arandela (solo bottom_anchorage='arandela_tuerca')

  // Rigidizadores
  rib_count: 0 | 2 | 4;
  rib_h:     number;                 // mm
  rib_t:     number;                 // mm

  // Hormigón y macizo
  fck:            number;            // MPa
  pedestal_cX:    number;            // mm — c1: perno al borde del macizo, eje fuerte (EN 1992-4 §7.2.1.4). Legacy: se mantiene como semilla de cX1/cX2 hasta PR8a.
  pedestal_cY:    number;            // mm — c2: perno al borde del macizo, eje débil. Legacy: idem.
  pedestal_cX1:   number;            // mm — distancia direccional al borde en +x (PR0, default = pedestal_cX). Usado por checks direccionales a partir de PR8a.
  pedestal_cX2:   number;            // mm — idem a −x.
  pedestal_cY1:   number;            // mm — idem a +y.
  pedestal_cY2:   number;            // mm — idem a −y.
  pedestal_h:     number;            // mm — canto del macizo, necesario para splitting ψh,sp (PR0, default 1000; usado por PR6).
  concrete_cracked: boolean;         // EN 1992-4 §7.2.1.5: k2=7.5 fisurado (default, conservador) ó 10.5 no fisurado. Afecta pull-out y, en futuro, factor ψc,N del cono.
  plate_margin_x: number;            // mm — placa al borde del macizo, eje fuerte (CE Anejo 26 §6.2.5, factor α extensión)
  plate_margin_y: number;            // mm — placa al borde del macizo, eje débil
  surface_type:   PedestalSurface;

  // Soldadura placa-pilar (informativo, no se comprueba)
  weld_throat: number;               // mm
}

// FTUX: la lámina tipo del estudio para un HEB-200 — placa 350×350×20 S275,
// 8 barras φ20 B500S en anillo (esquinas + una centrada en cada lado) y los
// cuatro rigidizadores en «#» pegados a las caras del pilar. Axil+biaxial para
// ejercitar el solver. Hasta 2026-09-23 era 400×300 con 4 barras y el par de
// cartelas en las alas: las barras (y = ±100) caían justo sobre las cartelas
// (y = 100..110), que es lo que se veía en el dibujo.
export const anchorPlateDefaults: AnchorPlateInputs = {
  title: '',
  sectionType: 'HEB',
  sectionSize: 200,

  NEd:   200,
  NEd_G: 120,    // p. ej. peso propio + cuasi-permanente (típico 40–70% del total ELU)
  Mx:    45,
  My:    10,     // PR-2: biaxial por defecto
  VEd:   50,

  plate_a:     350,
  plate_b:     350,
  plate_t:     20,
  plate_steel: 'S275',

  bar_nLayout:   8,
  bar_diam:      20,
  bar_grade:     'B500S',
  bar_spacing_x: 100,               // sólo cuenta con la disposición 12 (pares centrales)
  bar_spacing_y: 100,
  bar_edge_x:    40,                // barras en ±135: 25 mm libres a la cara de las cartelas (100..110)
  bar_edge_y:    40,
  bar_hef:          300,            // anclaje por adherencia (EC2 §8.4) típico 15–25·φ
  bottom_anchorage: 'prolongacion_recta',
  top_connection:   'soldada',
  washer_od:        50,             // solo aplica si bottom_anchorage='arandela_tuerca'

  rib_count: 4,
  rib_h:     120,
  rib_t:     10,

  fck:             25,
  pedestal_cX:     190,   // c1 — barra a borde del macizo = 40 (a borde de placa) + 150 (margen) (legacy, seeds direccionales)
  pedestal_cY:     190,   // c2 (legacy, seeds direccionales)
  pedestal_cX1:    190,   // direccional +x (PR0)
  pedestal_cX2:    190,   // direccional −x (PR0)
  pedestal_cY1:    190,   // direccional +y (PR0)
  pedestal_cY2:    190,   // direccional −y (PR0)
  pedestal_h:     1000,   // mm canto macizo — default conservador (PR0, usado por splitting PR6)
  concrete_cracked: true, // default conservador EN 1992-4 §7.2.1.5
  plate_margin_x:  150,   // placa (350) + 2·150 = 650 mm pedestal
  plate_margin_y:  150,
  surface_type:    'roughened',

  Vx: 50,                 // = VEd inicialmente (PR0); decompone Vy a partir de PR8a
  Vy: 0,
  weld_throat: 6,
};

// ── FEM 1D analysis ──────────────────────────────────────────────────────────
// Lightweight registry-only defaults: the FEM module manages its rich nested
// model (nodes, bars, supports, loads) via its own localStorage key and does
// not use useModuleState. These primitive flags exist only so the registry
// shape stays uniform.
export interface FemAnalysisInputs {
  combo: string;       // 'ELU' | 'ELS-c' | 'ELS-f'
  selfWeight: boolean;
  showDeformed: boolean;
  showReactions: boolean;
}

export const femAnalysisDefaults: FemAnalysisInputs = {
  combo: 'ELU',
  selfWeight: false,
  showDeformed: false,
  showReactions: true,
};

// FEM 2D (pórticos/cerchas). Like FEM 1D, the real state is a rich nested model
// (template id + one param set per template) managed in the module's own
// localStorage key (see features/fem2d/useFem2DState). These primitive flags
// exist only to keep the registry shape uniform.
export interface Fem2DModuleInputs {
  templateId: string;
  selfWeight: boolean;
}

export const fem2dDefaults: Fem2DModuleInputs = {
  templateId: 'portal-frame',
  selfWeight: true,
};

// ── Masonry walls (DB-SE-F) — multi-floor wall verification ──────────────
//
// Same pattern as FEM: the registry only needs primitive flags; the full
// nested model (plantas, huecos, puntuales) lives outside in its own
// localStorage key managed by the module itself.
export interface MasonryWallsInputs {
  mostrarMapa: boolean;
}

export const masonryWallsDefaults: MasonryWallsInputs = {
  mostrarMapa: true,
};

// ── Micropilotes (Guía Fomento 2005) ─────────────────────────────────────────
// Igual que compositeSection / FEM / masonry: la lista de estratos vive en
// localStorage del propio módulo (concreta-micropiles), no en useModuleState.
// Los campos aquí son los escalares serializables; el SoilLayer[] se inyecta
// por el orquestador y `micropilesDefaults` lo trae embebido como ground truth
// para los tests de FTUX (mismos números que la hoja Excel de referencia).

export interface SoilLayer {
  id: number;
  thickness: number;       // m  — espesor del estrato
  type: SoilType;
  gamma: number;           // kN/m³ — peso específico
  c: number;               // kPa  — cohesión efectiva c'
  phi: number;             // °    — ángulo de rozamiento interno
  Nspt: number;            // golpes/30cm — solo a título informativo
  su: number;              // kN/m² — resistencia al corte sin drenaje (cohesivos)
  rflim: number;           // MPa  — fricción límite empírica
  /** Coeficiente de uniformidad Cu = D60/D10 (solo granulares). Opcional:
   *  ausente o 0 ⇒ se trata como Cu<2 a efectos del pandeo (Tabla 3.6). */
  Cu?: number;
}

export interface MicropilesInputs {
  /** Nombre del elemento para el PDF (metadato de documento). Reservado: excluir de inputsFingerprint(). */
  title:              string;
  // Geometría — convención: profundidad medida DESDE LA RASANTE, positiva
  // hacia abajo (convención geotécnica). Una cabeza enterrada 1 m tiene
  // topDepth = 1. Si por algún motivo la cabeza queda sobre rasante (poste),
  // topDepth puede ser negativa, pero NO es el caso típico de cimentación.
  // Cambio v3 → v4 (2026-05-24): antes se usaba cota (positiva = arriba);
  // el usuario tenía que meter números negativos para todo, contraintuitivo
  // en una herramienta de cimentación.
  topDepth:           number;   // m (profundidad cabeza, positiva = bajo rasante)
  toeDepth:           number;   // m (profundidad apoyo, > topDepth)
  drillDiameter:      number;   // mm — Dn (perforación). Cambio v4→v5: antes en m
  waterTableDepth:    number;   // m — profundidad NF (positiva bajo rasante). Si < topDepth, NF sobre la cabeza
  injectionPressure:  number;   // kPa
  // Carga y modo
  designLoad:         number;   // kN — Nc,d
  effort:             EffortType;
  method:             'theoretical' | 'empirical';
  /** Material inyectado (lechada/mortero) — Guía Fomento §2.3.2. Determina,
   *  junto con `effort`, el recubrimiento mínimo r de la Tabla 2.3. */
  groutType:          'lechada' | 'mortero';
  // Materiales
  concreteGrade:      number;   // fck en MPa (HA-25/30/35 ⇒ 25/30/35)
  /** Label del catálogo PIRESA (ver micropileTubes.ts) o sentinel 'custom'
   *  para usar customTubeDe/customTubeE. El motor resuelve uno u otro. */
  tube:               string;
  /** Diámetro exterior personalizado (mm) — solo se usa si tube === 'custom'. */
  customTubeDe:       number;
  /** Espesor de pared personalizado (mm) — solo se usa si tube === 'custom'. */
  customTubeE:        number;
  steelGrade:         number;   // N/mm² — fy
  // Ejecución / entorno
  execution:          ExecutionType;
  corrosionEnv:       CorrosionEnv;
  designLifeYears:    DesignLifeYears;   // Guía Tabla 2.4 — vida útil de proyecto
  connection:         ConnectionType;
  application:        ApplicationType;
  duration:           Duration;
  // Pandeo (Guía 3.6) — CR se auto-calcula de la estratigrafía+geometría
  // (ver micropilesBuckling.ts). `crManualOverride` permite fijarlo a mano:
  //   false (default) ⇒ el solver determina CR; `CR` se ignora salvo como
  //                     valor inicial/eco editable.
  //   true            ⇒ se usa `CR` tal cual lo teclea el usuario.
  crManualOverride:   boolean;
  CR:                 number;   // factor de pandeo manual (R = 1.07 − 0.027·CR)
  // Recubrimiento estructural r del tubo dentro de la lechada (Guía 3.6.2).
  //   false (default) ⇒ auto: la lechada llena el barreno, r = (Dn−de)/2 ⇒
  //                     d_struct = Dn. `structuralCover` se ignora salvo eco.
  //   true            ⇒ se usa `structuralCover` tal cual (override manual).
  coverManualOverride: boolean;
  // Diámetro estructural del bulbo de hormigón (Guía 3.6): d_struct = de + 2·r.
  // r es el recubrimiento efectivo del tubo dentro de la lechada (≠ perforación).
  // El Excel de referencia usa 45,55 mm para Ø88,9 (d_struct = 180 mm).
  structuralCover:    number;   // mm
  // Empujes horizontales (opcionales). f (longitud ficticia) se INTERPOLA
  // ahora desde E₀/EL (Guía Tabla 3.8), por eso no es input.
  baseMoment:         number;   // kNm — Md
  baseShear:          number;   // kN  — Vd
  soilModulusTop:     number;   // kN/m² — E₀
  soilModulusEmbed:   number;   // kN/m² — EL
}

export const micropilesDefaults: MicropilesInputs = {
  title:              '',
  topDepth:           1.0,
  toeDepth:           17.0,
  drillDiameter:      185,           // mm (era 0.185 m)
  waterTableDepth:    7.5,
  injectionPressure:  300,
  designLoad:         350,
  effort:             'compression',
  method:             'theoretical',
  groutType:          'lechada',                  // default Guía Fomento (Piresa)
  concreteGrade:      30,
  tube:               'Ø88,9 × 9 mm',
  customTubeDe:       88.9,    // arranca igual al default catálogo
  customTubeE:        9,
  steelGrade:         551,
  execution:          'wt-below-no-casing-no-mud',
  corrosionEnv:       'natural-undisturbed',
  designLifeYears:    50,                    // estándar EHE/CTE
  connection:         'no-loss',
  application:        'new',
  duration:           'long',
  crManualOverride:   false,                  // auto por defecto (Guía 3.6.1)
  CR:                 7.5,
  coverManualOverride: false,                 // auto: r = (Dn−de)/2 ⇒ d_struct = Dn
  structuralCover:    45.55,
  baseMoment:         0,
  baseShear:          0,
  soilModulusTop:     9000,
  soilModulusEmbed:   500000,
};

/**
 * Estratos por defecto — caso FTUX del Excel.
 *
 * Convención v6: los espesores se miden DESDE LA RASANTE (z=0 en superficie),
 * tal y como los entrega el geotécnico. Con topDepth=1 m, el primer estrato
 * cubre 0→3.30 m (1 m por encima de la cabeza + 2.30 m bajo cabeza), que es
 * el tramo de fuste que aporta rozamiento en E1. Para que el pilote "vea"
 * idénticos estratos que en v5 (y los resultados FTUX se mantengan):
 *   E1: 3.30 m (1.00 sobre cabeza + 2.30 fuste)
 *   E2: 9.20 m
 *   E3: 2.50 m
 *   E4: 65.00 m
 * Suma ≈ 80 m, cubre holgadamente toeDepth=17 m.
 *
 * Resultado esperado Rfc_teórico ≈ 496.28 kN, Rfc_empírico ≈ 675.17 kN.
 *
 * Pandeo (auditoría 2026-11, Guía §3.6.1 literal): E1 lleva NSPT = 15
 * (granular media, el mismo valor que el editor da a un estrato nuevo) y E4
 * Cu = 3 (bien graduada). Con NSPT = 0, E1 sería arena floja y, sin Cu, la
 * parte de E4 bajo el NF sería terreno inestable: el ejemplo daría R = 0.
 * Con estos valores gobierna E1 como granular media sobre el NF (CR ≈ 7,75).
 */
export const micropilesSoilDefaults: SoilLayer[] = [
  { id: 1, type: 'granular', thickness:  3.30, gamma: 19, c:   0, phi: 20, Nspt: 15, su:   0, rflim: 0.00 },
  { id: 2, type: 'cohesive', thickness:  9.20, gamma: 20, c:   0, phi: 22, Nspt: 20, su:   0, rflim: 0.08 },
  { id: 3, type: 'cohesive', thickness:  2.50, gamma: 20, c: 184, phi: 28, Nspt: 35, su:   0, rflim: 0.25 },
  { id: 4, type: 'granular', thickness: 65.00, gamma: 20, c: 280, phi: 28, Nspt: 37, su:   0, rflim: 0.25, Cu: 3 },
];

// ── Geotecnia · Estabilidad de taludes (PySlope/Pyodide) ──────────────────────
// Phase 1 "corte vertical". El estado es un BLOB JSON anidado (estratos + cargas)
// persistido en localStorage del propio módulo (no useModuleState plano) — decisión
// eng-review §9.3 T3. Reutiliza SoilLayer (arriba) para los estratos: en taludes
// importan gamma (γ), c (c', kPa) y phi (φ', º) en cada corrida; thickness define
// depth_to_bottom acumulado desde la coronación. su (kN/m²) se usa solo en el check
// sin drenaje (slope.ts: estratos con su>0 → φ=0, c=su). Nspt/rflim/Cu se ignoran en
// el motor de taludes (campos específicos de micropilotes).

/** Sobrecarga en coronación. `udl` = carga uniforme (kPa) sobre una banda; `line`
 *  = carga lineal (kN/m) en un punto. `offset` (m) se mide desde la coronación del
 *  talud hacia el trasdós (sentido del límite izquierdo de análisis). `length` (m)
 *  solo aplica a `udl`: 0/ausente ⇒ banda hasta el límite de análisis. */
export interface SlopeLoad {
  id: number;
  kind: 'udl' | 'line';
  magnitude: number;        // kPa (udl) | kN/m (line)
  offset: number;           // m desde la coronación
  length?: number;          // m (solo udl)
}

export interface SlopeInputs {
  // Geometría — talud simple (height + angle). PySlope: Slope(height, angle).
  height: number;           // H (m) — altura del talud
  angle: number;            // β (º) — inclinación de la cara del talud
  // Nivel freático — cota medida desde la coronación, positiva hacia abajo.
  // null = sin nivel freático (análisis seco).
  waterTableDepth: number | null;   // m
  // Estratigrafía horizontal (de arriba hacia abajo). Reusa SoilLayer.
  strata: SoilLayer[];
  // Sobrecargas en coronación.
  loads: SlopeLoad[];
  // Método y malla de búsqueda (limitado por PySlope: Bishop / Fellenius).
  method: 'bishop' | 'fellenius';
  slices: number;           // nº de dovelas (10–200) — def. 25
  iterations: number;       // nº de círculos de búsqueda — def. 1000
  // Situación de proyecto — fija los límites normativos de los checks.
  situation: 'persistent' | 'transient' | 'extraordinary';
  // Contexto normativo — selecciona qué comprobaciones/límites aplican (doc §4.2):
  //  'excavation'        = talud de excavación (CTE DB-SE-C art. 7.2.2.1, γ_R=1,5)
  //  'global-foundation' = estabilidad global de cimentación (CTE DB-SE-C Tabla 2.1, γ_M=1,8)
  context: 'excavation' | 'global-foundation';
  /**
   * Bloque rígido excluido del dominio de rotura: la huella de un muro que YA ha
   * superado sus comprobaciones internas (hilada a hilada / juntas) y de conjunto,
   * y que por tanto puede idealizarse como sólido rígido en el análisis global.
   * Los círculos que suban por encima de `depth` dentro de la huella se descartan,
   * de modo que la superficie crítica pasa BAJO la zapata, por el terreno de
   * cimentación, mientras el muro aporta su peso como bloque.
   *
   * Por qué es necesario: PySlope sólo admite estratos HORIZONTALES, así que no se
   * puede dar resistencia al muro sin dársela también al relleno del trasdós (por
   * donde entran los círculos). Modelar el muro como estrato de c=0 produce un
   * talud sin cohesión a 71-85°, que no se sostiene: FoS ≈ tanφ/tanβ ≈ 0,20.
   *
   * Distancias en m, RELATIVAS a la coronación y al pie del talud: las abscisas
   * absolutas del modelo PySlope no son estables (top_x = (tot_l − length)/2 se
   * desplaza al cambiar geometría, materiales o cargas). Se resuelven dentro de
   * Python, donde top_x/bot_x son autoritativos.
   *
   * NO es un campo de UI: sólo lo fija el builder de traspaso desde un módulo de
   * muro (lib/calculations/geotech/slopePrefill.ts). Ausente ⇒ búsqueda sin
   * exclusión, que es el comportamiento del módulo de taludes usado por sí solo.
   */
  rigidBlock?: {
    /** m tras la coronación → huella = [top_x − padHeel, …] (vuelo de talón). */
    padHeel: number;
    /** m pasado el pie → huella = […, bot_x + padToe] (vuelo de puntera). */
    padToe: number;
    /** m bajo la coronación → cota de base = top_y − depth (base del cimiento). */
    depth: number;
  };
}

/** FTUX: talud cohesivo-friccional moderado, sin NF ni sobrecargas → FoS holgado
 *  (CUMPLE) en la primera apertura. Mesh determinista 1000/25 (idéntica al golden,
 *  ver geotech/golden). Los valores numéricos se afinan al traer el motor (T2.1). */
export const slopeDefaults: SlopeInputs = {
  height: 5,
  angle: 30,
  waterTableDepth: null,
  strata: [
    { id: 1, type: 'cohesive', thickness: 20, gamma: 19, c: 10, phi: 28, Nspt: 0, su: 0, rflim: 0 },
  ],
  loads: [],
  method: 'bishop',
  slices: 25,
  iterations: 1000,
  situation: 'persistent',
  context: 'excavation',
};
