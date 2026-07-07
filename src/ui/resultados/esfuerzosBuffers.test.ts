// Tests del modulo PURO esfuerzosBuffers (cinta rellena + contorno del overlay de
// esfuerzos). Corre en el project node/jsdom sin R3F. Cubre: recuento de vertices
// con y sin cierres, posiciones de la curva de ordenadas (escalaTotal aplicada),
// color por signo, gris obsoleto y entradas vacias/escala 0.
//
// GOTCHA Float32 (deformadaBuffers.test.ts): los colores three.Color son float64 y
// el buffer Float32; se compara con toBeCloseTo, nunca igualdad estricta.
import { describe, it, expect } from "vitest";
import { Color } from "three";
import { construirBuffersEsfuerzos } from "./esfuerzosBuffers";
import type { GeometriaEsfuerzos } from "./esfuerzosGeometria";

// Diagrama de UNA barra horizontal de 4 m en X de escena, cota 3, ordenada vertical
// [0,0,1], un tramo negativo [0,-8,0] (parabola de vano, cierres en 0).
function geoVano(): GeometriaEsfuerzos {
  return {
    diagramas: [
      {
        member: "M1",
        ejeY: [0, 0, 1],
        tramos: [
          {
            bases: [
              [0, 0, 3],
              [2, 0, 3],
              [4, 0, 3],
            ],
            valores: [0, -8, 0],
            signo: -1,
          },
        ],
      },
    ],
    vMaxAbs: 8,
  };
}

// Dos tramos que comparten el corte (cortante +6 -> -6): cierres SOLO en los
// extremos de barra (v≠0), no en el corte (v=0).
function geoCortante(): GeometriaEsfuerzos {
  return {
    diagramas: [
      {
        member: "M1",
        ejeY: [0, 0, 1],
        tramos: [
          {
            bases: [
              [0, 0, 3],
              [2, 0, 3],
            ],
            valores: [6, 0],
            signo: 1,
          },
          {
            bases: [
              [2, 0, 3],
              [4, 0, 3],
            ],
            valores: [0, -6],
            signo: -1,
          },
        ],
      },
    ],
    vMaxAbs: 6,
  };
}

function colorEn(buf: Float32Array, vertice: number): [number, number, number] {
  return [buf[vertice * 3]!, buf[vertice * 3 + 1]!, buf[vertice * 3 + 2]!];
}

function esperaColor(actual: [number, number, number], esperado: Color): void {
  expect(actual[0]).toBeCloseTo(esperado.r, 5);
  expect(actual[1]).toBeCloseTo(esperado.g, 5);
  expect(actual[2]).toBeCloseTo(esperado.b, 5);
}

describe("construirBuffersEsfuerzos", () => {
  it("recuento: tramo de 3 puntos con extremos en 0 -> 12 verts de relleno, 4 de contorno", () => {
    const b = construirBuffersEsfuerzos({
      geometria: geoVano(),
      escalaTotal: 0.1,
      vigente: true,
    })!;
    expect(b).not.toBeNull();
    // Relleno: 2 segmentos × 2 triangulos × 3 vertices = 12.
    expect(b.relleno.vertices).toBe(12);
    // Contorno: 2 segmentos de curva × 2 = 4; sin cierres (v=0 en ambos extremos).
    expect(b.contorno.vertices).toBe(4);
  });

  it("la curva aplica escalaTotal sobre ejeY: v=-8, escala 0.1 -> ordenada -0.8 en Z de escena", () => {
    const b = construirBuffersEsfuerzos({
      geometria: geoVano(),
      escalaTotal: 0.1,
      vigente: true,
    })!;
    // Primer triangulo = (b0, c0, c1): el TERCER vertice es c1 = [2,0,3] + [0,0,1]*(-0.8).
    expect(b.relleno.position[6]).toBeCloseTo(2, 5);
    expect(b.relleno.position[7]).toBeCloseTo(0, 5);
    expect(b.relleno.position[8]).toBeCloseTo(3 - 0.8, 5);
  });

  it("dos tramos con corte compartido: cierres solo en extremos de barra (v≠0)", () => {
    const b = construirBuffersEsfuerzos({
      geometria: geoCortante(),
      escalaTotal: 0.1,
      vigente: true,
    })!;
    // Relleno: 2 tramos × 1 segmento × 6 = 12. Contorno: curva 2+2 y cierres 2+2
    // (arranque del tramo + con v=6, final del tramo - con v=-6) = 8.
    expect(b.relleno.vertices).toBe(12);
    expect(b.contorno.vertices).toBe(8);
  });

  it("color por signo: tramo + azul (esfuerzoPos), tramo - rojo (esfuerzoNeg)", () => {
    const b = construirBuffersEsfuerzos({
      geometria: geoCortante(),
      escalaTotal: 0.1,
      vigente: true,
    })!;
    // Primer vertice del relleno pertenece al tramo POSITIVO; el vertice 6 (segundo
    // tramo) al NEGATIVO. Fallbacks de tokens.css: pos #2563eb / neg #dc2626.
    esperaColor(colorEn(b.relleno.color, 0), new Color("#2563eb"));
    esperaColor(colorEn(b.relleno.color, 6), new Color("#dc2626"));
  });

  it("vigente=false: todo gris obsoleto (mismo lenguaje que la deformada)", () => {
    const b = construirBuffersEsfuerzos({
      geometria: geoVano(),
      escalaTotal: 0.1,
      vigente: false,
    })!;
    esperaColor(colorEn(b.relleno.color, 0), new Color("#9aa4b2"));
    esperaColor(colorEn(b.contorno.color, 0), new Color("#9aa4b2"));
  });

  it("sin diagramas o escala invalida -> null (no hay nada que dibujar)", () => {
    expect(
      construirBuffersEsfuerzos({
        geometria: { diagramas: [], vMaxAbs: 0 },
        escalaTotal: 0.1,
        vigente: true,
      }),
    ).toBeNull();
    expect(
      construirBuffersEsfuerzos({ geometria: geoVano(), escalaTotal: 0, vigente: true }),
    ).toBeNull();
    expect(
      construirBuffersEsfuerzos({
        geometria: geoVano(),
        escalaTotal: Number.NaN,
        vigente: true,
      }),
    ).toBeNull();
  });
});
