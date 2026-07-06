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
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
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

// Modelo con planta, 4 nudos del perimetro y un paño losa valido. La planta lleva
// las cargas automaticas (F3.4; antes vivian en el grupo): sobrecargaUso=2,
// cargasMuertas=1 (kN/m²) para conservar la Capa 2 y la linea informativa.
function modeloConPano(): Modelo {
  const m = crearModeloVacio();
  m.plantas.push({
    id: "pl1", nombre: "Planta 1", cota: 3, altura: 3,
    categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1,
  });
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

// Losa PLANA (F2.3): el fixture anterior + una planta base (cota 0) y `n` pilares
// ESTRICTAMENTE interiores al rectangulo del paño (0..4 x 0..3) que alcanzan su cota.
// El detector pilaresInterioresBajoPano solo mira geometria (plantas + x/y + perimetro),
// no seccion/material, asi que basta con ids coherentes.
function modeloConLosaPlana(nPilares: number): Modelo {
  const m = modeloConPano();
  // Planta base sin paños: cargas automaticas inertes (0/0).
  m.plantas.push({
    id: "pl0", nombre: "Cimentación", cota: 0, altura: 3,
    categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0,
  });
  // Posiciones interiores distintas (dentro de 0<x<4, 0<y<3), separadas de sobra.
  const pos = [
    { x: 1, y: 1 },
    { x: 3, y: 2 },
    { x: 2, y: 1.5 },
  ];
  for (let i = 0; i < nPilares; i++) {
    const p = pos[i]!;
    m.pilares.push({
      id: `PIN-${i}`,
      nombre: `Pi${i}`,
      x: p.x,
      y: p.y,
      plantaInicial: "pl0",
      plantaFinal: "pl1",
      seccionId: "s-pilar",
      materialId: MAT_OK,
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    });
  }
  return m;
}

// Variante UNIDIRECCIONAL del fixture: mismo rectangulo/planta pero tipo
// "unidireccional" con sus campos (T4.1). El discretizador no interviene en estos
// tests de UI: basta con que el paño porte los campos uni.
function modeloConPanoUni(): Modelo {
  const m = modeloConPano();
  m.panos = m.panos.map((p) =>
    p.id === "F-1"
      ? {
          ...p,
          tipo: "unidireccional" as const,
          direccionViguetas: "x" as const,
          intereje: 0.7,
          canto: 0.3,
          anchoNervio: 0.12,
          pesoPropio: 4,
        }
      : p,
  );
  return m;
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  seleccionStore.getState().limpiar();
  // El estado vacio (UX-C6) del paño solo aparece en Isovalores (su editor principal;
  // en la pestana de vigas acompaña a la viga y no muestra estado vacio) con la
  // herramienta "seleccion". Fijamos ese contexto explicitamente.
  vistaStore.getState().setPestanaActiva("isovalores");
  vistaStore.getState().setHerramienta("seleccion");
});

const modelo = () => modeloStore.getState().getModelo();
const pano = () => modelo().panos.find((p) => p.id === "F-1");

function renderConPanoSeleccionado() {
  modeloStore.getState().cargarModelo(modeloConPano());
  seleccionStore.getState().seleccionar(["F-1"]);
  render(<InspectorPano />);
}

