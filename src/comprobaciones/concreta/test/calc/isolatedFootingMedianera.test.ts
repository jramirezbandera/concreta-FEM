// Zapatas medianeras y de esquina, con y sin viga centradora.
//
// Oráculo: T. Cabrera (UPM), «La zapata de medianería», ejemplos 1 y 2
// (`ejemplos zapatas/L10_Zapata_medianeria.pdf`, págs. 10-14). El resto de
// valores esperados están calculados a mano en los comentarios.

import { describe, expect, it } from 'vitest';
import { calcIsolatedFooting, posicionPilar } from '../../lib/calculations/isolatedFooting.ts';
import { isolatedFootingDefaults, type IsolatedFootingInputs } from '../../data/defaults.ts';
import { getConcrete } from '../../data/materials.ts';

const base: IsolatedFootingInputs = { ...isolatedFootingDefaults };
const fila = (r: ReturnType<typeof calcIsolatedFooting>, id: string) => r.checks.find((c) => c.id === id);

// ── Oráculo UPM, ejemplo 2 (págs. 13-14) ─────────────────────────────────────
// Pilar 40×40, N1k = 820 G + 460 Q = 1280 kN; Nd1 = 1,35·820 + 1,5·460 = 1797.
// Zapata 2,25 (en la dirección de la viga) × 3,00 × 0,95; ℓ = 6,00; e = 0,925.
// El módulo usa un γ global: γ = 1797/1280.
const ej2: IsolatedFootingInputs = {
  ...base,
  tipo: 'medianera', vigaX: true, luzX: 6.0,
  B: 2.25, L: 3.0, h: 0.95, bc: 0.4, hc: 0.4, Df: 0.95,
  sigma_adm: 250,
  loadsAreFactored: false, loadFactor: 1797 / 1280, N: 1280,
};

describe('Viga centradora — oráculo UPM, ejemplo 2', () => {
  const r = calcIsolatedFooting(ej2);

  it('e = (b1 − b0)/2 = 0,925 m', () => {
    expect(r.vigaX).not.toBeNull();
    expect(r.vigaX!.e).toBeCloseTo(0.925, 6);
  });

  it('σ1 = (P1 + N1·ℓ/(ℓ − e)) / (a1·b1) = 2,48 daN/cm² ≤ σadm', () => {
    // (3·2,25·0,95·25 + 1280·6/5,075) / (3·2,25) = (160,3 + 1513,3) / 6,75
    expect(r.R_sls).toBeCloseTo(1280 * 6 / 5.075, 1);
    expect(r.sigma_max).toBeCloseTo(247.9, 0);
    expect(r.distributionType).toBe('trapezoidal');
    expect(fila(r, 'bearing')!.status).not.toBe('fail');
  });

  it('presión de cálculo σt1d = 1797·6 / (2,25·3·5,075) = 314,75 kN/m²', () => {
    expect(r.sigma_Ed_uniform).toBeCloseTo(314.75, 1);
  });

  it('cortante de la viga V1d = 327,53 kN', () => {
    expect(r.vigaX!.Vd).toBeCloseTo(327.53, 1);
  });

  it('flector en la cara de la zapata M1d = 1293,75 kNm, tracción arriba', () => {
    expect(r.vigaX!.Md).toBeCloseTo(1293.75, 0);
    expect(r.vigaX!.traccion).toBe('superior');
    expect(r.vigaX!.dCara).toBeCloseTo(2.25 - 0.2, 6);
  });

  it('descarga al pilar interior en servicio: N1·e/(ℓ − e)', () => {
    expect(r.vigaX!.dN_sls).toBeCloseTo(1280 * 0.925 / 5.075, 1);
  });
});

// ── Oráculo UPM, ejemplo 1 (págs. 10-12) ─────────────────────────────────────
describe('Viga centradora — oráculo UPM, ejemplo 1', () => {
  const r = calcIsolatedFooting({
    ...base,
    tipo: 'medianera', vigaX: true, luzX: 5.0,
    B: 2.0, L: 3.9, h: 0.9, bc: 0.3, hc: 0.3, Df: 0.9,
    sigma_adm: 150, N: 800,
  });

  it('R1 = 800·5/4,15 + 175,5 = 1139,4 kN y σ = 1,46 daN/cm²', () => {
    expect(r.R_sls + r.W_footing + r.W_soil).toBeCloseTo(1139.4, 0);
    expect(r.sigma_max).toBeCloseTo(146.1, 0);
  });

  it('descarga al pilar interior 163,9 kN', () => {
    expect(r.vigaX!.dN_sls).toBeCloseTo(163.9, 0);
  });
});

