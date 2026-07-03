// Tests del SelectUso (UX-D2). Project `jsdom`, RTL. El SelectUso es un Radix Select
// sobre las categorias de uso (A..G). UX-D2: cada opcion muestra ademas el qk normativo
// que fijara al elegirla, para que el usuario no reasigne la sobrecarga a ciegas.
//
// Nota jsdom/Radix: el listbox se abre por TECLADO (foco + Enter), estable bajo jsdom con
// los polyfills de PointerCapture/scrollIntoView.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectUso } from "./SelectUso";
import { formatearQk } from "./formatoNumero";
import { categoriaUso } from "../../biblioteca";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

describe("formatearQk", () => {
  it("formatea con coma decimal (es-ES) y un decimal fijo", () => {
    expect(formatearQk(2)).toBe("2,0");
    expect(formatearQk(5)).toBe("5,0");
    expect(formatearQk(1)).toBe("1,0");
  });
});

describe("SelectUso (UX-D2)", () => {
  it("cada opcion muestra el qk normativo que fijara al elegirla", async () => {
    const user = userEvent.setup();
    render(<SelectUso valor="A" onCambio={() => {}} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    // Categoria A -> qk 2,0 kN/m²; categoria C -> qk 5,0 kN/m² (CTE DB-SE-AE via biblioteca).
    expect(
      within(listbox).getByText(
        new RegExp(`A · Zonas residenciales — ${formatearQk(categoriaUso("A").qk)} kN/m²`),
      ),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByText(
        new RegExp(`C · .* — ${formatearQk(categoriaUso("C").qk)} kN/m²`),
      ),
    ).toBeInTheDocument();
  });

  it("onCambio recibe la letra de la categoria (valor de dominio, no la etiqueta)", async () => {
    const user = userEvent.setup();
    const onCambio = vi.fn();
    render(<SelectUso valor="A" onCambio={onCambio} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByText(
        new RegExp(`C · .* — ${formatearQk(categoriaUso("C").qk)} kN/m²`),
      ),
    );
    expect(onCambio).toHaveBeenCalledWith("C");
  });
});
