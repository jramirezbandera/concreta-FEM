/**
 * Criterio 2 de E3 (solución cerrada): la flexión con multiplicadores converge a la solución de
 * Navier de una placa de Mindlin ortótropa (m11 ≠ m22, m12, v13 ≠ v23), con orden 2 en w y en los
 * momentos del centroide. La tabla completa sale de validacion/e3/navier.ts (out_navier.txt).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CASOS_NAVIER, erroresNavier } from "../../validacion/e3/navier.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 2 de E3: Navier (Mindlin) con flexión ortótropa", () => {
  for (const c of CASOS_NAVIER.slice(1)) {
    it(`${c.nombre}: orden 2 y errores pequeños con h = 0,125 m`, () => {
      const g = erroresNavier(c, 0.25);
      const f = erroresNavier(c, 0.125);
      expect(Math.abs(f.ew)).toBeLessThan(5e-4);
      expect(Math.abs(f.eMx)).toBeLessThan(2e-3);
      expect(Math.abs(f.eMy)).toBeLessThan(2e-3);
      expect(Math.abs(f.eMxy)).toBeLessThan(3e-3);
      expect(Math.abs(f.eQx)).toBeLessThan(0.02);
      for (const k of ["ew", "eMx", "eMy", "eQx"] as const) expect(Math.log2(Math.abs(g[k] / f[k])), k).toBeGreaterThan(1.8);
    });
  }
});
