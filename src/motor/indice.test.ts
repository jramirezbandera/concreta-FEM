/**
 * Índice espacial de cajas (C5, criterio 8): devuelve exactamente lo que devuelve recorrer todas las
 * cajas (más las grandes, que van siempre), ordenado, con objetos sin caja (muelles) que no entran.
 */
import { describe, expect, it } from "vitest";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { IndiceCajas, MAX_CELDAS } from "./indice.ts";

describe("índice espacial de cajas", () => {
  it("al azar: lo mismo que la búsqueda exhaustiva, ordenado", () => {
    const r = azar(20261008);
    const n = 600;
    const cajas = new Float64Array(6 * n);
    for (let i = 0; i < n; i++) {
      if (i % 37 === 0) {
        cajas.fill(NaN, 6 * i, 6 * i + 6); // sin caja (un muelle)
        continue;
      }
      const grande = i % 53 === 0;
      for (let c = 0; c < 3; c++) {
        const a = -20 + 40 * r();
        const d = grande ? 30 + 10 * r() : 2 * r();
        cajas[6 * i + c] = a;
        cajas[6 * i + 3 + c] = a + d;
      }
    }
    const ind = new IndiceCajas(cajas, 0.5);
    for (let q = 0; q < 200; q++) {
      const min = [0, 1, 2].map(() => -25 + 50 * r());
      const max = min.map((m) => m + (q % 10 === 0 ? 0 : 5 * r()));
      const hallados = ind.buscar(min, max);
      const corta = (i: number) => [0, 1, 2].every((c) => cajas[6 * i + c]! <= max[c]! && cajas[6 * i + 3 + c]! >= min[c]!);
      const todos = Array.from({ length: n }, (_, i) => i).filter((i) => i % 37 !== 0 && corta(i));
      // Las grandes (más de MAX_CELDAS celdas) se devuelven siempre: sobran, pero no faltan
      expect(todos.every((i) => hallados.includes(i))).toBe(true);
      expect(hallados.filter((i) => !todos.includes(i)).every((i) => i % 53 === 0)).toBe(true);
      expect(hallados).toEqual([...hallados].sort((a, b) => a - b));
      expect(new Set(hallados).size).toBe(hallados.length);
    }
    expect(MAX_CELDAS).toBeGreaterThan(0);
  });

  it("una caja fuera de todo sólo devuelve las grandes; sin objetos con caja, nada", () => {
    const cajas = Float64Array.from([0, 0, 0, 1, 1, 1, NaN, NaN, NaN, NaN, NaN, NaN]);
    const ind = new IndiceCajas(cajas, 0.25);
    expect(ind.buscar([5, 5, 5], [6, 6, 6])).toEqual([]);
    expect(ind.buscar([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toEqual([0]);
    expect(new IndiceCajas(Float64Array.from([NaN, NaN, NaN, NaN, NaN, NaN]), 1).buscar([0, 0, 0], [1, 1, 1])).toEqual([]);
  });
});
