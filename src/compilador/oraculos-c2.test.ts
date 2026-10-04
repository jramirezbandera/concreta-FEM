/**
 * Criterios 1 y 2 de C2: oráculos.
 * 1. Placas de Navier de E3 descritas como modelo físico (losa con apoyos lineales): w en los nudos y
 *    M recuperado por SPR (lo que usan los mapas y las bandas) frente a la serie de Mindlin, como la
 *    rejilla de E3 y con orden ≈ 2. El valor bruto del centroide converge con orden 1 en los
 *    cuadriláteros de C2 (C2-1): no es dato para comprobar.
 * 2. La losa plana de H25 descrita como modelo físico (pilares, huellas y bandas) frente a la rejilla
 *    de E5: My y Vz de la banda de pilar y del pórtico en la cara (fuerzas nodales) y My en el vano
 *    (campos).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { erroresNavierC2, erroresNavierRejilla } from "../../validacion/c2/navier.ts";
import { losaPlanaC2 } from "../../validacion/c2/losaPlana.ts";
import { CASOS_NAVIER } from "../../validacion/e3/navier.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 1 de C2: placas de Navier como modelo físico", () => {
  for (const c of CASOS_NAVIER.slice(0, 2)) {
    it(c.nombre, () => {
      const [a, b] = [erroresNavierC2(c, 0.25), erroresNavierC2(c, 0.125)];
      const rej = erroresNavierRejilla(c, 0.25);
      // h = 0,25: w y M (SPR) del centro a ≤ 0,5 %, como la rejilla de E3
      expect(a.w).toBeLessThan(0.005);
      expect(Math.abs(a.sprMxCentro)).toBeLessThan(0.005);
      expect(Math.abs(a.sprMyCentro)).toBeLessThan(0.005);
      // M (SPR) en el peor nudo del interior, como la rejilla (con un 25 % de margen)
      expect(a.sprMxInterior).toBeLessThan(1.25 * rej.sprMxInterior);
      expect(a.sprMyInterior).toBeLessThan(1.25 * rej.sprMyInterior);
      // Orden ≈ 2 en w y en M (SPR)
      for (const k of ["w", "sprMxInterior", "sprMyInterior"] as const) expect(Math.log2(a[k] / b[k]), k).toBeGreaterThan(1.7);
      // C2-1: el valor bruto del centroide converge con orden ~1
      expect(Math.log2(a.Mx / b.Mx)).toBeLessThan(1.3);
    });
  }
});

describe("criterio 2 de C2: la losa plana de H25 frente a la rejilla de E5", () => {
  it("h = 0,15: cara (fuerzas nodales) y vano (campos) a ≤ 1 %", () => {
    // validacion/e5/out_bandas.txt, rejilla de E5 con h = 0,075 m
    const E5 = { cara: [-205.58, -262.71, -251.51, -263.21], vano: [76.98, 139.0] };
    const r = losaPlanaC2(0.15);
    const cara = [r.cara[0]![0]!, r.cara[0]![1]!, r.cara[1]![0]!, r.cara[1]![1]!];
    cara.forEach((v, i) => expect(Math.abs(v / E5.cara[i]! - 1), `cara ${i}`).toBeLessThan(0.01));
    r.vano.forEach((v, i) => expect(Math.abs(v / E5.vano[i]! - 1), `vano ${i}`).toBeLessThan(0.01));
  });
});
