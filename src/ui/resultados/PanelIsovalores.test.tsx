// Componente (RTL, project jsdom) de PanelIsovalores (F3, T3.2): selector de magnitud
// (Flecha/Mx/My) + estados guia + aviso de obsoleto. [AUDITORIA D10] la RAMPA ya no vive
// aqui (se mudo a LeyendaIsovalores): estos tests verifican el estado vacio, el selector, la
// escritura a vistaStore.magnitudIsovalores y el aviso de obsoleto, NO la rampa/unidad.
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
// Traza de un modelo con forjado UNIDIRECCIONAL y sin losa: sus viguetas viven en
// panoAMembers (espejo de panoAQuads). Sin quads que colorear -> estado honesto.
function trazaUnidireccional(): Trazabilidad {
  return {
    ...trazabilidadVacia(),
    panoAMembers: { "pano-uni": ["PV0-V0", "PV0-V1", "PV0-V2"] },
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
  it("sin resultados de placa muestra el estado vacio guia (UX-I1), no se oculta", () => {
    resultadosStore.getState().setResultados(resultadosSinPlaca(), femSinQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    render(<PanelIsovalores />);
    // Antes se ocultaba el panel (container vacio); ahora guia a introducir un paño.
    expect(screen.getByText(/no hay losas calculadas/i)).toBeInTheDocument();
    expect(screen.getByText(/entrada de vigas/i)).toBeInTheDocument();
    // El selector de magnitud NO se muestra en el estado vacio (no hay nada que colorear).
    expect(
      screen.queryByRole("radiogroup", { name: "Magnitud de isovalores" }),
    ).not.toBeInTheDocument();
  });

  it("con forjado unidireccional y sin losa: estado HONESTO (isovalores = losas; uni por reacciones/deformada)", () => {
    // Modelo calculado con viguetas (panoAMembers) pero sin quads: no hay placa que colorear.
    resultadosStore
      .getState()
      .setResultados(resultadosSinPlaca(), femSinQuad(), trazaUnidireccional());
    vistaStore.getState().setCombinacionActiva("ELS");
    render(<PanelIsovalores />);
    // El mensaje honesto explica que los isovalores son de losas y donde leer el forjado uni.
    expect(screen.getByText(/losas macizas/i)).toBeInTheDocument();
    expect(screen.getByText(/reacciones/i)).toBeInTheDocument();
    expect(screen.getByText(/deformada/i)).toBeInTheDocument();
    // NO cae en el guia generico "no hay losas / introduce un paño" (ya hay un forjado).
    expect(screen.queryByText(/introduce un paño/i)).not.toBeInTheDocument();
    // Sin jerga FEM en el texto visible (nada de "member"/"vigueta FEM"/"quad").
    expect(screen.queryByText(/member|quad/i)).not.toBeInTheDocument();
    // Sigue sin selector (no hay nada que colorear).
    expect(
      screen.queryByRole("radiogroup", { name: "Magnitud de isovalores" }),
    ).not.toBeInTheDocument();
  });

  it("sin losa y sin forjado unidireccional: cae en el guia generico (no el mensaje uni)", () => {
    resultadosStore.getState().setResultados(resultadosSinPlaca(), femSinQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    render(<PanelIsovalores />);
    expect(screen.getByText(/no hay losas calculadas/i)).toBeInTheDocument();
    // No debe mencionar el forjado unidireccional cuando no lo hay.
    expect(screen.queryByText(/losas macizas/i)).not.toBeInTheDocument();
  });

  it("visible con resultados de placa: muestra el selector de magnitud (sin rampa, D10)", () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    render(<PanelIsovalores />);
    expect(screen.getByRole("radiogroup", { name: "Magnitud de isovalores" })).toBeInTheDocument();
    // [D10] La rampa (con su rotulo de unidad) ya no vive en este panel: vive en
    // LeyendaIsovalores. El panel no muestra la unidad.
    expect(screen.queryByText("(mm)")).not.toBeInTheDocument();
  });

  it("elegir Mx actualiza vistaStore.magnitudIsovalores (D10: la unidad la lleva la leyenda)", async () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    const user = userEvent.setup();
    render(<PanelIsovalores />);

    const grupo = screen.getByRole("radiogroup", { name: "Magnitud de isovalores" });
    await user.click(within(grupo).getByRole("radio", { name: "Mx" }));

    expect(vistaStore.getState().magnitudIsovalores).toBe("momentoX");
    // La unidad (kN·m/m) la muestra LeyendaIsovalores, no este panel.
    expect(screen.queryByText("(kN·m/m)")).not.toBeInTheDocument();
  });

  it("no avisa de obsoletos mientras los resultados son vigentes (UX-H4)", () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    render(<PanelIsovalores />);
    expect(screen.queryByText(/resultados obsoletos/i)).not.toBeInTheDocument();
    // El tag es "losa" mientras es vigente.
    expect(screen.getByText("losa")).toBeInTheDocument();
  });

  it("con la obra editada tras calcular muestra tag 'obsoletos' y aviso (UX-H4)", () => {
    resultadosStore.getState().setResultados(resultadosConPlaca(), femConQuad(), traza());
    vistaStore.getState().setCombinacionActiva("ELS");
    // Editar la obra baja la bandera vigente conservando resultados (modeloStore.limpiar).
    resultadosStore.getState().limpiar();
    render(<PanelIsovalores />);
    expect(screen.getByText(/resultados obsoletos/i)).toBeInTheDocument();
    expect(screen.getByText("obsoletos")).toBeInTheDocument();
  });
});
