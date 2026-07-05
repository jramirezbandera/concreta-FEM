// Tests de componente del DialogoOpcionesAnalisis (F2.4). RTL en el project `jsdom`.
// El dialogo es AUTOCONTROLADO: se muestra cuando vistaStore.dialogoActivo ===
// "opcionesAnalisis". Stores singleton de modulo -> reset en beforeEach (mismo patron
// que DialogoHipotesis.test.tsx). Verifican: el commit en vivo del tipo/peso propio;
// D-diseño-3 (P-Δ auto-desmarca + DESHABILITA "Comprobar estática" + muestra la nota,
// y al volver a lineal/general RESTAURA el valor previo); el comando reversible.
//
// Nota jsdom/Radix: el tipo se elige con un Segmentado (ToggleGroup), que expone
// role radiogroup/radio y es ESTABLE en jsdom (a diferencia del Radix Select). Los
// checkboxes son <input type=checkbox> nativos (tambien estables).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogoOpcionesAnalisis } from "./DialogoOpcionesAnalisis";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().cerrarDialogo();
});

function renderAbierto() {
  vistaStore.getState().abrirDialogo("opcionesAnalisis");
  render(<DialogoOpcionesAnalisis />);
  return screen.getByRole("dialog");
}

const analisis = () => modeloStore.getState().getModelo().analisis;

describe("DialogoOpcionesAnalisis: montaje y defaults", () => {
  it("se muestra cuando dialogoActivo === 'opcionesAnalisis'", () => {
    const dialogo = renderAbierto();
    expect(dialogo).toBeInTheDocument();
    expect(within(dialogo).getByText("Tipo de análisis")).toBeInTheDocument();
  });

  it("no se renderiza si el dialogo esta cerrado", () => {
    render(<DialogoOpcionesAnalisis />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("peso propio arranca ON (default del modelo vacio)", () => {
    const dialogo = renderAbierto();
    const peso = within(dialogo).getByRole("checkbox", {
      name: /Incluir el peso propio/,
    });
    expect(peso).toBeChecked();
  });
});

describe("DialogoOpcionesAnalisis: tipo de analisis (commit en vivo)", () => {
  it("cambiar a General despacha el comando", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    const grupo = within(dialogo).getByRole("radiogroup", {
      name: "Tipo de análisis",
    });
    await user.click(within(grupo).getByRole("radio", { name: "General" }));
    expect(analisis().tipo).toBe("general");
  });

  it("cambiar el peso propio despacha el comando", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    const peso = within(dialogo).getByRole("checkbox", {
      name: /Incluir el peso propio/,
    });
    await user.click(peso); // ON -> OFF
    expect(analisis().incluirPesoPropio).toBe(false);
  });
});

describe("DialogoOpcionesAnalisis: D-diseño-3 (check_statics bajo P-Δ)", () => {
  it("elegir P-Δ auto-desmarca y DESHABILITA 'Comprobar estática' + muestra la nota", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    // Arranca con comprobarEstatica:true (default).
    expect(analisis().comprobarEstatica).toBe(true);

    const grupo = within(dialogo).getByRole("radiogroup", {
      name: "Tipo de análisis",
    });
    await user.click(within(grupo).getByRole("radio", { name: "P-Δ" }));

    // Auto-desmarcado en el modelo (el glue lo fuerza a false bajo P-Δ; E6).
    expect(analisis().comprobarEstatica).toBe(false);

    const check = within(dialogo).getByRole("checkbox", {
      name: "Comprobar estática",
    });
    expect(check).toBeDisabled();
    expect(check).not.toBeChecked();
    expect(check).toHaveAttribute("aria-disabled", "true");

    // La nota explicativa aparece y el check la referencia (aria-describedby).
    const nota = within(dialogo).getByText(
      /El análisis P-Δ no realiza la comprobación de equilibrio/,
    );
    expect(nota).toBeInTheDocument();
    expect(check.getAttribute("aria-describedby")).toBe(nota.id);
  });

  it("volver a lineal/general RESTAURA el valor previo de 'Comprobar estática'", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    const grupo = within(dialogo).getByRole("radiogroup", {
      name: "Tipo de análisis",
    });

    // Valor previo = true (default). Pasar a P-Δ lo pone en false (auto-desmarca).
    await user.click(within(grupo).getByRole("radio", { name: "P-Δ" }));
    expect(analisis().comprobarEstatica).toBe(false);

    // Volver a General restaura el valor que tenia antes de P-Δ (true).
    await user.click(within(grupo).getByRole("radio", { name: "General" }));
    expect(analisis().tipo).toBe("general");
    expect(analisis().comprobarEstatica).toBe(true);

    // El check vuelve a estar habilitado y marcado; la nota desaparece.
    const check = within(dialogo).getByRole("checkbox", {
      name: "Comprobar estática",
    });
    expect(check).toBeEnabled();
    expect(check).toBeChecked();
    expect(
      within(dialogo).queryByText(/no realiza la comprobación de equilibrio/),
    ).toBeNull();
  });

  it("restaura el valor FALSE previo: desmarcar, ir a P-Δ y volver deja en false", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    const grupo = within(dialogo).getByRole("radiogroup", {
      name: "Tipo de análisis",
    });

    // Desmarcar "Comprobar estática" con tipo lineal (valor previo = false).
    const check = within(dialogo).getByRole("checkbox", {
      name: "Comprobar estática",
    });
    await user.click(check);
    expect(analisis().comprobarEstatica).toBe(false);

    // P-Δ y vuelta a lineal: el valor previo (false) se conserva.
    await user.click(within(grupo).getByRole("radio", { name: "P-Δ" }));
    await user.click(within(grupo).getByRole("radio", { name: "Lineal" }));
    expect(analisis().tipo).toBe("lineal");
    expect(analisis().comprobarEstatica).toBe(false);
  });
});

