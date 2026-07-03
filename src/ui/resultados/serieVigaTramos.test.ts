// Tests del helper PURO serieVigaTramos (F3.2): concatenacion de las series de los
// tramos de una viga subdividida por el acople paño<->portico. Sin React ni stores.
import { describe, it, expect } from "vitest";
import { serieVigaTramos } from "./serieVigaTramos";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo, EstadoMiembroCombo } from "../../solver";

function member(name: string, i: string, j: string): ModeloFEM["members"][number] {
  return {
    name, i, j, material: "m", section: "s", rotation: 0,
    tension_only: false, comp_only: false, releases: null,
  };
}

// Viga horizontal en dos tramos: M1 de (0,3,0) a (3,3,0) [L=3] y M2 de (3,3,0) a
// (8,3,0) [L=5]. Un tercer member DIAGONAL (M9) para el caso de longitud 3D.
function fem(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "NA", x: 0, y: 3, z: 0 },
      { name: "NB", x: 3, y: 3, z: 0 },
      { name: "NC", x: 8, y: 3, z: 0 },
      { name: "ND", x: 3, y: 7, z: 0 }, // NB->ND: dx=0, dy=4 -> L=4 (no horizontal)
    ],
    materials: [],
    sections: [],
    members: [member("M1", "NA", "NB"), member("M2", "NB", "NC"), member("M9", "NB", "ND")],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    analysis: { type: "linear", check_statics: false },
  };
}

function estado(L: number, valores: [number, number]): EstadoMiembroCombo {
  return {
    axial: [[0, L], [0, 0]],
    shear_y: [[0, L], valores],
    moment_z: [[0, L], valores],
    defl_y: [[0, L], [0, 0]],
    deformada_global: [[0, 0], [0, 0], [0, 0]],
    max_moment_z: Math.max(...valores),
    min_moment_z: Math.min(...valores),
    max_shear_y: Math.max(...valores),
  };
}

function resultados(barras: ResultadosCalculo["barras"]): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {},
    barras,
    check_statics: null,
  };
}

describe("serieVigaTramos", () => {
  it("un solo tramo: identidad (mismas posiciones y valores que su diagrama)", () => {
    const res = serieVigaTramos(
      ["M1"], resultados({ M1: { ELU: estado(3, [5, -5]) } }), fem(), "ELU", "moment_z",
    );
    expect(res).toEqual({ estado: "ok", posiciones: [0, 3], valores: [5, -5] });
  });

  it("dos tramos: offset x por longitud GEOMETRICA y salto conservado (punto duplicado)", () => {
    const res = serieVigaTramos(
      ["M1", "M2"],
      resultados({ M1: { ELU: estado(3, [7, 7]) }, M2: { ELU: estado(5, [-2, -2]) } }),
      fem(), "ELU", "shear_y",
    );
    // M1 aporta x=[0,3]; M2 se desplaza L(M1)=3 -> x=[3,8]. El x=3 se duplica: el
    // salto de cortante (7 -> -2) es el escalon fisico de la carga que entra ahi.
    expect(res).toEqual({
      estado: "ok",
      posiciones: [0, 3, 3, 8],
      valores: [7, 7, -2, -2],
    });
  });

  it("el offset usa la longitud 3D real del tramo (no solo la proyeccion)", () => {
    const res = serieVigaTramos(
      ["M9", "M2"],
      resultados({ M9: { ELU: estado(4, [1, 1]) }, M2: { ELU: estado(5, [2, 2]) } }),
      fem(), "ELU", "shear_y",
    );
    expect(res).toEqual({
      estado: "ok",
      posiciones: [0, 4, 4, 9], // L(M9)=hypot(0,4,0)=4
      valores: [1, 1, 2, 2],
    });
  });

  it("tramo sin resultados -> sin-barra", () => {
    const res = serieVigaTramos(
      ["M1", "M2"], resultados({ M1: { ELU: estado(3, [1, 1]) } }), fem(), "ELU", "moment_z",
    );
    expect(res).toEqual({ estado: "sin-barra" });
  });

  it("tramo sin la combinacion pedida -> sin-combo", () => {
    const res = serieVigaTramos(
      ["M1", "M2"],
      resultados({ M1: { ELU: estado(3, [1, 1]) }, M2: { ELS: estado(5, [1, 1]) } }),
      fem(), "ELU", "moment_z",
    );
    expect(res).toEqual({ estado: "sin-combo" });
  });

  it("member ausente del ModeloFEM (datos incoherentes) -> sin-barra, sin lanzar", () => {
    const res = serieVigaTramos(
      ["M1", "NO_EXISTE"],
      resultados({ M1: { ELU: estado(3, [1, 1]) }, NO_EXISTE: { ELU: estado(5, [1, 1]) } }),
      fem(), "ELU", "moment_z",
    );
    expect(res).toEqual({ estado: "sin-barra" });
  });

  it("lista vacia de members -> sin-barra", () => {
    expect(serieVigaTramos([], resultados({}), fem(), "ELU", "moment_z")).toEqual({
      estado: "sin-barra",
    });
  });
});
