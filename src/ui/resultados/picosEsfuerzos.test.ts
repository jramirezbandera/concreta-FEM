// Tests del modulo PURO picosEsfuerzos (rotulos max/min por ELEMENTO DE OBRA del
// overlay de esfuerzos). Corre en el project node. Cubre: viga de 2 tramos (agregado
// sobre la concatenacion, posicion en el member correcto), pilar con diagrama
// constante (dedupe a un rotulo), paño con viguetas (agregado del paño entero),
// umbral anti-ruido relativo y entradas nulas.
import { describe, it, expect } from "vitest";
import { picosEsfuerzos, fmtPico } from "./picosEsfuerzos";
import { trazabilidadVacia } from "../../discretizador";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { EstadoMiembroCombo, ResultadosCalculo } from "../../solver";

// --- Fixtures ------------------------------------------------------------------

function miembro(name: string, i: string, j: string, rotation = 0) {
  return {
    name,
    i,
    j,
    material: "m",
    section: "s",
    rotation,
    tension_only: false,
    comp_only: false,
    releases: null,
  };
}

// Obra minima FEM (Y-up): viga de DOS tramos (M1: N1->N2, M2: N2->N3, cota 3),
// pilar M3 (N4->N1, vertical) y una vigueta M4 (N5->N6, cota 3, rumbo +Z).
function modelo(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 3, z: 0 },
      { name: "N2", x: 4, y: 3, z: 0 },
      { name: "N3", x: 8, y: 3, z: 0 },
      { name: "N4", x: 0, y: 0, z: 0 },
      { name: "N5", x: 2, y: 3, z: 0 },
      { name: "N6", x: 2, y: 3, z: 5 },
    ],
    materials: [],
    sections: [],
    members: [
      miembro("M1", "N1", "N2"),
      miembro("M2", "N2", "N3"),
      miembro("M3", "N4", "N1"),
      miembro("M4", "N5", "N6"),
    ],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

function estado(
  xs: number[],
  parcial: Partial<Pick<EstadoMiembroCombo, "axial" | "shear_y" | "moment_z">>,
): EstadoMiembroCombo {
  const plano = [xs, xs.map(() => 0)];
  const n = xs.length;
  return {
    axial: parcial.axial ?? plano,
    shear_y: parcial.shear_y ?? plano,
    moment_z: parcial.moment_z ?? plano,
    defl_y: plano,
    deformada_global: [Array(n).fill(0), Array(n).fill(0), Array(n).fill(0)],
    max_moment_z: 0,
    min_moment_z: 0,
    max_shear_y: 0,
  };
}

function resultados(barras: ResultadosCalculo["barras"]): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 3 },
    combos: ["ELU"],
    nodos: {},
    barras,
    check_statics: null,
  };
}

function trazabilidad(): Trazabilidad {
  return {
    ...trazabilidadVacia(),
    vigaAMembers: { v1: ["M1", "M2"] },
    pilarAMembers: { p1: ["M3"] },
    panoAMembers: { pano1: ["M4"] },
  };
}

describe("fmtPico", () => {
  it("1 decimal + unidad por magnitud, sin conversion", () => {
    expect(fmtPico(-42.34, "momento")).toBe("-42.3 kN·m");
    expect(fmtPico(12.75, "cortante")).toBe("12.8 kN");
    expect(fmtPico(0, "axil")).toBe("0.0 kN");
  });
});

