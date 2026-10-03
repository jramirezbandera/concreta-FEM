/**
 * Criterio 2 de E3 (benchmarks de H48): membrana con drilling y flexión acopladas en láminas
 * curvas facetadas, frente a sus referencias publicadas. Los valores de todas las mallas están en
 * validacion/e3/out_benchmarks.txt. Bandas: lo medido con 16×16 y 32×32, con margen pequeño.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cilindroPellizcado, hemisferio, scordelisLo, vigaMacNealHarder } from "../../validacion/e3/benchmarks.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 2 de E3: benchmarks de lámina (H48)", () => {
  it("Scordelis-Lo (0,3024): 16×16 y 32×32 a ±1 %", () => {
    for (const n of [16, 32]) expect(Math.abs(scordelisLo(n).valor - 1), `${n}`).toBeLessThan(0.01);
  });
  it("cilindro pellizcado con diafragmas (1,8248e-5): 16×16 y 32×32 en +1 %…+2,5 % (como Quad3D, H48)", () => {
    for (const n of [16, 32]) {
      const v = cilindroPellizcado(n);
      expect(v, `${n}`).toBeGreaterThan(1.01);
      expect(v, `${n}`).toBeLessThan(1.025);
    }
  });
  it("hemisferio pellizcado (0,0940): 16×16 y 32×32 a ±1 %", () => {
    for (const n of [16, 32]) expect(Math.abs(hemisferio(n) - 1), `${n}`).toBeLessThan(0.01);
  });
  it("viga recta de MacNeal–Harder fuera del plano (0,4321): las tres mallas a ±2 %", () => {
    for (const forma of ["rectangular", "trapezoidal", "paralelogramo"] as const) expect(Math.abs(vigaMacNealHarder(forma) - 1), forma).toBeLessThan(0.02);
  });
});
