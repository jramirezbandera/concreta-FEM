// Tests del helper PURO de amplificacion inicial de la deformada (D6). Sin React/R3F
// (corre en el project node: src/**/*.test.ts). Cubre: estructura rigida (flecha ~0 ->
// ×1), flecha grande respecto del bbox (×1), flecha diminuta (escala alta acotada a 500),
// caso intermedio (escala redondeada dentro de rango) y bordes (sin modelo/combo).
import { describe, it, expect } from "vitest";
import { calcularEscalaInicial, ESCALA_MAX } from "./deformadaEscala";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

// Modelo de UNA barra horizontal de 10 m (bbox lado mayor = 10 m). Nudos FEM: N1..N2.
function modeloBarra10(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 10, y: 0, z: 0 },
    ],
    materials: [],
    sections: [],
    members: [
      {
        name: "M1",
        i: "N1",
        j: "N2",
        material: "m",
        section: "s",
        rotation: 0,
        tension_only: false,
        comp_only: false,
        releases: null,
      },
    ],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

// Resultados con un desplazamiento vertical `dyMax` (m) en N2 (N1 fijo). El helper usa el
// desplazamiento maximo de la deformada de la combinacion.
function resultadosConFlecha(dyMax: number): ResultadosCalculo {
  const cero = [0, 0, 0, 0, 0, 0];
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {
      N1: { ELU: { disp: cero, rxn: cero } },
      N2: { ELU: { disp: [0, dyMax, 0, 0, 0, 0], rxn: cero } },
    },
    barras: {},
    check_statics: null,
  };
}

describe("calcularEscalaInicial (D6)", () => {
  it("estructura rigida (flecha ~0) -> ×1 (no hay nada que amplificar)", () => {
    const escala = calcularEscalaInicial(
      modeloBarra10(),
      resultadosConFlecha(0),
      "ELU",
    );
    expect(escala).toBe(1);
  });

  it("flecha ya grande respecto del bbox -> ×1 (amplificar la empeoraria)", () => {
    // Flecha 5 m sobre un bbox de 10 m: objetivo 5% * 10 = 0.5 m; escala = 0.5/5 = 0.1 -> ×1.
    const escala = calcularEscalaInicial(
      modeloBarra10(),
      resultadosConFlecha(-5),
      "ELU",
    );
    expect(escala).toBe(1);
  });

  it("flecha diminuta -> escala alta ACOTADA a 500", () => {
    // Flecha 1e-6 m: objetivo 0.5 m -> escala = 500000, se acota a ESCALA_MAX=500.
    const escala = calcularEscalaInicial(
      modeloBarra10(),
      resultadosConFlecha(-1e-6),
      "ELU",
    );
    expect(escala).toBe(ESCALA_MAX);
  });

  it("caso intermedio -> factor redondeado dentro de [1,500]", () => {
    // bbox 10 m -> objetivo 0.5 m. Flecha 0.01 m (280 mm en vano de 5 m es el orden real):
    // escala = 0.5 / 0.01 = 50.
    const escala = calcularEscalaInicial(
      modeloBarra10(),
      resultadosConFlecha(-0.01),
      "ELU",
    );
    expect(escala).toBe(50);
  });

  it("bordes: sin modelo/resultados/combo -> ×1", () => {
    expect(calcularEscalaInicial(null, resultadosConFlecha(-0.01), "ELU")).toBe(1);
    expect(calcularEscalaInicial(modeloBarra10(), null, "ELU")).toBe(1);
    expect(calcularEscalaInicial(modeloBarra10(), resultadosConFlecha(-0.01), null)).toBe(
      1,
    );
  });
});