describe("DialogoOpcionesAnalisis: T-f3-masa-placa (nota P-Δ con losas)", () => {
  // Modelo con una losa: dispara la nota de honestidad del 2º orden (el efecto de la
  // propia losa no se considera; el de los pilares, sí). El diálogo solo lee
  // modelo.panos.length, así que basta un paño bien formado (no se discretiza aquí).
  function cargarModeloConPano() {
    const m = crearModeloVacio();
    m.panos = [
      {
        id: "pa1",
        nombre: "Losa 1",
        tipo: "losa",
        plantaId: "p1",
        perimetro: ["n1", "n2", "n3", "n4"],
        materialId: "m1",
        espesor: 0.25,
        tamMalla: 0.5,
        bordeApoyo: "simple",
      },
    ];
    modeloStore.getState().cargarModelo(m);
  }

  it("sin losas la nota NO aparece", () => {
    const dialogo = renderAbierto();
    expect(
      within(dialogo).queryByText(/el efecto de segundo orden de la propia losa/i),
    ).toBeNull();
  });

  it("con losas Y tipo P-Δ muestra la nota de honestidad junto al tipo de análisis", async () => {
    // La nota habla de "segundo orden": solo acompaña a la opción P-Δ elegida
    // (guardián T4.4, nota 1). Se elige P-Δ por la UI (patrón D-diseño-3).
    const user = userEvent.setup();
    cargarModeloConPano();
    const dialogo = renderAbierto();
    const grupo = within(dialogo).getByRole("radiogroup", {
      name: "Tipo de análisis",
    });
    await user.click(within(grupo).getByRole("radio", { name: "P-Δ" }));
    expect(
      within(dialogo).getByText(
        /Con losas, el efecto de segundo orden de la propia losa no se considera/i,
      ),
    ).toBeInTheDocument();
  });

  it("con losas pero tipo Lineal la nota NO aparece (el 2º orden no aplica)", () => {
    cargarModeloConPano(); // crearModeloVacio deja el tipo estático por defecto (no P-Δ)
    const dialogo = renderAbierto();
    expect(
      within(dialogo).queryByText(/el efecto de segundo orden de la propia losa/i),
    ).toBeNull();
  });
});

describe("DialogoOpcionesAnalisis: D18 vista previa de combinaciones", () => {
  it("muestra la seccion 'Combinaciones que se generarán' con ELU y ELS", () => {
    const dialogo = renderAbierto();
    expect(
      within(dialogo).getByText("Combinaciones que se generarán"),
    ).toBeInTheDocument();
    // Etiquetas largas legibles (no jerga).
    expect(within(dialogo).getByText("E.L.U. (resistencia)")).toBeInTheDocument();
    expect(within(dialogo).getByText("E.L.S. (servicio)")).toBeInTheDocument();
  });

  it("las formulas salen de las hipotesis reales (modelo vacio: 1,35·G + 1,50·Q / 1,00·G + 1,00·Q)", () => {
    const dialogo = renderAbierto();
    // Coeficientes derivados de generarCombos (biblioteca gamma), NO escritos en la UI.
    expect(within(dialogo).getByText("1,35·G + 1,50·Q")).toBeInTheDocument();
    expect(within(dialogo).getByText("1,00·G + 1,00·Q")).toBeInTheDocument();
  });

  it("refleja el modelo real: sin hipotesis variables, ELU no muestra termino Q", () => {
    // Modelo con solo permanentes: la vista previa NO inventa una Q.
    const m = crearModeloVacio();
    m.hipotesis = m.hipotesis.filter((h) => h.tipo === "permanente");
    modeloStore.getState().cargarModelo(m);
    const dialogo = renderAbierto();
    expect(within(dialogo).getByText("1,35·G")).toBeInTheDocument();
    // No debe existir la formula con Q del modelo vacio.
    expect(within(dialogo).queryByText("1,35·G + 1,50·Q")).toBeNull();
  });
});

describe("DialogoOpcionesAnalisis: undo/redo", () => {
  it("deshacer revierte el cambio de tipo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    const grupo = within(dialogo).getByRole("radiogroup", {
      name: "Tipo de análisis",
    });
    await user.click(within(grupo).getByRole("radio", { name: "General" }));
    expect(analisis().tipo).toBe("general");

    modeloStore.getState().deshacer();
    expect(analisis().tipo).toBe("lineal");
  });
});
