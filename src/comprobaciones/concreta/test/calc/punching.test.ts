// Punching shear test suite — CE Anejo 19 §6.4
// Run: bun test src/test/calc/punching.test.ts

import { describe, expect, it } from 'vitest';
import { calcPunching, K_MAX_CS } from '../../lib/calculations/punching.ts';
import { areaCargada, perimetroADistancia, distanciaDePerimetro, filasDeCercos } from '../../lib/calculations/punchingGeometria.ts';
import { getUPN } from '../../data/steelProfiles.ts';
import { getBarArea } from '../../data/rebar.ts';
import { punchingDefaults } from '../../data/defaults.ts';
import { formatQuantity } from '../../lib/units/format.ts';

const base = { ...punchingDefaults };
// base: cx=300, cy=300, d=200, fck=25, fyk=500
//       barDiamSup=barDiamInf=12, sSup=sInf=150
//       VEd=300kN, position='interior', mode='pilar'
// → As = 113.1/150 = 0.754mm²/mm → ρl = 0.754/200 = 0.00377 → vRdc ≈ 0.507 MPa

// ── FTUX defaults ────────────────────────────────────────────────────────────
describe('FTUX defaults', () => {
  it('result is valid', () => expect(calcPunching(base).valid).toBe(true));
  it('no check fails', () => {
    const r = calcPunching(base);
    for (const c of r.checks) expect(c.status).not.toBe('fail');
  });
  it('beta=1,15 for interior pilar (fix #132 — Anejo 19 fig. 6,21N)', () => expect(calcPunching(base).beta).toBe(1.15));
  it('rhoLClamped=false (Ø12@150 > rhoLMin)', () => expect(calcPunching(base).rhoLClamped).toBe(false));
});

// ── u1 critical perimeter ────────────────────────────────────────────────────
describe('u1 perimeter', () => {
  it('interior rectangular: 2(cx+cy)+4πd', () => {
    const expected = 2 * (300 + 300) + 4 * Math.PI * 200;
    expect(calcPunching(base).u1).toBeCloseTo(expected, 0);
  });

  // Figura A19.6.15 del CE (y 46.2.b de la EHE-08): el perímetro muere en el
  // borde libre, perpendicular a él. cx es la cara PARALELA al borde, como en u0.
  // Hasta el 2026-09-26 eran «2cx + cy + 2πd + 4d» y «cx + cy + πd + 4d»: 4d de
  // más, del lado inseguro. Con cx ≠ cy para que el test fije la orientación.
  it('borde rectangular: cx + 2cy + 2πd (cx ∥ borde libre)', () => {
    const expected = 400 + 2 * 300 + 2 * Math.PI * 200;
    expect(calcPunching({ ...base, position: 'borde', cx: 400, cy: 300 }).u1).toBeCloseTo(expected, 6);
  });

  it('esquina rectangular: cx + cy + πd', () => {
    const expected = 400 + 300 + Math.PI * 200;
    expect(calcPunching({ ...base, position: 'esquina', cx: 400, cy: 300 }).u1).toBeCloseTo(expected, 6);
  });

  it('u1 es el perímetro de la misma forma a 2d (el que dibuja el lienzo)', () => {
    for (const position of ['interior', 'borde', 'esquina'] as const) {
      const inp = { ...base, position, cx: 450, cy: 350 };
      expect(calcPunching(inp).u1).toBeCloseTo(perimetroADistancia(areaCargada(inp), 2 * inp.d), 9);
    }
  });

  it('pilar de borde 400 × 400, d = 250, con cercos: 110 % (antes 92 %)', () => {
    const r = calcPunching({
      ...base, position: 'borde', cx: 400, cy: 400, d: 250, h: 300, fck: 30, VEd: 420,
      barDiamSup: 16, sSup: 150, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 150,
    });
    expect(r.u1).toBeCloseTo(400 + 800 + 500 * Math.PI, 6);             // 2770,8 mm
    expect(r.vEd).toBeCloseTo(1.4 * 420000 / (r.u1 * 250), 9);            // 0,849
    const cs = r.checks.find((c) => c.id === 'punz-ved-vrdcs')!;
    expect(cs.utilization).toBeCloseTo(1.101, 2);
    expect(cs.status).toBe('fail');
  });

  it('interior circular: π(Ø+4d)', () => {
    const expected = Math.PI * (300 + 4 * 200);
    expect(calcPunching({ ...base, isCircular: true }).u1).toBeCloseTo(expected, 0);
  });

  it('isCircular forced false for borde — same as rectangular borde', () => {
    const rect = calcPunching({ ...base, position: 'borde' });
    const circ = calcPunching({ ...base, position: 'borde', isCircular: true });
    expect(circ.u1).toBeCloseTo(rect.u1, 0);
  });

  it('isCircular forced false for esquina — same as rectangular esquina', () => {
    const rect = calcPunching({ ...base, position: 'esquina' });
    const circ = calcPunching({ ...base, position: 'esquina', isCircular: true });
    expect(circ.u1).toBeCloseTo(rect.u1, 0);
  });
});

