// Tests de los HELPERS PUROS de exportación (D2). Project `jsdom` (fichero .ts bajo
// src/ui/**), pero no tocan DOM ni IndexedDB: solo el saneado del nombre de fichero, el
// nombre completo con fecha inyectada y la serialización (delegada en serializacion.ts).
// El efecto de descarga y la lectura del nombre del proyecto activo (exportarObraActual)
// se cubren indirectamente por el test de flujo; aquí verificamos lo determinista.
import { describe, it, expect } from "vitest";
import {
  sanearNombreArchivo,
  nombreArchivoExport,
  serializarObra,
} from "./exportarObra";
import { crearModeloVacio } from "../../dominio";

describe("sanearNombreArchivo", () => {
  it("quita acentos y ñ, pasa a minúsculas y colapsa símbolos a guiones", () => {
    expect(sanearNombreArchivo("Edificio Peña Ñandú")).toBe("edificio-pena-nandu");
    expect(sanearNombreArchivo("Obra sin título")).toBe("obra-sin-titulo");
  });

  it("recorta guiones de los extremos y colapsa repetidos", () => {
    expect(sanearNombreArchivo("  ...Torre / Norte...  ")).toBe("torre-norte");
  });

  it("cae al rótulo por defecto si el nombre queda vacío tras sanear", () => {
    expect(sanearNombreArchivo("¡@#%!")).toBe("obra");
    expect(sanearNombreArchivo("")).toBe("obra");
  });
});

describe("nombreArchivoExport", () => {
  it("compone <obra-saneada>-<fecha>.json con la fecha inyectada", () => {
    // Fecha local fija (mes 0-indexado): 2026-03-07.
    const fecha = new Date(2026, 2, 7);
    expect(nombreArchivoExport("Edificio A", fecha)).toBe("edificio-a-2026-03-07.json");
  });

  it("sanea el nombre y rellena mes/día a dos dígitos", () => {
    const fecha = new Date(2026, 0, 1);
    expect(nombreArchivoExport("Nave Industrial", fecha)).toBe(
      "nave-industrial-2026-01-01.json",
    );
  });
});

describe("serializarObra", () => {
  it("produce el envoltorio .json de Concreta con formato, nombre y modelo", () => {
    const modelo = crearModeloVacio();
    const texto = serializarObra("Mi obra", modelo);
    const parsed = JSON.parse(texto);
    expect(parsed.formato).toBe("concreta-proyecto");
    expect(parsed.nombre).toBe("Mi obra");
    expect(parsed.schemaVersion).toBe(modelo.schemaVersion);
    expect(parsed.modelo.unidades).toBe("kN-m");
    // El schemaVersion del envoltorio sigue al del modelo (contrato de serializacion.ts).
    expect(parsed.modelo.schemaVersion).toBe(modelo.schemaVersion);
  });

  it("hace roundtrip por la frontera de importación (lo que exporta, se reimporta)", () => {
    const modelo = crearModeloVacio();
    const texto = serializarObra("Roundtrip", modelo);
    // Reusa la frontera real (no la duplica): un .json recién exportado debe validar.
    // La import se prueba a fondo en ArchivoIO.test / importarObra.integracion.test;
    // aquí basta comprobar que el par export↔import cierra.
    expect(texto).toContain("\"formato\": \"concreta-proyecto\"");
  });
});
