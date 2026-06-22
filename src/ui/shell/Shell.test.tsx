// Smoke tests del shell (feature-9, Fase 2.2). RTL en el project `jsdom`.
// Se renderiza el Shell con un children dummy (NO el Viewport real: evita WebGL).
// Los stores Zustand son singletons de modulo -> reset en beforeEach (igual que
// src/estado/stores.test.ts). Verifican: monta sin crash, conmutacion de pestana
// reflejada en vistaStore + menubar contextual, Isovalores deshabilitada, y
// undo/redo deshabilitados con modelo vacio.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "./index";
import { MENUS_POR_PESTANA } from "./menus";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";

// Etiquetas de las solapas (BottomTabs.tsx). Las usamos para localizar triggers.
const TAB_PILARES = "Entrada de pilares";
const TAB_VIGAS = "Entrada de vigas";
const TAB_RESULTADOS = "Resultados";
const TAB_ISOVALORES = "Isovalores";

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPestanaActiva("entradaPilares");
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setGrupoActivo(null);
  vistaStore.getState().setPlantaActiva(null);
});

// Localiza el trigger (boton/role tab) de una solapa por su etiqueta visible.
function tab(etiqueta: string) {
  return screen.getByRole("tab", { name: new RegExp(etiqueta) });
}

describe("Shell: montaje", () => {
  it("monta sin crashear con un children dummy", () => {
    render(
      <Shell>
        <div data-testid="dummy-canvas">lienzo de prueba</div>
      </Shell>,
    );
    expect(screen.getByTestId("dummy-canvas")).toBeInTheDocument();
    // Regiones canonicas presentes (landmarks accesibles).
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Área de trabajo" })).toBeInTheDocument();
  });

  it("muestra el nombre de obra en la brandbar", () => {
    render(
      <Shell nombreObra="Edificio Ejemplo">
        <div />
      </Shell>,
    );
    expect(screen.getByText("Edificio Ejemplo")).toBeInTheDocument();
  });
});

describe("Shell: conmutacion de pestanas", () => {
  it("click en 'Entrada de vigas' actualiza vistaStore.pestanaActiva", async () => {
    const user = userEvent.setup();
    render(
      <Shell>
        <div />
      </Shell>,
    );
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");

    await user.click(tab(TAB_VIGAS));
    expect(vistaStore.getState().pestanaActiva).toBe("entradaVigas");
  });

  it("la menubar refleja el set de menus de la pestana destino", async () => {
    const user = userEvent.setup();
    render(
      <Shell>
        <div />
      </Shell>,
    );
    const nav = screen.getByRole("navigation", { name: "Menú principal" });

    // En "entradaPilares" existe el menu "Introducción" pero NO "Calcular".
    const etiquetasPilares = MENUS_POR_PESTANA.entradaPilares.map((m) => m.etiqueta);
    expect(etiquetasPilares).toContain("Introducción");
    expect(within(nav).getByText("Introducción")).toBeInTheDocument();
    expect(within(nav).queryByText("Calcular")).toBeNull();

    // Al ir a "entradaVigas" aparece "Calcular" (propio de esa pestana) y
    // desaparece "Introducción".
    const etiquetasVigas = MENUS_POR_PESTANA.entradaVigas.map((m) => m.etiqueta);
    expect(etiquetasVigas).toContain("Calcular");
    expect(etiquetasVigas).not.toContain("Introducción");

    await user.click(tab(TAB_VIGAS));
    expect(within(nav).getByText("Calcular")).toBeInTheDocument();
    expect(within(nav).queryByText("Introducción")).toBeNull();
  });

  it("la menubar de 'Resultados' muestra 'Reacciones' y no 'Introducción'", async () => {
    const user = userEvent.setup();
    render(
      <Shell>
        <div />
      </Shell>,
    );
    const nav = screen.getByRole("navigation", { name: "Menú principal" });

    await user.click(tab(TAB_RESULTADOS));
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
    expect(within(nav).getByText("Reacciones")).toBeInTheDocument();
    expect(within(nav).queryByText("Introducción")).toBeNull();
  });
});

describe("Shell: estados deshabilitados", () => {
  it("la solapa 'Isovalores' esta deshabilitada", () => {
    render(
      <Shell>
        <div />
      </Shell>,
    );
    expect(tab(TAB_ISOVALORES)).toBeDisabled();
    // Las operativas no lo estan.
    expect(tab(TAB_PILARES)).toBeEnabled();
    expect(tab(TAB_VIGAS)).toBeEnabled();
  });

  it("undo/redo deshabilitados con modelo vacio (sin historial)", () => {
    render(
      <Shell>
        <div />
      </Shell>,
    );
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rehacer" })).toBeDisabled();
  });
});
