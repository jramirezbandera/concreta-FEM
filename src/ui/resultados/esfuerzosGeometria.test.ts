// Tests del modulo PURO esfuerzosGeometria (overlay de esfuerzos N/V/M en escena).
// Corre en el project node (sin React/R3F). Cubre: partirEnTramosDeSigno (cortes
// interpolados, ceros interiores exactos, planos), proyeccion de bases a escena
// (FEM Y-up -> escena Z-up), eje de la ordenada por orientacion, vMaxAbs global,
// members planos/sin resultados y entradas nulas.
import { describe, it, expect } from "vitest";
import {
  esfuerzosGeometria,
  partirEnTramosDeSigno,
} from "./esfuerzosGeometria";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import type { EstadoMiembroCombo } from "../../solver";

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

// Portico minimo FEM (Y-up): viga N1(0,3,0)->N2(4,3,0) en +X y pilar N3(0,0,0)->N1
// vertical ascendente. bbox lado mayor = 4 m.
function modeloPortico(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 3, z: 0 },
      { name: "N2", x: 4, y: 3, z: 0 },
      { name: "N3", x: 0, y: 0, z: 0 },
    ],
    materials: [],
    sections: [],
    members: [miembro("M1", "N1", "N2"), miembro("M2", "N3", "N1")],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

// EstadoMiembroCombo completo con el diagrama que interese; el resto, planos del
// mismo numero de estaciones (el contrato exige todos los campos).
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

// --- partirEnTramosDeSigno -------------------------------------------------------

describe("partirEnTramosDeSigno", () => {
  it("sin cambio de signo -> un unico tramo con su signo", () => {
    const tramos = partirEnTramosDeSigno([0, 1, 2], [3, 5, 2]);
    expect(tramos).toEqual([{ xs: [0, 1, 2], vs: [3, 5, 2], signo: 1 }]);
  });

  it("cruce por cero -> inserta el punto de corte interpolado EXACTO (compartido)", () => {
    // [10, -10] entre x=0 y x=4: corte en x=2 (interpolacion lineal), v=0.
    const tramos = partirEnTramosDeSigno([0, 4], [10, -10]);
    expect(tramos).toEqual([
      { xs: [0, 2], vs: [10, 0], signo: 1 },
      { xs: [2, 4], vs: [0, -10], signo: -1 },
    ]);
  });

  it("corte asimetrico: la posicion pondera por |v| a cada lado", () => {
    // [30, -10] entre x=0 y x=4: corte a 3/4 del tramo -> x=3.
    const tramos = partirEnTramosDeSigno([0, 4], [30, -10]);
    expect(tramos[0]!.xs[1]).toBeCloseTo(3, 12);
  });

  it("cero interior EXACTO actua de frontera sin insertar punto nuevo", () => {
    const tramos = partirEnTramosDeSigno([0, 1, 2], [5, 0, -5]);
    expect(tramos).toEqual([
      { xs: [0, 1], vs: [5, 0], signo: 1 },
      { xs: [1, 2], vs: [0, -5], signo: -1 },
    ]);
  });

  it("ceros iniciales: el tramo adopta el primer signo no nulo", () => {
    const tramos = partirEnTramosDeSigno([0, 1, 2], [0, 0, 7]);
    expect(tramos).toEqual([{ xs: [0, 1, 2], vs: [0, 0, 7], signo: 1 }]);
  });

  it("diagrama plano (todo 0) -> sin tramos", () => {
    expect(partirEnTramosDeSigno([0, 1, 2], [0, 0, 0])).toEqual([]);
  });

  it("doble cruce (+/-/+) -> tres tramos que comparten cortes", () => {
    const tramos = partirEnTramosDeSigno([0, 2, 4], [4, -4, 4]);
    expect(tramos).toHaveLength(3);
    expect(tramos.map((t) => t.signo)).toEqual([1, -1, 1]);
    // Cortes en x=1 y x=3; compartidos entre tramos contiguos.
    expect(tramos[0]!.xs).toEqual([0, 1]);
    expect(tramos[1]!.xs).toEqual([1, 2, 3]);
    expect(tramos[2]!.xs).toEqual([3, 4]);
  });
});

// --- esfuerzosGeometria ----------------------------------------------------------

