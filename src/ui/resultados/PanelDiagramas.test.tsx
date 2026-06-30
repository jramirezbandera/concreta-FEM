// Componente (RTL, project jsdom) de PanelDiagramas (feature-14, Tarea 2.2/3.2).
// Verifica el comportamiento del PANEL (no el render de Plotly): mensajes guia
// segun el estado, mapeo seleccion->member via trazabilidad (viga -> vigaAMember;
// pilar -> pilarAMembers[0]) y el selector de magnitud. NO carga Plotly en jsdom:
// se mockea la frontera lazy (./diagramaLazy) con un stub que expone sus props.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub de la frontera de Plotly (#21): en lugar de cargar el bundle real, render un
// nodo testeable que vuelca las props (posiciones/valores/etiquetaY) como atributos.
// Asi comprobamos que el panel resolvio la barra y extrajo la serie correcta sin
// tocar Plotly ni jsdom-canvas. El mock cubre el default export que consume el lazy.
vi.mock("./diagramaLazy", () => ({
  DiagramaBarraLazy: (props: {
    posiciones: number[];
    valores: number[];
    etiquetaY: string;
  }) => (
    <div
      data-testid="diagrama-stub"
      data-etiqueta-y={props.etiquetaY}
      data-posiciones={JSON.stringify(props.posiciones)}
      data-valores={JSON.stringify(props.valores)}
    />
  ),
}));

import { PanelDiagramas } from "./PanelDiagramas";
import { seleccionStore } from "../../estado/seleccionStore";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo, EstadoMiembroCombo } from "../../solver";

// ModeloFEM minimo (no lo usa el panel; lo exige setResultados).
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

// Trazabilidad de juguete: la viga "v1" -> member "M3"; el pilar "p1" -> [M1, M2]
// (pasante de dos tramos, para probar el aviso de troceado mostrando el primero).
function traza(): Trazabilidad {
  return {
    pilarAMembers: { p1: ["M1", "M2"] },
    vigaAMember: { v1: "M3" },
    pilarANodoArranque: { p1: "N1" },
    nudoANodo: {},
    nodoFEMAPlanta: {},
    panoAQuads: {},
    quadAPano: {},
    quadANodos: {},
    nodosDeMalla: [],
    apoyosDeMalla: [],
  };
}

// Estado de barra para un combo: diagramas (2,n) con valores distintos por magnitud
// para distinguir cual extrajo el panel. n=2 (extremos) basta.
function estadoBarra(): EstadoMiembroCombo {
  return {
    axial: [[0, 6], [-5, -5]], // N
    shear_y: [[0, 6], [30, -30]], // V
    moment_z: [[0, 6], [0, 45]], // M (kN·m)
    defl_y: [[0, 6], [0, -0.01]], // flecha (m) -> el panel convierte a mm (x1000)
    // Deformada global (3, n): DX/DY/DZ por estacion. n=2 (extremos) coherente con
    // los diagramas; la viga desciende en su extremo j (DY negativa).
    deformada_global: [[0, 0], [0, -0.01], [0, 0]],
    max_moment_z: 45,
    min_moment_z: 0,
    max_shear_y: 30,
  };
}

function resultadosConBarra(member: string): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {},
    barras: { [member]: { ELU: estadoBarra() } },
    check_statics: null,
  };
}

beforeEach(() => {
  seleccionStore.getState().limpiar();
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
  vistaStore.getState().setMagnitudDiagrama("momento");
});

describe("PanelDiagramas · mensajes guia (lenguaje de obra, sin jerga FEM)", () => {
  it("sin resultados invita a calcular", () => {
    render(<PanelDiagramas />);
    expect(screen.getByText(/calcula la obra para ver los esfuerzos/i)).toBeInTheDocument();
    expect(screen.queryByTestId("diagrama-stub")).not.toBeInTheDocument();
  });

  it("con resultados pero sin seleccion invita a seleccionar una barra", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femVacio(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    render(<PanelDiagramas />);
    expect(screen.getByText(/selecciona una barra/i)).toBeInTheDocument();
  });
});

describe("PanelDiagramas · mapeo seleccion -> member via trazabilidad", () => {
  it("seleccionar la VIGA v1 dibuja la serie del member M3 (vigaAMember)", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femVacio(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["v1"]); // viga
    render(<PanelDiagramas />);

    const stub = screen.getByTestId("diagrama-stub");
    // Magnitud por defecto = momento -> serie de moment_z [0,45].
    expect(stub).toHaveAttribute("data-valores", JSON.stringify([0, 45]));
    expect(stub).toHaveAttribute("data-etiqueta-y", "Momento (kN·m)");
  });

  it("seleccionar el PILAR pasante p1 usa el primer tramo (M1) y avisa del troceado", () => {
    // El pilar mapea a [M1, M2]; el panel muestra M1 y avisa "abarca varias plantas".
    resultadosStore.getState().setResultados(resultadosConBarra("M1"), femVacio(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["p1"]); // pilar pasante
    render(<PanelDiagramas />);

    expect(screen.getByTestId("diagrama-stub")).toBeInTheDocument();
    expect(screen.getByText(/abarca varias plantas/i)).toBeInTheDocument();
  });

  it("seleccion multiple no resuelve barra (mensaje de seleccionar una barra)", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femVacio(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["v1", "p1"]);
    render(<PanelDiagramas />);
    expect(screen.getByText(/selecciona una barra/i)).toBeInTheDocument();
  });
});

describe("PanelDiagramas · selector de magnitud", () => {
  beforeEach(() => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femVacio(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["v1"]);
  });

  it("cambiar a Cortante (V) actualiza vistaStore y la serie dibujada", async () => {
    const user = userEvent.setup();
    render(<PanelDiagramas />);

    // El segmentado expone un boton por magnitud (etiquetaBoton: N/V/M/Flecha).
    await user.click(screen.getByRole("radio", { name: "V" }));

    expect(vistaStore.getState().magnitudDiagrama).toBe("cortante");
    expect(screen.getByTestId("diagrama-stub")).toHaveAttribute(
      "data-valores",
      JSON.stringify([30, -30]), // serie de shear_y
    );
  });

  it("la magnitud Flecha convierte m -> mm en el borde (x1000)", async () => {
    const user = userEvent.setup();
    render(<PanelDiagramas />);

    await user.click(screen.getByRole("radio", { name: "Flecha" }));

    expect(vistaStore.getState().magnitudDiagrama).toBe("flecha");
    // defl_y en m = [0, -0.01] -> mm = [0, -10].
    expect(screen.getByTestId("diagrama-stub")).toHaveAttribute(
      "data-valores",
      JSON.stringify([0, -10]),
    );
    expect(screen.getByTestId("diagrama-stub")).toHaveAttribute(
      "data-etiqueta-y",
      "Flecha (mm)",
    );
  });
});
