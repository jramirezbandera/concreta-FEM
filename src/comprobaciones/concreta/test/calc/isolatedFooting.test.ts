// Isolated footing test suite — sigma_adm input + distribution classification
// Run: bun test src/test/calc/isolatedFooting.test.ts

import { describe, expect, it } from 'vitest';
import { calcIsolatedFooting } from '../../lib/calculations/isolatedFooting.ts';
import { isolatedFootingDefaults } from '../../data/defaults.ts';
import { getBarArea } from '../../data/rebar.ts';

const base = { ...isolatedFootingDefaults };
// base: B=L=1.8, h=0.6, bc=hc=0.4, Df=0.8, cover=60
//       sigma_adm=200 kPa, loadsAreFactored=false, loadFactor=1.35
//       N=300, Mx=My=H=0, fck=25, fyk=500, phi_x=phi_y=16, s_x=s_y=200
//       gamma_soil=18 kN/m3, mu_friction=0.5

// ── 1. FTUX defaults — trapezoidal, all OK ──────────────────────────────────

describe('FTUX defaults', () => {
  it('result is valid', () => {
    expect(calcIsolatedFooting(base).valid).toBe(true);
  });

  it('no check fails', () => {
    const r = calcIsolatedFooting(base);
    for (const c of r.checks) {
      expect(c.status, `check ${c.id} should not fail`).not.toBe('fail');
    }
  });

  it('defaults classify as trapezoidal (no eccentricity)', () => {
    const r = calcIsolatedFooting(base);
    expect(r.distributionType).toBe('trapezoidal');
    expect(r.ex_sls).toBeCloseTo(0, 3);
    expect(r.ey_sls).toBeCloseTo(0, 3);
  });
});

// ── 2. Loads derivation — sin_mayorar mode ──────────────────────────────────

describe('Loads — sin_mayorar mode', () => {
  it('SLS = input, ELU = input · γ', () => {
    const r = calcIsolatedFooting({
      ...base, loadsAreFactored: false, loadFactor: 1.35,
      N: 200, Mx: 30, My: 40, H: 10,
    });
    expect(r.N_sls).toBeCloseTo(200, 3);
    expect(r.Mx_sls).toBeCloseTo(30, 3);
    expect(r.N_elu).toBeCloseTo(200 * 1.35, 3);
    expect(r.My_elu).toBeCloseTo(40 * 1.35, 3);
    expect(r.H_elu).toBeCloseTo(10 * 1.35, 3);
  });

  it('custom γ propagates correctly', () => {
    const r = calcIsolatedFooting({
      ...base, loadsAreFactored: false, loadFactor: 1.5, N: 100,
    });
    expect(r.N_elu).toBeCloseTo(150, 3);
  });
});

// ── 3. Loads derivation — mayoradas mode ─────────────────────────────────────

describe('Loads — mayoradas mode', () => {
  it('ELU = input, SLS = input / γ', () => {
    const r = calcIsolatedFooting({
      ...base, loadsAreFactored: true, loadFactor: 1.35,
      N: 270, Mx: 27, My: 13.5, H: 6.75,
    });
    expect(r.N_elu).toBeCloseTo(270, 3);
    expect(r.Mx_elu).toBeCloseTo(27, 3);
    expect(r.N_sls).toBeCloseTo(270 / 1.35, 3);
    expect(r.My_sls).toBeCloseTo(13.5 / 1.35, 3);
  });

  it('round-trip: factored=true with x → unfactored=false with x/γ produces same SLS', () => {
    const r1 = calcIsolatedFooting({ ...base, loadsAreFactored: true,  N: 405 });
    const r2 = calcIsolatedFooting({ ...base, loadsAreFactored: false, N: 300 });
    expect(r1.N_sls).toBeCloseTo(r2.N_sls, 3);
  });
});

// ── 4. Distribution classification ───────────────────────────────────────────

