// Tablas de coeficientes de la "Guía para el proyecto y la ejecución de
// Micropilotes en obras de carretera" (Ministerio de Fomento, 2005).
//
// Cada constante incluye la referencia normativa de la tabla original.

// ExecutionType — categorías VERBATIM de la Guía Fomento 2005, Tabla 3.5
// (página 38). Antes el enum mezclaba conceptos (NF arriba con revestimiento
// no existe en la tabla); ahora 1:1 con la fuente oficial.
export type ExecutionType =
  | 'wt-above-no-casing-no-mud'    // NF arriba, sin revestir, sin lodos
  | 'wt-below-no-casing-no-mud'    // NF abajo, sin revestir, sin lodos
  | 'with-mud'                     // Cualquier terreno, perforado con lodos
  | 'casing-recoverable'           // Cualquier terreno, revestimiento recuperable
  | 'casing-lost';                 // Cualquier terreno, camisa perdida (in situ permanente)

// CorrosionEnv — categorías VERBATIM de la Guía Fomento 2005, Tabla 2.4
// (página 17). Los valores aquí asumen vida útil = 50 años (columna central
// de la matriz oficial). Para otras vidas útiles ver TODO C8.
export type CorrosionEnv =
  | 'natural-undisturbed'                  // Suelos naturales sin alterar
  | 'natural-contaminated-industrial'      // Suelos naturales contaminados o industriales
  | 'natural-aggressive-peat'              // Suelos naturales agresivos (turbas, ciénagas, etc.)
  | 'fill-non-aggressive-loose'            // Rellenos no agresivos sin compactar
  | 'fill-aggressive-loose';               // Rellenos agresivos sin compactar (cenizas, escorias, etc.)

export type ApplicationType  = 'new' | 'existing';
export type Duration         = 'short' | 'long';
export type EffortType       = 'compression' | 'tension' | 'compression+tension';
export type ConnectionType   = 'no-loss' | 'other';
export type SoilType         = 'granular' | 'cohesive';
/**
 * Material inyectado dentro del barreno. Guía Fomento §2.3.2 distingue
 * entre lechada (cement grout, fluido) y mortero (cement mortar, con árido
 * fino), con recubrimientos mínimos distintos (Tabla 2.3).
 */
export type GroutType        = 'lechada' | 'mortero';

// DesignLifeYears — columnas oficiales de la matriz de corrosión Tabla 2.4.
export type DesignLifeYears  = 5 | 25 | 50 | 75 | 100;

export interface OptionDef<K extends string | number> {
  key: K;
  label: string;
}

export const EXECUTION_OPTIONS: OptionDef<ExecutionType>[] = [
  { key: 'wt-above-no-casing-no-mud', label: 'NF sobre punta, sin revestir, sin lodos' },
  { key: 'wt-below-no-casing-no-mud', label: 'NF bajo punta, sin revestir, sin lodos'   },
  { key: 'with-mud',                  label: 'Cualquier terreno, perforado con lodos'  },
  { key: 'casing-recoverable',        label: 'Revestimiento recuperable'                },
  { key: 'casing-lost',               label: 'Camisa perdida (tubería in situ)'         },
];

export const CORROSION_OPTIONS: OptionDef<CorrosionEnv>[] = [
  { key: 'natural-undisturbed',             label: 'Suelos naturales sin alterar'              },
  { key: 'natural-contaminated-industrial', label: 'Suelos naturales contaminados / industriales' },
  { key: 'natural-aggressive-peat',         label: 'Suelos naturales agresivos (turbas, ciénagas)' },
  { key: 'fill-non-aggressive-loose',       label: 'Rellenos no agresivos sin compactar'       },
  { key: 'fill-aggressive-loose',           label: 'Rellenos agresivos sin compactar (cenizas, escorias)' },
];

