/**
 * A2-16 (`docs/fem3d/auditoria-2.md` §3.2 y §11): una losa que cabe entera en el ancho de su viga y sus
 * tiras de borde (10 × 0,5 m sobre una viga de 30, con pilares en sus extremos) no tiene láminas, y el
 * control sin pérdidas daba `cargas/perdidas` («Es un fallo del compilador»): su peso iba a la viga por
 * las piezas del ancho, pero la parte física sólo contaba el de las losas con láminas.
 */
import { describe, expect, it } from "vitest";
import { resultanteAnalitica } from "./cargas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

function losaSobreViga(ancho: number): ModeloFisico {
  return {
    plantas: [{ id: "N1", altura: null }, { id: "N0", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [0, 5, 10].map((x, i) => ({ id: `P${i}`, x, y: 0, desde: "N0", hasta: "N1", seccion: "p" })),
    vigas: [{ id: "V", planta: "N1", puntos: [[0, 0], [10, 0]], seccion: "v" }],
    losas: [{ id: "L", planta: "N1", contorno: [[0, -ancho / 2], [10, -ancho / 2], [10, ancho / 2], [0, ancho / 2]], espesor: 0.2, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "N1", losa: "L", q: [0, 0, -2] }],
  };
}

describe("A2-16: una losa entera en el ancho de su viga y sus tiras", () => {
  it("compila, y el peso propio y la sobrecarga son los de la losa mallada (sin tiras)", () => {
    const peso = (op: OpcionesCompilacion) => {
      const c = compilar(losaSobreViga(0.5), op);
      expect(c.valido, c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n")).toBe(true);
      if (!c.valido) return [NaN, NaN];
      return ["G", "Q"].map((id) => resultanteAnalitica(c.modelo, c.modelo.casos.findIndex((x) => x.id === id), [0, 0, 0]).F[2]!);
    };
    const [gT, qT] = peso({});
    const [gM, qM] = peso({ tirasBorde: false });
    expect(Math.abs(gT! - gM!) / Math.abs(gM!)).toBeLessThan(1e-9);
    expect(Math.abs(qT! - qM!) / Math.abs(qM!)).toBeLessThan(1e-9);
    expect(qT).toBeCloseTo(-2 * 10 * 0.5, 9);
  });
});
