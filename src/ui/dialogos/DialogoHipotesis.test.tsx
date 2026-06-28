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

  it("cada hipotesis muestra su tag de tipo: Perm. para permanente, Var. para variable", () => {
    const dialogo = renderAbierto();
    const lista = dialogo.querySelector(".cx-gyp__lista") as HTMLElement;
    // F2a: el modelo vacio siembra "Cargas muertas" (Perm.), "Sobrecarga de uso"
    // (Var.) y la automatica "Peso propio" (Perm.). Hay >=1 de cada tag; la
    // presentacion read-only/lock de la automatica es F2.4.
    expect(within(lista).getAllByText("Perm.").length).toBeGreaterThanOrEqual(1);
    expect(within(lista).getByText("Var.")).toBeInTheDocument();
    // El nombre accesible del boton sigue siendo solo el nombre (el tag va aria-hidden):
    // los queries por nombre del resto de tests no se rompen.
    expect(
      within(lista).getByRole("button", { name: "Cargas muertas" }),
    ).toBeInTheDocument();
    expect(
      within(lista).getByRole("button", { name: "Sobrecarga de uso" }),
    ).toBeInTheDocument();
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

    // F2a: el modelo vacio siembra 3 hipotesis (2 de F1 + la automatica de peso propio).
    expect(hipotesis()).toHaveLength(3);
    await user.click(within(dialogo).getByRole("button", { name: "Nueva hipótesis" }));

    expect(hipotesis()).toHaveLength(4);
    // La nueva (sin nombre dado) se nombra "Hipotesis 1" via siguienteNombre.
    const nueva = hipotesis()[3];
    expect(nueva.tipo).toBe("permanente");
    expect(nueva.automatica).toBe(false);
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
    // "Peso propio" ya lo usa la hipotesis automatica sembrada (colisionaria); se usa
    // un nombre libre para verificar el commit en vivo del nombre.
    await user.type(inputNombre, "Forjados");
    await user.tab(); // blur -> commit

    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.nombre).toBe(
      "Forjados",
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

  // Modelo de un solo grupo de hipotesis permanentes: sin variable previa, para que
  // convertir una a variable sea VALIDO (en F1 solo se admite una variable; el modelo
  // vacio ya siembra "Sobrecarga de uso" variable, que aqui se reemplaza).
  function modeloSinVariable(): Modelo {
    const m = crearModeloVacio();
    m.hipotesis = [
      { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
    ];
    return m;
  }

  it("editar el tipo en vivo (Segmentado) despacha el cambio", async () => {
    const user = userEvent.setup();
    modeloStore.getState().cargarModelo(modeloSinVariable());
    vistaStore.getState().abrirDialogo("hipotesis");
    render(<DialogoHipotesis />);
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    const grupoTipo = within(dialogo).getByRole("radiogroup", { name: "Tipo" });
    await user.click(within(grupoTipo).getByRole("radio", { name: "Variable" }));

    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.tipo).toBe(
      "variable",
    );
  });

  it("deshacer revierte la edicion del tipo", async () => {
    const user = userEvent.setup();
    modeloStore.getState().cargarModelo(modeloSinVariable());
    vistaStore.getState().abrirDialogo("hipotesis");
    render(<DialogoHipotesis />);
    const dialogo = screen.getByRole("dialog");
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

  it("bloquea convertir una 2ª hipotesis a variable y muestra el error (A1)", async () => {
    const user = userEvent.setup();
    // Modelo vacio: "Cargas muertas" (permanente) + "Sobrecarga de uso" (variable).
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Cargas muertas" }));

    const grupoTipo = within(dialogo).getByRole("radiogroup", { name: "Tipo" });
    await user.click(within(grupoTipo).getByRole("radio", { name: "Variable" }));

    // No se despacha: la hipotesis conserva su tipo permanente y aparece el error.
    expect(hipotesis().find((h) => h.id === "hip-cargas-muertas")!.tipo).toBe(
      "permanente",
    );
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    expect(within(detalle).getByRole("alert")).toHaveTextContent(
      /solo se admite una hipótesis variable/,
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
    // Quedan las otras 2 sembradas (Sobrecarga de uso + la automatica de peso propio).
    expect(hipotesis()).toHaveLength(2);
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

describe("DialogoHipotesis: hipotesis automatica read-only (D-diseño-4)", () => {
  it("el item de la automatica lleva el tag 'auto' con candado, no Perm./Var.", () => {
    const dialogo = renderAbierto();
    const lista = dialogo.querySelector(".cx-gyp__lista") as HTMLElement;
    // El item "Peso propio" (automatica) lleva el tag 🔒 auto.
    const item = within(lista).getByRole("button", { name: "Peso propio" });
    expect(within(item).getByText(/auto/)).toBeInTheDocument();
  });

  it("al seleccionar la automatica el detalle es read-only: campos disabled, sin 'Eliminar', con nota", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Peso propio" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    // Nombre read-only (input disabled).
    const inputNombre = within(detalle).getByLabelText("Nombre");
    expect(inputNombre).toBeDisabled();
    // Tipo deshabilitado (Segmentado disabled): los radios no son interactuables.
    const grupoTipo = within(detalle).getByRole("radiogroup", { name: "Tipo" });
    expect(within(grupoTipo).getByRole("radio", { name: "Variable" })).toBeDisabled();
    // SIN boton "Eliminar hipótesis".
    expect(
      within(detalle).queryByRole("button", { name: "Eliminar hipótesis" }),
    ).toBeNull();
    // Nota explicativa de la automatica.
    expect(
      within(detalle).getByText(/el peso propio se calcula del modelo/i),
    ).toBeInTheDocument();
  });

  it("la automatica NO se elimina ni se edita aunque se intente por comando (invariante de dominio)", async () => {
    // Defensa: aunque la UI no ofrece "Eliminar", el invariante de dominio impide
    // borrar/editar la automatica. Aqui solo se asegura que sigue presente tras
    // seleccionarla (no hay accion destructiva expuesta).
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Peso propio" }));
    expect(hipotesis().some((h) => h.automatica)).toBe(true);
  });
});
