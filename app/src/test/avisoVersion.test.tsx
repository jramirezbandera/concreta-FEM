import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { AvisoVersion } from "../armazon/AvisoVersion.tsx";

const publicar = (version: string | null) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (version === null ? new Response("", { status: 404 }) : Response.json({ version }))),
  );

afterEach(() => vi.unstubAllGlobals());

describe("AvisoVersion", () => {
  it("avisa cuando la versión publicada es otra", async () => {
    publicar("b");
    render(<AvisoVersion activo actual="a" />);
    expect(await screen.findByText(/nueva versión de Concreta FEM/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Actualizar/ })).toBeInTheDocument();
  });

  it("no avisa con la misma versión ni sin version.json", async () => {
    publicar("a");
    const { unmount } = render(<AvisoVersion activo actual="a" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    publicar(null);
    render(<AvisoVersion activo actual="a" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no consulta fuera de producción y se puede cerrar", async () => {
    publicar("b");
    const { unmount } = render(<AvisoVersion activo={false} actual="a" />);
    await act(async () => {});
    expect(fetch).not.toHaveBeenCalled();
    unmount();

    render(<AvisoVersion activo actual="a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
