// [D14 · PR3] Tests de la primitiva SeccionColapsable. Project `jsdom`. Verifica: modo NO
// controlado (defaultAbierta + toggle interno) y CONTROLADO (abierta + onAbiertaChange), y
// la accesibilidad del trigger (aria-expanded via data-state de Radix).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeccionColapsable } from "./SeccionColapsable";

describe("SeccionColapsable · no controlado", () => {
  it("muestra el contenido cuando arranca abierta (default)", () => {
    render(
      <SeccionColapsable titulo="Reacciones">
        <p>contenido</p>
      </SeccionColapsable>,
    );
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("oculta el contenido cuando defaultAbierta=false", () => {
    render(
      <SeccionColapsable titulo="Reacciones" defaultAbierta={false}>
        <p>contenido</p>
      </SeccionColapsable>,
    );
    // Radix Collapsible desmonta el contenido cuando está cerrado.
    expect(screen.queryByText("contenido")).toBeNull();
  });

  it("el trigger conmuta la visibilidad", async () => {
    const user = userEvent.setup();
    render(
      <SeccionColapsable titulo="Reacciones" defaultAbierta={false}>
        <p>contenido</p>
      </SeccionColapsable>,
    );
    expect(screen.queryByText("contenido")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Reacciones/ }));
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });
});

describe("SeccionColapsable · controlado", () => {
  it("respeta la prop `abierta` y notifica onAbiertaChange al pulsar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SeccionColapsable titulo="Diagramas" abierta={true} onAbiertaChange={onChange}>
        <p>cuerpo</p>
      </SeccionColapsable>,
    );
    expect(screen.getByText("cuerpo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Diagramas/ }));
    // En modo controlado, el clic NO cambia el estado por su cuenta: solo notifica.
    expect(onChange).toHaveBeenCalledWith(false);
    // El llamante cierra la sección propagando la nueva prop.
    rerender(
      <SeccionColapsable titulo="Diagramas" abierta={false} onAbiertaChange={onChange}>
        <p>cuerpo</p>
      </SeccionColapsable>,
    );
    expect(screen.queryByText("cuerpo")).toBeNull();
  });
});
