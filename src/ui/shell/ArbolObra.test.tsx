// Tests RTL del arbol de obra (UX-3.2). Foco: clic selecciona + activa el contexto
// de planta; doble clic ademas emite el encuadre del elemento (encuadreBus); hover
// sincroniza seleccionStore.hoverId (el tinte del lienzo ya existe).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "./Sidebar";
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import { crearModeloVacio, SCHEMA_VERSION, type Modelo } from "../../dominio";
import {
  suscribirEncuadre,
  type ObjetivoEncuadre,
} from "../viewport/hooks/encuadreBus";

// Obra minima: dos plantas, una viga en p1 (V1) y otra en p2 (V2).
function modeloPrueba(): Modelo {
  return {
    ...crearModeloVacio(),
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p2", nombre: "Planta 2", cota: 6, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
    ],
    vigas: [
      {
        id: "vg1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: "s1", materialId: "m1",
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
      {
        id: "vg2", nombre: "V2", plantaId: "p2", nudoI: "n1", nudoJ: "n2",
        seccionId: "s1", materialId: "m1",
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
    ],
  };
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(modeloPrueba());
  vistaStore.getState().setPlantaActiva(null);
  vistaStore.getState().setModoVista("planta");
  seleccionStore.getState().limpiar();
});

function fila(label: string): HTMLElement {
  return screen.getByText(label).closest(".cx-row") as HTMLElement;
}

describe("ArbolObra (UX-3.2)", () => {
  it("lista las plantas (desc por cota) con sus elementos", () => {
    render(<Sidebar />);
    expect(screen.getByText("Planta 2")).toBeInTheDocument();
    expect(screen.getByText("V1")).toBeInTheDocument();
    expect(screen.getByText("V2")).toBeInTheDocument();
  });

  it("clic en un elemento lo selecciona y activa su planta (contexto)", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(fila("V2"));
    expect(seleccionStore.getState().seleccion).toEqual(["vg2"]);
    expect(vistaStore.getState().plantaActivaId).toBe("p2");
  });

  it("doble clic ademas emite el encuadre del elemento (encuadreBus)", async () => {
    const user = userEvent.setup();
    const recibidos: ObjetivoEncuadre[] = [];
    const off = suscribirEncuadre((o) => recibidos.push(o));
    render(<Sidebar />);

    await user.dblClick(fila("V1"));
    expect(recibidos).toContainEqual({ objetivo: "elemento", id: "vg1" });
    expect(seleccionStore.getState().seleccion).toEqual(["vg1"]);
    off();
  });

  it("hover sincroniza el hoverId del lienzo (entrar/salir)", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.hover(fila("V1"));
    expect(seleccionStore.getState().hoverId).toBe("vg1");
    await user.unhover(fila("V1"));
    expect(seleccionStore.getState().hoverId).toBeNull();
  });

  it("clic en la fila de una planta solo activa el contexto (sin seleccionar)", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(fila("Planta 2"));
    expect(vistaStore.getState().plantaActivaId).toBe("p2");
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });
});
