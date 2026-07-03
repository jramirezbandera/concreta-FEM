// Componente (RTL, project jsdom) de PanelDiagramas (feature-14, Tarea 2.2/3.2).
// Verifica el comportamiento del PANEL (no el render de Plotly): mensajes guia
// segun el estado, mapeo seleccion->member via trazabilidad (viga -> vigaAMember;
// pilar -> pilarAMembers[0]) y el selector de magnitud. NO carga Plotly en jsdom:
// se mockea la frontera lazy (./diagramaLazy) con un stub que expone sus props.
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// GOTCHA Radix en jsdom (memoria feature-11): el Segmentado es un ToggleGroup que depende de
// PointerCapture/scrollIntoView; se rellenan los stubs para que el click funcione.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

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
import { modeloStore } from "../../estado/modeloStore";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo, EstadoMiembroCombo } from "../../solver";

// Miembro FEM minimo (solo lo relevante para D20: name + nudo cabeza `j`).
function memberFEM(name: string, i: string, j: string): ModeloFEM["members"][number] {
  return {
    name,
    i,
    j,
    material: "m",
    section: "s",
    rotation: 0,
    tension_only: false,
    comp_only: false,
    releases: null,
  };
}

// ModeloFEM con los members M1/M2/M3 y sus nudos: el panel (D20) los usa para etiquetar los
// tramos del pilar con su planta (via nodoFEMAPlanta del nudo cabeza `j`).
function femConMembers(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 0, y: 3, z: 0 },
      { name: "N3", x: 0, y: 6, z: 0 },
      { name: "N4", x: 4, y: 3, z: 0 },
    ],
    materials: [],
    sections: [],
    // M1: pie->cabeza planta 1 (j=N2); M2: planta1->planta2 (j=N3); M3: viga (j=N4).
    members: [memberFEM("M1", "N1", "N2"), memberFEM("M2", "N2", "N3"), memberFEM("M3", "N1", "N4")],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    analysis: { type: "linear", check_statics: false },
  };
}

// Trazabilidad de juguete: la viga "v1" -> member "M3"; el pilar "p1" -> [M1, M2]
// (pasante de dos tramos, para el selector de tramo D20). nodoFEMAPlanta etiqueta el nudo
// cabeza de cada tramo con su planta: N2 -> pl1 ("Planta baja"), N3 -> pl2 ("Planta 1").
function traza(): Trazabilidad {
  return {
    pilarAMembers: { p1: ["M1", "M2"] },
    vigaAMember: { v1: "M3" },
    pilarANodoArranque: { p1: "N1" },
    nudoANodo: {},
    nodoFEMAPlanta: { N2: "pl1", N3: "pl2", N4: "pl1" },
    panoAQuads: {},
    quadAPano: {},
    quadANodos: {},
    nodosDeMalla: [],
    apoyosDeMalla: [],
  };
}

// Obra minima con las dos plantas que etiquetan los tramos del pilar (D20).
function obraConPlantas(): Modelo {
  return {
    ...crearModeloVacio(),
    grupos: [
      { id: "g1", nombre: "G", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ],
    plantas: [
      { id: "pl1", nombre: "Planta baja", cota: 3, altura: 3, grupoId: "g1" },
      { id: "pl2", nombre: "Planta 1", cota: 6, altura: 3, grupoId: "g1" },
    ],
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

// Estado de barra con un valor de momento DISTINGUIBLE por tramo (D20): asi el test puede
// comprobar que cambiar de tramo cambia la barra resuelta (serie dibujada).
function estadoBarraMomento(momentoJ: number): EstadoMiembroCombo {
  return { ...estadoBarra(), moment_z: [[0, 6], [0, momentoJ]] };
}

// Resultados con los DOS tramos del pilar (M1 y M2), cada uno con un momento propio.
function resultadosDosTramos(): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {},
    barras: {
      M1: { ELU: estadoBarraMomento(45) }, // tramo inferior
      M2: { ELU: estadoBarraMomento(90) }, // tramo superior
    },
    check_statics: null,
  };
}

beforeEach(() => {
  seleccionStore.getState().limpiar();
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
  vistaStore.getState().setMagnitudDiagrama("momento");
  // El panel lee las plantas de la obra para etiquetar los tramos del pilar (D20).
  modeloStore.getState().cargarModelo(obraConPlantas());
});

describe("PanelDiagramas · mensajes guia (lenguaje de obra, sin jerga FEM)", () => {
  it("sin resultados invita a calcular", () => {
    render(<PanelDiagramas />);
    expect(screen.getByText(/calcula la obra para ver los esfuerzos/i)).toBeInTheDocument();
    expect(screen.queryByTestId("diagrama-stub")).not.toBeInTheDocument();
  });

  it("con resultados pero sin seleccion invita a seleccionar una barra", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    render(<PanelDiagramas />);
    expect(screen.getByText(/selecciona una barra/i)).toBeInTheDocument();
  });
});

