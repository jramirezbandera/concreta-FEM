// beamMNCapacity — flexión compuesta de sección de viga HA (fibras del motor
// de pilares con layout asimétrico). La FIDELIDAD del modelo de fibras la
// ancla test/calc/rcColumns.test.ts contra la referencia independiente de
// 4000 tiras (incluye el layout asimétrico y NEd con signo); aquí se ancla la
// CONSTRUCCIÓN de la sección de viga (convención de d, guards, unidades) y la
// física cualitativa de MRd(N).

import { describe, expect, it } from 'vitest';
import { beamMNCapacity, type BeamMNSection } from '../../lib/calculations/rcBeamMN.ts';
import { calcRCBeam } from '../../lib/calculations/rcBeams.ts';
import { rcBeamDefaults } from '../../data/defaults.ts';
import { getConcrete, getFyd } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';

// Sección espejo de los defaults del motor de vigas (vano): 300×500 C25 B500S,
// cover 30, cerco Ø8, tracción 4Ø16 abajo, compresión 2Ø12 arriba.
const SEC: BeamMNSection = {
  b: 300, h: 500, fck: 25, fyk: 500, cover: 30, stirrupDiam: 8,
  tensNBars: 4, tensBarDiam: 16,
  compNBars: 2, compBarDiam: 12,
};

const AsTot = 4 * getBarArea(16) + 2 * getBarArea(12);
const NtRd_hand = (AsTot * getFyd(500)) / 1000; // (804.2+226.2)·434.8 ≈ 448 kN

describe('beamMNCapacity — sección de viga con axil', () => {
  it('MRd(N≈0) casa con el MRd del motor de vigas (mismos armados, ±2%)', () => {
    // calcRCBeam usa solveAtULU (pivotes A/B); las fibras usan pivotes B/C sin
    // pivote A — en sección infraarmada difieren <2%.
    const engine = calcRCBeam(rcBeamDefaults); // vano = exactamente SEC
    expect(engine.valid).toBe(true);
    const r = beamMNCapacity(SEC, 0.001);
    expect(r.mode).toBe('ok');
    expect(Math.abs(r.MRd / engine.vano.MRd - 1)).toBeLessThan(0.02);
  });

  it('una compresión moderada SUBE MRd; la tracción lo BAJA', () => {
    const m0 = beamMNCapacity(SEC, 0.001).MRd;
    const mC = beamMNCapacity(SEC, 300).MRd;   // ~0.12·NRdmax
    const mT = beamMNCapacity(SEC, -200).MRd;  // ~0.45·NtRd
    expect(mC).toBeGreaterThan(m0);
    expect(mT).toBeLessThan(m0);
    expect(mT).toBeGreaterThan(0);
  });

  it('NtRd = As_tot·fyd a mano; NEd ≤ −NtRd ⇒ nt-max (nunca bisecar)', () => {
    const r = beamMNCapacity(SEC, -1.1 * NtRd_hand);
    expect(r.mode).toBe('nt-max');
    expect(r.NtRd).toBeCloseTo(NtRd_hand, 6);
    expect(r.MRd).toBe(0);
  });

  it('NEd ≥ NRd,max ⇒ nd-max (aplastamiento por compresión pura)', () => {
    const ok = beamMNCapacity(SEC, 100);
    const r = beamMNCapacity(SEC, 1.01 * ok.NRdMax);
    expect(r.mode).toBe('nd-max');
    // NRd,max a mano: fcd·(Ac−As) + min(fyd,400)·As (límite εc2 ⇒ σs=400).
    // fcd del MOTOR (getConcrete tabula 16.7, no 25/1.5): misma fuente.
    const fcd = getConcrete(25).fcd;
    const hand = (fcd * (300 * 500 - AsTot) + 400 * AsTot) / 1000;
    expect(ok.NRdMax).toBeCloseTo(hand, 6);
  });

  it('el layout asimétrico importa: invertir las caras cambia MRd', () => {
    const normal = beamMNCapacity(SEC, 0.001).MRd;
    const flipped = beamMNCapacity({
      ...SEC,
      tensNBars: SEC.compNBars, tensBarDiam: SEC.compBarDiam,
      compNBars: SEC.tensNBars, compBarDiam: SEC.tensBarDiam,
    }, 0.001).MRd;
    // Tracción en la cara de 2Ø12 ⇒ mucha menos capacidad.
    expect(flipped).toBeLessThan(0.5 * normal);
  });
});
