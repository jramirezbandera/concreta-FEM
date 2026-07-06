// Test del modulo puro de orto (UX-2.3). Node-agnostico.
import { describe, expect, it } from "vitest";

import { aplicarOrto, puntoOrto } from "./orto";

describe("aplicarOrto (UX-2.3)", () => {
  it("bloquea a horizontal cuando el cursor esta casi alineado", () => {
    const p = aplicarOrto(0, 0, 5, 0.3);
    expect(p.y).toBe(0);
    expect(p.x).toBeCloseTo(5, 10); // proyeccion escalar sobre el eje X
    expect(p.cardinal).toBe(true);
  });

  it("bloquea a vertical sin residuo numerico en x (cos 90 != 0 exacto)", () => {
    const p = aplicarOrto(2, 1, 2.2, 6);
    expect(p.x).toBe(2); // limpieza EPS: exactamente la x de I
    expect(p.y).toBeCloseTo(6, 10);
    expect(p.cardinal).toBe(true);
  });

  it("elige la diagonal de 45 cuando el cursor va en diagonal", () => {
    const p = aplicarOrto(0, 0, 3, 2.8);
    expect(p.cardinal).toBe(false);
    expect(p.x).toBeCloseTo(p.y, 10); // sobre la recta y = x
  });

  it("cursor sobre I: devuelve el punto tal cual (sin NaN)", () => {
    const p = aplicarOrto(1, 1, 1, 1);
    expect(p).toEqual({ x: 1, y: 1, cardinal: true });
  });
});

describe("puntoOrto (orto + rejilla)", () => {
  it("en cardinal ajusta a rejilla la coordenada que avanza y conserva la bloqueada", () => {
    // Horizontal desde (0, 0.2): y bloqueada en 0.2 (exacta), x a rejilla de 0.5.
    const p = puntoOrto(0, 0.2, 3.68, 0.35, 0.5);
    expect(p).toEqual({ x: 3.5, y: 0.2 });
  });

  it("en diagonal NO ajusta a rejilla (romperia los 45 grados)", () => {
    const p = puntoOrto(0, 0, 3, 3.1, 0.5);
    expect(p.x).toBeCloseTo(p.y, 10);
    // No multiplo de 0.5: la rejilla no ha intervenido.
    expect(Math.abs(Math.round(p.x / 0.5) * 0.5 - p.x)).toBeGreaterThan(1e-6);
  });

  it("sin paso de rejilla devuelve el punto orto crudo", () => {
    const p = puntoOrto(0, 0, 4.3, 0.1);
    expect(p.y).toBe(0);
    expect(p.x).toBeCloseTo(4.3, 10);
  });
});
