// Cuantía mínima del CE, Anejo 19 §9.2.1.1 (9.1) — la fuente única de vigas,
// forjados, zapatas, muros, encepados y punzonamiento (2026-09-25).
//
// El CE fija As,min = W/z · fctm,fl/fyd con z = 0,8h y fctm,fl de la (3.23);
// no adopta el 0,26·fctm/fyk·b·d del Eurocódigo ni conserva el 2,8 ‰ de la
// tabla 42.3.5 de la EHE-08. Los oráculos van a mano, con la fctm tabulada.

import { describe, expect, it } from 'vitest';
import {
  asMinRectangular, asMinTraccion, fctmFl, seccionT, CUANTIA_MAXIMA,
} from '../../lib/calculations/cuantiaMinima.ts';

const FYD = 500 / 1.15;   // B500S

describe('fctm,fl — CE Anejo 19 §3.1.8 (3.23)', () => {
  it('crece en cantos pequeños y no baja de fctm a partir de 600 mm', () => {
    expect(fctmFl(2.56, 200)).toBeCloseTo(1.4 * 2.56, 6);
    expect(fctmFl(2.56, 500)).toBeCloseTo(1.1 * 2.56, 6);
    expect(fctmFl(2.56, 600)).toBeCloseTo(2.56, 6);
    expect(fctmFl(2.56, 1200)).toBeCloseTo(2.56, 6);
  });
});

describe('As,min rectangular — CE Anejo 19 §9.2.1.1 (9.1)', () => {
  it('viga 300×500 HA-25: 202 mm² (el 2,8 ‰ de la EHE daba 420)', () => {
    // W/z = 300·500²/6 / 400 = 31 250 mm²; fctm,fl = 1,1·2,56 = 2,816
    expect(asMinRectangular(300, 500, 2.56, FYD)).toBeCloseTo(31250 * 2.816 / FYD, 6);
    expect(asMinRectangular(300, 500, 2.56, FYD)).toBeCloseTo(202.4, 1);
  });

  it('losa de 20 cm HA-25: 344 mm²/m (el Eurocódigo daba 227 con d = 170)', () => {
    // W/z = 1000·200/4,8 = 41 667 mm²; fctm,fl = 1,4·2,56 = 3,584
    expect(asMinRectangular(1000, 200, 2.56, FYD)).toBeCloseTo(41666.67 * 3.584 / FYD, 3);
    expect(asMinRectangular(1000, 200, 2.56, FYD)).toBeCloseTo(343.5, 1);
  });

  it('es la general con W = b·h²/6', () => {
    expect(asMinTraccion(300 * 500 * 500 / 6, 500, 2.56, FYD)).toBeCloseTo(asMinRectangular(300, 500, 2.56, FYD), 9);
  });

  it('entrada degenerada → 0, no NaN', () => {
    expect(asMinTraccion(0, 500, 2.56, FYD)).toBe(0);
    expect(asMinTraccion(1e6, 0, 2.56, FYD)).toBe(0);
  });

  it('As,max = 0,04·Ac (§9.2.1.1(3))', () => {
    expect(CUANTIA_MAXIMA).toBe(0.04);
  });
});

describe('Sección bruta en T', () => {
  it('nervio del forjado por defecto (700 / 50 / 120 / 350): A, fibra neutra e inercia a mano', () => {
    // Ala 700×50 → 35 000 mm² a 25; alma 120×300 → 36 000 mm² a 200.
    // ySup = (35 000·25 + 36 000·200)/71 000 = 113,73
    // I = 700·50³/12 + 35 000·88,73² + 120·300³/12 + 36 000·86,27² = 8,208·10⁸
    const t = seccionT({ bf: 700, hf: 50, bw: 120, h: 350 });
    expect(t.A).toBe(71000);
    expect(8.2078e8 / t.Wsup).toBeCloseTo(113.73, 1);
    expect(t.Winf).toBeCloseTo(8.2078e8 / (350 - 113.73), -3);
    // As,min: vano (tracciona abajo) 91 mm², apoyo (ala en tracción) 190 mm²
    expect(asMinTraccion(t.Winf, 350, 2.56, FYD)).toBeCloseTo(91.3, 1);
    expect(asMinTraccion(t.Wsup, 350, 2.56, FYD)).toBeCloseTo(189.7, 1);
  });

  it('con el ala del ancho del alma es el rectángulo', () => {
    const t = seccionT({ bf: 120, hf: 50, bw: 120, h: 350 });
    const W = 120 * 350 * 350 / 6;
    expect(t.Wsup).toBeCloseTo(W, 3);
    expect(t.Winf).toBeCloseTo(W, 3);
  });
});
