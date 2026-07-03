// Componente (RTL, project jsdom) de LeyendaEscala (deformada). Verifica el fix UX-H1:
// en planta la leyenda muestra la guia "La deformada se muestra en la vista 3D" y deja el
// slider de amplificacion y el toggle "Animar" deshabilitados (no operan en planta, donde
// el overlay 3D no se dibuja); en 3D los controles estan operativos.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
  vistaStore.getState().setOverlayResultados("deformada");
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

describe("LeyendaEscala · exclusion con la forma modal (D9)", () => {
  it("se muestra con la deformada activa y se OCULTA con la forma modal activa", () => {
    vistaStore.getState().setModoVista("3d");
    // Deformada activa: la leyenda (rampa + control) se muestra.
    vistaStore.getState().setOverlayResultados("deformada");
    const { unmount } = montar();
    expect(
      screen.getByLabelText(/factor de amplificación de la deformada/i),
    ).toBeInTheDocument();
    unmount();

    // Forma modal activa: la leyenda de la deformada NO se muestra (exclusion mutua).
    vistaStore.getState().setOverlayResultados("modal");
    montar();
    expect(
      screen.queryByLabelText(/factor de amplificación de la deformada/i),
    ).not.toBeInTheDocument();
  });
});

describe("LeyendaEscala · slider logaritmico (D6)", () => {
  it("el slider recorre [0..1000] (posicion), no [1..500] (escala): mapeo log", () => {
    vistaStore.getState().setModoVista("3d");
    vistaStore.getState().setDeformadaEscala(1);
    montar();
    const slider = screen.getByLabelText(
      /factor de amplificación de la deformada/i,
    ) as HTMLInputElement;
    // El input es la POSICION log (0..1000), no la escala directa.
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("1000");
    // Con escala 1 (minimo), la posicion es 0.
    expect(slider.value).toBe("0");
  });

  it("la mitad del recorrido cae en la media GEOMETRICA (√500 ≈ 22), no la aritmetica (250)", () => {
    vistaStore.getState().setModoVista("3d");
    montar();
    const slider = screen.getByLabelText(/factor de amplificación de la deformada/i);
    // Posicion 500/1000 = mitad -> escala = exp((ln1+ln500)/2) = √500 ≈ 22.36 -> 22.
    fireEvent.change(slider, { target: { value: "500" } });
    const escala = vistaStore.getState().deformadaEscala;
    expect(escala).toBeGreaterThan(18);
    expect(escala).toBeLessThan(26); // NO 250 (seria el mapeo lineal roto)
  });

  it("el maximo del recorrido mapea a ×500 (tope)", () => {
    vistaStore.getState().setModoVista("3d");
    montar();
    const slider = screen.getByLabelText(/factor de amplificación de la deformada/i);
    fireEvent.change(slider, { target: { value: "1000" } });
    expect(vistaStore.getState().deformadaEscala).toBe(500);
  });
});