describe("PanelDiagramas · mapeo seleccion -> member via trazabilidad", () => {
  it("seleccionar la VIGA v1 dibuja la serie del member M3 (vigaAMember)", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["v1"]); // viga
    render(<PanelDiagramas />);

    const stub = screen.getByTestId("diagrama-stub");
    // Magnitud por defecto = momento -> serie de moment_z [0,45].
    expect(stub).toHaveAttribute("data-valores", JSON.stringify([0, 45]));
    expect(stub).toHaveAttribute("data-etiqueta-y", "Momento (kN·m)");
  });

  it("seleccionar el PILAR pasante p1 usa el primer tramo (M1) por defecto (pie)", () => {
    // El pilar mapea a [M1, M2]; por defecto se dibuja el tramo inferior (M1).
    resultadosStore.getState().setResultados(resultadosConBarra("M1"), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["p1"]); // pilar pasante
    render(<PanelDiagramas />);

    expect(screen.getByTestId("diagrama-stub")).toBeInTheDocument();
    // [D20] Ya NO hay aviso "se muestra el tramo inferior": hay un selector de tramo.
    expect(screen.queryByText(/tramo inferior/i)).not.toBeInTheDocument();
  });

  it("seleccion multiple no resuelve barra (mensaje de seleccionar una barra)", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["v1", "p1"]);
    render(<PanelDiagramas />);
    expect(screen.getByText(/selecciona una barra/i)).toBeInTheDocument();
  });
});

describe("PanelDiagramas · selector de magnitud", () => {
  beforeEach(() => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femConMembers(), traza());
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

describe("PanelDiagramas · selector de tramo del pilar (D20)", () => {
  it("una viga (un solo tramo) NO muestra selector de tramo", () => {
    resultadosStore.getState().setResultados(resultadosConBarra("M3"), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["v1"]);
    render(<PanelDiagramas />);
    expect(
      screen.queryByRole("radiogroup", { name: "Tramo del pilar" }),
    ).not.toBeInTheDocument();
  });

  it("un pilar de DOS plantas muestra un selector con 2 opciones (por planta)", () => {
    resultadosStore.getState().setResultados(resultadosDosTramos(), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["p1"]);
    render(<PanelDiagramas />);

    const grupo = screen.getByRole("radiogroup", { name: "Tramo del pilar" });
    const opciones = within(grupo).getAllByRole("radio");
    expect(opciones).toHaveLength(2);
    // Etiquetadas con el NOMBRE de la planta que alcanza cada tramo (lenguaje de obra).
    expect(within(grupo).getByRole("radio", { name: "Planta baja" })).toBeInTheDocument();
    expect(within(grupo).getByRole("radio", { name: "Planta 1" })).toBeInTheDocument();
    // Por defecto se dibuja el tramo inferior (M1, momento 45).
    expect(screen.getByTestId("diagrama-stub")).toHaveAttribute(
      "data-valores",
      JSON.stringify([0, 45]),
    );
  });

  it("cambiar de tramo cambia la barra resuelta (serie dibujada)", async () => {
    const user = userEvent.setup();
    resultadosStore.getState().setResultados(resultadosDosTramos(), femConMembers(), traza());
    vistaStore.getState().setCombinacionActiva("ELU");
    seleccionStore.getState().seleccionar(["p1"]);
    render(<PanelDiagramas />);

    // Elegir el tramo superior (Planta 1) -> serie de M2 (momento 90).
    await user.click(screen.getByRole("radio", { name: "Planta 1" }));
    expect(screen.getByTestId("diagrama-stub")).toHaveAttribute(
      "data-valores",
      JSON.stringify([0, 90]),
    );
  });
});
