// Tests de la Sidebar (arbol de obra, Spec Diseno UI §3.3). RTL en el project
// `jsdom`. Stores Zustand = singletons de modulo -> reset en beforeEach (igual que
// Shell.test.tsx). Foco: la fila "Pilares" de "Elementos propios" muestra el
// contador del AMBITO activo (planta activa, si no grupo activo, si no la obra).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio, type Modelo } from "../../dominio";
import { SCHEMA_VERSION } from "../../dominio";

// Obra de prueba: g1 (plantas p0,p1) y g2 (planta p2). pil1 cubre p0..p1 y pil2
// cubre p1..p2 (pasante que comparte p1). Asi el conteo por ambito es no trivial.
function modeloPrueba(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      { id: "g1", nombre: "Forjado 1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
      { id: "g2", nombre: "Cubierta", categoriaUso: "B", sobrecargaUso: 3, cargasMuertas: 1 },
    ],
    plantas: [
      { id: "p0", nombre: "Cimentación", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" },
      { id: "p2", nombre: "Planta 2", cota: 6, altura: 3, grupoId: "g2" },
    ],
    secciones: [{ id: "s1", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" }],
    nudos: [],
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
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [],
    analisis: { tipo: "lineal", comprobarEstatica: true },
  };
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setGrupoActivo(null);
  vistaStore.getState().setPlantaActiva(null);
});

// Localiza la fila "Pilares" y devuelve su contador (texto del .cx-row__count).
function contadorPilares(): string {
  const fila = screen.getByText("Pilares").closest(".cx-row") as HTMLElement;
  const count = fila.querySelector(".cx-row__count") as HTMLElement;
  return count.textContent ?? "";
}

describe("Sidebar: fila Pilares (Elementos propios)", () => {
  it("muestra el total de la obra cuando no hay ambito activo", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    expect(screen.getByText("Pilares")).toBeInTheDocument();
    // Swatch semantico presente (no hex).
    const fila = screen.getByText("Pilares").closest(".cx-row") as HTMLElement;
    expect(fila.querySelector(".cx-row__swatch")).toBeTruthy();
    // 2 pilares en total.
    expect(contadorPilares()).toBe("2");
  });

  it("cuenta los pilares del grupo activo (pilares distintos, sin doble conteo)", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    vistaStore.getState().setGrupoActivo("g1");
    render(<Sidebar />);
    // g1 = plantas p0,p1; pil1 (p0..p1) y pil2 (p1..p2 comparte p1) -> 2 distintos.
    expect(contadorPilares()).toBe("2");
  });

  it("cuenta solo los pilares de la planta activa", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    vistaStore.getState().setGrupoActivo("g2");
    vistaStore.getState().setPlantaActiva("p2");
    render(<Sidebar />);
    // p2 solo toca pil2.
    expect(contadorPilares()).toBe("1");
  });

  it("muestra 0 con la obra vacia", () => {
    render(<Sidebar />);
    expect(contadorPilares()).toBe("0");
  });

  it("la fila Pilares no es interactiva (dato, no accion)", () => {
    modeloStore.getState().cargarModelo(modeloPrueba());
    render(<Sidebar />);
    const fila = screen.getByText("Pilares").closest(".cx-row") as HTMLElement;
    // Etiqueta inerte: <div> con .cx-row--label, sin role button.
    expect(fila.tagName).toBe("DIV");
    expect(fila.classList.contains("cx-row--label")).toBe(true);
    expect(within(fila).queryByRole("button")).toBeNull();
  });
});