export const DESIGN_LIFE_OPTIONS: OptionDef<DesignLifeYears>[] = [
  { key: 5,   label: '5 años (provisional)'              },
  { key: 25,  label: '25 años (estructura secundaria)'   },
  { key: 50,  label: '50 años (estructura normal)'       },
  { key: 75,  label: '75 años (estructura importante)'   },
  { key: 100, label: '100 años (estructura monumental)'  },
];

/**
 * Factor de ejecución Fe — Guía Fomento 2005, Tabla 3.5 (página 38).
 * Aplica al tope estructural reduciendo Nc_rd.
 *
 * Valores VERBATIM extraídos del PDF oficial:
 *   TIPO DE TERRENO Y DE PERFORACIÓN                                Fe
 *   Terreno con NF por encima de la punta, sin revestir, sin lodos  1,50
 *   Terreno con NF perm. bajo la punta, sin revestir, sin lodos     1,30
 *   Cualquier tipo de terreno perforado con lodos                   1,15
 *   Cualquier tipo de terreno perforado con revestimiento recuperable 1,05
 *   Micropilote con tubería in situ permanente (camisa perdida)     1,00
 *
 * Auditoría 2026-05-23: la tabla anterior tenía 'wt-above-with-casing'=1.30
 * y 'irs-igu'=1.00 que no se corresponden con la guía oficial. Refactor
 * completo + bump de schema version a '2' para descartar localStorage previo.
 */
export const FE_BY_EXECUTION: Record<ExecutionType, number> = {
  'wt-above-no-casing-no-mud': 1.50,
  'wt-below-no-casing-no-mud': 1.30,
  'with-mud':                  1.15,
  'casing-recoverable':        1.05,
  'casing-lost':               1.00,
};

/**
 * Reducción de espesor por corrosión re (mm) — Guía Fomento 2005, Tabla 2.4
 * (página 17). Matriz oficial completa (terreno × vida útil en años):
 *
 *   TIPO DE TERRENO                          5     25    50    75    100
 *   Suelos naturales sin alterar             0,00  0,30  0,60  0,90  1,20
 *   Suelos naturales contaminados/industr.   0,15  0,75  1,50  2,25  3,00
 *   Suelos naturales agresivos (turbas)      0,20  1,00  1,75  2,50  3,25
 *   Rellenos no agresivos sin compactar      0,18  0,70  1,20  1,70  2,20
 *   Rellenos agresivos sin compactar         0,50  2,00  3,25  4,50  5,75
 *
 *   Notas oficiales:
 *     1 Según UNE EN 14199.
 *     2 Rellenos compactados: valores pueden reducirse hasta la mitad.
 *     3 Valores @ 5 y 25 años basados en mediciones reales; resto extrapolación.
 */
export const RE_BY_CORROSION_MATRIX: Record<CorrosionEnv, Record<DesignLifeYears, number>> = {
  'natural-undisturbed':             { 5: 0.00, 25: 0.30, 50: 0.60, 75: 0.90, 100: 1.20 },
  'natural-contaminated-industrial': { 5: 0.15, 25: 0.75, 50: 1.50, 75: 2.25, 100: 3.00 },
  'natural-aggressive-peat':         { 5: 0.20, 25: 1.00, 50: 1.75, 75: 2.50, 100: 3.25 },
  'fill-non-aggressive-loose':       { 5: 0.18, 25: 0.70, 50: 1.20, 75: 1.70, 100: 2.20 },
  'fill-aggressive-loose':           { 5: 0.50, 25: 2.00, 50: 3.25, 75: 4.50, 100: 5.75 },
};

/** Devuelve re (mm) para un entorno y vida útil dados (Tabla 2.4 oficial). */
export function getCorrosionRe(env: CorrosionEnv, years: DesignLifeYears): number {
  return RE_BY_CORROSION_MATRIX[env][years];
}

/**
 * Factores parciales por aplicación — Guía Fomento Tabla 3.6.
 * Fc se aplica a la cohesión, Fφ al rozamiento. En cohesivos se usa además
 * Fcu = 0,9·Fc para acotar rfc por la resistencia al corte sin drenaje.
 */
