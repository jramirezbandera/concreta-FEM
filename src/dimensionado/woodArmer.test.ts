/**
 * Wood–Armer (H34). Oráculos:
 * 1. la implementación de la investigación (wood_armer.py), congelada en __fixtures__;
 * 2. LUSAS CSN/LUSAS/1029 «Combinations and Wood-Armer Results», tablas 2 y 3;
 * 3. el criterio de Johansen: (mx* − mx)·(my* − my) ≥ mxy² con mx* ≥ mx⁺ y my* ≥ my⁺, y
 *    mx* + my* mínimo, comprobado por búsqueda densa.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envolventeWoodArmer, woodArmer } from "./woodArmer.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "wood-armer-python.json"), "utf8")) as {
  filas: number[][];
};

/** Pseudoaleatorio determinista (mulberry32). */
function aleatorio(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Wood–Armer frente a la implementación de la investigación", () => {
  it(`${fixture.filas.length} puntos que cubren todas las ramas: diferencia ≤ 1e-12`, () => {
    let peor = 0;
    for (const [mx, my, mxy, ix, iy, sx, sy] of fixture.filas) {
      const r = woodArmer(mx!, my!, mxy!);
      const ref = [ix!, iy!, sx!, sy!];
      [r.inferiorX, r.inferiorY, r.superiorX, r.superiorY].forEach((v, k) => {
        peor = Math.max(peor, Math.abs(v - ref[k]!) / (1 + Math.abs(ref[k]!)));
      });
    }
    expect(peor).toBeLessThan(1e-12);
  });
});

describe("Wood–Armer frente a LUSAS CSN/LUSAS/1029", () => {
  // LUSAS: positivo = tracción en la cara superior, al revés que el motor → mx = −Mx(LUSAS).
  const casos = [
    [-12.29, 13.52, 114.75], // carga puntual
    [-7.68, 8.45, 71.72], // carga repartida
    [-2.03, -7.71, -1.26], // peso propio
    [-0.85, 10.38, 19.32], // carga parcial
  ] as const;
  // LUSAS da Mx(T), My(T) positivos y Mx(B), My(B) negativos: [sup X, sup Y, −inf X, −inf Y]
  const lusas = (Mx: number, My: number, Mxy: number) => {
    const r = woodArmer(-Mx, -My, Mxy);
    return [r.superiorX, r.superiorY, -r.inferiorX, -r.inferiorY];
  };

  it("tabla 2: Wood–Armer de la combinación (suma de los momentos)", () => {
    const suma = casos.reduce((s, c) => s.map((v, k) => v + c[k]!), [0, 0, 0]);
    expect(suma.map((v) => Math.round(v * 100) / 100)).toEqual([-22.85, 24.64, 204.53]);
    const r = lusas(suma[0]!, suma[1]!, suma[2]!);
    [181.67, 229.16, -227.38, -179.89].forEach((v, k) => expect(Math.abs(r[k]! - v)).toBeLessThan(0.015));
  });

  it("tabla 3: suma de Wood–Armer caso a caso (lo que no se debe hacer) da más", () => {
    const suma = casos.map((c) => lusas(c[0], c[1], c[2])).reduce((s, r) => s.map((v, k) => v + r[k]!), [0, 0, 0, 0]);
    [184.96, 238.14, -229.91, -182.41].forEach((v, k) => expect(Math.abs(suma[k]! - v)).toBeLessThan(0.015));
  });
});

