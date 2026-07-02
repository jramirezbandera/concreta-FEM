// Tests del ToolsRail (auditoria UX-A4/UX-A6). Project `jsdom`. Foco:
//   - "rejilla" esta CABLEADA a vistaStore.rejillaVisible (toggle conmuta el flag), ya
//     no un toggle local cosmetico.
//   - "orto" y biblioteca/config/ayuda son placeholders DESHABILITADOS (no clic muerto).
//   - "snap" sigue cableado a vistaStore.snapActivo.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsRail } from "./ToolsRail";
import { vistaStore } from "../../estado";

beforeEach(() => {
  vistaStore.getState().setRejillaVisible(true);
  vistaStore.getState().setSnapActivo(true);
});

// Localiza un boton del rail por su aria-label (title == aria-label salvo placeholders).
function boton(label: string): HTMLButtonElement {
  return screen.getByRole("button", { name: label }) as HTMLButtonElement;
}

describe("ToolsRail · rejilla cableada al store (UX-A4)", () => {
  it("refleja rejillaVisible y lo conmuta al pulsar", async () => {
    const user = userEvent.setup();
    render(<ToolsRail />);
    const rejilla = boton("Rejilla");
    // Encendida por defecto: aria-pressed true.
    expect(rejilla).toHaveAttribute("aria-pressed", "true");

    await user.click(rejilla);
    expect(vistaStore.getState().rejillaVisible).toBe(false);
    expect(rejilla).toHaveAttribute("aria-pressed", "false");

    await user.click(rejilla);
    expect(vistaStore.getState().rejillaVisible).toBe(true);
  });

  it("un cambio externo del store se refleja en el botón", () => {
    render(<ToolsRail />);
    const rejilla = boton("Rejilla");
    expect(rejilla).toHaveAttribute("aria-pressed", "true");
    // Cambio del store desde fuera del componente: envolver en act para que React
    // procese el re-render de useSyncExternalStore de forma sincrona.
    act(() => {
      vistaStore.getState().setRejillaVisible(false);
    });
    expect(rejilla).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ToolsRail · placeholders deshabilitados (UX-A4/UX-A6)", () => {
  it('"Modo orto" está deshabilitado y no es conmutable', () => {
    render(<ToolsRail />);
    // aria-label conserva "Modo orto"; title pasa a "Disponible próximamente".
    const orto = boton("Modo orto");
    expect(orto).toBeDisabled();
    expect(orto).toHaveAttribute("title", "Disponible próximamente");
    expect(orto).not.toHaveAttribute("aria-pressed");
  });

  it("Biblioteca/Configuración/Ayuda están deshabilitados (no clic muerto)", () => {
    render(<ToolsRail />);
    for (const label of ["Biblioteca de secciones", "Configuración", "Ayuda"]) {
      const b = boton(label);
      expect(b, label).toBeDisabled();
      expect(b).toHaveAttribute("title", "Disponible próximamente");
    }
  });
});

describe("ToolsRail · snap cableado al store", () => {
  it("refleja snapActivo y lo conmuta al pulsar", async () => {
    const user = userEvent.setup();
    render(<ToolsRail />);
    const snap = boton("Referencia a objetos (snap)");
    expect(snap).toHaveAttribute("aria-pressed", "true");
    await user.click(snap);
    expect(vistaStore.getState().snapActivo).toBe(false);
  });
});
