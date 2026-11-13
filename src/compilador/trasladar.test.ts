/**
 * A2-54 (`docs/fem3d/auditoria-2.md` §10.2 y §11): la malla no depende de la posición de la planta
 * (regla del mallador). Con un apoyo lineal que acaba a δ justo (0,45·2h = 0,675 m con h = 0,75) de
 * una línea de la rejilla, la celda junto a él era irregular o no según el redondeo de la traslación,
 * y con ella la plantilla del pilar apeado de al lado: 838, 860, 866 u 872 nudos.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";
import { transformar } from "../pruebas/metamorficasFisicas.ts";

/** Dos vanos de 6 × 5 en dos plantas, con pilares apeados en la losa y en una viga, y un apoyo lineal que llega a una viga. */
function apeados(): ModeloFisico {
  const pil = (id: string, x: number, y: number, hasta: string, extra: object = {}) => ({ id, x, y, desde: "C", hasta, seccion: "p", ...extra });
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [
      pil("A1", 0, 0, "P2"),
      pil("A2", 6, 0, "P1"),
      pil("A3", 12, 0, "P2"),
      pil("B1", 0, 5, "P2"),
      pil("B2", 6, 5, "P2"),
      pil("B3", 12, 5, "P2"),
      { id: "AL", x: 3, y: 2.5, desde: "P1", hasta: "P2", seccion: "p", base: "ninguno" },
      { id: "AV", x: 9, y: 0, desde: "P1", hasta: "P2", seccion: "p", base: "ninguno" },
    ],
    vigas: [
      { id: "Vy0", planta: "P1", puntos: [[0, 0], [12, 0]], seccion: "v" },
      { id: "Vy5", planta: "P1", puntos: [[0, 5], [12, 5]], seccion: "v" },
      { id: "Vx0", planta: "P1", puntos: [[0, 0], [0, 5]], seccion: "v" },
      { id: "Vx6", planta: "P1", puntos: [[6, 0], [6, 5]], seccion: "v" },
      { id: "Vx12", planta: "P1", puntos: [[12, 0], [12, 5]], seccion: "v" },
    ],
    apoyosLineales: [{ id: "ALV", planta: "P1", puntos: [[9, 2], [9, 5]], coartados: [false, false, true, false, false, false] }],
    losas: [
      { id: "L1", planta: "P1", contorno: [[0, 0], [12, 0], [12, 5], [0, 5]], espesor: 0.25, material: "HA" },
      { id: "L2", planta: "P2", contorno: [[0, 0], [12, 0], [12, 5], [0, 5]], espesor: 0.25, material: "HA" },
    ],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

describe("A2-54: la malla no cambia al trasladar la planta", () => {
  it("con un apoyo lineal que acaba a δ de una línea de la rejilla, los mismos nudos en cada traslación", () => {
    const base = compilar(apeados());
    if (!base.valido) throw new Error(base.diagnosticos.map((d) => d.mensaje).join("\n"));
    for (const [dx, dy] of [
      [10, -10],
      [100, 100],
      [-3, 7],
    ] as const) {
      const c = compilar(transformar(apeados(), { p: (q) => [q[0] + dx, q[1] + dy], v: (q) => [q[0]!, q[1]!, q[2]!], giro: 0 }));
      if (!c.valido) throw new Error("no compila");
      expect(c.modelo.nudos.length, `(${dx}; ${dy})`).toBe(base.modelo.nudos.length);
      const fuera = c.modelo.nudos.filter((n) => !base.modelo.nudos.some((m) => Math.abs(m.x - (n.x - dx)) + Math.abs(m.y - (n.y - dy)) + Math.abs(m.z - n.z) <= 1e-9));
      expect(fuera.length, `(${dx}; ${dy}): ${fuera.slice(0, 5).map((n) => `(${n.x - dx}, ${n.y - dy}, ${n.z})`).join(" ")}`).toBe(0);
    }
  }, 60_000);
});
