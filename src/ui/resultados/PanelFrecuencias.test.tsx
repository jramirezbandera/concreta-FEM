// Componente (RTL, project jsdom) de PanelFrecuencias (F2b). Verifica: estado vacio
// legible cuando no hay modos; lista de frecuencias (Hz, mono) con un boton por modo y
// el modo activo resaltado/seleccionable (-> modalStore.setModoActivo); el control de
// nº de modos; y el reporte de errores de obra. NO arranca el solver: useSolicitarModos
// se MOCKEA para no tocar solverClient.calcularModal (camino concurrente F3.1) y para
// poder fijar estadoMotor/errores a placer.
//
// PanelFrecuencias usa PanelFlotante/Boton (NO Radix), asi que no hay gotcha jsdom de
// Popover/Select aqui: se renderiza y se hace click directamente.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import type { ResultadosModales } from "../../solver";
import type { ModeloFEM, Trazabilidad, ErrorObra } from "../../discretizador";
import type { UseSolicitarModos } from "./useSolicitarModos";

// --- Mock de useSolicitarModos (evita el solver y fija el estado del motor) -------
// Estado controlable desde cada test; el spy de calcularModos comprueba el disparo.
// vi.hoisted iza el spy y el holder mutable por encima de los imports, de forma que la
// factory de vi.mock (que tambien se iza) pueda referenciarlos sin caer en la
// restriccion de captura (no-var-friendly, regla de vitest).
const { calcularModosSpy, holder } = vi.hoisted(() => {
  const spy = vi.fn(async () => {});
  return {
    calcularModosSpy: spy,
    holder: {
      estado: {
        calcularModos: spy,
        estadoMotor: "listo" as const,
        calculando: false,
        errores: [],
        ultimoError: null,
      } as UseSolicitarModos,
    },
  };
});
vi.mock("./useSolicitarModos", () => ({
  useSolicitarModos: (): UseSolicitarModos => holder.estado,
  calcularModos: (...args: unknown[]) => calcularModosSpy(...(args as [])),
}));

// Imports del SUT y de los stores DESPUES del mock (orden de legibilidad; ESM los
// hoistea, pero el mock ya esta registrado por vi.mock hoisting).
import { PanelFrecuencias } from "./PanelFrecuencias";
import { modalStore } from "../../estado/modalStore";
import { vistaStore } from "../../estado/vistaStore";

// --- Fixtures de datos modales -----------------------------------------------
function modeloFEMMinimo(): ModeloFEM {
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
    analysis: { type: "modal", check_statics: false, num_modes: 3 },
  };
}
function trazaMinima(): Trazabilidad {
  return {
    pilarAMembers: {}, vigaAMember: {}, pilarANodoArranque: {}, nudoANodo: {}, nodoFEMAPlanta: {},
    panoAQuads: {}, quadAPano: {}, quadANodos: {}, nodosDeMalla: [], apoyosDeMalla: [],
  };
}
function modosDe(frecuencias: number[]): ResultadosModales {
  return {
    units: "kN-m",
    analysis: { type: "modal", num_modes: frecuencias.length },
    frecuencias,
    modos: frecuencias.map((f, i) => ({
      numero: i + 1,
      frecuencia: f,
      nodos: { N1: [0, 0, 0, 0, 0, 0] },
    })),
  };
}

beforeEach(() => {
  calcularModosSpy.mockClear();
  holder.estado = {
    calcularModos: calcularModosSpy,
    estadoMotor: "listo",
    calculando: false,
    errores: [],
    ultimoError: null,
  };
  modalStore.getState().descartar();
  vistaStore.getState().setNumModos(6);
  vistaStore.getState().setModalEscala(1);
  vistaStore.getState().setModalAnimando(false);
});

