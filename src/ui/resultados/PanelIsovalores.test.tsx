// Componente (RTL, project jsdom) de PanelIsovalores (F3, T3.2): selector de magnitud
// (Flecha/Mx/My) + leyenda de rampa generica. Verifica: OCULTO sin resultados de placa
// (un portico sin losa), VISIBLE con quads, etiqueta de unidad por magnitud, y que elegir
// otra magnitud actualiza vistaStore.magnitudIsovalores.
//
// GOTCHA Radix en jsdom (memoria feature-11): el Segmentado es un ToggleGroup que depende
// de PointerCapture; se rellenan los stubs. Los items son role="radio".
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PanelIsovalores } from "./PanelIsovalores";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import { trazabilidadVacia } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Modelo FEM con UN quad (losa) y su traza.
function femConQuad(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "Q0", x: 0, y: 3, z: 0 },
      { name: "Q1", x: 1, y: 3, z: 0 },
      { name: "Q2", x: 1, y: 3, z: 1 },
      { name: "Q3", x: 0, y: 3, z: 1 },
    ],
    materials: [],
    sections: [],
    members: [],
    quads: [{ name: "PQ0", i: "Q0", j: "Q1", m: "Q2", n: "Q3", t: 0.2, material: "h" }],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    quad_loads: [],
    combos: [{ name: "ELS", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}
function femSinQuad(): ModeloFEM {
  const f = femConQuad();
  f.quads = [];
  return f;
}
function traza(): Trazabilidad {
  return {
    ...trazabilidadVacia(),
    quadANodos: { PQ0: ["Q0", "Q1", "Q2", "Q3"] },
    nodosDeMalla: ["Q0", "Q1", "Q2", "Q3"],
  };
}
const cero6 = [0, 0, 0, 0, 0, 0];
function resultadosConPlaca(): ResultadosCalculo {
  const nodos: ResultadosCalculo["nodos"] = {};
  const dy = [0, -0.01, -0.02, -0.01];
  ["Q0", "Q1", "Q2", "Q3"].forEach((n, k) => {
    nodos[n] = { ELS: { disp: [0, dy[k]!, 0, 0, 0, 0], rxn: cero6 } };
  });
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELS"],
    nodos,
    barras: {},
    quads: {
      PQ0: {
        ELS: {
          moments: [
            [10, 5, 0],
            [20, 8, 0],
            [20, 8, 0],
            [10, 5, 0],
          ],
          shears: [[0, 0], [0, 0], [0, 0], [0, 0]],
        },
      },
    },
    check_statics: null,
  };
}
function resultadosSinPlaca(): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELS"],
    nodos: {},
    barras: {},
    check_statics: null,
  };
}

beforeEach(() => {
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
  vistaStore.getState().setMagnitudIsovalores("flecha");
});

describe("PanelIsovalores", () => {
  it("oculto sin resultados de placa (un portico sin losa)", () => {
    resultadosStore.getState().setResultados(resultadosSinPlaca(), femSinQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    const { container } = render(<PanelIsovalores />);
    expect(container).toBeEmptyDOMElement();
  });

  it("visible con resultados de placa, con la unidad de la flecha (mm)", () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    render(<PanelIsovalores />);
    expect(screen.getByRole("radiogroup", { name: "Magnitud de isovalores" })).toBeInTheDocument();
    // Etiqueta de unidad de la flecha.
    expect(screen.getByText("flecha (mm)")).toBeInTheDocument();
  });

  it("elegir Mx actualiza vistaStore.magnitudIsovalores y la unidad pasa a kN·m/m", async () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    const user = userEvent.setup();
    render(<PanelIsovalores />);

    const grupo = screen.getByRole("radiogroup", { name: "Magnitud de isovalores" });
    await user.click(within(grupo).getByRole("radio", { name: "Mx" }));

    expect(vistaStore.getState().magnitudIsovalores).toBe("momentoX");
    expect(screen.getByText("momento Mx (kN·m/m)")).toBeInTheDocument();
  });
});