// ── β eccentricity factor ─────────────────────────────────────────────────────
describe('beta', () => {
  it('interior pilar β=1.15 (fix #132); carga-puntual β=1.0', () => {
    expect(calcPunching(base).beta).toBe(1.15);
    expect(calcPunching({ ...base, mode: 'carga-puntual' }).beta).toBe(1.0);
  });
  it('borde β=1,4',    () => expect(calcPunching({ ...base, position: 'borde' }).beta).toBe(1.4));
  it('esquina β=1,5',  () => expect(calcPunching({ ...base, position: 'esquina' }).beta).toBe(1.5));
});

// ── β personalizado (método general §6.4.3) ──────────────────────────────────
describe('beta custom', () => {
  it('betaMode=custom usa betaManual, no la posición', () => {
    // esquina daría 1.5 en auto; el custom manda
    const r = calcPunching({ ...base, position: 'esquina', betaMode: 'custom', betaManual: 1.27 });
    expect(r.beta).toBe(1.27);
  });

  it('el β custom escala vEd = β·VEd·1000/(u1·d)', () => {
    const auto   = calcPunching(base);                                           // β=1.15
    const custom = calcPunching({ ...base, betaMode: 'custom', betaManual: 1.5 });
    expect(custom.vEd).toBeCloseTo(auto.vEd * (1.5 / 1.15), 6);
  });

  it('la nota de β cambia a "personalizado" y sigue siendo neutral (no invalida)', () => {
    const r = calcPunching({ ...base, betaMode: 'custom', betaManual: 1.3 });
    const note = r.checks.find((c) => c.id === 'punz-beta-note');
    expect(note?.status).toBe('neutral');
    expect(note?.description).toContain('personalizado');
    expect(r.valid).toBe(true);
  });

  it('β custom < 1.0 es inválido (excentricidad no reduce por debajo de la concéntrica)', () => {
    const r = calcPunching({ ...base, betaMode: 'custom', betaManual: 0.9 });
    expect(r.error).toBeDefined();
    expect(r.valid).toBe(false);
  });

  it('betaMode=auto ignora betaManual (queda en el simplificado por posición)', () => {
    const r = calcPunching({ ...base, betaMode: 'auto', betaManual: 3.0 });
    expect(r.beta).toBe(1.15);
  });
});

// ── vEd design shear stress ───────────────────────────────────────────────────
describe('vEd', () => {
  it('interior: β·VEd·1000/(u1·d)', () => {
    const r = calcPunching(base);
    const u1 = 2 * (300 + 300) + 4 * Math.PI * 200;
    const expected = 1.15 * base.VEd * 1000 / (u1 * 200);
    expect(r.vEd).toBeCloseTo(expected, 4);
  });

  it('borde: β=1.4 raises vEd vs interior', () => {
    const interior = calcPunching(base);
    const borde    = calcPunching({ ...base, position: 'borde' });
    expect(borde.vEd).toBeGreaterThan(interior.vEd);
  });
});

// ── u0 / vEd0 — column-face perimeter (CE Anejo 19 §6.4.5(3)) ──────────────────────
describe('u0 / vEd,0', () => {
  it('interior u0 = 2·(cx+cy)', () => {
    const r = calcPunching(base);
    expect(r.u0).toBeCloseTo(2 * (300 + 300), 6);
  });

  it('interior circular u0 = π·Ø', () => {
    const r = calcPunching({ ...base, isCircular: true, cx: 400, cy: 400 });
    expect(r.u0).toBeCloseTo(Math.PI * 400, 6);
  });

  it('borde u0 = min(cx+3d, cx+2·cy)', () => {
    // cx=300, cy=300, d=200 → min(300+600, 300+600) = 900
    const r = calcPunching({ ...base, position: 'borde' });
    expect(r.u0).toBeCloseTo(Math.min(300 + 3 * 200, 300 + 2 * 300), 6);
  });

  it('esquina u0 = min(3d, cx+cy)', () => {
    // d=200, cx=cy=300 → min(600, 600) = 600
    const r = calcPunching({ ...base, position: 'esquina' });
    expect(r.u0).toBeCloseTo(Math.min(3 * 200, 300 + 300), 6);
  });

  it('vEd0 = β·VEd·1000/(u0·d) — column-face stress', () => {
    const r = calcPunching(base);
    const expected = 1.15 * base.VEd * 1000 / (r.u0 * 200);
    expect(r.vEd0).toBeCloseTo(expected, 4);
  });

  it('vEd0 > vEd — column-face stress strictly larger than u1 stress', () => {
    const r = calcPunching(base);
    // u0 < u1 for any real column, so vEd0 > vEd
    expect(r.vEd0).toBeGreaterThan(r.vEd);
  });

  it('punz-ved-max check uses vEd0 (not vEd)', () => {
    const r = calcPunching(base);
    const c = r.checks.find((c) => c.id === 'punz-ved-max')!;
    // Tensión por Quantity 'stress' (valueNum SI = N/mm², toggle-aware): debe ser vEd0.
    expect(c.valueQty).toBe('stress');
    expect(c.valueNum).toBeCloseTo(r.vEd0, 6);
    expect(c.valueNum).not.toBeCloseTo(r.vEd, 6);
  });
});

