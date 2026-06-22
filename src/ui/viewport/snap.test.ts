import { describe, it, expect } from "vitest";
import { snapARejilla } from "./snap";

describe("snapARejilla", () => {
  it("redondea al multiplo de paso mas cercano (paso 0.5 por defecto)", () => {
    expect(snapARejilla(0.24, 0.26)).toEqual({ x: 0, y: 0.5 });
    expect(snapARejilla(1.3, 1.7)).toEqual({ x: 1.5, y: 1.5 });
    // Math.round redondea el punto medio hacia +Inf: -2.75/0.5 = -5.5 -> -5 -> -2.5.
    expect(snapARejilla(2.75, -2.75)).toEqual({ x: 3, y: -2.5 });
  });

  it("deja intactos los valores ya alineados a la rejilla", () => {
    expect(snapARejilla(0, 0)).toEqual({ x: 0, y: 0 });
    expect(snapARejilla(2.5, -1.5)).toEqual({ x: 2.5, y: -1.5 });
  });

  it("admite un paso distinto", () => {
    expect(snapARejilla(1.2, 3.4, 1)).toEqual({ x: 1, y: 3 });
    expect(snapARejilla(0.13, 0.27, 0.25)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("redondea hacia arriba en el punto medio (Math.round)", () => {
    // 0.25 / 0.5 = 0.5 -> Math.round redondea a 1 -> 0.5
    expect(snapARejilla(0.25, 0.75)).toEqual({ x: 0.5, y: 1 });
  });

  it("con paso<=0 devuelve las coordenadas sin tocar (snap inerte)", () => {
    expect(snapARejilla(1.234, 5.678, 0)).toEqual({ x: 1.234, y: 5.678 });
    expect(snapARejilla(1.234, 5.678, -0.5)).toEqual({ x: 1.234, y: 5.678 });
  });

  it("maneja coordenadas negativas simetricamente", () => {
    expect(snapARejilla(-0.24, -0.26)).toEqual({ x: -0, y: -0.5 });
  });

  it("no propaga NaN a partir de entradas finitas", () => {
    const r = snapARejilla(3.333333, 6.666666);
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
  });
});
