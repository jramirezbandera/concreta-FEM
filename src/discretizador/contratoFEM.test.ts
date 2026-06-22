import { describe, it, expect } from "vitest";
import { ModeloFEMSchema, type ModeloFEM } from "./contratoFEM";

// Capa 2 bien formada: portico minimo de F1 (1 barra biapoyada con carga
// distribuida vertical global hacia abajo + apoyo + combo CTE).
function modeloFEMValido(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 5, y: 0, z: 0 },
    ],
    materials: [{ name: "HA-25", E: 27264000, G: 11360000, nu: 0.2, rho: 25 }],
    sections: [{ name: "30x50", A: 0.15, Iy: 0.0011, Iz: 0.0003125, J: 0.0008 }],
    members: [
      {
        name: "M1",
        i: "N1",
        j: "N2",
        material: "HA-25",
        section: "30x50",
        rotation: 0,
        tension_only: false,
        comp_only: false,
        releases: null,
      },
    ],
    supports: [
      { node: "N1", DX: true, DY: true, DZ: true, RX: false, RY: false, RZ: false },
      { node: "N2", DX: false, DY: true, DZ: true, RX: false, RY: false, RZ: false },
    ],
    node_loads: [{ node: "N2", direction: "FX", P: 10, case: "V" }],
    // Gravedad: FY global negativo (hallazgo #3 + #18, Y vertical).
    dist_loads: [
      { member: "M1", direction: "FY", w1: -8, w2: -8, x1: null, x2: null, case: "G" },
    ],
    pt_loads: [{ member: "M1", direction: "FY", P: -5, x: 2.5, case: "Q" }],
    combos: [{ name: "ELU", factors: { G: 1.35, Q: 1.5 }, combo_tags: ["strength"] }],
    analysis: { type: "analyze", check_statics: true },
  };
}

describe("ModeloFEMSchema", () => {
  it("acepta una Capa 2 bien formada", () => {
    expect(() => ModeloFEMSchema.parse(modeloFEMValido())).not.toThrow();
  });

  it("acepta releases de longitud 12", () => {
    const m = modeloFEMValido();
    m.members[0].releases = [
      false, false, false, false, false, false,
      false, false, false, false, true, true,
    ];
    expect(() => ModeloFEMSchema.parse(m)).not.toThrow();
  });

  it("rechaza releases de longitud distinta de 12", () => {
    const m = modeloFEMValido();
    // Array de 11 booleanos: valido para TS (boolean[]) pero rechazado por Zod (.length(12)).
    m.members[0].releases = new Array(11).fill(false) as boolean[];
    expect(() => ModeloFEMSchema.parse(m)).toThrow();
  });

  it("rechaza una direction de node_load invalida (solo global)", () => {
    const m = modeloFEMValido();
    // @ts-expect-error: minuscula (local) no permitida en node_loads
    m.node_loads[0].direction = "Fx";
    expect(() => ModeloFEMSchema.parse(m)).toThrow();
  });

  it("rechaza momentos distribuidos (dist_loads solo fuerzas)", () => {
    const m = modeloFEMValido();
    // @ts-expect-error: add_member_dist_load no admite momentos
    m.dist_loads[0].direction = "MY";
    expect(() => ModeloFEMSchema.parse(m)).toThrow();
  });

  it("rechaza units distinto de kN-m", () => {
    const m = modeloFEMValido();
    // @ts-expect-error: unidad invalida
    m.units = "kip-in";
    expect(() => ModeloFEMSchema.parse(m)).toThrow();
  });

  it("rechaza un modelo al que le falta un campo obligatorio", () => {
    const m = modeloFEMValido() as Partial<ModeloFEM>;
    delete m.members;
    expect(() => ModeloFEMSchema.parse(m)).toThrow();
  });
});
