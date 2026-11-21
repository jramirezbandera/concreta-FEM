/**
 * El detalle que dibuja el lienzo de Vigas de hormigón es el del motor: las
 * cifras que el dibujo rotula (MRd por brazos, VRd por mecanismos, wk por sus
 * términos, L/d y la flecha partida) tienen que dar las de la tabla.
 *
 * La flecha directa se rehace en `rcBeamsDetalle.ts` con las expresiones del
 * bloque de calcRCBeam; si alguien cambia una y no la otra, esto salta.
 */

import { describe, expect, it } from 'vitest';
import { rcBeamDefaults, type RCBeamInputs } from '../../data/defaults.ts';
import { calcRCBeam } from '../../lib/calculations/rcBeams.ts';
import { detalleFlechaRC, detalleSeccionRC } from '../../lib/calculations/rcBeamsDetalle.ts';

const viga = (o: Partial<RCBeamInputs>) => ({ ...rcBeamDefaults, ...o }) as RCBeamInputs;

const CASOS: Partial<RCBeamInputs>[] = [
  {},
  { vano_Md: 170 },
  { mode: 'portico' },
  { vano_VEd: 180, vano_stirrupSpacing: 250 },
  { fck: 40, b: 250, h: 600, vano_bot_nBars: 3, vano_bot_barDiam: 20, vano_stirrupLegs: 4 },
  { vano_bot_nBars: 2, vano_bot_barDiam: 12, vano_Md: 20, vano_M_G: 8, vano_M_Q: 3 },
  { vano_bot_nBars: 6, vano_bot_barDiam: 25, vano_Md: 250 },
  { vano_top_nBars: 0 },
  { exposureClass: 'XC4', vano_M_G: 70, vano_M_Q: 30 },
];

describe('detalle de la sección = motor', () => {
  for (const o of CASOS) {
    for (const zona of ['vano', 'apoyo'] as const) {
      it(`${JSON.stringify(o)} · ${zona}`, () => {
        const s = viga(o);
        const r = calcRCBeam(s);
        const sec = r[zona];
        const det = detalleSeccionRC(s, zona, r)!;
        expect(det).not.toBeNull();
        // Rotura: MRd, x y el momento recompuesto por brazos.
        expect(det.rotura.M_kNm).toBeCloseTo(sec.MRd, 9);
        expect(det.rotura.x).toBeCloseTo(sec.x, 9);
        const u = det.rotura;
        const porBrazos = (-u.F_concrete * (u.d - u.z_concrete) - u.F_s_comp * (u.d - u.r_s)) / 1000;
        expect(porBrazos).toBeCloseTo(sec.MRd, 2);
        // Cortante y fisuración, cifra a cifra.
        expect(det.cortante.VRdc).toBe(sec.VRdc);
        expect(det.cortante.VRds).toBe(sec.VRds);
        expect(det.cortante.VRdmax).toBe(sec.VRdmax);
        expect(det.cortante.VRd).toBe(sec.VRd);
        expect(det.cortante.cercosCosidos * det.cortante.Asw1 * det.fyd / 1000).toBeCloseTo(sec.VRds, 9);
        expect(det.fisura.wk).toBe(sec.wk);
        if (det.fisura.Ms > 0) expect(det.fisura.srMax * det.fisura.epsDif).toBeCloseTo(sec.wk, 12);
        expect(det.As).toBe(sec.As);
        expect(det.d).toBe(sec.d);
      });
    }
  }
});

describe('detalle de la flecha = fila de la tabla', () => {
  const sistemas = ['ss', 'end', 'interior', 'cantilever'] as const;
  for (const mode of ['simple', 'portico'] as const) {
    for (const structSystem of sistemas) {
      it(`esbeltez · ${mode} · ${structSystem}`, () => {
        const s = viga({ mode, structSystem, L: 7500 });
        const r = calcRCBeam(s);
        const f = detalleFlechaRC(s, r)!;
        const fila = r.vano.checks.find((c) => c.id === 'slenderness-ld')!;
        expect(f.metodo).toBe('ld');
        if (f.metodo !== 'ld') return;
        expect(f.ld / f.lamLim).toBeCloseTo(fila.utilization, 12);
        expect(f.factorLuz).toBeCloseTo(7 / 7.5, 12);
      });
      it(`directa · ${mode} · ${structSystem}`, () => {
        const s = viga({ mode, structSystem, deflMethod: 'direct', L: 6000 });
        const r = calcRCBeam(s);
        const f = detalleFlechaRC(s, r)!;
        const fila = r.vano.checks.find((c) => c.id === 'deflection-cracked')!;
        expect(f.metodo).toBe('direct');
        if (f.metodo !== 'direct') return;
        // Instantánea + diferida = la de plazo infinito, que es la de la fila.
        expect(f.deltaInst + f.deltaDif).toBeCloseTo(f.deltaTotal, 12);
        expect(fila.value).toContain(`δ = ${f.deltaTotal.toFixed(1).replace('.', ',')} mm`);
        expect(f.deltaTotal / f.adm).toBeCloseTo(fila.utilization, 12);
        // La fluencia sólo puede alargar la flecha.
        expect(f.deltaInst).toBeGreaterThan(0);
        expect(f.deltaDif).toBeGreaterThan(0);
        expect(f.deltaInst).toBeLessThan(f.deltaTotal);
      });
    }
  }

  it('sin fisurar, la diferida es φef veces la instantánea', () => {
    const s = viga({ deflMethod: 'direct', vano_M_G: 5, vano_M_Q: 2 });
    const f = detalleFlechaRC(s, calcRCBeam(s))!;
    if (f.metodo !== 'direct') throw new Error('método');
    expect(f.zeta).toBe(0);
    expect(f.deltaDif / f.deltaInst).toBeCloseTo(f.phiEf, 12);
  });

  it('con flecha nula, el límite sigue siendo el de la fila', () => {
    const s = viga({ deflMethod: 'direct', structSystem: 'cantilever', L: 3000, vano_M_G: 0, vano_M_Q: 0 });
    const r = calcRCBeam(s);
    const fila = r.vano.checks.find((c) => c.id === 'deflection-cracked')!;
    const f = detalleFlechaRC(s, r)!;
    if (f.metodo !== 'direct') throw new Error('método');
    expect(f.deltaTotal).toBe(0);
    expect(fila.utilization).toBe(0);
    expect(fila.limit).toBe(`${f.limite} = ${f.adm.toFixed(1).replace('.', ',')} mm`);
    // Y si el motor pasa a rotular la ménsula con 2L, el detalle lo sigue.
    fila.limit = '2L/300 = 20,0 mm';
    const f2 = detalleFlechaRC(s, r)!;
    if (f2.metodo !== 'direct') throw new Error('método');
    expect(f2.limite).toBe('2L/300');
    expect(f2.adm).toBeCloseTo(20, 12);
  });

  it('L = 0 no comprueba nada y no hay detalle', () => {
    const s = viga({ L: 0 });
    expect(detalleFlechaRC(s, calcRCBeam(s))).toBeNull();
  });
});
