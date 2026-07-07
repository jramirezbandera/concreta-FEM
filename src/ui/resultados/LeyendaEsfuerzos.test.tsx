// Componente (RTL, project jsdom) de LeyendaEsfuerzos (overlay de esfuerzos N/V/M).
// Verifica: exclusion por overlay (D9), el selector N/V/M escribe magnitudEsfuerzo,
// el |maximo| del combo con su unidad, el slider (log) escribe esfuerzosEscala, la
// guia en planta con el slider inerte (UX-H1) y el tag de obsoletos.
//
// GOTCHA Radix en jsdom (memoria feature-11): el Segmentado es un ToggleGroup que
// depende de PointerCapture; se rellenan los stubs. Los items son role="radio".
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LeyendaEsfuerzos } from "./LeyendaEsfuerzos";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { trazabilidadVacia } from "../../discretizador";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo, EstadoMiembroCombo } from "../../solver";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Una viga M1 de 4 m con momento de vano -8 kN·m y axil +3 kN, en CRUDOS de PyNite
// (vano negativo, compresion positiva); la UI los presenta volteados
// (convencionEsfuerzos: vano +, traccion +).
function modeloUnaBarra(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 3, z: 0 },
      { name: "N2", x: 4, y: 3, z: 0 },
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

function estadoM1(): EstadoMiembroCombo {
  const xs = [0, 2, 4];
  return {
    axial: [xs, [3, 3, 3]],
    shear_y: [xs, [4, 0, -4]],
    moment_z: [xs, [0, -8, 0]],
    defl_y: [xs, [0, 0, 0]],
    deformada_global: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    max_moment_z: 0,
    min_moment_z: -8,
    max_shear_y: 4,
  };
}

function resultados(): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 3 },
    combos: ["ELU"],
    nodos: {},
    barras: { M1: { ELU: estadoM1() } },
    check_statics: null,
  };
}

beforeEach(() => {
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
  vistaStore.getState().setOverlayResultados("deformada");
  vistaStore.getState().setMagnitudEsfuerzo("momento");
  vistaStore.getState().setEsfuerzosEscala(1);
  vistaStore.getState().setModoVista("3d");
});

function montar() {
  resultadosStore
    .getState()
    .setResultados(resultados(), modeloUnaBarra(), trazabilidadVacia());
  vistaStore.getState().setCombinacionActiva("ELU");
  return render(<LeyendaEsfuerzos />);
}

describe("LeyendaEsfuerzos · exclusion por overlay (D9)", () => {
  it("se OCULTA con la deformada o la forma modal activas; se muestra con esfuerzos", () => {
    const { unmount } = montar(); // overlay "deformada" (del beforeEach)
    expect(
      screen.queryByRole("radiogroup", { name: "Magnitud de esfuerzos en escena" }),
    ).not.toBeInTheDocument();
    unmount();

    vistaStore.getState().setOverlayResultados("modal");
    const m = render(<LeyendaEsfuerzos />);
    expect(
      screen.queryByRole("radiogroup", { name: "Magnitud de esfuerzos en escena" }),
    ).not.toBeInTheDocument();
    m.unmount();

    vistaStore.getState().setOverlayResultados("esfuerzos");
    render(<LeyendaEsfuerzos />);
    expect(
      screen.getByRole("radiogroup", { name: "Magnitud de esfuerzos en escena" }),
    ).toBeInTheDocument();
  });

  it("sin resultados no se muestra (nada que rotular)", () => {
    vistaStore.getState().setOverlayResultados("esfuerzos");
    render(<LeyendaEsfuerzos />);
    expect(
      screen.queryByRole("radiogroup", { name: "Magnitud de esfuerzos en escena" }),
    ).not.toBeInTheDocument();
  });
});

describe("LeyendaEsfuerzos · selector y maximo", () => {
  it("muestra el |maximo| del combo con su unidad y cambia con la magnitud", async () => {
    vistaStore.getState().setOverlayResultados("esfuerzos");
    const user = userEvent.setup();
    montar();
    // Momento (default), notacion con eje: max |Mz| = 8.0 kN·m. Leyenda de signo
    // generica (positivo/negativo).
    expect(screen.getByText(/máx \|Mz\| = 8\.0 kN·m/)).toBeInTheDocument();
    expect(screen.getByText("positivo")).toBeInTheDocument();
    expect(screen.getByText("negativo")).toBeInTheDocument();

    const grupo = screen.getByRole("radiogroup", {
      name: "Magnitud de esfuerzos en escena",
    });
    await user.click(within(grupo).getByRole("radio", { name: "N" }));
    expect(vistaStore.getState().magnitudEsfuerzo).toBe("axil");
    // Axil: max |N| = 3.0 kN; la leyenda de signo comunica el significado fisico
    // del convenio de presentacion (traccion + / compresion -).
    expect(screen.getByText(/máx \|N\| = 3\.0 kN/)).toBeInTheDocument();
    expect(screen.getByText("tracción")).toBeInTheDocument();
    expect(screen.getByText("compresión")).toBeInTheDocument();
  });
});

describe("LeyendaEsfuerzos · slider de tamaño (log)", () => {
  it("recorre posiciones [0..1000]; el centro mapea a ×1 y el maximo a ×10", () => {
    vistaStore.getState().setOverlayResultados("esfuerzos");
    montar();
    const slider = screen.getByLabelText(
      /tamaño de los diagramas de esfuerzos/i,
    ) as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("1000");
    // Multiplicador 1 (default) = centro del recorrido log [0.1..10].
    expect(slider.value).toBe("500");

    fireEvent.change(slider, { target: { value: "1000" } });
    expect(vistaStore.getState().esfuerzosEscala).toBeCloseTo(10, 6);
    fireEvent.change(slider, { target: { value: "0" } });
    expect(vistaStore.getState().esfuerzosEscala).toBeCloseTo(0.1, 6);
  });
});

describe("LeyendaEsfuerzos · guia en planta (UX-H1) y obsoletos", () => {
  it("en planta muestra la guia y deja el slider inerte", () => {
    vistaStore.getState().setOverlayResultados("esfuerzos");
    vistaStore.getState().setModoVista("planta");
    montar();
    expect(
      screen.getByText(/los diagramas de esfuerzos se muestran en la vista 3d/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/tamaño de los diagramas de esfuerzos/i)).toBeDisabled();
  });

  it("con la obra editada tras calcular (vigente=false) muestra el tag de obsoletos", () => {
    vistaStore.getState().setOverlayResultados("esfuerzos");
    // El estado se fija ANTES de montar (limpiar() baja vigente conservando los
    // resultados); lo que se verifica es el tag, no la reactividad del store.
    resultadosStore
      .getState()
      .setResultados(resultados(), modeloUnaBarra(), trazabilidadVacia());
    vistaStore.getState().setCombinacionActiva("ELU");
    resultadosStore.getState().limpiar();
    render(<LeyendaEsfuerzos />);
    expect(screen.getByText("obsoletos")).toBeInTheDocument();
  });
});
