// Tests del contrato Zod del centro de rigidez (resultadosCR.ts): la frontera CRUDA
// del glue (CRGlueSchema, solo x/y) y el contrato final (ResultadosCRSchema, x/y/ex/ey).
// Verifica: validacion de la forma feliz, el truco .nullish() (None Python -> undefined
// -> null), el rechazo de no-finitos (.finite()) y los literales (units, analysis.type).
import { describe, it, expect } from "vitest";
import { ResultadosCRSchema, CRGlueSchema } from "./resultadosCR";

describe("CRGlueSchema (salida cruda del glue)", () => {
  it("acepta x/y numericos y null por planta", () => {
    const r = CRGlueSchema.parse({
      units: "kN-m",
      analysis: { type: "centroRigidez" },
      cr_por_planta: { p1: { x: 1.5, y: -2 }, p2: { x: null, y: null } },
    });
    expect(r.cr_por_planta.p1).toEqual({ x: 1.5, y: -2 });
    expect(r.cr_por_planta.p2).toEqual({ x: null, y: null });
  });

  it("undefined (None de Python cruzando Pyodide) -> null via .nullish()", () => {
    // Una planta con el dict {} (x/y ausentes == undefined) parsea a {x:null,y:null}.
    const r = CRGlueSchema.parse({
      units: "kN-m",
      analysis: { type: "centroRigidez" },
      cr_por_planta: { p1: {} },
    });
    expect(r.cr_por_planta.p1).toEqual({ x: null, y: null });
  });

  it("rechaza x no finito (NaN/Infinity)", () => {
    expect(
      CRGlueSchema.safeParse({
        units: "kN-m",
        analysis: { type: "centroRigidez" },
        cr_por_planta: { p1: { x: Number.POSITIVE_INFINITY, y: 0 } },
      }).success,
    ).toBe(false);
    expect(
      CRGlueSchema.safeParse({
        units: "kN-m",
        analysis: { type: "centroRigidez" },
        cr_por_planta: { p1: { x: Number.NaN, y: 0 } },
      }).success,
    ).toBe(false);
  });

  it("rechaza units o analysis.type incorrectos", () => {
    expect(
      CRGlueSchema.safeParse({
        units: "kN",
        analysis: { type: "centroRigidez" },
        cr_por_planta: {},
      }).success,
    ).toBe(false);
    expect(
      CRGlueSchema.safeParse({
        units: "kN-m",
        analysis: { type: "modal" },
        cr_por_planta: {},
      }).success,
    ).toBe(false);
  });
});

describe("ResultadosCRSchema (contrato final con ex/ey)", () => {
  it("acepta x/y/ex/ey numericos y null", () => {
    const r = ResultadosCRSchema.parse({
      units: "kN-m",
      analysis: { type: "centroRigidez" },
      cr_por_planta: {
        p1: { x: 1, y: 2, ex: 0.5, ey: -0.5 },
        p2: { x: 1, y: 2, ex: null, ey: null }, // CM null -> sin excentricidad
        p3: { x: null, y: null, ex: null, ey: null }, // no determinable
      },
    });
    expect(r.cr_por_planta.p1).toEqual({ x: 1, y: 2, ex: 0.5, ey: -0.5 });
    expect(r.cr_por_planta.p2).toEqual({ x: 1, y: 2, ex: null, ey: null });
    expect(r.cr_por_planta.p3).toEqual({ x: null, y: null, ex: null, ey: null });
  });

  it("rechaza ex no finito", () => {
    expect(
      ResultadosCRSchema.safeParse({
        units: "kN-m",
        analysis: { type: "centroRigidez" },
        cr_por_planta: { p1: { x: 0, y: 0, ex: Number.POSITIVE_INFINITY, ey: 0 } },
      }).success,
    ).toBe(false);
  });

  it("cr_por_planta vacio es valido (edificio sin plantas diafragmables)", () => {
    const r = ResultadosCRSchema.parse({
      units: "kN-m",
      analysis: { type: "centroRigidez" },
      cr_por_planta: {},
    });
    expect(r.cr_por_planta).toEqual({});
  });
});