// ── Unidades de tensión: toggle N/mm² ↔ kg/cm² (lo pidió el usuario, 2026-06-09) ──
// Las tensiones del punzonamiento van por la Quantity 'stress', así que las filas de
// verificación CONVIERTEN con el sistema activo (igual que el resto de la app). Blinda
// el cableado punzonamiento→stress: un cambio futuro que vuelva a hardcodear "MPa" o que
// rompa la Quantity lo caza este test.
describe('unidades de tensión (toggle N/mm² ↔ kg/cm²)', () => {
  it('los checks de tensión usan la Quantity stress y convierten con el toggle', () => {
    const r = calcPunching(base);
    for (const id of ['punz-ved-max', 'punz-ved-vrdc']) {
      const c = r.checks.find((c) => c.id === id)!;
      expect(c.valueQty, id).toBe('stress');
      const si  = formatQuantity(c.valueNum!, 'stress', 'si');
      const tec = formatQuantity(c.valueNum!, 'stress', 'tecnico');
      expect(si,  `${id} SI`).toContain('N/mm²');
      expect(tec, `${id} técnico`).toContain('kg/cm²');
      // mismo valor físico ≈ ×10.2 (loose por el redondeo a 1 decimal del catálogo)
      // `parseFloat` se para en la coma decimal ('12,50' -> 12): se normaliza
      // antes de leer, igual que hace `parseQuantity` con lo que se teclea.
      const numero = (t: string) => parseFloat(t.replace(',', '.'));
      const ratio = numero(tec) / numero(si);
      expect(ratio, `${id} ratio`).toBeGreaterThan(8);
      expect(ratio, `${id} ratio`).toBeLessThan(12);
    }
  });
});

// ── k size factor ────────────────────────────────────────────────────────────
describe('k factor', () => {
  it('d=200 → k=2.0 (capped at 2.0)', () => {
    // 1+√(200/200)=1+1=2.0 → exactly at cap
    expect(calcPunching(base).k).toBe(2.0);
  });

  it('d=800 → k=1.5', () => {
    const r = calcPunching({ ...base, d: 800, VEd: 2000 });
    expect(r.k).toBeCloseTo(1.5, 4);
  });

  it('d=50 → k capped at 2.0', () => {
    const r = calcPunching({ ...base, d: 50 });
    expect(r.k).toBe(2.0);
  });
});

// ── ρl from bar dimensions ────────────────────────────────────────────────────
describe('rhoL', () => {
  it('Ø12@150, d=200, mode=pilar → rhoL ≈ 0.00377', () => {
    // As = π×12²/4 / 150 = 113.1/150 = 0.754 mm²/mm; ρl = 0.754/200 = 0.00377
    expect(calcPunching(base).rhoL).toBeCloseTo(0.00377, 4);
  });

  it('rhoL capped at 0.02 when bars are very dense', () => {
    // Ø32@50, d=200 → As = 804.2/50 = 16.08 mm²/mm; ρl = 0.0804 → capped at 0.02
    const r = calcPunching({ ...base, barDiamSup: 32, sSup: 50 });
    expect(r.rhoL).toBeLessThanOrEqual(0.02 + 1e-10);
  });

  it('very sparse bars → rhoLClamped=true', () => {
    // Ø8@200, d=200 → As = 50.3/200 = 0.2515; ρl = 0.001258 < rhoLMin = 0.00207 → clamped
    const r = calcPunching({ ...base, barDiamSup: 8, sSup: 200 });
    expect(r.rhoLClamped).toBe(true);
  });

  it('dense bars (Ø12@150) → no clamp', () => {
    expect(calcPunching(base).rhoLClamped).toBe(false);
  });

  it('carga-puntual uses bottom face bars for ρl', () => {
    // Different sup vs inf → rhoL differs by mode
    const inp = { ...base, mode: 'carga-puntual' as const, barDiamSup: 16, sSup: 150, barDiamInf: 12, sInf: 200 };
    const r_pilar = calcPunching({ ...inp, mode: 'pilar' as const });
    const r_carga = calcPunching({ ...inp, mode: 'carga-puntual' as const });
    // pilar: Ø16@150 → ρl = 201.1/150/200 = 0.00671
    // carga: Ø12@200 → ρl = 113.1/200/200 = 0.00283
    expect(r_pilar.rhoL).toBeGreaterThan(r_carga.rhoL);
  });

  it('asSup/asInf stored in result', () => {
    const r = calcPunching(base);
    // As = 113.1/150 = 0.754 mm²/mm
    expect(r.asSup).toBeCloseTo(113.1 / 150, 2);
    expect(r.asInf).toBeCloseTo(113.1 / 150, 2);
  });
});

