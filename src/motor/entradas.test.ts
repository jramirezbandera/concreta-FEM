/**
 * Criterio 4 de E6: entradas no válidas (src/pruebas/invalidos.ts) sobre modelos aleatorios válidos.
 * `calcular` nunca lanza: o el resultado no es válido y trae el error esperado, o el dato era
 * inocuo y el resultado es válido, finito y en equilibrio. La tabla completa (40 modelos por
 * entrada) está en validacion/e6/out_entradas.txt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { modeloAleatorio } from "../pruebas/aleatorio.ts";
import { ENTRADAS_NO_VALIDAS, estropear } from "../pruebas/invalidos.ts";
import { calcular, TOL_EQUILIBRIO } from "./calcular.ts";
import type { ResultadoCalculo } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 4 de E6: entradas no válidas", () => {
  it.each(ENTRADAS_NO_VALIDAS.map((e) => [e.id, e] as const))("%s", (_, e) => {
    let aplicadas = 0;
    for (let s = 1; s <= 12; s++) {
      const m = estropear(modeloAleatorio(s).modelo, e, s);
      if (!m) continue;
      aplicadas++;
      let r: ResultadoCalculo | undefined;
      expect(() => (r = calcular(m)), `semilla ${s}`).not.toThrow();
      const errores = r!.diagnosticos.filter((d) => d.severidad === "error");
      for (const d of r!.diagnosticos) expect(d.codigo, `semilla ${s}`).toMatch(/^[a-z]+\/[a-z-]+$/);
      if (e.codigos.length) {
        expect(r!.valido, `semilla ${s}: tenía que fallar`).toBe(false);
        expect(
          errores.some((d) => e.codigos.includes(d.codigo)),
          `semilla ${s}: ${errores.map((d) => d.codigo).join(", ")} en vez de ${e.codigos.join(" o ")}`,
        ).toBe(true);
      } else if (r!.valido) {
        for (const c of r!.casos) {
          expect([...c.u, ...c.reacciones, ...c.esfuerzosBarras, ...c.esfuerzosLaminas].every(Number.isFinite)).toBe(true);
          expect(Math.max(c.equilibrio.fuerzas, c.equilibrio.momentos)).toBeLessThanOrEqual(TOL_EQUILIBRIO);
        }
      } else expect(errores.length, `semilla ${s}`).toBeGreaterThan(0);
    }
    expect(aplicadas, "la entrada no se pudo aplicar a ningún modelo").toBeGreaterThan(0);
  });
});
