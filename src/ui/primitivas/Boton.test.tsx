// Test de la primitiva Boton. Cubre el mapeo variante -> clase (incluida la nueva
// variante "danger" para acciones destructivas, Spec Diseno UI §5) y los defaults.
// Project `jsdom`.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Boton } from "./Boton";

describe("Boton", () => {
  it("por defecto es primary y type=button", () => {
    render(<Boton>Aceptar</Boton>);
    const b = screen.getByRole("button", { name: "Aceptar" });
    expect(b).toHaveClass("cx-btn", "cx-btn--primary");
    expect(b).toHaveAttribute("type", "button");
  });

  it("variante ghost aplica cx-btn--ghost", () => {
    render(<Boton variante="ghost">Cancelar</Boton>);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass(
      "cx-btn--ghost",
    );
  });

  it("variante danger aplica cx-btn--danger (acción destructiva)", () => {
    render(<Boton variante="danger">Eliminar</Boton>);
    expect(screen.getByRole("button", { name: "Eliminar" })).toHaveClass(
      "cx-btn--danger",
    );
  });

  it("fusiona la className del llamante", () => {
    render(
      <Boton variante="ghost" className="mi-clase">
        X
      </Boton>,
    );
    const b = screen.getByRole("button", { name: "X" });
    expect(b).toHaveClass("cx-btn--ghost", "mi-clase");
  });
});
