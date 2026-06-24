// Test del hook de arranque de persistencia (feature-15, T4.1). Gobierna el
// arranque de TODA la persistencia de la app: abre DB, asegura proyecto activo,
// rehidrata Modelo + plantillas, arranca AMBOS autosaves atados al mismo
// proyectoId y los da de baja en cleanup. Corre en el project `jsdom` (es un hook
// de React) y MOCKEA el barrel /src/persistencia: ningun test toca IndexedDB real
// ni Pyodide; verificamos la SECUENCIA y el cleanup, no la persistencia en disco.
//
// Invariantes que cubre la auditoria (RESERVA 2):
//   (1) La carga (cargarProyectoEnStore/cargarPlantillasEnStore) ocurre ANTES de
//       arrancar los autosaves (iniciarAutosave/iniciarAutosavePlantillas).
//   (2) Si la DB NO abre, no se arranca ningun autosave (app sigue en memoria).
//   (3) El cleanup da de baja AMBOS autosaves (las bajas devueltas por iniciar*).
//   (4) Reutiliza el proyecto activo existente; solo crea "Obra sin título" si no hay.
import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mock del barrel de persistencia (hoisted antes de importar el SUT) ---
// Cada funcion registra su orden de invocacion en `ordenLlamadas` para asertar la
// secuencia carga-antes-de-autosave sin depender de timers reales. La impl. real
// de cada mock se fija en beforeEach (tras los mockReset), no aqui.
const ordenLlamadas: string[] = [];

const abrirDBMock = vi.fn();
const getProyectoActivoIdMock = vi.fn();
const crearProyectoMock = vi.fn();
const cargarProyectoEnStoreMock = vi.fn();
const cargarPlantillasEnStoreMock = vi.fn();
// Las bajas que devuelven los iniciar* — el cleanup debe invocarlas ambas.
const bajaModeloMock = vi.fn();
const bajaPlantillasMock = vi.fn();
const iniciarAutosaveMock = vi.fn();
const iniciarAutosavePlantillasMock = vi.fn();

vi.mock("../../persistencia", () => ({
  abrirDB: () => abrirDBMock(),
  getProyectoActivoId: () => getProyectoActivoIdMock(),
  crearProyecto: (n: string) => crearProyectoMock(n),
  cargarProyectoEnStore: (id: string) => cargarProyectoEnStoreMock(id),
  cargarPlantillasEnStore: (id: string) => cargarPlantillasEnStoreMock(id),
  iniciarAutosave: () => iniciarAutosaveMock(),
  iniciarAutosavePlantillas: (id: string) => iniciarAutosavePlantillasMock(id),
}));

import { renderHook, waitFor } from "@testing-library/react";
import { useArranquePersistencia } from "./useArranquePersistencia";

beforeEach(() => {
  ordenLlamadas.length = 0;
  // mockReset borra historial e impl.; re-registramos la impl. por defecto del
  // camino feliz (proyecto activo existente, DB abre, cargas y autosaves OK).
  abrirDBMock.mockReset().mockImplementation(async () => {
    ordenLlamadas.push("abrirDB");
    return { ok: true };
  });
  getProyectoActivoIdMock.mockReset().mockImplementation(async () => {
    ordenLlamadas.push("getProyectoActivoId");
    return "proy-existente";
  });
  crearProyectoMock.mockReset().mockImplementation(async (nombre: string) => {
    ordenLlamadas.push(`crearProyecto:${nombre}`);
    return { id: "proy-nuevo" };
  });
  cargarProyectoEnStoreMock.mockReset().mockImplementation(async (id: string) => {
    ordenLlamadas.push(`cargarProyectoEnStore:${id}`);
    return { ok: true };
  });
  cargarPlantillasEnStoreMock
    .mockReset()
    .mockImplementation(async (id: string) => {
      ordenLlamadas.push(`cargarPlantillasEnStore:${id}`);
    });
  iniciarAutosaveMock.mockReset().mockImplementation(() => {
    ordenLlamadas.push("iniciarAutosave");
    return bajaModeloMock;
  });
  iniciarAutosavePlantillasMock.mockReset().mockImplementation((id: string) => {
    ordenLlamadas.push(`iniciarAutosavePlantillas:${id}`);
    return bajaPlantillasMock;
  });
  bajaModeloMock.mockReset();
  bajaPlantillasMock.mockReset();
});

