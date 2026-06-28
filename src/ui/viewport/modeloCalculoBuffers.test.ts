// Tests de modeloCalculoBuffers (PURA): empaquetado a Float32Array.
import { describe, it, expect } from "vitest";
import { buffersBarras, buffersNudos } from "./modeloCalculoBuffers";
import type { SegmentoCalc } from "./modeloCalculoGeometria";

const COL_BARRA = [0.1, 0.2, 0.3] as const;
const COL_RELEASE = [0.9, 0.5, 0.1] as const;

describe("buffersBarras", () => {
  it("empaqueta 2 vertices por barra (posicion) en orden i,j", () => {
    const barras: SegmentoCalc[] = [
      { i: [0, 0, 0], j: [1, 2, 3], conRelease: false },
    ];
    const { posiciones, n } = buffersBarras(barras, COL_BARRA, COL_RELEASE);
    expect(n).toBe(1);
    expect(Array.from(posiciones)).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it("colorea cada barra: normal -> colBarra; con release -> colRelease (ambos vertices)", () => {
    const barras: SegmentoCalc[] = [
      { i: [0, 0, 0], j: [1, 0, 0], conRelease: false },
      { i: [1, 0, 0], j: [2, 0, 0], conRelease: true },
    ];
    const { colores } = buffersBarras(barras, COL_BARRA, COL_RELEASE);
    // Float32 redondea: comparamos contra el mismo redondeo (expected via Float32Array).
    const f32 = (xs: number[]) => Array.from(new Float32Array(xs));
    // Barra 0 (sin release): ambos vertices colBarra.
    expect(Array.from(colores.slice(0, 6))).toEqual(f32([0.1, 0.2, 0.3, 0.1, 0.2, 0.3]));
    // Barra 1 (con release): ambos vertices colRelease.
    expect(Array.from(colores.slice(6, 12))).toEqual(f32([0.9, 0.5, 0.1, 0.9, 0.5, 0.1]));
  });

  it("lista vacia -> buffers vacios", () => {
    const { posiciones, colores, n } = buffersBarras([], COL_BARRA, COL_RELEASE);
    expect(n).toBe(0);
    expect(posiciones).toHaveLength(0);
    expect(colores).toHaveLength(0);
  });
});

describe("buffersNudos", () => {
  it("un vertice por nudo", () => {
    const pos = buffersNudos([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(Array.from(pos)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
