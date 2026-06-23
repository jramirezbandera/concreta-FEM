// Tests de componente del DialogoHipotesis (feature-13, T3.1). RTL en el project
// `jsdom`. El dialogo es AUTOCONTROLADO: se muestra cuando
// vistaStore.dialogoActivo === "hipotesis". Stores singleton de modulo -> reset en
// beforeEach (mismo patron que DialogoGruposYPlantas.test.tsx). Verifican el flujo
// maestro-detalle con COMMIT EN VIVO: crear/editar nombre/editar tipo/eliminar
// hipotesis, y la confirmacion de borrado cuando arrastra cargas.
//
// Notas de jsdom/Radix:
//   - El Dialogo (Radix) se renderiza por Portal pero queda en el mismo document;
//     `screen`/`within(getByRole("dialog"))` lo alcanzan sin problema.
//   - El tipo permanente/variable se edita con un Segmentado (ToggleGroup), que
//     expone role radiogroup/radio y es ESTABLE en jsdom (a diferencia del Radix
//     Select). Por eso el commit en vivo del tipo se ejercita por ahi.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogoHipotesis } from "./DialogoHipotesis";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

beforeEach(() => {
  // Reset de los stores singleton a un estado limpio y reproducible. El modelo
  // vacio siembra dos hipotesis (Cargas muertas, Sobrecarga de uso).
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().cerrarDialogo();
});

// Render del dialogo con el estado de vista ya en "abierto". Devuelve el dialogo
// principal (el primero: la confirmacion es un segundo dialog cuando se abre).
function renderAbierto() {
  vistaStore.getState().abrirDialogo("hipotesis");
  render(<DialogoHipotesis />);
  return screen.getByRole("dialog");
}

const modelo = () => modeloStore.getState().getModelo();
const hipotesis = () => modelo().hipotesis;

describe("DialogoHipotesis: montaje", () => {
  it("se muestra cuando dialogoActivo === 'hipotesis' y lista las hipotesis sembradas", () => {
    const dialogo = renderAbierto();
    expect(dialogo).toBeInTheDocument();
    // Las dos hipotesis del modelo vacio aparecen en el maestro.
    expect(within(dialogo).getByText("Cargas muertas")).toBeInTheDocument();
    expect(within(dialogo).getByText("Sobrecarga de uso")).toBeInTheDocument();
  });

  it("no se renderiza contenido si el dialogo esta cerrado", () => {
    render(<DialogoHipotesis />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("DialogoHipotesis: crear", () => {
  it("crear hipotesis: anade una al modelo y la deja activa", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    expect(hipotesis()).toHaveLength(2);
    await user.click(within(dialogo).getByRole("button", { name: "Nueva hipótesis" }));

    expect(hipotesis()).toHaveLength(3);
    // La nueva (sin nombre dado) se nombra "Hipotesis 1" via siguienteNombre.
    const nueva = hipotesis()[2];
    expect(nueva.tipo).toBe("permanente");
    // Queda seleccionada: su item esta marcado (aria-pressed).
    expect(
      within(dialogo).getByRole("button", { name: nueva.nombre, pressed: true }),
    ).toBeInTheDocument();
  });
});

describe("DialogoHipotesis: editar", () => {
  it("editar nombre en vivo (commit en blur) reescribe la hipotesis activa", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    // Selecciona la primera hipotesis para editarla.
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText("Nombre");
    await user.clear(inputNombre);
    await user.type(inputNombre, "Peso propio");
    await user.tab(); // blur -> commit

    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.nombre).toBe(
      "Peso propio",
    );
  });

  it("nombre duplicado no se commitea y muestra el error", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText("Nombre");
    await user.clear(inputNombre);
    await user.type(inputNombre, "Sobrecarga de uso"); // ya existe
    await user.tab();

    // No se commitea: la hipotesis conserva su nombre.
    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.nombre).toBe(
      "Cargas muertas",
    );
    expect(within(detalle).getByRole("alert")).toHaveTextContent(/Ya existe/);
  });

  it("editar el tipo en vivo (Segmentado) despacha el cambio", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    const grupoTipo = within(dialogo).getByRole("radiogroup", { name: "Tipo" });
    await user.click(within(grupoTipo).getByRole("radio", { name: "Variable" }));

    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.tipo).toBe(
      "variable",
    );
  });

  it("deshacer revierte la edicion del tipo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    const grupoTipo = within(dialogo).getByRole("radiogroup", { name: "Tipo" });
    await user.click(within(grupoTipo).getByRole("radio", { name: "Variable" }));
    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.tipo).toBe(
      "variable",
    );

    modeloStore.getState().deshacer();
    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.tipo).toBe(
      "permanente",
    );
  });
});

describe("DialogoHipotesis: eliminar", () => {
  it("eliminar una hipotesis sin cargas la borra de inmediato", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    await user.click(within(dialogo).getByRole("button", { name: "Eliminar hipótesis" }));

    expect(hipotesis().some((h) => h.id === "hip-cargas-muertas")).toBe(false);
    expect(hipotesis()).toHaveLength(1);
  });

  it("eliminar una hipotesis con cargas pide confirmacion y al confirmar arrastra las cargas", async () => {
    const user = userEvent.setup();
    // Modelo con una carga sobre hip-cargas-muertas.
    const m: Modelo = crearModeloVacio();
    m.nudos.push({ id: "n1", x: 0, y: 0 });
    m.cargas.push({
      id: "c1",
      tipo: "lineal",
      ambito: "n1",
      valor: 10,
      hipotesisId: "hip-cargas-muertas",
    });
    modeloStore.getState().cargarModelo(m);
    vistaStore.getState().abrirDialogo("hipotesis");
    render(<DialogoHipotesis />);

    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));
    await user.click(within(dialogo).getByRole("button", { name: "Eliminar hipótesis" }));

    // No borra todavia: aparece la confirmacion con el alcance.
    expect(hipotesis().some((h) => h.id === "hip-cargas-muertas")).toBe(true);
    const confirm = screen.getByRole("dialog", { name: /Eliminar la hipótesis/ });
    expect(within(confirm).getByText(/1 carga/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Eliminar" }));
    expect(hipotesis().some((h) => h.id === "hip-cargas-muertas")).toBe(false);
    expect(modelo().cargas).toHaveLength(0);
  });
});
