// Tests de componente de SeccionCargas (feature-13, T3.1). RTL en el project
// `jsdom`. SeccionCargas se ejercita ATRAVES del InspectorViga (su contenedor real:
// el bloque de cargas vive dentro del inspector de la viga seleccionada). Verifican:
// estado vacio, anadir una carga lineal con la hipotesis por defecto, listarla con su
// valor+sufijo+hipotesis, y eliminarla. Stores singleton -> reset en beforeEach,
// incluido el defaultsCarga de vistaStore (persiste entre tests).
//
// Nota jsdom/Radix: el SelectHipotesis es un Radix Select inestable al ABRIR el
// listbox en jsdom (PointerCapture + scroll virtual). No hace falta abrirlo: la
// carga se crea con la hipotesis PRESELECCIONADA por defecto (defaultsCarga o la
// primera del modelo), asi que el flujo de anadir no toca el Select. Los polyfills
// de PointerCapture/scrollIntoView se instalan igual que en el resto del repo para
// que el render del Radix Select no reviente.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorViga } from "../entradaVigas/InspectorViga";
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Modelo con una viga valida (igual fixture que InspectorViga.test). El modelo vacio
// trae las dos hipotesis sembradas (Cargas muertas, Sobrecarga de uso).
function modeloConViga(): Modelo {
  const m = crearModeloVacio();
  m.grupos.push({
    id: "g1",
    nombre: "G1",
    categoriaUso: "A",
    sobrecargaUso: 2,
    cargasMuertas: 1,
  });
  m.plantas.push({ id: "pl1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" });
  m.nudos.push({ id: "n1", x: 0, y: 0 }, { id: "n2", x: 5, y: 0 });
  m.vigas.push({
    id: "V-1",
    nombre: "V1",
    plantaId: "pl1",
    nudoI: "n1",
    nudoJ: "n2",
    seccionId: "IPE200",
    materialId: "S275",
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  });
  return m;
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  seleccionStore.getState().limpiar();
  // defaultsCarga persiste en vistaStore (singleton): reset a hipotesisId null para
  // que cada test parta de la primera hipotesis del modelo (hip-cargas-muertas).
  vistaStore.getState().setDefaultsCarga({ tipo: "lineal", valor: 0, hipotesisId: null });
});

const modelo = () => modeloStore.getState().getModelo();
const cargas = () => modelo().cargas;

function renderConViga() {
  modeloStore.getState().cargarModelo(modeloConViga());
  seleccionStore.getState().seleccionar(["V-1"]);
  render(<InspectorViga />);
}

describe("SeccionCargas (via InspectorViga)", () => {
  it("muestra el bloque de cargas vacio cuando la viga no tiene cargas", () => {
    renderConViga();
    expect(screen.getByText("Cargas")).toBeInTheDocument();
    expect(screen.getByText("Sin cargas.")).toBeInTheDocument();
  });

  it("anadir una carga lineal con valor crea la carga sobre la viga con la hipotesis por defecto", async () => {
    const user = userEvent.setup();
    renderConViga();

    const valor = screen.getByLabelText("Valor");
    await user.clear(valor);
    await user.type(valor, "12");
    await user.tab(); // commit del valor
    await user.click(screen.getByRole("button", { name: "Añadir carga" }));

    expect(cargas()).toHaveLength(1);
    const c = cargas()[0];
    expect(c.ambito).toBe("V-1");
    expect(c.tipo).toBe("lineal");
    expect(c.valor).toBe(12);
    // Hipotesis por defecto = primera del modelo (hip-cargas-muertas).
    expect(c.hipotesisId).toBe("hip-cargas-muertas");
  });

  it("no anade una carga con valor cero y muestra el error", async () => {
    const user = userEvent.setup();
    renderConViga();

    // El valor arranca en 0 (defaultsCarga). Anadir sin tocarlo debe bloquearse.
    await user.click(screen.getByRole("button", { name: "Añadir carga" }));

    expect(cargas()).toHaveLength(0);
    expect(screen.getByText("El valor de la carga no puede ser cero.")).toBeInTheDocument();
  });

  it("lista una carga existente con su valor, sufijo e hipotesis", () => {
    const m = modeloConViga();
    m.cargas.push({
      id: "c1",
      tipo: "lineal",
      ambito: "V-1",
      valor: 8,
      hipotesisId: "hip-sobrecarga-uso",
    });
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["V-1"]);
    render(<InspectorViga />);

    const lista = document.querySelector(".cx-cargas__lista") as HTMLElement;
    expect(within(lista).getByText("Lineal")).toBeInTheDocument();
    expect(within(lista).getByText("8 kN/m")).toBeInTheDocument();
    expect(within(lista).getByText("Sobrecarga de uso")).toBeInTheDocument();
  });

  it("eliminar una carga la quita del modelo (commit en vivo, reversible)", async () => {
    const user = userEvent.setup();
    const m = modeloConViga();
    m.cargas.push({
      id: "c1",
      tipo: "lineal",
      ambito: "V-1",
      valor: 8,
      hipotesisId: "hip-cargas-muertas",
    });
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["V-1"]);
    render(<InspectorViga />);

    expect(cargas()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Eliminar carga Lineal 8/ }));
    expect(cargas()).toHaveLength(0);

    // Reversible: undo restituye la carga.
    modeloStore.getState().deshacer();
    expect(cargas()).toHaveLength(1);
  });
});
