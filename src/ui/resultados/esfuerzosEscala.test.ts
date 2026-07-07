// Tests del helper PURO escalaBaseEsfuerzos. Corre en el project node. Cubre el caso
// nominal (7% del lado mayor del bbox / vMaxAbs) y los bordes (sin modelo, bbox
// degenerado, vMaxAbs 0/negativo/no finito -> 0, "no dibujar ordenadas").
import { describe, it, expect } from "vitest";
import { escalaBaseEsfuerzos } from "./esfuerzosEscala";
import type { ModeloFEM } from "../../discretizador";

function modeloConNodos(nodes: Array<{ name: string; x: number; y: number; z: number }>): ModeloFEM {
  return {
    units: "kN-m",
    nodes,
    materials: [],
    sections: [],
    members: [],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

describe("escalaBaseEsfuerzos", () => {
  it("nominal: ordenada maxima = 7% del lado mayor del bbox", () => {
    // bbox lado mayor = 10 m; vMaxAbs = 50 kN·m -> escala = 0.7/50 = 0.014 m por kN·m.
    const modelo = modeloConNodos([
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 10, y: 3, z: 4 },
    ]);
    expect(escalaBaseEsfuerzos(modelo, 50)).toBeCloseTo(0.014, 12);
  });

  it("bordes: sin modelo / bbox degenerado / vMaxAbs invalido -> 0", () => {
    const puntual = modeloConNodos([{ name: "N1", x: 1, y: 1, z: 1 }]);
    const normal = modeloConNodos([
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 10, y: 0, z: 0 },
    ]);
    expect(escalaBaseEsfuerzos(null, 50)).toBe(0);
    expect(escalaBaseEsfuerzos(puntual, 50)).toBe(0); // bbox lado 0
    expect(escalaBaseEsfuerzos(normal, 0)).toBe(0);
    expect(escalaBaseEsfuerzos(normal, -5)).toBe(0);
    expect(escalaBaseEsfuerzos(normal, Number.NaN)).toBe(0);
    expect(escalaBaseEsfuerzos(normal, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
