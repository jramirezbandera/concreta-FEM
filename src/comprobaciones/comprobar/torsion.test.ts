/**
 * Fase CO2 (CO-h): la torsión, frente a un caso hecho a mano.
 *
 * La sección: 30 × 50 cm, HA-25 (fcd = 16,7 y fctm = 2,56 MPa, los de la tabla del módulo), B500
 * (fyd = 500/1,15), con la armadura longitudinal a c' = 30 + 8 + 16/2 = 46 mm del paramento.
 *
 *   A = 150 000 mm²   u = 1 600 mm   A/u = 93,75 mm ≥ 2·c' = 92 mm   →   tef = 93,75 mm
 *   Ak = (300 − 93,75)·(500 − 93,75) = 206,25·406,25 = 83 789,0625 mm²
 *   uk = 2·(300 + 500 − 2·93,75) = 1 225 mm
 *   ν = 0,6·(1 − 25/250) = 0,54        sen θ·cos θ = 2/5 con cot θ = 2
 *   TRd,máx = 2·0,54·16,7·83 789,0625·93,75·0,4 = 56 670 732 N·mm = 56,6707 kN·m
 *   fctd = 0,7·2,56/1,5 = 1,19467 MPa
 *   TRd,c = 2·83 789,0625·93,75·1,19467 = 18 768 750 N·mm = 18,76875 kN·m
 *
 * Con TEd = 10 kN·m:
 *   cercos, por rama: 10·10⁶ / (2·83 789,0625·434,7826·2) = 0,0686247 mm²/mm
 *   tracción longitudinal: 10·10⁶·1 225·2 / (2·83 789,0625) = 146 200,47 N
 *
 * Y con VEd = 80 kN, MEd = 60 kN·m, MRd = 111,4 kN·m, VRd,máx = 442,2 kN, d = 454 mm, 3Ø16 a
 * tracción (603,3 mm²), 2Ø12 a compresión (226,2 mm²) y cercos Ø8 (50,3 mm²) a 150 de 2 ramas:
 *   biela: 10/56,6707 + 80/442,2 = 0,357372
 *   cercos: 80 000/(2·0,9·454·434,7826·2) + 0,0686247 = 0,181204 mm²/mm; hay 50,3/150 = 0,335333
 *           → 0,540371
 *   longitudinal: traccionado 60/111,4 + (146 200,47/2)/(603,3·434,7826) = 0,817284;
 *                 comprimido (146 200,47/2)/(226,2·434,7826) = 0,743283 → manda el traccionado
 *   separación de cercos: s,máx = mín(1 600/8; 300; 500) = 200 mm → 150/200 = 0,75
 *   barras: 200/350 = 0,571
 */
import { describe, expect, it } from "vitest";
import { cercoTorsion, filaTorsionCompatibilidad, filasTorsion, torsionRC, traccionTorsion, type EstadoTorsion } from "./torsion.ts";

const SECCION = { b: 300, h: 500, fck: 25, fyk: 500, cPrima: 46 };
const ESTADO: EstadoTorsion = { TEd: 10, VEd: 80, MEd: 60, MRd: 111.4, VRdMax: 442.2, VRdC: 66.7, d: 454, AsTraccion: 603.3, AsCompresion: 226.2, cercoDiametro: 8, cercoSeparacion: 150, ramas: 2, separacionBarras: 200 };

