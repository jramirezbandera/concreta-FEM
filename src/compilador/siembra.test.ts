/**
 * A2-52 (`docs/fem3d/auditoria-2.md` §10.2): la siembra graduada de un lado que arranca junto a un
 * rasgo diminuto. La integral de 1/g por 64 trapecios fijos vale L/(2·64·sa) en el primero: con dos
 * puntos a micras (una planta girada con las coordenadas al milímetro), un lado de un metro recibía
 * miles de puntos y la compilación no acababa. Ahora, si los trapecios se disparan, la integral exacta.
 */
import { describe, expect, it } from "vitest";
import { siembraGraduada } from "./mallado.ts";

/** El número de pasos exacto: ∫ dx / mín(s, sa + 2x, sb + 2(L − x)), integrado finamente. */
function exacto(L: number, sa: number, sb: number, s: number): number {
  const N = 2_000_000;
  let r = 0;
  for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) * L) / N;
    r += L / N / Math.min(s, sa + 2 * x, sb + 2 * (L - x));
  }
  return r;
}

describe("la siembra graduada junto a un rasgo diminuto (A2-52)", () => {
  it("con un extremo a 1 µm de otro punto, un lado de 1 m tiene los puntos de la integral exacta, no miles", () => {
    for (const sa of [1e-6, 1e-5, 1e-4]) {
      const { n, t } = siembraGraduada(1, sa, 0.75, 1.5);
      expect(n, `sa = ${sa}`).toBe(Math.ceil(exacto(1, sa, 0.75, 1.5) - 1e-4));
      expect(n).toBeLessThan(20);
      expect(t.length).toBe(n - 1);
      // Crecientes, dentro del lado y más juntos junto al rasgo
      for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
      expect(t[0]!).toBeGreaterThan(0);
      expect(t.at(-1)!).toBeLessThan(1);
      expect(t[0]!).toBeLessThan(1 - t.at(-1)!);
    }
  });

  it("con rasgos normales, la siembra de siempre (la de los trapecios)", () => {
    // Las mallas de las referencias congeladas salen con los mismos bits; aquí, que no salta a la exacta
    for (const [L, sa, sb] of [
      [6, 0.05, 0.05],
      [10, 0.3, 0.75],
      [0.5, 0.01, 0.2],
    ] as const) {
      const { n } = siembraGraduada(L, sa, sb, 1.5);
      expect(n).toBeGreaterThanOrEqual(Math.ceil(exacto(L, sa, sb, 1.5) - 1e-4));
      expect(n).toBeLessThan(4 * exacto(L, sa, sb, 1.5) + 9);
    }
  });
});