// ── Medianera sin viga: el terreno absorbe la excentricidad ─────────────────
// Por defecto: N = 300, B = L = 1,8, h = 0,6, Df = 0,8, pilar 0,40.
//   W = 48,6 + 18·0,2·(3,24 − 0,16) = 59,688 → Ntot = 359,688 kN
//   e = 300·0,70/359,688 = 0,5838 m > B/6 → bitriangular
//   σmax = 2·359,688 / (3·1,8·(0,9 − 0,5838)) = 421,4 kPa
describe('Medianera sin viga centradora', () => {
  const r = calcIsolatedFooting({ ...base, tipo: 'medianera' });

  it('pilar enrasado con el lindero x = −B/2', () => {
    expect(posicionPilar({ ...base, tipo: 'medianera' })).toEqual({ cx: -0.7, cy: 0 });
    expect(r.cx_pilar).toBeCloseTo(-0.7, 6);
  });

  it('la resultante se va hacia el lindero y las presiones salen bitriangulares', () => {
    expect(r.exR_sls).toBeCloseTo(-300 * 0.7 / 359.688, 3);
    expect(r.distributionType).toBe('bitriangular_uniaxial');
    expect(r.sigma_max).toBeCloseTo(421.4, 0);
    expect(r.loaded_area_fraction).toBeCloseTo(3 * (0.9 - 0.58384) / 1.8, 2);
    expect(fila(r, 'bearing')!.status).toBe('fail');
  });

  it('despega, pero la tracción de la cara superior la aguanta el hormigón', () => {
    // ELU con el peso a 1,35: V = 405 + 1,35·59,688; la zona despegada cuelga
    // con q = 1,35·(25·0,6 + 18·0,2) = 25,11 kPa. A mano, el peor flector de
    // la cara superior sale hacia x ≈ −0,25: ≈ 13,9 kNm/m.
    // Sin armar (CE Anejo 19 §12.9.3): fct,d = 0,8·0,7·fctm/1,5 y
    // M = fct,d·(0,85·0,60)²/6 ≈ 41 kNm/m.
    const fctd = (0.8 * 0.7 * getConcrete(base.fck).fctm) / 1.5;
    expect(r.M_fis_sup).toBeCloseTo((fctd * 1000 * 0.51 ** 2) / 6, 6);
    expect(r.MEd_sup_x).toBeCloseTo(13.9, 0);
    expect(r.necesitaSup_x).toBe(false);
    expect(r.necesitaSup_y).toBe(false);
    const c = fila(r, 'traccion-sup-x')!;
    expect(c.status).toBe('ok');
    expect(c.utilization).toBeCloseTo(r.MEd_sup_x / r.M_fis_sup, 6);
    expect(fila(r, 'armado-sup-x')).toBeUndefined();
    expect(fila(r, 'traccion-sup-y')).toBeUndefined();
  });

  // Más axil y menos canto: 37,6 kNm/m arriba frente a 23,3 sin armar.
  const med2: IsolatedFootingInputs = { ...base, tipo: 'medianera', N: 800, B: 2.6, L: 2.6, h: 0.45 };

  it('si la tracción supera la del hormigón sin armar, pide parrilla; sin ella no cumple y propone barras', () => {
    const r2 = calcIsolatedFooting(med2);
    expect(r2.MEd_sup_x).toBeGreaterThan(r2.M_fis_sup);
    expect(r2.necesitaSup_x).toBe(true);
    const c = fila(r2, 'armado-sup-x')!;
    expect(c.status).toBe('fail');
    expect(c.description).toMatch(/la pide el despegue \(p\. ej\. Ø\d+ c\/\d+\)/);
    expect(fila(r2, 'traccion-sup-x')).toBeUndefined();
    expect(fila(r2, 'armado-sup-y')).toBeUndefined();
  });

  it('con la armadura superior puesta, se comprueba como cualquier otra', () => {
    const r2 = calcIsolatedFooting({ ...med2, supLleva: true, phi_sup_x: 16, s_sup_x: 150 });
    const c = fila(r2, 'armado-sup-x')!;
    expect(c.status).not.toBe('fail');
    expect(r2.As_prov_sup_x).toBeCloseTo((Math.PI * 16 * 16 / 4) / 150 * 1000, 0);
    expect(fila(r2, 'armado-sup-y')!.neutral).toBe(true);
    expect(fila(r2, 'separacion-sup-x')).toBeDefined();
  });

  it('punzonamiento con el perímetro de borde: hc + 2bc + 2πd', () => {
    expect(r.punchingPosition).toBe('borde');
    expect(r.u1).toBeCloseTo(400 + 2 * 400 + 2 * Math.PI * r.d_avg, 3);
  });

  it('el vuelo es uno solo, B − bc, del lado interior', () => {
    expect(r.vuelos.xNeg).toBeCloseTo(0, 6);
    expect(r.vuelos.xPos).toBeCloseTo(1400, 6);
    expect(r.ax).toBeCloseTo(1400, 6);
    expect(r.v_max).toBeCloseTo(1.4, 6);
    expect(r.isRigid).toBe(false);
  });

  it('vuelco hacia el lindero con el brazo real del axil, bc/2', () => {
    // My = −50 empuja hacia −x: estabiliza 300·(0,9 − 0,7) + 59,688·0,9 = 113,72
    const rv = calcIsolatedFooting({ ...base, tipo: 'medianera', My: -50 });
    expect(rv.M_dest_x).toBeCloseTo(50, 6);
    expect(rv.M_stab_x).toBeCloseTo(113.72, 1);
    expect(rv.FS_overturn_x).toBeCloseTo(113.72 / 50, 2);
  });
});

