// Forjados (reticular + losa maciza) — CE Anejo 19 §5.3.2.1, §6.1, §6.2, §7.3
// Run: bun test src/test/calc/rcSlabs.test.ts

import { describe, expect, it } from 'vitest';
import { calcForjados, computeAnchorage, fctmAdherencia } from '../../lib/calculations/rcSlabs.ts';
import { solveRectangular, solveTSection, computeBEff } from '../../lib/calculations/rcTSection.ts';
import { forjadosDefaults, type ForjadosInputs } from '../../data/defaults.ts';
import { getConcrete, getFyd } from '../../data/materials.ts';
import { getBarArea } from '../../data/rebar.ts';

const base: ForjadosInputs = { ...forjadosDefaults };

// ── Pure math: solveRectangular ──────────────────────────────────────────────
describe('solveRectangular (Whitney block)', () => {
  it('x = As·fyd / (0.8·b·fcd)', () => {
    // As = 402mm² (2Ø16), b=120, fcd=25/1.5=16.667, fyd=500/1.15=434.78
    const As = 2 * getBarArea(16);
    const fcd = getConcrete(25).fcd;
    const fyd = getFyd(500);
    const { x } = solveRectangular(120, 310, As, fcd, fyd);
    const expected = (As * fyd) / (0.8 * 120 * fcd);
    expect(x).toBeCloseTo(expected, 3);
  });

  it('MRd = As·fyd·(d − 0.4·x) in kNm', () => {
    const As = 2 * getBarArea(16);
    const fcd = getConcrete(25).fcd;
    const fyd = getFyd(500);
    const { x, MRd } = solveRectangular(120, 310, As, fcd, fyd);
    const expected = (As * fyd * (310 - 0.4 * x)) / 1e6;
    expect(MRd).toBeCloseTo(expected, 4);
  });

  it('sobrearmada (x > x,lim): MRd limitado al bloque en x,lim (fix auditoría #20)', () => {
    // Oracle manual — b=120, d=260, C25 (fcd=16.667), B500S (fyd=434.78), As=800:
    //   x = 800·434.78/(0.8·120·16.667) = 217.4 mm
    //   x,lim = εcu3/(εcu3+εyd)·d = 0.0035/(0.0035+0.0021739)·260 = 160.4 mm
    //   x > x,lim → el acero NO plastifica; la hipótesis fyd daba 60.2 kNm.
    //   MRd,lim = 0.8·160.4·120·16.667·(260−0.4·160.4)/1e6 = 50.26 kNm
    //   (el real con compatibilidad σs<fyd ≈ 53 — el clamp queda del lado seguro)
    const fcd = 25 / 1.5;
    const fyd = 500 / 1.15;
    const { x, MRd } = solveRectangular(120, 260, 800, fcd, fyd);
    expect(x).toBeCloseTo(217.4, 1);
    expect(MRd).toBeCloseTo(50.26, 1);
  });
});

// ── Pure math: computeBEff ──────────────────────────────────────────────────
describe('computeBEff', () => {
  it('intereje < L/5 → b_eff = intereje', () => {
    // L=5000, L0=0.7·L=3500, L0/5=700; intereje=600 < 700 → bEff = 600
    expect(computeBEff(600, 5000, 0.7, 120)).toBe(600);
  });

  it('intereje > L/5 → b_eff = L0/5', () => {
    // L=5000, L0=5000, L0/5=1000; intereje=1200 → bEff = 1000
    expect(computeBEff(1200, 5000, 1.0, 120)).toBe(1000);
  });

  it('never below b_w', () => {
    // intereje=100, L0/5=200, b_w=150 → clamp to 150
    expect(computeBEff(100, 1000, 1.0, 150)).toBe(150);
  });

  it('continuo-interior factor 0.7 reduces L0', () => {
    // L=6000 → L0 = 4200 → L0/5 = 840
    expect(computeBEff(2000, 6000, 0.7, 120)).toBe(840);
  });
});

