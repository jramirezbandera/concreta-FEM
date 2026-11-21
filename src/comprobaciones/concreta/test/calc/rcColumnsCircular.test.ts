// Tests for the CIRCULAR RC column engine (true fork — calcRCColumnCirc).
// Anejo 19 / EC2. The rectangular suite (rcColumns.test.ts) stays untouched;
// here we cover the circular-only paths: parabola-rectangle fiber concrete
// (pivots B/C — replaced the Whitney block after the 2026-07-01 audit found it
// up to +32% unsafe at high axial), worst ring orientation θ0*, resultant
// 2nd-order eccentricity (no phantom √2 — decision T2), chord bar spacing,
// checks, guards and the single N-M envelope.

import { describe, it, expect } from 'vitest';
import {
  calcRCColumn,
  buildColumnInteraction,
  NBARS_MIN_CIRC,
} from '../../lib/calculations/rcColumns.ts';
import { rcColumnDefaults } from '../../data/defaults.ts';
import { getConcrete, getFyd, Es } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';

const D0 = rcColumnDefaults;
function circ(overrides: Partial<typeof D0> = {}): typeof D0 {
  return { ...D0, sectionType: 'circular', ...overrides } as typeof D0;
}

const COVER = 30, STIRRUP = 6;

// ── Referencia independiente ─────────────────────────────────────────────────
// Integración por fibras (4000 tiras, ~17× las del motor) del diagrama
// parábola-rectángulo con pivotes B/C y descuento del hormigón desplazado.
// Implementación separada del motor: mismo modelo normativo, distinto código.
const EPS_C2 = 0.002, EPS_CU = 0.0035, N_EXP = 2;

function strainRef(y: number, x: number, D: number): number {
  if (x <= D) return EPS_CU * (x - y) / x;                 // pivote B
  const yC = D * (1 - EPS_C2 / EPS_CU);                    // = 3D/7
  return EPS_C2 * (x - y) / (x - yC);                      // pivote C
}

function sigmaRef(eps: number, fcd: number): number {
  if (eps <= 0) return 0;
  if (eps >= EPS_C2) return fcd;
  return fcd * (1 - Math.pow(1 - eps / EPS_C2, N_EXP));
}

interface Bar { y: number; area: number }

function ringRef(D: number, n: number, phi: number, theta0 = 0): Bar[] {
  const R = D / 2;
  const r_s = (D - 2 * COVER - 2 * STIRRUP - phi) / 2;
  const A = getBarArea(phi);
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) out.push({ y: R - r_s * Math.cos(theta0 + 2 * Math.PI * i / n), area: A });
  return out;
}

function fiberNMRef(x: number, D: number, bars: Bar[], fcd: number, fyd: number) {
  const R = D / 2, NS = 4000, dy = D / NS;
  let N = 0, M = 0;
  for (let i = 0; i < NS; i++) {
    const y = (i + 0.5) * dy;
    const s = sigmaRef(strainRef(y, x, D), fcd);
    if (s <= 0) continue;
    const w = 2 * Math.sqrt(Math.max(0, R * R - (y - R) * (y - R)));
    N += s * w * dy;
    M += s * w * dy * (R - y);
  }
  for (const b of bars) {
    const eps = strainRef(b.y, x, D);
    const sig = Math.max(-fyd, Math.min(fyd, Es * eps)) - sigmaRef(eps, fcd);
    N += b.area * sig;
    M += b.area * sig * (R - b.y);
  }
  return { N, M };
}

function fiberMRdRef(NEd: number, D: number, bars: Bar[], fcd: number, fyd: number): number {
  let lo = 1e-3, hi = 2 * D;
  for (let g = 0; g < 24 && fiberNMRef(hi, D, bars, fcd, fyd).N < NEd; g++) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (fiberNMRef(mid, D, bars, fcd, fyd).N < NEd) lo = mid; else hi = mid;
  }
  return fiberNMRef((lo + hi) / 2, D, bars, fcd, fyd).M;
}

