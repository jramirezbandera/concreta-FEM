// Tests de `derivar` (proyeccion Modelo Capa 1 -> geometria dibujable), funcion
// PURA exportada desde useGeometriaModelo.ts. No toca WebGL ni React: recibe sus
// argumentos (modelo, grupoActivoId, plantaActivaId). Corre en el project `jsdom`
// por su ubicacion bajo src/ui (vitest.config.ts excluye src/ui del project node);
// como `derivar` es pura, el entorno es indiferente. Cubre todas las ramas:
// filtrado por grupo/planta, referencias rotas, ladoSeccion y cota del tramo.
import { describe, it, expect } from "vitest";
import { derivar } from "./useGeometriaModelo";
import { crearModeloVacio } from "../../../dominio";
import type {
  Modelo,
  Grupo,
  Planta,
  Nudo,
  Pilar,
  Viga,
  Seccion,
} from "../../../dominio";

// --- Factorias de dominio para los casos de prueba ---------------------------

function grupo(id: string): Grupo {
  return {
    id,
    nombre: id.toUpperCase(),
    categoriaUso: "A",
    sobrecargaUso: 2,
    cargasMuertas: 1,
  };
}

function planta(id: string, grupoId: string, cota: number): Planta {
  return { id, nombre: id.toUpperCase(), cota, altura: 3, grupoId };
}

function nudo(id: string, x: number, y: number): Nudo {
  return { id, x, y };
}

function pilar(
  id: string,
  x: number,
  y: number,
  plantaInicial: string,
  plantaFinal: string,
  seccionId = "sin-seccion",
  angulo = 0,
): Pilar {
  return {
    id,
    nombre: id.toUpperCase(),
    x,
    y,
    plantaInicial,
    plantaFinal,
    seccionId,
    materialId: "m1",
    angulo,
    vinculacionExterior: true,
    arranque: "empotrado",
  };
}

function viga(id: string, plantaId: string, nudoI: string, nudoJ: string): Viga {
  return {
    id,
    nombre: id.toUpperCase(),
    plantaId,
    nudoI,
    nudoJ,
    seccionId: "s1",
    materialId: "m1",
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  };
}

const secRect: Seccion = {
  id: "rect",
  nombre: "R 30x50",
  tipo: "hormigonRectangular",
  b: 0.3,
  h: 0.5,
};
const secCirc: Seccion = {
  id: "circ",
  nombre: "C d40",
  tipo: "hormigonCircular",
  d: 0.4,
};
const secPerfil: Seccion = {
  id: "perfil",
  nombre: "IPE300",
  tipo: "perfilMetalico",
  perfilId: "IPE300",
};

// Modelo de dos grupos (gA: p0 cota 0, p1 cota 3 / gB: p2 cota 6), nudos para
// vigas, un par de pilares y vigas repartidos. Base para el filtrado por grupo.
function modeloBase(): Modelo {
  return {
    ...crearModeloVacio(),
    grupos: [grupo("gA"), grupo("gB")],
    plantas: [
      planta("p0", "gA", 0),
      planta("p1", "gA", 3),
      planta("p2", "gB", 6),
    ],
    secciones: [secRect, secCirc, secPerfil],
    nudos: [nudo("n1", 0, 0), nudo("n2", 4, 0)],
  };
}

// --- Filtrado por grupo activo -----------------------------------------------

describe("derivar: filtrado por grupo activo", () => {
  it("grupoActivoId === null considera todas las plantas (todos los grupos)", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("pa", 0, 0, "p0", "p1"), pilar("pb", 0, 0, "p2", "p2")],
      vigas: [viga("va", "p1", "n1", "n2"), viga("vb", "p2", "n1", "n2")],
    };
    const geo = derivar(modelo, null, null);
    expect(geo.pilares.map((p) => p.id).sort()).toEqual(["pa", "pb"]);
    expect(geo.vigas.map((v) => v.id).sort()).toEqual(["va", "vb"]);
  });

  it("grupoActivoId fijado: solo pilares cuyo tramo toca una planta del grupo", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      // pa toca gA (p0/p1); pb esta en gB (p2); pc cruza grupos (p1 de gA, p2 de gB).
      pilares: [
        pilar("pa", 0, 0, "p0", "p1"),
        pilar("pb", 0, 0, "p2", "p2"),
        pilar("pc", 0, 0, "p1", "p2"),
      ],
      vigas: [viga("va", "p1", "n1", "n2"), viga("vb", "p2", "n1", "n2")],
    };
    const geo = derivar(modelo, "gA", null);
    // pa (toca p0/p1) y pc (toca p1 de gA) entran; pb (solo gB) no.
    expect(geo.pilares.map((p) => p.id).sort()).toEqual(["pa", "pc"]);
    // Sin planta activa: vigas de las plantas del grupo (p1), no la de p2.
    expect(geo.vigas.map((v) => v.id)).toEqual(["va"]);
  });
});

// --- Filtrado por planta activa ----------------------------------------------

describe("derivar: filtrado por planta activa", () => {
  it("plantaActivaId fijado: solo vigas de esa planta", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      vigas: [
        viga("va", "p0", "n1", "n2"),
        viga("vb", "p1", "n1", "n2"),
        viga("vc", "p2", "n1", "n2"),
      ],
    };
    const geo = derivar(modelo, "gA", "p1");
    expect(geo.vigas.map((v) => v.id)).toEqual(["vb"]);
  });
});

// --- Referencias rotas de nudos ----------------------------------------------

describe("derivar: viga con nudo inexistente", () => {
  it("se omite si nudoI o nudoJ no existe", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      vigas: [
        viga("ok", "p1", "n1", "n2"),
        viga("rotaI", "p1", "nX", "n2"),
        viga("rotaJ", "p1", "n1", "nY"),
      ],
    };
    const geo = derivar(modelo, null, null);
    expect(geo.vigas.map((v) => v.id)).toEqual(["ok"]);
  });
});

// --- ladoSeccion -------------------------------------------------------------

describe("derivar: lado de seccion proyectada en planta", () => {
  it("hormigonRectangular -> max(b, h)", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "rect")],
    };
    expect(derivar(modelo, null, null).pilares[0].lado).toBe(0.5);
  });

  it("hormigonCircular -> d", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "circ")],
    };
    expect(derivar(modelo, null, null).pilares[0].lado).toBe(0.4);
  });

  it("seccion inexistente -> 0.3 (LADO_PILAR_DEFECTO)", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "noexiste")],
    };
    expect(derivar(modelo, null, null).pilares[0].lado).toBe(0.3);
  });

  it("otro tipo (perfilMetalico) -> 0.3 (LADO_PILAR_DEFECTO)", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "perfil")],
    };
    expect(derivar(modelo, null, null).pilares[0].lado).toBe(0.3);
  });
});

// --- Cota del centro del tramo de pilar --------------------------------------

describe("derivar: cota del tramo de pilar", () => {
  it("cz = zMin + alto/2 para un tramo entre dos cotas", () => {
    // p0 cota 0, p1 cota 3 -> alto 3, cz = 1.5.
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1")],
    };
    const d = derivar(modelo, null, null).pilares[0];
    expect(d.alto).toBe(3);
    expect(d.cz).toBe(1.5);
  });

  it("alto minimo 0.01 y cz = cota cuando plantaInicial === plantaFinal", () => {
    // p0 cota 0 a p0 cota 0 -> alto degenerado clampeado a 0.01, cz = 0.005.
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p0")],
    };
    const d = derivar(modelo, null, null).pilares[0];
    expect(d.alto).toBe(0.01);
    expect(d.cz).toBeCloseTo(0.005, 10);
  });
});
