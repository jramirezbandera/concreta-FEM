import { describe, it, expect } from "vitest";
import { mmToM, mToMm, mpaToInterno, internoToMpa } from "./conversion";

describe("conversion de unidades (bordes kN-m)", () => {
  it("mm <-> m usa el factor 1000", () => {
    expect(mmToM(1000)).toBe(1);
    expect(mToMm(1)).toBe(1000);
  });

  it("MPa <-> interno: 1 MPa = 1000 kN/m²", () => {
    expect(mpaToInterno(1)).toBe(1000);
    expect(internoToMpa(1000)).toBe(1);
    // Valor realista: acero E = 210000 MPa -> 2.1e8 kN/m²
    expect(mpaToInterno(210000)).toBe(210_000_000);
  });

  it("ida y vuelta es idempotente (round-trip)", () => {
    for (const v of [0, 1, 25, 350.5, 210000]) {
      expect(mToMm(mmToM(v))).toBeCloseTo(v, 10);
      expect(internoToMpa(mpaToInterno(v))).toBeCloseTo(v, 10);
    }
  });
});
