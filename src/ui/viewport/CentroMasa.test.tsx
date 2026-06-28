// Tests de componente del control de Centro de masas (F2.4). RTL en el project
// `jsdom`. CentroMasa es el panel HUD (HTML, no WebGL): toggle + datos. Verifican
// D-diseño-1 (solo en vista planta; toggle apagado por defecto; muestra/oculta el
// panel) y D-diseño-2 (datos coords/peso o estado "Sin masa"). El marcador R3F
// (CentroMasaOverlay) no se testea aqui (jsdom no hace WebGL): su logica de datos
// vive en useCentroMasa + calcularCentroMasaPlanta (puro, ya con golden).
//
// Stores singleton de modulo -> reset en beforeEach.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CentroMasa } from "./CentroMasa";
import { modeloStore, vistaStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

// Seccion generica de area A directa (m²): peso = A·rho·L exacto, sin perfil tabulado.
function secGenerica(id: string, A: number): Modelo["secciones"][number] {
  return { id, nombre: id, tipo: "generico", A, Iy: 1e-4, Iz: 1e-4, J: 1e-4 };
}

// Modelo con UN pilar (masa real) entre cimentacion (p0) y planta 1 (p1). El CM de p1
// recibe medio pilar -> CM en (x,y) del pilar con peso > 0.
function modeloConMasa(): Modelo {
  const m = crearModeloVacio();
  m.grupos.push({
    id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 0,
  });
  m.plantas.push(
    { id: "p0", nombre: "Cimentación", cota: 0, altura: 3, grupoId: "g1" },
    { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" },
  );
  m.secciones.push(secGenerica("s1", 0.04));
  m.pilares.push({
    id: "P-1", nombre: "P1", x: 2, y: 4, plantaInicial: "p0", plantaFinal: "p1",
    seccionId: "s1", materialId: "S275", angulo: 0,
    vinculacionExterior: true, arranque: "empotrado",
  });
  return m;
}

// Modelo con una planta SIN masa (sin pilares/vigas/cargas en ella).
function modeloSinMasa(): Modelo {
  const m = crearModeloVacio();
  m.grupos.push({
    id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 0,
  });
  m.plantas.push({ id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" });
  return m;
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  // Estado de vista por defecto del CM: planta activa null, modo planta, toggle off.
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setMostrarCentroMasa(false);
  vistaStore.getState().setPlantaActiva(null);
});

describe("CentroMasa: visibilidad del control", () => {
  it("no se renderiza fuera de vista planta (3D)", () => {
    vistaStore.getState().setModoVista("3d");
    render(<CentroMasa />);
    expect(screen.queryByText("Centro de masas")).toBeNull();
  });

  it("en vista planta muestra el control con el toggle APAGADO por defecto", () => {
    render(<CentroMasa />);
    expect(screen.getByText("Centro de masas")).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: "Mostrar centro de masas" });
    expect(toggle).not.toBeChecked();
  });

  it("con el toggle apagado NO muestra el panel de datos", () => {
    modeloStore.getState().cargarModelo(modeloConMasa());
    vistaStore.getState().setPlantaActiva("p1");
    render(<CentroMasa />);
    // Sin encender el toggle, no aparecen las filas de datos.
    expect(screen.queryByText("X")).toBeNull();
    expect(screen.queryByText("Peso")).toBeNull();
  });
});

describe("CentroMasa: panel de datos (D-diseño-2)", () => {
  it("al encender el toggle muestra coords (mono) y peso de la planta con masa", async () => {
    const user = userEvent.setup();
    modeloStore.getState().cargarModelo(modeloConMasa());
    vistaStore.getState().setPlantaActiva("p1");
    render(<CentroMasa />);

    await user.click(screen.getByRole("checkbox", { name: "Mostrar centro de masas" }));

    // Nombre de planta + coords + peso (lenguaje de obra; mono tabular).
    expect(screen.getByText("Planta 1")).toBeInTheDocument();
    // El CM de un solo pilar cae en su (x,y) = (2.00, 4.00) m.
    expect(screen.getByText("2.00 m")).toBeInTheDocument();
    expect(screen.getByText("4.00 m")).toBeInTheDocument();
    // Peso > 0 (kN): medio pilar de masa real.
    expect(screen.getByText(/kN$/)).toBeInTheDocument();
  });

  it("planta SIN masa: con el toggle encendido muestra 'Sin masa en esta planta'", async () => {
    const user = userEvent.setup();
    modeloStore.getState().cargarModelo(modeloSinMasa());
    vistaStore.getState().setPlantaActiva("p1");
    render(<CentroMasa />);

    await user.click(screen.getByRole("checkbox", { name: "Mostrar centro de masas" }));
    expect(screen.getByText("Sin masa en esta planta")).toBeInTheDocument();
    // No hay filas de coords.
    expect(screen.queryByText("X")).toBeNull();
  });

  it("el toggle escribe el estado en vistaStore (compartido con el sceneOverlay)", async () => {
    const user = userEvent.setup();
    render(<CentroMasa />);
    expect(vistaStore.getState().mostrarCentroMasa).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: "Mostrar centro de masas" }));
    expect(vistaStore.getState().mostrarCentroMasa).toBe(true);
  });
});
