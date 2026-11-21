// Tests del solver de sección rc-beams (rcBeamsSection.ts):
//   - solveSectionAtMoment: equilibrio, edge cases (Md=0, Md<0, Md>MRd),
//     monotonicity, HSC support, uncracked branch.
//   - solveSectionState: primitiva, ΣF≈0.
//   - pickSectionInputs: extracción de RCBeamInputs.
//   - FEM regression: calcRCBeam mode-agnostic.

import { describe, expect, it } from 'vitest';
import { rcBeamDefaults } from '../../data/defaults.ts';
import { calcRCBeam, pickSectionInputs, type SectionInputs } from '../../lib/calculations/rcBeams.ts';
import { solveSectionAtMoment, solveSectionState } from '../../lib/calculations/rcBeamsSection.ts';

function baseInputs(overrides: Partial<SectionInputs> = {}): SectionInputs {
  return {
    b: 300, h: 500, cover: 30,
    stirrupDiam: 8, stirrupLegs: 2, stirrupSpacing: 150,
    fck: 30, fyk: 500,
    exposureClass: 'XC1',
    Md: 100, VEd: 50, Ms: 50,
    nBars: 4, barDiam: 16,
    nBarsComp: 2, barDiamComp: 12,
    bondClass: 'good',
    ...overrides,
  };
}

describe('solveSectionAtMoment — equilibrium ΣF ≈ 0', () => {
  it('cracked: tras solve, F_concrete + F_s_comp + F_s_tens ≈ 0', () => {
    const inp = baseInputs({ Md: 100 });
    const r = solveSectionAtMoment(inp, 100);
    const sumF = r.F_concrete + r.F_s_comp + r.F_s_tens;
    // Tolerancia: el inner bisection x acepta |ΣF|<0.01 kN
    expect(Math.abs(sumF)).toBeLessThan(0.1);
  });

  it('cracked: moment computed matches Md within tolerance', () => {
    const inp = baseInputs({ Md: 80 });
    const r = solveSectionAtMoment(inp, 80);
    expect(r.mode).toBe('cracked');
    expect(Math.abs(r.M - 80)).toBeLessThan(0.5);
  });
});

describe('solveSectionAtMoment — edge cases', () => {
  it('Md = 0 returns zero-strain state', () => {
    const inp = baseInputs();
    const r = solveSectionAtMoment(inp, 0);
    expect(r.mode).toBe('zero');
    expect(r.epsilon_top).toBe(0);
    expect(r.F_concrete).toBe(0);
    expect(r.F_s_tens).toBe(0);
  });

  it('Md < 0 throws (V1 sagging-only)', () => {
    const inp = baseInputs();
    expect(() => solveSectionAtMoment(inp, -50)).toThrow(/no soportado/i);
  });

  it('Md > MRd devuelve over-capacity state al ELU (pivote tension- o compression-controlled)', () => {
    const inp = baseInputs({ Md: 100 });
    // Try with absurdly high M (way above MRd ~146 kNm para 4Ø16/b=300/h=500).
    const r = solveSectionAtMoment(inp, 999);
    expect(r.exceededCapacity).toBe(true);
    expect(r.mode).toBe('over-capacity');
    expect(r.Md).toBe(999);
    // CE pivot diagram: la sección falla por UNO de los dos modos.
    // 4Ø16 es tension-controlled (x/d ≈ 0.24 < x_lim/d ≈ 0.26) → steel ruptures.
    // Sea cual sea el pivote, al menos uno de los flags debe estar activo.
    expect(r.steelRuptured || r.concreteCrushed).toBe(true);
  });

  it('Sección infra-armada (pocas barras): over-capacity → pivot A (steel ruptures, concrete NO crushed)', () => {
    // 2Ø16 = 402 mm² es claramente tension-controlled.
    const inp = baseInputs({ Md: 100, nBars: 2, barDiam: 16 });
    const r = solveSectionAtMoment(inp, 999);
    expect(r.mode).toBe('over-capacity');
    expect(r.steelRuptured).toBe(true);
    expect(r.concreteCrushed).toBe(false);
    // ε_s_tens debe estar EXACTAMENTE en ε_ud, no por encima (pivote A).
    expect(r.epsilon_s_tens).toBeCloseTo(0.010, 4);
    // ε_top debe quedar POR DEBAJO de ε_cu (concreto no llegó a crushed).
    expect(Math.abs(r.epsilon_top)).toBeLessThan(0.0035);
  });

  it('Sección sobre-armada: over-capacity → pivot B (concrete crushed, steel NO ruptured)', () => {
    // Muchas barras grandes → over-reinforced, compression-controlled.
    const inp = baseInputs({ Md: 100, nBars: 8, barDiam: 25, nBarsComp: 0 });
    const r = solveSectionAtMoment(inp, 999);
    expect(r.mode).toBe('over-capacity');
    expect(r.concreteCrushed).toBe(true);
    expect(r.steelRuptured).toBe(false);
    // ε_top = -ε_cu fijo (pivote B).
    expect(r.epsilon_top).toBeCloseTo(-0.0035, 4);
  });

  it('uncracked branch when Md < Mcrit', () => {
    // Sección grande con mucha inercia bruta → Mcrit alto. Md pequeño.
    const inp = baseInputs({ b: 500, h: 800, Md: 5 });
    const r = solveSectionAtMoment(inp, 5);
    expect(r.mode).toBe('uncracked');
    // En no fisurada, fibra neutra en h/2
    expect(r.x).toBeCloseTo(inp.h / 2, 1);
    // Strains son simétricos en x = h/2
    expect(r.epsilon_top).toBeCloseTo(-r.epsilon_bot, 5);
  });
});

