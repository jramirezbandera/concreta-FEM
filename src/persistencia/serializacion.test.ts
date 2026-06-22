// Tests de serializacion export/import (T3.2). Project `persistencia`. Aunque no
// usa IndexedDB, el modulo vive aqui y se prueba junto al resto de F8.
import { describe, it, expect } from "vitest";
import { crearModeloVacio, SCHEMA_VERSION, type Modelo } from "../dominio";
import {
  exportarProyecto,
  exportarProyectoComoTexto,
  importarProyecto,
} from "./serializacion";

// Modelo con contenido real (no vacio): un grupo, una planta, una seccion, un
// nudo y un pilar validos. Asi el roundtrip ejercita arrays con datos, no solo
// estructura vacia. Solo forma/tipos (Zod no exige integridad referencial).
function crearModeloConContenido(): Modelo {
  const base = crearModeloVacio();
  return {
    ...base,
    grupos: [
      {
        id: "g1",
        nombre: "Forjado tipo",
        categoriaUso: "A",
        sobrecargaUso: 2,
        cargasMuertas: 1.5,
      },
    ],
    plantas: [
      { id: "p1", nombre: "Planta baja", cota: 0, altura: 3, grupoId: "g1" },
    ],
    secciones: [
      { id: "s1", nombre: "30x40", tipo: "hormigonRectangular", b: 0.3, h: 0.4 },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
    ],
    pilares: [
      {
        id: "pil1",
        nombre: "P1",
        x: 0,
        y: 0,
        plantaInicial: "p1",
        plantaFinal: "p1",
        seccionId: "s1",
        materialId: "HA-25",
        angulo: 0,
        vinculacionExterior: true,
        arranque: "empotrado",
      },
    ],
  };
}

describe("serializacion export/import", () => {
  it("roundtrip exacto: exportar -> importar devuelve el modelo deep-equal y el nombre", async () => {
    const modelo = crearModeloConContenido();

    const blob = exportarProyecto("Mi proyecto", modelo);
    expect(blob.type).toBe("application/json");

    const texto = await blob.text();
    const resultado = importarProyecto(texto);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.modelo).toEqual(modelo);
      expect(resultado.avisos).toEqual([]);
      // El import devuelve el nombre exportado (T2): F9 lo propone al guardar.
      expect(resultado.nombre).toBe("Mi proyecto");
    }
  });

  it("JSON ajeno con modelo valido pero SIN formato -> rechazado (T2)", () => {
    // Otro JSON cualquiera cuyo `modelo` casualmente pasaria ModeloSchema, pero sin
    // la marca de formato: debe rechazarse antes de validar el modelo.
    const modelo = crearModeloConContenido();
    const texto = JSON.stringify({ nombre: "Ajeno", modelo });
    const resultado = importarProyecto(texto);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores[0]).toMatch(/marca de formato|no es un proyecto/i);
    }
  });

  it("formato distinto (otra app) -> rechazado (T2)", () => {
    const modelo = crearModeloConContenido();
    const texto = JSON.stringify({ formato: "otra-app", nombre: "X", modelo });
    expect(importarProyecto(texto).ok).toBe(false);
  });

  it("el fichero exportado tiene el formato/envoltorio esperado", () => {
    const modelo = crearModeloConContenido();
    const texto = exportarProyectoComoTexto("Mi proyecto", modelo);
    const parsed = JSON.parse(texto);

    expect(parsed.formato).toBe("concreta-proyecto");
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.nombre).toBe("Mi proyecto");
    expect(parsed.modelo).toEqual(modelo);
    // Indentado a 2 espacios (legible y diff-friendly).
    expect(texto).toContain('\n  "formato"');
  });

  it("texto corrupto (no JSON) -> ok:false, sin throw", () => {
    expect(() => importarProyecto("{ esto no es json")).not.toThrow();
    const resultado = importarProyecto("{ esto no es json");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores.length).toBeGreaterThan(0);
    }
  });

  it("envoltorio sin modelo -> ok:false, sin throw", () => {
    const texto = JSON.stringify({ formato: "concreta-proyecto", nombre: "X" });
    expect(() => importarProyecto(texto)).not.toThrow();
    const resultado = importarProyecto(texto);
    expect(resultado.ok).toBe(false);
  });

  it("forma inesperada (no objeto) -> ok:false, sin throw", () => {
    for (const t of ["null", "42", '"hola"', "[1,2,3]"]) {
      expect(() => importarProyecto(t)).not.toThrow();
      expect(importarProyecto(t).ok).toBe(false);
    }
  });

  it("schemaVersion futura en el modelo -> ok:false (delegado en migrarYValidar)", () => {
    const modelo = crearModeloConContenido();
    const futuro: Modelo = { ...modelo, schemaVersion: SCHEMA_VERSION + 1 };
    const texto = exportarProyectoComoTexto("Futuro", futuro);
    const resultado = importarProyecto(texto);
    expect(resultado.ok).toBe(false);
  });

  it("modelo con forma invalida en el envoltorio -> ok:false (validacion Zod)", () => {
    // schemaVersion presente (para pasar el guard de version) pero campos ausentes.
    const texto = JSON.stringify({
      formato: "concreta-proyecto",
      modelo: { schemaVersion: SCHEMA_VERSION },
    });
    const resultado = importarProyecto(texto);
    expect(resultado.ok).toBe(false);
  });
});
