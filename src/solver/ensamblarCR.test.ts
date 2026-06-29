// Tests de ensamblarResultadosCR (PURO): combina la salida cruda del glue (x/y del CR
// por planta) con el centro de masas (inyectado) para anadir ex/ey. Verifica la
// aritmetica de excentricidad y el manejo de null (CM sin masa, CR no determinable).
import { describe, it, expect } from "vitest";
import { ensamblarResultadosCR } from "./ensamblarCR";
import type { CRGlue } from "./resultadosCR";
import type { Modelo } from "../dominio";
import type { CentroMasaPlanta } from "../discretizador";

// El modelo no se lee (el resolutor de CM va inyectado): basta un doble.
const modelo = {} as Modelo;

function glue(cr: Record<string, { x: number | null; y: number | null }>): CRGlue {
  return { units: "kN-m", analysis: { type: "centroRigidez" }, cr_por_planta: cr };
}

function cm(plantaId: string, x: number, y: number): CentroMasaPlanta {
  return { plantaId, x, y, pesoTotal: 10 };
}

describe("ensamblarResultadosCR", () => {
  it("CR determinable + CM presente -> ex/ey = CM - CR", () => {
    const r = ensamblarResultadosCR(glue({ p1: { x: 1, y: 1 } }), modelo, () =>
      cm("p1", 3, 4),
    );
    expect(r.cr_por_planta.p1).toEqual({ x: 1, y: 1, ex: 2, ey: 3 }); // 3-1, 4-1
  });

  it("CR determinable + CM null (sin masa) -> ex/ey null, x/y se conservan", () => {
    const r = ensamblarResultadosCR(glue({ p1: { x: 2, y: 5 } }), modelo, () => null);
    expect(r.cr_por_planta.p1).toEqual({ x: 2, y: 5, ex: null, ey: null });
  });

  it("CR no determinable (x/y null) -> ex/ey null aunque haya CM", () => {
    const r = ensamblarResultadosCR(glue({ p1: { x: null, y: null } }), modelo, () =>
      cm("p1", 3, 4),
    );
    expect(r.cr_por_planta.p1).toEqual({ x: null, y: null, ex: null, ey: null });
  });

  it("varias plantas: cada una resuelve su CM por plantaId", () => {
    const cmPorPlanta: Record<string, CentroMasaPlanta | null> = {
      p1: cm("p1", 10, 0),
      p2: null, // sin masa
    };
    const r = ensamblarResultadosCR(
      glue({ p1: { x: 4, y: 0 }, p2: { x: 1, y: 1 } }),
      modelo,
      (_m, id) => cmPorPlanta[id] ?? null,
    );
    expect(r.cr_por_planta.p1).toEqual({ x: 4, y: 0, ex: 6, ey: 0 }); // 10-4, 0-0
    expect(r.cr_por_planta.p2).toEqual({ x: 1, y: 1, ex: null, ey: null });
  });

  it("units y analysis.type del contrato final son correctos", () => {
    const r = ensamblarResultadosCR(glue({ p1: { x: 0, y: 0 } }), modelo, () =>
      cm("p1", 0, 0),
    );
    expect(r.units).toBe("kN-m");
    expect(r.analysis.type).toBe("centroRigidez");
  });
});
