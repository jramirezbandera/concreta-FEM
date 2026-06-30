// Tests de colocacionPanoLogica (F3): la logica PURA del flujo de dos clics para colocar
// una losa rectangular. Sin React ni three.js. Cubre: primer clic guarda A, segundo clic
// crea el rectangulo CCW, segundo clic degenerado (sin area) se ignora.
import { describe, it, expect } from "vitest";
import {
  procesarClicPano,
  rectanguloDesde,
  LADO_MIN_PANO,
} from "./colocacionPanoLogica";

describe("rectanguloDesde", () => {
  it("dos esquinas opuestas -> 4 nudos CCW empezando por (xMin,yMin)", () => {
    const r = rectanguloDesde({ x: 3, y: 5 }, { x: 0, y: 1 });
    expect(r).not.toBeNull();
    // CCW: i(0,1) j(3,1) m(3,5) n(0,5).
    expect(r).toEqual([
      { x: 0, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 5 },
      { x: 0, y: 5 },
    ]);
  });

  it("normaliza el orden de los clics (esquina opuesta en cualquier cuadrante)", () => {
    // Clic A arriba-derecha, B abajo-izquierda: mismo rectangulo que el caso anterior.
    const r = rectanguloDesde({ x: 0, y: 5 }, { x: 3, y: 1 });
    expect(r).toEqual([
      { x: 0, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 5 },
      { x: 0, y: 5 },
    ]);
  });

  it("rectangulo degenerado (ancho < LADO_MIN) -> null", () => {
    expect(rectanguloDesde({ x: 0, y: 0 }, { x: LADO_MIN_PANO / 2, y: 2 })).toBeNull();
  });

  it("rectangulo degenerado (alto < LADO_MIN) -> null", () => {
    expect(rectanguloDesde({ x: 0, y: 0 }, { x: 2, y: LADO_MIN_PANO / 2 })).toBeNull();
  });
});

describe("procesarClicPano", () => {
  it("primer clic (sin A pendiente) -> guardarA", () => {
    const accion = procesarClicPano(null, { x: 2, y: 3 });
    expect(accion).toEqual({ tipo: "guardarA", a: { x: 2, y: 3 } });
  });

  it("segundo clic con area -> crear con perimetro CCW", () => {
    const accion = procesarClicPano({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(accion.tipo).toBe("crear");
    if (accion.tipo === "crear") {
      expect(accion.perimetro).toEqual([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ]);
    }
  });

  it("segundo clic sin area (esquinas casi coincidentes) -> ignorar", () => {
    const accion = procesarClicPano({ x: 1, y: 1 }, { x: 1, y: 1 });
    expect(accion.tipo).toBe("ignorar");
  });
});
