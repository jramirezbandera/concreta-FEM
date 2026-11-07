/**
 * Los ejes de replanteo se dibujan alargados (`ejesVistos`): lo guardado es la directriz que se clicó
 * y las burbujas quedan MARGEN_EJES más allá de sus extremos y de lo que la recta atraviesa, para no
 * tapar el pilar o el borde del forjado.
 */
import { describe, expect, it } from "vitest";
import { MARGEN_EJES } from "../../compilador/ejes.ts";
import type { EjeReplanteo, ModeloFisico } from "../../compilador/fisico.ts";
import { cadenasDe, capaEjes, ejesVistos } from "./ejes.ts";

const base = (extra: Partial<ModeloFisico> = {}): ModeloFisico =>
  ({
    plantas: [{ id: "N1", altura: 3 }],
    materiales: {},
    secciones: {},
    pilares: [],
    vigas: [],
    casos: [],
    cargas: [],
    ...extra,
  }) as unknown as ModeloFisico;

const eje = (id: string, desde: [number, number], hasta: [number, number]): EjeReplanteo => ({ id, desde, hasta });

describe("ejesVistos", () => {
  it("sin nada más en el modelo, MARGEN_EJES más allá de lo que se clicó, con la x tal cual", () => {
    const f = base({ ejes: [eje("1", [0.3, 0], [0.3, 6])] });
    const [v] = ejesVistos(f, f.ejes!, false);
    expect(v!.desde).toEqual([0.3, -MARGEN_EJES]);
    expect(v!.hasta).toEqual([0.3, 6 + MARGEN_EJES]);
    // Lo guardado no cambia
    expect(f.ejes![0]!.desde).toEqual([0.3, 0]);
  });

  it("más allá del borde de la losa y de los pilares que atraviesa", () => {
    const f = base({
      ejes: [eje("1", [0, 0], [0, 6])],
      losas: [{ id: "L1", planta: "N1", contorno: [[-1, -0.5], [10, -0.5], [10, 9], [-1, 9]] }] as never,
      pilares: [{ id: "P1", x: 0.2, y: 12 }, { id: "P2", x: 3, y: 20 }] as never,
    });
    const [v] = ejesVistos(f, f.ejes!, false);
    expect(v!.desde[1]).toBeCloseTo(-0.5 - MARGEN_EJES, 12);
    // P1 está a 0,2 m de la recta: cuenta; P2, a 3 m, no
    expect(v!.hasta[1]).toBeCloseTo(12 + MARGEN_EJES, 12);
    expect(v!.desde[0]).toBe(0);
    expect(v!.hasta[0]).toBe(0);
  });

  it("un eje inclinado, alargado por su recta", () => {
    const f = base({ ejes: [eje("A", [0, 0], [3, 4])] });
    const [v] = ejesVistos(f, f.ejes!, false);
    expect(v!.desde[0]).toBeCloseTo(-0.6 * MARGEN_EJES, 12);
    expect(v!.desde[1]).toBeCloseTo(-0.8 * MARGEN_EJES, 12);
    expect(v!.hasta[0]).toBeCloseTo(3 + 0.6 * MARGEN_EJES, 12);
  });

  it("los propuestos (ya con su margen) no se alargan si no atraviesan nada más allá", () => {
    const f = base();
    const e = [eje("1", [0, -2], [0, 8])];
    expect(ejesVistos(f, e, true)[0]).toBe(e[0]);
  });

  it("burbujas y cotas, en los extremos alargados", () => {
    const f = base({ ejes: [eje("1", [0, 0], [0, 6]), eje("2", [5, 0], [5, 6])] });
    const P = capaEjes(f, { cotas: true }).primitivas;
    const burbujas = P.filter((p) => p.tipo === "marca" && p.objeto === "1").map((p) => (p.tipo === "marca" ? p.p : null));
    expect(burbujas).toEqual([
      [0, -MARGEN_EJES],
      [0, 6 + MARGEN_EJES],
    ]);
    // La cadena de cotas, a COTA_DENTRO (1 m) del extremo alargado: entre las burbujas y lo clicado
    expect(cadenasDe(f)[0]!.s).toBeCloseTo(-MARGEN_EJES + 1, 12);
  });
});