// ── ρl,min (CE Anejo 19 §9.2.1.1 (9.1)) ───────────────────────────────────────────────
describe('rhoLMin', () => {
  it('losa h = 250, d = 200, HA-25: As,min = W/z·fctm,fl/fyd sobre 1000 × h, entre 1000·d', () => {
    // W/z = 1000·250/4,8 = 52 083 mm²; fctm,fl = (1,6 − 0,25)·2,56 = 3,456;
    // As,min = 52 083·3,456/434,78 = 414,0 mm²/m → ρl,min = 414,0/200 000
    // = 0,00207 (el Eurocódigo daba 0,00133).
    const expected = (1000 * 250 / 4.8) * (1.35 * 2.56) / (500 / 1.15) / (1000 * 200);
    expect(calcPunching(base).rhoLMin).toBeCloseTo(expected, 6);
    expect(calcPunching(base).rhoLMin).toBeCloseTo(0.00207, 5);
  });

  it('sin canto total que supere a d (estado anterior al campo), la fila queda pendiente', () => {
    const r = calcPunching({ ...base, d: 400, h: 250 });
    const row = r.checks.find((c) => c.id === 'punz-rho-min')!;
    expect(row.status).toBe('neutral');
    expect(row.limit).toMatch(/falta el canto total h/);
    expect(r.rhoLMin).toBe(0);
    expect(r.rhoLClamped).toBe(false);
  });
});

// ── vRd,c resistance without shear reinf ────────────────────────────────────
describe('vRdc', () => {
  it('Ø12@150 → ρl≈0.00377 → vRdc≈0.507 MPa (formula governs over vmin=0.495)', () => {
    // CRdc=0.12, k=2.0, ρl=0.00377, fck=25
    // 0.12·2.0·(100·0.00377·25)^(1/3) = 0.24·(9.425)^(1/3) ≈ 0.24·2.112 ≈ 0.507
    // vmin = 0.035·2^1.5·√25 = 0.495 → formula governs
    const r = calcPunching(base);
    expect(r.vRdc).toBeCloseTo(0.507, 2);
  });

  it('vRdc ≥ vMin always', () => {
    const r = calcPunching(base);
    expect(r.vRdc).toBeGreaterThanOrEqual(r.vMin);
  });
});

// ── vRd,max ──────────────────────────────────────────────────────────────────
describe('vRdmax', () => {
  it('fck=25: ν=0.54 → 0.4·ν·fcd ≈ 3.60 MPa', () => {
    const nu  = 0.6 * (1 - 25 / 250); // 0.54
    const fcd = 16.7; // from getConcrete(25).fcd (rounded)
    const expected = 0.4 * nu * fcd;
    expect(calcPunching(base).vRdmax).toBeCloseTo(expected, 1);
  });
});

// ── vMin ─────────────────────────────────────────────────────────────────────
describe('vMin', () => {
  it('d=200: 0.035·2.0^1.5·√25 ≈ 0.495', () => {
    const expected = 0.035 * Math.pow(2.0, 1.5) * Math.sqrt(25);
    expect(calcPunching(base).vMin).toBeCloseTo(expected, 3);
  });
});

