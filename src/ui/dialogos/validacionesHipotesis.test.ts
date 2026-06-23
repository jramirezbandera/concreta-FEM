// Tests del modulo PURO de validacion de la hipotesis (feature-13, T2.2).
//
// UBICACION: vive en src/ui/dialogos para acompanar al dialogo de cargas/hipotesis,
// pero el modulo es puro (no toca DOM). El project `node` de Vitest EXCLUYE
// `src/ui/**`, asi que lo recoge el project `jsdom` (include: src/ui/**/*.test.ts).
//   Ejecutar: npx vitest run src/ui/dialogos/validacionesHipotesis
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import { validarHipotesis, esValido, type DatosHipotesisUI } from "./validacionesHipotesis";

// crearModeloVacio() ya siembra dos hipotesis: "Cargas muertas" (permanente) y
// "Sobrecarga de uso" (variable). Las usamos como las "existentes".
function modeloBase(): Modelo {
  return crearModeloVacio();
}

// Datos validos por defecto: una hipotesis nueva con nombre libre.
function datosOK(over: Partial<DatosHipotesisUI> = {}): DatosHipotesisUI {
  return {
    nombre: "Nieve",
    tipo: "variable",
    ...over,
  };
}

describe("validarHipotesis", () => {
  it("caso totalmente valido: cero errores", () => {
    const errores = validarHipotesis(modeloBase(), null, datosOK());
    expect(esValido(errores)).toBe(true);
  });

  it("nombre vacio (tras trim) da error de nombre", () => {
    const errores = validarHipotesis(modeloBase(), null, datosOK({ nombre: "   " }));
    expect(errores).toContainEqual({
      campo: "nombre",
      mensaje: "La hipótesis necesita un nombre.",
    });
  });

  it("nombre duplicado de otra hipotesis da error", () => {
    const errores = validarHipotesis(modeloBase(), null, datosOK({ nombre: "Cargas muertas" }));
    expect(errores).toHaveLength(1);
    expect(errores[0].campo).toBe("nombre");
    expect(errores[0].mensaje).toContain("Ya existe una hipótesis");
  });

  it("sin error al EDITAR la misma hipotesis conservando su nombre", () => {
    const errores = validarHipotesis(
      modeloBase(),
      "hip-cargas-muertas",
      datosOK({ nombre: "Cargas muertas", tipo: "permanente" }),
    );
    expect(esValido(errores)).toBe(true);
  });

  it("tipo fuera del enum da error (defensivo)", () => {
    const errores = validarHipotesis(
      modeloBase(),
      null,
      // @ts-expect-error: valor fuera del enum a proposito, para probar el blindaje.
      datosOK({ tipo: "accidental" }),
    );
    expect(errores.some((e) => e.campo === "tipo")).toBe(true);
  });
});
