// Tests de los helpers puros de dibujo de cargas (cargasDibujo.ts, D7b). Node puro: solo
// geometria (arrays de vertices) y posicion de etiqueta. No verifican el aspecto (eso es del
// componente) sino los invariantes: nº de flechas acotado, vertices multiplo de 3, hatch
// dentro del bbox, etiqueta en el centro.
import { describe, it, expect } from "vitest";
import {
  numeroFlechas,
  flechasCargaLineal,
  hatchCargaSuperficial,
  centroContorno,
} from "./cargasDibujo";

describe("numeroFlechas · acotado", () => {
  it("al menos 2 aunque el tramo sea diminuto", () => {
    expect(numeroFlechas(0.01)).toBe(2);
  });
  it("crece ~1 cada 0.8 m", () => {
    expect(numeroFlechas(4)).toBe(5); // round(4/0.8)=5
  });
  it("tope superior (no satura tramos enormes)", () => {
    expect(numeroFlechas(1000)).toBe(24);
  });
});

describe("flechasCargaLineal (D7b)", () => {
  it("vertices en tripletas (x,y,z), etiqueta en el centro desplazada por la normal", () => {
    const f = flechasCargaLineal(0, 0, 4, 0, 3);
    expect(f.vertices.length % 3).toBe(0);
    // Cada flecha son 3 segmentos (astil + 2 barbas) = 6 vertices = 18 numeros.
    const n = numeroFlechas(4);
    expect(f.vertices.length).toBe(n * 18);
    // Etiqueta: centro del tramo (2,0) desplazado ASTIL(0.35) en la normal (+Y para dir +X).
    expect(f.etiqueta.x).toBeCloseTo(2, 5);
    expect(f.etiqueta.y).toBeCloseTo(0.35, 5);
    expect(f.etiqueta.z).toBe(3);
  });

  it("todos los vertices estan a la cota z dada", () => {
    const f = flechasCargaLineal(1, 1, 1, 5, 2);
    for (let i = 2; i < f.vertices.length; i += 3) {
      expect(f.vertices[i]).toBe(2);
    }
  });
});

describe("centroContorno", () => {
  it("media de vertices (centro de un rectangulo)", () => {
    const c = centroContorno([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(c).toEqual({ x: 2, y: 1 });
  });
  it("contorno vacio -> origen (defensivo)", () => {
    expect(centroContorno([])).toEqual({ x: 0, y: 0 });
  });
});

describe("hatchCargaSuperficial (D7b)", () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 0, y: 2 },
  ];

  it("produce lineas (vertices en tripletas, pares por linea) a la cota z", () => {
    const h = hatchCargaSuperficial(rect, 3);
    expect(h.vertices.length % 3).toBe(0);
    // Al menos una linea de hatch en un rectangulo 4x2.
    expect(h.vertices.length).toBeGreaterThan(0);
    for (let i = 2; i < h.vertices.length; i += 3) {
      expect(h.vertices[i]).toBe(3);
    }
  });

  it("las lineas del hatch caen dentro del bounding box [0,4]x[0,2]", () => {
    const h = hatchCargaSuperficial(rect, 0);
    for (let i = 0; i < h.vertices.length; i += 3) {
      const x = h.vertices[i]!;
      const y = h.vertices[i + 1]!;
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(4 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  it("la pendiente de cada linea es +1 (45°): dy == dx entre los dos extremos", () => {
    const h = hatchCargaSuperficial(rect, 0);
    for (let i = 0; i < h.vertices.length; i += 6) {
      const x0 = h.vertices[i]!;
      const y0 = h.vertices[i + 1]!;
      const x1 = h.vertices[i + 3]!;
      const y1 = h.vertices[i + 4]!;
      expect(y1 - y0).toBeCloseTo(x1 - x0, 5);
    }
  });

  it("contorno degenerado (sin area) -> sin lineas, etiqueta en el centro", () => {
    const h = hatchCargaSuperficial(
      [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      0,
    );
    expect(h.vertices.length).toBe(0);
    expect(h.etiqueta.x).toBe(1);
    expect(h.etiqueta.y).toBe(1);
  });
});
