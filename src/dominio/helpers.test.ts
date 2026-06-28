import { describe, it, expect } from "vitest";
import {
  grupoPorId,
  plantaPorId,
  plantasDeGrupo,
  nudoPorId,
  seccionPorId,
  pilaresDePlanta,
  vigasDePlanta,
  cargasDeHipotesis,
  cargasDeAmbito,
  crearModeloVacio,
  esHipotesisAutomatica,
  hipotesisAutomatica,
  ID_HIP_PESO_PROPIO,
} from "./helpers";
import type { Hipotesis } from "./carga";
import { ModeloSchema, type Modelo } from "./modelo";
import { SCHEMA_VERSION } from "./comunes";

function modeloPequeno(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      { id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
      { id: "g2", nombre: "G2", categoriaUso: "B", sobrecargaUso: 3, cargasMuertas: 1 },
    ],
    plantas: [
      { id: "p0", nombre: "Cim", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "P1", cota: 3, altura: 3, grupoId: "g1" },
      { id: "p2", nombre: "P2", cota: 6, altura: 3, grupoId: "g2" },
    ],
    secciones: [
      { id: "s1", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" },
      { id: "s2", nombre: "30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
      { id: "n3", x: 0, y: 4 },
      { id: "n4", x: 5, y: 4 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: "s1", materialId: "m1", angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil2", nombre: "P2", x: 5, y: 0,
        plantaInicial: "p1", plantaFinal: "p2",
        seccionId: "s1", materialId: "m1", angulo: 0,
        vinculacionExterior: false, arranque: "articulado",
      },
    ],
    vigas: [
      {
        id: "v1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: "s1", materialId: "m1",
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
      {
        id: "v2", nombre: "V2", plantaId: "p2", nudoI: "n3", nudoJ: "n4",
        seccionId: "s1", materialId: "m1",
        extremoI: "articulado", extremoJ: "articulado", tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas: [
      { id: "c1", tipo: "lineal", ambito: "v1", valor: -10, hipotesisId: "h1" },
      { id: "c2", tipo: "lineal", ambito: "v2", valor: -5, hipotesisId: "h1" },
      { id: "c3", tipo: "puntual", ambito: "v1", valor: -8, hipotesisId: "h2" },
    ],
    hipotesis: [
      { id: "h1", nombre: "PP", tipo: "permanente", automatica: false },
      { id: "h2", nombre: "SC", tipo: "variable", automatica: false },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

describe("helpers de consulta del dominio", () => {
  const m = modeloPequeno();

  it("crearModeloVacio devuelve un Modelo valido", () => {
    expect(ModeloSchema.safeParse(crearModeloVacio()).success).toBe(true);
  });

  it("crearModeloVacio siembra las 2 basicas de F1 + la automatica de peso propio (al final)", () => {
    const vacio = crearModeloVacio();
    expect(vacio.hipotesis).toEqual([
      { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
      { id: "hip-sobrecarga-uso", nombre: "Sobrecarga de uso", tipo: "variable", automatica: false },
      { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
    ]);
    // El resto del modelo vacio sigue sin elementos de obra.
    expect(vacio.cargas).toEqual([]);
    expect(vacio.pilares).toEqual([]);
    expect(vacio.vigas).toEqual([]);
  });

  it("crearModeloVacio: la hipotesis automatica existe y es la unica con automatica:true", () => {
    const autos = crearModeloVacio().hipotesis.filter((h) => h.automatica);
    expect(autos.map((h) => h.id)).toEqual(["hip-peso-propio"]);
  });

  it("crearModeloVacio: peso propio activado por defecto (incluirPesoPropio:true)", () => {
    expect(crearModeloVacio().analisis.incluirPesoPropio).toBe(true);
  });

  it("crearModeloVacio: schemaVersion = SCHEMA_VERSION (v2)", () => {
    expect(crearModeloVacio().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("grupoPorId", () => {
    expect(grupoPorId(m, "g1")?.nombre).toBe("G1");
    expect(grupoPorId(m, "nope")).toBeUndefined();
  });

  it("plantaPorId", () => {
    expect(plantaPorId(m, "p2")?.grupoId).toBe("g2");
    expect(plantaPorId(m, "nope")).toBeUndefined();
  });

  it("plantasDeGrupo", () => {
    expect(plantasDeGrupo(m, "g1").map((p) => p.id)).toEqual(["p0", "p1"]);
    expect(plantasDeGrupo(m, "g2").map((p) => p.id)).toEqual(["p2"]);
    expect(plantasDeGrupo(m, "nope")).toEqual([]);
  });

  it("nudoPorId", () => {
    expect(nudoPorId(m, "n2")).toEqual({ id: "n2", x: 5, y: 0 });
    expect(nudoPorId(m, "nope")).toBeUndefined();
  });

  it("seccionPorId", () => {
    expect(seccionPorId(m, "s1")?.tipo).toBe("perfilMetalico");
    expect(seccionPorId(m, "s2")?.nombre).toBe("30x50");
    expect(seccionPorId(m, "nope")).toBeUndefined();
  });

  it("pilaresDePlanta (criterio de extremos: arranque o cabeza)", () => {
    expect(pilaresDePlanta(m, "p0").map((p) => p.id)).toEqual(["pil1"]);
    // pil1 (p0..p1) y pil2 (p1..p2) comparten la planta p1.
    expect(pilaresDePlanta(m, "p1").map((p) => p.id)).toEqual(["pil1", "pil2"]);
    expect(pilaresDePlanta(m, "p2").map((p) => p.id)).toEqual(["pil2"]);
  });

  it("vigasDePlanta", () => {
    expect(vigasDePlanta(m, "p1").map((v) => v.id)).toEqual(["v1"]);
    expect(vigasDePlanta(m, "p2").map((v) => v.id)).toEqual(["v2"]);
    expect(vigasDePlanta(m, "p0")).toEqual([]);
  });

  it("cargasDeHipotesis", () => {
    expect(cargasDeHipotesis(m, "h1").map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(cargasDeHipotesis(m, "h2").map((c) => c.id)).toEqual(["c3"]);
    expect(cargasDeHipotesis(m, "nope")).toEqual([]);
  });

  it("cargasDeAmbito", () => {
    // v1 arrastra c1 (lineal) y c3 (puntual); v2 solo c2.
    expect(cargasDeAmbito(m, "v1").map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(cargasDeAmbito(m, "v2").map((c) => c.id)).toEqual(["c2"]);
    expect(cargasDeAmbito(m, "nope")).toEqual([]);
  });
});

// FIX #3: predicado UNICO de "hipotesis automatica" (el FLAG es la fuente de verdad,
// NO el id). Asi id y flag no pueden desincronizarse en el resto del sistema.
describe("esHipotesisAutomatica / hipotesisAutomatica (FIX #3)", () => {
  const auto: Hipotesis = { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true };
  const usuario: Hipotesis = { id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false };

  it("esHipotesisAutomatica: true solo con el FLAG, no por el id canonico", () => {
    expect(esHipotesisAutomatica(auto)).toBe(true);
    expect(esHipotesisAutomatica(usuario)).toBe(false);
  });

  it("el id NO determina la automaticidad: automatica:true en id no canonico => true", () => {
    const autoIdRaro: Hipotesis = { id: "otra-id", nombre: "PP", tipo: "permanente", automatica: true };
    expect(esHipotesisAutomatica(autoIdRaro)).toBe(true);
  });

  it("automatica:false con el id canonico => false (el flag manda, no el id)", () => {
    const falsoAuto: Hipotesis = { id: ID_HIP_PESO_PROPIO, nombre: "PP", tipo: "permanente", automatica: false };
    expect(esHipotesisAutomatica(falsoAuto)).toBe(false);
  });

  it("hipotesisAutomatica: encuentra la del modelo por el flag", () => {
    const vacio = crearModeloVacio();
    const found = hipotesisAutomatica(vacio);
    expect(found?.id).toBe(ID_HIP_PESO_PROPIO);
    expect(found?.automatica).toBe(true);
  });

  it("hipotesisAutomatica: undefined si ninguna hipotesis es automatica", () => {
    const vacio = crearModeloVacio();
    const sinAuto = { ...vacio, hipotesis: vacio.hipotesis.filter((h) => !h.automatica) };
    expect(hipotesisAutomatica(sinAuto)).toBeUndefined();
  });
});
