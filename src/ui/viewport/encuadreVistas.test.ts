// Test del encuadre puro de alzados (UX-1.5). Node-agnostico: sin React/three.
import { describe, expect, it } from "vitest";

import type { BoundsEdificio } from "./boundsEdificio";
import { encuadreAlzado } from "./encuadreVistas";

// Edificio de 10 m (X) x 6 m (Y) x 9 m (Z) centrado en (5, 3, 4.5).
const BOUNDS: BoundsEdificio = {
  min: [0, 0, 0],
  max: [10, 6, 9],
  centro: [5, 3, 4.5],
  radio: Math.hypot(10, 6, 9) / 2,
};

const VIEWPORT = { w: 1000, h: 800 };

describe("encuadreAlzado (UX-1.5)", () => {
  it("frontal: camara desde -Y mirando al centro, zoom por el eje restrictivo", () => {
    const e = encuadreAlzado(BOUNDS, "frontal", VIEWPORT);
    expect(e.target).toEqual([5, 3, 4.5]);
    // Desde -Y: misma x/z que el centro, y por detras.
    expect(e.position[0]).toBe(5);
    expect(e.position[1]).toBeLessThan(3);
    expect(e.position[2]).toBe(4.5);
    // Frontal proyecta X=10 y Z=9: con margen 1.15, el eje restrictivo es el alto
    // (800 / (9*1.15) = 77.3 < 1000 / (10*1.15) = 87.0).
    expect(e.zoom).toBeCloseTo(800 / (9 * 1.15), 5);
  });

  it("lateral: camara desde +X, proyecta la extension Y", () => {
    const e = encuadreAlzado(BOUNDS, "lateral", VIEWPORT);
    expect(e.target).toEqual([5, 3, 4.5]);
    expect(e.position[0]).toBeGreaterThan(5);
    expect(e.position[1]).toBe(3);
    expect(e.position[2]).toBe(4.5);
    // Lateral proyecta Y=6 y Z=9: el alto sigue siendo el restrictivo.
    expect(e.zoom).toBeCloseTo(800 / (9 * 1.15), 5);
  });

  it("modelo PLANO (todo a cota 0): el suelo de extension evita zoom Infinity", () => {
    const plano: BoundsEdificio = {
      min: [0, 0, 0],
      max: [10, 6, 0],
      centro: [5, 3, 0],
      radio: Math.hypot(10, 6, 0) / 2,
    };
    const e = encuadreAlzado(plano, "frontal", VIEWPORT);
    expect(Number.isFinite(e.zoom)).toBe(true);
    expect(e.zoom).toBeGreaterThan(0);
  });
});