// ── shear reinforcement (tipo viga) ─────────────────────────────────────────
describe('shear reinforcement', () => {
  const withSw = { ...base, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 75, fywk: 500 };

  it('no hasShearReinf → vRdcs undefined', () => {
    expect(calcPunching(base).vRdcs).toBeUndefined();
  });

  it('hasShearReinf=true → vRdcs defined', () => {
    expect(calcPunching(withSw).vRdcs).toBeDefined();
  });

  it('vRdcs > 0.75·vRdc (stirrups add to base)', () => {
    const r = calcPunching(withSw);
    expect(r.vRdcs!).toBeGreaterThan(0.75 * r.vRdc);
  });

  it('Asw = 4 × swLegs × As(swDiam) for interior', () => {
    // 4 sides × 2 legs × 50.3mm²(Ø8) = 402.4mm²
    const r = calcPunching(withSw);
    expect(r.aswPerRow).toBeCloseTo(4 * 2 * 50.3, 0);
  });

  it('borde → 3 sides → Asw = 3 × swLegs × As(swDiam)', () => {
    const r = calcPunching({ ...withSw, position: 'borde' });
    expect(r.aswPerRow).toBeCloseTo(3 * 2 * 50.3, 0);
  });

  it('esquina → 2 sides → Asw = 2 × swLegs × As(swDiam)', () => {
    const r = calcPunching({ ...withSw, position: 'esquina' });
    expect(r.aswPerRow).toBeCloseTo(2 * 2 * 50.3, 0);
  });

  it('vRdcs formula: 0.75·vRdc + 1.5·(d/sr)·Asw/(u1·d)·fywd_ef', () => {
    const r = calcPunching(withSw);
    const Asw_expected = 4 * 2 * 50.3;  // 4 sides × 2 legs × As(Ø8)
    const fywd_ef = Math.min(250 + 0.25 * 200, 500 / 1.15); // = 300 MPa
    const expected = 0.75 * r.vRdc + 1.5 * (200 / 75) * Asw_expected / (r.u1 * 200) * fywd_ef;
    expect(r.vRdcsBruto!).toBeCloseTo(expected, 3);
    // y la que cuenta, con el tope kmax·vRd,c de la (6.52)
    expect(r.vRdcs!).toBeCloseTo(Math.min(expected, 1.5 * r.vRdc), 3);
  });

  it('fywd,ef: d=200 → min(250+50, 500/1.15)=min(300, 435)=300 MPa', () => {
    // Validated via formula test above
    const fywd_ef = Math.min(250 + 0.25 * 200, 500 / 1.15);
    expect(fywd_ef).toBeCloseTo(300, 1);
  });

  it('sr ≤ 0.75d → punz-sr-max ok', () => {
    // sr=100, d=200 → 0.75d=150 → util=0.667 → ok
    const r = calcPunching(withSw);
    const c = r.checks.find((c) => c.id === 'punz-sr-max')!;
    expect(c).toBeDefined();
    expect(c.status).toBe('ok');
  });

  it('sr > 0.75d → punz-sr-max fails', () => {
    // sr=200, d=200 → 0.75d=150 → util=1.33 → fail
    const r = calcPunching({ ...base, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 200, fywk: 500 });
    const c = r.checks.find((c) => c.id === 'punz-sr-max')!;
    expect(c.status).toBe('fail');
    expect(r.valid).toBe(false);
  });

  it('sr = 0,75d cumple (el límite) y sr = 0,97·0,75d no avisa', () => {
    // d=200 → 0.75d=150. Regla constructiva: hasta el 2026-09-27, 146 era ADVERTENCIA.
    for (const sr of [150, 146]) {
      const r = calcPunching({ ...withSw, sr });
      const c = r.checks.find((c) => c.id === 'punz-sr-max')!;
      expect(c.status).toBe('ok');
    }
    const fuera = calcPunching({ ...withSw, sr: 151 }).checks.find((c) => c.id === 'punz-sr-max')!;
    expect(fuera.status).toBe('fail');
    expect(fuera.utilization).toBeGreaterThan(1); // la utilización real, no topada a 1
  });

  it('no hasShearReinf → punz-sr-max absent', () => {
    expect(calcPunching(base).checks.find((c) => c.id === 'punz-sr-max')).toBeUndefined();
  });

  it('more legs → higher vRdcs (hasta el tope 1,5·vRd,c)', () => {
    const r2 = calcPunching({ ...base, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 100, fywk: 500 });
    const r4 = calcPunching({ ...base, hasShearReinf: true, swDiam: 8, swLegs: 4, sr: 100, fywk: 500 });
    expect(r4.vRdcsBruto!).toBeGreaterThan(r2.vRdcsBruto!);
    expect(r4.vRdcs!).toBeLessThanOrEqual(1.5 * r4.vRdc + 1e-12);
  });
});

