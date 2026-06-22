// Tests de componente de SelectMaterial (feature-11, T3.1). RTL en el project
// `jsdom`. SelectMaterial es una primitiva Radix Select sobre el catalogo de
// materiales de la biblioteca (`listarMateriales()`): etiqueta visible =
// `denominacion`, value = `id`. Verifican: placeholder con valor null, valor
// seleccionado mostrado, render de las opciones del catalogo y disparo de onCambio
// con el id correcto.
//
// Nota jsdom/Radix: abrir el listbox por PUNTERO es inestable (scroll virtual +
// PointerEvent). Por eso se abre con TECLADO (Enter sobre el trigger), que en jsdom
// es estable, y se selecciona el item por su rol/option. Mismo enfoque que el resto
// del repo evita esa fragilidad (ver DialogoGruposYPlantas.test.tsx).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectMaterial } from "./SelectMaterial";
import { listarMateriales } from "../../biblioteca";

// jsdom no implementa la PointerCapture API ni scrollIntoView, de las que depende
// Radix Select al abrir el listbox. Se rellenan como no-ops (patron estandar para
// testar Radix Select bajo jsdom) para poder ejercitar el flujo de apertura/seleccion.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

describe("SelectMaterial", () => {
  it("con valor null muestra el placeholder 'Material…'", () => {
    render(<SelectMaterial valor={null} onCambio={() => {}} />);
    expect(screen.getByText("Material…")).toBeInTheDocument();
  });

  it("con valor muestra la denominacion del material seleccionado", () => {
    render(<SelectMaterial valor="S275" onCambio={() => {}} />);
    // El trigger muestra la denominacion (== id para aceros), no el placeholder.
    expect(screen.getByRole("combobox")).toHaveTextContent("S275");
    expect(screen.queryByText("Material…")).toBeNull();
  });

  it("usa 'Material' como aria-label por defecto y respeta la etiqueta dada", () => {
    const { rerender } = render(<SelectMaterial valor={null} onCambio={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Material" })).toBeInTheDocument();
    rerender(<SelectMaterial valor={null} onCambio={() => {}} etiqueta="Material del pilar" />);
    expect(
      screen.getByRole("combobox", { name: "Material del pilar" }),
    ).toBeInTheDocument();
  });

  it("al abrir lista todas las opciones del catalogo y onCambio recibe el id", async () => {
    const user = userEvent.setup();
    const onCambio = vi.fn();
    render(<SelectMaterial valor={null} onCambio={onCambio} />);

    // Abrir el listbox: foco al trigger + Enter (estable en jsdom con los
    // polyfills de PointerCapture; un click ademas de Enter lo cerraria al toggle).
    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    // Todas las denominaciones del catalogo aparecen como opciones.
    for (const m of listarMateriales()) {
      expect(within(listbox).getByText(m.denominacion)).toBeInTheDocument();
    }

    // Elegir S355: onCambio se dispara con su id.
    await user.click(within(listbox).getByText("S355"));
    expect(onCambio).toHaveBeenCalledWith("S355");
  });
});
