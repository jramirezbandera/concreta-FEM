// Tests de componente del PanelPlantillas (feature-15, T3.1). Project `jsdom`, RTL.
// El panel es AUTOCONTROLADO: se muestra solo si `panelPlantillasAbierto` y opera
// sobre la planta activa. Stores singleton de modulo -> reset en beforeEach.
//
// `parseDxf` se MOCKEA: su comportamiento (parse real + import() dinamico de
// dxf-parser) esta cubierto por sus propios tests en node puro; aqui solo importa
// que el panel lo invoca y construye la Plantilla con los defaults correctos. Esto
// ademas evita el import() dinamico en jsdom.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock del parser: devuelve dos entidades, sin avisos ni no-soportadas por defecto.
// Mutable por test para ejercitar la rama de avisos.
const parseDxfMock = vi.fn();
vi.mock("../viewport/dxf/parseDxf", () => ({
  parseDxf: (...args: unknown[]) => parseDxfMock(...args),
}));

import { PanelPlantillas } from "./PanelPlantillas";
import { vistaStore } from "../../estado";

// Fichero DXF de prueba. jsdom puede no implementar File.prototype.text en todas las
// versiones; lo garantizamos.
function dxfFile(nombre: string, contenido = "0\nSECTION"): File {
  const f = new File([contenido], nombre, { type: "image/vnd.dxf" });
  if (typeof f.text !== "function") {
    Object.defineProperty(f, "text", {
      value: () => Promise.resolve(contenido),
    });
  }
  return f;
}

beforeEach(() => {
  const v = vistaStore.getState();
  v.setPlantillas([]);
  v.setPlantillaActiva(null);
  v.setPlantaActiva("pl1");
  v.setPanelPlantillas(true);
  // Gate de hidratacion (T3): los tests de importacion necesitan la persistencia
  // "lista"; en la app real lo pone useArranquePersistencia al terminar de cargar.
  v.setPersistenciaLista(true);
  parseDxfMock.mockReset();
  parseDxfMock.mockResolvedValue({
    entidades: [
      { tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 0 },
      { tipo: "punto", x: 2, y: 2 },
    ],
    bbox: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    noSoportadas: [],
    avisos: [],
  });
});

// Sube un fichero al input oculto "Importar DXF".
async function importar(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = screen.getByLabelText("Importar DXF") as HTMLInputElement;
  await user.upload(input, file);
}

describe("PanelPlantillas: visibilidad", () => {
  it("no se renderiza si el panel esta cerrado", () => {
    vistaStore.getState().setPanelPlantillas(false);
    render(<PanelPlantillas />);
    expect(screen.queryByText("Plantillas")).not.toBeInTheDocument();
  });

  it("se renderiza al abrir el panel", () => {
    render(<PanelPlantillas />);
    expect(screen.getByText("Plantillas")).toBeInTheDocument();
  });

  it("el botón Cerrar baja el flag y oculta el panel", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(vistaStore.getState().panelPlantillasAbierto).toBe(false);
    expect(screen.queryByText("Plantillas")).not.toBeInTheDocument();
  });
});

describe("PanelPlantillas: importar", () => {
  it("importa un DXF y construye la Plantilla con los defaults de transform", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);

    await importar(user, dxfFile("Planta baja.dxf"));

    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(1),
    );
    const p = vistaStore.getState().plantillas[0]!;
    expect(p.nombre).toBe("Planta baja"); // sin extension
    expect(p.nombreArchivo).toBe("Planta baja.dxf");
    expect(p.plantaId).toBe("pl1"); // planta activa
    expect(p.entidades).toHaveLength(2);
    expect(p.transform).toEqual({ x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 0.7 });
    expect(p.visible).toBe(true);
    expect(p.bloqueado).toBe(false);
    // Queda seleccionada como activa.
    expect(vistaStore.getState().plantillaActivaId).toBe(p.id);
  });

  it("sin planta activa, no importa y avisa", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setPlantaActiva(null);
    render(<PanelPlantillas />);

    await importar(user, dxfFile("plano.dxf"));

    expect(vistaStore.getState().plantillas).toHaveLength(0);
    expect(
      screen.getByText("Selecciona una planta antes de importar."),
    ).toBeInTheDocument();
    expect(parseDxfMock).not.toHaveBeenCalled();
  });

  it("muestra aviso de entidades no soportadas omitidas", async () => {
    const user = userEvent.setup();
    // Con AL MENOS una entidad soportada el import procede; el aviso lista las
    // omitidas (si fueran 0 entidades, el import se rechazaria; ver test siguiente).
    parseDxfMock.mockResolvedValue({
      entidades: [{ tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 0 }],
      bbox: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
      noSoportadas: ["SPLINE", "TEXT"],
      avisos: [],
    });
    render(<PanelPlantillas />);

    await importar(user, dxfFile("complejo.dxf"));

    await waitFor(() =>
      expect(
        screen.getByText(/Entidades no soportadas omitidas: SPLINE, TEXT\./),
      ).toBeInTheDocument(),
    );
  });

  it("rechaza un DXF sin entidades soportadas (no crea plantilla en blanco)", async () => {
    const user = userEvent.setup();
    // T1: un parse vacio (corrupto o solo entidades no soportadas) NO crea una
    // plantilla en blanco; avisa y aborta.
    parseDxfMock.mockResolvedValue({
      entidades: [],
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      noSoportadas: ["SPLINE"],
      avisos: [],
    });
    render(<PanelPlantillas />);

    await importar(user, dxfFile("solo-splines.dxf"));

    await waitFor(() =>
      expect(
        screen.getByText(/No se pudo importar: el DXF no contiene entidades/),
      ).toBeInTheDocument(),
    );
    expect(vistaStore.getState().plantillas).toHaveLength(0);
  });
});

