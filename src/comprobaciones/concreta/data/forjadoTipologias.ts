// Typical Spanish forjado reticular tipologías (canto + capa de compresión).
// h = total depth (mm), hFlange = capa de compresión (mm),
// bWeb = nervio width (mm), intereje = rib spacing c/c (mm).

import { forjadosDefaults, type ForjadosInputs, type ForjadosVariant } from './defaults.ts';

export type TipologiaKey = '25+5' | '30+5' | '35+5' | '40+5' | '35+10' | 'custom';

export interface TipologiaPreset {
  key: TipologiaKey;
  label: string;
  h: number;
  hFlange: number;
  bWeb: number;
  intereje: number;
}

export const TIPOLOGIAS: TipologiaPreset[] = [
  { key: '25+5',  label: '25+5 (h=30, capa=5)',   h: 300, hFlange: 50,  bWeb: 120, intereje: 820 },
  { key: '30+5',  label: '30+5 (h=35, capa=5)',   h: 350, hFlange: 50,  bWeb: 120, intereje: 820 },
  { key: '35+5',  label: '35+5 (h=40, capa=5)',   h: 400, hFlange: 50,  bWeb: 120, intereje: 820 },
  { key: '40+5',  label: '40+5 (h=45, capa=5)',   h: 450, hFlange: 50,  bWeb: 120, intereje: 820 },
  { key: '35+10', label: '35+10 (h=45, capa=10)', h: 450, hFlange: 100, bWeb: 120, intereje: 820 },
];

export function getTipologia(key: TipologiaKey): TipologiaPreset | undefined {
  return TIPOLOGIAS.find((t) => t.key === key);
}

/**
 * Patch de estado para elegir una tipología reticular: la clave más la geometría
 * del preset (h, capa de compresión, nervio e intereje), que la UI deja en
 * `readOnly` mientras la tipología no sea 'custom'. Con 'custom' solo se escribe
 * la clave: la geometría se desbloquea y la conserva el usuario.
 *
 * Es la ÚNICA fuente de verdad del cambio de tipología: lo consumen el selector
 * del panel y el apply del asistente IA. Un `setField('tipologia', …)` suelto
 * dejaría la geometría del preset anterior.
 */
export function tipologiaPatch(key: TipologiaKey): Partial<ForjadosInputs> {
  const patch: Partial<ForjadosInputs> = { tipologia: key };
  const t = getTipologia(key);
  if (t !== undefined) {
    patch.h        = t.h;
    patch.hFlange  = t.hFlange;
    patch.bWeb     = t.bWeb;
    patch.intereje = t.intereje;
  }
  return patch;
}

export type TipoVano = 'biapoyado' | 'continuo-extremo' | 'continuo-interior' | 'voladizo';

export interface TipoVanoDef {
  key: TipoVano;
  label: string;
  l0Factor: number;  // L0 = l0Factor · L
}

// L0 = distancia entre puntos de momento nulo, para el ancho eficaz del ala (CE Anejo 19
// §5.3.2.1, fig. 5.2): vano extremo 0,85·L y vano interior 0,70·L salen de ahí.
//
// OJO con el voladizo (cotejo 2026-09-25): el 2·L NO es del CE/EC2, que da
// l0 = 0,15·l2 + l3 con l2 el vano contiguo (típicamente 1,3–1,5·L). Los 2·L vienen de
// la EHE-08 (art. 18.2.1), que trata el voladizo como media viga biapoyada. Se conserva
// porque cambiarlo pide l2, que el módulo no pregunta; sólo entra en el ancho eficaz
// del vano, que casi siempre lo acota el intereje. Si algún día se pide l2, poner la
// expresión del CE.
export const TIPOS_VANO: TipoVanoDef[] = [
  { key: 'biapoyado',         label: 'Biapoyado (L0 = L)',              l0Factor: 1.0  },
  { key: 'continuo-extremo',  label: 'Continuo extremo (L0 = 0.85 L)',  l0Factor: 0.85 },
  { key: 'continuo-interior', label: 'Continuo interior (L0 = 0.70 L)', l0Factor: 0.70 },
  { key: 'voladizo',          label: 'Voladizo (L0 = 2 L)',             l0Factor: 2.0  },
];

export function getL0Factor(tipo: TipoVano): number {
  const found = TIPOS_VANO.find((t) => t.key === tipo);
  return found ? found.l0Factor : 0.70;
}

// ── Cambio de variante (reticular ↔ maciza) ──────────────────────────────────
// El cambio de variante NO es un setField suelto: los sets de armado de cada
// variante son disjuntos (reticular = paquetes n×Ø; maciza = parrillas Ø/s) y
// dejar valores del otro modo produce estados confusos. Este patch es la ÚNICA
// fuente de verdad del cambio: lo consumen el conmutador de la UI
// (handleVariantSwitch en features/forjados) y el apply del asistente IA.

/** Campos de armado que se reinician a defaults al cambiar de variante. */
const ARMADO_FIELDS = [
  // Reticular: montaje base + refuerzos zonales (n × Ø)
  'base_sup_nBars', 'base_sup_barDiam',
  'base_inf_nBars', 'base_inf_barDiam',
  'refuerzo_vano_inf_nBars',  'refuerzo_vano_inf_barDiam',
  'refuerzo_apoyo_sup_nBars', 'refuerzo_apoyo_sup_barDiam',
  // Maciza: parrilla base + refuerzos zonales (Ø / s)
  'base_sup_phi_mac', 'base_sup_s_mac',
  'base_inf_phi_mac', 'base_inf_s_mac',
  'refuerzo_vano_inf_phi_mac',  'refuerzo_vano_inf_s_mac',
  'refuerzo_apoyo_sup_phi_mac', 'refuerzo_apoyo_sup_s_mac',
] as const satisfies readonly (keyof ForjadosInputs)[];

/**
 * Patch de estado para cambiar de variante. Devuelve los campos a escribir
 * (empezando por `variant`): armado a defaults y, si la variante nueva es
 * reticular, también la geometría del preset de tipología por defecto.
 * Si `next` coincide con la variante vigente devuelve `{}` (sin cambios).
 * El canto `h` se conserva al pasar a maciza (comportamiento histórico).
 */
export function variantSwitchPatch(
  current: ForjadosInputs,
  next: ForjadosVariant,
): Partial<ForjadosInputs> {
  if (next === current.variant) return {};
  const patch: Partial<ForjadosInputs> = { variant: next };
  for (const f of ARMADO_FIELDS) {
    (patch as Record<string, unknown>)[f] = forjadosDefaults[f];
  }
  if (next === 'reticular') {
    patch.tipologia = forjadosDefaults.tipologia;
    patch.h        = forjadosDefaults.h;
    patch.hFlange  = forjadosDefaults.hFlange;
    patch.bWeb     = forjadosDefaults.bWeb;
    patch.intereje = forjadosDefaults.intereje;
  }
  return patch;
}
