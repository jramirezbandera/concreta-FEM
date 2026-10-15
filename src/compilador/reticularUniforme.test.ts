/**
 * Rigidez del reticular (CY3, `docs/fem3d/hipotesis-cype.md`):
 * - por defecto, «uniforme», la de CYPECAD: aligerado y ábacos con m11 = m22 = ½ y m12 = ½·G/G₀,
 *   con ν = 0; la membrana y el cortante, por zonas;
 * - «bruta», la de C4-h; los multiplicadores dados mandan sobre las dos;
 * - criterio 6: frente al emparrillado de CYPECAD como barras, ≤ 3 % en flecha y momento por metro
 *   (`validacion/cy/reticular.ts`);
 * - la hipótesis en el informe, y una opción no válida es un error.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { recuadroCype } from "../../validacion/cy/reticular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";
import { multiplicadoresReticular } from "./reticular.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const G = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.72 };

/** Recuadro reticular 25+5 de 6 × 6 m con un ábaco en una esquina. */
function recuadro(multiplicadores?: Record<string, number>): ModeloFisico {
  const sop = [true, true, true, false, false, false] as const;
  return {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [],
    losas: [
      {
        id: "L",
        planta: "P0",
        contorno: [[0, 0], [6, 0], [6, 6], [0, 6]],
        espesor: G.h,
        material: "H",
        pp: 4.5,
        reticular: { intereje: G.s, nervio: G.bw, capa: G.hf, abacos: [[[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]]], ...(multiplicadores ? { multiplicadores } : {}) },
      },
    ],
    apoyosLineales: [{ id: "a", planta: "P0", puntos: [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]], coartados: sop }],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

function zonas(f: ModeloFisico, op?: OpcionesCompilacion) {
  const r = valido(compilar(f, op));
  const lam = r.modelo.laminas!;
  const abaco = lam.filter((_, i) => r.mapeo.laminas![i]!.abaco);
  const aligerada = lam.filter((_, i) => !r.mapeo.laminas![i]!.abaco);
  expect(abaco.length).toBeGreaterThan(0);
  expect(aligerada.length).toBeGreaterThan(0);
  return { r, abaco, aligerada };
}

describe("rigidez del reticular (CY3)", () => {
  it("por defecto, la de CYPECAD en el aligerado y en los ábacos, sin Poisson", () => {
    const { abaco, aligerada } = zonas(recuadro());
    const calc = multiplicadoresReticular(G, 0.2);
    for (const l of aligerada) {
      expect(l.material.nu).toBe(0);
      expect(l.multiplicadores).toEqual({ ...calc, m11: 0.5, m22: 0.5, m12: 0.5 / 1.2 });
    }
    for (const l of abaco) {
      expect(l.material.nu).toBe(0);
      expect(l.multiplicadores).toEqual({ f11: 1, f22: 1, f12: 1 / 1.2, m11: 0.5, m22: 0.5, m12: 0.5 / 1.2, v13: 1 / 1.2, v23: 1 / 1.2 });
    }
  });

  it("«bruta» es C4-h: la T bruta en el aligerado y los ábacos macizos", () => {
    const { abaco, aligerada } = zonas(recuadro(), { rigidezReticular: "bruta" });
    for (const l of aligerada) expect(l.multiplicadores).toEqual(multiplicadoresReticular(G, 0.2));
    for (const l of abaco) {
      expect(l.multiplicadores).toBeUndefined();
      expect(l.material.nu).toBeCloseTo(0.2, 12);
    }
  });

  it("los multiplicadores dados mandan, con los ábacos macizos", () => {
    const dados = { m11: 0.4, m22: 0.4 };
    const { abaco, aligerada } = zonas(recuadro(dados));
    for (const l of aligerada) expect(l.multiplicadores).toEqual(dados);
    for (const l of abaco) expect(l.multiplicadores).toBeUndefined();
  });

  it("criterio 6: frente al emparrillado de CYPECAD como barras, ≤ 3 % en flecha y momento por metro", () => {
    for (const pilar of [false, true]) {
      const x = recuadroCype(8, pilar);
      expect(Math.abs(x.errorW), `${x.caso}: w`).toBeLessThan(0.03);
      expect(Math.abs(x.errorM), `${x.caso}: m`).toBeLessThan(0.03);
    }
  });

  it("la hipótesis va en el informe, y una opción no válida es un error", () => {
    expect(valido(compilar(recuadro())).hipotesis.some((h) => /con la rigidez de CYPECAD \(CY3\)/.test(h))).toBe(true);
    expect(valido(compilar(recuadro(), { rigidezReticular: "bruta" })).hipotesis.some((h) => /C4-h, rigidez «bruta»/.test(h))).toBe(true);
    const r = compilar(recuadro(), { rigidezReticular: "otra" as never });
    expect(r.valido).toBe(false);
  });
});
