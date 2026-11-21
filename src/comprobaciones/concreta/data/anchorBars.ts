// Anchor-plate rebar reference tables.
// Barras corrugadas según Código Estructural (RD 470/2021) Anejo 19 §3.2.
// Grados B400S / B500S, diámetros ISO.

export type RebarGrade = 'B400S' | 'B500S';
export type RebarDiam  = 8 | 10 | 12 | 16 | 20 | 25 | 32;

/** Anclaje en el extremo empotrado de la barra (transferencia al hormigón).
 *  Ortogonal a cómo la barra se une a la placa (ver TopConnection).
 *  - prolongacion_recta : barra recta, anclada por adherencia CE Anejo 19 §8.4.4.
 *  - patilla            : doblado 90° (α1=0.7 si cd > 3·φ, si no 1.0).
 *  - gancho             : doblado ≥135° (mismo α1 condicional).
 *  - arandela_tuerca    : cabeza ensanchada (arandela + tuerca) al fondo,
 *                         transfiere por aplastamiento — pull-out EN 1992-4 §7.2.1.5. */
export type BottomAnchorage =
  | 'prolongacion_recta'
  | 'patilla'
  | 'gancho'
  | 'arandela_tuerca';

/** Conexión de la barra con la placa base (detalle constructivo superior).
 *  Ortogonal al anclaje inferior. Ninguno de los dos valores modifica los
 *  checks estructurales (por decisión de proyecto, la soldadura barra-placa
 *  no se comprueba).
 *  - soldada         : barra soldada directamente al lado superior de la placa.
 *  - tuerca_arandela : barra pasante por taladro con tuerca + arandela arriba. */
export type TopConnection = 'soldada' | 'tuerca_arandela';

/** Yield (fyk) and ultimate (fuk) tensile strength per grade [MPa].
 *  CE Anejo 19 §3.2 (barras corrugadas). fuk = ft característico. */
export const REBAR_GRADES: Record<RebarGrade, { fyk: number; fuk: number }> = {
  B400S: { fyk: 400, fuk: 440 },
  B500S: { fyk: 500, fuk: 550 },
};

/** Nominal area As [mm²] per nominal diameter. As = π·d²/4. */
export const REBAR_AREAS: Record<RebarDiam, { As: number }> = {
  8:  { As:  50.27 },
  10: { As:  78.54 },
  12: { As: 113.10 },
  16: { As: 201.06 },
  20: { As: 314.16 },
  25: { As: 490.87 },
  32: { As: 804.25 },
};

export const AVAILABLE_REBAR_DIAMS:  RebarDiam[]  = [8, 10, 12, 16, 20, 25, 32];
export const AVAILABLE_REBAR_GRADES: RebarGrade[] = ['B400S', 'B500S'];

export const AVAILABLE_BOTTOM_ANCHORAGES: BottomAnchorage[] = [
  'prolongacion_recta',
  'patilla',
  'gancho',
  'arandela_tuerca',
];

export const AVAILABLE_TOP_CONNECTIONS: TopConnection[] = [
  'soldada',
  'tuerca_arandela',
];

export const BOTTOM_ANCHORAGE_LABEL: Record<BottomAnchorage, string> = {
  prolongacion_recta: 'Prolongación recta',
  patilla:            'Patilla 90°',
  gancho:             'Gancho ≥135°',
  arandela_tuerca:    'Arandela + tuerca (cabeza)',
};

export const TOP_CONNECTION_LABEL: Record<TopConnection, string> = {
  soldada:         'Soldada a placa',
  tuerca_arandela: 'Tuerca + arandela',
};

export function getRebarStrengths(grade: RebarGrade) {
  return REBAR_GRADES[grade];
}

export function getRebarAreas(diam: RebarDiam) {
  return REBAR_AREAS[diam];
}

/** Bearing area Ah [mm²] of a washer+nut head on the rebar.
 *  Ah = (OD² − d²)·π/4  (annular bearing area around the bar). */
export function washerBearingArea(diam: number, washerOd: number): number {
  const d = Math.max(0, diam);
  const D = Math.max(d, washerOd);
  return (D * D - d * d) * Math.PI / 4;
}

/** Anchorage length factor α1 per CE Anejo 19 §8.4.4 Tab 8.2 for straight / hook.
 *  Rectas → α1=1.0. Patilla/gancho en tracción → α1=0.7 sólo si cd > 3·φ,
 *  en otro caso α1=1.0.
 *
 *  cd [mm] es la menor de: recubrimiento lateral y semi-separación entre
 *  barras (ver EC2 Fig. 8.3). φ es el diámetro nominal de la barra [mm]. */
export function anchorageAlpha1(kind: BottomAnchorage, cd: number, diam: number): number {
  switch (kind) {
    case 'patilla':
    case 'gancho':
      return cd > 3 * diam ? 0.7 : 1.0;
    default:
      return 1.0;
  }
}

/** Anchorage length factor α2 per CE Anejo 19 §8.4.4 / EC2 §8.4.4 Tab 8.2.
 *  Reducción continua por recubrimiento:
 *    α2 = 1 − 0.15·(cd − φ)/φ,   con 0.7 ≤ α2 ≤ 1.0
 *  · cd = φ          → α2 = 1.00 (sin reducción)
 *  · cd = 3·φ        → α2 = 0.70 (cap inferior)
 *  · cd entre medias → reducción lineal
 *  Más recubrimiento = mejor confinamiento = menos longitud de anclaje
 *  necesaria. La pieza H3 de la auditoría: el código previo solo aplicaba
 *  α1, dejando α2-α5 implícitamente a 1.0 (conservador pero divergente). */
export function anchorageAlpha2(cd: number, diam: number): number {
  const ratio = (cd - diam) / Math.max(diam, 1e-6);
  return Math.max(0.7, Math.min(1.0, 1 - 0.15 * ratio));
}

/** Does this bottom anchorage transfer load by bond (needs lbd per CE Anejo 19 §8.4.4)? */
export function needsBondAnchorage(kind: BottomAnchorage): boolean {
  return kind === 'prolongacion_recta' || kind === 'patilla' || kind === 'gancho';
}

/** Does this bottom anchorage transfer load by bearing (pull-out EN 1992-4 §7.2.1.5)? */
export function needsPullout(kind: BottomAnchorage): boolean {
  return kind === 'arandela_tuerca';
}