// ── Motor vs referencia por fibras ───────────────────────────────────────────
describe('Circular engine vs independent fiber reference', () => {
  const cases = [
    { D: 350, fck: 25, fyk: 500, n: 6, phi: 16 },
    { D: 400, fck: 25, fyk: 500, n: 8, phi: 20 },
    { D: 500, fck: 30, fyk: 500, n: 12, phi: 25 },
  ];

  for (const c of cases) {
    for (const lvl of [0.30, 0.65, 0.90]) {
      it(`MRd within ±1.5% of reference (D${c.D} ${c.n}Ø${c.phi} fck${c.fck} ned=${lvl})`, () => {
        const fcd = getConcrete(c.fck).fcd, fyd = getFyd(c.fyk);
        const As = c.n * getBarArea(c.phi);
        const Ac = Math.PI * (c.D / 2) ** 2;
        const NRd_max = fcd * (Ac - As) + Math.min(fyd, 400) * As;
        const NEd = lvl * NRd_max;
        const r = calcRCColumn(circ({
          D: c.D, nBarsCirc: c.n, circBarDiam: c.phi, fck: c.fck, fyk: c.fyk,
          cover: COVER, stirrupDiam: STIRRUP, Nd: NEd / 1e3, MEdy: 1, MEdz: 0, L: 0.5, beta: 1,
        }));
        expect(r.valid).toBe(true);
        // referencia evaluada en la MISMA orientación gobernante que el motor
        const ref = fiberMRdRef(NEd, c.D, ringRef(c.D, c.n, c.phi, r.theta_star!), fcd, fyd) / 1e6;
        expect(Math.abs(r.MRd! / ref - 1)).toBeLessThan(0.015);
      });
    }
  }

  it('accuracy regression: no Whitney-era +27% overshoot at ned=0.9 (D350 6Ø16)', () => {
    // Con el bloque de Whitney a fcd pleno el motor daba 32.5 kNm aquí; la
    // referencia parábola-rectángulo da ~25.7 (θ0=0). El motor de fibras debe
    // quedar ≤ la referencia a θ0=0 (es un mínimo sobre rotaciones).
    const fcd = getConcrete(25).fcd, fyd = getFyd(500);
    const As = 6 * getBarArea(16), Ac = Math.PI * 175 ** 2;
    const NRd_max = fcd * (Ac - As) + 400 * As;
    const NEd = 0.9 * NRd_max;
    const r = calcRCColumn(circ({
      D: 350, nBarsCirc: 6, circBarDiam: 16, fck: 25, fyk: 500,
      cover: COVER, stirrupDiam: STIRRUP, Nd: NEd / 1e3, MEdy: 1, MEdz: 0, L: 0.5, beta: 1,
    }));
    const refTheta0 = fiberMRdRef(NEd, 350, ringRef(350, 6, 16, 0), fcd, fyd) / 1e6;
    expect(r.MRd!).toBeLessThanOrEqual(refTheta0 * 1.005);
    expect(r.MRd!).toBeGreaterThan(refTheta0 * 0.85); // y sin sobre-penalizar
  });

  it('worst ring orientation: engine MRd ≤ capacity at θ0=0 and θ0=π/n (n=5, high axial)', () => {
    // El caso pésimo de la auditoría: n=5, ned=0.9 → θ0=0 sobreestimaba +8.5%.
    const fcd = getConcrete(25).fcd, fyd = getFyd(500);
    const As = 5 * getBarArea(20), Ac = Math.PI * 200 ** 2;
    const NRd_max = fcd * (Ac - As) + 400 * As;
    const NEd = 0.9 * NRd_max;
    const r = calcRCColumn(circ({
      D: 400, nBarsCirc: 5, circBarDiam: 20, fck: 25, fyk: 500,
      cover: COVER, stirrupDiam: STIRRUP, Nd: NEd / 1e3, MEdy: 1, MEdz: 0, L: 0.5, beta: 1,
    }));
    const m0 = fiberMRdRef(NEd, 400, ringRef(400, 5, 20, 0), fcd, fyd) / 1e6;
    const mPi = fiberMRdRef(NEd, 400, ringRef(400, 5, 20, Math.PI / 5), fcd, fyd) / 1e6;
    expect(r.MRd!).toBeLessThanOrEqual(Math.min(m0, mPi) * 1.01);
    expect(r.theta_star).toBeGreaterThanOrEqual(0);
    expect(r.theta_star).toBeLessThanOrEqual(Math.PI / 5 + 1e-9);
  });

  it('N(x→∞) plateau matches NRd_max (pure pivot C)', () => {
    const fcd = getConcrete(25).fcd, fyd = getFyd(500);
    const bars = ringRef(400, 8, 20, 0);
    const As = 8 * getBarArea(20), Ac = Math.PI * 200 ** 2;
    const NRd_max = fcd * (Ac - As) + 400 * As;
    const plateau = fiberNMRef(800 * 400, 400, bars, fcd, fyd).N;
    expect(plateau / NRd_max).toBeCloseTo(1, 3);
  });
});

