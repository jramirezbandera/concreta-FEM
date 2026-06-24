import { describe, it, expect } from "vitest";
import {
  EntidadDxfSchema,
  PlantillaSchema,
  type Plantilla,
} from "./tiposDxf";

const plantillaValida: Plantilla = {
  id: "pl1",
  nombre: "calco",
  nombreArchivo: "planta.dxf",
  plantaId: "planta-1",
  entidades: [{ tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 1 }],
  transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 1 },
  visible: true,
  bloqueado: false,
  creadaEn: 0,
};

describe("EntidadDxfSchema (union discriminada)", () => {
  it("acepta cada variante soportada", () => {
    const casos = [
      { tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 1 },
      { tipo: "polilinea", puntos: [{ x: 0, y: 0 }], cerrada: false },
      { tipo: "punto", x: 1, y: 2 },
      { tipo: "circulo", cx: 0, cy: 0, r: 5 },
      { tipo: "arco", cx: 0, cy: 0, r: 1, anguloInicio: 0, anguloFin: 1 },
    ];
    for (const c of casos) {
      expect(EntidadDxfSchema.safeParse(c).success).toBe(true);
    }
  });

  it("rechaza un tipo desconocido", () => {
    const r = EntidadDxfSchema.safeParse({ tipo: "spline", x: 0 });
    expect(r.success).toBe(false);
  });
});

describe("PlantillaSchema", () => {
  it("valida una plantilla bien formada", () => {
    expect(PlantillaSchema.safeParse(plantillaValida).success).toBe(true);
  });

  it("rechaza escala <= 0", () => {
    const mala = {
      ...plantillaValida,
      transform: { ...plantillaValida.transform, escala: 0 },
    };
    expect(PlantillaSchema.safeParse(mala).success).toBe(false);
  });

  it("rechaza opacidad fuera de 0..1", () => {
    const mala = {
      ...plantillaValida,
      transform: { ...plantillaValida.transform, opacidad: 1.5 },
    };
    expect(PlantillaSchema.safeParse(mala).success).toBe(false);
  });

  it("rechaza id/nombre vacios", () => {
    expect(
      PlantillaSchema.safeParse({ ...plantillaValida, id: "" }).success,
    ).toBe(false);
    expect(
      PlantillaSchema.safeParse({ ...plantillaValida, nombre: "" }).success,
    ).toBe(false);
  });
});
