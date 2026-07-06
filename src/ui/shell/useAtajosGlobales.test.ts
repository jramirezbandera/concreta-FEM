// Tests de useAtajosGlobales (auditoria UX-A3/UX-A5). Project `jsdom`. Se dispara
// keydown en window y se verifica: Ctrl+Z -> undo, Ctrl+Y / Ctrl+Shift+Z -> redo, F4 ->
// togglePanelPlantillas, F3 -> capturarViewport; y las guardas (campo editable, diálogo
// abierto) que evitan pisar el undo nativo de los campos.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del barrel del viewport: solo aislamos capturarViewport (F3). No queremos montar
// three.js ni el Canvas en este test de teclado.
const capturarViewportMock = vi.fn();
vi.mock("../viewport", () => ({
  capturarViewport: (...args: unknown[]) => capturarViewportMock(...args),
}));

import { renderHook } from "@testing-library/react";
import { useAtajosGlobales } from "./useAtajosGlobales";
import {
  modeloStore,
  vistaStore,
  seleccionStore,
  crearPlanta,
  crearPilar,
} from "../../estado";
import { crearModeloVacio } from "../../dominio";
import { listarSecciones, listarMateriales } from "../../biblioteca";

const modelo = () => modeloStore.getState().getModelo();

// Siembra un pilar (una edicion en la pila de undo). Devuelve el id del pilar creado.
// Sin grupos (F3.4): una planta directa del edificio.
function sembrarPilar(): string {
  modeloStore.getState().ejecutar(
    crearPlanta(modelo(), {
      cota: 0,
      altura: 3,
      categoriaUso: "A",
      sobrecargaUso: 0,
      cargasMuertas: 0,
    }),
  );
  const plantaId = modelo().plantas[0]!.id;
  modeloStore.getState().ejecutar(
    crearPilar(modelo(), {
      x: 0, y: 0, plantaInicial: plantaId, plantaFinal: plantaId,
      seccionId: listarSecciones()[0]!.id, materialId: listarMateriales()[0]!.id,
      angulo: 0, vinculacionExterior: true, arranque: "empotrado",
    }),
  );
  return modelo().pilares[0]!.id;
}

// Dispara un keydown en window con las teclas dadas. Devuelve el evento (para inspeccionar
// defaultPrevented).
function pulsar(
  key: string,
  mods: { ctrl?: boolean; shift?: boolean; meta?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  capturarViewportMock.mockReset();
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().cerrarDialogo();
  vistaStore.getState().setPanelPlantillas(false);
  vistaStore.getState().setPestanaActiva("entradaPilares");
  seleccionStore.getState().limpiar();
  // Foco fuera de cualquier campo editable.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.body.innerHTML = "";
});

describe("useAtajosGlobales · undo/redo", () => {
  it("Ctrl+Z deshace la última edición de obra", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    expect(modelo().pilares).toHaveLength(1);
    const ev = pulsar("z", { ctrl: true });
    expect(modelo().pilares).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Ctrl+Y rehace la edición deshecha", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    pulsar("z", { ctrl: true });
    expect(modelo().pilares).toHaveLength(0);
    pulsar("y", { ctrl: true });
    expect(modelo().pilares).toHaveLength(1);
  });

  it("Ctrl+Shift+Z también rehace (convención editor)", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    pulsar("z", { ctrl: true });
    pulsar("z", { ctrl: true, shift: true });
    expect(modelo().pilares).toHaveLength(1);
  });

  it("Cmd+Z (metaKey) también deshace (mac)", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    pulsar("z", { meta: true });
    expect(modelo().pilares).toHaveLength(0);
  });
});

describe("useAtajosGlobales · guardas (no pisar el undo nativo)", () => {
  it("IGNORA Ctrl+Z si el foco está en un input (undo nativo del campo)", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const ev = pulsar("z", { ctrl: true });
    // No deshizo la obra ni consumió el evento: el campo conserva su undo nativo.
    expect(modelo().pilares).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("IGNORA los atajos si hay un diálogo modal abierto", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    vistaStore.getState().abrirDialogo("plantas");
    pulsar("z", { ctrl: true });
    expect(modelo().pilares).toHaveLength(1); // no deshizo
    pulsar("f4");
    expect(vistaStore.getState().panelPlantillasAbierto).toBe(false); // no toggeó
  });
});

describe("useAtajosGlobales · F3/F4 (UX-A5)", () => {
  it("F4 conmuta el panel de plantillas", () => {
    renderHook(() => useAtajosGlobales());
    expect(vistaStore.getState().panelPlantillasAbierto).toBe(false);
    const ev = pulsar("F4");
    expect(vistaStore.getState().panelPlantillasAbierto).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    pulsar("F4");
    expect(vistaStore.getState().panelPlantillasAbierto).toBe(false);
  });

  it("F3 dispara la captura del viewport", () => {
    renderHook(() => useAtajosGlobales());
    const ev = pulsar("F3");
    expect(capturarViewportMock).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("useAtajosGlobales · Supr/Delete borra la selección (D23)", () => {
  it("Delete borra el elemento seleccionado (mismo flujo del menú Edición)", () => {
    renderHook(() => useAtajosGlobales());
    const pilarId = sembrarPilar();
    seleccionStore.getState().seleccionar([pilarId]);
    const ev = pulsar("Delete");
    expect(modelo().pilares).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("es no-op sin selección (no toca el modelo)", () => {
    renderHook(() => useAtajosGlobales());
    sembrarPilar();
    pulsar("Delete");
    expect(modelo().pilares).toHaveLength(1);
  });

  it("IGNORA Delete con el foco en un input (borra texto, no la obra)", () => {
    renderHook(() => useAtajosGlobales());
    const pilarId = sembrarPilar();
    seleccionStore.getState().seleccionar([pilarId]);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const ev = pulsar("Delete");
    expect(modelo().pilares).toHaveLength(1); // no borró la obra
    expect(ev.defaultPrevented).toBe(false);
  });

  it("IGNORA Delete con un diálogo modal abierto", () => {
    renderHook(() => useAtajosGlobales());
    const pilarId = sembrarPilar();
    seleccionStore.getState().seleccionar([pilarId]);
    vistaStore.getState().abrirDialogo("plantas");
    pulsar("Delete");
    expect(modelo().pilares).toHaveLength(1);
  });
});

describe("useAtajosGlobales · 1-4 cambian de pestaña (D23)", () => {
  it("1/2/3/4 saltan a pilares/vigas/resultados/isovalores", () => {
    renderHook(() => useAtajosGlobales());
    const ev2 = pulsar("2");
    expect(vistaStore.getState().pestanaActiva).toBe("entradaVigas");
    expect(ev2.defaultPrevented).toBe(true);
    pulsar("3");
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
    pulsar("4");
    expect(vistaStore.getState().pestanaActiva).toBe("isovalores");
    pulsar("1");
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });

  it("IGNORA 1-4 con el foco en un input (escribe dígitos)", () => {
    renderHook(() => useAtajosGlobales());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const ev = pulsar("2");
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares"); // no saltó
    expect(ev.defaultPrevented).toBe(false);
  });

  it("IGNORA 1-4 con un diálogo modal abierto", () => {
    renderHook(() => useAtajosGlobales());
    vistaStore.getState().abrirDialogo("plantas");
    pulsar("3");
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });
});
