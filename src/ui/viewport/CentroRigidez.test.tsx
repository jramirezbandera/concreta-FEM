// Tests de componente del control de Centro de rigidez (F2). RTL en el project
// `jsdom`. CentroRigidez es el panel HUD (HTML, no WebGL): toggle + disparador (Calcular)
// + datos (X/Y + excentricidad) + etiqueta de hipotesis. Verifica:
//   - visibilidad: solo en vista planta; toggle apagado por defecto; muestra/oculta el
//     disparador y el panel.
//   - el boton "Calcular centro de rigidez" dispara calcularCR (hook mockeado, sin solver).
//   - estados del motor: "Cargando motor…"/deshabilitado, "Calculando…", error con reintento.
//   - datos: X/Y (mono) + excentricidad; planta no determinable -> mensaje; CM null (ex/ey
//     null) -> sin excentricidad; etiqueta de hipotesis siempre presente con el panel abierto.
//
// El marcador R3F (CentroRigidezOverlay) NO se testea aqui (jsdom no hace WebGL): su logica
// de datos vive en useCentroRigidez (lee crStore + Modelo, puro de derivacion).
//
// El HOOK useSolicitarCR se MOCKEA (espejo de PanelFrecuencias.test.tsx con
// useSolicitarModos): no toca solverClient.calcularCR ni arranca Pyodide (CLAUDE.md §13).
// El CR a mostrar se inyecta poblando el crStore directamente (lo que haria el pipeline).
//
// Stores singleton de modulo -> reset en beforeEach.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { UseSolicitarCR } from "../resultados/useSolicitarCR";
import type { ResultadosCR } from "../../solver/resultadosCR";
import type { ErrorObra } from "../../discretizador";

// --- Mock de useSolicitarCR (evita el solver y fija el estado del motor) ----------
// Estado controlable desde cada test; el spy de calcularCR comprueba el disparo. vi.hoisted
// iza el spy y el holder por encima de los imports (la factory de vi.mock tambien se iza).
const { calcularCRSpy, holder } = vi.hoisted(() => {
  const spy = vi.fn(async () => {});
  return {
    calcularCRSpy: spy,
    holder: {
      estado: {
        calcularCR: spy,
        estadoMotor: "listo" as const,
        calculando: false,
        errores: [],
        ultimoError: null,
      } as UseSolicitarCR,
    },
  };
});
vi.mock("../resultados/useSolicitarCR", () => ({
  useSolicitarCR: (): UseSolicitarCR => holder.estado,
  calcularCR: (...args: unknown[]) => calcularCRSpy(...(args as [])),
}));

// Imports del SUT y de los stores DESPUES del mock (orden de legibilidad; ESM los hoistea,
// pero el mock ya esta registrado por vi.mock hoisting).
import { CentroRigidez } from "./CentroRigidez";
import { modeloStore, vistaStore, crStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

// Modelo con UN grupo + una planta (para resolver nombre/cota de la planta activa). No
// hace falta geometria real: el CR a mostrar se inyecta por crStore.
function modeloConPlanta(): Modelo {
  const m = crearModeloVacio();
  m.grupos.push({
    id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 0,
  });
  m.plantas.push({ id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" });
  return m;
}

// Construye un ResultadosCR con UNA planta. ex/ey null => sin excentricidad (sin masa).
function crDe(
  plantaId: string,
  datos: { x: number | null; y: number | null; ex: number | null; ey: number | null },
): ResultadosCR {
  return {
    units: "kN-m",
    analysis: { type: "centroRigidez" },
    cr_por_planta: { [plantaId]: datos },
  };
}

beforeEach(() => {
  calcularCRSpy.mockClear();
  holder.estado = {
    calcularCR: calcularCRSpy,
    estadoMotor: "listo",
    calculando: false,
    errores: [],
    ultimoError: null,
  };
  modeloStore.getState().cargarModelo(crearModeloVacio());
  // cargarModelo ya descarta el crStore; reset explicito por claridad.
  crStore.getState().descartar();
  // Estado de vista por defecto del CR: planta activa null, modo planta, toggle off.
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setMostrarCentroRigidez(false);
  vistaStore.getState().setPlantaActiva(null);
});

describe("CentroRigidez · visibilidad del control", () => {
  it("no se renderiza fuera de vista planta (3D)", () => {
    vistaStore.getState().setModoVista("3d");
    render(<CentroRigidez />);
    expect(screen.queryByText("Centro de rigidez")).toBeNull();
  });

  it("en vista planta muestra el control con el toggle APAGADO por defecto", () => {
    render(<CentroRigidez />);
    expect(screen.getByText("Centro de rigidez")).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: "Mostrar centro de rigidez" });
    expect(toggle).not.toBeChecked();
  });

  it("con el toggle apagado NO muestra el disparador ni el panel", () => {
    render(<CentroRigidez />);
    expect(
      screen.queryByRole("button", { name: /Calcular centro de rigidez/i }),
    ).toBeNull();
    expect(screen.queryByText(/diafragma rígido/i)).toBeNull();
  });

  it("el toggle escribe el estado en vistaStore (compartido con el sceneOverlay)", () => {
    render(<CentroRigidez />);
    expect(vistaStore.getState().mostrarCentroRigidez).toBe(false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mostrar centro de rigidez" }),
    );
    expect(vistaStore.getState().mostrarCentroRigidez).toBe(true);
  });
});

describe("CentroRigidez · disparador del calculo", () => {
  it("con el toggle encendido muestra el boton 'Calcular centro de rigidez' habilitado", () => {
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(
      screen.getByRole("button", { name: /Calcular centro de rigidez/i }),
    ).toBeEnabled();
  });

  it("pulsar el boton dispara calcularCR", () => {
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    fireEvent.click(
      screen.getByRole("button", { name: /Calcular centro de rigidez/i }),
    );
    expect(calcularCRSpy).toHaveBeenCalledTimes(1);
  });

  it("con el motor cargando, el boton se deshabilita y rotula 'Cargando motor…'", () => {
    holder.estado = { ...holder.estado, estadoMotor: "cargando" };
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(screen.getByRole("button", { name: /Cargando motor/i })).toBeDisabled();
  });

  it("mientras calcula, el boton rotula 'Calculando…' y se deshabilita", () => {
    holder.estado = { ...holder.estado, calculando: true };
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(screen.getByRole("button", { name: /Calculando/i })).toBeDisabled();
  });

  it("tras un fallo del motor, muestra el mensaje y el boton rotula 'Reintentar'", () => {
    holder.estado = {
      ...holder.estado,
      estadoMotor: "error",
      ultimoError: { fase: "calculo", mensaje: "El modelo base no está sujeto." },
    };
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(screen.getByText(/no está sujeto/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/i })).toBeEnabled();
  });

  it("muestra los errores de obra del ultimo intento (lenguaje de obra)", () => {
    const err: ErrorObra = {
      codigo: "SIN_SUJECION",
      severidad: "error",
      mensaje: "La estructura no está sujeta: añade un pilar con arranque.",
    };
    holder.estado = { ...holder.estado, errores: [err] };
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(screen.getByText(/no está sujeta/i)).toBeInTheDocument();
  });
});

