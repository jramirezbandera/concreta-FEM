/**
 * Mallador de C2 por sí solo: validador de H23, cobertura de lados y puntos, calidad, y la misma
 * malla tras una traslación exacta o un giro de 90° con el eje 1.
 */
import { describe, expect, it } from "vitest";
import { Arreglo } from "./arreglo.ts";
import { distanciaABorde } from "./poligonos.ts";
import type { Vec2 } from "./fisico.ts";
import { COBERTURA_MINIMA, jacobianoEscalado, mallarPlanta, mallarPlantaCon, type LosaMallar, type ResultadoMalla } from "./mallado.ts";

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

function mallar(e: Escena, h: number, T: (p: Vec2) => Vec2 = (p) => p, R: (v: Vec2) => Vec2 = (v) => v, rejilla = true): { a: Arreglo; m: Ok } {
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
  return { a, m: ok(mallarPlantaCon(a, losas, h, 1e-6, undefined, rejilla)) };
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

/** Toda arista de la malla la comparten dos cuadriláteros, salvo las del borde de las losas. */
function sueltas(m: Ok): number {
  const n = new Map<string, number>();
  for (const q of m.quads)
    for (let i = 0; i < 4; i++) {
      const [a, b] = [q.nudos[i]!, q.nudos[(i + 1) % 4]!];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      n.set(k, (n.get(k) ?? 0) + 1);
    }
  let malas = 0;
  for (const [k, c] of n) {
    if (c === 2) continue;
    const [a, b] = k.split(",").map(Number) as [number, number];
    const M: Vec2 = [(m.nudos[a]!.x + m.nudos[b]!.x) / 2, (m.nudos[a]!.y + m.nudos[b]!.y) / 2];
    const enBorde = m.regiones.some((r) => [r.contorno, ...r.huecos].some((p) => distanciaABorde(M, p) < 1e-9));
    if (c > 2 || !enBorde) malas++;
  }
  return malas;
}

/** Vigas entre las caras de pilares cuadrados de lado b en una retícula (como las recorta C2). */
function porticos(xs: number[], ys: number[], b: number, ex = 0, ey = 0): { vigas: Vec2[][]; huellas: Vec2[][] } {
  const r = b / 2;
  const vigas: Vec2[][] = [];
  for (const y of ys) for (let i = 0; i + 1 < xs.length; i++) vigas.push([[xs[i]! + r, y + (y === ys[0] ? ey : y === ys[ys.length - 1] ? -ey : 0)], [xs[i + 1]! - r, y + (y === ys[0] ? ey : y === ys[ys.length - 1] ? -ey : 0)]]);
  for (const x of xs) for (let j = 0; j + 1 < ys.length; j++) vigas.push([[x + (x === xs[0] ? ex : x === xs[xs.length - 1] ? -ex : 0), ys[j]! + r], [x + (x === xs[0] ? ex : x === xs[xs.length - 1] ? -ex : 0), ys[j + 1]! - r]]);
  return { vigas, huellas: xs.flatMap((x) => ys.map((y) => rect(x - r, y - r, x + r, y + r))) };
}

describe("rejilla alineada (H52)", () => {
  const RETICULA = porticos([0, 6, 12], [0, 5, 10], 0.4);

  it("losa a ejes con vigas y pilares: toda en rejilla, con una plantilla por pilar", () => {
    const { m } = mallar({ losas: [{ id: "L", contorno: rect(0, 0, 12, 10) }], ...RETICULA }, 0.75);
    expect(m.problemas).toEqual([]);
    expect(m.rejilla.plantillas).toBe(9);
    expect(m.rejilla.quads).toBe(m.quads.length);
    expect(sueltas(m)).toBe(0);
    expect(m.calidad.jacobianoMin).toBeGreaterThan(0.3);
  });

  it("pilares de fachada enrasados y vigas de fachada a b/2 del borde: también en rejilla", () => {
    // Losa enrasada con la cara exterior de los pilares; las vigas de fachada (b = 0,3) por dentro
    const p = porticos([0, 6, 12], [0, 5, 10], 0.4, 0.05, 0.05);
    const { m } = mallar({ losas: [{ id: "L", contorno: rect(-0.2, -0.2, 12.2, 10.2) }], ...p }, 0.75);
    expect(m.problemas).toEqual([]);
    expect(m.rejilla.plantillas).toBe(9);
    expect(m.rejilla.quads).toBe(m.quads.length);
    expect(sueltas(m)).toBe(0);
    expect(m.calidad.jacobianoMin).toBeGreaterThan(0.3);
  });

  it("rejilla y triangulación juntas: malla conforme, con la interfaz partida igual a los dos lados", () => {
    for (const h of [0.75, 0.5, 0.4, 0.3]) {
      const { m } = mallar(PLANTA, h);
      expect(m.problemas.filter((x) => x.severidad === "error"), `h = ${h}`).toEqual([]);
      expect(m.rejilla.quads, `h = ${h}`).toBeGreaterThan(0);
      expect(m.rejilla.quads, `h = ${h}`).toBeLessThan(m.quads.length);
      expect(sueltas(m), `h = ${h}`).toBe(0);
    }
  });

  it("una franja estrecha que toca la triangulación se parte entera (paridad)", () => {
    // La viga larga a 0,25 m del borde deja una franja de ≤ h; la oblicua obliga a la CDT a su lado
    const { m } = mallar(
      {
        losas: [{ id: "L", contorno: rect(0, 0, 8, 6) }],
        vigas: [
          [
            [0, 0.25],
            [8, 0.25],
          ],
          [
            [3, 2],
            [4.3, 3.1],
          ],
        ],
      },
      0.5,
    );
    expect(m.problemas.filter((x) => x.severidad === "error")).toEqual([]);
    expect(m.rejilla.quads).toBeLessThan(m.quads.length);
    expect(sueltas(m)).toBe(0);
  });

  it("si la rejilla cubre poco, se queda la malla con menos nudos (con o sin ella); si no, la rejilla", () => {
    let comparadas = 0;
    for (const h of [0.75, 0.5, 0.4, 0.3]) {
      const { a, m: con } = mallar(PLANTA, h);
      const sin = mallar(PLANTA, h, undefined, undefined, false).m;
      const losas: LosaMallar[] = a.trazos.flatMap((t) => (t.tipo === "losa" ? [{ id: t.id, contorno: t, huecos: a.trazos.filter((x) => x.tipo === "hueco" && x.id === t.id), eje1: [1, 0] as Vec2 }] : []));
      const r = ok(mallarPlanta(a, losas, h));
      if (con.rejilla.cobertura < COBERTURA_MINIMA) {
        comparadas++;
        expect(r.nudos.length, `h = ${h}`).toBe(Math.min(con.nudos.length, sin.nudos.length));
      } else expect(r.nudos.length, `h = ${h}`).toBe(con.nudos.length);
    }
    expect(comparadas).toBeGreaterThan(0);
  });

  it("sin rejilla, la triangulación de siempre", () => {
    const { m } = mallar({ losas: [{ id: "L", contorno: rect(0, 0, 12, 10) }], ...RETICULA }, 0.75, undefined, undefined, false);
    expect(m.problemas.filter((x) => x.severidad === "error")).toEqual([]);
    expect(m.rejilla).toMatchObject({ celdas: 0, plantillas: 0, quads: 0 });
    expect(sueltas(m)).toBe(0);
  });

  it("la misma malla trasladada, girada 90° y girada 37° con el eje 1", () => {
    const escena: Escena = { losas: [{ id: "L", contorno: rect(-0.2, -0.2, 12.2, 10.2) }], ...porticos([0, 6, 12], [0, 5, 10], 0.4, 0.05, 0.05) };
    const base = mallar(escena, 0.75).m;
    const c = Math.cos((37 * Math.PI) / 180);
    const s = Math.sin((37 * Math.PI) / 180);
    for (const [T, R] of [
      [(p: Vec2): Vec2 => [p[0] + 64, p[1] - 32], (v: Vec2) => v],
      [(p: Vec2): Vec2 => [-p[1], p[0]], (v: Vec2): Vec2 => [-v[1], v[0]]],
      [(p: Vec2): Vec2 => [c * p[0] - s * p[1], s * p[0] + c * p[1]], (v: Vec2): Vec2 => [c * v[0] - s * v[1], s * v[0] + c * v[1]]],
    ] as const) {
      const m = mallar(escena, 0.75, T, R).m;
      expect(m.quads.length).toBe(base.quads.length);
      expect(m.nudos.length).toBe(base.nudos.length);
      expect(m.rejilla).toEqual(base.rejilla);
      // Cada nudo de la base, transformado, está en la otra malla
      const otros = m.nudos.map((n) => [n.x, n.y] as Vec2);
      for (const n of base.nudos) {
        const q = T([n.x, n.y]);
        expect(otros.some((o) => Math.abs(o[0] - q[0]) < 1e-9 && Math.abs(o[1] - q[1]) < 1e-9)).toBe(true);
      }
    }
  });
});
