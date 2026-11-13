/**
 * A2-31 (`docs/fem3d/auditoria-2.md` §11.2, decisión del usuario): el peso de una viga bajo una losa
 * (C2-g, AU-4) descuenta lo que la losa pisa de verdad en cada mitad de su ancho. Antes se miraba un
 * punto a b/4 del eje: con el borde de la losa entre el eje y la cara, se dejaba sin contar o se contaba
 * de más hasta γ·t·b/4 por metro. El esperado de A3, que ya integraba con el área, es ahora el calculado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { pesoPropioCalculado, pesoPropioEsperado, Plantas } from "../agente/sensatez.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/**
 * Losa maciza de 6 × 5 sobre cuatro pilares, con una viga de 30 × 50 por y = 0 y el borde de la losa en
 * y = e (± `oblicuo` en sus extremos). Los bordes, a más de ε_snap del eje y de las caras: más cerca, el
 * arreglo los ajusta (`losa/ajuste`) y el esperado de A3, que usa lo dibujado, ya no es comparable.
 */
function borde(e: number, oblicuo = 0): ModeloFisico {
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
      { id: "P2", x: 6, y: 0, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P3", x: 0, y: -5, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P4", x: 6, y: -5, desde: "C", hasta: "N1", seccion: "P30" },
    ],
    vigas: [{ id: "V1", planta: "N1", puntos: [[0, 0], [6, 0]], seccion: "V" }],
    losas: [{ id: "L1", planta: "N1", contorno: [[-0.15, -5.15], [6.15, -5.15], [6.15, e + oblicuo], [-0.15, e - oblicuo]], espesor: 0.2, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
  };
}

describe("A2-31: el peso de la viga bajo la losa, con el área de cada mitad de su ancho", () => {
  for (const [e, oblicuo, que] of [
    [0.07, 0, "el borde a 7 cm del eje, del lado de fuera (antes de b/4)"],
    [-0.09, 0, "el borde a 9 cm del eje, del lado de dentro (pasado b/4)"],
    [0.1, 0, "el borde a 10 cm del eje, entre b/4 y la cara"],
    [0.075, 0.015, "el borde oblicuo, de 6 a 9 cm del eje, cruzando b/4"],
  ] as const)
    it(`${que}: el peso calculado es el esperado de A3 a 1e-9`, () => {
      const f = borde(e, oblicuo);
      expect(compilar(f).diagnosticos.map((d) => d.codigo)).not.toContain("losa/ajuste");
      const calc = pesoPropioCalculado(f, undefined);
      expect(calc).not.toBeNull();
      const n1 = pesoPropioEsperado(f, new Plantas(f)).find((x) => x.planta === "N1")!;
      expect(Math.abs(calc!.get("N1")! - n1.esperado)).toBeLessThanOrEqual(1e-9 * n1.esperado);
    });

  it("con la mitad cubierta entera o nada (el borde en el eje o en una cara), lo de antes: γ·(b/2)·t por metro y lado cubierto", () => {
    for (const [e, lados] of [
      [0, 1],
      [0.15, 2],
    ] as const) {
      const f = borde(e);
      const calc = pesoPropioCalculado(f, undefined)!.get("N1")!;
      const n1 = pesoPropioEsperado(f, new Plantas(f)).find((x) => x.planta === "N1")!;
      expect(Math.abs(calc - n1.esperado)).toBeLessThanOrEqual(1e-9 * calc);
      // La viga, con su descuelgue donde la cubre la losa: 25·0,3·0,5·6 − lados·25·0,15·0,2·6
      expect(n1.vigas - n1.solapes).toBeCloseTo(25 * 0.3 * 0.5 * 6 - lados * 25 * 0.15 * 0.2 * 6, 9);
    }
  });
});