// ── Medianera con viga centradora (por defecto, ℓ = 5) ──────────────────────
//   R = 300·5/4,3 = 348,84; σ = (348,84 + 59,688)/3,24 = 126,1 kPa, uniforme
//   ELU: Vd = 405·0,7/4,3 = 65,93; Md = 65,93·(5 − 1,6) = 224,2 kNm
describe('Medianera con viga centradora', () => {
  const r = calcIsolatedFooting({ ...base, tipo: 'medianera', vigaX: true, luzX: 5 });

  it('la zapata trabaja centrada con R > N', () => {
    expect(r.R_sls).toBeCloseTo(348.84, 1);
    expect(r.exR_sls).toBeCloseTo(0, 9);
    expect(r.distributionType).toBe('trapezoidal');
    expect(r.sigma_max).toBeCloseTo(126.1, 0);
    expect(r.sigma_min).toBeCloseTo(r.sigma_max, 6);
  });

  it('esfuerzos de la viga en la cara interior de la zapata', () => {
    expect(r.vigaX!.Vd).toBeCloseTo(65.93, 1);
    expect(r.vigaX!.Md).toBeCloseTo(224.2, 0);
    // Sus esfuerzos van en vigaX, no como filas de comprobación.
    expect(r.checks.some((c) => c.id.startsWith('viga-'))).toBe(false);
  });

  it('la flexión en x es de la viga; la parrilla y vuela desde ella', () => {
    expect(fila(r, 'flexion-x')!.neutral).toBe(true);
    expect(fila(r, 'biela-tirante-x')!.neutral).toBe(true);
    expect(r.As_adopted_x).toBeCloseTo(r.As_min_x, 6);
    // Sólo cuenta el vuelo en y, (1,8 − 0,4)/2 = 0,70 ≤ 2h → rígida
    expect(r.v_max).toBeCloseTo(0.7, 6);
    expect(r.isRigid).toBe(true);
    expect(fila(r, 'biela-tirante-y')!.neutral).not.toBe(true);
  });

  it('sin despegue no hay armadura superior y no hay vuelco en x', () => {
    expect(r.necesitaSup_x).toBe(false);
    expect(fila(r, 'armado-sup-x')).toBeUndefined();
    expect(r.M_dest_x).toBe(0);
  });

  it('un My que comprime el lado interior descarga la viga: R = (N·ℓ − My)/(ℓ − e)', () => {
    const rM = calcIsolatedFooting({ ...base, tipo: 'medianera', vigaX: true, luzX: 5, My: 60 });
    expect(rM.R_sls).toBeCloseTo((300 * 5 - 60) / 4.3, 2);
    expect(rM.vigaX!.dN_sls).toBeCloseTo((rM.R_sls * 0.7 - 60) / 5, 2);
  });

  it('el punzonamiento carga con R, no con N: la viga baja su descarga al nudo (Copilot, PR #38)', () => {
    // Bloque = zapata entera (viga en x, sin Mx): el contorno abierto de borde,
    // bc·hc + a·hc + 2a·bc + πa²/2, cabe dentro. β = 1,4 (mínimo de borde).
    expect(r.R_elu).toBeGreaterThan(r.N_elu);
    const a = r.a_punch / 1000, d = r.d_avg / 1000;
    const A = 0.16 + a * 0.4 + 2 * a * 0.4 + (Math.PI * a * a) / 2;
    const u = 0.4 + 2 * 0.4 + Math.PI * a;
    const vEd = (1.4 * (r.R_elu - r.sigma_Ed_uniform * A)) / (u * d) / 1000;
    expect(r.vEd_punch).toBeCloseTo(vEd, 6);
    const u0 = Math.min(400 + 3 * r.d_avg, 400 + 2 * 400);
    expect(fila(r, 'punzonamiento-max')!.valueNum).toBeCloseTo((1.4 * r.R_elu * 1000) / (u0 * r.d_avg), 2);
  });

  it('la luz debe dejar el pilar interior fuera de la zapata', () => {
    const rl = calcIsolatedFooting({ ...base, tipo: 'medianera', vigaX: true, luzX: 1.5 });
    expect(rl.error).toMatch(/luz de la viga centradora en x/);
  });

  it('la viga en y no cuenta en una medianera, ni ninguna en una centrada', () => {
    const rY = calcIsolatedFooting({ ...base, tipo: 'medianera', vigaY: true });
    expect(rY.vigaY).toBeNull();
    const rC = calcIsolatedFooting({ ...base, vigaX: true, vigaY: true });
    expect(rC.vigaX).toBeNull();
    expect(rC.R_sls).toBeCloseTo(300, 9);
  });
});

