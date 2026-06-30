// Componente (RTL, project jsdom) de TablaReacciones (feature-14, Tarea 2.3/3.2).
// Verifica: una fila por apoyo, etiqueta con el NOMBRE del pilar de obra (no el id
// FEM "N1"), las 6 componentes en mono y el resumen ΣFY; ademas los estados guia
// (sin resultados / sin combo) y el aviso de obsoletos. NO arranca el solver: los
// resultados son sinteticos y el modeloFEM/trazabilidad se derivan de discretizar()
// para que apoyos y arranques casen con la obra real.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { TablaReacciones } from "./TablaReacciones";
import { modeloStore } from "../../estado/modeloStore";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { discretizar } from "../../discretizador";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import type { ResultadosCalculo } from "../../solver";
import { fixtureBiapoyadaUDL } from "../../../tests/golden/_arnes/fixtures";

// Obra de libro con DOS pilares (nombres "API"/"APJ") y sus apoyos en N1/N2.
function obra(): Modelo {
  return fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 });
}

// Discretiza la obra y devuelve el par (ModeloFEM, Trazabilidad) que iran al store
// junto a los resultados sinteticos (el trio coherente del mismo "calculo").
function discretizada(m: Modelo): { fem: ModeloFEM; traza: Trazabilidad } {
  const r = discretizar(m);
  if (!r.ok) throw new Error("fixture invalido en TablaReacciones.test");
  return { fem: r.modeloFEM, traza: r.trazabilidad };
}

// Resultados sinteticos: reaccion conocida por nodo de apoyo en el combo "ELU".
function resultadosConReacciones(
  rxnPorNodo: Record<string, number[]>,
): ResultadosCalculo {
  const nodos: ResultadosCalculo["nodos"] = {};
  for (const [nombre, rxn] of Object.entries(rxnPorNodo)) {
    nodos[nombre] = { ELU: { disp: [0, 0, 0, 0, 0, 0], rxn } };
  }
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos,
    barras: {},
    check_statics: null,
  };
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  resultadosStore.getState().descartar();
  vistaStore.getState().setCombinacionActiva(null);
});

describe("TablaReacciones · estados guia", () => {
  it("sin resultados muestra el mensaje de 'calcula la obra'", () => {
    render(<TablaReacciones />);
    expect(
      screen.getByText(/calcula la obra para ver las reacciones/i),
    ).toBeInTheDocument();
  });

  it("con resultados pero sin combinacion valida pide elegir combinacion", () => {
    const m = obra();
    modeloStore.getState().cargarModelo(m);
    const { fem, traza } = discretizada(m);
    resultadosStore.getState().setResultados(
      resultadosConReacciones({ N1: [0, 60, 0, 0, 0, 0], N2: [0, 60, 0, 0, 0, 0] }),
      fem,
      traza,
    );
    // combinacionActiva = null y ademas no coincide con ninguna calculada.
    vistaStore.getState().setCombinacionActiva(null);
    render(<TablaReacciones />);
    expect(screen.getByText(/elige una combinación/i)).toBeInTheDocument();
  });
});

describe("TablaReacciones · tabla por apoyo", () => {
  beforeEach(() => {
    const m = obra();
    modeloStore.getState().cargarModelo(m);
    const { fem, traza } = discretizada(m);
    // Reacciones verticales (FY) de 60 kN en cada apoyo (qL/2 con q=10,L=6 -> 30;
    // aqui usamos 60 para distinguir suma = 120 y comprobar ΣFY sin ambiguedad).
    resultadosStore.getState().setResultados(
      resultadosConReacciones({
        N1: [1, 60, 0, 0, 0, 5],
        N2: [-1, 60, 0, 0, 0, -5],
      }),
      fem,
      traza,
    );
    vistaStore.getState().setCombinacionActiva("ELU");
  });

  it("una fila por apoyo, etiquetada con el NOMBRE del pilar (no el id FEM)", () => {
    render(<TablaReacciones />);
    // Los pilares del fixture se nombran "API"/"APJ" (id.toUpperCase()).
    expect(screen.getByRole("rowheader", { name: "API" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "APJ" })).toBeInTheDocument();
    // No se filtra el id FEM del nodo de apoyo como etiqueta.
    expect(screen.queryByText("N1")).not.toBeInTheDocument();
    expect(screen.queryByText("N2")).not.toBeInTheDocument();
  });

  it("muestra las 6 componentes de cada apoyo y el resumen ΣFY", () => {
    render(<TablaReacciones />);
    // Fila del apoyo API: FY = 60.00.
    const filaApi = screen.getByRole("rowheader", { name: "API" }).closest("tr")!;
    expect(within(filaApi).getByText("60.00")).toBeInTheDocument();
    expect(within(filaApi).getByText("1.00")).toBeInTheDocument(); // FX
    // Resumen de equilibrio: ΣFY = 60 + 60 = 120.
    const filaSuma = screen.getByRole("rowheader", { name: "ΣFY" }).closest("tr")!;
    expect(within(filaSuma).getByText("120.00")).toBeInTheDocument();
  });

  it("normaliza el residuo '-0.00' del solver a '0.00'", () => {
    // Un GDL no apoyado puede dar -0 numerico; debe presentarse como 0.00.
    const m = obra();
    modeloStore.getState().cargarModelo(m);
    const { fem, traza } = discretizada(m);
    resultadosStore.getState().setResultados(
      resultadosConReacciones({
        N1: [-0, 60, 0, 0, 0, 0],
        N2: [0, 60, 0, 0, 0, 0],
      }),
      fem,
      traza,
    );
    vistaStore.getState().setCombinacionActiva("ELU");
    render(<TablaReacciones />);
    const filaApi = screen.getByRole("rowheader", { name: "API" }).closest("tr")!;
    // No aparece "-0.00" en la fila.
    expect(within(filaApi).queryByText("-0.00")).not.toBeInTheDocument();
  });

  it("no avisa de obsoletos mientras los resultados son vigentes", () => {
    render(<TablaReacciones />);
    expect(screen.queryByText(/resultados obsoletos/i)).not.toBeInTheDocument();
  });

  it("marca los resultados obsoletos cuando la obra dejo de ser vigente", () => {
    // Editar la obra baja la bandera vigente (lo dispara modeloStore.limpiar()).
    resultadosStore.getState().limpiar();
    render(<TablaReacciones />);
    expect(screen.getByText(/resultados obsoletos/i)).toBeInTheDocument();
  });
});

