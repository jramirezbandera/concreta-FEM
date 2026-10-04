/**
 * Esfuerzos por pieza física (`EsfuerzosPiezas`): recorrer una pieza por sus estaciones con el
 * mapeo, frente a soluciones cerradas.
 */
import { describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";
import { EsfuerzosPiezas } from "./resultados.ts";

const base = (extra: Partial<ModeloFisico>): ModeloFisico => ({
  plantas: [
    { id: "P1", altura: null, diafragma: "ninguno" },
    { id: "C", altura: 3, tipo: "sotano" },
  ],
  materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
  secciones: [
    { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    { id: "p", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
  ],
  casos: [{ id: "Q" }],
  ...extra,
});

function piezas(f: ModeloFisico) {
  const r = compilar(f);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new EsfuerzosPiezas(r.modelo, r.mapeo, casosValidos(calcular(r.modelo, { solver: "perfil" })));
}

describe("esfuerzos por pieza física", () => {
  it("viga biapoyada partida en tres tramos por apoyos intermedios sin coacción vertical: M = q·s·(L − s)/2 y V = q·(s − L/2)", () => {
    // Apoyos en los extremos y dos nudos intermedios (apoyos que sólo coartan el giro alrededor del eje: no cambian nada)
    const q = 10;
    const L = 6;
    const ep = base({
      vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [2, 0], [6, 0]], seccion: "v" }],
      apoyos: [
        { id: "A", planta: "P1", x: 0, y: 0, coartados: [true, true, true, true, false, false] },
        { id: "B", planta: "P1", x: 6, y: 0, coartados: [false, true, true, false, false, false] },
        { id: "M", planta: "P1", x: 4.5, y: 0, coartados: [false, false, false, true, false, false] },
      ],
      cargas: [{ tipo: "viga", id: "q", caso: "Q", viga: "V", ejes: "global", q: [0, 0, -q] }],
    });
    const e = piezas(ep);
    expect(e.tramos("V").map((t) => [t.s0, t.s1])).toEqual([
      [0, 2],
      [2, 4.5],
      [4.5, 6],
    ]);
    for (const s of [0.3, 2, 3, 4.5, 5.9]) {
      const [N, Vy, Vz, T, My, Mz] = e.en("V", 0, s)!;
      expect(My).toBeCloseTo((q * s * (L - s)) / 2, 9);
      expect(Vz).toBeCloseTo(q * (s - L / 2), 9);
      for (const x of [N, Vy, T, Mz]) expect(Math.abs(x!)).toBeLessThan(1e-9);
    }
    // a uno y otro lado del nudo intermedio, lo mismo (no hay carga puntual)
    expect(e.en("V", 0, 2, -1)![4]).toBeCloseTo(e.en("V", 0, 2, 1)![4]!, 9);
  });

  it("viga empotrada en dos pilares muy rígidos: la mitad del nudo rígida (por defecto), sin esfuerzos, y M = q·L'²/12 al final de la zona rígida", () => {
    const q = 12;
    const f = base({
      secciones: [
        { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
        { id: "p", material: "general", forma: "general", A: 10, Iy: 100, Iz: 100, J: 100, b: 0.4, h: 0.4 },
      ],
      materiales: [
        { id: "HA", tipo: "hormigon", fck: 25 },
        { id: "general", tipo: "general", E: 3e10, G: 1.2e10, peso: 0 },
      ],
      pilares: [
        { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p" },
        { id: "B", x: 6, y: 0, desde: "C", hasta: "P1", seccion: "p" },
      ],
      vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" }],
      cargas: [{ tipo: "viga", id: "q", caso: "Q", viga: "V", ejes: "global", q: [0, 0, -q] }],
    });
    const e = piezas(f);
    const [t] = e.tramos("V");
    expect([t!.s0, t!.s1]).toEqual([0.1, 5.9]);
    expect(e.en("V", 0, 0.05)).toBeNull();
    const Lp = 5.8;
    // Con los pilares casi rígidos, empotramiento perfecto al final de la zona rígida (a 1e-6 por su flexibilidad)
    expect(e.en("V", 0, 0.1)![4]! / (-(q * Lp * Lp) / 12)).toBeCloseTo(1, 6);
    expect(e.en("V", 0, 3)![4]! / ((q * Lp * Lp) / 24)).toBeCloseTo(1, 6);
  });
});