// ── checks ───────────────────────────────────────────────────────────────────
describe('checks', () => {
  it('punz-rho-min always present', () => {
    const r = calcPunching(base);
    expect(r.checks.find((c) => c.id === 'punz-rho-min')).toBeDefined();
  });

  it('punz-rho-min=fail when rhoLClamped (regla constructiva: bajo mínimos no cumple)', () => {
    // Ø8@200 → ρl = 50.3/200/200 = 0.00126 < rhoLMin ≈ 0.00133 → clamped.
    // Hasta el 2026-09-27 salía ADVERTENCIA.
    const r = calcPunching({ ...base, barDiamSup: 8, sSup: 200 });
    const check = r.checks.find((c) => c.id === 'punz-rho-min')!;
    expect(check.status).toBe('fail');
  });

  it('punz-rho-min: justo en el mínimo cumple, y al 97 % no avisa', () => {
    const r0 = calcPunching(base);
    const asMin = r0.rhoLMin * base.d;                 // mm²/mm
    const s = (dAs: number) => getBarArea(base.barDiamSup) / (asMin * dAs);
    const limite = calcPunching({ ...base, sSup: s(1) }).checks.find((c) => c.id === 'punz-rho-min')!;
    expect(limite.utilization).toBeCloseTo(1, 6);
    expect(limite.status).toBe('ok');
    const cerca = calcPunching({ ...base, sSup: s(1 / 0.97) }).checks.find((c) => c.id === 'punz-rho-min')!;
    expect(cerca.utilization).toBeCloseTo(0.97, 6);
    expect(cerca.status).toBe('ok');
  });

  it('punz-ved-max present and ok (default inputs)', () => {
    const r = calcPunching(base);
    const c = r.checks.find((c) => c.id === 'punz-ved-max')!;
    expect(c).toBeDefined();
    expect(c.status).toBe('ok');
  });

  it('punz-ved-vrdc present', () => {
    expect(calcPunching(base).checks.find((c) => c.id === 'punz-ved-vrdc')).toBeDefined();
  });

  it('punz-ved-vrdcs absent without shear reinf', () => {
    expect(calcPunching(base).checks.find((c) => c.id === 'punz-ved-vrdcs')).toBeUndefined();
  });

  it('punz-ved-vrdcs present with shear reinf', () => {
    const r = calcPunching({ ...base, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 75, fywk: 500 });
    expect(r.checks.find((c) => c.id === 'punz-ved-vrdcs')).toBeDefined();
  });

  it('all article references contain CE', () => {
    const r = calcPunching(base);
    for (const c of r.checks) expect(c.article).toMatch(/CE/);
  });

  it('vEd > vRdc → punz-ved-vrdc fails → valid=false', () => {
    // VEd=3000kN with d=200, interior, Ø12@150 → vEd much larger than vRdc≈0.507
    const r = calcPunching({ ...base, VEd: 3000 });
    const c = r.checks.find((c) => c.id === 'punz-ved-vrdc')!;
    expect(c.status).toBe('fail');
    expect(r.valid).toBe(false);
  });

  it('vEd > vRdmax → punz-ved-max fails → valid=false', () => {
    // vRdmax(fck=25) ≈ 3.6 MPa; to exceed it need extreme VEd
    // With d=50 (small slab), VEd=200kN: vEd = 1.0*200000/(u1*50); u1≈3770mm → vEd≈1.06 MPa → may not fail
    // Use d=50, VEd=3000kN: vEd = 3000000/(u1*50); u1=2(300+300)+4π*50≈1828mm → vEd≈32.8 MPa > vRdmax≈3.6
    const r = calcPunching({ ...base, d: 50, VEd: 3000 });
    const c = r.checks.find((c) => c.id === 'punz-ved-max')!;
    expect(c.status).toBe('fail');
    expect(r.valid).toBe(false);
  });
});

// ── uout ─────────────────────────────────────────────────────────────────────
describe('uout', () => {
  it('uout = β·VEd·1000/(vRdc·d)', () => {
    const r        = calcPunching(base);
    const expected = 1.15 * base.VEd * 1000 / (r.vRdc * 200);
    expect(r.uout).toBeCloseTo(expected, 0);
  });

  it('rOut = uout/(2π)', () => {
    const r = calcPunching(base);
    expect(r.rOut).toBeCloseTo(r.uout / (2 * Math.PI), 1);
  });
});

// ── invalid inputs ────────────────────────────────────────────────────────────
describe('invalid inputs', () => {
  it('d=0 → invalid',      () => expect(calcPunching({ ...base, d: 0 }).valid).toBe(false));
  it('VEd=0 → invalid',    () => expect(calcPunching({ ...base, VEd: 0 }).valid).toBe(false));
  it('sSup=0 → invalid',   () => expect(calcPunching({ ...base, sSup: 0 }).valid).toBe(false));
  it('sInf=0 → invalid',   () => expect(calcPunching({ ...base, sInf: 0 }).valid).toBe(false));
  it('barDiamSup=0 → invalid', () => expect(calcPunching({ ...base, barDiamSup: 0 }).valid).toBe(false));
  it('barDiamInf=0 → invalid', () => expect(calcPunching({ ...base, barDiamInf: 0 }).valid).toBe(false));
  it('fck=100 → invalid',  () => expect(calcPunching({ ...base, fck: 100 }).valid).toBe(false));
  it('hasShearReinf + sr=0 → invalid', () => {
    expect(calcPunching({ ...base, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 0, fywk: 500 }).valid).toBe(false);
  });
  it('hasShearReinf + swLegs=0 → invalid', () => {
    expect(calcPunching({ ...base, hasShearReinf: true, swDiam: 8, swLegs: 0, sr: 100, fywk: 500 }).valid).toBe(false);
  });
  it('hasShearReinf + swDiam=0 → invalid', () => {
    expect(calcPunching({ ...base, hasShearReinf: true, swDiam: 0, swLegs: 2, sr: 100, fywk: 500 }).valid).toBe(false);
  });
});

