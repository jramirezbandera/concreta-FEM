// Tests del modulo PURO de validacion de la viga (feature-12, T1.3).
//
// UBICACION: vive en src/ui/dialogos para acompanar al inspector de la viga, pero
// el modulo es puro (no toca DOM). El project `node` de Vitest EXCLUYE `src/ui/**`,
// asi que este test lo recoge el project `jsdom` (include: src/ui/**/*.test.{ts,tsx}).
// Correr logica pura bajo jsdom es valido: setup-ui.ts solo anade matchers + cleanup.
//   Ejecutar: npx vitest run src/ui/dialogos/validacionesViga
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Viga, Seccion } from "../../dominio";
import { validarViga, esValido, type DatosVigaUI } from "./validacionesViga";

// Ids reales del catalogo de la biblioteca, para los casos validos.
const MATERIAL_OK = "S275"; // src/biblioteca/aceros.ts
const PERFIL_OK = "IPE200"; // src/biblioteca/perfiles.ts (catalogo)

function viga(id: string, nombre: string): Viga {
  return {
    id,
    nombre,
    plantaId: "p1",
    nudoI: "n1",
    nudoJ: "n2",
    seccionId: PERFIL_OK,
    materialId: MATERIAL_OK,
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  };
}

// Seccion parametrica de obra (no esta en el catalogo): valida via modelo.secciones.
function seccionObra(id: string): Seccion {
  return { id, nombre: id, tipo: "hormigonRectangular", b: 0.3, h: 0.3 };
}

// Modelo con una viga existente "V1".
function modeloBase(): Modelo {
  const m = crearModeloVacio();
  m.vigas = [viga("vig1", "V1")];
  return m;
}

// Datos validos por defecto (una viga nueva V2).
function datosOK(over: Partial<DatosVigaUI> = {}): DatosVigaUI {
  return {
    nombre: "V2",
    seccionId: PERFIL_OK,
    materialId: MATERIAL_OK,
    extremoI: "empotrado",
    extremoJ: "articulado",
    tirante: false,
    ...over,
  };
}

describe("validarViga", () => {
  it("caso totalmente valido: cero errores", () => {
    const errores = validarViga(modeloBase(), null, datosOK());
    expect(esValido(errores)).toBe(true);
  });

  it("acepta una seccion parametrica de la obra (no de catalogo)", () => {
    const m = modeloBase();
    m.secciones = [seccionObra("sec-obra-1")];
    const errores = validarViga(m, null, datosOK({ seccionId: "sec-obra-1" }));
    expect(esValido(errores)).toBe(true);
  });

  it("nombre vacio (tras trim) da error de nombre", () => {
    const errores = validarViga(modeloBase(), null, datosOK({ nombre: "   " }));
    expect(errores).toContainEqual({ campo: "nombre", mensaje: "La viga necesita un nombre." });
  });

  it("nombre duplicado de otra viga da error", () => {
    const errores = validarViga(modeloBase(), null, datosOK({ nombre: "V1" }));
    expect(errores).toHaveLength(1);
    expect(errores[0].campo).toBe("nombre");
    expect(errores[0].mensaje).toContain("Ya existe una viga");
  });

  it("sin error al EDITAR la misma viga conservando su nombre", () => {
    const errores = validarViga(modeloBase(), "vig1", datosOK({ nombre: "V1" }));
    expect(esValido(errores)).toBe(true);
  });

  it("seccion sin asignar (null) da error", () => {
    const errores = validarViga(modeloBase(), null, datosOK({ seccionId: null }));
    expect(errores).toContainEqual({ campo: "seccionId", mensaje: "Asigna una sección a la viga." });
  });

  it("seccion inexistente (ni catalogo ni obra) da error", () => {
    const errores = validarViga(modeloBase(), null, datosOK({ seccionId: "no-existe" }));
    expect(errores.some((e) => e.campo === "seccionId")).toBe(true);
  });

  it("material sin asignar (null) da error", () => {
    const errores = validarViga(modeloBase(), null, datosOK({ materialId: null }));
    expect(errores).toContainEqual({ campo: "materialId", mensaje: "Asigna un material a la viga." });
  });

  it("material inexistente en el catalogo da error", () => {
    const errores = validarViga(modeloBase(), null, datosOK({ materialId: "S999" }));
    expect(errores.some((e) => e.campo === "materialId")).toBe(true);
  });
});
