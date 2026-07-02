// [AUDITORIA M-6] El boundary contiene un fallo de render/carga y muestra el
// mensaje en lenguaje de obra, en vez de dejar que el arbol entero se desmonte
// (pantalla en blanco). Antes la app no tenia NINGUN ErrorBoundary: un chunk
// lazy rechazado (Plotly offline tras un redeploy) tumbaba toda la UI.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomba(): never {
  throw new Error("fallo simulado de chunk");
}

describe("ErrorBoundary (auditoría M-6)", () => {
  it("contiene el fallo del hijo y muestra el mensaje de obra", () => {
    // React loguea el error por consola aunque el boundary lo capture: se
    // silencia SOLO en este test para no ensuciar la salida.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary mensaje="No se pudo cargar el diagrama.">
        <Bomba />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar el diagrama.");
    spy.mockRestore();
  });

  it("sin fallo, renderiza el hijo tal cual", () => {
    render(
      <ErrorBoundary mensaje="nunca visible">
        <p>contenido sano</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("contenido sano")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
