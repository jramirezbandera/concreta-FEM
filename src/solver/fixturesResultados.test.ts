// =============================================================================
// fixturesResultados.test.ts - humo del constructor consciente del modelo (D7).
//
// Verifica lo que importa al mock E2E: que `construirResultadosDesdeModeloFEM`
//  (a) produce un payload que PASA ResultadosCalculoSchema (forma valida en el
//      borde, lo mismo que safeParse de solverClient exige), y
//  (b) usa los NOMBRES REALES de members/supports/combos del ModeloFEM, para que
//      PanelDiagramas/TablaReacciones resuelvan de verdad (no "sin barra"/vacio).
// Sin Pyodide ni worker: corre en el proyecto `node` de Vitest.
// =============================================================================

import { describe, it, expect } from "vitest";

import { construirResultadosDesdeModeloFEM } from "./fixturesResultados";
import { ResultadosCalculoSchema } from "./resultados";
import type { ModeloFEM } from "../discretizador/contratoFEM";

// ModeloFEM minimo: un pilar (member "M1") entre dos nodos, apoyo en el pie ("N1"),
// una combinacion "ELU". Suficiente para ejercitar barras + nodos + combos reales.
function modeloMinimo(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 0, y: 3, z: 0 },
    ],
    materials: [{ name: "MAT1", E: 30e6, G: 12.5e6, nu: 0.2, rho: 25 }],
    sections: [{ name: "SEC1", A: 0.09, Iy: 6.75e-4, Iz: 6.75e-4, J: 1.14e-3 }],
    members: [
      {
        name: "M1",
        i: "N1",
        j: "N2",
        material: "MAT1",
        section: "SEC1",
        rotation: 0,
        tension_only: false,
        comp_only: false,
        releases: null,
      },
    ],
    supports: [
      { node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true },
    ],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: { D: 1.35, Q: 1.5 } }],
    analysis: { type: "linear", check_statics: false },
  };
}

describe("construirResultadosDesdeModeloFEM (D7)", () => {
  it("produce un payload que PASA ResultadosCalculoSchema", () => {
    const r = construirResultadosDesdeModeloFEM(modeloMinimo());
    const parseado = ResultadosCalculoSchema.safeParse(r);
    expect(parseado.success).toBe(true);
  });

  it("usa los nombres reales de combos, members y supports", () => {
    const r = construirResultadosDesdeModeloFEM(modeloMinimo());
    // combos reales del modelo (no inventados).
    expect(r.combos).toEqual(["ELU"]);
    // barra por nombre real del member -> PanelDiagramas la resuelve via trazabilidad.
    expect(r.barras["M1"]).toBeDefined();
    expect(r.barras["M1"]?.["ELU"]).toBeDefined();
    // nodo por nombre real del apoyo -> TablaReacciones lo lee.
    expect(r.nodos["N1"]).toBeDefined();
    expect(r.nodos["N1"]?.["ELU"]).toBeDefined();
  });

  it("da una reaccion vertical no trivial con signo correcto (equilibrio plausible)", () => {
    const r = construirResultadosDesdeModeloFEM(modeloMinimo());
    const rxn = r.nodos["N1"]?.["ELU"]?.rxn;
    expect(rxn).toBeDefined();
    // rxn = [FX, FY, FZ, MX, MY, MZ]; FY (indice 1) positiva y no trivial: el apoyo
    // empuja hacia arriba contra la carga gravitatoria (signo y magnitud asertables).
    expect(rxn?.[1]).toBeGreaterThan(0);
  });

  it("los diagramas tienen forma (2,n) y la deformada (3,n) con extremos continuos", () => {
    const r = construirResultadosDesdeModeloFEM(modeloMinimo());
    const barra = r.barras["M1"]?.["ELU"];
    expect(barra).toBeDefined();
    if (!barra) return;
    // (2, n): dos filas de igual longitud (posiciones, valores).
    expect(barra.moment_z).toHaveLength(2);
    expect(barra.moment_z[0]).toHaveLength(barra.moment_z[1].length);
    // continuidad: el flector enlatado vale 0 en ambos extremos del vano.
    // (toBeCloseTo en vez de toBe: 4·t·(1-t) en los extremos puede dar -0, que
    // Object.is distingue de 0; aqui solo importa que el valor sea nulo.)
    const vs = barra.moment_z[1];
    expect(vs[0]).toBeCloseTo(0);
    expect(vs[vs.length - 1]).toBeCloseTo(0);
    // deformada (3, n): tres filas de igual longitud.
    expect(barra.deformada_global).toHaveLength(3);
    const [dx, dy, dz] = barra.deformada_global;
    expect(dx).toHaveLength(dy.length);
    expect(dy).toHaveLength(dz.length);
  });
});
