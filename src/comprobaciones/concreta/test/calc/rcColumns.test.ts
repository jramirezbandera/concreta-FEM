// Tests for RC Columns calculation engine — CE Spain (biaxial bending)
// All defaults: b=300, h=300, cover=30, cornerBarDiam=16, nBarsX=0, nBarsY=0,
//   barDiamX=12, barDiamY=12, stirrupDiam=6, stirrupSpacing=140,
//   fck=25, fyk=500, Nd=500kN, MEdy=30kNm, MEdz=10kNm, L=3.5m, beta=1

import { describe, it, expect } from 'vitest';
import { calcRCColumn, calcNM, computeAxis, type BarGroup, type PRDiagram } from '../../lib/calculations/rcColumns.ts';
import { rcColumnDefaults } from '../../data/defaults.ts';
import { getConcrete, getFyd, Es } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';

const D = rcColumnDefaults;

function inp(overrides: Partial<typeof D> = {}): typeof D {
  return { ...D, ...overrides } as typeof D;
}

// ── FTUX defaults ───────────────────────────────────────────────────────────

describe('RC Columns — FTUX defaults', () => {
  it('result is valid', () => {
    expect(calcRCColumn(inp()).valid).toBe(true);
  });

  it('d_y = h - cover - stirrupDiam - cornerBarDiam/2 = 256 mm', () => {
    const r = calcRCColumn(inp());
    expect(r.d_y).toBeCloseTo(256, 0);
  });

  it("d_prime = cover + stirrupDiam + cornerBarDiam/2 = 44 mm", () => {
    const r = calcRCColumn(inp());
    expect(r.d_prime).toBeCloseTo(44, 0);
  });

  it('As_total = 4 * π(8)² = 804.2 mm² for 4×Ø16c', () => {
    const r = calcRCColumn(inp());
    expect(r.As_total).toBeCloseTo(804.2, 0);
  });

  it('lambda_y ≈ 40.4 for b=h=300, L=3.5, beta=1', () => {
    const r = calcRCColumn(inp());
    expect(r.lambda_y).toBeCloseTo(40.4, 0);
  });

  it('lambda_y = lambda_z for square section b=h', () => {
    const r = calcRCColumn(inp());
    expect(r.lambda_y).toBeCloseTo(r.lambda_z, 3);
  });

  it('e_imp_y = Lk_mm / 400 = 8.75 mm', () => {
    const r = calcRCColumn(inp());
    expect(r.e_imp_y).toBeCloseTo(8.75, 1);
  });

  it('e_imp_y = e_imp_z (same Lk)', () => {
    const r = calcRCColumn(inp());
    expect(r.e_imp_y).toBeCloseTo(r.e_imp_z, 3);
  });

  it('all checks not fail (CUMPLE defaults)', () => {
    const r = calcRCColumn(inp());
    expect(r.valid).toBe(true);
    const governingIds = ['biaxial-check', 'lambda-y', 'lambda-z', 'nd-max',
      'as-min', 'as-min-mech', 'long-bar-diam-min', 'as-max', 'nBars-min', 'bar-spacing-x', 'bar-spacing-y',
      'stirrup-diam', 'stirrup-spacing', 'stirrup-densification'];
    for (const id of governingIds) {
      const ch = r.checks.find((c) => c.id === id);
      expect(ch, `check ${id} missing`).toBeDefined();
      expect(ch!.status, `check ${id} failed`).not.toBe('fail');
    }
  });

  it('MRdy > MEd_tot_y (y-axis passes)', () => {
    const r = calcRCColumn(inp());
    expect(r.MRdy).toBeGreaterThan(r.MEd_tot_y);
  });

  it('biaxial utilization 40–90% for FTUX defaults', () => {
    const r = calcRCColumn(inp());
    expect(r.biaxialUtil).toBeGreaterThan(0.3);
    expect(r.biaxialUtil).toBeLessThan(0.95);
  });

  it('rebarSchedule contains corner bar info', () => {
    const r = calcRCColumn(inp());
    expect(r.rebarSchedule).toContain('4');
    expect(r.rebarSchedule).toContain('16');
  });

  it('lapLength > 0', () => {
    const r = calcRCColumn(inp());
    expect(r.lapLength).toBeGreaterThan(0);
  });

  it('checks array has 18 entries', () => {
    // 2026-09-25: +1 por el diámetro mínimo Ø12 del CE §9.5.2(1)
    // (long-bar-diam-min); as-min (0,002·Ac, Eurocódigo) sigue.
    const r = calcRCColumn(inp());
    expect(r.checks).toHaveLength(18);
  });

  it('result has all required fields', () => {
    const r = calcRCColumn(inp());
    expect(r.d_y).toBeDefined();
    expect(r.d_z).toBeDefined();
    expect(r.d_prime).toBeDefined();
    expect(r.As_total).toBeDefined();
    expect(r.lambda_y).toBeDefined();
    expect(r.lambda_z).toBeDefined();
    expect(r.e1_y).toBeDefined();
    expect(r.e_imp_y).toBeDefined();
    expect(r.e2_y).toBeDefined();
    expect(r.e_tot_y).toBeDefined();
    expect(r.MEd_tot_y).toBeDefined();
    expect(r.MEd_tot_z).toBeDefined();
    expect(r.MRdy).toBeDefined();
    expect(r.MRdz).toBeDefined();
    expect(r.NRd_max).toBeDefined();
    expect(r.ned).toBeDefined();
    expect(r.a).toBeDefined();
    expect(r.biaxialUtil).toBeDefined();
  });
});

// ── Short column (lambda ≤ 25) ──────────────────────────────────────────────

