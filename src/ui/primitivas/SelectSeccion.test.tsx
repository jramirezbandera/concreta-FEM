// Tests de componente de SelectSeccion (feature-11, T3.1). RTL en el project
// `jsdom`. SelectSeccion une dos familias de opciones: el catalogo FIJO de la
// biblioteca (`listarSecciones()`, perfiles IPE/HEB) y las secciones PARAMETRICAS
// de la obra (`modelo.secciones`, leidas por suscripcion ligera al modeloStore).
// Verifican: placeholder con valor null, render de opciones de catalogo + obra,
// etiqueta legible derivada para secciones de obra, y onCambio con el id correcto.
//
// Nota jsdom/Radix: el listbox se abre por TECLADO (foco + Enter), estable bajo
// jsdom con los polyfills de PointerCapture/scrollIntoView; un click ademas de
// Enter lo cerraria por toggle. El modeloStore es singleton de modulo -> reset
// en beforeEach.
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectSeccion } from "./SelectSeccion";
import { listarSecciones } from "../../biblioteca";
import { modeloStore } from "../../estado";
import { crearModeloVacio, type Seccion } from "../../dominio";

// jsdom no implementa la PointerCapture API ni scrollIntoView, de las que depende
// Radix Select al abrir el listbox. Se rellenan como no-ops (patron estandar para
// testar Radix Select bajo jsdom) para poder ejercitar el flujo de apertura/seleccion.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Construye un modelo con un conjunto de secciones de obra dado.
function modeloConSecciones(secciones: Seccion[]) {
  const m = crearModeloVacio();
  return { ...m, secciones };
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
});

describe("SelectSeccion", () => {
  it("con valor null muestra el placeholder 'Sección…'", () => {
    render(<SelectSeccion valor={null} onCambio={() => {}} />);
    expect(screen.getByText("Sección…")).toBeInTheDocument();
  });

  it("usa 'Sección' como aria-label por defecto y respeta la etiqueta dada", () => {
    const { rerender } = render(<SelectSeccion valor={null} onCambio={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Sección" })).toBeInTheDocument();
    rerender(<SelectSeccion valor={null} onCambio={() => {}} etiqueta="Sección del pilar" />);
    expect(
      screen.getByRole("combobox", { name: "Sección del pilar" }),
    ).toBeInTheDocument();
  });

  it("al abrir lista las opciones del catalogo (perfiles) y onCambio recibe el id", async () => {
    const user = userEvent.setup();
    const onCambio = vi.fn();
    render(<SelectSeccion valor={null} onCambio={onCambio} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    const primerPerfil = listarSecciones()[0];
    expect(within(listbox).getByText(primerPerfil.nombre)).toBeInTheDocument();

    await user.click(within(listbox).getByText(primerPerfil.nombre));
    expect(onCambio).toHaveBeenCalledWith(primerPerfil.id);
  });

  it("incluye las secciones parametricas de la obra con su 'nombre' legible", async () => {
    // Seccion de obra CON nombre propio: gana sobre la derivacion por tipo.
    modeloStore.getState().cargarModelo(
      modeloConSecciones([
        { id: "sec-pilar-30x50", nombre: "Pilar 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
      ]),
    );
    const user = userEvent.setup();
    const onCambio = vi.fn();
    render(<SelectSeccion valor={null} onCambio={onCambio} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Pilar 30x50"));
    expect(onCambio).toHaveBeenCalledWith("sec-pilar-30x50");
  });

  it("deriva una etiqueta legible (mm) para una seccion de obra sin nombre", async () => {
    // Sin `nombre`: se deriva "Rectangular 300×500" (m interno -> mm en UI).
    modeloStore.getState().cargarModelo(
      modeloConSecciones([
        { id: "sec-rect", nombre: "", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
      ]),
    );
    const user = userEvent.setup();
    render(<SelectSeccion valor={null} onCambio={() => {}} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Rectangular 300×500")).toBeInTheDocument();
  });

  it("deriva la etiqueta de una seccion circular de obra sin nombre", async () => {
    modeloStore.getState().cargarModelo(
      modeloConSecciones([
        { id: "sec-circ", nombre: "", tipo: "hormigonCircular", d: 0.4 },
      ]),
    );
    const user = userEvent.setup();
    render(<SelectSeccion valor={null} onCambio={() => {}} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Circular Ø400")).toBeInTheDocument();
  });
});