describe("picosEsfuerzos", () => {
  it("viga de 2 tramos: max/min agregados sobre la concatenacion, situados en su member", () => {
    const r = resultados({
      // Crudos PyNite; presentados con signo volteado (vano +): M1 [-5,10,-3], M2 [-3,-20,0].
      M1: { ELU: estado([0, 2, 4], { moment_z: [[0, 2, 4], [5, -10, 3]] }) },
      M2: { ELU: estado([0, 2, 4], { moment_z: [[0, 2, 4], [3, 20, 0]] }) },
    });
    const picos = picosEsfuerzos(modelo(), r, trazabilidad(), "ELU", "momento");
    const deViga = picos.filter((p) => p.elementoId === "v1");
    expect(deViga).toHaveLength(2);
    const max = deViga.find((p) => p.signo === 1)!;
    const min = deViga.find((p) => p.signo === -1)!;
    // max presentado = +10 en M1 x=2 (t=0.5 de N1->N2) -> escena [2,0,3].
    expect(max.texto).toBe("10.0 kN·m");
    expect(max.base).toEqual([2, 0, 3]);
    // min presentado = -20 en M2 x=2 (t=0.5 de N2(4,3,0)->N3(8,3,0)) -> escena [6,0,3].
    expect(min.texto).toBe("-20.0 kN·m");
    expect(min.base).toEqual([6, 0, 3]);
    // Ordenada del flector: ejeY FEM [0,1,0] × LADO_DIBUJO(momento)=-1 -> [0,0,-1]
    // (el vano positivo cae hacia abajo, lado de las tracciones).
    expect(max.ejeY).toEqual([0, 0, -1]);
  });

  it("pilar con axil CONSTANTE: un solo rotulo (max y min coinciden)", () => {
    const r = resultados({
      // Crudo PyNite: compresion POSITIVA -> presentado -30 (compresion negativa).
      M3: { ELU: estado([0, 1.5, 3], { axial: [[0, 1.5, 3], [30, 30, 30]] }) },
    });
    const picos = picosEsfuerzos(modelo(), r, trazabilidad(), "ELU", "axil");
    const dePilar = picos.filter((p) => p.elementoId === "p1");
    expect(dePilar).toHaveLength(1);
    expect(dePilar[0]!.texto).toBe("-30.0 kN");
    expect(dePilar[0]!.signo).toBe(-1);
    // Pilar ascendente: ejeY FEM [-1,0,0] (LADO_DIBUJO(axil)=+1); pico en x=0 (pie).
    expect(dePilar[0]!.ejeY).toEqual([-1, 0, 0]);
    expect(dePilar[0]!.base).toEqual([0, 0, 0]);
  });

  it("paño unidireccional: rotulos del PAÑO entero (agregado de sus viguetas)", () => {
    const r = resultados({
      // Crudo vano -15 -> presentado +15 en el centro.
      M4: { ELU: estado([0, 2.5, 5], { moment_z: [[0, 2.5, 5], [0, -15, 0]] }) },
    });
    const picos = picosEsfuerzos(modelo(), r, trazabilidad(), "ELU", "momento");
    const dePano = picos.filter((p) => p.elementoId === "pano1");
    // max presentado = +15 en el centro; min = 0 queda bajo el umbral -> 1 rotulo.
    expect(dePano).toHaveLength(1);
    expect(dePano[0]!.texto).toBe("15.0 kN·m");
    // Vigueta N5(2,3,0)->N6(2,3,5): centro FEM (2,3,2.5) -> escena [2,2.5,3].
    expect(dePano[0]!.base).toEqual([2, 2.5, 3]);
  });

  it("umbral anti-ruido: un elemento casi descargado no se rotula", () => {
    const r = resultados({
      // La viga domina (|v| max global = 100): umbral = 0.5.
      M1: { ELU: estado([0, 2, 4], { moment_z: [[0, 2, 4], [0, -100, 0]] }) },
      M2: { ELU: estado([0, 2, 4], { moment_z: [[0, 2, 4], [0, 0, 0]] }) },
      // El pilar tiene picos de 0.2 < 0.5: sin rotulos.
      M3: { ELU: estado([0, 1.5, 3], { moment_z: [[0, 1.5, 3], [0.2, -0.2, 0.1]] }) },
    });
    const picos = picosEsfuerzos(modelo(), r, trazabilidad(), "ELU", "momento");
    expect(picos.some((p) => p.elementoId === "p1")).toBe(false);
    // La viga si rotula su vano (+100 presentado); el otro extremo (0) queda bajo el umbral.
    expect(picos.filter((p) => p.elementoId === "v1")).toHaveLength(1);
  });

  it("entradas nulas o sin datos -> [] (nunca lanza)", () => {
    expect(picosEsfuerzos(null, null, null, null, "momento")).toEqual([]);
    expect(picosEsfuerzos(modelo(), resultados({}), trazabilidad(), "ELU", "momento")).toEqual(
      [],
    );
  });
});