// ── Slenderness oracle ───────────────────────────────────────────────────────
describe('Circular column — slenderness', () => {
  it('λ = Lk/(D/4) = 35.0 for D=400, L=3.5, β=1', () => {
    const r = calcRCColumn(circ({ D: 400, L: 3.5, beta: 1 }));
    expect(r.valid).toBe(true);
    expect(r.lambda).toBeCloseTo(35.0, 1);
    expect(r.lambda_y).toBeCloseTo(r.lambda_z, 6); // single slenderness mirrored
  });
});

// ── Polar symmetry + resultant moment ────────────────────────────────────────
describe('Circular column — polar symmetry & resultant', () => {
  it('swapping MEdy↔MEdz leaves M_res, MRd and resUtil unchanged', () => {
    const a = calcRCColumn(circ({ D: 400, nBarsCirc: 8, circBarDiam: 20, MEdy: 30, MEdz: 10 }));
    const b = calcRCColumn(circ({ D: 400, nBarsCirc: 8, circBarDiam: 20, MEdy: 10, MEdz: 30 }));
    expect(a.M_res).toBeCloseTo(b.M_res!, 6);
    expect(a.MRd).toBeCloseTo(b.MRd!, 6);
    expect(a.resUtil).toBeCloseTo(b.resUtil!, 6);
  });

  it('off-axis rotation (My=Mz) gives same M_res as the equivalent single resultant', () => {
    // M1 = √(40²+40²) = 56.57 about the resultant direction.
    const diag = calcRCColumn(circ({ D: 450, nBarsCirc: 8, MEdy: 40, MEdz: 40 }));
    const single = calcRCColumn(circ({ D: 450, nBarsCirc: 8, MEdy: Math.hypot(40, 40), MEdz: 0 }));
    expect(diag.M_res).toBeCloseTo(single.M_res!, 4);
    expect(diag.MRd).toBeCloseTo(single.MRd!, 4);
  });

  it('odd bar count stays valid and symmetric under swap', () => {
    const a = calcRCColumn(circ({ D: 400, nBarsCirc: 7, MEdy: 25, MEdz: 12 }));
    const b = calcRCColumn(circ({ D: 400, nBarsCirc: 7, MEdy: 12, MEdz: 25 }));
    expect(a.valid).toBe(true);
    expect(a.M_res).toBeCloseTo(b.M_res!, 6);
  });
});