// ── Cruceta mode delegation (eng-review Approach B) ───────────────────────────
describe('cruceta mode delegation', () => {
  it("mode='pilar-cruceta' produces a cruceta detail", () => {
    const r = calcPunching({ ...base, mode: 'pilar-cruceta' });
    expect(r.cruceta).toBeDefined();
  });
  it('existing pilar mode is unaffected (no cruceta detail)', () => {
    const r = calcPunching({ ...base, mode: 'pilar' });
    expect(r.cruceta).toBeUndefined();
    expect(r.valid).toBe(true);
  });
  it('existing carga-puntual mode is unaffected', () => {
    const r = calcPunching({ ...base, mode: 'carga-puntual' });
    expect(r.cruceta).toBeUndefined();
  });
});

// ── Fixes auditoría adenda 8 (hallazgos #132-138) ─────────────────────────────
describe('Auditoría #132: β=1.15 interior con transferencia de momento', () => {
  it('FTUX recalibrado (VEd=260): vRd,c ~79% verde con el β correcto', () => {
    const r = calcPunching(base);
    const row = r.checks.find((c) => c.id === 'punz-ved-vrdc')!;
    expect(row.utilization).toBeGreaterThan(0.7);
    expect(row.utilization).toBeLessThan(0.8);
    expect(r.valid).toBe(true);
  });

  it('nota de validez del β simplificado presente (#138)', () => {
    const r = calcPunching(base);
    const note = r.checks.find((c) => c.id === 'punz-beta-note')!;
    expect(note).toBeTruthy();
    expect(note.neutral).toBe(true);
  });
});

describe('Auditoría #133: degateo de vRd,c con cercos', () => {
  // vEd > vRd,c pero vRd,cs cubre: antes valid=false (INCUMPLE falso)
  const withStirrups = calcPunching({
    ...base, VEd: 400, hasShearReinf: true, swDiam: 8, swLegs: 2, sr: 100,
  });

  it('vRd,c en warn (informativo), no fail', () => {
    const row = withStirrups.checks.find((c) => c.id === 'punz-ved-vrdc')!;
    expect(row.status).toBe('warn');
    expect(row.description).toMatch(/cercos toman el exceso/);
  });

  it('vRd,cs pasa y el resultado es VÁLIDO (antes INCUMPLE falso)', () => {
    const cs = withStirrups.checks.find((c) => c.id === 'punz-ved-vrdcs')!;
    expect(cs.status).not.toBe('fail');
    expect(withStirrups.valid).toBe(true);
  });

  it('sin cercos, vRd,c sigue vinculando (fail si vEd > vRd,c)', () => {
    const r = calcPunching({ ...base, VEd: 400, hasShearReinf: false });
    expect(r.checks.find((c) => c.id === 'punz-ved-vrdc')!.status).toBe('fail');
    expect(r.valid).toBe(false);
  });

  it('nota de disposición presente con cercos (#134)', () => {
    const note = withStirrups.checks.find((c) => c.id === 'punz-layout-note')!;
    expect(note).toBeTruthy();
    expect(note.neutral).toBe(true);
    expect(note.description).toMatch(/uout/);
  });
});

describe('Auditoría #136: ρl real en la fórmula (sin suelo en ρmin)', () => {
  it('armado bajo mínimos: vRd,c usa el ρ real (gobernado por vmin) y la fila avisa con util real', () => {
    // Ø6@300 → ρ ≈ 0.0283/300/200... muy bajo → vRd,c = vmin
    const r = calcPunching({ ...base, barDiamSup: 6, sSup: 300 });
    expect(r.rhoLClamped).toBe(true);
    expect(r.vRdc).toBeCloseTo(r.vMin, 6);
    const row = r.checks.find((c) => c.id === 'punz-rho-min')!;
    expect(row.status).toBe('fail');             // regla constructiva (2026-09-27)
    expect(row.utilization).toBeGreaterThan(1);  // ρmin/ρ real, no 0.85 fabricado
  });
});

