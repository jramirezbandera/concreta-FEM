// Tests del gating por herramienta del picking de pilares (feature-11, Tarea 2.2).
//
// El clic real sobre el InstancedMesh requiere WebGL/raycaster (no disponible en
// jsdom), por lo que NO renderizamos la escena. En su lugar ejercitamos el handler
// `clicSeleccionPilar`, que encapsula la unica logica nueva: respetar la
// herramienta activa de vistaStore. Verificamos contra los stores reales que:
//   - en modo "seleccion" el clic fija seleccion unica (y shift alterna),
//   - en modo "pilar" el clic NO selecciona (la colocacion tiene prioridad).
// Asi se cubre la decision load-bearing sin tocar three.js.
import { describe, it, expect, beforeEach } from "vitest";
import { clicSeleccionPilar } from "./GeometriaModelo";
import { seleccionStore, vistaStore } from "../../estado";

beforeEach(() => {
  seleccionStore.getState().limpiar();
  seleccionStore.getState().setHover(null);
  vistaStore.getState().setHerramienta("seleccion");
});

describe("clicSeleccionPilar: gating por herramienta activa", () => {
  it("en modo 'seleccion' fija seleccion unica", () => {
    clicSeleccionPilar("P1", false);
    expect(seleccionStore.getState().seleccion).toEqual(["P1"]);

    // Otro clic (sin shift) reemplaza: sigue siendo seleccion unica.
    clicSeleccionPilar("P2", false);
    expect(seleccionStore.getState().seleccion).toEqual(["P2"]);
  });

  it("en modo 'seleccion' con shift alterna (multiseleccion explicita)", () => {
    clicSeleccionPilar("P1", false);
    clicSeleccionPilar("P2", true);
    expect(seleccionStore.getState().seleccion.sort()).toEqual(["P1", "P2"]);

    // Shift sobre uno ya seleccionado lo quita.
    clicSeleccionPilar("P1", true);
    expect(seleccionStore.getState().seleccion).toEqual(["P2"]);
  });

  it("en modo 'pilar' NO selecciona (prioridad de la colocacion)", () => {
    vistaStore.getState().setHerramienta("pilar");
    clicSeleccionPilar("P1", false);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });

  it("en modo 'pilar' NO altera una seleccion previa", () => {
    clicSeleccionPilar("P1", false); // modo seleccion
    vistaStore.getState().setHerramienta("pilar");
    clicSeleccionPilar("P2", false);
    expect(seleccionStore.getState().seleccion).toEqual(["P1"]);
  });
});