describe("CentroRigidez · panel de datos", () => {
  it("con el toggle encendido pero sin CR calculado muestra el estado vacio", () => {
    modeloStore.getState().cargarModelo(modeloConPlanta());
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(screen.getByText(/Aún no se ha calculado/i)).toBeInTheDocument();
    // No hay filas de coords.
    expect(screen.queryByText("X")).toBeNull();
  });

  it("con CR determinable muestra X/Y (mono) y la excentricidad al CM", () => {
    modeloStore.getState().cargarModelo(modeloConPlanta());
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().setMostrarCentroRigidez(true);
    crStore.getState().setCR(crDe("p1", { x: 2.5, y: 4.25, ex: 0.5, ey: -0.75 }));
    render(<CentroRigidez />);

    expect(screen.getByText("Planta 1")).toBeInTheDocument();
    expect(screen.getByText("2.50 m")).toBeInTheDocument();
    expect(screen.getByText("4.25 m")).toBeInTheDocument();
    // Excentricidad (CM - CR) presente con su rotulo de seccion.
    expect(screen.getByText(/Excentricidad al centro de masas/i)).toBeInTheDocument();
    expect(screen.getByText("0.50 m")).toBeInTheDocument();
    expect(screen.getByText("-0.75 m")).toBeInTheDocument();
  });

  it("CM null (ex/ey null): muestra X/Y pero NO la excentricidad", () => {
    modeloStore.getState().cargarModelo(modeloConPlanta());
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().setMostrarCentroRigidez(true);
    crStore.getState().setCR(crDe("p1", { x: 2.5, y: 4.25, ex: null, ey: null }));
    render(<CentroRigidez />);

    expect(screen.getByText("2.50 m")).toBeInTheDocument();
    // Sin masa permanente -> sin excentricidad.
    expect(screen.queryByText(/Excentricidad al centro de masas/i)).toBeNull();
  });

  it("planta no determinable (x/y null): muestra el mensaje en lenguaje de obra", () => {
    modeloStore.getState().cargarModelo(modeloConPlanta());
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().setMostrarCentroRigidez(true);
    crStore.getState().setCR(crDe("p1", { x: null, y: null, ex: null, ey: null }));
    render(<CentroRigidez />);

    expect(
      screen.getByText(/No se puede determinar el centro de rigidez/i),
    ).toBeInTheDocument();
    // No se pintan coords.
    expect(screen.queryByText("X")).toBeNull();
  });
});

describe("CentroRigidez · etiqueta de hipotesis (obligatoria)", () => {
  it("con el panel abierto SIEMPRE indica que supone diafragma rígido por planta", () => {
    vistaStore.getState().setMostrarCentroRigidez(true);
    render(<CentroRigidez />);
    expect(screen.getByText(/diafragma rígido por planta/i)).toBeInTheDocument();
  });
});
