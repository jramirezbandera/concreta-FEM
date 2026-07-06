// Tests de `derivar` (proyeccion Modelo Capa 1 -> geometria dibujable), funcion
// PURA exportada desde useGeometriaModelo.ts. No toca WebGL ni React: recibe sus
// argumentos (modelo, plantaActivaId). Corre en el project `jsdom` por su ubicacion
// bajo src/ui (vitest.config.ts excluye src/ui del project node); como `derivar` es
// pura, el entorno es indiferente. Cubre todas las ramas: filtrado por planta (con
// criterio de cota para los pilares), referencias rotas, ladoSeccion y cota del tramo.
//
// F3.4 ("plantas sin grupos"): la firma es derivar(modelo, plantaActivaId) e
// idsEfectivos(modoVista, plantaActivaId) -> string|null. Un pilar es visible en la
// planta activa si su tramo vertical CRUZA la cota de esa planta (zMin <= cota <= zMax).
import { describe, it, expect } from "vitest";
import { derivar, idsEfectivos } from "./useGeometriaModelo";
import { crearModeloVacio } from "../../../dominio";
import type {
  Modelo,
  Planta,
  Nudo,
  Pilar,
  Viga,
  Seccion,
} from "../../../dominio";

// --- Factorias de dominio para los casos de prueba ---------------------------

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

// Edificio de tres plantas (p0 cota 0, p1 cota 3, p2 cota 6), nudos para vigas.
// Base para el filtrado por planta.
function modeloBase(): Modelo {
  return {
    ...crearModeloVacio(),
    plantas: [planta("p0", 0), planta("p1", 3), planta("p2", 6)],
    secciones: [secRect, secCirc, secPerfil],
    nudos: [nudo("n1", 0, 0), nudo("n2", 4, 0)],
  };
}

// --- Sin planta activa: todo el edificio -------------------------------------

describe("derivar: sin planta activa (todo el edificio)", () => {
  it("plantaActivaId === null considera todas las plantas", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("pa", 0, 0, "p0", "p1"), pilar("pb", 0, 0, "p2", "p2")],
      vigas: [viga("va", "p1", "n1", "n2"), viga("vb", "p2", "n1", "n2")],
    };
    const geo = derivar(modelo, null);
    expect(geo.pilares.map((p) => p.id).sort()).toEqual(["pa", "pb"]);
    expect(geo.vigas.map((v) => v.id).sort()).toEqual(["va", "vb"]);
  });
});

// --- Filtrado por planta activa (criterio de cota para pilares) ---------------

describe("derivar: filtrado por planta activa", () => {
  it("solo pilares cuyo tramo CRUZA la cota de la planta activa", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      // p0 cota 0, p1 cota 3, p2 cota 6. Planta activa p1 (cota 3):
      //  - pa (p0->p1, tramo 0..3) cruza cota 3 -> visible.
      //  - pb (p2->p2, tramo 6..6) NO cruza cota 3 -> oculto.
      //  - pc (p1->p2, tramo 3..6) cruza cota 3 (borde) -> visible (pasante).
      pilares: [
        pilar("pa", 0, 0, "p0", "p1"),
        pilar("pb", 0, 0, "p2", "p2"),
        pilar("pc", 0, 0, "p1", "p2"),
      ],
      vigas: [viga("va", "p1", "n1", "n2"), viga("vb", "p2", "n1", "n2")],
    };
    const geo = derivar(modelo, "p1");
    expect(geo.pilares.map((p) => p.id).sort()).toEqual(["pa", "pc"]);
    // Solo la viga de la planta activa (p1).
    expect(geo.vigas.map((v) => v.id)).toEqual(["va"]);
  });

  it("plantaActivaId fijado: solo vigas de esa planta", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      vigas: [
        viga("va", "p0", "n1", "n2"),
        viga("vb", "p1", "n1", "n2"),
        viga("vc", "p2", "n1", "n2"),
      ],
    };
    const geo = derivar(modelo, "p1");
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
    const geo = derivar(modelo, null);
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
    expect(derivar(modelo, null).pilares[0].lado).toBe(0.5);
  });

  it("hormigonCircular -> d", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "circ")],
    };
    expect(derivar(modelo, null).pilares[0].lado).toBe(0.4);
  });

  it("seccion inexistente -> 0.3 (LADO_PILAR_DEFECTO)", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "noexiste")],
    };
    expect(derivar(modelo, null).pilares[0].lado).toBe(0.3);
  });

  it("otro tipo (perfilMetalico) -> 0.3 (LADO_PILAR_DEFECTO)", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p1", "perfil")],
    };
    expect(derivar(modelo, null).pilares[0].lado).toBe(0.3);
  });
});

// --- idsEfectivos: colapso del filtro segun modo de vista (F2c / 3D pleno) ----

describe("idsEfectivos: 3D pleno colapsa el filtro de planta", () => {
  it('modo "planta" respeta la planta activa', () => {
    expect(idsEfectivos("planta", "p1")).toBe("p1");
  });

  it('modo "3d" ignora la planta (todo el edificio)', () => {
    expect(idsEfectivos("3d", "p1")).toBeNull();
  });

  it('modo "mosaico" tambien colapsa (comparte la escena 3D del Viewport)', () => {
    expect(idsEfectivos("mosaico", "p1")).toBeNull();
  });

  it("G1 anti-bucle: en 3D un pick que cambia la planta NO cambia el id efectivo", () => {
    // Pickear en 3D sincroniza el contexto (F1.3), pero el id efectivo sigue siendo
    // null -> los deps del useMemo no cambian -> no se recomputa derivar.
    expect(idsEfectivos("3d", "p1")).toBe(idsEfectivos("3d", "p2"));
  });

  it("en 3D la geometria via id efectivo muestra todo el edificio", () => {
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("pa", 0, 0, "p0", "p1"), pilar("pb", 0, 0, "p2", "p2")],
      vigas: [viga("va", "p1", "n1", "n2"), viga("vb", "p2", "n1", "n2")],
    };
    // Aunque haya planta activa, en 3D el id efectivo es null.
    const p = idsEfectivos("3d", "p1");
    const geo = derivar(modelo, p);
    expect(geo.pilares.map((x) => x.id).sort()).toEqual(["pa", "pb"]);
    expect(geo.vigas.map((x) => x.id).sort()).toEqual(["va", "vb"]);
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
    const d = derivar(modelo, null).pilares[0];
    expect(d.alto).toBe(3);
    expect(d.cz).toBe(1.5);
  });

  it("alto minimo 0.01 y cz = cota cuando plantaInicial === plantaFinal", () => {
    // p0 cota 0 a p0 cota 0 -> alto degenerado clampeado a 0.01, cz = 0.005.
    const modelo: Modelo = {
      ...modeloBase(),
      pilares: [pilar("p", 0, 0, "p0", "p0")],
    };
    const d = derivar(modelo, null).pilares[0];
    expect(d.alto).toBe(0.01);
    expect(d.cz).toBeCloseTo(0.005, 10);
  });
});
