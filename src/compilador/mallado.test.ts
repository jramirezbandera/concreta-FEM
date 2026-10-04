/**
 * Mallador de C2 por sí solo: validador de H23, cobertura de lados y puntos, calidad, y la misma
 * malla tras una traslación exacta o un giro de 90° con el eje 1.
 */
import { describe, expect, it } from "vitest";
import { Arreglo } from "./arreglo.ts";
import type { Vec2 } from "./fisico.ts";
import { jacobianoEscalado, mallarPlanta, type LosaMallar, type ResultadoMalla } from "./mallado.ts";

type Ok = Extract<ResultadoMalla, { ok: true }>;
const ok = (r: ResultadoMalla): Ok => {
  if (!r.ok) throw new Error(r.mensaje);
  return r;
};

interface Escena {
  losas: { id: string; contorno: Vec2[]; huecos?: Vec2[][]; eje1?: Vec2 }[];
  vigas?: Vec2[][];
  huellas?: Vec2[][];
  fijos?: Vec2[];
}

function mallar(e: Escena, h: number, T: (p: Vec2) => Vec2 = (p) => p, R: (v: Vec2) => Vec2 = (v) => v): { a: Arreglo; m: Ok } {
  const a = new Arreglo(1e-6, 0.05);
  (e.fijos ?? []).forEach((p, i) => a.fijo(T(p)[0], T(p)[1], i));
  (e.vigas ?? []).forEach((v, i) => a.trazo(`V${i}`, "viga", i, v.map(T), false));
  (e.huellas ?? []).forEach((v, i) => a.trazo(`P${i}`, "huella", i, v.map(T), true));
  const losas: LosaMallar[] = e.losas.map((l) => {
    const contorno = a.trazo(l.id, "losa", -1, l.contorno.map(T), true)!;
    const huecos = (l.huecos ?? []).map((hh, j) => a.trazo(l.id, "hueco", j, hh.map(T), true)!);
    return { id: l.id, contorno, huecos, eje1: R(l.eje1 ?? [1, 0]) };
  });
  expect(a.resolver()).toBe(true);
  expect(a.defecto()).toBeNull();
  return { a, m: ok(mallarPlanta(a, losas, h)) };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const PLANTA: Escena = {
  losas: [
    {
      id: "L1",
      contorno: [
        [0, 0],
        [12, 0],
        [12, 5],
        [7, 5],
        [7, 9],
        [0, 9],
      ],
      huecos: [rect(2, 5.5, 4, 8)],
    },
  ],
  vigas: [
    [
      [0, 0],
      [7, 9],
    ],
    [
      [0, 5],
      [12, 5],
    ],
  ],
  huellas: [rect(-0.2, -0.2, 0.2, 0.2), rect(5.8, -0.15, 6.2, 0.15), rect(11.8, 4.8, 12.2, 5.2)],
  fijos: [
    [0, 0],
    [6, 0],
    [12, 5],
  ],
};

describe("mallador de losas", () => {
  it("losa cuadrada: validador limpio y buena calidad", () => {
    const { m } = mallar({ losas: [{ id: "L1", contorno: rect(0, 0, 6, 6) }] }, 0.5);
    expect(m.problemas).toEqual([]);
    expect(m.calidad.jacobianoMin).toBeGreaterThan(0.4);
    let A = 0;
    for (const q of m.quads) {
      const X = q.nudos.map((n) => [m.nudos[n]!.x, m.nudos[n]!.y] as Vec2);
      expect(jacobianoEscalado(X)).toBeGreaterThan(0);
      for (let i = 0; i < 4; i++) A += (X[i]![0] * X[(i + 1) % 4]![1] - X[(i + 1) % 4]![0] * X[i]![1]) / 2;
    }
    expect(A).toBeCloseTo(36, 10);
    // Cada lado del contorno queda partido en tramos de ≤ h
    for (const c of m.nudosLado) {
      for (let i = 0; i + 1 < c.length; i++) {
        const [p, q] = [m.nudos[c[i]!]!, m.nudos[c[i + 1]!]!];
        expect(Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2)).toBeLessThanOrEqual(0.5 + 1e-12);
      }
    }
  });

  it("losa en L con hueco, viga oblicua, viga de borde interior y huellas", () => {
    const { a, m } = mallar(PLANTA, 0.4);
    expect(m.problemas.filter((p) => p.severidad === "error")).toEqual([]);
    expect(m.calidad.jacobianoMin).toBeGreaterThan(0);
    // Los nudos fijos dentro de la losa son vértices de la malla
    for (let i = 0; i < 3; i++) expect(m.nudos.some((n) => n.punto === a.puntos.findIndex((p) => p.nudo === i))).toBe(true);
    // La viga oblicua tiene nudos de malla a lo largo de toda su parte dentro de la losa
    const lv = m.lados.map((l, i) => ({ l, i })).filter(({ l }) => l.trazos.some((t) => a.trazos[t]!.id === "V0"));
    expect(lv.length).toBeGreaterThan(0);
    for (const { i } of lv) expect(m.nudosLado[i]!.length).toBeGreaterThanOrEqual(3);
  });

  it("la misma malla trasladada (exacta) y girada 90° con el eje 1", () => {
    const base = mallar(PLANTA, 0.4).m;
    const tras = mallar(PLANTA, 0.4, (p) => [p[0] + 64, p[1] - 32]).m;
    const giro = mallar(
      PLANTA,
      0.4,
      (p) => [-p[1], p[0]],
      (v) => [-v[1], v[0]],
    ).m;
    for (const [m, T] of [
      [tras, (p: Vec2): Vec2 => [p[0] + 64, p[1] - 32]],
      [giro, (p: Vec2): Vec2 => [-p[1], p[0]]],
    ] as const) {
      expect(m.quads.length).toBe(base.quads.length);
      expect(m.nudos.length).toBe(base.nudos.length);
      // Cada cuadrilátero de la base, transformado, está en la otra malla
      const clave = (X: Vec2) => `${X[0].toFixed(9)},${X[1].toFixed(9)}`;
      const quads = new Set(m.quads.map((q) => q.nudos.map((n) => clave([m.nudos[n]!.x, m.nudos[n]!.y])).join("|")));
      let iguales = 0;
      for (const q of base.quads) {
        const X = q.nudos.map((n) => clave(T([base.nudos[n]!.x, base.nudos[n]!.y])));
        // misma rotación cíclica: buscar las 4
        if ([0, 1, 2, 3].some((r) => quads.has([...X.slice(r), ...X.slice(0, r)].join("|")))) iguales++;
      }
      expect(iguales).toBe(base.quads.length);
    }
  });
});
