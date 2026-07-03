// [D14 · PR3] Tests del slice DockUIState de vistaStore. Project `node` (estado puro, sin
// React). Verifica: colapso del dock entero, colapso por sección/pestaña (clave compuesta),
// que el colapso de una sección homónima NO interfiere entre pestañas, y el reset.
import { describe, it, expect, beforeEach } from "vitest";
import { vistaStore, claveSeccionDock } from "./vistaStore";

beforeEach(() => {
  vistaStore.getState().resetDockUI();
});

describe("vistaStore · DockUIState (D14)", () => {
  it("arranca con el dock abierto y sin secciones colapsadas", () => {
    const { dockUI } = vistaStore.getState();
    expect(dockUI.dockColapsado).toBe(false);
    expect(dockUI.seccionesColapsadas).toEqual({});
  });

  it("toggleDockColapsado conmuta el colapso del dock entero", () => {
    vistaStore.getState().toggleDockColapsado();
    expect(vistaStore.getState().dockUI.dockColapsado).toBe(true);
    vistaStore.getState().toggleDockColapsado();
    expect(vistaStore.getState().dockUI.dockColapsado).toBe(false);
  });

  it("setDockColapsado fija el estado", () => {
    vistaStore.getState().setDockColapsado(true);
    expect(vistaStore.getState().dockUI.dockColapsado).toBe(true);
  });

  it("toggleSeccionDock colapsa/expande una sección (default abierta)", () => {
    vistaStore.getState().toggleSeccionDock("resultados", "reacciones");
    const clave = claveSeccionDock("resultados", "reacciones");
    expect(vistaStore.getState().dockUI.seccionesColapsadas[clave]).toBe(true);
    vistaStore.getState().toggleSeccionDock("resultados", "reacciones");
    expect(vistaStore.getState().dockUI.seccionesColapsadas[clave]).toBe(false);
  });

  it("el colapso es POR pestaña: 'inspector' en pilares no afecta al de vigas", () => {
    vistaStore.getState().setSeccionDockColapsada("entradaPilares", "inspector", true);
    const clavePilares = claveSeccionDock("entradaPilares", "inspector");
    const claveVigas = claveSeccionDock("entradaVigas", "inspector");
    expect(vistaStore.getState().dockUI.seccionesColapsadas[clavePilares]).toBe(true);
    // La misma sección en otra pestaña sigue abierta (ausente = abierta).
    expect(vistaStore.getState().dockUI.seccionesColapsadas[claveVigas]).toBeUndefined();
  });

  it("el colapso PERSISTE al cambiar de pestaña (no se toca al navegar)", () => {
    vistaStore.getState().setSeccionDockColapsada("resultados", "diagramas", true);
    // Cambiar de pestaña no toca el dockUI.
    vistaStore.getState().setPestanaActiva("entradaVigas");
    vistaStore.getState().setPestanaActiva("resultados");
    const clave = claveSeccionDock("resultados", "diagramas");
    expect(vistaStore.getState().dockUI.seccionesColapsadas[clave]).toBe(true);
  });

  it("resetDockUI vuelve al estado inicial (dock abierto, secciones abiertas)", () => {
    vistaStore.getState().setDockColapsado(true);
    vistaStore.getState().setSeccionDockColapsada("resultados", "reacciones", true);
    vistaStore.getState().resetDockUI();
    const { dockUI } = vistaStore.getState();
    expect(dockUI.dockColapsado).toBe(false);
    expect(dockUI.seccionesColapsadas).toEqual({});
  });
});