describe("PanelPlantillas: lista y toggles", () => {
  it("alterna la visibilidad de una plantilla", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);
    await importar(user, dxfFile("p.dxf"));
    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(1),
    );

    await user.click(screen.getByRole("button", { name: "Ocultar plantilla" }));
    expect(vistaStore.getState().plantillas[0]!.visible).toBe(false);
    // Tras ocultar, el boton cambia su etiqueta a "Mostrar plantilla".
    await user.click(screen.getByRole("button", { name: "Mostrar plantilla" }));
    expect(vistaStore.getState().plantillas[0]!.visible).toBe(true);
  });

  it("eliminar una plantilla la quita de la lista", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);
    await importar(user, dxfFile("p.dxf"));
    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(1),
    );

    await user.click(screen.getByRole("button", { name: "Eliminar plantilla" }));
    expect(vistaStore.getState().plantillas).toHaveLength(0);
  });

  it("solo lista las plantillas de la planta activa", async () => {
    const user = userEvent.setup();
    // Plantilla de OTRA planta: no debe aparecer.
    vistaStore.getState().addPlantilla({
      id: "otra",
      nombre: "Otra planta",
      nombreArchivo: "otra.dxf",
      plantaId: "pl2",
      entidades: [],
      transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 0.7 },
      visible: true,
      bloqueado: false,
      creadaEn: 0,
    });
    render(<PanelPlantillas />);
    await importar(user, dxfFile("Esta planta.dxf"));
    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(2),
    );

    expect(screen.getByText("Esta planta")).toBeInTheDocument();
    expect(screen.queryByText("Otra planta")).not.toBeInTheDocument();
  });
});

describe("PanelPlantillas: transform de la plantilla activa", () => {
  it("editar Escala actualiza el transform", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);
    await importar(user, dxfFile("p.dxf"));
    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(1),
    );

    const input = screen.getByLabelText("Escala");
    await user.clear(input);
    await user.type(input, "2.5");
    await user.tab();

    expect(vistaStore.getState().plantillas[0]!.transform.escala).toBe(2.5);
  });

  it("editar Opacidad convierte de % a 0..1 en el borde", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);
    await importar(user, dxfFile("p.dxf"));
    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(1),
    );

    const input = screen.getByLabelText("Opacidad");
    await user.clear(input);
    await user.type(input, "40");
    await user.tab();

    expect(vistaStore.getState().plantillas[0]!.transform.opacidad).toBeCloseTo(0.4);
  });

  it("una plantilla bloqueada deshabilita los controles de transform", async () => {
    const user = userEvent.setup();
    render(<PanelPlantillas />);
    await importar(user, dxfFile("p.dxf"));
    await waitFor(() =>
      expect(vistaStore.getState().plantillas).toHaveLength(1),
    );

    // Bloquear desde la fila.
    await user.click(screen.getByRole("button", { name: "Bloquear plantilla" }));
    expect(vistaStore.getState().plantillas[0]!.bloqueado).toBe(true);
    // El input de Escala queda deshabilitado (fieldset disabled).
    expect(screen.getByLabelText("Escala")).toBeDisabled();
  });
});