// ── Esquina ──────────────────────────────────────────────────────────────────
describe('Zapata de esquina', () => {
  it('con dos vigas: R = N / (1 − ex/ℓx − ey/ℓy)', () => {
    // 300 / (1 − 0,14 − 0,14) = 416,67; ΔN = R·0,7/5 = 58,33 en cada viga
    const r = calcIsolatedFooting({ ...base, tipo: 'esquina', vigaX: true, vigaY: true, luzX: 5, luzY: 5 });
    expect(r.R_sls).toBeCloseTo(416.67, 1);
    expect(r.vigaX!.dN_sls).toBeCloseTo(58.33, 1);
    expect(r.vigaY!.dN_sls).toBeCloseTo(58.33, 1);
    expect(r.distributionType).toBe('trapezoidal');
    expect(r.sigma_max).toBeCloseTo((416.67 + r.W_footing + r.W_soil) / 3.24, 1);
    expect(r.punchingPosition).toBe('esquina');
    // Cada parrilla vuela desde la viga de la otra dirección: vuelos de 1,40 m
    // > 2h → flexible, con la flexión activa en las dos.
    expect(r.isRigid).toBe(false);
    expect(fila(r, 'flexion-x')!.neutral).toBeFalsy();
    expect(fila(r, 'flexion-y')!.neutral).toBeFalsy();
    expect(r.MEd_x).toBeCloseTo(r.sigma_Ed_uniform * 1.4 * 1.4 / 2, 3);
    expect(r.Td_x).toBeGreaterThan(0);
    expect(r.Td_y).toBeGreaterThan(0);
  });

  it('con una sola viga, la excentricidad de la otra dirección va al terreno', () => {
    // R = 300·5/4,3 = 348,84; ey = R·(−0,7)/(R + W)
    const r = calcIsolatedFooting({ ...base, tipo: 'esquina', vigaX: true, luzX: 5 });
    expect(r.vigaY).toBeNull();
    expect(r.R_sls).toBeCloseTo(348.84, 1);
    expect(r.exR_sls).toBeCloseTo(0, 9);
    expect(r.eyR_sls).toBeCloseTo((348.84 * -0.7) / (348.84 + r.W_footing + r.W_soil), 3);
    // La tracción superior va en y (≈ 14,5 kNm/m), dentro de lo que aguanta el
    // hormigón sin armar; en x, la de la viga, no hay.
    expect(r.MEd_sup_y).toBeGreaterThan(1);
    expect(r.MEd_sup_x).toBe(0);
    expect(r.necesitaSup_y).toBe(false);
    expect(fila(r, 'traccion-sup-y')!.status).toBe('ok');
  });

  it('sin vigas, biexcéntrica y muy lejos de cumplir', () => {
    const r = calcIsolatedFooting({ ...base, tipo: 'esquina' });
    expect(['bitriangular_biaxial', 'overturning_fail']).toContain(r.distributionType);
    expect(fila(r, 'bearing')!.status).toBe('fail');
    expect(r.u1).toBeCloseTo(400 + 400 + Math.PI * r.d_avg, 3);
  });
});

