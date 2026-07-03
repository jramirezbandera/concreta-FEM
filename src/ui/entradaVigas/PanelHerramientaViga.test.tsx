// Test del PanelHerramientaViga (feature-12, T2.1). Espejo del de
// PanelHerramientaPilar. Project `jsdom`, RTL. Cubre: visibilidad por herramienta,
// la PRESELECCION de defaults al activar la herramienta, el cambio de un campo
// (Extremo / Tirante) que llama a setDefaultsViga, y el boton Terminar.
//
// No se interactua con los Radix Select (SelectSeccion/Material): su comportamiento
// esta cubierto en Select*.test; aqui solo importa que el panel los cablea a
// setDefaultsViga, lo que se verifica via la preseleccion. Polyfills de Radix por
// si el render del trigger los toca (patron estandar, ver SelectSeccion.test).
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelHerramientaViga } from "./PanelHerramientaViga";
import { vistaStore, modeloStore } from "../../estado";
import { listarSecciones, DEFAULT_MATERIAL_ID } from "../../biblioteca";
import { crearModeloVacio } from "../../dominio";

// D4+D5: el default de viga es la seccion de OBRA sembrada (HA 30×50, id opaco fijo),
// no el primer perfil del catalogo; el material default es HA-25.
const SECCION_DEFAULT_VIGA = "sec-default-viga";
const PRIMER_MATERIAL = DEFAULT_MATERIAL_ID;
const OTRA_SECCION = listarSecciones()[0]!.id;

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Reset del estado de herramienta/defaults y del modelo (el panel resuelve la seccion
// default contra modelo.secciones, sembradas por crearModeloVacio).
beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  const v = vistaStore.getState();
  v.setHerramienta("seleccion");
  v.setDefaultsViga({
    seccionId: null,
    materialId: null,
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  });
});

describe("PanelHerramientaViga", () => {
  it("no se renderiza fuera del modo 'viga'", () => {
    vistaStore.getState().setHerramienta("seleccion");
    render(<PanelHerramientaViga />);
    expect(screen.queryByText("Nueva viga")).not.toBeInTheDocument();
  });

  it("no se renderiza en el modo 'pilar'", () => {
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaViga />);
    expect(screen.queryByText("Nueva viga")).not.toBeInTheDocument();
  });

  it("se renderiza al activar la herramienta 'viga'", () => {
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaViga />);
    expect(screen.getByText("Nueva viga")).toBeInTheDocument();
  });

  it("preselecciona la sección de obra por defecto (hormigón) y el material HA-25 (D4)", () => {
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaViga />);
    const d = vistaStore.getState().defaultsViga;
    // La default es la seccion de OBRA sembrada (HA 30×50), no el primer perfil.
    expect(d.seccionId).toBe(SECCION_DEFAULT_VIGA);
    expect(d.materialId).toBe(PRIMER_MATERIAL);
  });

  it("respeta una sección ya elegida y solo rellena lo que falta", () => {
    // El usuario ya tenia una seccion fijada (de una sesion previa): no se pisa.
    vistaStore.getState().setDefaultsViga({ seccionId: OTRA_SECCION });
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaViga />);
    const d = vistaStore.getState().defaultsViga;
    expect(d.seccionId).toBe(OTRA_SECCION); // conservada
    expect(d.materialId).toBe(PRIMER_MATERIAL); // rellenada
  });

  it("cambiar el Extremo I llama a setDefaultsViga", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaViga />);
    // Segmentado (Radix toggle-group `type="single"`) => role radiogroup con items
    // role radio. "Articulado" del grupo "Extremo I" (el "Extremo J" tiene el suyo).
    const grupo = screen.getByRole("radiogroup", { name: "Extremo I" });
    await user.click(within(grupo).getByRole("radio", { name: "Articulado" }));
    expect(vistaStore.getState().defaultsViga.extremoI).toBe("articulado");
  });

  it("cambiar el Tirante a Sí llama a setDefaultsViga", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaViga />);
    const grupo = screen.getByRole("radiogroup", { name: "Tirante" });
    await user.click(within(grupo).getByRole("radio", { name: "Sí" }));
    expect(vistaStore.getState().defaultsViga.tirante).toBe(true);
  });

  it("el botón Terminar vuelve a la herramienta de selección y oculta el panel", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("viga");
    render(<PanelHerramientaViga />);
    await user.click(screen.getByRole("button", { name: "Terminar" }));
    expect(vistaStore.getState().herramienta).toBe("seleccion");
    expect(screen.queryByText("Nueva viga")).not.toBeInTheDocument();
  });
});