describe('Distribution classification', () => {
  it('small eccentricity → trapezoidal (ex < B/6)', () => {
    // B/6 = 0.3 m. ex = My/Ntot < 0.3 → trapezoidal
    const r = calcIsolatedFooting({ ...base, My: 50 });
    expect(r.distributionType).toBe('trapezoidal');
  });

  it('one eccentricity beyond core → bitriangular_uniaxial', () => {
    // ex must exceed B/6 only — push My way beyond core (~0.3 m → My ~ 110 kNm at N≈360)
    const r = calcIsolatedFooting({ ...base, My: 150 });
    expect(r.distributionType).toBe('bitriangular_uniaxial');
    expect(r.ex_over_B6).toBeGreaterThan(1);
  });

  it('both eccentricities beyond core → bitriangular_biaxial', () => {
    const r = calcIsolatedFooting({ ...base, My: 150, Mx: 150 });
    expect(r.distributionType).toBe('bitriangular_biaxial');
    expect(r.ex_over_B6).toBeGreaterThan(1);
    expect(r.ey_over_L6).toBeGreaterThan(1);
  });

  it('extreme eccentricity (ex ≥ B/2) → overturning_fail', () => {
    // Ntot ≈ 361 kN, B/2 = 0.9 m → My ≥ 325 kNm
    const r = calcIsolatedFooting({ ...base, My: 400 });
    expect(r.distributionType).toBe('overturning_fail');
    expect(r.sigma_max).toBe(Infinity);
  });

  it('núcleo rómbico: ex=B/8, ey=L/8 → contacto parcial biaxial (fix auditoría #10)', () => {
    // ex/B + ey/L = 0.25 > 1/6: σmin lineal = σc·(1−0.75−0.75) < 0 → hay
    // despegue real aunque ex ≤ B/6 y ey ≤ L/6 por separado. La condición
    // rectangular clasificaba trapezoidal y el clamp σmin=0 ocultaba el
    // despegue con σmax subestimada (lineal 277.7 < real 284.0 kPa aquí,
    // y la diferencia crece al alejarse del rombo).
    const r = calcIsolatedFooting({ ...base, Mx: 81, My: 81 });
    expect(r.distributionType).toBe('bitriangular_biaxial');
    expect(r.loaded_area_fraction).toBeLessThan(1);
    const Ntot = r.N_sls + r.W_footing + r.W_soil;
    const sigma_c = Ntot / (1.8 * 1.8);
    const lineal = sigma_c * (1 + 6 * r.ex_sls / 1.8 + 6 * r.ey_sls / 1.8);
    expect(r.sigma_max).toBeGreaterThan(lineal);
  });

  it('dentro del rombo (ex/B + ey/L ≤ 1/6) sigue trapezoidal con σmin ≥ 0 real', () => {
    const r = calcIsolatedFooting({ ...base, Mx: 25, My: 25 });
    expect(r.distributionType).toBe('trapezoidal');
    expect(r.ex_sls / 1.8 + r.ey_sls / 1.8).toBeLessThanOrEqual(1 / 6);
    expect(r.sigma_min).toBeGreaterThanOrEqual(0);
  });
});

// ── 5. Stress closed-forms ───────────────────────────────────────────────────

describe('Stress — closed-form values', () => {
  it('trapezoidal: σmax = N/A · (1 + 6e/B) at uniaxial small ecc', () => {
    // B = L = 1.8 → A = 3.24 m². N_sls is augmented by W_footing+W_soil.
    // W_footing = 25·1.8·1.8·0.6 = 48.6 kN; W_soil = 18·(0.8-0.6)·(3.24-0.16) = 11.088
    // Ntot = 300 + 48.6 + 11.088 = 359.688 kN; ex = 30/Ntot = 0.0834 m (< B/6=0.3)
    // σ_c = 110.95 kPa; σmax = σ_c·(1 + 6·0.0834/1.8) = 110.95·(1 + 0.278) = 141.8 kPa
    const r = calcIsolatedFooting({ ...base, My: 30 });
    expect(r.distributionType).toBe('trapezoidal');
    const Ntot = r.N_sls + r.W_footing + r.W_soil;
    const sigma_c = Ntot / (1.8 * 1.8);
    const expected = sigma_c * (1 + 6 * r.ex_sls / 1.8);
    expect(r.sigma_max).toBeCloseTo(expected, 1);
  });

  it('bitri uniaxial: σmax matches Meyerhof closed form 2N/(3·L·(B/2−ex))', () => {
    const r = calcIsolatedFooting({ ...base, My: 150 });
    expect(r.distributionType).toBe('bitriangular_uniaxial');
    const Ntot = r.N_sls + r.W_footing + r.W_soil;
    const expected = (2 * Ntot) / (3 * 1.8 * (1.8 / 2 - r.ex_sls));
    expect(r.sigma_max).toBeCloseTo(expected, 1);
    expect(r.sigma_min).toBe(0);
    expect(r.loaded_area_fraction).toBeLessThan(1);
  });
});

