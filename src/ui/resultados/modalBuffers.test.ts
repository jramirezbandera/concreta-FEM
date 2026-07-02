// Tests de modalBuffers (F2b + auditoria UX-J2): la derivacion PURA de base/delta/color de
// una FORMA MODAL. Espejo de deformadaBuffers.test.ts. Cubre el color por rampa (vigente)
// y el agrisado obsoleto (vigente=false), sin R3F. Construye un ModeloFEM REAL discretizando
// un fixture de libro para anclarse a la salida del discretizador.
import { describe, it, expect } from "vitest";
import { discretizar } from "../../discretizador";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosModales } from "../../solver";
import { fixtureBiapoyadaUDL } from "../../../tests/golden/_arnes/fixtures";
import { construirBuffersModal } from "./modalBuffers";
import { COLOR_OBSOLETO } from "./deformadaBuffers";

function femBiapoyada(): ModeloFEM {
  const res = discretizar(fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 }), {
    modal: { numModos: 4 },
  });
  if (!res.ok) throw new Error("fixture invalido en modalBuffers.test");
  return res.modeloFEM;
}

// Forma modal sintetica: un modo con forma por nudo (6 GDL); un nudo con desplazamiento
// grande garantiza rango>0 (rampa con extremos distintos).
function modosCon(
  forma: Record<string, [number, number, number, number, number, number]>,
): ResultadosModales {
  return {
    units: "kN-m",
    analysis: { type: "modal", num_modes: 1 },
    frecuencias: [4.5],
    modos: [{ numero: 1, frecuencia: 4.5, nodos: forma }],
  };
}

describe("construirBuffersModal · bordes", () => {
  it("null sin modelo/modos", () => {
    expect(
      construirBuffersModal({ modeloFEM: null, modos: null, numeroModo: 1 }),
    ).toBeNull();
  });
});

describe("construirBuffersModal · color (UX-J2)", () => {
  it("vigente (default) colorea con la rampa, no el gris de obsoleto", () => {
    const buffers = construirBuffersModal({
      modeloFEM: femBiapoyada(),
      modos: modosCon({ N1: [0, 0, 0, 0, 0, 0], N3: [0, -2, 0, 0, 0, 0] }),
      numeroModo: 1,
    })!;
    expect(buffers).not.toBeNull();
    const gris = [COLOR_OBSOLETO.r, COLOR_OBSOLETO.g, COLOR_OBSOLETO.b];
    // Al menos un vertice NO es el gris de obsoleto (usa la rampa).
    let algunoNoGris = false;
    for (let v = 0; v < buffers.vertices; v++) {
      const c = [buffers.color[v * 3], buffers.color[v * 3 + 1], buffers.color[v * 3 + 2]];
      if (
        Math.abs(c[0]! - gris[0]!) > 1e-3 ||
        Math.abs(c[1]! - gris[1]!) > 1e-3 ||
        Math.abs(c[2]! - gris[2]!) > 1e-3
      ) {
        algunoNoGris = true;
        break;
      }
    }
    expect(algunoNoGris).toBe(true);
  });

  it("vigente=false pinta TODOS los vertices con el gris de obsoleto", () => {
    const buffers = construirBuffersModal({
      modeloFEM: femBiapoyada(),
      modos: modosCon({ N1: [0, 0, 0, 0, 0, 0], N3: [0, -2, 0, 0, 0, 0] }),
      numeroModo: 1,
      vigente: false,
    })!;
    const gris = [COLOR_OBSOLETO.r, COLOR_OBSOLETO.g, COLOR_OBSOLETO.b];
    for (let v = 0; v < buffers.vertices; v++) {
      for (let k = 0; k < 3; k++) {
        expect(buffers.color[v * 3 + k]).toBeCloseTo(gris[k]!, 5);
      }
    }
  });
});
