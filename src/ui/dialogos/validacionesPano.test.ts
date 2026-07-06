// Tests de validacionesPano (F3): validacion de UI del paño losa. PURO (Node). Cubre:
// nombre vacio/duplicado, material asignado/existente, espesor/malla positivos.
import { describe, it, expect } from "vitest";
import { validarPano, esValido, type DatosPanoUI } from "./validacionesPano";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Pano } from "../../dominio";
import { listarMateriales } from "../../biblioteca";

// Un material real del catalogo para el caso valido.
const MAT_OK = listarMateriales()[0]!.id;

function pano(id: string, nombre: string): Pano {
  return {
    id,
    nombre,
    tipo: "losa",
    plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    espesor: 0.25,
    materialId: MAT_OK,
    tamMalla: 0.5,
    bordeApoyo: "simple",
  };
}

function modeloBase(): Modelo {
  const m = crearModeloVacio();
  m.panos = [pano("pa1", "F1")];
  return m;
}

function datosOK(over: Partial<DatosPanoUI> = {}): DatosPanoUI {
  return {
    nombre: "F2",
    materialId: MAT_OK,
    espesor: 0.25,
    tamMalla: 0.5,
    bordeApoyo: "simple",
    ...over,
  };
}

describe("validarPano", () => {
  it("caso totalmente valido: cero errores", () => {
    expect(esValido(validarPano(modeloBase(), null, datosOK()))).toBe(true);
  });

  it("nombre vacio da error", () => {
    const errs = validarPano(modeloBase(), null, datosOK({ nombre: "  " }));
    expect(errs.some((e) => e.campo === "nombre")).toBe(true);
  });

  it("nombre duplicado (otro paño) da error", () => {
    const errs = validarPano(modeloBase(), null, datosOK({ nombre: "F1" }));
    expect(errs.some((e) => e.campo === "nombre")).toBe(true);
  });

  it("editar el propio paño NO choca con su nombre", () => {
    // Validando pa1 con su mismo nombre F1: no es duplicado consigo mismo.
    expect(esValido(validarPano(modeloBase(), "pa1", datosOK({ nombre: "F1" })))).toBe(true);
  });

  it("material null da error", () => {
    const errs = validarPano(modeloBase(), null, datosOK({ materialId: null }));
    expect(errs.some((e) => e.campo === "materialId")).toBe(true);
  });

  it("material inexistente da error", () => {
    const errs = validarPano(modeloBase(), null, datosOK({ materialId: "no-existe" }));
    expect(errs.some((e) => e.campo === "materialId")).toBe(true);
  });

  it("espesor <= 0 da error", () => {
    expect(validarPano(modeloBase(), null, datosOK({ espesor: 0 })).some((e) => e.campo === "espesor")).toBe(true);
    expect(validarPano(modeloBase(), null, datosOK({ espesor: -0.1 })).some((e) => e.campo === "espesor")).toBe(true);
  });

  it("espesor NaN (campo vaciado) da error", () => {
    expect(validarPano(modeloBase(), null, datosOK({ espesor: NaN })).some((e) => e.campo === "espesor")).toBe(true);
  });

  it("tamMalla <= 0 da error", () => {
    expect(validarPano(modeloBase(), null, datosOK({ tamMalla: 0 })).some((e) => e.campo === "tamMalla")).toBe(true);
  });
});

// --- Campos del forjado UNIDIRECCIONAL (T4.1) --------------------------------
// Solo se validan cuando tipo === "unidireccional". Un caso uni valido y los errores
// por campo (intereje/canto/anchoNervio positivos, pesoPropio >= 0).

function datosUniOK(over: Partial<DatosPanoUI> = {}): DatosPanoUI {
  return {
    nombre: "F2",
    tipo: "unidireccional",
    materialId: MAT_OK,
    espesor: 0.25,
    tamMalla: 0.5,
    bordeApoyo: "simple",
    direccionViguetas: "x",
    intereje: 0.7,
    canto: 0.3,
    anchoNervio: 0.12,
    pesoPropio: 4,
    ...over,
  };
}

describe("validarPano: forjado unidireccional", () => {
  it("caso unidireccional totalmente valido: cero errores", () => {
    expect(esValido(validarPano(modeloBase(), null, datosUniOK()))).toBe(true);
  });

  it("bajo tipo losa NO se validan los campos uni (ausentes no dan error)", () => {
    // Un paño losa (datosOK, sin tipo -> losa) no porta campos uni: no debe fallar.
    expect(esValido(validarPano(modeloBase(), null, datosOK()))).toBe(true);
  });

  it("intereje <= 0 da error de intereje", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ intereje: 0 })).some((e) => e.campo === "intereje")).toBe(true);
    expect(validarPano(modeloBase(), null, datosUniOK({ intereje: -0.1 })).some((e) => e.campo === "intereje")).toBe(true);
  });

  it("intereje NaN (campo vaciado) da error de intereje", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ intereje: NaN })).some((e) => e.campo === "intereje")).toBe(true);
  });

  it("intereje ausente (undefined) bajo unidireccional da error", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ intereje: undefined })).some((e) => e.campo === "intereje")).toBe(true);
  });

  it("canto <= 0 da error de canto", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ canto: 0 })).some((e) => e.campo === "canto")).toBe(true);
  });

  it("anchoNervio <= 0 da error de anchoNervio", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ anchoNervio: 0 })).some((e) => e.campo === "anchoNervio")).toBe(true);
  });

  it("pesoPropio negativo da error de pesoPropio", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ pesoPropio: -1 })).some((e) => e.campo === "pesoPropio")).toBe(true);
  });

  it("pesoPropio 0 es legitimo (no da error)", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ pesoPropio: 0 })).some((e) => e.campo === "pesoPropio")).toBe(false);
  });

  it("pesoPropio NaN (campo vaciado) da error de pesoPropio", () => {
    expect(validarPano(modeloBase(), null, datosUniOK({ pesoPropio: NaN })).some((e) => e.campo === "pesoPropio")).toBe(true);
  });
});
