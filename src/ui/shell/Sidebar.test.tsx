// Tests de la Sidebar (rediseno UX-3, Spec Diseno UI §3.3). RTL en el project
// `jsdom`. Stores Zustand = singletons de modulo -> reset en beforeEach (igual que
// Shell.test.tsx). Foco: las filas de CAPA (Pilares/Vigas/Paños) muestran el
// contador del AMBITO activo (planta activa, si no la obra) y conmutan la
// visibilidad (UX-3.1); la seccion Vistas es espejo real de modoVista/vista3d.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "./Sidebar";
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import { crearModeloVacio, type Modelo } from "../../dominio";
import { SCHEMA_VERSION } from "../../dominio";

// Obra de prueba: tres plantas del edificio (p0,p1,p2 a cotas 0,3,6). pil1 cubre
// p0..p1 y pil2 cubre p1..p2 (pasante que comparte p1). Asi el conteo por planta
// activa es no trivial (p1 toca ambos pilares).
function modeloPrueba(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentación", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p2", nombre: "Planta 2", cota: 6, altura: 3, categoriaUso: "B", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [{ id: "s1", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" }],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
      { id: "n3", x: 5, y: 5 },
      { id: "n4", x: 0, y: 5 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: "s1", materialId: "m1", angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil2", nombre: "P2", x: 5, y: 0,
        plantaInicial: "p1", plantaFinal: "p2",
        seccionId: "s1", materialId: "m1", angulo: 0,
        vinculacionExterior: false, arranque: "articulado",
      },
    ],
    // Una viga en p1 y otra en p2: el conteo por planta activa difiere.
    vigas: [
      {
        id: "vg1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: "s1", materialId: "m1",
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
      {
        id: "vg2", nombre: "V2", plantaId: "p2", nudoI: "n2", nudoJ: "n3",
        seccionId: "s1", materialId: "m1",
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
    ],
    // Un paño en p1.
    panos: [
      {
        id: "pa1", nombre: "Losa 1", tipo: "losa", plantaId: "p1",
        perimetro: ["n1", "n2", "n3", "n4"], materialId: "m1",
        espesor: 0.25, tamMalla: 0.5, bordeApoyo: "simple",
      },
    ],
    muros: [],
    cargas: [],
    hipotesis: [],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPlantaActiva(null);
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().resetCapas();
  seleccionStore.getState().limpiar();
});

// Localiza la fila de un elemento por su etiqueta y devuelve su contador.
function contadorDe(label: string): string {
  const fila = screen.getByText(label).closest(".cx-row") as HTMLElement;
  const count = fila.querySelector(".cx-row__count") as HTMLElement;
  return count.textContent ?? "";
}
function contadorPilares(): string {
  return contadorDe("Pilares");
}

describe("Sidebar: fila Pilares (Capas)", () => {
  it("muestra el total de la obra cuando no hay planta activa", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    expect(screen.getByText("Pilares")).toBeInTheDocument();
    // Swatch semantico presente (no hex).
    const fila = screen.getByText("Pilares").closest(".cx-row") as HTMLElement;
    expect(fila.querySelector(".cx-row__swatch")).toBeTruthy();
    // 2 pilares en total.
    expect(contadorPilares()).toBe("2");
  });

  it("cuenta los pilares que tocan la planta activa (sin doble conteo)", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    // p1 (cota 3): pil1 (p0..p1) y pil2 (p1..p2, comparte p1) -> 2 distintos.
    vistaStore.getState().setPlantaActiva("p1");
    render(<Sidebar />);
    expect(contadorPilares()).toBe("2");
  });

  it("cuenta solo los pilares de la planta activa", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    vistaStore.getState().setPlantaActiva("p2");
    render(<Sidebar />);
    // p2 solo toca pil2.
    expect(contadorPilares()).toBe("1");
  });

  it("muestra 0 con la obra vacia", () => {
    render(<Sidebar />);
    expect(contadorPilares()).toBe("0");
  });

  // UX-3.1: la fila deja de ser un dato inerte — es el TOGGLE de la capa.
  it("la fila Pilares es un toggle de capa (boton con aria-pressed)", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    const fila = screen.getByText("Pilares").closest(".cx-row") as HTMLElement;
    expect(fila.tagName).toBe("BUTTON");
    expect(fila.getAttribute("aria-pressed")).toBe("true"); // visible por defecto
  });
});

