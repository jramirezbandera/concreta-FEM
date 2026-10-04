/**
 * Criterio 3 de E6: la batería metamórfica (src/pruebas/metamorficas.ts) sobre modelos aleatorios
 * con todos los objetos del motor (src/pruebas/aleatorio.ts). Aquí, 150 semillas; la validación
 * (validacion/e6/aleatorios.ts) pasa 2 000 y mide qué fallos introducidos a propósito detecta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { modeloAleatorio } from "../pruebas/aleatorio.ts";
import { erroresMetamorficos, RELACIONES } from "../pruebas/metamorficas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 3 de E6: pruebas metamórficas sobre modelos aleatorios", () => {
  it("150 modelos: solvers, giro, renumeración, inversiones, superposición, Betti y unidades a ≤ 1e-9; determinismo exacto", () => {
    const peores = Object.fromEntries(RELACIONES.map((k) => [k, 0])) as Record<string, number>;
    for (let s = 1; s <= 150; s++) {
      const e = erroresMetamorficos(modeloAleatorio(s), s);
      for (const k of RELACIONES) {
        expect(e[k], `semilla ${s}, ${k}`).toBeLessThanOrEqual(k === "determinismo" ? 0 : 1e-9);
        peores[k] = Math.max(peores[k]!, e[k]);
      }
    }
    // con margen frente a la tolerancia: lo medido en 2 000 semillas queda en ≤ 3e-11
    for (const k of RELACIONES) expect(peores[k], k).toBeLessThan(1e-10);
  });

  it("el generador es reproducible y los modelos son válidos con los dos solvers", () => {
    expect(JSON.stringify(modeloAleatorio(42).modelo)).toBe(JSON.stringify(modeloAleatorio(42).modelo));
  });
});
