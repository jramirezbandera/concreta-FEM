import { describe, expect, it } from "vitest";
import type { Vec2 } from "../agente/render/escena.ts";
import type { Capa, EscenaPreparada } from "./escena.ts";
import { centroide, engancharEscena, medir, poligonoSeCruza } from "./medir.ts";

describe("medir", () => {
  it("una distancia: el tramo, Δx y Δy", () => {
    const r = medir("distancia", [
      [1, 2],
      [4, 6],
    ]);
    expect(r.total).toBe(5);
    expect([r.dx, r.dy]).toEqual([3, 4]);
    expect(r.area).toBeNull();
  });

  it("una polilínea suma sus tramos y no se cierra", () => {
    const r = medir("distancia", [
      [0, 0],
      [3, 0],
      [3, 4],
      [0, 4],
    ]);
    expect(r.tramos).toEqual([3, 4, 3]);
    expect(r.total).toBe(10);
  });

  it("un área: el rectángulo, en los dos sentidos, con su perímetro y su centroide", () => {
    const ps: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ];
    for (const x of [ps, [...ps].reverse()]) {
      const r = medir("area", x);
      expect(r.area).toBe(12);
      expect(r.total).toBe(14);
      expect(r.tramos).toHaveLength(4);
      expect(r.centroide).toEqual([2, 1.5]);
      expect(r.seCruza).toBe(false);
    }
  });

  it("una L lejos del origen, sin perder cifras", () => {
    const o = 1e5;
    const L: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 5],
      [0, 5],
    ].map(([x, y]) => [x! + o, y! + o]);
    const r = medir("area", L);
    // 6·2 + 2·3 = 18; centroide: (12·(3, 1) + 6·(1, 3.5)) / 18
    expect(r.area).toBeCloseTo(18, 9);
    expect(r.centroide![0] - o).toBeCloseTo((12 * 3 + 6 * 1) / 18, 9);
    expect(r.centroide![1] - o).toBeCloseTo((12 * 1 + 6 * 3.5) / 18, 9);
  });

  it("con dos puntos un área no tiene área", () => {
    const r = medir("area", [
      [0, 0],
      [1, 0],
    ]);
    expect(r.area).toBeNull();
    expect(r.tramos).toEqual([1]);
  });

  it("un contorno que se cruza se avisa", () => {
    const lazo: Vec2[] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ];
    expect(poligonoSeCruza(lazo)).toBe(true);
    expect(medir("area", lazo).seCruza).toBe(true);
    expect(
      poligonoSeCruza([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(false);
  });

  it("el centroide de un polígono degenerado es el de sus vértices", () => {
    expect(
      centroide([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toEqual([1, 0]);
  });
});

describe("engancharEscena", () => {
  const capa = (forma: Capa["forma"], segs: number[]): Capa => {
    const s = new Float32Array(segs);
    const xs = segs.filter((_, i) => i % 2 === 0);
    const ys = segs.filter((_, i) => i % 2 === 1);
    return { estilo: "viga" as Capa["estilo"], forma, abanicos: new Float32Array(), segmentos: s, caja: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  };
  // Un segmento de (10, 10) a (14, 10), con el origen de la escena en (10, 10)
  const escena = (capas: Capa[]) => ({ origen: [10, 10], capas }) as unknown as EscenaPreparada;
  const e = escena([capa("area", [0, 0, 4, 0])]);

  it("los vértices antes que el punto medio y que el punto de la línea", () => {
    expect(engancharEscena(e, [10.1, 10.05], 0.2)).toEqual({ p: [10, 10], tipo: "vertice" });
    expect(engancharEscena(e, [12.1, 10.05], 0.2)).toEqual({ p: [12, 10], tipo: "medio" });
    const c = engancharEscena(e, [13, 10.1], 0.2)!;
    expect(c.tipo).toBe("cercano");
    expect(c.p).toEqual([13, 10]);
    expect(engancharEscena(e, [13, 11], 0.2)).toBeNull();
  });

  it("no engancha a las bandas de isovalores ni a lo que va encima de las piezas (cargas, diagramas)", () => {
    expect(engancharEscena(escena([capa("region", [0, 0, 4, 0])]), [10, 10], 0.2)).toBeNull();
    for (const estilo of ["carga-puntual", "diagrama-positivo", "malla", "isolinea"])
      expect(engancharEscena(escena([{ ...capa("trazo", [0, 0, 4, 0]), estilo: estilo as Capa["estilo"] }]), [10, 10], 0.2)).toBeNull();
    // El modelo atenuado de fondo (en Cargas), sí
    expect(engancharEscena(escena([{ ...capa("area", [0, 0, 4, 0]), estilo: "atenuado" }]), [10, 10], 0.2)?.tipo).toBe("vertice");
  });

  it("engancha también a la plantilla DXF", () => {
    const plantilla = { posiciones: new Float32Array([0, 0, 0, 1, 1, 0]), origen: [20, 20] as Vec2 };
    expect(engancharEscena(null, [21.05, 21], 0.2, plantilla)).toEqual({ p: [21, 21], tipo: "vertice" });
  });
});