// ── T2: resultant-direction eccentricity, NO phantom √2 ──────────────────────
describe('Circular column — 2nd-order eccentricity (T2)', () => {
  it('pure axial uses ONE minimum ecc + ONE imperfection (no √2 inflation)', () => {
    // D=700 ⇒ e1 = D/30 = 23.33 mm (dominates the 20 mm floor).
    // Short (λ small) ⇒ e2 = 0. e_imp = Lk/400 = 2.5 mm. e_tot = 25.83 mm.
    // M_res = Nd·e_tot = 500e3 · 25.83 / 1e6 = 12.92 kNm. A per-axis hypot bug
    // would return √2·12.92 ≈ 18.3 kNm.
    const r = calcRCColumn(circ({ D: 700, L: 1.0, beta: 1, Nd: 500, MEdy: 0, MEdz: 0 }));
    expect(r.valid).toBe(true);
    expect(r.e2_y).toBe(0);
    expect(r.M_res).toBeCloseTo(12.92, 1);
  });

  it('short vs slender: e2 = 0 below λ_lim, e2 > 0 above', () => {
    const short = calcRCColumn(circ({ D: 400, L: 1.0, beta: 1 }));   // λ = 10
    const slender = calcRCColumn(circ({ D: 400, L: 5.0, beta: 1 })); // λ = 50
    expect(short.e2_y).toBe(0);
    expect(slender.e2_y).toBeGreaterThan(0);
  });
});

// ── Section model: NRd,max hand-check + reinforcement scaling ─────────────────
describe('Circular column — section model', () => {
  it('NRd,max matches hand calc (D=400, fck=25, 8Ø20)', () => {
    // fcd=16.667, Ac=π·200²=125663.7, As=8·π·100=2513.27, f_yc,d=min(434.8,400)=400.
    // NRd,max = 16.667·(125663.7−2513.27) + 400·2513.27 = 3.058e6 N.
    const r = calcRCColumn(circ({ D: 400, nBarsCirc: 8, circBarDiam: 20, Nd: 800 }));
    expect(r.NRd_max).toBeCloseTo(3058, -1); // kN, within ~10 kN
  });

  it('more bars ⇒ more steel ⇒ higher NRd,max and MRd', () => {
    const few = calcRCColumn(circ({ D: 450, nBarsCirc: 6, circBarDiam: 20, MEdy: 40 }));
    const many = calcRCColumn(circ({ D: 450, nBarsCirc: 12, circBarDiam: 20, MEdy: 40 }));
    expect(many.As_total).toBeGreaterThan(few.As_total);
    expect(many.NRd_max).toBeGreaterThan(few.NRd_max);
    expect(many.MRd!).toBeGreaterThan(few.MRd!);
  });

  it('end-to-end: reconstruct N,M at x_star with the governing ring θ0* (fibers)', () => {
    const fcd = getConcrete(25).fcd, fyd = getFyd(500);
    const Nd = 800;
    const r = calcRCColumn(circ({ D: 400, nBarsCirc: 8, circBarDiam: 20, Nd, MEdy: 60, MEdz: 0 }));
    expect(r.valid).toBe(true);
    const bars = ringRef(400, 8, 20, r.theta_star!);
    const { N, M } = fiberNMRef(r.x_star!, 400, bars, fcd, fyd);
    expect(Math.abs(N / (Nd * 1e3) - 1)).toBeLessThan(0.01);   // equilibrio axial en x_star
    expect(Math.abs(M / 1e6 / r.MRd! - 1)).toBeLessThan(0.015); // momento resistente reconstruido
  });
});