describe("PanelFrecuencias · estado vacio", () => {
  it("sin modos calculados muestra el estado vacio y NO la lista", () => {
    render(<PanelFrecuencias />);
    expect(screen.getByText(/Sin modos calculados/i)).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("el boton lleva la etiqueta 'Calcular modos' con el motor listo", () => {
    render(<PanelFrecuencias />);
    expect(screen.getByRole("button", { name: /Calcular modos/i })).toBeEnabled();
  });

  it("pulsar 'Calcular modos' dispara calcularModos con el nº de modos del store", () => {
    vistaStore.getState().setNumModos(4);
    render(<PanelFrecuencias />);
    fireEvent.click(screen.getByRole("button", { name: /Calcular modos/i }));
    expect(calcularModosSpy).toHaveBeenCalledWith(4);
  });

  it("con el motor cargando, el boton se deshabilita y rotula 'Cargando motor…'", () => {
    holder.estado = { ...holder.estado, estadoMotor: "cargando" };
    render(<PanelFrecuencias />);
    expect(screen.getByRole("button", { name: /Cargando motor/i })).toBeDisabled();
  });
});

// Carga modos en el store (vigente=true) para los tests de lista.
function montarConModos(frecuencias: number[]) {
  modalStore.getState().setModos(modosDe(frecuencias), modeloFEMMinimo(), trazaMinima());
  return render(<PanelFrecuencias />);
}

describe("PanelFrecuencias · lista de frecuencias + selector de modo", () => {
  it("lista una opcion por modo con su frecuencia en Hz", () => {
    montarConModos([3.21, 7.84, 12.5]);
    const listbox = screen.getByRole("listbox");
    const opciones = within(listbox).getAllByRole("option");
    expect(opciones).toHaveLength(3);
    expect(within(listbox).getByText(/Modo 1/)).toBeInTheDocument();
    expect(within(listbox).getByText(/3\.21 Hz/)).toBeInTheDocument();
    expect(within(listbox).getByText(/7\.84 Hz/)).toBeInTheDocument();
  });

  it("el modo activo (1 por defecto) esta marcado aria-selected", () => {
    montarConModos([3.2, 7.8]);
    const opciones = screen.getAllByRole("option");
    expect(opciones[0]).toHaveAttribute("aria-selected", "true");
    expect(opciones[1]).toHaveAttribute("aria-selected", "false");
  });

  it("seleccionar otro modo lo fija en modalStore.modoActivo", () => {
    montarConModos([3.2, 7.8, 12.5]);
    fireEvent.click(screen.getByRole("option", { name: /Modo 3/i }));
    expect(modalStore.getState().modoActivo).toBe(3);
  });

  it("muestra la etiqueta 'obsoletos' cuando la obra cambio tras calcular", () => {
    const { rerender } = montarConModos([3.2, 7.8]);
    expect(screen.queryByText(/obsoletos/i)).not.toBeInTheDocument();
    // Editar la obra invalida modalStore.vigente (limpiar): la etiqueta aparece.
    modalStore.getState().limpiar();
    rerender(<PanelFrecuencias />);
    expect(screen.getByText(/obsoletos/i)).toBeInTheDocument();
  });
});

describe("PanelFrecuencias · control de nº de modos", () => {
  it("el input de nº de modos refleja vistaStore.numModos", () => {
    vistaStore.getState().setNumModos(8);
    render(<PanelFrecuencias />);
    const input = screen.getByLabelText(/Número de modos/i) as HTMLInputElement;
    expect(input.value).toBe("8");
  });

  it("cambiar el input acota y escribe vistaStore.numModos", () => {
    render(<PanelFrecuencias />);
    const input = screen.getByLabelText(/Número de modos/i);
    fireEvent.change(input, { target: { value: "12" } });
    expect(vistaStore.getState().numModos).toBe(12);
  });
});

describe("PanelFrecuencias · reporte de errores de obra", () => {
  it("muestra los errores de obra del ultimo intento (lenguaje de obra)", () => {
    const err: ErrorObra = {
      codigo: "MODAL_SIN_MASA",
      severidad: "error",
      mensaje: "La estructura no tiene masa: añade peso a los elementos.",
    };
    holder.estado = { ...holder.estado, errores: [err] };
    render(<PanelFrecuencias />);
    expect(screen.getByText(/La estructura no tiene masa/i)).toBeInTheDocument();
  });
});
