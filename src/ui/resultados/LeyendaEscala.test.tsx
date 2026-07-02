// Componente (RTL, project jsdom) de LeyendaEscala (deformada). Verifica el fix UX-H1:
// en planta la leyenda muestra la guia "La deformada se muestra en la vista 3D" y deja el
// slider de amplificacion y el toggle "Animar" deshabilitados (no operan en planta, donde
// el overlay 3D no se dibuja); en 3D los controles estan operativos.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeyendaEscala } from "./LeyendaEscala";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

// Una barra M1 entre dos nudos con desplazamiento en N2 (rango>0 -> la leyenda se muestra).
function modeloUnaBarra(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 4, y: 0, z: 0 },
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

function resultados(): ResultadosCalculo {
  const cero = [0, 0, 0, 0, 0, 0];
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {
      N1: { ELU: { disp: cero, rxn: cero } },
      N2: { ELU: { disp: [0, -0.02, 0, 0, 0, 0], rxn: cero } },
    },
    barras: {},
    check_statics: null,
  };
}

function trazaMinima(): Trazabilidad {
  return {
    pilarAMembers: {}, vigaAMember: {}, pilarANodoArranque: {}, nudoANodo: {}, nodoFEMAPlanta: {},
    panoAQuads: {}, quadAPano: {}, quadANodos: {}, nodosDeMalla: [], apoyosDeMalla: [],
  };
}

beforeEach(() => {
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
});

function montar() {
  resultadosStore
    .getState()
    .setResultados(resultados(), modeloUnaBarra(), trazaMinima());
  vistaStore.getState().setCombinacionActiva("ELU");
  return render(<LeyendaEscala />);
}

describe("LeyendaEscala · guia en planta (UX-H1)", () => {
  it("en planta muestra la guia y deshabilita slider y animar", () => {
    vistaStore.getState().setModoVista("planta");
    montar();
    expect(screen.getByText(/la deformada se muestra en la vista 3d/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/factor de amplificación de la deformada/i),
    ).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("en 3D no muestra la guia y los controles estan operativos", () => {
    vistaStore.getState().setModoVista("3d");
    montar();
    expect(
      screen.queryByText(/la deformada se muestra en la vista 3d/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/factor de amplificación de la deformada/i),
    ).toBeEnabled();
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });
});
