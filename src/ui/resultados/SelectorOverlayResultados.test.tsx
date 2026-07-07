// Componente (RTL, project jsdom) de SelectorOverlayResultados (conmutador
// Deformada | Esfuerzos, D9). Verifica: oculto sin resultados, escritura de
// overlayResultados al pulsar, y que con la forma modal activa ningun segmento
// queda marcado y pulsar uno SALE del modal.
//
// GOTCHA Radix en jsdom (memoria feature-11): ToggleGroup depende de
// PointerCapture; se rellenan los stubs. Los items son role="radio".
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SelectorOverlayResultados } from "./SelectorOverlayResultados";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { trazabilidadVacia } from "../../discretizador";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

function modeloVacio(): ModeloFEM {
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
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

function resultados(): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {},
    barras: {},
    check_statics: null,
  };
}

beforeEach(() => {
  resultadosStore.getState().descartar();
  vistaStore.getState().setOverlayResultados("deformada");
});

function conResultados() {
  resultadosStore.getState().setResultados(resultados(), modeloVacio(), trazabilidadVacia());
}

describe("SelectorOverlayResultados", () => {
  it("sin resultados no se muestra (el dock ya guia a calcular)", () => {
    render(<SelectorOverlayResultados />);
    expect(
      screen.queryByRole("radiogroup", { name: "Visualización de resultados en escena" }),
    ).not.toBeInTheDocument();
  });

  it("pulsar Esfuerzos escribe overlayResultados=esfuerzos (y vuelta a deformada)", async () => {
    conResultados();
    const user = userEvent.setup();
    render(<SelectorOverlayResultados />);
    const grupo = screen.getByRole("radiogroup", {
      name: "Visualización de resultados en escena",
    });

    await user.click(within(grupo).getByRole("radio", { name: "Esfuerzos" }));
    expect(vistaStore.getState().overlayResultados).toBe("esfuerzos");

    await user.click(within(grupo).getByRole("radio", { name: "Deformada" }));
    expect(vistaStore.getState().overlayResultados).toBe("deformada");
  });

  it("con la forma modal activa ningun segmento esta marcado; pulsar uno SALE del modal", async () => {
    conResultados();
    vistaStore.getState().setOverlayResultados("modal");
    const user = userEvent.setup();
    render(<SelectorOverlayResultados />);
    const grupo = screen.getByRole("radiogroup", {
      name: "Visualización de resultados en escena",
    });

    // Ninguna opcion marcada (el valor "modal" no casa con ningun segmento).
    for (const radio of within(grupo).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }

    await user.click(within(grupo).getByRole("radio", { name: "Esfuerzos" }));
    expect(vistaStore.getState().overlayResultados).toBe("esfuerzos");
  });
});
