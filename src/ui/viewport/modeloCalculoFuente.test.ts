// Tests de calcularFuenteModeloCalculo (PURA): decide de donde sale el ModeloFEM del
// overlay "Ver modelo de calculo". Se inyecta un discretizar falso para cubrir las
// ramas sin construir modelos calculables reales.
import { describe, it, expect } from "vitest";
import { calcularFuenteModeloCalculo } from "./modeloCalculoFuente";
import { crearModeloVacio } from "../../dominio";
import type {
  ModeloFEM,
  Trazabilidad,
  ResultadoDiscretizacion,
} from "../../discretizador";

const FAKE_FEM = { nodes: [], members: [] } as unknown as ModeloFEM;
const OTRO_FEM = { nodes: [{ name: "N1" }], members: [] } as unknown as ModeloFEM;
const FAKE_TRZ = {} as unknown as Trazabilidad;
const modelo = crearModeloVacio();

const okFake = (): ResultadoDiscretizacion => ({
  ok: true,
  modeloFEM: FAKE_FEM,
  avisos: [],
  trazabilidad: FAKE_TRZ,
});
const noOkFake = (): ResultadoDiscretizacion => ({
  ok: false,
  errores: [
    { codigo: "no-sujeta", severidad: "error", mensaje: "La estructura no está sujeta." },
  ],
});
const throwFake = (): ResultadoDiscretizacion => {
  throw new Error("boom");
};

describe("calcularFuenteModeloCalculo", () => {
  it("toggle apagado -> inactivo", () => {
    expect(calcularFuenteModeloCalculo(false, modelo, false, null, okFake)).toEqual({
      estado: "inactivo",
    });
  });

  it("resultados vigentes -> usa su modeloFEM (origen resultados, no discretiza)", () => {
    // Si discretizara, el origen seria "discretizado" (FAKE_FEM); aqui debe ser el de
    // resultados (OTRO_FEM) con origen "resultados".
    const f = calcularFuenteModeloCalculo(true, modelo, true, OTRO_FEM, okFake);
    expect(f).toEqual({ estado: "ok", modeloFEM: OTRO_FEM, origen: "resultados" });
  });

  it("sin resultados vigentes -> discretiza (origen discretizado) si ok", () => {
    expect(calcularFuenteModeloCalculo(true, modelo, false, null, okFake)).toEqual({
      estado: "ok",
      modeloFEM: FAKE_FEM,
      origen: "discretizado",
    });
  });

  it("vigente pero sin modeloFEM -> cae a discretizar", () => {
    const f = calcularFuenteModeloCalculo(true, modelo, true, null, okFake);
    expect(f.estado === "ok" && f.origen).toBe("discretizado");
  });

  it("discretizar !ok -> no-calculable con el motivo en lenguaje de obra", () => {
    expect(calcularFuenteModeloCalculo(true, modelo, false, null, noOkFake)).toEqual({
      estado: "no-calculable",
      motivo: "La estructura no está sujeta.",
    });
  });

  it("discretizar lanza -> no-calculable generico (fail-safe G4)", () => {
    const f = calcularFuenteModeloCalculo(true, modelo, false, null, throwFake);
    expect(f.estado).toBe("no-calculable");
  });
});
