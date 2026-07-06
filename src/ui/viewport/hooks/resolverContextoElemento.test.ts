// Tests de resolverContextoElemento (PURA): dado el id de un pilar/viga, devuelve el
// contexto activo {plantaActivaId} o null. Sin grupos (F3.4). Factorias de dominio
// espejo de useGeometriaModelo.test.ts.
import { describe, it, expect } from "vitest";
import { resolverContextoElemento } from "./resolverContextoElemento";
import { crearModeloVacio } from "../../../dominio";
import type { Modelo, Planta, Nudo, Pilar, Viga } from "../../../dominio";

function planta(id: string, cota: number): Planta {
  return {
    id,
    nombre: id.toUpperCase(),
    cota,
    altura: 3,
    categoriaUso: "A",
    sobrecargaUso: 0,
    cargasMuertas: 0,
  };
}
function nudo(id: string, x: number, y: number): Nudo {
  return { id, x, y };
}
function pilar(id: string, plantaInicial: string, plantaFinal: string): Pilar {
  return {
    id,
    nombre: id.toUpperCase(),
    x: 0,
    y: 0,
    plantaInicial,
    plantaFinal,
    seccionId: "s1",
    materialId: "m1",
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  };
}
function viga(id: string, plantaId: string): Viga {
  return {
    id,
    nombre: id.toUpperCase(),
    plantaId,
    nudoI: "n1",
    nudoJ: "n2",
    seccionId: "s1",
    materialId: "m1",
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  };
}

// Edificio de tres plantas: p0 cota 0, p1 cota 3, p2 cota 6.
function modeloBase(): Modelo {
  return {
    ...crearModeloVacio(),
    plantas: [planta("p0", 0), planta("p1", 3), planta("p2", 6)],
    nudos: [nudo("n1", 0, 0), nudo("n2", 4, 0)],
  };
}

describe("resolverContextoElemento: pilar", () => {
  it("usa la planta del PIE (cota menor)", () => {
    const modelo: Modelo = { ...modeloBase(), pilares: [pilar("pa", "p0", "p1")] };
    expect(resolverContextoElemento(modelo, "pa")).toEqual({
      plantaActivaId: "p0",
    });
  });

  it("el pie es por cota, independiente del orden inicial/final", () => {
    // plantaInicial p1 (cota 3), plantaFinal p0 (cota 0) -> pie = p0.
    const modelo: Modelo = { ...modeloBase(), pilares: [pilar("pa", "p1", "p0")] };
    expect(resolverContextoElemento(modelo, "pa")?.plantaActivaId).toBe("p0");
  });

  it("pilar pasante -> contexto del pie (planta de menor cota)", () => {
    // p1 (cota 3) -> p2 (cota 6): pie = p1.
    const modelo: Modelo = { ...modeloBase(), pilares: [pilar("pc", "p1", "p2")] };
    expect(resolverContextoElemento(modelo, "pc")).toEqual({
      plantaActivaId: "p1",
    });
  });

  it("ambos extremos huerfanos -> null", () => {
    const modelo: Modelo = { ...modeloBase(), pilares: [pilar("px", "noA", "noB")] };
    expect(resolverContextoElemento(modelo, "px")).toBeNull();
  });

  it("un extremo huerfano -> usa el que existe", () => {
    const modelo: Modelo = { ...modeloBase(), pilares: [pilar("py", "noA", "p1")] };
    expect(resolverContextoElemento(modelo, "py")).toEqual({
      plantaActivaId: "p1",
    });
  });
});

describe("resolverContextoElemento: viga", () => {
  it("devuelve la planta de la viga", () => {
    const modelo: Modelo = { ...modeloBase(), vigas: [viga("vb", "p2")] };
    expect(resolverContextoElemento(modelo, "vb")).toEqual({
      plantaActivaId: "p2",
    });
  });

  it("viga con planta inexistente -> null", () => {
    const modelo: Modelo = { ...modeloBase(), vigas: [viga("vx", "noexiste")] };
    expect(resolverContextoElemento(modelo, "vx")).toBeNull();
  });
});

describe("resolverContextoElemento: bordes", () => {
  it("id inexistente -> null", () => {
    expect(resolverContextoElemento(modeloBase(), "nada")).toBeNull();
  });
});