export const FACTORS_BY_APPLICATION: Record<ApplicationType, { Fc: number; Fphi: number }> = {
  new:      { Fc: 1.5, Fphi: 1.5 },
  existing: { Fc: 1.2, Fphi: 1.2 },
};

/**
 * Factor de reología/duración Fr — Guía Fomento Tabla 3.7.
 * Mayora la rflim empírica para tener en cuenta la duración de la carga.
 */
export const FR_BY_DURATION: Record<Duration, number> = {
  short: 1.45,
  long:  1.65,
};

/**
 * Factor por tipo de unión Fu,c (sin pérdida vs otros) — Guía Fomento §3.6.
 * Reduce la contribución del acero del tubo en el tope estructural.
 */
export const FU_BY_CONNECTION: Record<ConnectionType, number> = {
  'no-loss': 1.0,
  'other':   0.5,
};

/**
 * Coeficiente μ del arranque por tracción en función del tipo de esfuerzo.
 * Compresión pura → 0; combinada → 0,6; tracción pura → 0,75.
 */
export const MU_BY_EFFORT: Record<EffortType, number> = {
  'compression':           0.00,
  'compression+tension':   0.60,
  'tension':               0.75,
};

/**
 * Garganta mínima de soldadura eg,min (mm) según espesor de chapa t (mm) —
 * Guía Fomento 2005, Tabla A-5.1 (apéndice 5, página ~120).
 *
 * Valores VERBATIM extraídos del PDF oficial:
 *   ESPESOR DE ARMADURA TUBULAR Y CHAPA (mm)    ESPESOR DE GARGANTA (mm)
 *   3 < t < 10                                   eg > 3
 *   10 ≤ t ≤ 20                                  eg > 4,5
 *
 * Nota oficial: "los espesores de la armadura tubular y de las chapas soldadas
 * habrán de resultar, en todo caso, mayores de tres milímetros (t > 3 mm)".
 *
 * Devuelve null si t está fuera del rango cubierto por la tabla (≤3 o >20),
 * para que el motor pueda invalidar el cálculo con un mensaje claro.
 *
 * Auditoría 2026-05-23: la escalera anterior (3/4.5/5/6 mm) era MÁS
 * conservadora que la guía pero no se correspondía con la tabla oficial.
 */
export function weldThroatMin(t: number): number | null {
  if (t <= 3 || t > 20) return null;       // fuera de tabla A-5.1
  if (t < 10) return 3;                    // 3 < t < 10
  return 4.5;                              // 10 ≤ t ≤ 20
}

/**
 * Coeficiente f para empotramiento ficticio Lef = 1,2·f·Le — Guía Fomento
 * 2005, Tabla 3.8 (página 38). Depende del cociente E₀/EL:
 *
 *   E₀/EL    f
 *   0        1,70
 *   0,5      1,25
 *   1        1,00
 *
 * Interpolación lineal entre puntos; valores fuera del rango se acotan
 * al extremo más cercano (la guía no extrapola).
 */
export function interpolateF(E0overEL: number): number {
  if (!isFinite(E0overEL) || E0overEL <= 0) return 1.70;
  if (E0overEL >= 1) return 1.00;
  if (E0overEL <= 0.5) {
    // [0, 0.5]: f va de 1.70 a 1.25
    return 1.70 + (1.25 - 1.70) * (E0overEL / 0.5);
  }
  // [0.5, 1]: f va de 1.25 a 1.00
  return 1.25 + (1.00 - 1.25) * ((E0overEL - 0.5) / 0.5);
}

/**
 * Coeficiente me para reducción del momento máximo en el empotramiento
 * ficticio — Guía Fomento 2005, Tabla 3.9 (página 41). Depende de L/Le:
 *
 *   L/Le    me
 *   0       0,45
 *   1       0,60
 *   2       0,70
 *   7       0,85
 *
 * Interpolación lineal entre puntos; por encima de L/Le=7 se mantiene
 * me=0.85 (la guía no extrapola; en micropilotes largos típicos L/Le ≫ 7).
 */
