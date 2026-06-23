// Tests de componente del InspectorViga (feature-12, T2.2). RTL en el project
// `jsdom`. El inspector es AUTOCONTROLADO: se muestra cuando hay EXACTAMENTE una
// viga seleccionada (seleccionStore.seleccion). Es SOLO-PROPIEDADES: no edita
// geometria (nudoI/nudoJ). Stores singleton de modulo -> reset en beforeEach (mismo
// patron que InspectorPilar.test.tsx). Verifican el COMMIT EN VIVO (el extremo I/J
// via Segmentado/radio, estable en jsdom) y el borrado con limpieza de seleccion.
//
// Nota jsdom/Radix: los Selects de Radix (SelectSeccion/SelectMaterial) son
// inestables al abrir el listbox en jsdom (PointerCapture + scroll virtual). El
// commit en vivo se ejercita por el Segmentado del extremo (mismo mecanismo de
// commit), evitando esa fragilidad. Los polyfills de PointerCapture/scrollIntoView se
// instalan igual que en SelectMaterial.test/InspectorPilar para que el render del
// Radix Select no reviente.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorViga } from "./InspectorViga";
import { modeloStore, seleccionStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

// jsdom no implementa PointerCapture API ni scrollIntoView, de las que depende Radix
// Select al renderizar/abrir el listbox. Se rellenan como no-ops (patron estandar).
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Construye un modelo con un grupo, una planta, dos nudos y una viga valida que los
// une, con seccion/material del catalogo de la biblioteca (IPE200/S275), igual que
// el fixture del inspector de pilares.
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
  m.nudos.push(
    { id: "n1", x: 0, y: 0 },
    { id: "n2", x: 5, y: 0 },
  );
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
});

const modelo = () => modeloStore.getState().getModelo();
const viga = () => modelo().vigas.find((v) => v.id === "V-1");

// Carga un modelo con una viga y la deja seleccionada; renderiza el inspector.
function renderConVigaSeleccionada() {
  modeloStore.getState().cargarModelo(modeloConViga());
  seleccionStore.getState().seleccionar(["V-1"]);
  render(<InspectorViga />);
}

describe("InspectorViga: visibilidad", () => {
  it("no se renderiza sin seleccion", () => {
    modeloStore.getState().cargarModelo(modeloConViga());
    const { container } = render(<InspectorViga />);
    expect(container.querySelector(".cx-inspector-viga")).toBeNull();
  });

  it("no se renderiza con seleccion multiple", () => {
    modeloStore.getState().cargarModelo(modeloConViga());
    seleccionStore.getState().seleccionar(["V-1", "otro"]);
    const { container } = render(<InspectorViga />);
    expect(container.querySelector(".cx-inspector-viga")).toBeNull();
  });

  it("no se renderiza si el id seleccionado no es una viga del modelo", () => {
    modeloStore.getState().cargarModelo(modeloConViga());
    seleccionStore.getState().seleccionar(["no-existe"]);
    const { container } = render(<InspectorViga />);
    expect(container.querySelector(".cx-inspector-viga")).toBeNull();
  });

  it("muestra el panel con la cabecera y los controles de la viga seleccionada", () => {
    renderConVigaSeleccionada();
    expect(screen.getByText("Viga V1")).toBeInTheDocument();
    // Los dos extremos y el tirante estan presentes (radiogroups por aria-label).
    expect(screen.getByRole("radiogroup", { name: "Extremo I" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Extremo J" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Tirante" })).toBeInTheDocument();
  });
});

describe("InspectorViga: commit en vivo", () => {
  it("cambiar el extremo I a articulado despacha editarViga y persiste", async () => {
    const user = userEvent.setup();
    renderConVigaSeleccionada();

    const grupoI = screen.getByRole("radiogroup", { name: "Extremo I" });
    await user.click(within(grupoI).getByRole("radio", { name: "Articulado" }));

    expect(viga()!.extremoI).toBe("articulado");
    // El extremo J no se toca (commit por campo).
    expect(viga()!.extremoJ).toBe("empotrado");
  });

  it("cambiar el extremo J a articulado solo afecta a J", async () => {
    const user = userEvent.setup();
    renderConVigaSeleccionada();

    const grupoJ = screen.getByRole("radiogroup", { name: "Extremo J" });
    await user.click(within(grupoJ).getByRole("radio", { name: "Articulado" }));

    expect(viga()!.extremoJ).toBe("articulado");
    expect(viga()!.extremoI).toBe("empotrado");
  });

  it("activar el tirante despacha el cambio", async () => {
    const user = userEvent.setup();
    renderConVigaSeleccionada();

    const grupoT = screen.getByRole("radiogroup", { name: "Tirante" });
    await user.click(within(grupoT).getByRole("radio", { name: "Sí" }));

    expect(viga()!.tirante).toBe(true);
  });

  it("si la viga es tirante, los extremos se muestran fijos en Articulado y deshabilitados", () => {
    // Codex #4: el discretizador fuerza ambos extremos articulados en un tirante;
    // la UI no debe dejar editarlos (ni ignorar en silencio un 'Empotrado').
    const m = modeloConViga();
    const v = m.vigas.find((x) => x.id === "V-1")!;
    v.tirante = true;
    v.extremoI = "empotrado"; // valor almacenado: la UI debe MOSTRAR articulado igual
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["V-1"]);
    render(<InspectorViga />);

    const grupoI = screen.getByRole("radiogroup", { name: "Extremo I" });
    const grupoJ = screen.getByRole("radiogroup", { name: "Extremo J" });
    // Deshabilitados: los radios no son interactuables.
    expect(within(grupoI).getByRole("radio", { name: "Articulado" })).toBeDisabled();
    expect(within(grupoJ).getByRole("radio", { name: "Articulado" })).toBeDisabled();
    // Se muestra "Articulado" activo aunque el valor almacenado sea "empotrado".
    expect(
      within(grupoI).getByRole("radio", { name: "Articulado" }),
    ).toHaveAttribute("data-state", "on");
  });

  it("deshacer revierte la edición del extremo", async () => {
    const user = userEvent.setup();
    renderConVigaSeleccionada();

    const grupoI = screen.getByRole("radiogroup", { name: "Extremo I" });
    await user.click(within(grupoI).getByRole("radio", { name: "Articulado" }));
    expect(viga()!.extremoI).toBe("articulado");

    modeloStore.getState().deshacer();
    expect(viga()!.extremoI).toBe("empotrado");
  });
});

describe("InspectorViga: borrado", () => {
  it("borrar una viga sin cargas la elimina de inmediato y limpia la selección", async () => {
    const user = userEvent.setup();
    renderConVigaSeleccionada();

    await user.click(screen.getByRole("button", { name: "Eliminar viga" }));

    expect(modelo().vigas).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });

  it("borrar una viga con cargas pide confirmación y al confirmar arrastra las cargas", async () => {
    const user = userEvent.setup();
    const m = modeloConViga();
    m.cargas.push({
      id: "c1",
      tipo: "lineal",
      ambito: "V-1",
      valor: 10,
      hipotesisId: "h1",
    });
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["V-1"]);
    render(<InspectorViga />);

    await user.click(screen.getByRole("button", { name: "Eliminar viga" }));
    // No borra todavia: aparece la confirmacion con el alcance.
    expect(modelo().vigas).toHaveLength(1);
    const confirm = screen.getByRole("dialog", { name: /Eliminar la viga/ });
    expect(within(confirm).getByText(/1 carga asociada/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Eliminar" }));
    expect(modelo().vigas).toHaveLength(0);
    expect(modelo().cargas).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });
});