// ── 6. Stability ─────────────────────────────────────────────────────────────

describe('Stability', () => {
  it('no overturn check when M = 0 (no destabilizing moment)', () => {
    const r = calcIsolatedFooting(base);
    expect(r.checks.find((c) => c.id === 'overturn-x')).toBeUndefined();
    expect(r.checks.find((c) => c.id === 'overturn-y')).toBeUndefined();
  });

  it('vuelco EQU: M_stab incluye N, características y FS ≥ 2.0 (fix auditoría #29)', () => {
    // CTE DB-SE-C Tabla 2.1 (EQU): γ_dst=1.8 / γ_stb=0.9 sobre CARACTERÍSTICAS
    // → FS equivalente 2.0. El axil N es la principal acción estabilizadora.
    // Pre-fix: M_stab = (W_f+W_s)·B/2 = 53.7 kNm sin N, M_dest con γ_ELU=1.35
    // y además FS ≥ 1.5 (γ acumulado ≈ 2.0 con N a factor 0): My=30 kNm con
    // la resultante DENTRO del núcleo central marcaba fallo de vuelco.
    const r = calcIsolatedFooting({ ...base, My: 100 });
    // M_stab_x = (N_k + W_f + W_s)·B/2 = (300+48.6+11.088)·0.9 = 323.7 kNm
    expect(r.M_stab_x).toBeCloseTo((r.N_sls + r.W_footing + r.W_soil) * 0.9, 2);
    // M_dest_x = |My_k| = 100 kNm (características, no ELU)
    expect(r.M_dest_x).toBeCloseTo(100, 2);
    expect(r.FS_overturn_x).toBeCloseTo(323.7 / 100, 2);
    const ov = r.checks.find((c) => c.id === 'overturn-x')!;
    expect(ov.status).toBe('ok');   // FS = 3.24 ≥ 2.0
  });

  it('vuelco EQU: My moderado con N ya no marca falso fallo (fix auditoría #29)', () => {
    // Pre-fix My=40 → M_dest_elu=54 > M_stab=53.7·1/1.5: FAIL pese a
    // ex = 0.111 m ≪ B/6 = 0.3 (zapata físicamente estable).
    const r = calcIsolatedFooting({ ...base, My: 40 });
    const ov = r.checks.find((c) => c.id === 'overturn-x')!;
    expect(r.ex_sls).toBeLessThan(1.8 / 6);
    expect(ov.status).toBe('ok');
  });

  it('deslizamiento con acciones características: FS = μ·(N + W) / H (DB SE-C tabla 2.1)', () => {
    // γR = 1,5 con γF = 1: μ·(300 + 48,6 + 11,088)/20 = 0,5·359,688/20 = 8,992.
    // Antes se usaban N y H de cálculo con el peso sin mayorar (8,605).
    const r = calcIsolatedFooting({ ...base, H: 20 });
    expect(r.FS_sliding).toBeCloseTo((0.5 * 359.688) / 20, 3);
    const c = r.checks.find((ch) => ch.id === 'sliding')!;
    expect(c.article).toBe('CTE DB-SE-C 4.2.2.1.2 (tabla 2.1)');
    // Mayoradas o sin mayorar, el mismo FS: es un cociente de características.
    const rM = calcIsolatedFooting({ ...base, loadsAreFactored: true, N: 405, H: 27 });
    expect(rM.FS_sliding).toBeCloseTo(r.FS_sliding, 6);
  });
});

// ── 7. Rigid / flexible classification (CE Anejo 19 §6.5) ─────────────────────────