describe("CO2: torsión de una sección rectangular (CE A19 §6.3), a mano", () => {
  it("la sección hueca eficaz y sus resistencias", () => {
    const t = torsionRC(SECCION)!;
    expect(t.tef).toBeCloseTo(93.75, 12);
    expect(t.Ak).toBeCloseTo(83789.0625, 9);
    expect(t.uk).toBeCloseTo(1225, 12);
    expect(t.u).toBe(1600);
    expect(t.TRdMax).toBeCloseTo(56.670732421875, 9);
    expect(t.TRdC).toBeCloseTo(18.76875, 9);
    expect(cercoTorsion(t, 10)).toBeCloseTo(0.0686247086247, 12);
    expect(traccionTorsion(t, 10)).toBeCloseTo(146200.4662004662, 6);
    // Con mucho recubrimiento manda 2·c'; y si la pared no cabe, no hay comprobación
    expect(torsionRC({ ...SECCION, cPrima: 60 })!.tef).toBe(120);
    expect(torsionRC({ ...SECCION, b: 150, cPrima: 80 })).toBeNull();
  });

  it("las filas de la torsión de equilibrio", () => {
    const t = torsionRC(SECCION)!;
    const filas = Object.fromEntries(filasTorsion(t, SECCION, ESTADO).map((f) => [f.id, f]));
    expect(Object.keys(filas)).toEqual(["torsion-biela", "torsion-cercos", "torsion-longitudinal", "torsion-separacion", "torsion-barras"]);
    expect(filas["torsion-biela"]!.utilization).toBeCloseTo(0.35737154137170024, 10);
    expect(filas["torsion-cercos"]!.utilization).toBeCloseTo(0.540370522416572, 10);
    expect(filas["torsion-longitudinal"]!.utilization).toBeCloseTo(0.8172844347849504, 10);
    expect(filas["torsion-longitudinal"]!.value).toContain("traccionado");
    expect(filas["torsion-separacion"]!.utilization).toBeCloseTo(0.75, 12);
    expect(filas["torsion-barras"]!.utilization).toBeCloseTo(200 / 350, 12);
    expect(Object.values(filas).every((f) => f.status === "ok")).toBe(true);
  });

  it("cada fila falla por lo suyo", () => {
    const t = torsionRC(SECCION)!;
    const estados = (e: Partial<EstadoTorsion>) => Object.fromEntries(filasTorsion(t, SECCION, { ...ESTADO, ...e }).map((f) => [f.id, f.status]));
    // El torsor que agota la biela con ese cortante: TRd,máx·(1 − 80/442,2) = 46,42 kN·m
    expect(estados({ TEd: 46.3 })["torsion-biela"]).toBe("warn");
    expect(estados({ TEd: 46.5 })["torsion-biela"]).toBe("fail");
    // Cercos más separados: con 300 mm hay 0,1677 mm²/mm y se piden 0,1812
    expect(estados({ cercoSeparacion: 300 })).toMatchObject({ "torsion-cercos": "fail", "torsion-separacion": "fail" });
    // Sin cercos, o sin armadura en un cordón, falla sin cociente
    expect(filasTorsion(t, SECCION, { ...ESTADO, cercoSeparacion: 0 }).find((f) => f.id === "torsion-cercos")!.utilization).toBe(Infinity);
    expect(estados({ AsCompresion: 0 })["torsion-longitudinal"]).toBe("fail");
    // El cordón comprimido manda con poca flexión y menos acero arriba
    const sinFlexion = filasTorsion(t, SECCION, { ...ESTADO, MEd: 0 }).find((f) => f.id === "torsion-longitudinal")!;
    expect(sinFlexion.utilization).toBeCloseTo(0.7432826530969768, 10);
    expect(sinFlexion.value).toContain("comprimido");
    // Barras a más de 350 mm en el perímetro: regla de armado, falla
    expect(estados({ separacionBarras: 351 })["torsion-barras"]).toBe("fail");
    expect(estados({ separacionBarras: 350 })["torsion-barras"]).toBe("ok");
  });

  it("la de compatibilidad es informativa: nunca falla", () => {
    const t = torsionRC(SECCION)!;
    const f = filaTorsionCompatibilidad(t, 40, 200, 66.7);
    expect(f.status).toBe("neutral");
    expect(f.neutral).toBe(true);
    expect(f.limit).toContain("armadura mínima");
    expect(filaTorsionCompatibilidad(t, 5, 20, 66.7).limit).toContain("sin fisurar");
  });
});
