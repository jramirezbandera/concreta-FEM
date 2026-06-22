// Test de la primitiva compartida CampoNumero (consolidacion del review de
// ingenieria de feature-11: antes habia tres copias de este widget en
// DialogoGruposYPlantas, InspectorPilar y PanelHerramientaPilar). Project `jsdom`.
//
// Verifica el contrato load-bearing del input: estado LOCAL mientras se teclea,
// commit en BLUR (no por tecla), parseo a Number, NaN para vacio/espacios (para que
// el padre valide en vez de guardar un 0 silencioso), y RESINCRONIZACION cuando el
// `valor` entrante cambia desde fuera (undo/redo, cambio de elemento).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampoNumero } from "./CampoNumero";

describe("CampoNumero (primitiva compartida)", () => {
  it("muestra el valor inicial como string en el input", () => {
    render(<CampoNumero etiqueta="Ángulo" valor={30} onCommit={() => {}} />);
    expect(screen.getByLabelText("Ángulo")).toHaveValue(30);
  });

  it("NO commitea mientras se teclea; commitea el Number en blur", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CampoNumero etiqueta="X" valor={0} onCommit={onCommit} />);
    const input = screen.getByLabelText("X");
    await user.clear(input);
    await user.type(input, "4.5");
    // Aun no ha habido blur: cero commits por tecla.
    expect(onCommit).not.toHaveBeenCalled();
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(4.5);
  });

  it("commitea NaN cuando el campo se vacia (no un 0 accidental)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CampoNumero etiqueta="X" valor={7} onCommit={onCommit} />);
    const input = screen.getByLabelText("X");
    await user.clear(input);
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toBeNaN();
  });

  it("acepta negativos y decimales transitorios", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CampoNumero etiqueta="Cota" valor={0} onCommit={onCommit} />);
    const input = screen.getByLabelText("Cota");
    await user.clear(input);
    await user.type(input, "-2.5");
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(-2.5);
  });

  it("se resincroniza cuando el valor entrante cambia desde fuera (undo/redo)", () => {
    const { rerender } = render(
      <CampoNumero etiqueta="Ángulo" valor={30} onCommit={() => {}} />,
    );
    expect(screen.getByLabelText("Ángulo")).toHaveValue(30);
    // El padre cambia el valor (p. ej. tras un deshacer): el input lo refleja.
    rerender(<CampoNumero etiqueta="Ángulo" valor={90} onCommit={() => {}} />);
    expect(screen.getByLabelText("Ángulo")).toHaveValue(90);
  });

  it("aplica la clase numérica (mono tabular alineado a la derecha, Spec §1.5/§5)", () => {
    render(<CampoNumero etiqueta="Cota" valor={0} onCommit={() => {}} />);
    expect(screen.getByLabelText("Cota")).toHaveClass("cx-input--num");
  });

  it("fusiona la clase numérica con la className del llamante", () => {
    render(
      <CampoNumero
        etiqueta="Cota"
        valor={0}
        onCommit={() => {}}
        className="cx-gyp__campo-num"
      />,
    );
    const input = screen.getByLabelText("Cota");
    expect(input).toHaveClass("cx-input--num");
    expect(input).toHaveClass("cx-gyp__campo-num");
  });

  it("muestra el mensaje de error y el sufijo cuando se proveen", () => {
    render(
      <CampoNumero
        etiqueta="Ángulo"
        valor={0}
        onCommit={() => {}}
        error="Introduce un número válido."
        sufijo="°"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Introduce un número válido.",
    );
    expect(screen.getByText("°")).toBeInTheDocument();
    expect(screen.getByLabelText("Ángulo")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