describe('Auditoría #137: fy de UPN por espesor en cruceta', () => {
  it('UPN400 (tf=18): MRd con fy=265 exacto del catálogo (fix #137)', () => {
    const r = calcPunching({ ...base, mode: 'pilar-cruceta', upnSize: 400, d: 400, VEd: 800 });
    expect(r.cruceta).toBeDefined();
    const upn = getUPN(400)!;
    const W = (r.cruceta!.upnClass <= 2 ? upn.Wpl_y : upn.Wel_y) * 1000;
    expect(r.cruceta!.MRd).toBeCloseTo(W * 265 / 1.05 / 1e6, 3);
  });

  it('UPN160 (tf=10.5): fy nominal intacto', () => {
    const r = calcPunching({ ...base, mode: 'pilar-cruceta', upnSize: 160, d: 400, VEd: 800 });
    const upn = getUPN(160)!;
    const W = (r.cruceta!.upnClass <= 2 ? upn.Wpl_y : upn.Wel_y) * 1000;
    expect(r.cruceta!.MRd).toBeCloseTo(W * 275 / 1.05 / 1e6, 3);
  });
});

// ── Tope de la (6.52): vRd,cs ≤ kmax·vRd,c, kmax = 1,5 ──────────────────────────
describe('vRd,cs topada a 1,5·vRd,c (CE Anejo 19 (6.52))', () => {
  const fuerte = {
    ...base, cx: 450, cy: 450, d: 300, h: 350, fck: 30, VEd: 800,
    hasShearReinf: true, swDiam: 10, swLegs: 4, sr: 150,
  };
  it('con cercos generosos manda el tope', () => {
    const r = calcPunching(fuerte);
    expect(K_MAX_CS).toBe(1.5);
    expect(r.vRdcsBruto!).toBeGreaterThan(1.5 * r.vRdc);                   // 1,08 sin tope
    expect(r.vRdcs!).toBeCloseTo(1.5 * r.vRdc, 12);                        // 0,70
    const cs = r.checks.find((c) => c.id === 'punz-ved-vrdcs')!;
    expect(cs.utilization).toBeCloseTo(r.vEd / (1.5 * r.vRdc), 9);         // 78 %, no 51 %
    expect(cs.description).toMatch(/topada/);
  });
  it('con cercos justos el tope no llega y vRd,cs es la de la fórmula', () => {
    const r = calcPunching({ ...fuerte, swDiam: 6, swLegs: 2, sr: 200 });
    expect(r.vRdcsBruto!).toBeLessThan(1.5 * r.vRdc);
    expect(r.vRdcs).toBe(r.vRdcsBruto);
    expect(r.checks.find((c) => c.id === 'punz-ved-vrdcs')!.description).not.toMatch(/topada/);
  });
});

// ── Geometría de los perímetros (la que comparten motor y lienzo) ─────────────
describe('perímetros de la misma forma (§6.4.2(7))', () => {
  it('distanciaDePerimetro deshace perimetroADistancia en las cuatro formas', () => {
    const areas = [
      { cx: 450, cy: 350, circular: false, position: 'interior' as const },
      { cx: 400, cy: 0 + 400, circular: true, position: 'interior' as const },
      { cx: 400, cy: 300, circular: false, position: 'borde' as const },
      { cx: 350, cy: 250, circular: false, position: 'esquina' as const },
    ];
    for (const a of areas) {
      for (const dist of [0, 150, 600, 1234]) {
        expect(distanciaDePerimetro(a, perimetroADistancia(a, dist))).toBeCloseTo(dist, 9);
      }
    }
  });
  it('uout: la distancia a la que el perímetro mide βVEd/(vRd,c·d)', () => {
    const inp = { ...base, cx: 450, cy: 450, d: 300, h: 250, fck: 30, VEd: 800 };
    const r = calcPunching(inp);
    const a = distanciaDePerimetro(areaCargada(inp), r.uout);
    expect(a).toBeCloseTo((r.uout - 1800) / (2 * Math.PI), 9);             // 753 mm
    expect(a).toBeGreaterThan(2 * inp.d);                                   // vEd > vRd,c ⇒ uout fuera de u1
  });
  it('filas de cercos: desde 0,5d cada sr hasta uout − 1,5d, dos como mínimo', () => {
    expect(filasDeCercos(300, 150, 753)).toEqual([150, 300, 450]);          // 450 ≥ 753 − 450 = 303
    expect(filasDeCercos(250, 150, 923)).toEqual([125, 275, 425, 575]);     // 575 ≥ 548
    expect(filasDeCercos(300, 150, 500)).toEqual([150, 300]);               // mínimo 2
  });
});
