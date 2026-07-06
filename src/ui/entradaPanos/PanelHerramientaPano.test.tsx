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
import { DEFAULT_MATERIAL_ID } from "../../biblioteca";

// D4+D5: el material default de la losa pasa a HA-25 (hormigon, coherente con el MVP),
// no el primer material del catalogo (S235).
const PRIMER_MATERIAL = DEFAULT_MATERIAL_ID;

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
    tipo: "losa",
    espesor: 0.25,
    materialId: null,
    tamMalla: 0.5,
    bordeApoyo: "simple",
    direccionViguetas: "x",
    intereje: 0.7,
    canto: 0.3,
    anchoNervio: 0.12,
    pesoPropio: 4,
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

  it("preselecciona el material por defecto HA-25 al activarse (material vacio) (D4)", () => {
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

  it("UX-C9 (F3.2): comunica ANTES de colocar que la losa descarga en el contorno compartido", () => {
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    expect(
      screen.getByText(/descarga en las vigas y pilares de su contorno/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no se transmite a pilares ni vigas/i)).toBeNull();
  });
});

// --- Selector de tipo y campos condicionales del forjado unidireccional (T4.1) ---

describe("PanelHerramientaPano: tipo de forjado", () => {
  it("ofrece el selector de tipo con Losa maciza y Unidireccional (no reticular)", () => {
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    const grupo = screen.getByRole("radiogroup", { name: "Tipo de forjado" });
    expect(within(grupo).getByRole("radio", { name: "Losa maciza" })).toBeInTheDocument();
    expect(within(grupo).getByRole("radio", { name: "Unidireccional" })).toBeInTheDocument();
    expect(within(grupo).queryByRole("radio", { name: /reticular/i })).toBeNull();
  });

  it("cambiar el tipo a Unidireccional fija defaultsPano.tipo", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    const grupo = screen.getByRole("radiogroup", { name: "Tipo de forjado" });
    await user.click(within(grupo).getByRole("radio", { name: "Unidireccional" }));
    expect(vistaStore.getState().defaultsPano.tipo).toBe("unidireccional");
  });

  it("en LOSA muestra Espesor y Tamaño de malla y oculta los campos de vigueta", () => {
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    expect(screen.getByLabelText("Espesor")).toBeInTheDocument();
    expect(screen.getByLabelText("Tamaño de malla")).toBeInTheDocument();
    expect(screen.queryByLabelText("Intereje")).toBeNull();
    expect(screen.queryByText("Dirección de viguetas")).toBeNull();
  });

  it("en UNIDIRECCIONAL muestra los campos de vigueta y oculta Espesor/Tamaño de malla", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Tipo de forjado" })).getByRole("radio", {
        name: "Unidireccional",
      }),
    );
    // Campos uni presentes.
    expect(screen.getByText("Dirección de viguetas")).toBeInTheDocument();
    expect(screen.getByLabelText("Intereje")).toBeInTheDocument();
    expect(screen.getByLabelText("Canto")).toBeInTheDocument();
    expect(screen.getByLabelText("Ancho de nervio")).toBeInTheDocument();
    expect(screen.getByLabelText("Peso propio")).toBeInTheDocument();
    // Campos de losa ocultos.
    expect(screen.queryByLabelText("Espesor")).toBeNull();
    expect(screen.queryByLabelText("Tamaño de malla")).toBeNull();
  });

  it("editar el intereje (mm) lo guarda en m en defaultsPano (700 mm -> 0.7 m)", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    vistaStore.getState().setDefaultsPano({ tipo: "unidireccional" });
    render(<PanelHerramientaPano />);
    const intereje = screen.getByLabelText("Intereje") as HTMLInputElement;
    await user.clear(intereje);
    await user.type(intereje, "800");
    await user.tab();
    expect(vistaStore.getState().defaultsPano.intereje).toBeCloseTo(0.8, 6);
  });

  it("cambiar la dirección de viguetas a Eje Y fija el default", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    vistaStore.getState().setDefaultsPano({ tipo: "unidireccional" });
    render(<PanelHerramientaPano />);
    const grupo = screen.getByRole("radiogroup", { name: "Dirección de viguetas del forjado" });
    await user.click(within(grupo).getByRole("radio", { name: "Eje Y" }));
    expect(vistaStore.getState().defaultsPano.direccionViguetas).toBe("y");
  });

  it("en LOSA muestra la nota de descarga en el pórtico; en UNI la nota de reparto en una dirección", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    const { rerender } = render(<PanelHerramientaPano />);
    // Losa: nota de descarga en el contorno.
    expect(screen.getByText(/descarga en las vigas y pilares de su contorno/i)).toBeInTheDocument();
    expect(screen.queryByText(/reparte en una dirección/i)).toBeNull();
    // Cambiar a unidireccional -> nota de reparto en una direccion.
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Tipo de forjado" })).getByRole("radio", {
        name: "Unidireccional",
      }),
    );
    rerender(<PanelHerramientaPano />);
    expect(screen.getByText(/reparte en una dirección/i)).toBeInTheDocument();
    expect(screen.getByText(/los bordes paralelos no reciben carga/i)).toBeInTheDocument();
    expect(screen.getByText(/un borde empotrado se comporta como apoyado/i)).toBeInTheDocument();
    expect(screen.getByText(/esfuerzos de cada vigueta aún no se consultan por separado/i)).toBeInTheDocument();
    expect(screen.queryByText(/descarga en las vigas y pilares de su contorno/i)).toBeNull();
  });

  it("la ayuda del peso propio resume el texto del CTE", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setHerramienta("pano");
    render(<PanelHerramientaPano />);
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Tipo de forjado" })).getByRole("radio", {
        name: "Unidireccional",
      }),
    );
    expect(
      screen.getByText(/Peso del forjado completo \(viguetas, bovedillas y capa de compresión\), orientativo según canto \(CTE DB-SE-AE\)/i),
    ).toBeInTheDocument();
  });
});
