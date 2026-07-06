// Test RTL de la barra de coordenadas (UX-2.5). Cubre el CONTRATO del overlay:
// visibilidad por herramienta/vista, parseo + emision por entradaBus al pulsar
// Enter, error inline con entrada invalida y Esc que vacia sin cancelar (via
// preventDefault). La resolucion contra el punto pendiente vive en la herramienta
// (cubierta por entradaNumerica.test.ts + el pipeline compartido del clic).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { vistaStore } from "../../estado";
import { EntradaNumericaOverlay } from "./EntradaNumericaOverlay";
import { suscribirEntrada } from "./hooks/entradaBus";
import type { ExprNumerica } from "./entradaNumerica";

function activarHerramienta(): void {
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setHerramienta("pilar");
}

describe("EntradaNumericaOverlay (UX-2.5)", () => {
  beforeEach(() => {
    activarHerramienta();
  });
  afterEach(() => {
    cleanup();
    vistaStore.getState().setHerramienta("seleccion");
  });

  it("se oculta sin herramienta de colocacion y se muestra con ella", () => {
    vistaStore.getState().setHerramienta("seleccion");
    const { rerender } = render(<EntradaNumericaOverlay />);
    expect(screen.queryByLabelText("Coordenadas de colocación")).toBeNull();

    activarHerramienta();
    rerender(<EntradaNumericaOverlay />);
    expect(screen.getByLabelText("Coordenadas de colocación")).toBeTruthy();
  });

  it("Enter con 'x,y' valido emite la expresion por entradaBus y limpia el campo", () => {
    const recibidas: ExprNumerica[] = [];
    const off = suscribirEntrada((e) => recibidas.push(e));
    render(<EntradaNumericaOverlay />);

    const input = screen.getByLabelText<HTMLInputElement>(
      "Coordenadas de colocación",
    );
    fireEvent.change(input, { target: { value: "2,3" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(recibidas).toEqual([{ tipo: "absoluta", x: 2, y: 3 }]);
    expect(input.value).toBe(""); // listo para encadenar el siguiente punto
    off();
  });

  it("Enter con entrada invalida NO emite y muestra el error inline", () => {
    const recibidas: ExprNumerica[] = [];
    const off = suscribirEntrada((e) => recibidas.push(e));
    render(<EntradaNumericaOverlay />);

    const input = screen.getByLabelText<HTMLInputElement>(
      "Coordenadas de colocación",
    );
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(recibidas).toEqual([]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/Formato/)).toBeTruthy();
    off();
  });

  it("Escape vacia el campo con preventDefault (no debe cancelar la colocacion)", () => {
    render(<EntradaNumericaOverlay />);
    const input = screen.getByLabelText<HTMLInputElement>(
      "Coordenadas de colocación",
    );
    fireEvent.change(input, { target: { value: "5<90" } });
    // fireEvent devuelve false si algun handler hizo preventDefault.
    const noPrevenido = fireEvent.keyDown(input, { key: "Escape" });
    expect(noPrevenido).toBe(false);
    expect(input.value).toBe("");
  });
});
