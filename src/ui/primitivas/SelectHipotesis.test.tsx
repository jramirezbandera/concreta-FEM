// Tests de componente de SelectHipotesis (feature-13, T3.1). RTL en el project
// `jsdom`. SelectHipotesis es una primitiva Radix Select sobre las hipotesis de la
// OBRA (`modelo.hipotesis`, Capa 1): etiqueta visible = `nombre`, value = `id`.
// Verifican: placeholder con valor null, valor seleccionado mostrado, render de las
// opciones de la obra y disparo de onCambio con el id correcto. Calcado del test de
// SelectMaterial, salvo que las opciones vienen del modeloStore (no de un catalogo
// fijo): reset del store en beforeEach.
//
// Nota jsdom/Radix: abrir el listbox por PUNTERO es inestable (scroll virtual +
// PointerEvent). Por eso se abre con TECLADO (Enter sobre el trigger), que en jsdom
// es estable, y se selecciona el item por su texto. Mismo enfoque que el resto del
// repo (ver SelectMaterial.test.tsx / DialogoGruposYPlantas.test.tsx).
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectHipotesis } from "./SelectHipotesis";
import { modeloStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";

// jsdom no implementa la PointerCapture API ni scrollIntoView, de las que depende
// Radix Select al abrir el listbox. Se rellenan como no-ops (patron estandar para
// testar Radix Select bajo jsdom) para poder ejercitar el flujo de apertura/seleccion.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  // El modelo vacio siembra "Cargas muertas" (hip-cargas-muertas) y "Sobrecarga de
  // uso" (hip-sobrecarga-uso): las dos opciones por defecto del selector.
  modeloStore.getState().cargarModelo(crearModeloVacio());
});

describe("SelectHipotesis", () => {
  it("con valor null muestra el placeholder 'Hipótesis…'", () => {
    render(<SelectHipotesis valor={null} onCambio={() => {}} />);
    expect(screen.getByText("Hipótesis…")).toBeInTheDocument();
  });

  it("con valor muestra el nombre de la hipotesis seleccionada", () => {
    render(<SelectHipotesis valor="hip-sobrecarga-uso" onCambio={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Sobrecarga de uso");
    expect(screen.queryByText("Hipótesis…")).toBeNull();
  });

  it("usa 'Hipótesis' como aria-label por defecto y respeta la etiqueta dada", () => {
    const { rerender } = render(<SelectHipotesis valor={null} onCambio={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Hipótesis" })).toBeInTheDocument();
    rerender(
      <SelectHipotesis valor={null} onCambio={() => {}} etiqueta="Hipótesis de la carga" />,
    );
    expect(
      screen.getByRole("combobox", { name: "Hipótesis de la carga" }),
    ).toBeInTheDocument();
  });

  it("al abrir lista las hipotesis de la obra y onCambio recibe el id", async () => {
    const user = userEvent.setup();
    const onCambio = vi.fn();
    render(<SelectHipotesis valor={null} onCambio={onCambio} />);

    // Abrir el listbox: foco al trigger + Enter (estable en jsdom con los polyfills
    // de PointerCapture; un click ademas de Enter lo cerraria al toggle).
    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    // E2(b): las hipotesis ASIGNABLES (no automaticas) aparecen; la automatica de
    // peso propio se OCULTA (no es asignable como ambito de una carga de usuario).
    for (const h of modeloStore.getState().getModelo().hipotesis) {
      if (h.automatica) continue;
      expect(within(listbox).getByText(h.nombre)).toBeInTheDocument();
    }

    // Elegir "Cargas muertas": onCambio se dispara con su id.
    await user.click(within(listbox).getByText("Cargas muertas"));
    expect(onCambio).toHaveBeenCalledWith("hip-cargas-muertas");
  });

  it("FIX#2: con valor en la hipotesis automatica muestra su nombre marcado, no el placeholder", () => {
    // Una carga heredada/importada puede colgar de la AUTOMATICA (pasa Zod, solo se
    // bloquea al calcular). La automatica no esta entre las opciones asignables: sin
    // el fix Radix mostraria el placeholder y ocultaria la asignacion incorrecta.
    render(<SelectHipotesis valor="hip-peso-propio" onCambio={() => {}} />);
    // El trigger muestra el nombre real (marcado "no asignable"), NO el placeholder.
    expect(screen.getByRole("combobox")).toHaveTextContent(
      "Peso propio (no asignable)",
    );
    expect(screen.queryByText("Hipótesis…")).toBeNull();
  });

  it("FIX#2: con valor que no existe en la obra muestra '(hipótesis desconocida)'", () => {
    render(<SelectHipotesis valor="hip-inexistente" onCambio={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(
      "(hipótesis desconocida)",
    );
    expect(screen.queryByText("Hipótesis…")).toBeNull();
  });

  it("E2(b): oculta la hipotesis automatica de peso propio (no asignable)", async () => {
    const user = userEvent.setup();
    render(<SelectHipotesis valor={null} onCambio={() => {}} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    // El modelo vacio siembra la automatica "Peso propio" (automatica:true): no debe
    // ofrecerse como opcion del selector.
    expect(within(listbox).queryByText("Peso propio")).toBeNull();
    // Las dos asignables sembradas si estan.
    expect(within(listbox).getByText("Cargas muertas")).toBeInTheDocument();
    expect(within(listbox).getByText("Sobrecarga de uso")).toBeInTheDocument();
  });
});
