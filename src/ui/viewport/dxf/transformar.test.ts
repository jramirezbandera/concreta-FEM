import { describe, it, expect } from "vitest";
import { transformarEntidad, bboxDePlantilla } from "./transformar";
import type { EntidadDxf, Plantilla } from "./tiposDxf";

// Plantilla minima con una transform dada. Las entidades se inyectan por test.
function plantilla(
  entidades: EntidadDxf[],
  transform: Partial<Plantilla["transform"]> = {},
): Plantilla {
  return {
    id: "pl1",
    nombre: "calco",
    nombreArchivo: "planta.dxf",
    plantaId: "planta-1",
    entidades,
    transform: {
      x: 0,
      y: 0,
      escala: 1,
      rotacion: 0,
      opacidad: 1,
      ...transform,
    },
    visible: true,
    bloqueado: false,
    creadaEn: 0,
  };
}

describe("transformarEntidad", () => {
  it("identidad (escala 1, rotacion 0, sin traslacion) no altera coordenadas", () => {
    const linea: EntidadDxf = { tipo: "linea", x1: 1, y1: 2, x2: 3, y2: 4 };
    expect(transformarEntidad(linea, plantilla([]))).toEqual(linea);
  });

  it("aplica escala -> rotacion(90) -> traslacion en ese orden a una linea", () => {
    // Punto local (1,0): escala 2 -> (2,0); rot 90 -> (0,2); traslacion (10,5) -> (10,7).
    const linea: EntidadDxf = { tipo: "linea", x1: 1, y1: 0, x2: 0, y2: 1 };
    const t = transformarEntidad(
      linea,
      plantilla([], { escala: 2, rotacion: 90, x: 10, y: 5 }),
    ) as Extract<EntidadDxf, { tipo: "linea" }>;
    expect(t.x1).toBeCloseTo(10, 10);
    expect(t.y1).toBeCloseTo(7, 10);
    // Punto local (0,1): escala 2 -> (0,2); rot 90 -> (-2,0); traslacion -> (8,5).
    expect(t.x2).toBeCloseTo(8, 10);
    expect(t.y2).toBeCloseTo(5, 10);
  });

  it("no muta la entidad original", () => {
    const punto: EntidadDxf = { tipo: "punto", x: 1, y: 1 };
    const copia = { ...punto };
    transformarEntidad(punto, plantilla([], { x: 100, escala: 3 }));
    expect(punto).toEqual(copia);
  });

  it("transforma una polilinea conservando el flag cerrada", () => {
    const poli: EntidadDxf = {
      tipo: "polilinea",
      cerrada: true,
      puntos: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    const t = transformarEntidad(
      poli,
      plantilla([], { escala: 2, x: 1, y: 1 }),
    ) as Extract<EntidadDxf, { tipo: "polilinea" }>;
    expect(t.cerrada).toBe(true);
    expect(t.puntos[0]).toEqual({ x: 1, y: 1 });
    expect(t.puntos[1]!.x).toBeCloseTo(3, 10);
    expect(t.puntos[1]!.y).toBeCloseTo(1, 10);
  });

  it("escala el radio del circulo y traslada su centro", () => {
    const c: EntidadDxf = { tipo: "circulo", cx: 1, cy: 0, r: 2 };
    const t = transformarEntidad(
      c,
      plantilla([], { escala: 3, x: 5, y: 5 }),
    ) as Extract<EntidadDxf, { tipo: "circulo" }>;
    expect(t.r).toBeCloseTo(6, 10);
    expect(t.cx).toBeCloseTo(8, 10); // 1*3 + 5
    expect(t.cy).toBeCloseTo(5, 10);
  });

  it("desplaza los angulos del arco por la rotacion (radianes)", () => {
    const a: EntidadDxf = {
      tipo: "arco",
      cx: 0,
      cy: 0,
      r: 1,
      anguloInicio: 0,
      anguloFin: Math.PI / 2,
    };
    const t = transformarEntidad(
      a,
      plantilla([], { rotacion: 90 }),
    ) as Extract<EntidadDxf, { tipo: "arco" }>;
    expect(t.anguloInicio).toBeCloseTo(Math.PI / 2, 10);
    expect(t.anguloFin).toBeCloseTo(Math.PI, 10);
  });
});

describe("bboxDePlantilla", () => {
  it("calcula la bbox de las entidades transformadas (escala 2, rot 90, traslacion)", () => {
    // Linea local (0,0)-(1,0). escala 2 -> (0,0)-(2,0). rot 90 -> (0,0)-(0,2).
    // traslacion (3,1) -> (3,1)-(3,3).
    const pl = plantilla(
      [{ tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 0 }],
      { escala: 2, rotacion: 90, x: 3, y: 1 },
    );
    const bbox = bboxDePlantilla(pl);
    expect(bbox.minX).toBeCloseTo(3, 10);
    expect(bbox.maxX).toBeCloseTo(3, 10);
    expect(bbox.minY).toBeCloseTo(1, 10);
    expect(bbox.maxY).toBeCloseTo(3, 10);
  });

  it("plantilla sin entidades: bbox degenerada centrada en su origen", () => {
    const pl = plantilla([], { x: 7, y: -2 });
    expect(bboxDePlantilla(pl)).toEqual({
      minX: 7,
      minY: -2,
      maxX: 7,
      maxY: -2,
    });
  });

  it("incluye el radio del circulo transformado en la bbox", () => {
    const pl = plantilla(
      [{ tipo: "circulo", cx: 0, cy: 0, r: 1 }],
      { escala: 2, x: 10, y: 10 },
    );
    const bbox = bboxDePlantilla(pl);
    expect(bbox).toEqual({ minX: 8, minY: 8, maxX: 12, maxY: 12 });
  });
});
