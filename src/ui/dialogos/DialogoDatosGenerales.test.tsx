// [D13] Tests de DialogoDatosGenerales. Project `jsdom`. Se MOCKEA /src/persistencia
// (renombrarProyecto, cargarProyecto, reanclarBaselineAutosave) para no tocar IndexedDB:
// lo que se prueba es el flujo del diálogo (renombra el proyecto activo, reancla la
// baseline con el actualizadoEn releído, llama a onRenombrado y cierra).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const renombrarProyectoMock = vi.fn(async (_id: string, _nombre: string) => {});
const cargarProyectoMock = vi.fn(async (id: string) => ({
  id,
  nombre: "nuevo",
  actualizadoEn: 4242,
}));
const reanclarBaselineMock = vi.fn((_id: string, _ts: number) => {});
vi.mock("../../persistencia", () => ({
  renombrarProyecto: (id: string, nombre: string) => renombrarProyectoMock(id, nombre),
  cargarProyecto: (id: string) => cargarProyectoMock(id),
  reanclarBaselineAutosave: (id: string, ts: number) => reanclarBaselineMock(id, ts),
}));

import { DialogoDatosGenerales } from "./DialogoDatosGenerales";
import { vistaStore } from "../../estado";

beforeEach(() => {
  renombrarProyectoMock.mockClear();
  cargarProyectoMock.mockClear();
  reanclarBaselineMock.mockClear();
  vistaStore.getState().cerrarDialogo();
});

function abrir() {
  vistaStore.getState().abrirDialogo("datosGenerales");
}

describe("DialogoDatosGenerales · flujo de renombrado (D13)", () => {
  it("no se muestra si el diálogo activo no es 'datosGenerales'", () => {
    render(
      <DialogoDatosGenerales
        proyectoActivoId="p1"
        nombreActual="Obra A"
        onRenombrado={() => {}}
      />,
    );
    expect(screen.queryByText("Datos generales")).toBeNull();
  });

  it("prellena el campo con el nombre actual al abrir", () => {
    abrir();
    render(
      <DialogoDatosGenerales
        proyectoActivoId="p1"
        nombreActual="Obra A"
        onRenombrado={() => {}}
      />,
    );
    const input = screen.getByLabelText("Nombre de la obra") as HTMLInputElement;
    expect(input.value).toBe("Obra A");
  });

  it("Aceptar renombra, reancla la baseline y avisa (onRenombrado), y cierra", async () => {
    const user = userEvent.setup();
    const onRenombrado = vi.fn();
    abrir();
    render(
      <DialogoDatosGenerales
        proyectoActivoId="p1"
        nombreActual="Obra A"
        onRenombrado={onRenombrado}
      />,
    );
    const input = screen.getByLabelText("Nombre de la obra");
    await user.clear(input);
    await user.type(input, "Edificio Sur");
    await user.click(screen.getByRole("button", { name: "Aceptar" }));

    await waitFor(() => {
      expect(renombrarProyectoMock).toHaveBeenCalledWith("p1", "Edificio Sur");
    });
    // Reancla la baseline con el actualizadoEn RELEÍDO del registro (D13b).
    expect(reanclarBaselineMock).toHaveBeenCalledWith("p1", 4242);
    expect(onRenombrado).toHaveBeenCalledTimes(1);
    // El diálogo se cierra.
    expect(vistaStore.getState().dialogoActivo).toBeNull();
  });

  it("recorta espacios y bloquea Aceptar con nombre vacío", async () => {
    const user = userEvent.setup();
    abrir();
    render(
      <DialogoDatosGenerales
        proyectoActivoId="p1"
        nombreActual="Obra A"
        onRenombrado={() => {}}
      />,
    );
    const input = screen.getByLabelText("Nombre de la obra");
    await user.clear(input);
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: "Aceptar" })).toBeDisabled();
  });

  it("sin persistencia (proyectoActivoId null) no permite guardar y avisa", () => {
    abrir();
    render(
      <DialogoDatosGenerales
        proyectoActivoId={null}
        nombreActual="Obra A"
        onRenombrado={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Aceptar" })).toBeDisabled();
    expect(
      screen.getByText(/almacenamiento del navegador no está disponible/i),
    ).toBeInTheDocument();
  });

  it("Cancelar cierra sin renombrar", async () => {
    const user = userEvent.setup();
    abrir();
    render(
      <DialogoDatosGenerales
        proyectoActivoId="p1"
        nombreActual="Obra A"
        onRenombrado={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(renombrarProyectoMock).not.toHaveBeenCalled();
    expect(vistaStore.getState().dialogoActivo).toBeNull();
  });
});
