// Test del PanelHerramientaPilar (hueco de cobertura detectado en el review de
// ingenieria de feature-11: el panel de creacion no tenia red de seguridad).
// Project `jsdom`, RTL. Cubre lo que el flujo integrado NO toca: visibilidad por
// herramienta, la PRESELECCION de defaults al activar la herramienta, el commit del
// angulo (incluida la guarda de NaN que conserva el valor) y el boton Terminar.
//
// No se interactua con los Radix Select (SelectSeccion/Material): su comportamiento
// esta cubierto en Select*.test; aqui solo importa que el panel los cablea a
// setDefaultsPilar, lo que se verifica via la preseleccion. Polyfills de Radix por
// si el render del trigger los toca (patron estandar, ver SelectSeccion.test).
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelHerramientaPilar } from "./PanelHerramientaPilar";
import { vistaStore, modeloStore } from "../../estado";
import { listarSecciones, DEFAULT_MATERIAL_ID } from "../../biblioteca";
import { crearModeloVacio } from "../../dominio";

// D4+D5: el default de pilar es la seccion de OBRA sembrada (HA 30×30, id opaco fijo),
// no el primer perfil del catalogo; el material default es HA-25.
const SECCION_DEFAULT_PILAR = "sec-default-pilar";
const PRIMER_MATERIAL = DEFAULT_MATERIAL_ID;
// Para "respeta lo ya elegido": un perfil del catalogo (distinto de la default de obra).
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
  v.setDefaultsPilar({
    seccionId: null,
    materialId: null,
    arranque: "empotrado",
    vinculacionExterior: true,
    angulo: 0,
  });
});

describe("PanelHerramientaPilar", () => {
  it("no se renderiza fuera del modo 'pilar'", () => {
    vistaStore.getState().setHerramienta("seleccion");
    render(<PanelHerramientaPilar />);
    expect(screen.queryByText("Nuevo pilar")).not.toBeInTheDocument();
  });

  it("se renderiza al activar la herramienta 'pilar'", () => {
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaPilar />);
    expect(screen.getByText("Nuevo pilar")).toBeInTheDocument();
  });

  it("preselecciona la sección de obra por defecto (hormigón) y el material HA-25 (D4)", () => {
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaPilar />);
    const d = vistaStore.getState().defaultsPilar;
    // La default es la seccion de OBRA sembrada (HA 30×30), no el primer perfil.
    expect(d.seccionId).toBe(SECCION_DEFAULT_PILAR);
    expect(d.materialId).toBe(PRIMER_MATERIAL);
  });

  it("respeta una sección ya elegida y solo rellena lo que falta", () => {
    // El usuario ya tenia una seccion fijada (de una sesion previa): no se pisa.
    vistaStore.getState().setDefaultsPilar({ seccionId: OTRA_SECCION });
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaPilar />);
    const d = vistaStore.getState().defaultsPilar;
    expect(d.seccionId).toBe(OTRA_SECCION); // conservada
    expect(d.materialId).toBe(PRIMER_MATERIAL); // rellenada
  });

  it("commitea el ángulo en blur a los defaults", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaPilar />);
    const input = screen.getByLabelText("Ángulo");
    await user.clear(input);
    await user.type(input, "45");
    await user.tab();
    expect(vistaStore.getState().defaultsPilar.angulo).toBe(45);
  });

  it("conserva el ángulo actual si el campo se deja vacío (no fija NaN)", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setDefaultsPilar({ angulo: 30 });
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaPilar />);
    const input = screen.getByLabelText("Ángulo");
    await user.clear(input);
    await user.tab();
    const a = vistaStore.getState().defaultsPilar.angulo;
    expect(a).toBe(30);
    expect(Number.isNaN(a)).toBe(false);
  });

  it("el botón Terminar vuelve a la herramienta de selección y oculta el panel", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pilar");
    render(<PanelHerramientaPilar />);
    await user.click(screen.getByRole("button", { name: "Terminar" }));
    expect(vistaStore.getState().herramienta).toBe("seleccion");
    expect(screen.queryByText("Nuevo pilar")).not.toBeInTheDocument();
  });
});