describe("Wood–Armer y el criterio de Johansen", () => {
  /** Óptimo de mx* + my* en la cara positiva por búsqueda densa (como wa_bruteforce.py). */
  function optimo(mx: number, my: number, mxy: number): number {
    if (mx <= 0 && my <= 0 && mx * my >= mxy * mxy) return 0;
    let mejor = Infinity;
    const a0 = Math.max(mx, 0);
    const probar = (A: number) => {
      if (A <= mx) return;
      const B = Math.max(my + (mxy * mxy) / (A - mx), Math.max(my, 0));
      mejor = Math.min(mejor, A + B);
    };
    for (let k = 1; k <= 200; k++) probar(a0 + k / 200);
    for (let k = 0; k < 4000; k++) probar(a0 + 1e-6 * Math.pow(2000 / 1e-6, k / 3999));
    if (mx < 0) mejor = Math.min(mejor, Math.max(my + (mxy * mxy) / -mx, Math.max(my, 0)));
    return mejor;
  }

  it("5 000 casos aleatorios: cumple el criterio en las dos caras y no supera el óptimo", () => {
    const r = aleatorio(7);
    const ramas = new Set<string>();
    for (let k = 0; k < 5000; k++) {
      const mx = 200 * r() - 100;
      const my = 200 * r() - 100;
      const mxy = 120 * r() - 60;
      const w = woodArmer(mx, my, mxy);
      for (const [x, y, sx, sy] of [
        [w.inferiorX, w.inferiorY, mx, my],
        [w.superiorX, w.superiorY, -mx, -my], // cara +z = cara positiva de −M
      ] as const) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        if (x === 0 && y === 0) {
          // sin armadura en la cara sólo si de verdad no hace falta
          expect(sx <= 0 && sy <= 0 && sx * sy >= mxy * mxy - 1e-9).toBe(true);
          ramas.add("sin armadura");
        } else {
          expect((x - sx) * (y - sy)).toBeGreaterThanOrEqual(mxy * mxy - 1e-9 * (1 + mxy * mxy));
          ramas.add(x === 0 ? "mx*=0" : y === 0 ? "my*=0" : "principal");
        }
        expect(x + y).toBeLessThanOrEqual(optimo(sx, sy, mxy) * (1 + 1e-9) + 1e-12);
      }
    }
    expect([...ramas].sort()).toEqual(["mx*=0", "my*=0", "principal", "sin armadura"]);
  });

  it("sólo depende de |Mxy| y cambiar el signo de los momentos intercambia las caras", () => {
    const a = woodArmer(30, -12, 25);
    expect(woodArmer(30, -12, -25)).toEqual(a);
    const b = woodArmer(-30, 12, 25);
    expect([b.inferiorX, b.inferiorY, b.superiorX, b.superiorY]).toEqual([a.superiorX, a.superiorY, a.inferiorX, a.inferiorY]);
  });
});

describe("envolvente por combinación", () => {
  it("máximo por cara y dirección con la combinación gobernante", () => {
    const combos = [
      [10, 5, 2],
      [40, -10, 15],
      [-30, -25, 5],
      [5, 35, 30],
    ];
    const e = envolventeWoodArmer(combos.flat());
    const todos = combos.map(([mx, my, mxy]) => woodArmer(mx!, my!, mxy!));
    for (const c of ["inferiorX", "inferiorY", "superiorX", "superiorY"] as const) {
      const vals = todos.map((t) => t[c]);
      const max = Math.max(...vals);
      expect(e.valores[c]).toBe(max);
      expect(e.combinacion[c]).toBe(max > 0 ? vals.indexOf(max) : -1);
    }
  });

  it("aplicado a la envolvente componente a componente queda del lado seguro, pero sobredimensiona (H34)", () => {
    const r = aleatorio(11);
    let exceso = 0;
    for (let p = 0; p < 300; p++) {
      const combos = Array.from({ length: 16 }, () => [200 * r() - 100, 200 * r() - 100, 120 * r() - 60]);
      const e = envolventeWoodArmer(combos.flat());
      const maxMx = Math.max(...combos.map((c) => c[0]!));
      const maxMy = Math.max(...combos.map((c) => c[1]!));
      const minMx = Math.min(...combos.map((c) => c[0]!));
      const minMy = Math.min(...combos.map((c) => c[1]!));
      const maxA = Math.max(...combos.map((c) => Math.abs(c[2]!)));
      const inf = woodArmer(maxMx, maxMy, maxA);
      const sup = woodArmer(minMx, minMy, maxA);
      expect(inf.inferiorX + 1e-12).toBeGreaterThanOrEqual(e.valores.inferiorX);
      expect(inf.inferiorY + 1e-12).toBeGreaterThanOrEqual(e.valores.inferiorY);
      expect(sup.superiorX + 1e-12).toBeGreaterThanOrEqual(e.valores.superiorX);
      expect(sup.superiorY + 1e-12).toBeGreaterThanOrEqual(e.valores.superiorY);
      exceso = Math.max(exceso, inf.inferiorX / Math.max(e.valores.inferiorX, 1e-9));
    }
    expect(exceso).toBeGreaterThan(1.05);
  });

  it("rechaza datos que no son ternas", () => {
    expect(() => envolventeWoodArmer([1, 2])).toThrow(/ternas/);
  });
});
