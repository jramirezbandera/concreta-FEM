// Componente (RTL, project jsdom) de LeyendaIsovalores (F3, D10): la rampa de color de los
// isovalores, mudada del PanelIsovalores a glass junto al lienzo (vertical). Verifica: OCULTA
// sin resultados de placa, VISIBLE con quads con la unidad de la magnitud activa, la unidad
// cambia al cambiar magnitud (vistaStore), y la rampa se renderiza en orientacion VERTICAL.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeyendaIsovalores } from "./LeyendaIsovalores";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import { trazabilidadVacia } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

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

describe("LeyendaIsovalores (D10)", () => {
  it("sin resultados de placa no se muestra (un portico sin losa)", () => {
    resultadosStore.getState().setResultados(resultadosSinPlaca(), femSinQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    const { container } = render(<LeyendaIsovalores />);
    expect(container).toBeEmptyDOMElement();
  });

  it("con resultados de placa muestra la rampa VERTICAL con la unidad de la flecha (mm)", () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    const { container } = render(<LeyendaIsovalores />);
    // Rampa vertical (D10, Spec §4.2): la variante lleva la clase --vertical.
    expect(container.querySelector(".cx-leyenda-rampa--vertical")).not.toBeNull();
    // Unidad de la flecha (texto + "(mm)" en spans separados, UX-MM).
    expect(screen.getByText("flecha")).toBeInTheDocument();
    expect(screen.getByText("(mm)")).toBeInTheDocument();
  });

  it("al cambiar la magnitud a Mx la unidad pasa a kN·m/m", () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    vistaStore.getState().setMagnitudIsovalores("momentoX");
    render(<LeyendaIsovalores />);
    expect(screen.getByText("momento Mx")).toBeInTheDocument();
    expect(screen.getByText("(kN·m/m)")).toBeInTheDocument();
  });
});