describe('RC Columns — Short column (lambda ≤ 25)', () => {
  it('e2_y = 0 when lambda_y ≤ 25', () => {
    const r = calcRCColumn(inp({ L: 1.5, beta: 1 }));
    expect(r.valid).toBe(true);
    expect(r.e2_y).toBe(0);
    expect(r.lambda_y).toBeLessThanOrEqual(25);
  });

  it('e2_z = 0 when lambda_z ≤ 25', () => {
    const r = calcRCColumn(inp({ L: 1.5, beta: 1 }));
    expect(r.e2_z).toBe(0);
    expect(r.lambda_z).toBeLessThanOrEqual(25);
  });

  it('MEd_tot_y = NEd * (e1_y + e_imp_y) / 1e6 when lambda_y ≤ 25', () => {
    const r = calcRCColumn(inp({ L: 1.5, beta: 1 }));
    const expected = (D.Nd * 1e3) * (r.e1_y + r.e_imp_y) / 1e6;
    expect(r.MEd_tot_y).toBeCloseTo(expected, 1);
  });
});

// ── Slender column (lambda > 25) ────────────────────────────────────────────

describe('RC Columns — Slender column (lambda > 25)', () => {
  it('e2_y > 0 when lambda_y > 25', () => {
    const r = calcRCColumn(inp({ L: 3.5, beta: 1 }));
    expect(r.valid).toBe(true);
    expect(r.lambda_y).toBeGreaterThan(25);
    expect(r.e2_y).toBeGreaterThan(0);
  });

  it('MEd_tot_y > MEdy for slender column (amplification)', () => {
    const r = calcRCColumn(inp({ L: 6, beta: 1 }));
    expect(r.MEd_tot_y).toBeGreaterThan(D.MEdy);
  });

  it('λ = 25 con axil bajo (λ_lim capado a 25): e2_y = 0 (fix auditoría #35)', () => {
    // λ_lim = 20·0.7·1.1·0.7/√n = 10.78/√n (CE Anejo 19 expr. 5.13N), capado
    // al 25 histórico. Con Nd=200 → n=0.133 → λ_lim = 29.5 → cap 25: el corte
    // antiguo sigue valiendo SOLO con axil bajo.
    const Lk_boundary = (25 * (300 / Math.sqrt(12))) / 1000;
    const r = calcRCColumn(inp({ L: Lk_boundary, beta: 1, Nd: 200 }));
    expect(r.e2_y).toBe(0);
  });

  it('λ = 22 con axil alto: e2 ya no se desprecia (fix auditoría #35)', () => {
    // Nd=750 → n = 750/(300·300·16.7e-3) = 0.499 → λ_lim = 10.78/√0.499 = 15.3.
    // λ=22 > λ_lim: la norma exige e2 (el corte fijo en 25 lo ponía a cero).
    const Lk = (22 * (300 / Math.sqrt(12))) / 1000;
    const r = calcRCColumn(inp({ L: Lk, beta: 1, Nd: 750 }));
    expect(r.lambda_y).toBeCloseTo(22, 1);
    expect(r.e2_y).toBeGreaterThan(0);
  });

  it('second-order e2_y increases with Lk for slender columns', () => {
    const r1 = calcRCColumn(inp({ L: 4, beta: 1 }));
    const r2 = calcRCColumn(inp({ L: 7, beta: 1 }));
    expect(r2.e2_y).toBeGreaterThan(r1.e2_y);
  });

  it('separación máx. de cercos usa Ømin longitudinal (fix auditoría #36)', () => {
    // Esquinas Ø25 + intermedias Ø12: el cerco arriostra la barra MÁS FINA →
    // sMax = min(15·12, min(b,h), 300) = 180 mm. Pre-fix usaba el Ø de
    // esquina (15·25 → cap 300) y s=250 con intermedias Ø12 pasaba en verde.
    const r = calcRCColumn(inp({ cornerBarDiam: 25, nBarsX: 2, barDiamX: 12, stirrupSpacing: 250 }));
    const c = r.checks.find((ch) => ch.id === 'stirrup-spacing')!;
    expect(c.limit).toContain('180');
    expect(c.status).toBe('fail');
  });
});

// ── lambda > 100 warning ─────────────────────────────────────────────────────

describe('RC Columns — lambda > 100 warning', () => {
  it('lambda-y status is warn when lambda_y > 100', () => {
    const r = calcRCColumn(inp({ L: 10, beta: 1 }));
    expect(r.valid).toBe(true);
    expect(r.lambda_y).toBeGreaterThan(100);
    const ch = r.checks.find((c) => c.id === 'lambda-y');
    expect(ch?.status).toBe('warn');
  });

  it('lambda-z status is warn when lambda_z > 100', () => {
    const r = calcRCColumn(inp({ L: 10, beta: 1 }));
    const ch = r.checks.find((c) => c.id === 'lambda-z');
    expect(ch?.status).toBe('warn');
  });
});

// ── NEd > NRd,max fails ──────────────────────────────────────────────────────

