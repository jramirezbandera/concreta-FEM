// Tests de componente del InspectorPano (F3, T3.2). RTL en el project `jsdom`. El
// inspector es AUTOCONTROLADO: se muestra con EXACTAMENTE un paño seleccionado. Es
// SOLO-PROPIEDADES (no edita el perimetro). Stores singleton -> reset en beforeEach.
// Verifican: visibilidad, commit en vivo (apoyo de borde via Segmentado/radio, estable
// en jsdom; espesor en mm via blur), la carga superficial (kN/m²) y el borrado con
// limpieza de seleccion. Polyfills de PointerCapture igual que InspectorViga.test.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorPano } from "./InspectorPano";
import { modeloStore, seleccionStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import { listarMateriales } from "../../biblioteca";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const MAT_OK = listarMateriales()[0]!.id;

// Modelo con grupo/planta, 4 nudos del perimetro y un paño losa valido.
function modeloConPano(): Modelo {
  const m = crearModeloVacio();
  m.grupos.push({
    id: "g1",
    nombre: "G1",
    categoriaUso: "A",
    sobrecargaUso: 2,
    cargasMuertas: 1,
  });
  m.plantas.push({ id: "pl1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" });
  m.nudos.push(
    { id: "n1", x: 0, y: 0 },
    { id: "n2", x: 4, y: 0 },
    { id: "n3", x: 4, y: 3 },
    { id: "n4", x: 0, y: 3 },
  );
  m.panos.push({
    id: "F-1",
    nombre: "F1",
    tipo: "losa",
    plantaId: "pl1",
    perimetro: ["n1", "n2", "n3", "n4"],
    espesor: 0.25,
    materialId: MAT_OK,
    tamMalla: 0.5,
    bordeApoyo: "simple",
  });
  return m;
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  seleccionStore.getState().limpiar();
});

const modelo = () => modeloStore.getState().getModelo();
const pano = () => modelo().panos.find((p) => p.id === "F-1");

function renderConPanoSeleccionado() {
  modeloStore.getState().cargarModelo(modeloConPano());
  seleccionStore.getState().seleccionar(["F-1"]);
  render(<InspectorPano />);
}

describe("InspectorPano: visibilidad", () => {
  it("no se renderiza sin seleccion", () => {
    modeloStore.getState().cargarModelo(modeloConPano());
    const { container } = render(<InspectorPano />);
    expect(container.querySelector(".cx-inspector-pano")).toBeNull();
  });

  it("no se renderiza si el id seleccionado no es un paño", () => {
    modeloStore.getState().cargarModelo(modeloConPano());
    seleccionStore.getState().seleccionar(["no-existe"]);
    const { container } = render(<InspectorPano />);
    expect(container.querySelector(".cx-inspector-pano")).toBeNull();
  });

  it("muestra la cabecera y el control de apoyo de borde del paño seleccionado", () => {
    renderConPanoSeleccionado();
    expect(screen.getByText("Paño F1")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Apoyo de borde del paño" })).toBeInTheDocument();
  });
});

describe("InspectorPano: commit en vivo", () => {
  it("cambiar el apoyo de borde a Empotrado despacha editarPano y persiste", async () => {
    const user = userEvent.setup();
    renderConPanoSeleccionado();
    const grupo = screen.getByRole("radiogroup", { name: "Apoyo de borde del paño" });
    await user.click(within(grupo).getByRole("radio", { name: "Empotrado" }));
    expect(pano()!.bordeApoyo).toBe("empotrado");
  });

  it("editar el espesor (mm) lo convierte a m y persiste", async () => {
    const user = userEvent.setup();
    renderConPanoSeleccionado();
    // El campo muestra 250 (mm = 0.25 m). Lo cambiamos a 300 mm -> 0.3 m.
    const input = screen.getByLabelText("Espesor") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "300");
    await user.tab(); // blur -> commit
    expect(pano()!.espesor).toBeCloseTo(0.3, 6);
  });

  it("deshacer revierte la edición del apoyo de borde", async () => {
    const user = userEvent.setup();
    renderConPanoSeleccionado();
    const grupo = screen.getByRole("radiogroup", { name: "Apoyo de borde del paño" });
    await user.click(within(grupo).getByRole("radio", { name: "Empotrado" }));
    expect(pano()!.bordeApoyo).toBe("empotrado");
    modeloStore.getState().deshacer();
    expect(pano()!.bordeApoyo).toBe("simple");
  });
});

describe("InspectorPano: carga superficial", () => {
  it("añadir una carga superficial (kN/m²) la crea sobre el paño", async () => {
    const user = userEvent.setup();
    renderConPanoSeleccionado();
    // Bloque "Cargas superficiales": valor + Añadir carga.
    const valor = screen.getByLabelText("Valor") as HTMLInputElement;
    await user.clear(valor);
    await user.type(valor, "5");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Añadir carga" }));

    const cargas = modelo().cargas.filter((c) => c.ambito === "F-1");
    expect(cargas).toHaveLength(1);
    expect(cargas[0]!.tipo).toBe("superficial");
    expect(cargas[0]!.valor).toBe(5);
  });
});

describe("InspectorPano: borrado", () => {
  it("borrar un paño sin cargas lo elimina y limpia la selección", async () => {
    const user = userEvent.setup();
    renderConPanoSeleccionado();
    await user.click(screen.getByRole("button", { name: "Eliminar paño" }));
    expect(modelo().panos).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });

  it("borrar un paño con cargas pide confirmación y al confirmar arrastra las cargas", async () => {
    const user = userEvent.setup();
    const m = modeloConPano();
    m.cargas.push({
      id: "cs1",
      tipo: "superficial",
      ambito: "F-1",
      valor: 5,
      hipotesisId: "hip-cargas-muertas",
    });
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);

    await user.click(screen.getByRole("button", { name: "Eliminar paño" }));
    expect(modelo().panos).toHaveLength(1); // aun no
    const confirm = screen.getByRole("dialog", { name: /Eliminar el paño/ });
    expect(within(confirm).getByText(/1 carga asociada/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Eliminar" }));
    expect(modelo().panos).toHaveLength(0);
    expect(modelo().cargas).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });
});