// --- F2.4: filtrado/agregado de apoyos de borde de la malla ------------------
// Fixture SINTETICO (sin discretizar): un apoyo estructural (pilar) + dos de malla, con
// la procedencia marcada en trazabilidad.apoyosDeMalla. Verifica que la losa no inunda la
// tabla (sus apoyos se AGREGAN en una fila "Losa (borde)") y que el ΣFY sigue cerrando.

// Apoyo FEM minimo (solo DY vertical apoyado).
function apoyoFEM(node: string): ModeloFEM["supports"][number] {
  return { node, DX: false, DY: true, DZ: false, RX: false, RY: false, RZ: false };
}

function femConMalla(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [],
    materials: [],
    sections: [],
    members: [],
    supports: [apoyoFEM("Npilar"), apoyoFEM("Nmalla1"), apoyoFEM("Nmalla2")],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

function trazaConMalla(): Trazabilidad {
  // pilarANodoArranque etiqueta Npilar como el pilar "pil1"; los Nmalla* proceden de malla.
  return {
    pilarAMembers: {},
    vigaAMember: {},
    pilarANodoArranque: { pil1: "Npilar" },
    nudoANodo: {},
    nodoFEMAPlanta: {},
    panoAQuads: {},
    quadAPano: {},
    quadANodos: {},
    nodosDeMalla: ["Nmalla1", "Nmalla2"],
    apoyosDeMalla: ["Nmalla1", "Nmalla2"],
  };
}

describe("TablaReacciones · filtrado de apoyos de malla (F2.4)", () => {
  beforeEach(() => {
    // Un pilar "P1" para que la fila estructural se etiquete con su nombre de obra.
    modeloStore.getState().cargarModelo({
      ...modeloStore.getState().getModelo(),
      pilares: [
        {
          id: "pil1",
          nombre: "P1",
          x: 0,
          y: 0,
          plantaInicial: "p1",
          plantaFinal: "p1",
          seccionId: "s1",
          materialId: "m1",
          angulo: 0,
          vinculacionExterior: true,
          arranque: "empotrado",
        },
      ],
    });
    // Pilar reacciona 100 en FY; cada apoyo de malla 10 (agregado = 20).
    resultadosStore.getState().setResultados(
      resultadosConReacciones({
        Npilar: [0, 100, 0, 0, 0, 0],
        Nmalla1: [0, 10, 0, 0, 0, 0],
        Nmalla2: [0, 10, 0, 0, 0, 0],
      }),
      femConMalla(),
      trazaConMalla(),
    );
    vistaStore.getState().setCombinacionActiva("ELU");
  });

  it("agrega los apoyos de malla en una fila 'Losa (borde)' (no los lista uno a uno)", () => {
    render(<TablaReacciones />);
    const tabla = screen.getByRole("table");
    expect(within(tabla).getByText("P1")).toBeInTheDocument();
    const filaLosa = within(tabla).getByText("Losa (borde)").closest("tr")!;
    // El agregado suma 10+10 = 20 en FY.
    expect(within(filaLosa).getByText("20.00")).toBeInTheDocument();
  });

  it("ΣFY incluye el agregado de la losa (100 pilar + 20 losa = 120)", () => {
    render(<TablaReacciones />);
    const filaSuma = screen.getByRole("rowheader", { name: "ΣFY" }).closest("tr")!;
    expect(within(filaSuma).getByText("120.00")).toBeInTheDocument();
  });
});