describe('Rigid / flexible classification', () => {
  it('defaults classify as rigid (v_max = 0.7, h = 0.6 → v/h = 1.17 ≤ 2)', () => {
    const r = calcIsolatedFooting(base);
    expect(r.isRigid).toBe(true);
    expect(r.v_max).toBeCloseTo(0.7, 3);
  });

  it('thin wide footing classifies as flexible (v/h > 2)', () => {
    const r = calcIsolatedFooting({ ...base, B: 3.0, L: 3.0, h: 0.4, bc: 0.3, hc: 0.3, cover: 50, Df: 0.6 });
    expect(r.isRigid).toBe(false);
    expect(r.v_max).toBeGreaterThan(2 * 0.4);
  });
});

// ── 7a. Punzonamiento y anclaje (fixes auditoría #30 y #31) ─────────────────

describe('Punzonamiento EC2 §6.4 (fix auditoría #30)', () => {
  const flex = { ...base, B: 3.0, L: 3.0, h: 0.4, bc: 0.3, hc: 0.3, cover: 50, Df: 0.6 };

  it('β > 1 con momentos: vEd crece (antes β=1.0 fijo)', () => {
    const r0 = calcIsolatedFooting(flex);
    const rM = calcIsolatedFooting({ ...flex, My: 60 });
    expect(rM.vEd_punch).toBeGreaterThan(r0.vEd_punch);
  });

  it('perímetro crítico DENTRO de 2d, con vRd·2d/a (CE Anejo 19 §6.4.4(2)) — oráculo manual', () => {
    // d = 334 mm, σEd = 405/9 = 45 kPa, vRd,c = 0,417 MPa (vmin).
    // A la distancia a: u = 1,2 + 2πa, A = 0,09 + 1,2a + πa²,
    //   vEd = (405 − 45·A)/(u·d),  vRd = 0,417·2d/a.
    // A 2d (a = 0,668): A = 2,294 → vEd = 0,167, vRd = 0,417 → 40,1 %.
    // El máximo de vEd/vRd cae en a = 0,492 m = 1,47·d:
    //   A = 1,442 → vEd = 340,1/(4,293·0,334) = 0,237, vRd = 0,566 → 41,9 %.
    const r = calcIsolatedFooting(flex);
    expect(r.a_punch / r.d_avg).toBeCloseTo(1.47, 1);
    expect(r.u_punch).toBeCloseTo(1200 + 2 * Math.PI * r.a_punch, 6);
    expect(r.vEd_punch).toBeCloseTo(0.237, 2);
    expect(r.vRd_punch).toBeCloseTo(r.vRdc_punch * (2 * r.d_avg) / r.a_punch, 9);
    expect(r.vRd_punch).toBeCloseTo(0.566, 2);
    const c = r.checks.find((ch) => ch.id === 'punzonamiento')!;
    expect(c.utilization).toBeCloseTo(0.419, 2);
    expect(c.utilization!).toBeGreaterThan(0.167 / r.vRdc_punch);
    expect(c.article).toBe('CE Anejo 19 §6.4.4(2)');
    expect(c.description).toContain('perímetro crítico a 1,4');
    // El de 2d se conserva como referencia.
    expect(r.u1).toBeCloseTo(1200 + 4 * Math.PI * r.d_avg, 6);
  });

  it('zapata más cargada: el crítico queda claramente por encima del de 2d', () => {
    // 2,4 × 1,8 × 0,45, pilar 40×30, N = 450 kN: 21,6 % a 2d frente a ≈ 41 % en a ≈ 0,95·d.
    const r = calcIsolatedFooting({ ...base, B: 2.4, L: 1.8, h: 0.45, bc: 0.4, hc: 0.3, Df: 1, N: 450 });
    const c = r.checks.find((ch) => ch.id === 'punzonamiento')!;
    expect(r.a_punch / r.d_avg).toBeGreaterThan(0.8);
    expect(r.a_punch / r.d_avg).toBeLessThan(1.1);
    expect(c.utilization).toBeCloseTo(0.41, 1);
  });

  it('el perímetro no se sale de la zapata: a ≤ el menor vuelo libre', () => {
    // Zapata estrecha en y: vuelo y = (1,2 − 0,3)/2 = 0,45 m < 2d.
    const r = calcIsolatedFooting({ ...flex, L: 1.2 });
    expect(r.a_punch).toBeLessThanOrEqual(450 + 1e-6);
  });

  it('con momento, (6.51): el término del momento no se reduce con el terreno, y β cruza ejes (6.43)', () => {
    // Pilar 30 × 60 con My: la excentricidad va según x y se divide por la
    // dimensión del perímetro según y, hc + 2a.
    const inp = { ...flex, hc: 0.6, My: 60 };
    const r = calcIsolatedFooting(inp);
    const a = r.a_punch / 1000, d = r.d_avg / 1000;
    const beta = 1 + 1.8 * ((r.My_elu / r.N_elu) / (0.6 + 2 * a));
    const A = 0.3 * 0.6 + 2 * 0.9 * a + Math.PI * a * a;
    const vEd = (r.N_elu - r.sigma_Ed_uniform * A + (beta - 1) * r.N_elu) / ((1.8 + 2 * Math.PI * a) * d) / 1000;
    expect(r.vEd_punch).toBeCloseTo(vEd, 6);
  });

  it('ΔVEd con el área COMÚN del perímetro y el bloque, no el mínimo de las dos (Copilot, PR #38)', () => {
    // My grande: el bloque de Meyerhof empieza en x = B/2 − B_Ed, a la derecha
    // de la cara izquierda del contorno, y le corta las esquinas redondeadas.
    const r = calcIsolatedFooting({ ...flex, My: 200 });
    const a = r.a_punch / 1000, d = r.d_avg / 1000;
    const x0 = 1.5 - (3 - 2 * Math.abs(r.exE_elu));
    expect(x0).toBeGreaterThan(-0.15 - a);
    // Área del pilar 30 × 30 dilatado a distancia a, con x ≥ x0 (integración fina).
    const n = 200_000, xa = Math.max(x0, -0.15 - a), xb = 0.15 + a;
    let A = 0;
    for (let i = 0; i < n; i++) {
      const x = xa + ((i + 0.5) * (xb - xa)) / n;
      const f = Math.max(Math.abs(x) - 0.15, 0);
      A += 0.3 + 2 * Math.sqrt(Math.max(a * a - f * f, 0));
    }
    A *= (xb - xa) / n;
    const beta = 1 + 1.8 * ((r.My_elu / r.N_elu) / (0.3 + 2 * a));
    const vEd = (r.R_elu - r.sigma_Ed_uniform * A + (beta - 1) * r.R_elu) / ((1.2 + 2 * Math.PI * a) * d) / 1000;
    expect(r.vEd_punch).toBeCloseTo(vEd, 5);
  });

  it('también se comprueba en zapata rígida (el CE no la exime)', () => {
    const r = calcIsolatedFooting(base);
    expect(r.isRigid).toBe(true);
    const c = r.checks.find((ch) => ch.id === 'punzonamiento')!;
    expect(c.neutral).toBeFalsy();
    expect(c.status).toBe('ok');
    expect(r.checks.find((ch) => ch.id === 'punzonamiento-max')!.neutral).toBeFalsy();
  });

  it('vRd,max en u0 = 0,4·ν·fcd (CE Anejo 19 (6.53)) — oráculo manual', () => {
    // ν = 0,6·(1 − 25/250) = 0,54 → vRd,max = 0,4·0,54·16,7 = 3,61 N/mm²
    // (0,5 no es el valor del CE). vEd,u0 = 405000/(1200·334) = 1,01 N/mm².
    const r = calcIsolatedFooting(flex);
    const c = r.checks.find((ch) => ch.id === 'punzonamiento-max')!;
    expect(c.limitNum).toBeCloseTo(3.607, 2);
    expect(c.valueNum).toBeCloseTo(1.01, 2);
    expect(c.status).toBe('ok');
    expect(c.article).toBe('CE Anejo 19 §6.4.5(3)');
  });
});

