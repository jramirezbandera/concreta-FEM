/** El paso de la rejilla de las vistas planas (`vistas/fondo.ts`). */
import { describe, expect, it } from "vitest";
import { pasoRejilla, redondo } from "../vistas/fondo.ts";

describe("rejilla", () => {
  it("redondea a 1, 2 o 5 × 10ⁿ por arriba", () => {
    expect([0.3, 0.5, 0.51, 1, 1.2, 3, 7, 12, 0.012].map(redondo)).toEqual([0.5, 0.5, 1, 1, 2, 5, 10, 20, 0.02]);
  });

  it("las mayores caen en 5 y 10 × 10ⁿ y las menores aparecen al acercar", () => {
    for (const s of [0.5, 3, 20, 30, 80, 400, 3000]) {
      const { menor, mayor, alfaMenor } = pasoRejilla(s);
      expect(menor * s).toBeGreaterThanOrEqual(18 * (1 - 1e-9));
      const mantisa = Math.round(mayor / Math.pow(10, Math.floor(Math.log10(mayor) + 1e-9)));
      expect([1, 5]).toContain(mantisa);
      expect(alfaMenor).toBeGreaterThanOrEqual(0);
      expect(alfaMenor).toBeLessThanOrEqual(1);
    }
    // 30 px/m (una planta de 30 m): menores de 1 m, mayores de 5 m
    expect(pasoRejilla(30)).toMatchObject({ menor: 1, mayor: 5 });
    // 100 px/m: menores de 0,2 m, mayores de 1 m
    expect(pasoRejilla(100)).toMatchObject({ menor: 0.2, mayor: 1 });
  });
});