// ── Checks: presence/absence + specific rules ────────────────────────────────
describe('Circular column — checks', () => {
  const ids = (overrides = {}) => calcRCColumn(circ(overrides)).checks.map((c) => c.id);

  it('has circular checks and omits rectangular ones', () => {
    const present = ids();
    for (const id of ['lambda', 'flexion-check', 'nm-res', 'bar-spacing-circ',
      'as-min', 'as-min-mech', 'long-bar-diam-min', 'as-max', 'nBars-min', 'stirrup-diam', 'stirrup-spacing',
      'stirrup-densification', 'nd-max']) {
      expect(present).toContain(id);
    }
    for (const id of ['lambda-z', 'cond-5.38a', 'cond-5.38b', 'bar-spacing-y',
      'bar-spacing-x', 'biaxial-check', 'nm-y', 'nm-z']) {
      expect(present).not.toContain(id);
    }
  });

  it('bar-spacing uses the chord and fails on a tight ring', () => {
    const r = calcRCColumn(circ({ D: 300, nBarsCirc: 20, circBarDiam: 20 }));
    const c = r.checks.find((ch) => ch.id === 'bar-spacing-circ')!;
    expect(c.status).toBe('fail');
  });

  it('stirrup-spacing least dimension is D for circular', () => {
    const r = calcRCColumn(circ({ D: 200, circBarDiam: 20, stirrupSpacing: 210 }));
    const c = r.checks.find((ch) => ch.id === 'stirrup-spacing')!;
    expect(c.limit).toContain('200'); // min(15·20=300, D=200, 300) = 200
    expect(c.status).toBe('fail');    // 210 > 200
  });

  it('stirrup-spacing usa 15φ del anejo español, no 12φ', () => {
    // Ø16: sMax = min(15·16=240, D=350, 300) = 240 → s=220 CUMPLE (con el
    // viejo 12φ el límite era 192 y este estribado salía INCUMPLE).
    const r = calcRCColumn(circ({ circBarDiam: 16, stirrupSpacing: 220 }));
    const c = r.checks.find((ch) => ch.id === 'stirrup-spacing')!;
    expect(c.limit).toContain('240');
    expect(c.status).toBe('ok');
  });

  it('stirrup-densification avisa (warn) cuando s > 0.6·sMax', () => {
    // 0.6·240 = 144 < 220 → densificar junto a vigas/forjados (§9.5.3(4)).
    const r = calcRCColumn(circ({ circBarDiam: 16, stirrupSpacing: 220 }));
    const c = r.checks.find((ch) => ch.id === 'stirrup-densification')!;
    expect(c.limit).toContain('144');
    expect(c.status).toBe('warn');

    // Estribado corrido que ya cumple 0.6·sMax → sin aviso.
    const ok = calcRCColumn(circ({ circBarDiam: 16, stirrupSpacing: 140 }));
    expect(ok.checks.find((ch) => ch.id === 'stirrup-densification')!.status).toBe('ok');
  });

  it('nBars-min enforces the Anejo 19 minimum of 4', () => {
    expect(NBARS_MIN_CIRC).toBe(4);
    const ok = calcRCColumn(circ({ nBarsCirc: 4 }));
    expect(ok.checks.find((c) => c.id === 'nBars-min')!.status).toBe('ok');
  });
});

// ── Overload + axial branches ────────────────────────────────────────────────
describe('Circular column — overload & axial branches', () => {
  it('flexion-check fails under a large moment', () => {
    const r = calcRCColumn(circ({ D: 300, nBarsCirc: 6, MEdy: 400, MEdz: 0 }));
    const c = r.checks.find((ch) => ch.id === 'flexion-check')!;
    expect(c.status).toBe('fail');
  });

  it('nd-max fails (crushing) under a huge axial load', () => {
    const r = calcRCColumn(circ({ D: 300, Nd: 12000 }));
    const c = r.checks.find((ch) => ch.id === 'nd-max')!;
    expect(c.status).toBe('fail');
  });
});

