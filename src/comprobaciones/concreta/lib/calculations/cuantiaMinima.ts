// Cuantías mínima y máxima de la armadura longitudinal — CE Anejo 19 §9.2.1.1
// (BOE-A-2021-13681, página 761 del PDF). Fuente única para vigas, forjados,
// zapatas, muros, encepados y punzonamiento.
//
// El CE NO adopta el valor recomendado del Eurocódigo (0,26·fctm/fyk·bt·d, no
// menor que 0,0013·bt·d): fija su propia expresión (9.1), que es la cuantía
// mecánica mínima de la EHE-08 (art. 42.3.2), y no conserva la tabla 42.3.5 de
// cuantías geométricas mínimas. Hasta el 2026-09-25 vigas y nervios usaban el
// 2,8 ‰ de esa tabla (el doble de lo que pide el CE en una viga 30×50) y losas,
// zapatas, muros, encepados y punzonamiento el valor del Eurocódigo (un tercio
// menos en una losa de 20 cm), todos citando este apartado.
//
//   As,min = (W / z) · (fctm,fl / fyd)               (9.1)
//     z   brazo mecánico en ELU, «de forma aproximada z = 0,8h»
//     W   módulo resistente de la sección BRUTA relativo a la fibra más
//         traccionada
//   fctm,fl = max{(1,6 − h/1000)·fctm ; fctm}         (3.23, §3.1.8)
//   As,max = 0,04·Ac, de tracción o de compresión, fuera de solapes (§9.2.1.1(3))
//
// La alternativa del mismo apartado —1,2 veces el área necesaria en ELU para
// elementos secundarios con riesgo de rotura frágil admisible— no se aplica: es
// una decisión del proyectista sobre el elemento, no un dato de la sección.
//
// Unidades: mm, N/mm², mm² (W en mm³).

/** Cuantía máxima de tracción o de compresión, sobre Ac (§9.2.1.1(3)). */
export const CUANTIA_MAXIMA = 0.04;

/** Brazo mecánico aproximado del §9.2.1.1: z = 0,8·h. */
export const BRAZO_RELATIVO = 0.8;

/** Resistencia media a flexotracción, CE Anejo 19 §3.1.8 (3.23). h en mm. */
export function fctmFl(fctm: number, h: number): number {
  return Math.max((1.6 - h / 1000) * fctm, fctm);
}

/** CE Anejo 19 §9.2.1.1 (9.1): As,min = W/z · fctm,fl/fyd, con z = 0,8·h. */
export function asMinTraccion(W: number, h: number, fctm: number, fyd: number): number {
  if (!(W > 0) || !(h > 0) || !(fyd > 0)) return 0;
  return (W / (BRAZO_RELATIVO * h)) * (fctmFl(fctm, h) / fyd);
}

/** (9.1) para una sección rectangular b × h (W = b·h²/6, igual en las dos caras). */
export function asMinRectangular(b: number, h: number, fctm: number, fyd: number): number {
  return asMinTraccion((b * h * h) / 6, h, fctm, fyd);
}

export interface SeccionT {
  bf: number;   // ancho del ala (cabeza)
  hf: number;   // espesor del ala
  bw: number;   // ancho del alma (nervio)
  h: number;    // canto total
}

/**
 * Área y módulos resistentes de la sección bruta en T (ala arriba), a la fibra
 * superior y a la inferior. Con bf ≤ bw o hf ≥ h degenera en el rectángulo.
 */
export function seccionT({ bf, hf, bw, h }: SeccionT): { A: number; Wsup: number; Winf: number } {
  const alaAncho = Math.max(bf, bw);
  const alaCanto = Math.min(Math.max(hf, 0), h);
  const Aala = alaAncho * alaCanto;
  const Aalma = bw * (h - alaCanto);
  const A = Aala + Aalma;
  const ySup = (Aala * alaCanto / 2 + Aalma * (alaCanto + (h - alaCanto) / 2)) / A;
  const I = (alaAncho * alaCanto ** 3) / 12 + Aala * (ySup - alaCanto / 2) ** 2
    + (bw * (h - alaCanto) ** 3) / 12 + Aalma * (alaCanto + (h - alaCanto) / 2 - ySup) ** 2;
  return { A, Wsup: I / ySup, Winf: I / (h - ySup) };
}
