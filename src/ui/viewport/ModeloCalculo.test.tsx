// Tests de componente del control "Ver modelo de calculo" (F2c). RTL en project jsdom.
// ModeloCalculo es el panel HUD (HTML, no WebGL): toggle + conteos o motivo. Verifica:
// solo visible en 3D; toggle apagado por defecto; escribe en vistaStore; con toggle ON
// muestra conteos (fuente: resultados vigentes) o el motivo si la obra no es calculable.
// El overlay R3F no se testea aqui (jsdom no hace WebGL): su geometria pura ya tiene
// tests (modeloCalculoGeometria/Buffers).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeloCalculo } from "./ModeloCalculo";
import { modeloStore, vistaStore, resultadosStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

// ModeloFEM falso con conteos conocidos (3 nudos, 2 barras, 1 apoyo): solo se leen los
// .length, asi que basta con arrays del tamano correcto.
const FEM_3_2_1 = {
  nodes: [{}, {}, {}],
  members: [{}, {}],
  supports: [{}],
} as unknown as ModeloFEM;

// Obra que el discretizador RECHAZA: un pilar con material inexistente -> !ok. Sirve
// para la rama "no-calculable" (sin resultados vigentes, se discretiza el modelo).
function modeloNoCalculable(): Modelo {
  const m = crearModeloVacio();
  m.grupos.push({ id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 0 });
  m.plantas.push(
    { id: "p0", nombre: "Cim", cota: 0, altura: 3, grupoId: "g1" },
    { id: "p1", nombre: "P1", cota: 3, altura: 3, grupoId: "g1" },
  );
  m.secciones.push({ id: "s1", nombre: "s1", tipo: "generico", A: 0.04, Iy: 1e-4, Iz: 1e-4, J: 1e-4 });
  m.pilares.push({
    id: "P-1", nombre: "P1", x: 0, y: 0, plantaInicial: "p0", plantaFinal: "p1",
    seccionId: "s1", materialId: "NO-EXISTE", angulo: 0,
    vinculacionExterior: true, arranque: "empotrado",
  });
  return m;
}

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio()); // descarta resultados
  vistaStore.getState().setModoVista("3d");
  vistaStore.getState().setMostrarModeloCalculo(false);
});

describe("ModeloCalculo: visibilidad", () => {
  it("no se renderiza fuera de 3D (en planta)", () => {
    vistaStore.getState().setModoVista("planta");
    render(<ModeloCalculo />);
    expect(screen.queryByText("Ver modelo de cálculo")).toBeNull();
  });

  it("en 3D muestra el control con el toggle apagado por defecto", () => {
    render(<ModeloCalculo />);
    expect(screen.getByText("Ver modelo de cálculo")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ver modelo de cálculo" })).not.toBeChecked();
  });

  it("tambien se muestra en mosaico (pleno !== planta), no solo en 3D", () => {
    // Mosaico comparte la escena 3D y App lo trata como pleno; el control debe aparecer
    // (antes se ocultaba por gating === "3d", dejando mosaico incoherente).
    vistaStore.getState().setModoVista("mosaico");
    render(<ModeloCalculo />);
    expect(screen.getByText("Ver modelo de cálculo")).toBeInTheDocument();
  });

  it("el toggle escribe en vistaStore (compartido con el overlay)", async () => {
    const user = userEvent.setup();
    render(<ModeloCalculo />);
    await user.click(screen.getByRole("checkbox", { name: "Ver modelo de cálculo" }));
    expect(vistaStore.getState().mostrarModeloCalculo).toBe(true);
  });
});

describe("ModeloCalculo: panel", () => {
  it("con toggle ON y resultados vigentes muestra conteos + 'vista simplificada'", async () => {
    const user = userEvent.setup();
    // Resultados vigentes con un ModeloFEM de conteos conocidos (tras cargarModelo).
    resultadosStore.getState().setResultados(
      {} as unknown as ResultadosCalculo,
      FEM_3_2_1,
      {} as unknown as Trazabilidad,
    );
    render(<ModeloCalculo />);
    await user.click(screen.getByRole("checkbox", { name: "Ver modelo de cálculo" }));

    expect(screen.getByText("Nudos")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Barras")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Apoyos")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Vista simplificada/)).toBeInTheDocument();
  });

  it("con toggle ON y obra no calculable muestra el motivo (no parece roto)", async () => {
    const user = userEvent.setup();
    modeloStore.getState().cargarModelo(modeloNoCalculable()); // sin resultados vigentes
    render(<ModeloCalculo />);
    await user.click(screen.getByRole("checkbox", { name: "Ver modelo de cálculo" }));
    expect(screen.getByText(/No se puede mostrar/)).toBeInTheDocument();
  });

  it("con toggle OFF no muestra conteos", () => {
    resultadosStore.getState().setResultados(
      {} as unknown as ResultadosCalculo,
      FEM_3_2_1,
      {} as unknown as Trazabilidad,
    );
    render(<ModeloCalculo />);
    expect(screen.queryByText("Nudos")).toBeNull();
  });
});
