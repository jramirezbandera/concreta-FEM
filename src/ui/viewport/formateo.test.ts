// Tests de los formateadores puros de rotulo del lienzo (formateo.ts): cota viva (D8a) y
// etiquetas de carga (D7b). Node puro (sin escena): son funciones de string.
import { describe, it, expect } from "vitest";
import {
  formatearLongitud,
  formatearAngulo,
  anguloXY,
  cotaBanda,
  cotaRectangulo,
  etiquetaCargaLineal,
  etiquetaCargaSuperficial,
} from "./formateo";

describe("formatearLongitud", () => {
  it("2 decimales fijos con sufijo m", () => {
    expect(formatearLongitud(5)).toBe("5.00 m");
    expect(formatearLongitud(3.14159)).toBe("3.14 m");
    expect(formatearLongitud(0)).toBe("0.00 m");
  });
});

describe("formatearAngulo · rango [0,360)", () => {
  it("normaliza el eje X+ a 0.0°", () => {
    expect(formatearAngulo(0)).toBe("0.0°");
  });
  it("angulos negativos (atan2) se llevan a [0,360)", () => {
    expect(formatearAngulo(-90)).toBe("270.0°");
    expect(formatearAngulo(-180)).toBe("180.0°");
  });
  it("360 vuelve a 0", () => {
    expect(formatearAngulo(360)).toBe("0.0°");
    expect(formatearAngulo(450)).toBe("90.0°");
  });
  it("1 decimal", () => {
    expect(formatearAngulo(45)).toBe("45.0°");
  });
});

describe("anguloXY · direccion del vector en [0,360)", () => {
  it("eje X+ = 0, eje Y+ = 90, eje X- = 180, eje Y- = 270", () => {
    expect(anguloXY(1, 0)).toBeCloseTo(0);
    expect(anguloXY(0, 1)).toBeCloseTo(90);
    expect(anguloXY(-1, 0)).toBeCloseTo(180);
    expect(anguloXY(0, -1)).toBeCloseTo(270);
  });
});

describe("cotaBanda · longitud · angulo (D8a viga)", () => {
  it("tramo horizontal de 5 m hacia X+ -> '5.00 m · 0.0°'", () => {
    expect(cotaBanda(5, 0)).toBe("5.00 m · 0.0°");
  });
  it("tramo a 45° de longitud sqrt(2)", () => {
    expect(cotaBanda(1, 1)).toBe("1.41 m · 45.0°");
  });
  it("tramo hacia Y- (abajo) -> 270°", () => {
    expect(cotaBanda(0, -3)).toBe("3.00 m · 270.0°");
  });
});

describe("cotaRectangulo · ancho × alto (D8a paño)", () => {
  it("usa el valor absoluto (el sentido del arrastre da igual)", () => {
    expect(cotaRectangulo(3, 2)).toBe("3.00 × 2.00 m");
    expect(cotaRectangulo(-3, -2)).toBe("3.00 × 2.00 m");
  });
});

describe("etiquetas de carga (D7b)", () => {
  it("lineal sin ceros colgando + kN/m", () => {
    expect(etiquetaCargaLineal(10)).toBe("10 kN/m");
    expect(etiquetaCargaLineal(10.5)).toBe("10.5 kN/m");
  });
  it("superficial + kN/m²", () => {
    expect(etiquetaCargaSuperficial(5)).toBe("5 kN/m²");
  });
  it("prefijo Σ cuando varias cargas se suman", () => {
    expect(etiquetaCargaLineal(15, true)).toBe("Σ 15 kN/m");
    expect(etiquetaCargaSuperficial(7, true)).toBe("Σ 7 kN/m²");
  });
});