describe("useArranquePersistencia · (1) orden carga-antes-de-autosave", () => {
  it("carga Modelo y plantillas ANTES de arrancar los autosaves", async () => {
    renderHook(() => useArranquePersistencia());

    await waitFor(() => {
      expect(iniciarAutosavePlantillasMock).toHaveBeenCalled();
    });

    // Ambas cargas se invocaron antes que ambos arranques de autosave.
    const iCargaModelo = ordenLlamadas.indexOf(
      "cargarProyectoEnStore:proy-existente",
    );
    const iCargaPlant = ordenLlamadas.indexOf(
      "cargarPlantillasEnStore:proy-existente",
    );
    const iAutosave = ordenLlamadas.indexOf("iniciarAutosave");
    const iAutosavePlant = ordenLlamadas.indexOf(
      "iniciarAutosavePlantillas:proy-existente",
    );

    expect(iCargaModelo).toBeGreaterThanOrEqual(0);
    expect(iCargaPlant).toBeGreaterThanOrEqual(0);
    expect(iAutosave).toBeGreaterThan(iCargaModelo);
    expect(iAutosave).toBeGreaterThan(iCargaPlant);
    expect(iAutosavePlant).toBeGreaterThan(iCargaModelo);
    expect(iAutosavePlant).toBeGreaterThan(iCargaPlant);
  });

  it("ata ambos autosaves al MISMO proyectoId que se cargo", async () => {
    renderHook(() => useArranquePersistencia());

    await waitFor(() => {
      expect(iniciarAutosavePlantillasMock).toHaveBeenCalled();
    });

    expect(cargarProyectoEnStoreMock).toHaveBeenCalledWith("proy-existente");
    expect(cargarPlantillasEnStoreMock).toHaveBeenCalledWith("proy-existente");
    expect(iniciarAutosavePlantillasMock).toHaveBeenCalledWith("proy-existente");
  });
});

describe("useArranquePersistencia · (2) DB no disponible", () => {
  it("si abrirDB falla, NO arranca ningun autosave ni carga nada", async () => {
    abrirDBMock.mockImplementation(async () => {
      ordenLlamadas.push("abrirDB");
      return { ok: false, motivo: "IndexedDB no disponible" };
    });

    renderHook(() => useArranquePersistencia());

    // Dar tiempo a que la fase async habria arrancado los autosaves si no abortara.
    await waitFor(() => {
      expect(abrirDBMock).toHaveBeenCalled();
    });
    // Microtask flush para asegurar que nada posterior se encolo.
    await Promise.resolve();

    expect(cargarProyectoEnStoreMock).not.toHaveBeenCalled();
    expect(cargarPlantillasEnStoreMock).not.toHaveBeenCalled();
    expect(iniciarAutosaveMock).not.toHaveBeenCalled();
    expect(iniciarAutosavePlantillasMock).not.toHaveBeenCalled();
  });
});

describe("useArranquePersistencia · (5) carga de proyecto fallida (#9)", () => {
  it("si cargarProyectoEnStore falla, NO arranca autosaves ni carga plantillas", async () => {
    // Proyecto activo corrupto / no cargable: arrancar el autosave del Modelo lo
    // machacaria con el modelo vacio en memoria (perdida de datos). No se arranca.
    cargarProyectoEnStoreMock.mockImplementation(async (id: string) => {
      ordenLlamadas.push(`cargarProyectoEnStore:${id}`);
      return { ok: false, errores: ["modelo corrupto"] };
    });

    renderHook(() => useArranquePersistencia());

    await waitFor(() => {
      expect(cargarProyectoEnStoreMock).toHaveBeenCalled();
    });
    // Microtask flush: nada posterior debe haberse encolado.
    await Promise.resolve();

    expect(cargarPlantillasEnStoreMock).not.toHaveBeenCalled();
    expect(iniciarAutosaveMock).not.toHaveBeenCalled();
    expect(iniciarAutosavePlantillasMock).not.toHaveBeenCalled();
  });
});

describe("useArranquePersistencia · (3) cleanup da de baja ambos autosaves", () => {
  it("al desmontar, invoca las bajas de Modelo y plantillas", async () => {
    const { unmount } = renderHook(() => useArranquePersistencia());

    await waitFor(() => {
      expect(iniciarAutosavePlantillasMock).toHaveBeenCalled();
    });

    expect(bajaModeloMock).not.toHaveBeenCalled();
    expect(bajaPlantillasMock).not.toHaveBeenCalled();

    unmount();

    expect(bajaModeloMock).toHaveBeenCalledTimes(1);
    expect(bajaPlantillasMock).toHaveBeenCalledTimes(1);
  });
});

describe("useArranquePersistencia · (4) proyecto activo: reutilizar vs crear", () => {
  it("reutiliza el proyecto activo existente (no crea uno nuevo)", async () => {
    getProyectoActivoIdMock.mockImplementation(async () => {
      ordenLlamadas.push("getProyectoActivoId");
      return "proy-existente";
    });

    renderHook(() => useArranquePersistencia());

    await waitFor(() => {
      expect(cargarProyectoEnStoreMock).toHaveBeenCalled();
    });

    expect(crearProyectoMock).not.toHaveBeenCalled();
    expect(cargarProyectoEnStoreMock).toHaveBeenCalledWith("proy-existente");
  });

  it("crea 'Obra sin título' solo cuando no hay proyecto activo", async () => {
    getProyectoActivoIdMock.mockImplementation(async () => {
      ordenLlamadas.push("getProyectoActivoId");
      return undefined;
    });

    renderHook(() => useArranquePersistencia());

    await waitFor(() => {
      expect(cargarProyectoEnStoreMock).toHaveBeenCalled();
    });

    expect(crearProyectoMock).toHaveBeenCalledTimes(1);
    expect(crearProyectoMock).toHaveBeenCalledWith("Obra sin título");
    // El proyecto recien creado es al que se atan carga y autosaves.
    expect(cargarProyectoEnStoreMock).toHaveBeenCalledWith("proy-nuevo");
    expect(iniciarAutosavePlantillasMock).toHaveBeenCalledWith("proy-nuevo");
  });
});