// ── Pure math: solveTSection ─────────────────────────────────────────────────
describe('solveTSection', () => {
  const fcd = getConcrete(25).fcd;
  const fyd = getFyd(500);

  it('x ≤ h_f → rect-bEff branch', () => {
    // bEff=820, bWeb=120, hFlange=50, d=310, As=2Ø12=226mm²
    // x_rect = 226·434.78 / (0.8·820·16.667) = ~9mm ≤ 50 → rect-bEff
    const r = solveTSection(820, 120, 50, 310, 2 * getBarArea(12), fcd, fyd);
    expect(r.branch).toBe('rect-bEff');
    expect(r.x).toBeLessThanOrEqual(50);
  });

  it('x > h_f → t-real branch', () => {
    // Force huge As so rect x exceeds hFlange
    // As large → x_rect > 50 → enter T-real
    const As = 20 * getBarArea(20); // ~6283mm²
    const r = solveTSection(820, 120, 50, 310, As, fcd, fyd);
    expect(r.branch).toBe('t-real');
    expect(r.x).toBeGreaterThan(50);
  });

  it('t-real MRd = web + flange contributions (caso dúctil, x < x,lim)', () => {
    // As moderada para que el alma quede en rama dúctil: 6Ø20 = 1885 mm²
    // → xWeb ≈ 147 mm < x,lim ≈ 191 mm (la hipótesis fyd es válida).
    const As = 6 * getBarArea(20);
    const bEff = 820, bWeb = 120, hFlange = 50, d = 310;
    const r = solveTSection(bEff, bWeb, hFlange, d, As, fcd, fyd);
    expect(r.branch).toBe('t-real');
    // Recompute manually
    const Asf = ((bEff - bWeb) * hFlange * fcd) / fyd;
    const AsWeb = As - Asf;
    const xWeb = (AsWeb * fyd) / (0.8 * bWeb * fcd);
    const MRdWeb = (AsWeb * fyd * (d - 0.4 * xWeb)) / 1e6;
    const MRdFlange = (Asf * fyd * (d - hFlange / 2)) / 1e6;
    expect(r.MRd).toBeCloseTo(MRdWeb + MRdFlange, 2);
  });

  it('t-real sobrearmada: alma limitada al bloque en x,lim (fix auditoría #20)', () => {
    // 20Ø20 = 6283 mm² → xWeb ≈ 1340 mm ≫ x,lim ≈ 191 mm: la hipótesis fyd
    // daba MRd inflado; ahora el alma aporta como máximo el bloque en x,lim.
    const As = 20 * getBarArea(20);
    const bEff = 820, bWeb = 120, hFlange = 50, d = 310;
    const r = solveTSection(bEff, bWeb, hFlange, d, As, fcd, fyd);
    const Es = 200000, ecu3 = 0.0035;
    const xl = (ecu3 / (ecu3 + fyd / Es)) * d;
    const Asf = ((bEff - bWeb) * hFlange * fcd) / fyd;
    const MRdWebLim = (0.8 * xl * bWeb * fcd * (d - 0.4 * xl)) / 1e6;
    const MRdFlange = (Asf * fyd * (d - hFlange / 2)) / 1e6;
    expect(r.MRd).toBeCloseTo(MRdWebLim + MRdFlange, 2);
  });

  it('Asf ≥ As fallback → rect-bEff', () => {
    // Tiny As, huge flange overhang → Asf ≥ As → fallback
    const As = getBarArea(6); // 28mm²
    const r = solveTSection(2000, 100, 50, 310, As, fcd, fyd);
    expect(r.branch).toBe('rect-bEff');
  });
});

// ── calcForjados: FTUX defaults ──────────────────────────────────────────────
describe('calcForjados — FTUX defaults', () => {
  it('result is valid', () => {
    expect(calcForjados(base).valid).toBe(true);
  });

  it('reticular default: bEff > 0 and ≥ b_w', () => {
    const r = calcForjados(base);
    expect(r.bEff).toBeGreaterThan(0);
    expect(r.bEff).toBeGreaterThanOrEqual(base.bWeb as number);
  });

  it('vano uses rect-bEff branch with default 2Ø12 + 2Ø16 refuerzo', () => {
    // Base 2Ø12 + refuerzo 2Ø16 → x small → should stay inside the flange (hFlange=50)
    const r = calcForjados(base);
    expect(r.vano.branch).toBe('rect-bEff');
  });

  it('AsBase + AsRef = As (reticular vano)', () => {
    const r = calcForjados(base);
    // vano tracción: base_inf (2Ø12) + refuerzo_vano_inf (2Ø16)
    expect(r.vano.AsBase).toBeCloseTo(2 * getBarArea(12), 1);
    expect(r.vano.AsRef ).toBeCloseTo(2 * getBarArea(16), 1);
    expect(r.vano.As).toBeCloseTo(r.vano.AsBase + r.vano.AsRef, 1);
  });

  it('AsBase + AsRef = As (reticular apoyo)', () => {
    const r = calcForjados(base);
    // apoyo tracción: base_sup (2Ø12) + refuerzo_apoyo_sup (2Ø16)
    expect(r.apoyo.AsBase).toBeCloseTo(2 * getBarArea(12), 1);
    expect(r.apoyo.AsRef ).toBeCloseTo(2 * getBarArea(16), 1);
    expect(r.apoyo.As).toBeCloseTo(r.apoyo.AsBase + r.apoyo.AsRef, 1);
  });

  it('zero refuerzo → AsRef = 0 and As = AsBase', () => {
    const r = calcForjados({
      ...base,
      refuerzo_vano_inf_nBars: 0,
      refuerzo_apoyo_sup_nBars: 0,
    });
    expect(r.vano.AsRef).toBe(0);
    expect(r.apoyo.AsRef).toBe(0);
    expect(r.vano.As).toBeCloseTo(r.vano.AsBase, 1);
  });

  it('apoyo uses rect-bw branch', () => {
    const r = calcForjados(base);
    expect(r.apoyo.branch).toBe('rect-bw');
  });
});

// ── Reticular vs maciza ──────────────────────────────────────────────────────
describe('variant switch', () => {
  it('maciza: b flexión = 1000', () => {
    const r = calcForjados({ ...base, variant: 'maciza' });
    expect(r.vano.b).toBe(1000);
    expect(r.apoyo.b).toBe(1000);
  });

  it('maciza: bEff = 0, L0 = 0', () => {
    const r = calcForjados({ ...base, variant: 'maciza' });
    expect(r.bEff).toBe(0);
    expect(r.L0).toBe(0);
  });

  it('maciza: branch = rect', () => {
    const r = calcForjados({ ...base, variant: 'maciza' });
    expect(r.vano.branch).toBe('rect');
    expect(r.apoyo.branch).toBe('rect');
  });

  it('maciza: As aggregates base + refuerzo (per metre)', () => {
    // Defaults: base_inf Ø10/200 + refuerzo_vano_inf inactive (phi=0 → As_ref=0)
    const r = calcForjados({ ...base, variant: 'maciza' });
    const expectedAs = getBarArea(10) * (1000 / 200);
    expect(r.vano.AsBase).toBeCloseTo(expectedAs, 1);
    expect(r.vano.AsRef).toBe(0);
    expect(r.vano.As).toBeCloseTo(expectedAs, 1);
  });

  it('maciza apoyo: base + refuerzo summed', () => {
    // Defaults: base_sup Ø10/200 + refuerzo_apoyo_sup Ø12/200
    const r = calcForjados({ ...base, variant: 'maciza' });
    const expectedBase = getBarArea(10) * (1000 / 200);
    const expectedRef  = getBarArea(12) * (1000 / 200);
    expect(r.apoyo.AsBase).toBeCloseTo(expectedBase, 1);
    expect(r.apoyo.AsRef ).toBeCloseTo(expectedRef, 1);
    expect(r.apoyo.As).toBeCloseTo(expectedBase + expectedRef, 1);
  });
});