describe("esfuerzosGeometria", () => {
  it("viga +X, momento de vano: signo presentado VANO + y ordenada hacia ABAJO [0,0,-1]", () => {
    const r = resultados({
      // Crudo PyNite: vano NEGATIVO (golden combinaciones). Presentado: vano +.
      M1: { ELU: estado([0, 2, 4], { moment_z: [[0, 2, 4], [0, -8, 0]] }) },
    });
    const geo = esfuerzosGeometria(modeloPortico(), r, "ELU", "momento");
    expect(geo.diagramas).toHaveLength(1);
    const d = geo.diagramas[0]!;
    expect(d.member).toBe("M1");
    // ejeY FEM [0,1,0] × LADO_DIBUJO(momento)=-1 -> escena [0,0,-1]: el vano
    // POSITIVO se dibuja hacia abajo (lado de las tracciones).
    expect(d.ejeY).toEqual([0, 0, -1]);
    expect(d.tramos).toHaveLength(1);
    expect(d.tramos[0]!.signo).toBe(1); // vano + (convenio de presentacion)
    expect(d.tramos[0]!.valores).toEqual([0, 8, 0]); // crudo [0,-8,0] volteado
    expect(d.tramos[0]!.bases).toEqual([
      [0, 0, 3],
      [2, 0, 3],
      [4, 0, 3],
    ]);
    expect(geo.vMaxAbs).toBe(8);
  });

  it("pilar comprimido: axil presentado NEGATIVO (traccion +) y ordenada en [-1,0,0]", () => {
    const r = resultados({
      // Crudo PyNite: compresion POSITIVA (verificado motor real). Presentado: -12.
      M2: { ELU: estado([0, 1.5, 3], { axial: [[0, 1.5, 3], [12, 12, 12]] }) },
    });
    const geo = esfuerzosGeometria(modeloPortico(), r, "ELU", "axil");
    expect(geo.diagramas).toHaveLength(1);
    const d = geo.diagramas[0]!;
    // ejeY FEM [-1,0,0] (LADO_DIBUJO(axil)=+1; el intercambio Y<->Z no toca X).
    expect(d.ejeY).toEqual([-1, 0, 0]);
    expect(d.tramos[0]!.signo).toBe(-1); // compresion = negativa presentada
    expect(d.tramos[0]!.valores).toEqual([-12, -12, -12]);
    // Bases: pilar de (0,0,0) a (0,3,0) FEM -> escena (0,0,cota).
    expect(d.tramos[0]!.bases).toEqual([
      [0, 0, 0],
      [0, 0, 1.5],
      [0, 0, 3],
    ]);
    expect(geo.vMaxAbs).toBe(12);
  });

  it("vMaxAbs es GLOBAL sobre todas las barras; los diagramas planos no dibujan pero puntuan 0", () => {
    const r = resultados({
      M1: { ELU: estado([0, 2, 4], { shear_y: [[0, 2, 4], [6, 0, -6]] }) },
      M2: { ELU: estado([0, 1.5, 3], { shear_y: [[0, 1.5, 3], [0, 0, 0]] }) },
    });
    const geo = esfuerzosGeometria(modeloPortico(), r, "ELU", "cortante");
    // M2 es plano: no genera diagrama, pero no rompe nada.
    expect(geo.diagramas).toHaveLength(1);
    expect(geo.vMaxAbs).toBe(6);
  });

  it("member sin resultados para el combo se omite sin lanzar", () => {
    const r = resultados({
      M1: { ELU: estado([0, 2, 4], { moment_z: [[0, 2, 4], [1, 2, 1]] }) },
      // M2 ausente por completo.
    });
    const geo = esfuerzosGeometria(modeloPortico(), r, "ELU", "momento");
    expect(geo.diagramas).toHaveLength(1);
  });

  it("entradas nulas -> geometria vacia (nunca lanza)", () => {
    expect(esfuerzosGeometria(null, null, null, "momento")).toEqual({
      diagramas: [],
      vMaxAbs: 0,
    });
    expect(esfuerzosGeometria(modeloPortico(), null, "ELU", "axil")).toEqual({
      diagramas: [],
      vMaxAbs: 0,
    });
  });
});