// ── Guards ───────────────────────────────────────────────────────────────────
describe('Circular column — guards', () => {
  it('invalid when r_s ≤ 0 (diameter too small for cover+bars)', () => {
    const r = calcRCColumn(circ({ D: 80 }));
    expect(r.valid).toBe(false);
  });

  it('invalid when n < minimum bars', () => {
    const r = calcRCColumn(circ({ nBarsCirc: 3 }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/barras/);
  });
});

// ── High-axial regression (bisección cubre todo NEd < NRd_max, sin zona gap) ─
describe('Circular column — high axial', () => {
  // D=350, fck=25 (fcd=16.667), 6Ø16: NRd_max≈2066 kN. Regresión histórica: la
  // 1ª implementación (NRd_Whitney = 0.8·fcd·Ac) metía cargas válidas como
  // 1950 kN (ned≈0.94) en la rama gap y colapsaba MRd a ~0.5 kNm. Con el motor
  // de fibras (pivote C) la bisección alcanza cualquier NEd < NRd_max.
  const hi = circ({ D: 350, nBarsCirc: 6, circBarDiam: 16, Nd: 1950, MEdy: 10, MEdz: 0 });

  it('MRd does NOT collapse for a valid high-axial load', () => {
    const r = calcRCColumn(hi);
    expect(r.valid).toBe(true);
    const ndMax = r.checks.find((c) => c.id === 'nd-max')!;
    expect(ndMax.status).toBe('ok');           // 1950 < NRd_max ⇒ not crushing
    expect(r.MRd!).toBeGreaterThan(3);          // collapsed value was ~0.5 kNm
  });

  it('reinforced interaction envelope is monotonic in N and does not overshoot NRd_max', () => {
    const r = calcRCColumn(hi);
    const env = buildColumnInteraction(hi, r).y!.reinforced;
    for (let i = 1; i < env.length; i++) {
      expect(env[i].N).toBeGreaterThanOrEqual(env[i - 1].N - 1e-6);  // monótona
    }
    const maxN = Math.max(...env.map((p) => p.N));
    expect(maxN).toBeLessThanOrEqual(r.NRd_max + 1);                  // sin sobrepasar NRd_max
  });
});

// ── Interaction envelope (single curve) ──────────────────────────────────────
describe('Circular column — interaction diagram', () => {
  it('builds one envelope (y), z is null, closes at NRd,max', () => {
    const inp = circ({ D: 400, nBarsCirc: 8, circBarDiam: 20, Nd: 800, MEdy: 60 });
    const result = calcRCColumn(inp);
    const it_ = buildColumnInteraction(inp, result);
    expect(it_.valid).toBe(true);
    expect(it_.y).not.toBeNull();
    expect(it_.z).toBeNull();
    expect(it_.y!.reinforced.length).toBeGreaterThanOrEqual(2);
    const last = it_.y!.reinforced[it_.y!.reinforced.length - 1];
    expect(last.N).toBeCloseTo(result.NRd_max, -1);
    expect(last.M).toBeCloseTo(0, 3);
  });

  it('envelope agrees with the engine MRd at N = NEd (same θ0* ring)', () => {
    const inp = circ({ D: 400, nBarsCirc: 8, circBarDiam: 20, Nd: 800, MEdy: 60 });
    const result = calcRCColumn(inp);
    const env = buildColumnInteraction(inp, result).y!.reinforced;
    let mEnv: number | null = null;
    for (let i = 0; i < env.length - 1; i++) {
      if (800 >= env[i].N && 800 <= env[i + 1].N) {
        const f = (800 - env[i].N) / (env[i + 1].N - env[i].N);
        mEnv = env[i].M + f * (env[i + 1].M - env[i].M);
      }
    }
    expect(mEnv).not.toBeNull();
    expect(Math.abs(mEnv! / result.MRd! - 1)).toBeLessThan(0.02);
  });
});

// ── Backward compatibility ───────────────────────────────────────────────────
describe('Circular column — backward compatibility', () => {
  it('input without sectionType is treated as rectangular', () => {
    const { sectionType: _omit, ...noType } = rcColumnDefaults;
    const r = calcRCColumn(noType as typeof rcColumnDefaults);
    expect(r.sectionType).toBe('rectangular');
    expect(r.valid).toBe(true);
    const explicit = calcRCColumn({ ...rcColumnDefaults, sectionType: 'rectangular' });
    expect(r.As_total).toBeCloseTo(explicit.As_total, 6);
    expect(r.MRdy).toBeCloseTo(explicit.MRdy, 6);
  });
});