describe('Anclaje de la armadura (fix auditoría #31)', () => {
  it('zapata rígida: lbd escalado por As,req/As,prov vs vuelo disponible — oracle', () => {
    // φ16 C25 B500S: fbd = 2.25·0.7·2.56/1.5 = 2.69 → lb(fyd) = 647 mm
    // Manda el mínimo del CE (9.1) sobre 1000 × 600: 125 000·2,56/434,78
    // = 736 mm²/m; Ø16/200 = 1005 → σsd/fyd = 0,732 → lbd = 474 mm (con el
    // 0,26·fctm/fyk·b·d del Eurocódigo eran 708 mm²/m y 456 mm).
    // Disponible = 700 − 60 = 640.
    const r = calcIsolatedFooting(base);
    const c = r.checks.find((ch) => ch.id === 'anclaje-x')!;
    expect(r.As_min_x).toBeCloseTo(736.0, 0);
    expect(c.value).toContain('474');
    expect(c.limit).toContain('640');
    expect(c.status).toBe('ok');
  });

  it('vuelo corto: recta no cabe → warn "detallar con patilla"; ni patilla → fail', () => {
    // B=1.2 → vuelo = 400, disponible = 340 < lbd≈456·(escala): forzar carga
    // alta para σsd≈fyd. Con patilla (0.7·lbd) puede caber → warn.
    const r = calcIsolatedFooting({ ...base, B: 1.2, L: 1.2, N: 600 });
    const c = r.checks.find((ch) => ch.id === 'anclaje-x')!;
    expect(['warn', 'fail']).toContain(c.status);
  });
});

