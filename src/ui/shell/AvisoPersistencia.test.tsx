// Test del banner de persistencia (auditoria UX-L1). Project `jsdom`.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AvisoPersistencia } from "./AvisoPersistencia";

describe("AvisoPersistencia", () => {
  it("estado 'ok' no renderiza nada", () => {
    const { container } = render(<AvisoPersistencia estado="ok" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("estado 'carga-fallida' muestra un alert persistente con el copy grave", () => {
    render(<AvisoPersistencia estado="carga-fallida" />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent(/No se pudo recuperar el proyecto guardado/i);
    expect(alerta).toHaveTextContent(/no se están guardando/i);
    expect(alerta).toHaveClass("cx-aviso--danger");
  });

  it("estado 'sin-indexeddb' muestra un aviso discreto (status, no alert)", () => {
    render(<AvisoPersistencia estado="sin-indexeddb" />);
    expect(screen.queryByRole("alert")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/no permite el guardado automático/i);
    // Sin la clase danger (no es alarmista).
    expect(status).not.toHaveClass("cx-aviso--danger");
  });
});
