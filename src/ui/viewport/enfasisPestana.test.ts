// Test del modulo puro de enfasis por pestana (Corte UX-1.4). Node-agnostico: sin
// React ni three. Ademas de los mappings, fija el CONTRATO de referencia estable
// (mismo input => mismo objeto), del que depende useSyncExternalStore en el lienzo.
import { describe, expect, it } from "vitest";

import { ENFASIS_PLENO, enfasisDePestana } from "./enfasisPestana";

describe("enfasisDePestana (Corte UX-1.4)", () => {
  it("en entradaPilares atenua vigas y panos (los pilares protagonizan)", () => {
    expect(enfasisDePestana("entradaPilares", "planta")).toEqual({
      pilares: "pleno",
      vigas: "atenuado",
      panos: "atenuado",
    });
  });

  it("en entradaVigas atenua los pilares (vigas y panos protagonizan)", () => {
    expect(enfasisDePestana("entradaVigas", "planta")).toEqual({
      pilares: "atenuado",
      vigas: "pleno",
      panos: "pleno",
    });
  });

  it("resultados/isovalores leen la obra completa: todo pleno", () => {
    expect(enfasisDePestana("resultados", "planta")).toBe(ENFASIS_PLENO);
    expect(enfasisDePestana("isovalores", "planta")).toBe(ENFASIS_PLENO);
  });

  it("fuera de planta (3D/mosaico) todo pleno, sea cual sea la pestana", () => {
    expect(enfasisDePestana("entradaPilares", "3d")).toBe(ENFASIS_PLENO);
    expect(enfasisDePestana("entradaVigas", "mosaico")).toBe(ENFASIS_PLENO);
  });

  it("referencia ESTABLE: mismo input devuelve el mismo objeto (contrato snapshot)", () => {
    expect(enfasisDePestana("entradaPilares", "planta")).toBe(
      enfasisDePestana("entradaPilares", "planta"),
    );
    expect(enfasisDePestana("entradaVigas", "planta")).toBe(
      enfasisDePestana("entradaVigas", "planta"),
    );
  });
});
