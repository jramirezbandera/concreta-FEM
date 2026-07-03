// Tests de componente del DialogoSeccionPersonalizada (auditoria UI/UX D3). RTL en el
// project `jsdom`. El dialogo es AUTO-GATEADO: se muestra cuando
// vistaStore.dialogoActivo === "seccionPersonalizada". Stores singleton de modulo ->
// reset en beforeEach. Verifican: auto-gate, creacion de seccion rectangular/circular
// via crearSeccion (id opaco, solo dimensiones, mm->m en el borde), presets que rellenan
// los campos, y el aviso NO bloqueante de nombre duplicado.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogoSeccionPersonalizada } from "./DialogoSeccionPersonalizada";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().cerrarDialogo();
});

const modelo = () => modeloStore.getState().getModelo();

function renderAbierto() {
  vistaStore.getState().abrirDialogo("seccionPersonalizada");
  render(<DialogoSeccionPersonalizada />);
  return screen.getByRole("dialog");
}

describe("DialogoSeccionPersonalizada: auto-gate", () => {
  it("no renderiza nada si dialogoActivo != 'seccionPersonalizada'", () => {
    render(<DialogoSeccionPersonalizada />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se muestra cuando dialogoActivo === 'seccionPersonalizada'", () => {
    const dialogo = renderAbierto();
    expect(dialogo).toBeInTheDocument();
    // El titulo aparece como heading (Dialog.Title); hay tambien una Description
    // accesible oculta con el mismo texto, por eso se localiza por rol de heading.
    expect(
      within(dialogo).getByRole("heading", { name: "Sección personalizada" }),
    ).toBeInTheDocument();
  });
});

describe("DialogoSeccionPersonalizada: creacion", () => {
  it("crea una seccion rectangular de obra con id opaco y SOLO dimensiones (mm->m)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    const previas = modelo().secciones.length;

    // Los campos vienen con el default 300×300 mm. Pulsar "Crear sección".
    await user.click(within(dialogo).getByRole("button", { name: "Crear sección" }));

    expect(modelo().secciones).toHaveLength(previas + 1);
    const creada = modelo().secciones[modelo().secciones.length - 1];
    expect(creada.tipo).toBe("hormigonRectangular");
    // mm -> m en el borde: 300 mm -> 0.3 m.
    expect(creada).toMatchObject({ b: 0.3, h: 0.3 });
    // Id opaco (UUID), no semantico.
    expect(creada.id).toMatch(/[0-9a-f-]{36}/);
    // Solo dimensiones: nada de A/Iy/Iz.
    expect("A" in creada).toBe(false);
    expect("Iy" in creada).toBe(false);
    // Al crear, el dialogo se cierra.
    expect(vistaStore.getState().dialogoActivo).toBeNull();
  });

  it("un preset rellena los campos (30×50 -> b=500... via el campo)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    // Clic en el preset 30×50: cambia a rectangular con b=300 h=500.
    await user.click(within(dialogo).getByRole("button", { name: "30×50" }));
    await user.click(within(dialogo).getByRole("button", { name: "Crear sección" }));

    const creada = modelo().secciones[modelo().secciones.length - 1];
    expect(creada).toMatchObject({ tipo: "hormigonRectangular", b: 0.3, h: 0.5 });
  });

  it("crea una seccion circular al elegir la geometria Circular", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    // Preset Ø40 -> circular con d=400 mm.
    await user.click(within(dialogo).getByRole("button", { name: "Ø40" }));
    await user.click(within(dialogo).getByRole("button", { name: "Crear sección" }));

    const creada = modelo().secciones[modelo().secciones.length - 1];
    expect(creada.tipo).toBe("hormigonCircular");
    expect(creada).toMatchObject({ d: 0.4 }); // 400 mm -> 0.4 m
  });
});

describe("DialogoSeccionPersonalizada: aviso de nombre duplicado", () => {
  it("avisa (role=status) si el nombre coincide con una seccion existente, sin bloquear", () => {
    // El modelo vacio ya trae "HA 30×30" sembrada. El nombre derivado por defecto para
    // 300×300 es justamente "HA 30×30" -> deberia avisar sin escribir nada.
    const dialogo = renderAbierto();

    const aviso = within(dialogo).getByRole("status");
    expect(aviso).toHaveTextContent("Ya existe una sección");
    // No bloquea: el boton "Crear sección" sigue habilitado.
    expect(
      within(dialogo).getByRole("button", { name: "Crear sección" }),
    ).not.toBeDisabled();
  });
});