// ── Fisuración (wk) — only XC2+ ──────────────────────────────────────────────
describe('fisuración wk', () => {
  it('XC1 → no cracking check emitted', () => {
    const r = calcForjados({ ...base, exposureClass: 'XC1' });
    expect(r.vano.checks.some((c) => c.id === 'cracking')).toBe(false);
    expect(r.apoyo.checks.some((c) => c.id === 'cracking')).toBe(false);
  });

  it('XC2 → cracking check emitted in both zones', () => {
    const r = calcForjados({ ...base, exposureClass: 'XC2' });
    expect(r.vano.checks.some((c) => c.id === 'cracking')).toBe(true);
    expect(r.apoyo.checks.some((c) => c.id === 'cracking')).toBe(true);
  });

  it('XC3 wk > 0', () => {
    const r = calcForjados({ ...base, exposureClass: 'XC3' });
    expect(r.vano.wk).toBeGreaterThan(0);
  });
});

// ── Shear ────────────────────────────────────────────────────────────────────
describe('cortante', () => {
  it('stirrupsEnabled=false → check against VRd,c only', () => {
    const r = calcForjados({ ...base, stirrupsEnabled: false });
    expect(r.VRds).toBe(0);
    expect(r.VRdmax).toBe(0);
    expect(r.shearChecks.some((c) => c.description.includes('sin cercos'))).toBe(true);
  });

  it('stirrupsEnabled=true → VRds>0 and VRdmax>0', () => {
    const r = calcForjados({ ...base, stirrupsEnabled: true });
    expect(r.VRds).toBeGreaterThan(0);
    expect(r.VRdmax).toBeGreaterThan(0);
  });

  it('VRd,s y VRd,max con cotθ=2 (tope del CE) — oracle manual (fix auditoría #3 y 2026-11)', () => {
    // CE Anejo 19 §6.2.3(3): VRd,max = ν1·fcd·bw·z/(cotθ+tanθ), con el MISMO
    // θ que VRd,s. Hand-calc (defaults reticular + cercos apoyo Ø6c/150 2 ramas):
    //   El montaje 2Ø12 + refuerzo 2Ø16 NO caben en una fila del nervio (b_w=120,
    //   cercos Ø6) → se arman en 2 capas (CE Anejo 19 §8.2). Centroide ȳ≈63.8 →
    //   dShear = 350 − 63.8 = 286.2 mm → z = 0.9·286.2 = 257.6 mm.
    //   VRds = (2·28.3/150)·257.6·434.78·2/1000 = 84.53 kN
    //   ν1 = 0.6·(1 − 25/250) = 0.54; cotθ + tanθ = 2 + 0.5 = 2.5
    //   VRdmax = 0.54·16.7·120·257.6/2.5/1000 = 111.51 kN
    const r = calcForjados({ ...base, stirrupsEnabled: true });
    expect(r.VRds).toBeCloseTo(84.53, 1);
    expect(r.VRdmax).toBeCloseTo(111.51, 1);
    expect(r.VRds).toBeLessThan(r.VRdmax);   // con cotθ=2 gobiernan los cercos
  });

  it('high VEd triggers fail when no stirrups', () => {
    const r = calcForjados({ ...base, stirrupsEnabled: false, VEd: 500 });
    const shear = r.shearChecks.find((c) => c.id === 'shear');
    expect(shear?.status).toBe('fail');
  });

  it('VRd,c con factor 100 en (100·ρl·fck)^⅓ — oracle manual (fix auditoría #38)', () => {
    // Defaults reticular sin cercos: montaje 2Ø12 + refuerzo 2Ø16 en 2 capas
    // (CE Anejo 19 §8.2) → d=292.2 (no 312), b=120, As=628 mm² → ρ=0.0179
    //   VRdc1 = 0.12·k·(100·0.0179·25)^⅓·120·292.2 con k=1+√(200/292.2)=1.83
    //   ≈ 27.3 kN
    // Pre-fix sin el 100: VRdc1 ≈ 6 kN y gobernaba νmin ≈ 15.4 kN — capacidad
    // sin cercos infravalorada ×1.8 (falsos FAIL en forjados correctos).
    const r = calcForjados({ ...base, stirrupsEnabled: false });
    expect(r.VRdc).toBeCloseTo(27.31, 1);
  });
});

