// Test del PanelHerramientaPano (F3, T3.2). Espejo del de PanelHerramientaViga.
// Project `jsdom`, RTL. Cubre: visibilidad por herramienta, preseleccion del material al
// activar, el cambio del apoyo de borde (Segmentado/radio), la edicion del espesor en mm
// (CampoLongitudMm, conversion mm->m en el borde) y el boton Terminar. Polyfills de Radix
// por si el render del trigger del Select los toca.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelHerramientaPano } from "./PanelHerramientaPano";
import { vistaStore } from "../../estado";
import { listarMateriales } from "../../biblioteca";

const PRIMER_MATERIAL = listarMateriales()[0]!.id;

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  const v = vistaStore.getState();
  v.setHerramienta("seleccion");
  v.setDefaultsPano({
    espesor: 0.25,
    materialId: null,
    tamMalla: 0.5,
    bordeApoyo: "simple",
  });
});

describe("PanelHerramientaPano", () => {
  it("no se renderiza fuera del modo 'pano'", () => {
    vistaStore.getState().setHerramienta("seleccion");
    render(<PanelHerramientaPano />);
    expect(screen.queryByText("Nuevo paño")).not.toBeInTheDocument();
  });

  it("no se renderiza en el modo 'viga'", () => {
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaPano />);
    expect(screen.queryByText("Nuevo paño")).not.toBeInTheDocument();
  });

  it("se renderiza al activar la herramienta 'pano'", () => {
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    expect(screen.getByText("Nuevo paño")).toBeInTheDocument();
  });

  it("preselecciona el primer material del catalogo al activarse (material vacio)", () => {
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    expect(vistaStore.getState().defaultsPano.materialId).toBe(PRIMER_MATERIAL);
  });

  it("muestra el espesor por defecto en mm (0.25 m -> 250 mm)", () => {
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    const espesor = screen.getByLabelText("Espesor") as HTMLInputElement;
    expect(espesor.value).toBe("250");
  });

  it("editar el espesor en mm lo guarda en m (300 mm -> 0.3 m)", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    const espesor = screen.getByLabelText("Espesor") as HTMLInputElement;
    await user.clear(espesor);
    await user.type(espesor, "300");
    await user.tab();
    expect(vistaStore.getState().defaultsPano.espesor).toBeCloseTo(0.3, 6);
  });

  it("cambiar el apoyo de borde a Empotrado llama a setDefaultsPano", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    const grupo = screen.getByRole("radiogroup", { name: "Apoyo de borde del paño" });
    await user.click(within(grupo).getByRole("radio", { name: "Empotrado" }));
    expect(vistaStore.getState().defaultsPano.bordeApoyo).toBe("empotrado");
  });

  it("el boton Terminar vuelve a la herramienta de seleccion y oculta el panel", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    await user.click(screen.getByRole("button", { name: "Terminar" }));
    expect(vistaStore.getState().herramienta).toBe("seleccion");
    expect(screen.queryByText("Nuevo paño")).not.toBeInTheDocument();
  });
});
