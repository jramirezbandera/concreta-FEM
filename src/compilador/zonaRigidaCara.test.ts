/**
 * A2-51 (`docs/fem3d/auditoria-2.md` §10.2 y §11.1, decisión del usuario): una viga cuyo eje va por la
 * cara de un pilar (punto fijo en la mitad de un lado, la viga dibujada por los puntos fijos) cuenta
 * como dentro de su huella: lleva zona rígida hasta donde sale de ella. Antes, dentro o fuera según el
 * redondeo: en este pórtico, My = −75,10 sin trasladar y −72,24 trasladado (3,9 %).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { transformar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Pórtico de dos vanos de 6 m, pilares de 40 × 40 con el punto fijo en la mitad de su lado y = 0, viga por y = 0. */
const portico = (): ModeloFisico => ({
  plantas: [{ id: "N1", altura: null }, { id: "C", altura: 3 }],
  materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
  secciones: [
    { id: "p", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
    { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
  ],
  pilares: [0, 6, 12].map((x, i) => ({ id: `P${i}`, x, y: 0, desde: "C", hasta: "N1", seccion: "p", fijo: "mitad-inferior" as const })),
  vigas: [{ id: "V", planta: "N1", puntos: [[0, 0], [12, 0]], seccion: "v" }],
  casos: [{ id: "Q" }],
  cargas: [{ tipo: "viga", id: "q", caso: "Q", viga: "V", ejes: "global", q: [0, 0, -20] }],
});

describe("A2-51: el eje de una viga por la cara de un pilar cuenta como dentro", () => {
  it("la zona rígida y el momento de la viga no dependen de dónde está la planta", () => {
    const res = ([[0, 0], [10, -10], [0.7, 0.7], [0, 1 / 3]] as const).map(([dx, dy]) => {
      const c = compilar(transformar(portico(), { p: (q) => [q[0] + dx, q[1] + dy], v: (q) => [q[0]!, q[1]!, q[2]!], giro: 0 }));
      if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
      const r = casosValidos(calcular(c.modelo))[0]!;
      const vigas = c.mapeo.barras.map((m, k) => ({ m, k })).filter((x) => x.m.tipo === "viga");
      // Con el factor 0,5, la mitad de la cuerda del eje en la huella desde el nudo (0,20 m): 0,10
      const zonas = vigas.flatMap((x) => [x.m.s[1] - x.m.s[0], x.m.s[3] - x.m.s[2]]);
      let my = 0;
      for (const x of vigas) for (const q of [4, 10]) my = Math.min(my, r.esfuerzosBarras[12 * x.k + q]!);
      return { zonas, my };
    });
    for (const x of res) {
      for (const z of x.zonas) expect(z).toBeCloseTo(0.1, 9);
      expect(Math.abs(x.my - res[0]!.my) / Math.abs(res[0]!.my)).toBeLessThan(1e-9);
    }
  });
});