describe("InspectorPano: visibilidad", () => {
  it("sin seleccion (en Isovalores) muestra el estado vacio que guia a seleccionar (UX-C6)", () => {
    modeloStore.getState().cargarModelo(modeloConPano());
    render(<InspectorPano />);
    expect(screen.getByText("Propiedades")).toBeInTheDocument();
    expect(
      screen.getByText("Selecciona un paño para editar sus propiedades."),
    ).toBeInTheDocument();
  });

  it("con seleccion multiple guia a editar de uno en uno (UX-C6)", () => {
    modeloStore.getState().cargarModelo(modeloConPano());
    seleccionStore.getState().seleccionar(["F-1", "otro"]);
    render(<InspectorPano />);
    expect(
      screen.getByText("2 elementos seleccionados. Edítalos de uno en uno."),
    ).toBeInTheDocument();
  });

  it("con id seleccionado que no es un paño, muestra el estado vacio (no editor)", () => {
    modeloStore.getState().cargarModelo(modeloConPano());
    seleccionStore.getState().seleccionar(["no-existe"]);
    render(<InspectorPano />);
    expect(
      screen.getByText("Selecciona un paño para editar sus propiedades."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Paño /)).toBeNull();
  });

  it("no muestra estado vacio en la pestana de vigas (alli acompaña a la viga)", () => {
    // El paño se monta tambien en la pestana de vigas, pero alli el editor principal es
    // la viga: el estado vacio del paño se replegaria a null para no apilar dos guias.
    modeloStore.getState().cargarModelo(modeloConPano());
    vistaStore.getState().setPestanaActiva("entradaVigas");
    const { container } = render(<InspectorPano />);
    expect(container.querySelector(".cx-inspector-pano")).toBeNull();
  });

  it("muestra la cabecera y el control de apoyo de borde del paño seleccionado", () => {
    renderConPanoSeleccionado();
    expect(screen.getByText("Paño F1")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Apoyo de borde del paño" })).toBeInTheDocument();
  });

  it("UX-C9 (F3.2): comunica que la losa DESCARGA en el portico cuando comparte contorno", () => {
    renderConPanoSeleccionado();
    expect(
      screen.getByText(/descarga en las vigas y pilares de su contorno/i),
    ).toBeInTheDocument();
    // El texto viejo (losa aislada) ya no debe existir: mentiria tras el acople.
    expect(screen.queryByText(/no se transmite a pilares ni vigas/i)).toBeNull();
  });

  it("D-1: muestra las cargas automaticas de la planta con los valores reales (fuente unica)", () => {
    // La planta del fixture (F3.4; antes el grupo): cargasMuertas=1, sobrecargaUso=2 (kN/m²).
    renderConPanoSeleccionado();
    const linea = screen.getByText(/recibe además, de su planta/i);
    expect(linea.textContent).toContain("1,00 kN/m² de cargas muertas");
    expect(linea.textContent).toContain("2,00 kN/m² de sobrecarga de uso");
  });

  it("D-1 [GAP-H]: con la planta a CERO no muestra la linea de cargas de planta (estado vacio)", () => {
    const m = modeloConPano();
    m.plantas = m.plantas.map((pl) =>
      pl.id === "pl1" ? { ...pl, sobrecargaUso: 0, cargasMuertas: 0 } : pl,
    );
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    expect(screen.queryByText(/recibe además, de su planta/i)).toBeNull();
  });

  it("F2.3: con >=2 pilares interiores (losa plana) muestra la nota de honestidad del momento en cabeza", () => {
    modeloStore.getState().cargarModelo(modeloConLosaPlana(2));
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    // Nota CUALITATIVA: la flecha/axil son fiables, el momento sobre la cabeza es orientativo.
    const nota = screen.getByText(/momento justo sobre la cabeza del pilar es orientativo/i);
    expect(nota).toBeInTheDocument();
    expect(nota.textContent).toMatch(/flecha y la carga que baja por cada pilar son fiables/i);
    expect(nota.textContent).toMatch(/punzonamiento.*fase posterior/i);
    // La C-9 (ampliada) reconoce ahora los pilares por dentro de la superficie.
    expect(
      screen.getByText(/también en los pilares que queden por dentro de su superficie/i),
    ).toBeInTheDocument();
  });

  it("F2.3: sin pilares interiores NO muestra la nota de honestidad (losa normal)", () => {
    // El fixture base no tiene pilares interiores: la nota no debe aparecer.
    renderConPanoSeleccionado();
    expect(
      screen.queryByText(/momento justo sobre la cabeza del pilar es orientativo/i),
    ).toBeNull();
  });

  it("F2.3 [DP1]: con 1 SOLO pilar interior NO muestra la nota (ese paño ni calcula)", () => {
    // Con 1 pilar el acople no se activa (PANO_PILAR_INTERIOR bloquea): la nota de
    // honestidad mentiria (no hay losa plana calculable). pilaresAcoplados queda [].
    modeloStore.getState().cargarModelo(modeloConLosaPlana(1));
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    expect(
      screen.queryByText(/momento justo sobre la cabeza del pilar es orientativo/i),
    ).toBeNull();
  });

  it("code-review #2: dos pilares en la MISMA celda (PANO_PILARES_JUNTOS) NO muestran la nota", () => {
    // El paño esta BLOQUEADO por la junta: prometer flecha/axil fiables mentiria.
    // La fuente unica (calcularAcoples.pilaresJuntos) silencia la nota.
    const m = modeloConLosaPlana(1);
    const base = m.pilares.find((p) => p.id === "PIN-0")!;
    m.pilares.push({ ...base, id: "PIN-DUP", nombre: "PiDup" }); // misma (x,y) que PIN-0
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    expect(
      screen.queryByText(/momento justo sobre la cabeza del pilar es orientativo/i),
    ).toBeNull();
  });

  it("code-review #2: demasiados pilares (cap de malla) NO muestran la nota (paño bloqueado)", () => {
    // 45 pilares interiores con coords distintas: la rejilla minima de lineas de
    // control supera CAP_QUADS -> PANO_DEMASIADOS_PILARES -> el paño queda fuera de
    // porPano y la nota se silencia (antes: 45 >= 2 la mostraba sobre un paño roto).
    const m = modeloConLosaPlana(0);
    for (let i = 1; i <= 45; i++) {
      m.pilares.push({
        id: `PC-${i}`, nombre: `PC${i}`, x: (i * 4) / 46, y: (i * 3) / 46,
        plantaInicial: "pl0", plantaFinal: "pl1", seccionId: "s-pilar",
        materialId: MAT_OK, angulo: 0, vinculacionExterior: true, arranque: "empotrado",
      });
    }
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    expect(
      screen.queryByText(/momento justo sobre la cabeza del pilar es orientativo/i),
    ).toBeNull();
  });

  it("code-review #2: paño acoplado por una viga de contorno + 1 pilar interior SI muestra la nota", () => {
    // Mejora sobre el umbral viejo (>=2 interiores): con el borde sobre una viga el
    // acople ya esta activo y ese UNICO pilar interior queda acoplado (su cabeza
    // comparte nudo con la malla): el momento sobre su cabeza es igual de orientativo.
    const m = modeloConLosaPlana(1);
    m.vigas.push({
      id: "V-1", nombre: "V1", plantaId: "pl1", nudoI: "n1", nudoJ: "n2",
      seccionId: "s-viga", materialId: MAT_OK,
      extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
    });
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    expect(
      screen.getByText(/momento justo sobre la cabeza del pilar es orientativo/i),
    ).toBeInTheDocument();
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
  it("UX-E3: comunica el sentido de la carga (positivo = hacia abajo)", () => {
    renderConPanoSeleccionado();
    expect(
      screen.getByText(/Valor en positivo: la carga actúa hacia abajo/i),
    ).toBeInTheDocument();
  });

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

  it("D17: editar el VALOR de una carga superficial existente inline es reversible", async () => {
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

    // El campo de valor de la FILA (no el de "Añadir carga") lleva su propio aria-label.
    const lista = document.querySelector(".cx-cargas__lista") as HTMLElement;
    const valorFila = within(lista).getByLabelText("Valor de la carga superficial");
    await user.clear(valorFila);
    await user.type(valorFila, "9");
    await user.tab();

    const cargas = () => modelo().cargas.filter((c) => c.ambito === "F-1");
    expect(cargas()[0]!.valor).toBe(9);
    expect(cargas()[0]!.id).toBe("cs1"); // editada, no borrada+creada

    modeloStore.getState().deshacer();
    expect(cargas()[0]!.valor).toBe(5);
  });

  it("D17: un valor invalido (0) en la fila de carga superficial NO comitea", async () => {
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

    const lista = document.querySelector(".cx-cargas__lista") as HTMLElement;
    const valorFila = within(lista).getByLabelText("Valor de la carga superficial");
    await user.clear(valorFila);
    await user.type(valorFila, "0");
    await user.tab();

    expect(modelo().cargas.find((c) => c.id === "cs1")!.valor).toBe(5);
    expect(
      within(lista).getByText(/El valor de la carga debe ser mayor que cero/),
    ).toBeInTheDocument();
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

describe("InspectorPano: dimensiones (D8b)", () => {
  it("muestra las dimensiones ancho × alto en m (solo lectura)", () => {
    // El fixture tiene un rectangulo 0..4 (X) × 0..3 (Y): 4.00 × 3.00 m.
    renderConPanoSeleccionado();
    expect(screen.getByText("Dimensiones")).toBeInTheDocument();
    expect(screen.getByText("4.00 × 3.00 m")).toBeInTheDocument();
  });
});

// --- Forjado UNIDIRECCIONAL (T4.1): tipo solo-lectura, campos condicionales, commit ---

function renderConPanoUniSeleccionado() {
  modeloStore.getState().cargarModelo(modeloConPanoUni());
  seleccionStore.getState().seleccionar(["F-1"]);
  render(<InspectorPano />);
}

describe("InspectorPano: forjado unidireccional", () => {
  it("muestra el TIPO en solo-lectura (Losa maciza / Forjado unidireccional)", () => {
    // Losa.
    renderConPanoSeleccionado();
    expect(screen.getByText("Tipo")).toBeInTheDocument();
    expect(screen.getByText("Losa maciza")).toBeInTheDocument();
  });

  it("en un paño unidireccional el tipo solo-lectura dice 'Forjado unidireccional'", () => {
    renderConPanoUniSeleccionado();
    expect(screen.getByText("Forjado unidireccional")).toBeInTheDocument();
  });

  it("en UNIDIRECCIONAL muestra los campos de vigueta y oculta Espesor/Tamaño de malla", () => {
    renderConPanoUniSeleccionado();
    expect(screen.getByText("Dirección de viguetas")).toBeInTheDocument();
    expect(screen.getByLabelText("Intereje")).toBeInTheDocument();
    expect(screen.getByLabelText("Canto")).toBeInTheDocument();
    expect(screen.getByLabelText("Ancho de nervio")).toBeInTheDocument();
    expect(screen.getByLabelText("Peso propio")).toBeInTheDocument();
    expect(screen.queryByLabelText("Espesor")).toBeNull();
    expect(screen.queryByLabelText("Tamaño de malla")).toBeNull();
  });

  it("en LOSA oculta los campos de vigueta", () => {
    renderConPanoSeleccionado();
    expect(screen.queryByText("Dirección de viguetas")).toBeNull();
    expect(screen.queryByLabelText("Intereje")).toBeNull();
    expect(screen.queryByLabelText("Peso propio")).toBeNull();
  });

  it("commit en vivo: editar el intereje (mm) lo convierte a m y persiste", async () => {
    const user = userEvent.setup();
    renderConPanoUniSeleccionado();
    const input = screen.getByLabelText("Intereje") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "600"); // 600 mm -> 0.6 m
    await user.tab();
    expect(pano()!.intereje).toBeCloseTo(0.6, 6);
  });

  it("commit en vivo: editar el peso propio (kN/m²) persiste sin conversion", async () => {
    const user = userEvent.setup();
    renderConPanoUniSeleccionado();
    const input = screen.getByLabelText("Peso propio") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "5");
    await user.tab();
    expect(pano()!.pesoPropio).toBe(5);
  });

  it("commit en vivo: cambiar la dirección de viguetas a Eje Y persiste y es reversible", async () => {
    const user = userEvent.setup();
    renderConPanoUniSeleccionado();
    const grupo = screen.getByRole("radiogroup", { name: "Dirección de viguetas del forjado" });
    await user.click(within(grupo).getByRole("radio", { name: "Eje Y" }));
    expect(pano()!.direccionViguetas).toBe("y");
    modeloStore.getState().deshacer();
    expect(pano()!.direccionViguetas).toBe("x");
  });

  it("validación: un intereje inválido (0) NO comitea y muestra el error", async () => {
    const user = userEvent.setup();
    renderConPanoUniSeleccionado();
    const input = screen.getByLabelText("Intereje") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "0");
    await user.tab();
    // No comitea: el intereje sigue en 0.7 m.
    expect(pano()!.intereje).toBeCloseTo(0.7, 6);
    expect(screen.getByText(/El intereje debe ser mayor que cero/i)).toBeInTheDocument();
  });

  it("nota: en UNI la nota de reparto en una dirección, no la de descarga en el contorno", () => {
    renderConPanoUniSeleccionado();
    expect(screen.getByText(/reparte en una dirección/i)).toBeInTheDocument();
    expect(screen.getByText(/los bordes paralelos no reciben carga/i)).toBeInTheDocument();
    expect(screen.getByText(/un borde empotrado se comporta como apoyado/i)).toBeInTheDocument();
    expect(screen.queryByText(/descarga en las vigas y pilares de su contorno/i)).toBeNull();
  });

  it("nota de losa plana (momento en cabeza) NO aparece en un paño unidireccional", () => {
    // Aunque hubiera pilares interiores, bajo uni el pilar BLOQUEA (no acopla): la
    // nota de momento en cabeza (losa plana) no debe salir.
    const m = modeloConLosaPlana(2);
    m.panos = m.panos.map((p) =>
      p.id === "F-1"
        ? {
            ...p,
            tipo: "unidireccional" as const,
            direccionViguetas: "x" as const,
            intereje: 0.7,
            canto: 0.3,
            anchoNervio: 0.12,
            pesoPropio: 4,
          }
        : p,
    );
    modeloStore.getState().cargarModelo(m);
    seleccionStore.getState().seleccionar(["F-1"]);
    render(<InspectorPano />);
    expect(
      screen.queryByText(/momento justo sobre la cabeza del pilar es orientativo/i),
    ).toBeNull();
  });
});
