/**
 * CO2-j (`docs/fem3d/comprobaciones.md` §8.26): los momentos de empotramiento perfecto de un vano
 * sacados de su ley de momentos, frente a las fórmulas de prontuario. La ley que se da es la de
 * otra sustentación (biapoyada, o con momentos de extremo cualesquiera): el resultado no depende de
 * ella, sólo de las cargas.
 */
import { describe, expect, it } from "vitest";
import { momentosEmpotramiento, type TrozoMomentos } from "./empotramiento.ts";

/** Parte [a, b] en n trozos iguales con la misma ley. */
const trozos = (M: (x: number) => number, a: number, b: number, n: number, cortes: number[] = []): TrozoMomentos[] => {
  const xs = [...new Set([...Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n), ...cortes])].sort((p, q) => p - q);
  return xs.slice(1).map((x1, i) => ({ x0: xs[i]!, x1, M }));
};

describe("CO2-j: los momentos de empotramiento perfecto desde la ley de momentos", () => {
  it("carga uniforme: −q·L²/12 en los dos extremos, con la ley de la biapoyada o con cualquier otra en equilibrio", () => {
    const [q, L, a] = [40.3125, 5.6, 0.2];
    const iso = (x: number) => (q * (x - a) * (a + L - x)) / 2;
    const esperado = (-q * L * L) / 12;
    for (const [Ma, Mb] of [
      [0, 0],
      [-70, -120],
      [35, -12.5],
    ]) {
      const M = (x: number) => iso(x) + Ma! * (1 - (x - a) / L) + Mb! * ((x - a) / L);
      for (const n of [1, 3, 11]) {
        const r = momentosEmpotramiento(trozos(M, a, a + L, n), a, a + L, Ma!, Mb!)!;
        expect(r[0]).toBeCloseTo(esperado, 9);
        expect(r[1]).toBeCloseTo(esperado, 9);
      }
    }
  });

  it("carga puntual a una distancia c: −P·c·d²/L² y −P·c²·d/L²", () => {
    const [P, L, c] = [100, 6, 2];
    const d = L - c;
    const iso = (x: number) => (x <= c ? (P * d * x) / L : (P * c * (L - x)) / L);
    const r = momentosEmpotramiento(trozos(iso, 0, L, 4, [c]), 0, L, 0, 0)!;
    expect(r[0]).toBeCloseTo((-P * c * d * d) / (L * L), 9);
    expect(r[1]).toBeCloseTo((-P * c * c * d) / (L * L), 9);
  });

  it("carga triangular (de 0 a q): −q·L²/30 y −q·L²/20", () => {
    const [q, L] = [24, 5];
    // Isostática de la triangular creciente: q·x·(L² − x²)/(6·L)
    const iso = (x: number) => (q * x * (L * L - x * x)) / (6 * L);
    const r = momentosEmpotramiento(trozos(iso, 0, L, 5), 0, L, 0, 0)!;
    expect(r[0]).toBeCloseTo((-q * L * L) / 30, 9);
    expect(r[1]).toBeCloseTo((-q * L * L) / 20, 9);
  });

  it("un par concentrado M₀ en c: los de prontuario, con el salto dentro de la ley", () => {
    const [M0, L, c] = [50, 8, 3];
    const d = L - c;
    // Biapoyada con un par horario en c: reacciones ∓M0/L y un salto de M0
    const iso = (x: number) => (x < c ? (-M0 * x) / L : (M0 * (L - x)) / L);
    const r = momentosEmpotramiento(
      [
        { x0: 0, x1: c, M: (x) => (-M0 * x) / L },
        { x0: c, x1: L, M: (x) => (M0 * (L - x)) / L },
      ],
      0,
      L,
      0,
      0,
    )!;
    void iso;
    // Los giros de extremo de la ley completa, nulos (la definición), comprobados con otra cuadratura
    const completa = (x: number) => (x < c ? (-M0 * x) / L : (M0 * (L - x)) / L) + r[0] * (1 - x / L) + (r[1] * x) / L;
    let [g1, g2] = [0, 0];
    const N = 200000;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) * L) / N;
      g1 += (completa(x) * (1 - x / L) * L) / N;
      g2 += (completa(x) * (x / L) * L) / N;
    }
    expect(Math.abs(g1)).toBeLessThan(1e-6);
    expect(Math.abs(g2)).toBeLessThan(1e-6);
    // Y los de prontuario: M0·d·(2c − d)/L² y M0·c·(2d − c)/L² (en valor absoluto)
    expect(Math.abs(r[0])).toBeCloseTo(Math.abs((M0 * d * (2 * c - d)) / (L * L)), 9);
    expect(Math.abs(r[1])).toBeCloseTo(Math.abs((M0 * c * (2 * d - c)) / (L * L)), 9);
  });

  it("sin luz o sin ley, null", () => {
    expect(momentosEmpotramiento([], 0, 5, 0, 0)).toBeNull();
    expect(momentosEmpotramiento(trozos(() => 1, 0, 0, 1), 0, 0, 0, 0)).toBeNull();
  });
});