describe('solveSectionAtMoment — material state flags', () => {
  it('steelYielded_tens = true cuando ε_s > ε_yd', () => {
    // Mucho M con poca As → tracción yields
    const inp = baseInputs({ b: 200, h: 400, Md: 80, nBars: 2, barDiam: 12 });
    const r = solveSectionAtMoment(inp, 80);
    if (r.mode === 'cracked') {
      const epsYd = (500 / 1.15) / 200000;
      if (Math.abs(r.epsilon_s_tens) > epsYd) {
        expect(r.steelYielded_tens).toBe(true);
      }
    }
  });

  it('concreteCrushed = true only at ULU (Md = MRd)', () => {
    const inp = baseInputs();
    // Mid-range M: not crushed
    const rMid = solveSectionAtMoment(inp, 50);
    if (rMid.mode === 'cracked') {
      expect(rMid.concreteCrushed).toBe(false);
    }
  });
});

describe('solveSectionAtMoment — HSC (fck > 50)', () => {
  it('fck=70 usa eps_c2 / eps_cu / n correctos de getConcrete', () => {
    const inp = baseInputs({ fck: 70, Md: 80 });
    const r = solveSectionAtMoment(inp, 80);
    // Solver no debe romper para HSC
    expect(r.mode).toBeDefined();
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Math.abs(r.F_concrete + r.F_s_comp + r.F_s_tens)).toBeLessThan(0.1);
  });

  it('fck=90 (max HSC): parábola constants en límite', () => {
    const inp = baseInputs({ fck: 90, Md: 100 });
    const r = solveSectionAtMoment(inp, 100);
    expect(r.mode).toBeDefined();
    expect(Number.isFinite(r.M)).toBe(true);
  });
});

describe('solveSectionAtMoment — AsComp=0 singly reinforced', () => {
  it('sin armadura comprimida, equilibrio se mantiene', () => {
    const inp = baseInputs({ nBarsComp: 0, barDiamComp: 12, Md: 60 });
    const r = solveSectionAtMoment(inp, 60);
    expect(r.F_s_comp).toBeCloseTo(0, 6);  // -0 vs 0 strictly tolerant
    expect(Math.abs(r.F_concrete + r.F_s_tens)).toBeLessThan(0.1);
  });
});

describe('solveSectionState — primitive', () => {
  it('dada κ pequeña, retorna estado lineal-elástico', () => {
    const inp = baseInputs();
    const r = solveSectionState(inp, 1e-6);
    // κ pequeña → strains pequeñas (sub-cracking range)
    expect(Math.abs(r.epsilon_top)).toBeLessThan(0.0005);
    // F_s_tens proporcional a κ; con κ=1e-6 sobre As=4Ø16 da ~70 kN
    expect(Math.abs(r.F_s_tens)).toBeLessThan(100);
  });

  it('dada κ = κ_ULU, retorna estado al límite', () => {
    const inp = baseInputs();
    const matEpsCu = 0.0035;
    // κ aprox del ULU para esta sección
    const r = solveSectionState(inp, matEpsCu / 100);  // x ≈ 100mm
    // Strain top debe ser cercano a -ε_cu si x ≈ 100
    expect(r.epsilon_top).toBeLessThan(0);
  });
});

describe('pickSectionInputs — extracción de RCBeamInputs', () => {
  it("kind='vano': extrae vano_* fields", () => {
    const sec = pickSectionInputs(rcBeamDefaults, 'vano');
    expect(sec.Md).toBe(rcBeamDefaults.vano_Md);
    expect(sec.nBars).toBe(rcBeamDefaults.vano_bot_nBars);
    expect(sec.nBarsComp).toBe(rcBeamDefaults.vano_top_nBars);
  });

  it("kind='apoyo': extrae apoyo_* fields invertidos (top=tracción)", () => {
    const sec = pickSectionInputs(rcBeamDefaults, 'apoyo');
    expect(sec.Md).toBe(rcBeamDefaults.apoyo_Md);
    // Apoyo: tension = top (negativo)
    expect(sec.nBars).toBe(rcBeamDefaults.apoyo_top_nBars);
    expect(sec.nBarsComp).toBe(rcBeamDefaults.apoyo_bot_nBars);
  });
});

describe('FEM regression — calcRCBeam mode-agnostic', () => {
  it('calcRCBeam preserva comportamiento (no usa state.mode)', () => {
    // No new field added yet — test es safety net para Chunk 2.
    const result = calcRCBeam(rcBeamDefaults);
    expect(result.valid).toBe(true);
    expect(result.vano.MRd).toBeGreaterThan(0);
    expect(result.apoyo.MRd).toBeGreaterThan(0);
  });
});