export function interpolateMe(LoverLe: number): number {
  if (!isFinite(LoverLe) || LoverLe <= 0) return 0.45;
  if (LoverLe >= 7) return 0.85;
  // Puntos: (0, 0.45), (1, 0.60), (2, 0.70), (7, 0.85)
  if (LoverLe <= 1) return 0.45 + (0.60 - 0.45) * LoverLe;
  if (LoverLe <= 2) return 0.60 + (0.70 - 0.60) * (LoverLe - 1);
  return 0.70 + (0.85 - 0.70) * ((LoverLe - 2) / (7 - 2));
}

export type SectionClass = 1 | 2 | 3 | 4;

/**
 * Clasificación de sección hueca circular según EN 1993-1-1 Tabla 5.2
 * (perfiles huecos a flexión y/o compresión).
 *
 *   d/t ≤ 50·ε²   →  Clase 1
 *   d/t ≤ 70·ε²   →  Clase 2
 *   d/t ≤ 90·ε²   →  Clase 3
 *   d/t > 90·ε²   →  Clase 4   (abolladura local antes de fy)
 *
 * con ε² = 235/fy (fy en N/mm²).
 *
 * El motor de Concreta llama a esta función sobre la sección POST-CORROSIÓN
 * (Ø exterior reducido por re, espesor de pared reducido por re), porque es
 * la geometría que resiste tras la vida útil de proyecto.
 *
 * Tubos PIRESA con S550 caen siempre en clase 1 (d/t ≤ 16 ≪ 21,3 = 50·ε²),
 * pero la clasificación es obligatoria por norma — y un futuro tubo de
 * mayor diámetro o un acero más resistente podría degradar la sección.
 *
 * Para clase 4 CE Anejo 22 §6.2.9.3 exige sección efectiva (Aeff/Weff). Concreta
 * no la implementa: cuando esta función devuelve 4, el motor invalida con
 * mensaje en lugar de calcular con Wel o Wpl.
 */
export function classifyCircularHollow(de: number, t: number, fy: number): SectionClass {
  // Entradas degeneradas → clase 4 conservador para que el motor invalide.
  if (!(de > 0 && t > 0 && fy > 0)) return 4;
  const eps2 = 235 / fy;
  const ratio = de / t;
  if (ratio <= 50 * eps2) return 1;
  if (ratio <= 70 * eps2) return 2;
  if (ratio <= 90 * eps2) return 3;
  return 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guía Fomento §2.3.2 — Tabla 2.3. RECUBRIMIENTOS MÍNIMOS r (mm)
// ─────────────────────────────────────────────────────────────────────────────
//                    LECHADA   MORTERO
//   Compresión          20       30
//   Tracción            25       35
//
// El recubrimiento es la distancia entre la armadura tubular y la pared del
// barreno (Dp − de)/2. La Guía exige que SIEMPRE se cumpla, incluso en
// secciones de empalme. Para compresión+tracción usamos el más restrictivo
// (= tracción) por seguridad.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recubrimiento mínimo r (mm) entre armadura tubular y pared del barreno
 * (Guía Fomento Tabla 2.3). Dos variables: tipo de inyectado y esfuerzo
 * dominante.
 *
 * Para esfuerzo `compression+tension` se usa el valor de tracción (más
 * restrictivo), igual que para las tablas de Fu/Fr en otros lookups.
 */
export function getMinStructuralCover(grout: GroutType, effort: EffortType): number {
  const isTraction = effort !== 'compression';   // tension OR compression+tension
  if (grout === 'mortero') {
    return isTraction ? 35 : 30;
  }
  return isTraction ? 25 : 20;
}

export const GROUT_OPTIONS: OptionDef<GroutType>[] = [
  { key: 'lechada', label: 'Lechada' },
  { key: 'mortero', label: 'Mortero' },
];