// ── Esbeltez L/d — exención de flecha (fix auditoría #37) ───────────────────
describe('esbeltez L/d (CE Anejo 19 §7.4.2)', () => {
  it('defaults reticular: L/d = 17.1 ≤ lim 37.4 → exento (oracle manual)', () => {
    // d = 292.2 (montaje 2Ø12 + refuerzo 2Ø16 en 2 capas, CE 69.4); L/d = 5000/292.2 = 17.1
    // ρ = 628/(700·292.2) = 0.00307; ρ0 = √25·10⁻³ = 0.005 → rama ρ ≤ ρ0
    // K = 1.5 (continuo-interior) ·0.8 (T con bEff/bw = 700/120 > 3) = 1.2
    // lim = 1.2·(11 + 1.5·5·1.628 + 3.2·5·0.628^1.5) = 37.4
    const r = calcForjados({ ...base, stirrupsEnabled: false });
    const ld = r.infoChecks.find((c) => c.id === 'esbeltez-flecha')!;
    expect(ld.status).toBe('ok');
    expect(ld.value).toContain('17,1');
    expect(ld.limit).toContain('37,4');
  });

  it('vano largo y canto escaso → warn "comprobar flecha aparte"', () => {
    // L=9 m con h=300: L/d sube y el límite baja (×7/L para L>7m).
    const r = calcForjados({ ...base, spanLength: 9000, h: 300, stirrupsEnabled: false });
    const ld = r.infoChecks.find((c) => c.id === 'esbeltez-flecha')!;
    expect(ld.utilization).toBeGreaterThan(1);
    expect(ld.status).toBe('warn');
    expect(ld.description).toContain('comprobar flecha aparte');
  });
});

// ── As,min por variante (fix auditoría #39) ─────────────────────────────────
describe('As,min losa maciza vs nervio (CE Anejo 19 §9.2.1.1 (9.1))', () => {
  it('maciza: As,min = W/z · fctm,fl/fyd sobre la franja 1000 × h — oracle manual', () => {
    // h = 350, C25 (fctm = 2,56), B500: W/z = 1000·350/4,8 = 72 917 mm²,
    // fctm,fl = (1,6 − 0,35)·2,56 = 3,20 → 72 917·3,20/434,78 = 537 mm²/m.
    // Hasta el 2026-09-25 era el 0,26·fctm/fyk·b·d del Eurocódigo (419), que el
    // CE no adopta; y antes aún el 2,8 ‰·b·h de la EHE (980).
    const r = calcForjados({ ...base, variant: 'maciza' });
    const asmin = r.vano.checks.find((c) => c.id === 'as-min')!;
    expect(asmin.value).toContain('537');
    // Ø10/200 = 393 mm²/m no llega al mínimo del CE en 35 cm.
    expect(asmin.utilization).toBeCloseTo(536.7 / 392.7, 2);
  });

  it('reticular: la T bruta del nervio, W a la fibra traccionada', () => {
    // bEff = min(820, 0,70·5000/5) = 700; T 700/50/120/350: A = 71 000 mm²,
    // ySup = 113,73, I = 8,208·10⁸ mm⁴ → Winf = 3,474·10⁶, Wsup = 7,217·10⁶.
    // Vano (tracciona abajo): 3,474·10⁶/280·3,20/434,78 = 91 mm² (antes 118,
    // el 2,8 ‰·bw·h). Apoyo (ala en tracción): 7,217·10⁶/280·3,20/434,78 = 190.
    const r = calcForjados(base);
    expect(r.vano.checks.find((c) => c.id === 'as-min')!.value).toContain('91');
    expect(r.apoyo.checks.find((c) => c.id === 'as-min')!.value).toContain('190');
  });
});

// ── Normalización de signo de momentos (fix auditoría #53) ──────────────────
describe('momentos de apoyo con signo negativo (|M-|)', () => {
  it('apoyo_Md negativo se normaliza: flexión y fisuración como con |M|', () => {
    // Pre-fix: apoyo_Md<0 daba utilización negativa → verde incondicional y
    // (con XC2+) omitía el check de fisuración silenciosamente.
    const pos = calcForjados({ ...base, exposureClass: 'XC2', apoyo_Md: 25, apoyo_M_G: 18, apoyo_M_Q: 10 });
    const neg = calcForjados({ ...base, exposureClass: 'XC2', apoyo_Md: -25, apoyo_M_G: -18, apoyo_M_Q: -10 });
    const bPos = pos.apoyo.checks.find((c) => c.id === 'bending')!;
    const bNeg = neg.apoyo.checks.find((c) => c.id === 'bending')!;
    expect(bNeg.utilization).toBeCloseTo(bPos.utilization, 6);
    expect(bNeg.utilization).toBeGreaterThan(0);
    // La fisuración no desaparece con el signo negativo.
    expect(neg.apoyo.checks.some((c) => c.id === 'cracking')).toBe(true);
    expect(neg.apoyo.wk).toBeCloseTo(pos.apoyo.wk, 6);
  });
});

// ── Cuantías ──────────────────────────────────────────────────────────────────
describe('cuantías mín/máx', () => {
  it('As,min check present in both zones', () => {
    const r = calcForjados(base);
    expect(r.vano.checks.some((c) => c.id === 'as-min')).toBe(true);
    expect(r.apoyo.checks.some((c) => c.id === 'as-min')).toBe(true);
  });

  it('As,max check present in both zones', () => {
    const r = calcForjados(base);
    expect(r.vano.checks.some((c) => c.id === 'as-max')).toBe(true);
    expect(r.apoyo.checks.some((c) => c.id === 'as-max')).toBe(true);
  });

  it('tiny As → As,min fails', () => {
    // Base 1Ø6 + no refuerzo → total ~28 mm², far below min
    const r = calcForjados({
      ...base,
      base_inf_nBars: 1, base_inf_barDiam: 6,
      refuerzo_vano_inf_nBars: 0,
    });
    const asMin = r.vano.checks.find((c) => c.id === 'as-min');
    expect(asMin?.status).toBe('fail');
  });
});