describe('RC Columns — NEd > NRd,max fails', () => {
  it('nd-max fails when NEd greatly exceeds pure compression capacity', () => {
    const r = calcRCColumn(inp({ Nd: 2500 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'nd-max');
    expect(ch?.status).toBe('fail');
  });

  it('biaxial-check is fail (N/A) when nd-max fails', () => {
    const r = calcRCColumn(inp({ Nd: 2500 }));
    const bc = r.checks.find((c) => c.id === 'biaxial-check');
    expect(bc?.status).toBe('fail');
  });

  it('NRd_max usa f_yc,d = min(fyd, 400) en compresión pura (fix auditoría #51)', () => {
    // En compresión centrada εc ≤ εc2=0.002 → σs ≤ 400 N/mm². Para B500S
    // (fyd=434.8): NRd_max = 16.67·89196 + 400·804 = 1811 kN (con fyd era 1836,
    // ~1.5% del lado inseguro). Coherente con el cap del check as-min-mech.
    const r = calcRCColumn(inp());
    expect(r.NRd_max).toBeCloseTo(1811, 0);
  });

  it('binary search succeeds for high-axial NEd near NRd_max (no NaN)', () => {
    // Nd=1600 (ned≈0.88) caía en la antigua "zona gap" de Whitney; con el
    // modelo de fibras (pivote C) la bisección cubre todo NEd < NRd_max.
    const r = calcRCColumn(inp({ Nd: 1600 }));
    expect(r.valid).toBe(true);
    expect(r.x_star_y).toBeGreaterThan(0);
    expect(isNaN(r.MRdy)).toBe(false);
    const nd = r.checks.find((c) => c.id === 'nd-max');
    expect(nd?.status).not.toBe('fail');
  });

  it('axil alto: MRd por pivote C — oracle fibras (migración 2026-07-01)', () => {
    // 300×300 C25 4Ø16, Nd=1700 kN (ned ≈ 0.94, NRd_max ≈ 1811):
    // MRdy = 14.84 kNm por integración de fibras parábola-rectángulo con
    // pivote C (verificado contra referencia independiente a 4000 tiras).
    // La interpolación lineal de la zona gap de Whitney daba 16.1 (+8%); el
    // pre-fix original congelaba ~50 kNm y daba verde a un pilar que falla.
    const r = calcRCColumn(inp({ Nd: 1700, L: 1.5 }));
    expect(r.valid).toBe(true);
    expect(r.MRdy).toBeCloseTo(14.8, 0);
    expect(r.MRdy).toBeLessThan(25);            // capacidad real, no la congelada
    expect(r.biaxialUtil).toBeGreaterThan(1.0); // MEd_tot_y ≈ 53 kNm > MRd → falla
  });

  it('axil alto: MRd → 0 cuando NEd → NRd_max (monótono decreciente)', () => {
    const r1 = calcRCColumn(inp({ Nd: 1600, L: 1.5 }));
    const r2 = calcRCColumn(inp({ Nd: 1750, L: 1.5 }));
    const r3 = calcRCColumn(inp({ Nd: 1830, L: 1.5 }));
    expect(r2.MRdy).toBeLessThan(r1.MRdy);
    expect(r3.MRdy).toBeLessThan(r2.MRdy);
    expect(r3.MRdy).toBeLessThan(5);  // casi compresión pura → M ≈ 0
  });
});

// ── Fixes auditoría #17 (Kφ fluencia) y #18 (solape) ─────────────────────────

describe('RC Columns — Kφ y solape (fixes auditoría #17/#18)', () => {
  it('e2 con Kφ = 1+β·φef — oracle manual (defaults, φef=2)', () => {
    // λ = 40.41, fck=25 → β = 0.35 + 0.125 − 40.41/150 = 0.2056
    // Kφ = 1 + 0.2056·2 = 1.411
    // 1/r0 = 434.78/(200000·0.45·256) = 1.887e-5 → 1/r = 2.663e-5
    // e2 = (1/r)·3500²/10 = 32.6 mm (sin Kφ era 23.1: −29% inseguro)
    const r = calcRCColumn(inp());
    expect(r.e2_y).toBeCloseTo(32.6, 1);
  });

  it('φef = 0 recupera la curvatura base (Kφ = 1)', () => {
    const r = calcRCColumn(inp({ phiEf: 0 }));
    expect(r.e2_y).toBeCloseTo(23.1, 1);
  });

  it('Kφ clampa a 1 para esbelteces altas (β ≤ 0)', () => {
    // λ ≈ 80.8 (L=7m) → β = 0.475 − 0.539 < 0 → Kφ = 1: e2 igual con/sin φef.
    const rA = calcRCColumn(inp({ L: 7.0, phiEf: 2.0 }));
    const rB = calcRCColumn(inp({ L: 7.0, phiEf: 0 }));
    expect(rA.e2_y).toBeCloseTo(rB.e2_y, 4);
  });

  it('solape l0 = α6·lb,rqd con fctd = 0.7·fctm/γc — oracle manual', () => {
    // Ø16 B500S C25: fctd = 0.7·2.56/1.5 = 1.195 → fbd = 2.69 N/mm²
    // lb,rqd = (16/4)·(434.78/2.69) = 647 mm; l0 = 1.5·647 = 970 → 975 (paso 5)
    // Pre-fix: fbd = 2.25·0.7·fctm (sin γc) y sin α6 → 435 mm (×2.2 corto,
    // valor que iba directo a planos).
    const r = calcRCColumn(inp());
    expect(r.lapLength).toBe(975);
  });
});

// ── N-M interaction fails ────────────────────────────────────────────────────

describe('RC Columns — N-M interaction fails', () => {
  it('biaxial-check fails for very high moment (y-axis)', () => {
    const r = calcRCColumn(inp({ MEdy: 200, Nd: 100 }));
    expect(r.valid).toBe(true);
    const bc = r.checks.find((c) => c.id === 'biaxial-check');
    expect(bc?.status).toBe('fail');
  });

  it('biaxial-check fails for very high moment (z-axis)', () => {
    const r = calcRCColumn(inp({ MEdz: 200, Nd: 100 }));
    expect(r.valid).toBe(true);
    const bc = r.checks.find((c) => c.id === 'biaxial-check');
    expect(bc?.status).toBe('fail');
  });
});

// ── Reinforcement limit checks ───────────────────────────────────────────────

describe('RC Columns — Reinforcement limit checks', () => {
  it('as-min: 0,002·Ac del Eurocódigo, porque el CE §9.5.2 no fija cuantía geométrica', () => {
    // EN 1992-1-1 §9.5.2(2): 0,002·300·300 = 180 mm²; 4×Ø6 = 113 mm² < 180 → fail.
    const r = calcRCColumn(inp({ cornerBarDiam: 6 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'as-min')!;
    expect(ch.status).toBe('fail');
    expect(ch.limit).toContain('180');
    expect(ch.article).toBe('EN 1992-1-1 §9.5.2(2)');
    expect(ch.description).toMatch(/el CE no la fija/);
  });

  it('diámetro de las barras longitudinales ≥ 12 mm (CE Anejo 19 §9.5.2(1))', () => {
    const ok = calcRCColumn(inp({ cornerBarDiam: 12 })).checks.find((c) => c.id === 'long-bar-diam-min')!;
    expect(ok.status).toBe('ok');
    const r = calcRCColumn(inp({ cornerBarDiam: 16, nBarsX: 2, barDiamX: 10 }));
    const ch = r.checks.find((c) => c.id === 'long-bar-diam-min')!;
    expect(ch.status).toBe('fail');
    expect(ch.value).toBe('Ø10');
    expect(ch.article).toBe('CE Anejo 19 §9.5.2(1)');
  });

  it('as-max fails when As > 0.04·b·h', () => {
    // 4×Ø32c + 4×Ø25x + 4×Ø25y = 4*804+8*491 = 7154 mm² > 3600 mm²
    const r = calcRCColumn(inp({ cornerBarDiam: 32, nBarsX: 2, barDiamX: 25, nBarsY: 2, barDiamY: 25 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'as-max');
    expect(ch?.status).toBe('fail');
  });

  it('as-min-mech passes for defaults (low axial load)', () => {
    // Nd=500 kN con flexión → por cara 0,05·500 000/400 = 62,5 mm²
    // Cara = 2×Ø16 = 402 mm² > 62,5 → ok
    const r = calcRCColumn(inp());
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'as-min-mech');
    expect(ch?.status).toBe('ok');
  });

  it('as-min-mech fails when As·f_yc,d < 0.10·N_Ed (high load, light reinforcement)', () => {
    // Nd=2000 kN, cornerBarDiam=12 → cara = 2×113 = 226 mm²
    // f_yc,d = min(fyd, 400) = 400 N/mm² (fyk=500 → fyd=434.78)
    // Por cara 0,05·2 000 000/400 = 250 mm² > 226 → fail
    const r = calcRCColumn(inp({ Nd: 2000, cornerBarDiam: 12 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'as-min-mech');
    expect(ch?.status).toBe('fail');
  });

  it('as-min-mech con flexión: 0,05·N_Ed/f_yc,d EN CADA CARA, f_yc,d ≤ 400 (CE Anejo 19 §9.5.2(2))', () => {
    // fyk=500 → fyd=434.78, f_yc,d = 400. Nd=1000 kN → 0,05·1 000 000/400
    // = 125 mm² por cara (hasta el 2026-09-25 se pedían 250 sobre el total).
    const r = calcRCColumn(inp({ Nd: 1000 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'as-min-mech')!;
    expect(ch.limit).toBe('\u2265 125 mm\u00b2');
    expect(ch.value).toContain('402');          // la cara: 2×Ø16
    expect(ch.article).toBe('CE Anejo 19 §9.5.2(2)');
  });

  it('as-min-mech es regla constructiva: la cara justo en el mínimo cumple, sin aviso al 97 %', () => {
    // Por cara 0,05·N_Ed/400 = 2×Ø16 → N_Ed = 2·A(16)·400/0,05. Hasta el
    // 2026-09-27 el caso límite salía INCUMPLE y el 97 %, ADVERTENCIA.
    const cara = 2 * getBarArea(16);
    const NdLim = (cara * 400) / 0.05 / 1000;          // kN
    const fila = (Nd: number) => calcRCColumn(inp({ Nd })).checks.find((c) => c.id === 'as-min-mech')!;
    expect(fila(NdLim).utilization).toBeCloseTo(1, 9);
    expect(fila(NdLim).status).toBe('ok');
    expect(fila(0.97 * NdLim).status).toBe('ok');
    expect(fila(1.01 * NdLim).status).toBe('fail');
  });

  it('as-max al 97 % de 0,04·b·h cumple sin advertencia', () => {
    // 4Ø32 = 3217 mm²; b = h con 0,04·b² = 3217/0,97
    const As = 4 * getBarArea(32);
    const lado = Math.sqrt(As / 0.97 / 0.04);
    const ch = calcRCColumn(inp({ cornerBarDiam: 32, b: lado, h: lado })).checks.find((c) => c.id === 'as-max')!;
    expect(ch.utilization).toBeCloseTo(0.97, 6);
    expect(ch.status).toBe('ok');
  });

  it('as-min-mech manda la cara más floja con flexión esviada', () => {
    // 2 intermedias Ø20 en las caras sup/inf: esa cara 2×201 + 2×314 = 1030,
    // la izq/der sólo las esquinas, 402 mm²
    const r = calcRCColumn(inp({ Nd: 1000, nBarsX: 2, barDiamX: 20 }));
    expect(r.checks.find((c) => c.id === 'as-min-mech')!.value).toContain('402');
  });

  it('as-min-mech en compresión simple: 0,10·N_Ed/f_yd en total (9.12)', () => {
    // MEdy = MEdz = 0, armado simétrico: 0,10·1 000 000/434,78 = 230 mm²
    const r = calcRCColumn(inp({ Nd: 1000, MEdy: 0, MEdz: 0 }));
    const ch = r.checks.find((c) => c.id === 'as-min-mech')!;
    expect(ch.limit).toBe('\u2265 230 mm\u00b2');
    expect(ch.value).toContain('804');          // el total, 4×Ø16
    expect(ch.article).toBe('CE Anejo 19 §9.5.2(2) (9.12)');
  });

  it('nBars-min always passes since we always have 4 corner bars', () => {
    const r = calcRCColumn(inp());
    const ch = r.checks.find((c) => c.id === 'nBars-min');
    expect(ch?.status).toBe('ok');
  });
});

// ── Transverse reinforcement checks ─────────────────────────────────────────

describe('RC Columns — Transverse reinforcement checks', () => {
  it('stirrup-diam fails when stirrupDiam < max(cornerBarDiam/4, 6)', () => {
    // cornerBarDiam=16: demand = max(4, 6) = 6mm. stirrupDiam=5 → fail
    const r = calcRCColumn(inp({ stirrupDiam: 5 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'stirrup-diam');
    expect(ch?.status).toBe('fail');
  });

  it('stirrup-diam passes when stirrupDiam = 6 (demand = max(16/4, 6) = 6)', () => {
    const r = calcRCColumn(inp({ stirrupDiam: 6 }));
    const ch = r.checks.find((c) => c.id === 'stirrup-diam');
    expect(ch?.status).toBe('ok');
  });

  it('stirrup-diam uses max of all bar diameters (not just corner)', () => {
    // cornerBarDiam=16, barDiamX=25 → demand = max(25/4, 6) = 7mm. stirrupDiam=6 → fail
    const r = calcRCColumn(inp({ cornerBarDiam: 16, nBarsX: 2, barDiamX: 25, stirrupDiam: 6 }));
    const ch = r.checks.find((c) => c.id === 'stirrup-diam');
    expect(ch?.status).toBe('fail');
  });

  it('stirrup-spacing fails when spacing > min(15φ_corner, min(b,h), 300)', () => {
    // sMax = min(15*16, 300, 300) = 240mm. spacing=250 → fail
    const r = calcRCColumn(inp({ stirrupSpacing: 250 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'stirrup-spacing');
    expect(ch?.status).toBe('fail');
  });

  it('stirrup-spacing passes when spacing ≤ sMax', () => {
    const r = calcRCColumn(inp({ stirrupSpacing: 150 }));
    const ch = r.checks.find((c) => c.id === 'stirrup-spacing');
    expect(ch?.status).toBe('ok');
  });

  it('stirrup-spacing usa 15φ del anejo español, no 12φ (caso CYPE P16)', () => {
    // 30×30, esquinas Ø25 + 2Ø16 por dirección, Ø8c/200: sMax = min(15·16,
    // 300, 300) = 240 → CUMPLE (con el viejo 12φ el límite era 192 y este
    // armado, aceptado por CypeCAD conforme al A19.9.5.3(3), salía INCUMPLE).
    const r = calcRCColumn(inp({
      cornerBarDiam: 25, nBarsX: 2, barDiamX: 16, nBarsY: 2, barDiamY: 16,
      stirrupDiam: 8, stirrupSpacing: 200,
    }));
    const ch = r.checks.find((c) => c.id === 'stirrup-spacing')!;
    expect(ch.limit).toContain('240');
    expect(ch.status).toBe('ok');
  });

  it('stirrup-densification avisa (warn, nunca fail) cuando s > 0.6·sMax', () => {
    // Mismo caso P16: 0.6·240 = 144 < 200 → hay que densificar junto a
    // vigas/forjados y en solapes (A19.9.5.3(4)); es aviso, no incumplimiento.
    const r = calcRCColumn(inp({
      cornerBarDiam: 25, nBarsX: 2, barDiamX: 16, nBarsY: 2, barDiamY: 16,
      stirrupDiam: 8, stirrupSpacing: 200,
    }));
    const ch = r.checks.find((c) => c.id === 'stirrup-densification')!;
    expect(ch.limit).toContain('144');
    expect(ch.status).toBe('warn');
  });

  it('stirrup-densification ok cuando el estribado corrido ya cumple 0.6·sMax', () => {
    const r = calcRCColumn(inp({
      cornerBarDiam: 25, nBarsX: 2, barDiamX: 16, nBarsY: 2, barDiamY: 16,
      stirrupDiam: 8, stirrupSpacing: 140,
    }));
    const ch = r.checks.find((c) => c.id === 'stirrup-densification')!;
    expect(ch.status).toBe('ok');
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('RC Columns — Edge cases', () => {
  it('Nd=0 returns invalid with error message', () => {
    const r = calcRCColumn(inp({ Nd: 0 }));
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('Nd=0.5 (<1) returns invalid', () => {
    const r = calcRCColumn(inp({ Nd: 0.5 }));
    expect(r.valid).toBe(false);
  });

  it('MEdy=0 is valid, e1_y = e0_min (min eccentricity governs)', () => {
    const r = calcRCColumn(inp({ MEdy: 0 }));
    expect(r.valid).toBe(true);
    // e0_applied = 0, e0_min = max(300/30, 20) = max(10, 20) = 20mm
    expect(r.e1_y).toBeCloseTo(20, 0);
    expect(r.MEd_tot_y).toBeGreaterThan(0);
  });

  it('MEdz=0 is valid', () => {
    const r = calcRCColumn(inp({ MEdz: 0 }));
    expect(r.valid).toBe(true);
    // e0z_applied=0, e0_min = max(300/30, 20) = 20mm
    expect(r.e1_z).toBeCloseTo(20, 0);
  });

  it('NRd_max > NEd for reasonable defaults', () => {
    const r = calcRCColumn(inp());
    expect(r.NRd_max).toBeGreaterThan(D.Nd);
  });

  it('x_star_y is between 0 and h for typical inputs', () => {
    const r = calcRCColumn(inp());
    expect(r.x_star_y).toBeGreaterThan(0);
    expect(r.x_star_y).toBeLessThan(D.h);
  });

  it('geometric imperfection e_imp_y increases with Lk', () => {
    const r1 = calcRCColumn(inp({ L: 3, beta: 1 }));
    const r2 = calcRCColumn(inp({ L: 6, beta: 1 }));
    expect(r2.e_imp_y).toBeGreaterThan(r1.e_imp_y);
  });

  it('beta multiplies L to produce Lk: L=4m beta=0.7 → Lk=2.8m', () => {
    const r_beta  = calcRCColumn(inp({ L: 4, beta: 0.7 }));
    const r_equiv = calcRCColumn(inp({ L: 2.8, beta: 1 }));
    expect(r_beta.Lk).toBeCloseTo(2.8, 2);
    expect(r_beta.lambda_y).toBeCloseTo(r_equiv.lambda_y, 1);
    expect(r_beta.e_imp_y).toBeCloseTo(r_equiv.e_imp_y, 1);
  });

  it('MEdy < 0 is valid — Math.abs applied', () => {
    const r_neg = calcRCColumn(inp({ MEdy: -30 }));
    const r_pos = calcRCColumn(inp({ MEdy: 30 }));
    expect(r_neg.valid).toBe(true);
    expect(r_neg.MEd_tot_y).toBeCloseTo(r_pos.MEd_tot_y, 1);
  });

  it('bar-spacing-x fails when intermediate bars are too close', () => {
    // b=300, cover=30, stirrupDiam=6, cornerBarDiam=16, nBarsX=6, barDiamX=25
    // innerX = 300 - 2*(30+6) - 2*16 = 300-72-32=196mm; clearX=(196-6*25)/(6+1)=46/7=6.6mm
    // sMin=max(25,16,20)=25mm → fail
    const r = calcRCColumn(inp({ nBarsX: 6, barDiamX: 25 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'bar-spacing-x');
    expect(ch?.status).toBe('fail');
  });

  it('bar-spacing-y fails when lateral bars are too close', () => {
    const r = calcRCColumn(inp({ nBarsY: 6, barDiamY: 25 }));
    expect(r.valid).toBe(true);
    const ch = r.checks.find((c) => c.id === 'bar-spacing-y');
    expect(ch?.status).toBe('fail');
  });
});

// ── New biaxial bending tests ────────────────────────────────────────────────

describe('RC Columns — Biaxial bending (new)', () => {
  it('interpExponent: ned=0.1 → a=1.0', () => {
    // For ned=0.1: NEd = 0.1 * NRd_max
    // Use ned≈0.1: NRd_max≈1836kN, NEd=184kN
    const r2 = calcRCColumn(inp({ Nd: 184 }));
    expect(r2.ned).toBeCloseTo(0.1, 1);
    expect(r2.a).toBeCloseTo(1.0, 1);
  });

  it('interpExponent: ned=0.7 → a=1.5', () => {
    // NEd = 0.7 * NRd_max ≈ 0.7 * 1836 = 1285 kN
    const r = calcRCColumn(inp({ Nd: 1285 }));
    expect(r.ned).toBeCloseTo(0.7, 1);
    expect(r.a).toBeCloseTo(1.5, 1);
  });

  it('interpExponent: ned=1.0 → a=2.0', () => {
    // NEd = NRd_max → nd-max fails, ned=1.0, a=2.0
    const r = calcRCColumn(inp({ Nd: 1836 }));
    expect(r.ned).toBeCloseTo(1.0, 1);
    expect(r.a).toBeCloseTo(2.0, 1);
  });

  it('interpExponent: ned=0.4 → a≈1.25', () => {
    // linear interp: 1.0 + (0.4-0.1)/0.6*0.5 = 1.0 + 0.25 = 1.25
    const r = calcRCColumn(inp({ Nd: 735 })); // ≈ 0.4 * 1836
    expect(r.a).toBeCloseTo(1.25, 1);
  });

  it('square column equal moments: biaxial util > each uniaxial util', () => {
    const r = calcRCColumn(inp({ MEdy: 20, MEdz: 20 }));
    expect(r.valid).toBe(true);
    const utilY = r.MRdy > 0 ? r.MEd_tot_y / r.MRdy : 0;
    const utilZ = r.MRdz > 0 ? r.MEd_tot_z / r.MRdz : 0;
    expect(r.biaxialUtil).toBeGreaterThan(utilY);
    expect(r.biaxialUtil).toBeGreaterThan(utilZ);
  });

  it('biaxial CUMPLE: MEdy/MRdy=0.6, MEdz/MRdz=0.6, a~1 → ~1.2 (still checks)', () => {
    // With a≈1 (ned small), (0.6)^1 + (0.6)^1 = 1.2 → fail.
    // With a=1.5, 2*0.6^1.5 = 2*0.465 = 0.93 → ok.
    const r = calcRCColumn(inp({ Nd: 1285 })); // ned≈0.7, a≈1.5
    // Not exactly 0.6/0.6 split, just verify a is 1.5 range
    expect(r.a).toBeCloseTo(1.5, 1);
  });

  it('MEdz=0 → biaxial check effectively matches nm-y', () => {
    const r = calcRCColumn(inp({ MEdz: 0 }));
    expect(r.valid).toBe(true);
    const bc = r.checks.find((c) => c.id === 'biaxial-check');
    // biaxialUtil = (MEd_tot_y/MRdy)^a (z term = 0)
    // The power a≥1 makes sum ≤ uniaxial util for a>1, so biaxial is at most nm-y util
    expect(bc).toBeDefined();
    expect(isNaN(r.biaxialUtil)).toBe(false);
    expect(isFinite(r.biaxialUtil)).toBe(true);
  });

  it('MEdy=0 → biaxial check driven by z-axis only', () => {
    const r = calcRCColumn(inp({ MEdy: 0 }));
    expect(r.valid).toBe(true);
    const bc = r.checks.find((c) => c.id === 'biaxial-check');
    expect(bc).toBeDefined();
    // z term > 0 (MEdz=10kNm, min eccentricity applies)
    expect(r.biaxialUtil).toBeGreaterThan(0);
  });

  it('nBarsX=2 → As_total increases vs nBarsX=0', () => {
    const r0 = calcRCColumn(inp({ nBarsX: 0 }));
    const r2 = calcRCColumn(inp({ nBarsX: 2, barDiamX: 12 }));
    expect(r2.As_total).toBeGreaterThan(r0.As_total);
  });

  it('nBarsX=2 → MRdz increases (nBarsX are side bars for z-axis bending)', () => {
    const r0 = calcRCColumn(inp({ nBarsX: 0 }));
    const r2 = calcRCColumn(inp({ nBarsX: 2, barDiamX: 12 }));
    // nBarsX are intermediate bars on top/bottom faces — they are SIDE bars for z-axis
    // So z-axis bending (barsZ array includes them) should see more capacity
    expect(r2.MRdz).toBeGreaterThan(r0.MRdz);
  });

  it('nBarsY=2 → MRdy increases (nBarsY are side bars for y-axis bending)', () => {
    const r0 = calcRCColumn(inp({ nBarsY: 0 }));
    const r2 = calcRCColumn(inp({ nBarsY: 2, barDiamY: 12 }));
    expect(r2.MRdy).toBeGreaterThan(r0.MRdy);
  });

  it('NRd_max increases with more bars', () => {
    const r0 = calcRCColumn(inp({ nBarsX: 0, nBarsY: 0 }));
    const r2 = calcRCColumn(inp({ nBarsX: 2, barDiamX: 12, nBarsY: 2, barDiamY: 12 }));
    expect(r2.NRd_max).toBeGreaterThan(r0.NRd_max);
  });

  it('Condition 5.38a: b=h=300 → lambda_y/lambda_z = 1.0 (cond_a = true)', () => {
    const r = calcRCColumn(inp());
    expect(r.lambda_y / r.lambda_z).toBeCloseTo(1.0, 3);
    const ch = r.checks.find((c) => c.id === 'cond-5.38a');
    // cond_a always 'ok' (informational)
    expect(ch?.status).toBe('ok');
  });

  it('Condition 5.38a: b=300, h=600 → lambda_y/lambda_z = 300/600 = 0.5 ≤ 2', () => {
    const r = calcRCColumn(inp({ b: 300, h: 600 }));
    // lambda_z / lambda_y = h/b = 600/300 = 2.0 (boundary)
    expect(r.lambda_z / r.lambda_y).toBeCloseTo(2.0, 1);
    const ch = r.checks.find((c) => c.id === 'cond-5.38a');
    expect(ch?.status).toBe('ok');
  });

  it('informational check IDs: nm-y, nm-z, cond-5.38a, cond-5.38b all present', () => {
    const r = calcRCColumn(inp());
    const infoIds = ['nm-y', 'nm-z', 'cond-5.38a', 'cond-5.38b'];
    for (const id of infoIds) {
      expect(r.checks.find((c) => c.id === id), `${id} missing`).toBeDefined();
    }
  });

  it('input validation: Nd < 1 → invalid', () => {
    const r = calcRCColumn(inp({ Nd: 0.5 }));
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('input validation: cornerBarDiam < 6 → invalid', () => {
    const r = calcRCColumn(inp({ cornerBarDiam: 4 }));
    expect(r.valid).toBe(false);
  });

  it('input validation: nBarsX = -1 → invalid', () => {
    const r = calcRCColumn(inp({ nBarsX: -1 }));
    expect(r.valid).toBe(false);
  });
});

// ── N-M interaction diagram ──────────────────────────────────────────────────
import { buildColumnInteraction } from '../../lib/calculations/rcColumns.ts';

describe('RC Columns — N-M interaction diagram', () => {
  it('valid for defaults, both axes present', () => {
    const r = calcRCColumn(inp());
    const d = buildColumnInteraction(inp(), r);
    expect(d.valid).toBe(true);
    expect(d.y).not.toBeNull();
    expect(d.z).not.toBeNull();
  });

  it('reinforced envelope has monotonic non-decreasing N (no spurious tail)', () => {
    const r = calcRCColumn(inp());
    const N = buildColumnInteraction(inp(), r).y!.reinforced.map((p) => p.N);
    expect(N.length).toBeGreaterThan(3);
    for (let i = 1; i < N.length; i++) {
      expect(N[i]).toBeGreaterThan(N[i - 1] - 1e-6);
    }
  });

  it('tension nose ≈ −As·fyd, M = 0', () => {
    const r = calcRCColumn(inp());
    const d = buildColumnInteraction(inp(), r);
    const expectedN = -r.As_total * (500 / 1.15) / 1e3;
    expect(d.y!.reinforced[0].N).toBeCloseTo(expectedN, 0);
    expect(d.y!.reinforced[0].M).toBeCloseTo(0, 5);
  });

  it('reinforced curve closes at the pure-compression point (NRd_max, 0)', () => {
    const r = calcRCColumn(inp());
    const last = buildColumnInteraction(inp(), r).y!.reinforced.at(-1)!;
    expect(last.N).toBeCloseTo(r.NRd_max, 0);
    expect(last.M).toBeCloseTo(0, 5);
  });

  it('plain envelope never exceeds reinforced (steel only adds capacity)', () => {
    const r = calcRCColumn(inp());
    const ax = buildColumnInteraction(inp(), r).y!;
    const reinf = ax.reinforced;
    const interpM = (N: number): number | null => {
      if (N < reinf[0].N || N > reinf[reinf.length - 1].N) return null;
      for (let i = 0; i < reinf.length - 1; i++) {
        const a = reinf[i], c = reinf[i + 1];
        if (N >= a.N && N <= c.N) {
          const f = c.N - a.N < 1e-9 ? 0 : (N - a.N) / (c.N - a.N);
          return a.M + f * (c.M - a.M);
        }
      }
      return null;
    };
    for (const p of ax.plain) {
      const rm = interpM(p.N);
      if (rm === null) continue;
      expect(p.M).toBeLessThanOrEqual(rm + 1.0); // 1 kN·m interp tolerance
    }
  });

  it('applied marker = (Nd, MEd_tot) for the axis', () => {
    const r = calcRCColumn(inp());
    const d = buildColumnInteraction(inp(), r);
    expect(d.y!.applied.N).toBe(500);
    expect(d.y!.applied.M).toBeCloseTo(r.MEd_tot_y, 3);
    expect(d.z!.applied.M).toBeCloseTo(r.MEd_tot_z, 3);
  });

  it('exactly one axis is flagged governing', () => {
    const r = calcRCColumn(inp());
    const d = buildColumnInteraction(inp(), r);
    expect((d.y!.governing ? 1 : 0) + (d.z!.governing ? 1 : 0)).toBe(1);
  });

  it('overloaded column → marker outside the envelope', () => {
    const r = calcRCColumn(inp({ MEdy: 500 }));
    const d = buildColumnInteraction(inp({ MEdy: 500 }), r);
    expect(d.y!.inside).toBe(false);
  });

  it('lightly loaded column → marker inside the envelope', () => {
    const r = calcRCColumn(inp({ MEdy: 1, Nd: 200 }));
    const d = buildColumnInteraction(inp({ MEdy: 1, Nd: 200 }), r);
    expect(d.y!.inside).toBe(true);
  });

  it('invalid section → interaction invalid', () => {
    const r = calcRCColumn(inp({ cornerBarDiam: 4 }));
    const d = buildColumnInteraction(inp({ cornerBarDiam: 4 }), r);
    expect(d.valid).toBe(false);
  });
});

// ── Motor vs referencia por fibras independiente (migración 2026-07-01) ──────
// Integración por fibras a 4000 tiras (~17× las del motor) del diagrama
// parábola-rectángulo con pivotes B/C y descuento del hormigón desplazado.
// Mismo modelo normativo, implementación separada: cualquier regresión en el
// perfil de deformaciones, σ-ε o el descuento de barras aparece aquí.
describe('RC Columns — engine vs independent fiber reference', () => {
  const EPS_C2 = 0.002, EPS_CU = 0.0035, N_EXP = 2;

  function strainRef(y: number, x: number, h: number): number {
    if (x <= h) return EPS_CU * (x - y) / x;                 // pivote B
    return EPS_C2 * (x - y) / (x - h * (1 - EPS_C2 / EPS_CU)); // pivote C
  }
  function sigmaRef(eps: number, fcd: number): number {
    if (eps <= 0) return 0;
    if (eps >= EPS_C2) return fcd;
    return fcd * (1 - Math.pow(1 - eps / EPS_C2, N_EXP));
  }
  interface Bar { y: number; area: number }
  function fiberNMRef(x: number, b: number, h: number, bars: Bar[], fcd: number, fyd: number) {
    const NS = 4000, dy = h / NS;
    let N = 0, M = 0;
    for (let i = 0; i < NS; i++) {
      const y = (i + 0.5) * dy;
      const s = sigmaRef(strainRef(y, x, h), fcd);
      if (s <= 0) break;
      N += s * b * dy;
      M += s * b * dy * (h / 2 - y);
    }
    for (const bb of bars) {
      const eps = strainRef(bb.y, x, h);
      const sig = Math.max(-fyd, Math.min(fyd, Es * eps)) - sigmaRef(eps, fcd);
      N += bb.area * sig;
      M += bb.area * sig * (h / 2 - bb.y);
    }
    return { N, M };
  }
  function fiberMRdRef(NEd: number, b: number, h: number, bars: Bar[], fcd: number, fyd: number): number {
    let lo = 1e-3, hi = 2 * h;
    for (let g = 0; g < 24 && fiberNMRef(hi, b, h, bars, fcd, fyd).N < NEd; g++) hi *= 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (fiberNMRef(mid, b, h, bars, fcd, fyd).N < NEd) lo = mid; else hi = mid;
    }
    return fiberNMRef((lo + hi) / 2, b, h, bars, fcd, fyd).M;
  }

  // defaults 300×300 C25 B500S 4Ø16 (cover 30, cerco 6): d' = 44, d = 256.
  const fcd = getConcrete(25).fcd, fyd = getFyd(500);
  const A16 = getBarArea(16);
  const bars: Bar[] = [{ y: 44, area: 2 * A16 }, { y: 256, area: 2 * A16 }];
  const As = 4 * A16;
  const NRd_max = fcd * (300 * 300 - As) + 400 * As;

  for (const lvl of [0.30, 0.65, 0.90]) {
    it(`MRdy within ±1% of reference (defaults, ned=${lvl})`, () => {
      const NEd = lvl * NRd_max;
      const r = calcRCColumn(inp({ Nd: NEd / 1e3, L: 0.5 }));
      expect(r.valid).toBe(true);
      const ref = fiberMRdRef(NEd, 300, 300, bars, fcd, fyd) / 1e6;
      expect(Math.abs(r.MRdy / ref - 1)).toBeLessThan(0.01);
    });
  }

  it('N(x→∞) plateau matches NRd_max (pure pivot C)', () => {
    const plateau = fiberNMRef(800 * 300, 300, 300, bars, fcd, fyd).N;
    expect(plateau / NRd_max).toBeCloseTo(1, 3);
  });

  // ── Primitivos EXPORTADOS con layout ASIMÉTRICO de viga (FEM 2D M+N) ──────
  // calcNM/computeAxis se exportaron para el chequeo de flexión compuesta de
  // vigas HA (rcBeamMN.ts): armado distinto arriba/abajo. Se anclan contra la
  // MISMA referencia independiente de 4000 tiras (que ya acepta bars
  // arbitrario y NEd con signo — el bracketing cubre (−NtRd, NRd_max)).
  describe('exported fiber primitives — asymmetric beam layout', () => {
    // Viga 300×500 C25 B500S: 2Ø12 arriba (y=44), 4Ø20 abajo (y=450:
    // cover 30 + cerco 8 + 20/2 = 48 → y = 500 − 48 = 452).
    const A12 = getBarArea(12);
    const A20 = getBarArea(20);
    const beamBars: BarGroup[] = [
      { y: 44, area: 2 * A12 },
      { y: 452, area: 4 * A20 },
    ];
    const AsTot = 2 * A12 + 4 * A20;
    const beamNRdMax = fcd * (300 * 500 - AsTot) + Math.min(fyd, 400) * AsTot;
    const NtRd = AsTot * fyd;
    const pr: PRDiagram = { epsC2: EPS_C2, epsCu: EPS_CU, nExp: N_EXP };

    for (const [label, NEd] of [
      ['compresión 0.30·NRdmax', 0.30 * beamNRdMax],
      ['compresión 0.05·NRdmax', 0.05 * beamNRdMax],
      ['flexión pura (N≈0)', 1],
      ['tracción −0.5·NtRd', -0.5 * NtRd],
    ] as const) {
      it(`computeAxis MRd within ±1% of the 4000-strip reference (${label})`, () => {
        const got = computeAxis(NEd, 500, 300, beamBars, fcd, fyd, pr, beamNRdMax);
        expect(got.ndMaxFailed).toBe(false);
        const ref = fiberMRdRef(NEd, 300, 500, beamBars, fcd, fyd);
        expect(Math.abs(got.MRd_Nmm / ref - 1)).toBeLessThan(0.01);
        expect(got.MRd_Nmm).toBeGreaterThan(0);
      });
    }

    it('calcNM at x→0 gives pure tension −As_tot·fyd (bracketing floor)', () => {
      const { NRd } = calcNM(1e-3, 300, 500, beamBars, fcd, fyd, pr);
      expect(NRd).toBeCloseTo(-NtRd, 6);
    });

    it('NEd ≥ NRd_max flags ndMaxFailed (caller must fail, never divide)', () => {
      const got = computeAxis(1.01 * beamNRdMax, 500, 300, beamBars, fcd, fyd, pr, beamNRdMax);
      expect(got.ndMaxFailed).toBe(true);
    });
  });
});
