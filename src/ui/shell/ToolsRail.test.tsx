// Tests del ToolsRail (auditoria UX-A4/UX-A6 + Corte UX-2). Project `jsdom`. Foco:
//   - "rejilla" esta CABLEADA a vistaStore.rejillaVisible (boton dividido
//     PopoverRejilla: toggle + popover con el paso, UX-2.1).
//   - "orto" pasa de placeholder a toggle REAL de vistaStore.ortoActivo (UX-2.3).
//   - config/ayuda siguen como placeholders DESHABILITADOS (no clic muerto).
//   - "snap" sigue cableado a vistaStore.snapActivo.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsRail } from "./ToolsRail";
import { vistaStore } from "../../estado";

beforeEach(() => {
  vistaStore.getState().setRejillaVisible(true);
  vistaStore.getState().setSnapActivo(true);
  vistaStore.getState().setOrtoActivo(false);
  vistaStore.getState().resetDockUI();
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

describe("ToolsRail · orto cableado al store (UX-2.3)", () => {
  it("refleja ortoActivo y lo conmuta al pulsar", async () => {
    const user = userEvent.setup();
    render(<ToolsRail />);
    const orto = boton("Modo orto (Shift lo invierte)");
    expect(orto).not.toBeDisabled();
    expect(orto).toHaveAttribute("aria-pressed", "false");

    await user.click(orto);
    expect(vistaStore.getState().ortoActivo).toBe(true);
    expect(orto).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ToolsRail · placeholders deshabilitados (UX-A4/UX-A6)", () => {
  it("Configuración/Ayuda están deshabilitados (no clic muerto)", () => {
    render(<ToolsRail />);
    for (const label of ["Configuración", "Ayuda"]) {
      const b = boton(label);
      expect(b, label).toBeDisabled();
      expect(b).toHaveAttribute("title", "Disponible próximamente");
    }
  });
});

describe("ToolsRail · paso de rejilla (UX-2.1)", () => {
  it("el boton dividido anuncia el paso actual en su title", () => {
    act(() => {
      vistaStore.getState().setPasoRejilla(0.25);
    });
    render(<ToolsRail />);
    const config = boton("Configurar el paso de la rejilla");
    expect(config).toHaveAttribute("title", "Paso de rejilla: 0.25 m");
    act(() => {
      vistaStore.getState().setPasoRejilla(0.5);
    });
  });
});

// [D14e] Botón de colapsar/expandir el dock entero: refleja dockUI.dockColapsado y lo
// conmuta (aria-pressed + title según estado).
describe("ToolsRail · colapso del dock (D14e)", () => {
  it("conmuta dockUI.dockColapsado y refleja aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ToolsRail />);
    // aria-label estable "Ocultar el panel de datos" (title = aria-label cuando abierto).
    const btn = boton("Ocultar el panel de datos");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await user.click(btn);
    expect(vistaStore.getState().dockUI.dockColapsado).toBe(true);
    // Colapsado: el botón cambia su etiqueta a "Mostrar el panel de datos" y aria-pressed.
    const btn2 = boton("Mostrar el panel de datos");
    expect(btn2).toHaveAttribute("aria-pressed", "true");
    await user.click(btn2);
    expect(vistaStore.getState().dockUI.dockColapsado).toBe(false);
  });
});

// [D13e] "Biblioteca de secciones" pasa de deshabilitada a accionable: abre el diálogo
// de sección personalizada (crear sección de obra a medida).
describe("ToolsRail · Biblioteca de secciones accionable (D13e)", () => {
  beforeEach(() => {
    vistaStore.getState().cerrarDialogo();
  });

  it("abre el diálogo de sección personalizada al pulsar", async () => {
    const user = userEvent.setup();
    render(<ToolsRail />);
    const biblioteca = boton("Biblioteca de secciones");
    expect(biblioteca).not.toBeDisabled();
    await user.click(biblioteca);
    expect(vistaStore.getState().dialogoActivo).toBe("seccionPersonalizada");
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