// ── Bar spacing (CE Anejo 19 §8.2 — Ø reales + multicapa) ──────────────────────────
describe('separación barras', () => {
  it('default (2Ø12 + 2Ø16) CUMPLE en 2 capas — Ø reales, no max Ø para todas', () => {
    // El bug previo: 4×Ø16 en 1 capa → 120−60−64 = −4 → INCUMPLE espurio.
    // Ahora: capa1 2Ø12 (44≤60) + capa2 2Ø16 (52≤60) → caben. s mín de la capa
    // más apretada = (60−32)/1 = 28 mm ≥ 20 → ok.
    const r = calcForjados(base);
    const sp = r.vano.checks.find((c) => c.id === 'bar-spacing');
    expect(sp).toBeDefined();
    expect(sp!.status).toBe('ok');
    expect(sp!.value).toContain('28');
    expect(sp!.description).toContain('2 capas');
    // ya NO se emite la fila 'impossible'
    expect(r.vano.checks.some((c) => c.id === 'bar-spacing-impossible')).toBe(false);
  });

  it('cabe en 1 capa cuando hay sitio (2Ø12 base, sin refuerzo)', () => {
    const r = calcForjados({ ...base, refuerzo_vano_inf_nBars: 0 });
    const sp = r.vano.checks.find((c) => c.id === 'bar-spacing')!;
    expect(sp.status).toBe('ok');
    expect(sp.description).not.toContain('capas');   // 1 capa → sin sufijo
  });

  it('1 barra por capa → sin separación horizontal que comprobar (ok)', () => {
    // 1Ø20 base + 1Ø20 refuerzo, b_w=100 → clearWidth=40. En 1 fila necesitarían
    // 20+20+20=60 > 40 → 2 capas de 1 barra cada una; sin separación horizontal.
    const r = calcForjados({
      ...base, bWeb: 100,
      base_inf_nBars: 1, base_inf_barDiam: 20,
      refuerzo_vano_inf_nBars: 1, refuerzo_vano_inf_barDiam: 20,
    });
    const sp = r.vano.checks.find((c) => c.id === 'bar-spacing')!;
    expect(sp.status).toBe('ok');
    expect(sp.value).toContain('1 barra/capa');
  });

  it('reticular: bars dont fit ni en 2 capas → bar-spacing-impossible', () => {
    // Base 10Ø20 en b_w=120 → ni una capa cabe (380 ≫ 60). El tope de 2 capas
    // mantiene el INCUMPLE (no se reparte en 5 capas absurdas).
    const r = calcForjados({
      ...base,
      base_inf_nBars: 10, base_inf_barDiam: 20,
      refuerzo_vano_inf_nBars: 0,
    });
    const fail = r.vano.checks.find((c) => c.id === 'bar-spacing-impossible');
    expect(fail?.status).toBe('fail');
  });

  it('activar cercos estrecha el ancho libre → 2Ø16/capa puede dejar de caber', () => {
    // Sin cercos clearWidth=60 (2Ø16 = 52 ✓). Con cercos Ø6 clearWidth=48 → 2Ø16
    // necesitan 52 > 48 → la capa de refuerzo no cabe (CE 69.4 cuenta el cerco).
    const r = calcForjados({ ...base, stirrupsEnabled: true });
    expect(r.vano.checks.some((c) => c.id === 'bar-spacing-impossible')).toBe(true);
  });

  // CE Anejo 19 §9.3.1.1(3): s,max,slabs < 300 mm y < 3·h. El motor usaba 400
  // (el recomendado del Eurocódigo) hasta el 2026-09-26.
  describe('separación máxima en losa maciza (§9.3.1.1(3))', () => {
    const maciza = (s: number, h = 350) => calcForjados({
      ...base, variant: 'maciza', h, base_inf_s_mac: s, base_sup_s_mac: s,
    });
    const fila = (s: number, h?: number) => maciza(s, h).vano.checks.find((c) => c.id === 'bar-spacing-maciza');

    it('el tope es 300 mm aunque 3·h sea mayor', () => {
      expect(fila(250)?.limit).toBe('s,max = 300 mm');
      expect(fila(350)?.status).toBe('fail');   // con 400 pasaba
    });

    // Regla constructiva: cumple o no. «No debe superar»: el caso límite cumple,
    // y cerca del límite no hay advertencia (c/290 no está «casi agotada»).
    it('es constructiva: c/300 cumple y c/290 no avisa', () => {
      expect(fila(300)?.status).toBe('ok');
      expect(fila(300)?.utilization).toBe(1);
      expect(fila(290)?.status).toBe('ok');
      expect(fila(301)?.status).toBe('fail');
    });

    it('en una losa fina manda 3·h', () => {
      expect(fila(250, 80)?.limit).toBe('s,max = 240 mm');
      expect(fila(250, 80)?.status).toBe('fail');
    });

    it('la mínima del nervio también es constructiva: s = 20 frente a 20 cumple', () => {
      // 25+5 con 2Ø12 + 2Ø20: la capa de refuerzo deja 60 − 40 = 20 mm libres,
      // justo el mínimo max(20, Ø) = 20. Con `toStatus` salía INCUMPLE.
      const r = calcForjados({ ...base, tipologia: '25+5', h: 300, refuerzo_vano_inf_barDiam: 20 });
      const c = r.vano.checks.find((k) => k.id === 'bar-spacing');
      expect(c?.value).toBe('s = 20 mm');
      expect(c?.status).toBe('ok');
      // Y con un milímetro menos de nervio ya no caben: sale la fila de «no caben».
      const r2 = calcForjados({ ...base, tipologia: 'custom', bWeb: 119, refuerzo_vano_inf_barDiam: 20 });
      expect(r2.vano.checks.find((k) => k.id === 'bar-spacing-impossible')?.status).toBe('fail');
    });

    it('cita el artículo de la separación máxima, no el de la mínima', () => {
      expect(fila(200)?.article).toBe('CE Anejo 19 §9.3.1.1(3)');
    });
  });

  it('maciza: uses bar-spacing-maciza check', () => {
    const r = calcForjados({ ...base, variant: 'maciza' });
    expect(r.vano.checks.some((c) => c.id === 'bar-spacing-maciza')).toBe(true);
  });
});