// ── 7b. Shear oracle (fix auditoría #2: VRd = vRdc·d, no vRdc·1000) ─────────

describe('Shear VRd oracle — CE Anejo 19 §6.2', () => {
  it('flexible B=L=3, h=0.4: VRd_x = vRdc·d_x ≈ 140.8 kN/m (oracle manual)', () => {
    // Hand-calc:
    //   N_elu = 300·1.35 = 405 kN; ex=ey=0 → σ_Ed = 405/(3·3) = 45 kPa
    //   d_x = 400 − 50 − 16/2 = 342 mm
    //   ell_x = (3000−300)/2 − 342 = 1008 mm → VEd_x = 45·1.008 = 45.36 kN/m
    //   As_prov = (201.06/200)·1000 = 1005.3 mm²/m → ρl = 0.00294
    //   k = 1 + √(200/342) = 1.765
    //   vRdc = max(0.12·1.765·(100·0.00294·25)^⅓, 0.035·1.765^1.5·√25)
    //        = max(0.412, 0.410) = 0.412 N/mm²
    //   VRd_x = 0.412·342 = 140.8 kN/m → util = 45.36/140.8 = 0.322
    // Pre-fix, VRd = vRdc·1000 = 412 kN/m (×2.9 sobreestimado, como si d=1000).
    const r = calcIsolatedFooting({ ...base, B: 3.0, L: 3.0, h: 0.4, bc: 0.3, hc: 0.3, cover: 50, Df: 0.6 });
    const cx = r.checks.find((c) => c.id === 'cortante-x')!;
    expect(cx.valueNum).toBeCloseTo(45.36, 2);
    expect(cx.limitNum).toBeCloseTo(140.8, 0);
    expect(cx.utilization).toBeCloseTo(0.322, 2);
  });
});

// ── 8. Validation — invalid inputs ──────────────────────────────────────────

