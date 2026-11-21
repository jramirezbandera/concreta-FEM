// crackedDeflectionFactor — factor de flecha diferida fisurada (§7.4.3).
// Derivaciones a mano en cada caso; la coherencia con la base E del SOLVER
// (rcElasticModulusMPa, no el Ecm tabulado) es el contrato central: el caso
// no fisurado debe dar k = 1+φef EXACTO (los Ig cancelan).

import { describe, expect, it } from 'vitest';
import { crackedDeflectionFactor } from '../../lib/calculations/crackedDeflection.ts';
import { rcElasticModulusMPa } from '../../lib/frame-core/sections.ts';
import { getConcrete, Es } from '../../data/materials.ts';

// Sección de referencia: 300×500 C25, As = 4Ø16 = 804.2 mm², d = 454 mm.
const P = { b: 300, h: 500, fck: 25, As: 804.2, d: 454, phiEf: 2.0 };

describe('crackedDeflectionFactor', () => {
  it('Mcr a mano: fctm·b·h²/6 = 2.56·300·500²/6 = 32.0 kN·m', () => {
    const r = crackedDeflectionFactor({ ...P, Mcp: 10 });
    const hand = (getConcrete(25).fctm * 300 * 500 * 500) / 6 / 1e6;
    expect(r.Mcr).toBeCloseTo(hand, 10);
  });

  it('no fisurada (Mcp ≤ Mcr): k = 1 + φef EXACTO (ζ = 0, los Ig cancelan)', () => {
    const r = crackedDeflectionFactor({ ...P, Mcp: 10 });
    expect(r.zeta).toBe(0);
    expect(r.k).toBeCloseTo(3.0, 10);
  });

  it('fisurada: ζ y k a mano (Mcp = 2·Mcr ⇒ ζ = 0.875)', () => {
    const base = crackedDeflectionFactor({ ...P, Mcp: 10 });
    const Mcp = 2 * base.Mcr;
    const r = crackedDeflectionFactor({ ...P, Mcp });
    // ζ = 1 − 0.5·(Mcr/Mcp)² = 1 − 0.5·0.25 = 0.875.
    expect(r.zeta).toBeCloseTo(0.875, 10);

    // Réplica independiente del estado II homogeneizado con fluencia:
    const EcBase = rcElasticModulusMPa(25);
    const EcEff = EcBase / 3;
    const n = Es / EcEff;
    // 0.5·b·x² + n·As·x − n·As·d = 0
    const A = 0.5 * 300, B = n * P.As, C = -n * P.As * P.d;
    const x = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    const III = (300 * x ** 3) / 3 + n * P.As * (P.d - x) ** 2;
    const Ig = (300 * 500 ** 3) / 12;
    const kHand = EcBase * Ig * (0.875 / (EcEff * III) + 0.125 / (EcEff * Ig));
    expect(r.k).toBeCloseTo(kHand, 8);
    // Sanidad: entre el techo no fisurado diferido (3) y el estado II puro.
    expect(r.k).toBeGreaterThan(3);
    expect(r.k).toBeLessThan((EcBase * Ig) / (EcEff * III));
  });

  it('k es monótono creciente con Mcp (más fisuración ⇒ más flecha)', () => {
    const base = crackedDeflectionFactor({ ...P, Mcp: 10 });
    const ks = [1.01, 1.5, 2, 4, 8].map((f) => crackedDeflectionFactor({ ...P, Mcp: f * base.Mcr }).k);
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeGreaterThan(ks[i - 1]);
  });

  it('fisurada sin armadura de tracción ⇒ k = ∞ (el caller lo trata como fail)', () => {
    const base = crackedDeflectionFactor({ ...P, Mcp: 10 });
    const r = crackedDeflectionFactor({ ...P, As: 0, Mcp: 2 * base.Mcr });
    expect(r.k).toBe(Infinity);
  });
});