// ── Despegue en zapata centrada ──────────────────────────────────────────────
describe('Armadura superior en zapata centrada', () => {
  it('sin momento no hay despegue ni filas de armadura superior', () => {
    const r = calcIsolatedFooting(base);
    expect(r.necesitaSup_x || r.necesitaSup_y).toBe(false);
    expect(r.checks.some((c) => c.id.startsWith('armado-sup'))).toBe(false);
  });

  it('con la resultante fuera del núcleo hay tracción arriba, pero no pide parrilla', () => {
    // e = 200/359,688 = 0,556 m > B/6. Antes, con un umbral de 0,5 kNm/m, la
    // zapata INCUMPLÍA por unos pocos kNm/m que el hormigón aguanta de sobra.
    const r = calcIsolatedFooting({ ...base, My: 200 });
    expect(r.distributionType).toBe('bitriangular_uniaxial');
    expect(r.MEd_sup_x).toBeGreaterThan(0.5);
    expect(r.necesitaSup_x).toBe(false);
    expect(fila(r, 'traccion-sup-x')!.status).toBe('ok');
    expect(fila(r, 'armado-sup-x')).toBeUndefined();
  });
});

describe('Ley de presiones de servicio expuesta (planoSls)', () => {
  // El lienzo corta este plano por la traza A-A y parte la planta por su eje
  // neutro. Tiene que ser EL MISMO que da σmax, o el dibujo y la comprobación
  // cuentan cosas distintas.
  const maxEsquinas = (r: ReturnType<typeof calcIsolatedFooting>, B: number, L: number) => {
    const p = r.planoSls!;
    return Math.max(...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => p.a + p.bx * sx * B / 2 + p.by * sy * L / 2));
  };

  it('esquina sin vigas: el pico está en la esquina del pilar y vale σmax', () => {
    const r = calcIsolatedFooting({ ...base, tipo: 'esquina' });
    expect(r.distributionType).toBe('bitriangular_biaxial');
    const p = r.planoSls!;
    expect(p.bx).toBeLessThan(0);
    expect(p.by).toBeLessThan(0);
    expect(maxEsquinas(r, base.B, base.L)).toBeCloseTo(r.sigma_max, 6);
    expect(p.a - p.bx * base.B / 2 - p.by * base.L / 2).toBeCloseTo(r.sigma_max, 6);
  });

  it('esquina con viga en x: la ley sólo varía en y', () => {
    const r = calcIsolatedFooting({ ...base, tipo: 'esquina', vigaX: true, luzX: 5 });
    expect(r.planoSls!.bx).toBe(0);
    expect(r.planoSls!.by).toBeLessThan(0);
    expect(maxEsquinas(r, base.B, base.L)).toBeCloseTo(r.sigma_max, 6);
  });

  it('medianera sin viga y centrada con momento: σmax en el borde que toca', () => {
    for (const inp of [{ ...base, tipo: 'medianera' as const }, { ...base, My: 120 }, { ...base, My: 40, Mx: 30 }]) {
      const r = calcIsolatedFooting(inp);
      expect(maxEsquinas(r, inp.B, inp.L)).toBeCloseTo(r.sigma_max, 6);
    }
  });

  it('vuelco: sin plano', () => {
    expect(calcIsolatedFooting({ ...base, My: 2000 }).planoSls).toBeNull();
  });
});
