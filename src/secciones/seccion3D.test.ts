/**
 * seccion3D(): J del rectángulo frente a la serie directa y a la tabla de Timoshenko y Goodier,
 * propiedades de la T frente a una integración numérica independiente, y conversiones del
 * catálogo de acero de Concreta.
 */
import { describe, expect, it } from "vitest";
import { acero, circular, hormigon, perfilI, rectangular, seccionT, torsionRectangulo } from "./seccion3D.ts";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("torsión de Saint-Venant del rectángulo", () => {
  it("coincide con la serie directa sumada hasta n = 400 001 (≤ 1e-14)", () => {
    for (const r of [1, 1.5, 2, 3.7, 10]) {
      let s = 0;
      for (let n = 400001; n >= 1; n -= 2) s += Math.tanh((n * Math.PI * r) / 2) / n ** 5; // de menor a mayor
      const directa = r * (1 / 3 - (64 / Math.PI ** 5) * (1 / r) * s);
      expect(rel(torsionRectangulo(r, 1), directa)).toBeLessThan(1e-14);
      expect(torsionRectangulo(1, r)).toBe(torsionRectangulo(r, 1));
    }
  });

  it("tabla de Timoshenko y Goodier (k₁ = J/(a·b³)) y asíntota de la pletina", () => {
    const tabla: [number, number][] = [[1, 0.141], [1.5, 0.196], [2, 0.229], [2.5, 0.249], [3, 0.263], [4, 0.281], [5, 0.291], [10, 0.312]];
    for (const [r, k1] of tabla) expect(torsionRectangulo(r, 1) / r).toBeCloseTo(k1, 3);
    expect(torsionRectangulo(1, 1)).toBeCloseTo(0.140577, 6);
    // a/b grande: J ≈ a·b³/3·(1 − 0,630·b/a)
    expect(rel(torsionRectangulo(100, 1), (100 / 3) * (1 - 0.6302 / 100))).toBeLessThan(1e-5);
  });
});

describe("secciones", () => {
  const H = hormigon(25);

  it("hormigón con el E del solver de Concreta y acero de 210 GPa", () => {
    expect(rel(H.E, 8500 * Math.cbrt(33) * 1e3)).toBeLessThan(1e-15);
    expect(rel(H.G, H.E / 2.4)).toBeLessThan(1e-15);
    expect(acero().E).toBe(2.1e8);
  });

  it("rectángulo: el canto según z da el eje fuerte en Iy; Av = 5/6·A", () => {
    const s = rectangular(0.3, 0.6, H);
    expect(rel(s.Iy, (0.3 * 0.6 ** 3) / 12)).toBeLessThan(1e-15);
    expect(s.Iy).toBeGreaterThan(s.Iz);
    expect(rel(s.Avz!, (5 / 6) * 0.18)).toBeLessThan(1e-15);
    expect(rel(s.J, torsionRectangulo(0.6, 0.3))).toBeLessThan(1e-15);
  });

  it("círculo: J = 2I y Av = 0,9·A", () => {
    const s = circular(0.4, H);
    expect(rel(s.J, 2 * s.Iy)).toBeLessThan(1e-15);
    expect(rel(s.Avy!, 0.9 * Math.PI * 0.04)).toBeLessThan(1e-15);
  });

  it("T de vigueta: A, zg, Iy e Iz frente a una integración por rejilla (≤ 1e-6)", () => {
    const [bf, hf, bw, h] = [0.7, 0.05, 0.12, 0.3];
    const { seccion: s, zg } = seccionT(bf, hf, bw, h, H);
    // rejilla de celdas de 0,5 mm con el punto medio: exacta para A y zg, O(h²) para las inercias
    const d = 0.0005;
    let A = 0;
    let Sz = 0;
    let Szz = 0;
    let Syy = 0;
    for (let z = d / 2; z < h; z += d) {
      const ancho = z > h - hf ? bf : bw;
      const n = Math.round(ancho / d);
      for (let k = 0; k < n; k++) {
        const y = -ancho / 2 + (k + 0.5) * d;
        A += d * d;
        Sz += z * d * d;
        Szz += (z * z + (d * d) / 12) * d * d;
        Syy += (y * y + (d * d) / 12) * d * d;
      }
    }
    const zgN = Sz / A;
    expect(rel(s.A, A)).toBeLessThan(1e-9);
    expect(rel(zg, zgN)).toBeLessThan(1e-9);
    expect(rel(s.Iy, Szz - A * zgN * zgN)).toBeLessThan(1e-6);
    expect(rel(s.Iz, Syy)).toBeLessThan(1e-6);
    expect(rel(s.Avz!, bw * h)).toBeLessThan(1e-15);
  });

  it("perfil del catálogo de Concreta (IPE 300) pasa a m con las áreas de cortante de CSI", () => {
    const s = perfilI({ A: 53.8, Iy: 8356, Iz: 603.8, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 });
    expect(rel(s.A, 53.8e-4)).toBeLessThan(1e-15);
    expect(rel(s.Iy, 8356e-8)).toBeLessThan(1e-15);
    expect(rel(s.J, 20.1e-8)).toBeLessThan(1e-15);
    expect(rel(s.Avz!, 0.3 * 0.0071)).toBeLessThan(1e-15);
    expect(rel(s.Avy!, (5 / 3) * 0.15 * 0.0107)).toBeLessThan(1e-14);
  });
});