describe('Validation', () => {
  it('h > Df → invalid', () => {
    const r = calcIsolatedFooting({ ...base, h: 1.0, Df: 0.5 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/canto/i);
  });

  it('sigma_adm ≤ 0 → invalid', () => {
    const r = calcIsolatedFooting({ ...base, sigma_adm: 0 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/σadm/i);
  });
});

// ── Reglas constructivas: cumplen o no (criterio del usuario, 2026-09-26) ────
// «c/300 sí debería cumplir, es el caso límite» y «es constructivo, no es por
// agotamiento de la sección»: ni INCUMPLE en el límite ni ADVERTENCIA al 95 %.
describe('reglas constructivas — cumple o no', () => {
  const fila = (over: Partial<typeof base>, id: string) =>
    calcIsolatedFooting({ ...base, ...over }).checks.find((ch) => ch.id === id)!;

  it('separación: c/300 cumple (el límite), c/290 no avisa, c/301 no cumple', () => {
    expect(fila({ s_x: 300 }, 'separacion-x').status).toBe('ok');
    expect(fila({ s_x: 290 }, 'separacion-x').status).toBe('ok');
    expect(fila({ s_x: 301 }, 'separacion-x').status).toBe('fail');
    expect(fila({ s_y: 300 }, 'separacion-y').status).toBe('ok');
  });

  it('cuantía mínima: As = As,min cumple, al 97 % de utilización no avisa, 1 % por debajo no cumple', () => {
    const AsMin = calcIsolatedFooting(base).As_min_x;
    const sLim = (getBarArea(16) * 1000) / AsMin;    // Ø16 → As = A/s·1000
    const lim = fila({ s_x: sLim }, 'cuantia-min-x');
    expect(lim.utilization).toBeCloseTo(1, 9);
    expect(lim.status).toBe('ok');
    expect(fila({ s_x: 0.97 * sLim }, 'cuantia-min-x').status).toBe('ok');
    expect(fila({ s_x: 1.01 * sLim }, 'cuantia-min-x').status).toBe('fail');
  });
});

// ── Auditoría 2026-11-05 ─────────────────────────────────────────────────────

describe('Presión sobre el área equivalente (CTE DB-SE-C 4.3.1.3)', () => {
  // W = 25·1,8·1,8·0,6 + 18·0,2·(3,24 − 0,16) = 48,6 + 11,088 → V = 359,688 kN.
  const V = 359.688;

  it('sin excentricidad, qb = V/(B·L) = σ uniforme', () => {
    const r = calcIsolatedFooting(base);
    expect(r.qb).toBeCloseTo(V / 3.24, 3);
    expect(r.B_eq).toBe(1.8);
    expect(r.L_eq).toBe(1.8);
  });

  it('biaxial: B* = B − 2·eB, L* = L − 2·eL, qb = V/(B*·L*)', () => {
    // eB = 90/V = 0,2502, eL = 60/V = 0,1668 → B* = 1,2996, L* = 1,4664 → 188,7 kPa.
    // La ley lineal da σmax ≈ 268 kPa, que ya no es el veredicto.
    const r = calcIsolatedFooting({ ...base, My: 90, Mx: 60 });
    expect(r.B_eq).toBeCloseTo(1.8 - 2 * 90 / V, 6);
    expect(r.L_eq).toBeCloseTo(1.8 - 2 * 60 / V, 6);
    expect(r.qb).toBeCloseTo(188.7, 0);
    expect(r.sigma_max).toBeGreaterThan(260);
    const c = r.checks.find((ch) => ch.id === 'bearing')!;
    expect(c.valueNum).toBeCloseTo(r.qb, 6);
    expect(c.status).not.toBe('fail');
    expect(c.article).toBe('CTE DB-SE-C 4.3.1.3 y 4.2.2.1.1');
  });

  it('con e < lado/20 vale la sección real (punto 5)', () => {
    // e = 30/V = 0,083 m < 1,8/20 = 0,09 m.
    const r = calcIsolatedFooting({ ...base, My: 30 });
    expect(r.B_eq).toBe(1.8);
    expect(r.qb).toBeCloseTo(V / 3.24, 3);
    // e = 36/V = 0,100 m ≥ 0,09 m: ya se reduce.
    expect(calcIsolatedFooting({ ...base, My: 36 }).B_eq).toBeCloseTo(1.8 - 72 / V, 6);
  });

  it('e > B/3: aviso de precauciones especiales (UNE-EN 1997-1 §6.5.4), no incumplimiento por sí mismo', () => {
    // e = 230/V = 0,639 m > 0,6 m.
    const r = calcIsolatedFooting({ ...base, My: 230 });
    const c = r.checks.find((ch) => ch.id === 'excentricidad-x')!;
    expect(c.status).toBe('warn');
    expect(c.article).toBe('UNE-EN 1997-1 §6.5.4');
    expect(r.checks.find((ch) => ch.id === 'excentricidad-y')).toBeUndefined();
    expect(calcIsolatedFooting({ ...base, My: 200 }).checks.find((ch) => ch.id === 'excentricidad-x')).toBeUndefined();
  });

  it('la resultante fuera de la zapata: qb infinito y no cumple', () => {
    const r = calcIsolatedFooting({ ...base, My: 2000 });
    expect(r.qb).toBe(Infinity);
    expect(r.checks.find((ch) => ch.id === 'bearing')!.status).toBe('fail');
  });
});

describe('H·h en la presión del terreno', () => {
  const V = 359.688;

  it('H añade el momento H·h en la base, en la dirección que más carga el terreno', () => {
    // 60·0,6 = 36 kNm → e = 0,1001 m ≥ B/20 → B* = 1,6 m → qb = V/(1,6·1,8) = 124,9 kPa.
    const r = calcIsolatedFooting({ ...base, H: 60 });
    expect(r.H_dir).toBe('x');
    expect(r.ex_sls).toBeCloseTo(36 / V, 6);
    expect(r.qb).toBeCloseTo(V / ((1.8 - 72 / V) * 1.8), 3);
    expect(r.sigma_max).toBeGreaterThan(calcIsolatedFooting(base).sigma_max);
  });

  it('se suma al momento del pilar con su mismo signo', () => {
    const r = calcIsolatedFooting({ ...base, My: -50, H: 20 });
    expect(r.exR_sls).toBeCloseTo(-(50 + 12) / V, 6);
    // Con Mx mayor que My, H va en y.
    const r2 = calcIsolatedFooting({ ...base, My: 20, Mx: -80, H: 20 });
    expect(r2.H_dir).toBe('y');
    expect(r2.eyR_sls).toBeCloseTo(-(80 + 12) / V, 6);
    expect(r2.exR_sls).toBeCloseTo(20 / V, 6);
  });

  it('sin H no hay dirección, y en la dirección de una viga centradora H·h es de la viga', () => {
    expect(calcIsolatedFooting(base).H_dir).toBeNull();
    const r = calcIsolatedFooting({ ...base, tipo: 'medianera', vigaX: true, luzX: 5, H: 30 });
    expect(r.H_dir).toBe('y');
    expect(r.exR_sls).toBe(0);
  });
});

describe('Reglas de armado del CE', () => {
  it('diámetro mínimo Ø12 en la armadura principal (CE Anejo 19 §9.8.2.1(1))', () => {
    const ok = calcIsolatedFooting(base).checks.find((c) => c.id === 'diametro-min')!;
    expect(ok.status).toBe('ok');
    const c12 = calcIsolatedFooting({ ...base, phi_y: 12, s_y: 100 }).checks.find((c) => c.id === 'diametro-min')!;
    expect(c12.status).toBe('ok');
    const r10 = calcIsolatedFooting({ ...base, phi_y: 10, s_y: 75 });
    const c10 = r10.checks.find((c) => c.id === 'diametro-min')!;
    expect(c10.status).toBe('fail');
    expect(c10.value).toBe('Ø10 mm');
    expect(r10.valid).toBe(false);
    // La parrilla superior también cuenta, si la lleva.
    const sup = calcIsolatedFooting({ ...base, supLleva: true, phi_sup_x: 10 });
    expect(sup.checks.find((c) => c.id === 'diametro-min')!.status).toBe('fail');
  });

  it('las citas son artículos que existen', () => {
    const r = calcIsolatedFooting({ ...base, My: 100, H: 20, supLleva: true });
    const art = (id: string) => r.checks.find((c) => c.id === id)!.article;
    expect(art('overturn-x')).toBe('CTE DB-SE-C 4.2.2.1.3 (tabla 2.1)');
    expect(art('separacion-x')).toBe('CE Anejo 19 §9.3.1.1(3)');
    expect(art('separacion-sup-x')).toBe('CE Anejo 19 §9.3.1.1(3)');
    expect(art('anclaje-x')).toBe('CE Anejo 19 §8.4 y §9.8.2.1');
    expect(art('armado-sup-x')).toBe('CE Anejo 19 §9.8.2.1(3)');
    expect(r.checks.every((c) => !/4\.4\.[123]|EHE 58\.4 /.test(c.article ?? ''))).toBe(true);
  });
});

describe('Despegue biaxial: integración exacta', () => {
  it('triángulo de esquina: σmax = 6·V/(a·b) con a = 4·(B/2 − ex), b = 4·(L/2 − ey)', () => {
    const V = 359.688;
    for (const [ex, ey] of [[0.584, 0.584], [0.5, 0.6], [0.7, 0.5]] as const) {
      const r = calcIsolatedFooting({ ...base, My: ex * V, Mx: ey * V });
      const a = 4 * (0.9 - ex), b = 4 * (0.9 - ey);
      expect(r.distributionType).toBe('bitriangular_biaxial');
      expect(r.sigma_max / ((6 * V) / (a * b))).toBeCloseTo(1, 5);
      expect(r.loaded_area_fraction * 3.24).toBeCloseTo((a * b) / 2, 5);
    }
  });
});
