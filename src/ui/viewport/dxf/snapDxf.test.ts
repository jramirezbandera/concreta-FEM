// Tests del helper PURO de snap a entidades DXF (feature-15, T3.3): extraccion de
// puntos notables por entidad, agregacion sobre plantillas (filtro visible+planta +
// transform) y enganche al mas cercano dentro de radio. Sin DOM/three: corre en el
// project `jsdom` por vivir bajo src/ui, pero no necesita render.
import { describe, it, expect } from "vitest";
import {
  puntosNotablesDeEntidad,
  puntosSnapDePlantillas,
  engancharAPuntoExtra,
} from "./snapDxf";
import type { EntidadDxf, Plantilla } from "./tiposDxf";

// Plantilla minima (transform identidad por defecto). Espejo del helper de
// transformar.test.ts: las entidades se inyectan por test.
function plantilla(
  entidades: EntidadDxf[],
  patch: Partial<Plantilla> = {},
): Plantilla {
  return {
    id: "pl1",
    nombre: "calco",
    nombreArchivo: "planta.dxf",
    plantaId: "p0",
    entidades,
    transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 1 },
    visible: true,
    bloqueado: false,
    creadaEn: 0,
    ...patch,
  };
}

describe("puntosNotablesDeEntidad", () => {
  it("linea: sus dos extremos", () => {
    const e: EntidadDxf = { tipo: "linea", x1: 1, y1: 2, x2: 3, y2: 4 };
    expect(puntosNotablesDeEntidad(e)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it("polilinea abierta: todos sus vertices, sin repetir el cierre", () => {
    const e: EntidadDxf = {
      tipo: "polilinea",
      cerrada: false,
      puntos: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    expect(puntosNotablesDeEntidad(e)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("polilinea cerrada: los mismos vertices (el primero NO se duplica)", () => {
    // El cierre es geometrico (render), no anade un punto notable nuevo: el primer
    // vertice ya esta en la lista.
    const e: EntidadDxf = {
      tipo: "polilinea",
      cerrada: true,
      puntos: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ],
    };
    expect(puntosNotablesDeEntidad(e)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it("punto: el propio punto", () => {
    const e: EntidadDxf = { tipo: "punto", x: 5, y: -3 };
    expect(puntosNotablesDeEntidad(e)).toEqual([{ x: 5, y: -3 }]);
  });

  it("circulo: centro + 4 cuadrantes", () => {
    const e: EntidadDxf = { tipo: "circulo", cx: 0, cy: 0, r: 2 };
    expect(puntosNotablesDeEntidad(e)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: -2, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
    ]);
  });

  it("arco: centro + los dos extremos del barrido", () => {
    const e: EntidadDxf = {
      tipo: "arco",
      cx: 0,
      cy: 0,
      r: 1,
      anguloInicio: 0,
      anguloFin: Math.PI / 2,
    };
    const pts = puntosNotablesDeEntidad(e);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1]!.x).toBeCloseTo(1, 10);
    expect(pts[1]!.y).toBeCloseTo(0, 10);
    expect(pts[2]!.x).toBeCloseTo(0, 10);
    expect(pts[2]!.y).toBeCloseTo(1, 10);
  });

  it("no devuelve referencias internas de la polilinea (copia defensiva)", () => {
    const e: EntidadDxf = {
      tipo: "polilinea",
      cerrada: false,
      puntos: [{ x: 1, y: 1 }],
    };
    const out = puntosNotablesDeEntidad(e);
    expect(out[0]).not.toBe((e as { puntos: unknown[] }).puntos[0]);
  });
});

describe("puntosSnapDePlantillas", () => {
  it("aplica la transform de la plantilla a los puntos notables", () => {
    // Linea local (1,0)-(0,0). Con traslacion (10,5) -> (11,5)-(10,5).
    const pl = plantilla([{ tipo: "linea", x1: 1, y1: 0, x2: 0, y2: 0 }], {
      transform: { x: 10, y: 5, escala: 1, rotacion: 0, opacidad: 1 },
    });
    expect(puntosSnapDePlantillas([pl], "p0")).toEqual([
      { x: 11, y: 5 },
      { x: 10, y: 5 },
    ]);
  });

  it("ignora plantillas no visibles", () => {
    const pl = plantilla([{ tipo: "punto", x: 1, y: 1 }], { visible: false });
    expect(puntosSnapDePlantillas([pl], "p0")).toEqual([]);
  });

  it("ignora plantillas de otra planta", () => {
    const pl = plantilla([{ tipo: "punto", x: 1, y: 1 }], { plantaId: "p9" });
    expect(puntosSnapDePlantillas([pl], "p0")).toEqual([]);
  });

  it("plantaActivaId null: sin candidatos", () => {
    const pl = plantilla([{ tipo: "punto", x: 1, y: 1 }]);
    expect(puntosSnapDePlantillas([pl], null)).toEqual([]);
  });

  it("agrega los puntos de varias plantillas visibles de la planta", () => {
    const a = plantilla([{ tipo: "punto", x: 1, y: 1 }], { id: "a" });
    const b = plantilla([{ tipo: "punto", x: 2, y: 2 }], { id: "b" });
    expect(puntosSnapDePlantillas([a, b], "p0")).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });
});

describe("engancharAPuntoExtra", () => {
  const pts = [
    { x: 5, y: 5 },
    { x: 8, y: 5 },
  ];

  it("engancha al mas cercano dentro del radio", () => {
    expect(engancharAPuntoExtra(5.1, 5.05, pts, 0.6)).toEqual({ x: 5, y: 5 });
  });

  it("devuelve null si no hay ninguno en radio", () => {
    expect(engancharAPuntoExtra(6, 6, pts, 0.6)).toBeNull();
  });

  it("lista vacia: null", () => {
    expect(engancharAPuntoExtra(0, 0, [], 0.6)).toBeNull();
  });

  it("elige el mas cercano cuando hay varios en radio", () => {
    const cercanos = [
      { x: 5.5, y: 5 },
      { x: 5.1, y: 5 },
    ];
    expect(engancharAPuntoExtra(5, 5, cercanos, 0.6)).toEqual({ x: 5.1, y: 5 });
  });
});
