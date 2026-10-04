/**
 * Criterio 4 de E5: bandas por el método «campos» (cortes en cualquier posición).
 * - Losa unidireccional isostática en estaciones fuera de la malla: My con orden 2; Vz pequeño (con
 *   la fuerza de borde libre de Kirchhoff) y exacto con ν = 0.
 * - Integrales de banda de las placas de Navier fuera de la malla.
 * - Losa plana de H25 con huella: en un corte que sigue la malla, «campos» da lo mismo que las
 *   fuerzas nodales; la banda de pilar en la cara no depende de la malla; en el vano, las muestras
 *   integran al My del corte.
 * - Coherencia de las muestras: en un corte que sólo atraviesa láminas, Σ peso·Mx = My.
 * - Diagnósticos: campos degradados.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CASOS_NAVIER, modeloNavier, B } from "../../validacion/e3/navier.ts";
import { bandasLosaPlana, cortarModelo, cortesLosaPlana, erroresBandaNavier, erroresLosaCampos, losaPlana } from "../../validacion/e5/bandas.ts";
import { losaUnidireccional } from "../../validacion/e5/cortes.ts";
import { BASE_E5 } from "../../validacion/e5/fuerzasNodales.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { edificio } from "../pruebas/edificio.ts";
import { calcular } from "./calcular.ts";
import { CamposLaminas } from "./campos.ts";
import { Cortes, type Corte } from "./cortes.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 4 de E5: bandas frente a soluciones cerradas", () => {
  it("losa unidireccional, estaciones fuera de la malla: My de orden 2 y Vz ≤ 2 % con 24 × 8", () => {
    const g = erroresLosaCampos(12, 4);
    const f = erroresLosaCampos(24, 8);
    expect(f.My).toBeLessThan(0.005);
    expect(Math.log2(g.My / f.My)).toBeGreaterThan(1.8);
    expect(f.Vz).toBeLessThan(0.02);
  });

  it("losa unidireccional con ν = 0 (sin efecto de placa ni capa límite): Vz exacto fuera de la malla", () => {
    const { modelo, L, b, q } = losaUnidireccional(12, 4, 6, 2, { E: 3e7, nu: 0, t: 0.25 });
    const xs = [0.37, 1.23, 3.11, 4.71, 5.6];
    const r = cortarModelo(modelo, xs.map((x): Corte => ({ origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2, b / 2], metodo: "campos" })));
    xs.forEach((x, i) => expect(Math.abs(r[i]!.esfuerzos[2]! - q * b * (L / 2 - x)) / Math.abs((q * b * L) / 2)).toBeLessThan(1e-9));
  });

  for (const c of CASOS_NAVIER) {
    it(`Navier, ${c.nombre}: ∫Mx dy y ∫Qx dy fuera de la malla ≤ 0,5 % con h = 0,125 m`, () => {
      const e = erroresBandaNavier(c, 0.125);
      expect(Math.abs(e.MyCentro)).toBeLessThan(0.005);
      expect(Math.abs(e.MyFuera)).toBeLessThan(0.005);
      expect(Math.abs(e.VzFuera)).toBeLessThan(0.005);
    });
  }
});

describe("criterio 4 de E5: losa plana con huella (H25)", () => {
  it("en cortes que siguen la malla, «campos» = fuerzas nodales; la banda en la cara no depende de la malla", () => {
    const g = bandasLosaPlana(0.3);
    const f = bandasLosaPlana(0.15);
    for (const b of [g, f]) {
      for (let i = 0; i < 2; i++) for (let c = 0; c < 2; c++) expect(b.caraCampos[i]![c]!).toBeCloseTo(b.caraNodal[i]![c]!, 9);
      for (let i = 0; i < 2; i++) expect(b.vanoCampos[i]!).toBeCloseTo(b.vanoNodal[i]!, 9);
    }
    expect(Math.abs(f.caraNodal[0]![0]! / g.caraNodal[0]![0]! - 1)).toBeLessThan(0.002);
    expect(Math.abs(f.caraNodal[1]![0]! / g.caraNodal[1]![0]! - 1)).toBeLessThan(0.002);
  });

  it("en el vano, las muestras integran al My del corte (≤ 1 %)", () => {
    const modelo = losaPlana(0.15);
    const [r] = cortarModelo(modelo, [cortesLosaPlana("campos", 3)[0]!]);
    const m = r!.muestras!;
    let s = 0;
    for (let j = 0; j < m.pesos.length; j++) s += m.pesos[j]! * m.valores[0]![8 * j + 3]!;
    expect(Math.abs(s / r!.esfuerzos[4]! - 1)).toBeLessThan(0.01);
  });
});

describe("criterio 4 de E5: coherencia de las muestras", () => {
  it("en un corte que sólo atraviesa láminas (sin bordes libres ni barras), Σ peso·Mx = My y Σ peso·Qx = Vz", () => {
    const { modelo } = modeloNavier(CASOS_NAVIER[2]!, 12, 8);
    const [r] = cortarModelo(modelo, [{ origen: [1.3, B / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-B / 2, B / 2], metodo: "campos" }]);
    const m = r!.muestras!;
    let mx = 0;
    let qx = 0;
    for (let j = 0; j < m.pesos.length; j++) {
      mx += m.pesos[j]! * m.valores[0]![8 * j + 3]!;
      qx += m.pesos[j]! * m.valores[0]![8 * j + 6]!;
    }
    expect(Math.abs(mx / r!.esfuerzos[4]! - 1)).toBeLessThan(1e-12);
    expect(Math.abs(qx / r!.esfuerzos[2]! - 1)).toBeLessThan(1e-12);
  });
});

describe("criterio 5 de E5: diagnósticos de los campos", () => {
  it("un corte por un muro de una sola fila de láminas avisa de los campos degradados", () => {
    const { modelo } = edificio({ ...BASE_E5, diafragma: true, plantas: 1 });
    const casos = casosValidos(calcular(modelo));
    const r = new Cortes(modelo).cortar({ id: "muro", origen: [2.5, 0, 1.4], x: [0, 0, 1], vz: [1, 0, 0], z: [-2.5, 2.5], metodo: "campos" }, casos, new CamposLaminas(modelo));
    expect(r.valido).toBe(true);
    expect(r.diagnosticos.map((d) => d.codigo)).toContain("corte/campos-degradados");
    expect(r.esfuerzos.every(Number.isFinite)).toBe(true);
  });

  it("el método «campos» sin integrador es un error de uso", () => {
    const { modelo } = losaUnidireccional(6, 2);
    const casos = casosValidos(calcular(modelo));
    expect(() => new Cortes(modelo).cortar({ origen: [1.3, 1, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-1, 1], metodo: "campos" }, casos)).toThrow();
  });
});
