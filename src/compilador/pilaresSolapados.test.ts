/**
 * A2-35: dos pilares cuyas huellas se solapan en una planta sin losa son un error, como en una con
 * losa (`losa/huellas-solapadas`). Antes, dos de 30 × 30 a 6 cm compilaban sin aviso. Con una viga
 * por los dos ya lo para otro error (`viga/tramo-flexible-nulo`); aquí, sólo los pilares (como el auditor).
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

function porticos(dx: number): ModeloFisico {
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [
      { id: "P1", x: 0, y: 0, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P2", x: dx, y: 0, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P3", x: 5, y: 0, desde: "C", hasta: "N1", seccion: "P30" },
    ],
    casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
  };
}

describe("A2-35: pilares solapados en una planta sin losa", () => {
  it("a 6 cm, error con los dos pilares; a 40 cm, compila", () => {
    const r = compilar(porticos(0.06));
    expect(r.diagnosticos.map((d) => d.codigo)).toContain("pilar/huellas-solapadas");
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.filter((d) => d.codigo === "pilar/huellas-solapadas").map((d) => d.ids)).toEqual([["P1", "P2"]]);
    expect(compilar(porticos(0.4)).valido).toBe(true);
  });
});