// UX-3.1: pulsar una fila de capa oculta/muestra ese tipo en el lienzo (store).
describe("Sidebar: capas de visibilidad (UX-3.1)", () => {
  it("pulsar la fila Vigas conmuta capasOcultas.vigas y el aria-pressed", async () => {
    const user = userEvent.setup();
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    const fila = screen.getByText("Vigas").closest(".cx-row") as HTMLElement;

    await user.click(fila);
    expect(vistaStore.getState().capasOcultas.vigas).toBe(true);
    expect(fila.getAttribute("aria-pressed")).toBe("false");

    await user.click(fila);
    expect(vistaStore.getState().capasOcultas.vigas).toBeUndefined();
    expect(fila.getAttribute("aria-pressed")).toBe("true");
  });

  it("la fila Rejilla refleja y conmuta el flag historico rejillaVisible", async () => {
    const user = userEvent.setup();
    vistaStore.getState().setRejillaVisible(true);
    render(<Sidebar />);
    const fila = screen.getByText("Rejilla").closest(".cx-row") as HTMLElement;
    await user.click(fila);
    expect(vistaStore.getState().rejillaVisible).toBe(false);
    vistaStore.getState().setRejillaVisible(true);
  });
});

// UX-A8: vigas y paños deben usar el MISMO criterio de ambito que pilares (antes las
// vigas mostraban el total de la obra siempre, incoherente).
describe("Sidebar: filas Vigas y Paños por ambito (UX-A8)", () => {
  it("sin planta activa muestran el total de la obra", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    expect(contadorDe("Vigas")).toBe("2"); // vg1 + vg2
    expect(contadorDe("Paños")).toBe("1"); // pa1
  });

  it("filtran por planta activa (p1)", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    vistaStore.getState().setPlantaActiva("p1");
    render(<Sidebar />);
    // p1: vg1 (p1) y pa1 (p1); vg2 esta en p2 -> fuera.
    expect(contadorDe("Vigas")).toBe("1");
    expect(contadorDe("Paños")).toBe("1");
  });

  it("filtran por planta activa (p2)", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    vistaStore.getState().setPlantaActiva("p2");
    render(<Sidebar />);
    // p2: solo vg2; ningun paño.
    expect(contadorDe("Vigas")).toBe("1");
    expect(contadorDe("Paños")).toBe("0");
  });

  it("la fila Paños existe con swatch semantico", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    const fila = screen.getByText("Paños").closest(".cx-row") as HTMLElement;
    expect(fila.querySelector(".cx-row__swatch")).toBeTruthy();
  });
});

// [D11a + UX-1.5] Seccion "Vistas": filas accionables (espejo de setModoVista y de
// vista3d para los alzados), la activa resaltada; Mosaico NO se ofrece aqui. La
// seccion arranca ABIERTA desde el rediseno UX-3.3 (es navegacion primaria).
describe("Sidebar: seccion Vistas (D11a/UX-1.5)", () => {
  it("las filas Planta / Vista 3D son pulsables y conmutan el modo", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const fila3d = screen.getByText("Vista 3D").closest(".cx-row") as HTMLElement;
    expect(fila3d.tagName).toBe("BUTTON");
    await user.click(fila3d);
    expect(vistaStore.getState().modoVista).toBe("3d");

    const filaPlanta = screen
      .getByText("Planta")
      .closest(".cx-row") as HTMLElement;
    await user.click(filaPlanta);
    expect(vistaStore.getState().modoVista).toBe("planta");
  });

  it("resalta la fila del modo activo (aria-pressed)", () => {
    vistaStore.getState().setModoVista("3d");
    render(<Sidebar />);
    const fila3d = screen.getByText("Vista 3D").closest(".cx-row") as HTMLElement;
    expect(fila3d.getAttribute("aria-pressed")).toBe("true");
    const filaPlanta = screen
      .getByText("Planta")
      .closest(".cx-row") as HTMLElement;
    expect(filaPlanta.getAttribute("aria-pressed")).toBe("false");
  });

  // UX-1.5: alzados de consulta como sub-vista de 3D.
  it("Alzado frontal entra en 3D con vista3d=frontal y desmarca 'Vista 3D'", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const alzado = screen
      .getByText("Alzado frontal")
      .closest(".cx-row") as HTMLElement;
    await user.click(alzado);
    expect(vistaStore.getState().modoVista).toBe("3d");
    expect(vistaStore.getState().vista3d).toBe("frontal");
    // "Vista 3D" (orbita) NO se marca activa estando en un alzado.
    const fila3d = screen.getByText("Vista 3D").closest(".cx-row") as HTMLElement;
    expect(fila3d.getAttribute("aria-pressed")).toBe("false");
    expect(alzado.getAttribute("aria-pressed")).toBe("true");
  });

  it("no ofrece Mosaico (sigue como 'próximamente' en el HUD)", () => {
    render(<Sidebar />);
    expect(screen.queryByText("Mosaico")).toBeNull();
  });
});
