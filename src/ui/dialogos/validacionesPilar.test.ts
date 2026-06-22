// Tests del modulo PURO de validacion del pilar (feature-11, T1.2).
//
// UBICACION: vive en src/ui/dialogos para acompanar al panel del pilar, pero el
// modulo es puro (no toca DOM). El project `node` de Vitest EXCLUYE `src/ui/**`,
// asi que este test lo recoge el project `jsdom` (include: src/ui/**/*.test.{ts,tsx}).
// Correr logica pura bajo jsdom es valido: setup-ui.ts solo anade matchers + cleanup.
//   Ejecutar: npx vitest run src/ui/dialogos/validacionesPilar
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Planta, Pilar, Seccion } from "../../dominio";
import { validarPilar, esValido, type DatosPilarUI } from "./validacionesPilar";

// Ids reales del catalogo de la biblioteca, para los casos validos.
const MATERIAL_OK = "S275"; // src/biblioteca/aceros.ts
const PERFIL_OK = "IPE200"; // src/biblioteca/perfiles.ts (catalogo)

function planta(id: string, nombre: string, cota: number, grupoId: string): Planta {
  return { id, nombre, cota, altura: 3, grupoId };
}

function pilar(id: string, nombre: string): Pilar {
  return {
    id,
    nombre,
    x: 0,
    y: 0,
    plantaInicial: "p1",
    plantaFinal: "p2",
    seccionId: PERFIL_OK,
    materialId: MATERIAL_OK,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  };
}

// Seccion parametrica de obra (no esta en el catalogo): valida via modelo.secciones.
function seccionObra(id: string): Seccion {
  return { id, nombre: id, tipo: "hormigonRectangular", b: 0.3, h: 0.3 };
}

// Modelo con dos plantas (cota 0 y 3) de un grupo y un pilar existente "P1".
function modeloBase(): Modelo {
  const m = crearModeloVacio();
  m.plantas = [planta("p1", "Forjado 1", 0, "g1"), planta("p2", "Forjado 2", 3, "g1")];
  m.pilares = [pilar("pil1", "P1")];
  return m;
}

// Datos validos por defecto (un pilar nuevo P2 entre p1 y p2).
function datosOK(over: Partial<DatosPilarUI> = {}): DatosPilarUI {
  return {
    nombre: "P2",
    x: 1,
    y: 2,
    plantaInicial: "p1",
    plantaFinal: "p2",
    seccionId: PERFIL_OK,
    materialId: MATERIAL_OK,
    angulo: 0,
    ...over,
  };
}

describe("validarPilar", () => {
  it("caso totalmente valido: cero errores", () => {
    const errores = validarPilar(modeloBase(), null, datosOK());
    expect(esValido(errores)).toBe(true);
  });

  it("acepta una seccion parametrica de la obra (no de catalogo)", () => {
    const m = modeloBase();
    m.secciones = [seccionObra("sec-obra-1")];
    const errores = validarPilar(m, null, datosOK({ seccionId: "sec-obra-1" }));
    expect(esValido(errores)).toBe(true);
  });

  it("nombre vacio (tras trim) da error de nombre", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ nombre: "   " }));
    expect(errores).toContainEqual({ campo: "nombre", mensaje: "El pilar necesita un nombre." });
  });

  it("nombre duplicado de otro pilar da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ nombre: "P1" }));
    expect(errores).toHaveLength(1);
    expect(errores[0].campo).toBe("nombre");
    expect(errores[0].mensaje).toContain("Ya existe un pilar");
  });

  it("sin error al EDITAR el mismo pilar conservando su nombre", () => {
    const errores = validarPilar(modeloBase(), "pil1", datosOK({ nombre: "P1" }));
    expect(esValido(errores)).toBe(true);
  });

  it("x no finita (NaN) da error de numero en x", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ x: NaN }));
    expect(errores).toContainEqual({ campo: "x", mensaje: "Introduce un número válido." });
  });

  it("y no finita (Infinity) da error de numero en y", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ y: Infinity }));
    expect(errores).toContainEqual({ campo: "y", mensaje: "Introduce un número válido." });
  });

  it("angulo no finito (NaN) da error de numero en angulo", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ angulo: NaN }));
    expect(errores).toContainEqual({ campo: "angulo", mensaje: "Introduce un número válido." });
  });

  it("planta inicial inexistente da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ plantaInicial: "fantasma" }));
    expect(errores.some((e) => e.campo === "plantaInicial")).toBe(true);
  });

  it("planta final inexistente da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ plantaFinal: "fantasma" }));
    expect(errores.some((e) => e.campo === "plantaFinal")).toBe(true);
  });

  it("plantas invertidas (inicial por encima de la final) da error de orden", () => {
    // p2 (cota 3) como inicial y p1 (cota 0) como final: invertido.
    const errores = validarPilar(
      modeloBase(),
      null,
      datosOK({ plantaInicial: "p2", plantaFinal: "p1" }),
    );
    expect(errores).toContainEqual({
      campo: "plantaInicial",
      mensaje: "La planta inicial debe estar por debajo o ser la final.",
    });
  });

  it("misma planta como inicial y final es valido (tramo de una planta)", () => {
    const errores = validarPilar(
      modeloBase(),
      null,
      datosOK({ plantaInicial: "p1", plantaFinal: "p1" }),
    );
    expect(esValido(errores)).toBe(true);
  });

  it("seccion sin asignar (null) da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ seccionId: null }));
    expect(errores).toContainEqual({ campo: "seccionId", mensaje: "Asigna una sección al pilar." });
  });

  it("seccion inexistente (ni catalogo ni obra) da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ seccionId: "no-existe" }));
    expect(errores.some((e) => e.campo === "seccionId")).toBe(true);
  });

  it("material sin asignar (null) da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ materialId: null }));
    expect(errores).toContainEqual({ campo: "materialId", mensaje: "Asigna un material al pilar." });
  });

  it("material inexistente en el catalogo da error", () => {
    const errores = validarPilar(modeloBase(), null, datosOK({ materialId: "S999" }));
    expect(errores.some((e) => e.campo === "materialId")).toBe(true);
  });
});
