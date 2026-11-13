/**
 * A2-34 y A2-36 (`docs/fem3d/auditoria-2.md` §11.2, decisión del usuario): dos umbrales que decidía el
 * redondeo.
 * - A2-34: dos pilares apilados con los ejes a ε_snap justos (5 cm) se unen siempre. Antes, con x = 1,3 y
 *   1,35 (1,35 − 1,3 = 0,0500000000000003) no se unían y el de arriba daba `pilar/arranque-sin-apoyo`.
 * - A2-36: una barra con menos de 1e-6 m de desvío horizontal entre sus extremos es vertical (la regla de
 *   los pilares). Antes, con 1e-8 m sus ejes locales giraban hacia donde cayera el desvío.
 */
import { describe, expect, it } from "vitest";
import { DESVIO_VERTICAL_BARRA, ejesBarra } from "./barras.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

function apilados(x1: number, x2: number): ModeloFisico {
  return {
    plantas: [
      { id: "N2", altura: null },
      { id: "N1", altura: 3 },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: [
      { id: "P1", x: x1, y: 0, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P2", x: x2, y: 0, desde: "N1", hasta: "N2", seccion: "P30", base: "ninguno" },
    ],
    casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
  };
}

describe("A2-34: pilares apilados a ε_snap justos", () => {
  it("con los ejes a 5 cm (1,3 y 1,35, que en coma flotante dan un pelo más), se unen y compila", () => {
    expect(1.35 - 1.3).toBeGreaterThan(0.05);
    const r = compilar(apilados(1.3, 1.35));
    expect(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo)).toEqual([]);
    expect(r.valido).toBe(true);
  });

  it("a 5,1 cm no se unen (el margen es de 1e-9 relativo, no una tolerancia mayor)", () => {
    const r = compilar(apilados(1.3, 1.351));
    expect(r.diagnosticos.map((d) => d.codigo)).toContain("pilar/arranque-sin-apoyo");
  });
});

describe("A2-36: barra casi vertical", () => {
  const A: [number, number, number] = [2, 3, 0];
  it("con 1e-8 m de desvío, los ejes de la vertical (z = +X)", () => {
    for (const [dx, dy] of [[1e-8, 0], [0, 1e-8], [-7e-7, 7e-7]] as const) {
      const e = ejesBarra(A, [2 + dx, 3 + dy, 3], 0);
      const v = ejesBarra(A, [2, 3, 3], 0);
      for (let q = 0; q < 3; q++) {
        expect(e.ez[q]).toBeCloseTo(v.ez[q]!, 6);
        expect(e.ey[q]).toBeCloseTo(v.ey[q]!, 6);
      }
      // Ortonormales
      const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      expect(Math.abs(dot(e.ex, e.ez))).toBeLessThan(1e-15);
      expect(Math.abs(dot(e.ez, e.ez) - 1)).toBeLessThan(1e-15);
    }
  });

  it("vertical del todo, los mismos bits que antes; con más desvío que el umbral, z en el plano vertical", () => {
    expect(ejesBarra(A, [2, 3, 3], 0).ez).toEqual([1, 0, 0]);
    const e = ejesBarra(A, [2, 3 + 10 * DESVIO_VERTICAL_BARRA, 3], 0);
    expect(Math.abs(e.ez[0])).toBeLessThan(1e-12);
    expect(e.ez[2]).toBeGreaterThan(0);
  });
});
