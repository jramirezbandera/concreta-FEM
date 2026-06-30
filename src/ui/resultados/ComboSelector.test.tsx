// Componente (RTL, project jsdom) de ComboSelector (feature-14, Tarea 2.3/3.2).
// Selector Radix de la combinacion activa: lee las combos de resultadosStore y
// escribe vistaStore.combinacionActiva. Verifica: oculto sin resultados, etiqueta
// legible ("E.L.U. (resistencia)") sobre el value tecnico ("ELU"), y que elegir
// otra combinacion actualiza vistaStore.
//
// GOTCHA Radix en jsdom (memoria feature-11): jsdom no implementa PointerCapture ni
// scrollIntoView, de las que depende Radix Select. Se rellenan como no-ops y el
// listbox se abre por TECLADO (foco + Enter), patron estable ya usado en
// SelectSeccion.test.tsx.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComboSelector } from "./ComboSelector";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// ModeloFEM / Trazabilidad minimos: ComboSelector no los usa, pero setResultados
// exige el trio coherente (mismo origen de calculo).
function femVacio(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [],
    materials: [],
    sections: [],
    members: [],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    analysis: { type: "linear", check_statics: false },
  };
}
function trazaVacia(): Trazabilidad {
  return {
    pilarAMembers: {}, vigaAMember: {}, pilarANodoArranque: {}, nudoANodo: {}, nodoFEMAPlanta: {},
    panoAQuads: {}, quadAPano: {}, quadANodos: {}, nodosDeMalla: [], apoyosDeMalla: [],
  };
}

function resultadosCon(combos: [string, ...string[]]): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos,
    nodos: {},
    barras: {},
    check_statics: null,
  };
}

beforeEach(() => {
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
});

describe("ComboSelector", () => {
  it("sin resultados no renderiza nada (oculto)", () => {
    const { container } = render(<ComboSelector />);
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra la etiqueta legible del combo activo (no el value tecnico)", () => {
    resultadosStore.getState().setResultados(resultadosCon(["ELU", "ELS"]), femVacio(), trazaVacia());
    vistaStore.getState().setCombinacionActiva("ELU");
    render(<ComboSelector />);
    // El trigger muestra la etiqueta enriquecida, no "ELU" a secas.
    expect(screen.getByRole("combobox", { name: "Combinación activa" })).toHaveTextContent(
      "E.L.U. (resistencia)",
    );
  });

  it("elegir otra combinacion actualiza vistaStore.combinacionActiva", async () => {
    resultadosStore.getState().setResultados(resultadosCon(["ELU", "ELS"]), femVacio(), trazaVacia());
    vistaStore.getState().setCombinacionActiva("ELU");
    const user = userEvent.setup();
    render(<ComboSelector />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("E.L.S. (servicio)"));

    // El value que se escribe en el store es el nombre tecnico del solver ("ELS").
    expect(vistaStore.getState().combinacionActiva).toBe("ELS");
  });
});