// ── FTUX default abre en CUMPLE (recalibrado VEd 30→22) ─────────────────────
describe('default reticular abre sin INCUMPLE', () => {
  it('todas las comprobaciones bloqueantes (flexión/cuantías/separación/cortante) = ok', () => {
    const r = calcForjados(base);
    const blocking = [...r.vano.checks, ...r.apoyo.checks, ...r.shearChecks];
    const failed = blocking.filter((c) => c.status === 'fail').map((c) => c.id);
    expect(failed).toEqual([]);
  });
});

// ── Info checks ──────────────────────────────────────────────────────────────
describe('info checks (no bloqueantes)', () => {
  it('reticular: biaxial note', () => {
    const r = calcForjados(base);
    expect(r.infoChecks.some((c) => c.id === 'biaxial-note')).toBe(true);
  });

  it('maciza: armadura de reparto note (CE Anejo 19 §9.3.1.1)', () => {
    const r = calcForjados({ ...base, variant: 'maciza' });
    expect(r.infoChecks.some((c) => c.id === 'armadura-reparto')).toBe(true);
  });
});

// ── Invalid inputs ───────────────────────────────────────────────────────────
describe('input validation', () => {
  it('h ≤ 0 → invalid', () => {
    const r = calcForjados({ ...base, h: 0 });
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('b_w ≤ 0 (reticular) → invalid', () => {
    const r = calcForjados({ ...base, bWeb: 0 });
    expect(r.valid).toBe(false);
  });

  it('Ø/s ≤ 0 (maciza base) → invalid', () => {
    const r = calcForjados({ ...base, variant: 'maciza', base_inf_s_mac: 0 });
    expect(r.valid).toBe(false);
  });

  it('invalid exposure class → invalid', () => {
    const r = calcForjados({ ...base, exposureClass: 'FOO' });
    expect(r.valid).toBe(false);
  });

  it('cover so large d ≤ 0 → invalid', () => {
    const r = calcForjados({ ...base, cover: 500 });
    expect(r.valid).toBe(false);
  });
});

// ── Tipo vano → L0 factor ────────────────────────────────────────────────────
describe('tipo vano L0 factor', () => {
  it('biapoyado: L0 = L', () => {
    const r = calcForjados({ ...base, tipoVano: 'biapoyado', spanLength: 5000 });
    expect(r.L0).toBe(5000);
  });

  it('continuo-extremo: L0 = 0.85 L', () => {
    const r = calcForjados({ ...base, tipoVano: 'continuo-extremo', spanLength: 5000 });
    expect(r.L0).toBeCloseTo(4250, 0);
  });

  it('continuo-interior: L0 = 0.70 L', () => {
    const r = calcForjados({ ...base, tipoVano: 'continuo-interior', spanLength: 5000 });
    expect(r.L0).toBeCloseTo(3500, 0);
  });

  it('voladizo: L0 = 2 L', () => {
    const r = calcForjados({ ...base, tipoVano: 'voladizo', spanLength: 3000 });
    expect(r.L0).toBe(6000);
  });
});

// ── Anclaje (CE Anejo 19 §8.4.4) ──────────────────────────────────────────────
describe('computeAnchorage (CE Anejo 19 §8.4.4)', () => {
  it('lb_rqd = (Ø/4)·(fyd/fbd) for Pos I — fctd con 0.7·fctm/γc (fix auditoría #19)', () => {
    // Ø16, fck=25 → fctm≈2.6
    // fctd = αct·fctk,0.05/γc = 0.7·fctm/1.5 (CE Anejo 19 §3.1.6 + Tabla 3.1)
    // Pos I (inf, h=350) → η1=1, fbd = 2.25·1·1·fctd
    // fyd = 500/1.15. Para C25: fctd = 0.7·2.56/1.5 = 1.20 MPa → fbd = 2.69
    // → lb_rqd = 4·434.78/2.69 ≈ 646 mm (la fórmula sin 0.7 daba ≈ 453, 30% corta)
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    const fctd = (0.7 * mat.fctm) / 1.5;
    const fbd  = 2.25 * 1.0 * 1.0 * fctd;
    const expected = (16 / 4) * (fyd / fbd);
    const a = computeAnchorage(16, mat.fctm, fyd, 'inf', 350);
    expect(a.position).toBe('I');
    expect(a.lb_rqd).toBeCloseTo(expected, 2);
    expect(a.lb_rqd).toBeGreaterThan(600);   // C25/Ø16/B500S Pos I ≈ 646 mm
  });

  // Figura A19.8.2 (BOE pág. 98407): con h ≤ 250 mm la adherencia es buena
  // para todas las barras; con h > 250, sólo en los 250 mm inferiores. El
  // umbral fue 300 hasta el 2026-09-26 y un 25+5 (h = 300) anclaba sus barras
  // superiores en posición I, un 30 % corto.
  it('barras superiores: posición II en cuanto h > 250 mm', () => {
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    expect(computeAnchorage(16, mat.fctm, fyd, 'sup', 350).position).toBe('II');
    expect(computeAnchorage(16, mat.fctm, fyd, 'sup', 300).position).toBe('II');
    expect(computeAnchorage(16, mat.fctm, fyd, 'sup', 251).position).toBe('II');
  });

  it('barras superiores: posición I con h ≤ 250 mm (losa fina)', () => {
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    expect(computeAnchorage(12, mat.fctm, fyd, 'sup', 250).position).toBe('I');
    expect(computeAnchorage(12, mat.fctm, fyd, 'sup', 200).position).toBe('I');
  });

  it('barras inferiores: siempre posición I (están en los 250 mm de abajo)', () => {
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    expect(computeAnchorage(16, mat.fctm, fyd, 'inf', 800).position).toBe('I');
  });

  it('el 25+5 (h = 300) ancla sus barras superiores en posición II en la tabla', () => {
    const r = calcForjados({ ...base, tipologia: '25+5', h: 300 });
    const fila = r.apoyo.checks.find((c) => c.id === 'anchorage-refuerzo-apoyo-sup');
    expect(fila?.description).toMatch(/Pos\. II/);
    expect(fila?.value).toBe('lb,rqd = 924 mm');
  });

  it('la adherencia no crece más allá de fck = 60 (8.2)', () => {
    expect(fctmAdherencia(70)).toBe(fctmAdherencia(60));
    expect(fctmAdherencia(90)).toBe(getConcrete(60).fctm);
    expect(fctmAdherencia(30)).toBe(getConcrete(30).fctm);
    const fyd = getFyd(500);
    const r80 = calcForjados({ ...base, fck: 80 });
    const fila = r80.vano.checks.find((c) => c.id === 'anchorage-refuerzo-vano-inf');
    const esperado = computeAnchorage(16, getConcrete(60).fctm, fyd, 'inf', 350).lb_rqd;
    expect(fila?.value).toBe(`lb,rqd = ${esperado.toFixed(0)} mm`);
  });

  it('con la tensión real de la barra, lb,rqd baja en proporción y lb,min no', () => {
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    const lleno = computeAnchorage(12, mat.fctm, fyd, 'inf', 350);
    const medio = computeAnchorage(12, mat.fctm, fyd, 'inf', 350, fyd / 2);
    expect(medio.lb_rqd).toBeCloseTo(lleno.lb_rqd / 2, 9);
    expect(medio.lb_min).toBe(lleno.lb_min);
  });

  it('lb_min = max(0.3·lb_rqd, 10·Ø, 100 mm)', () => {
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    const a = computeAnchorage(16, mat.fctm, fyd, 'inf', 350);
    const expected = Math.max(0.3 * a.lb_rqd, 10 * 16, 100);
    expect(a.lb_min).toBeCloseTo(expected, 3);
  });

  it('Pos II (η1=0.7) → lb_rqd is ~1/0.7 larger than Pos I', () => {
    const mat = getConcrete(25);
    const fyd = getFyd(500);
    const posI  = computeAnchorage(16, mat.fctm, fyd, 'inf', 350);
    const posII = computeAnchorage(16, mat.fctm, fyd, 'sup', 350);
    expect(posII.lb_rqd / posI.lb_rqd).toBeCloseTo(1 / 0.7, 2);
  });
});

describe('anchorage checks emitted', () => {
  it('reticular defaults → 2 anchorage checks per zone (base + refuerzo)', () => {
    const r = calcForjados(base);
    const vanoAnch  = r.vano.checks.filter((c) => c.id.startsWith('anchorage-'));
    const apoyoAnch = r.apoyo.checks.filter((c) => c.id.startsWith('anchorage-'));
    expect(vanoAnch.length).toBe(2);
    expect(apoyoAnch.length).toBe(2);
    expect(vanoAnch.every((c) => c.article === 'CE Anejo 19 §8.4.4')).toBe(true);
  });

  it('no refuerzo → only 1 anchorage check per zone (base only)', () => {
    const r = calcForjados({
      ...base,
      refuerzo_vano_inf_nBars: 0,
      refuerzo_apoyo_sup_nBars: 0,
    });
    const vanoAnch  = r.vano.checks.filter((c) => c.id.startsWith('anchorage-'));
    const apoyoAnch = r.apoyo.checks.filter((c) => c.id.startsWith('anchorage-'));
    expect(vanoAnch.length).toBe(1);
    expect(apoyoAnch.length).toBe(1);
    expect(vanoAnch[0].id).toBe('anchorage-base-inf');
    expect(apoyoAnch[0].id).toBe('anchorage-base-sup');
  });

  it('maciza: refuerzo_vano vacío (phi=0) → sólo base en vano', () => {
    // Defaults: refuerzo_vano_inf_phi_mac=0 → refuerzo inactivo
    const r = calcForjados({ ...base, variant: 'maciza' });
    const vanoAnch  = r.vano.checks.filter((c) => c.id.startsWith('anchorage-'));
    const apoyoAnch = r.apoyo.checks.filter((c) => c.id.startsWith('anchorage-'));
    expect(vanoAnch.length).toBe(1);
    expect(vanoAnch[0].id).toBe('anchorage-base-inf');
    // apoyo default: base + refuerzo Ø12/200
    expect(apoyoAnch.length).toBe(2);
  });

  it('anchorage checks are non-blocking (status=ok, utilization=0)', () => {
    const r = calcForjados(base);
    const anch = [...r.vano.checks, ...r.apoyo.checks]
      .filter((c) => c.id.startsWith('anchorage-'));
    for (const c of anch) {
      expect(c.status).toBe('ok');
      expect(c.utilization).toBe(0);
    }
  });

  it('d_eff: montaje + refuerzo en 2 capas → centroide ponderado (CE 69.4)', () => {
    // Base 2Ø12 + refuerzo 2Ø16 no caben en una fila (b_w=120, sin cercos) → 2 capas.
    // Capa1 (2Ø12) en la cara: y1 = 30 + 12/2 = 36. Separación libre sv = max(20,16) = 20.
    // Capa2 (2Ø16): y2 = 30 + 12 + 20 + 16/2 = 70. Centroide ponderado por área:
    //   ȳ = (226.2·36 + 402.1·70)/628.3 = 57.8 → d = 350 − 57.8 = 292.2 mm.
    // (La fórmula vieja monocapa daba 312, sobreestimando el brazo mecánico.)
    const r = calcForjados(base);
    const A12 = getBarArea(12), A16 = getBarArea(16);
    const yBar = (2 * A12 * 36 + 2 * A16 * 70) / (2 * A12 + 2 * A16);
    expect(r.vano.d).toBeCloseTo((base.h as number) - yBar, 1);
    expect(r.vano.d).toBeCloseTo(292.2, 0);
    // apoyo (M−) es simétrico: base_sup 2Ø12 + refuerzo_apoyo_sup 2Ø16 → mismo d.
    expect(r.apoyo.d).toBeCloseTo(r.vano.d, 1);
  });

  it('d_eff uses base Ø (single layer) when refuerzo is absent', () => {
    const r = calcForjados({ ...base, refuerzo_vano_inf_nBars: 0 });
    // Base 2Ø12 solo → cabe en 1 capa → d = h − cover − Ø/2 (sin reducción).
    const expectedDVano = (base.h as number) - (base.cover as number) - 0 - 12 / 2;
    expect(r.vano.d).toBeCloseTo(expectedDVano, 1);
  });
});

// ── Reglas constructivas: cumplen o no (criterio del usuario, 2026-09-26) ────
// El caso límite cumple y no hay franja de advertencia al 95 %: eso es de las
// comprobaciones de agotamiento.
describe('reglas constructivas de los cercos — cumple o no', () => {
  const conCercos = (s: number) =>
    calcForjados({ ...base, stirrupsEnabled: true, apoyo_stirrupSpacing: s });
  const fila = (s: number, id: string) => conCercos(s).shearChecks.find((c) => c.id === id)!;

  it('separación máxima: s = s,max cumple, al 97 % no avisa, 1 % más no cumple', () => {
    const s0 = base.apoyo_stirrupSpacing as number;
    const sMax = s0 / fila(s0, 'stirrup-spacing-max').utilization;
    expect(fila(sMax, 'stirrup-spacing-max').status).toBe('ok');
    expect(fila(0.97 * sMax, 'stirrup-spacing-max').status).toBe('ok');
    expect(fila(1.01 * sMax, 'stirrup-spacing-max').status).toBe('fail');
  });

  it('cuantía mínima: ρw = ρw,min cumple y cita el §9.2.2(5)', () => {
    const s0 = base.apoyo_stirrupSpacing as number;
    const sLim = s0 / fila(s0, 'rho-w-min').utilization;   // ρw ∝ 1/s
    const lim = fila(sLim, 'rho-w-min');
    expect(lim.utilization).toBeCloseTo(1, 6);
    expect(lim.status).toBe('ok');
    expect(lim.article).toBe('CE Anejo 19 §9.2.2(5)');
    expect(fila(0.97 * sLim, 'rho-w-min').status).toBe('ok');
    expect(fila(1.01 * sLim, 'rho-w-min').status).toBe('fail');
  });

  it('la cuantía de cercos no avisa por la separación: eso lo dice su propia fila', () => {
    // Hasta el 2026-09-27, con s > 0,75·d la fila de ρw salía ADVERTENCIA.
    const s0 = base.apoyo_stirrupSpacing as number;
    const sMax = s0 / fila(s0, 'stirrup-spacing-max').utilization;
    const s = 1.05 * sMax;
    expect(fila(s, 'rho-w-min').utilization).toBeLessThan(1);
    expect(fila(s, 'rho-w-min').status).toBe('ok');
    expect(fila(s, 'stirrup-spacing-max').status).toBe('fail');
  });
});

describe('cuantías mínima y máxima de flexión — cumple o no', () => {
  it('as-min y as-max no tienen franja de advertencia', () => {
    for (const variant of ['reticular', 'maciza'] as const) {
      const r = calcForjados({ ...base, variant });
      for (const sec of [r.vano, r.apoyo]) {
        for (const id of ['as-min', 'as-max']) {
          const c = sec.checks.find((ch) => ch.id === id)!;
          expect(c.status).toBe(c.utilization <= 1 ? 'ok' : 'fail');
        }
      }
    }
  });
});
