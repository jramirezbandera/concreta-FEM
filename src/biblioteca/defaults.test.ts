// Tests de los defaults y presets de hormigon (auditoria UI/UX D3+D4). Proyecto
// `node` (sin DOM): son datos + constantes puras. Verifican que el material por
// defecto EXISTE en el catalogo, que los presets son plantillas (mm) coherentes, y
// que las secciones default por elemento coinciden con el primer preset de su lista.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MATERIAL_ID,
  PRESETS_PILAR,
  PRESETS_VIGA,
  PRESETS_HORMIGON,
  DEFAULT_SECCION_PILAR,
  DEFAULT_SECCION_VIGA,
  getMaterial,
} from "./index";

describe("DEFAULT_MATERIAL_ID", () => {
  it("es 'HA-25' y resuelve a un material de HORMIGON del catalogo", () => {
    expect(DEFAULT_MATERIAL_ID).toBe("HA-25");
    const material = getMaterial(DEFAULT_MATERIAL_ID);
    expect(material).toBeDefined();
    expect(material?.tipo).toBe("hormigon");
  });
});

describe("presets de hormigon", () => {
  it("PRESETS_PILAR ofrece 25×25, 30×30, 40×40 (rectangulares) en ese orden", () => {
    const rects = PRESETS_PILAR.filter((p) => p.clase === "rectangular");
    expect(rects.map((p) => p.etiqueta)).toEqual(["25×25", "30×30", "40×40"]);
    // El default de pilar (30×30) esta entre ellos.
    expect(
      PRESETS_PILAR.some(
        (p) => p.clase === "rectangular" && p.b === 300 && p.h === 300,
      ),
    ).toBe(true);
  });

  it("PRESETS_VIGA empieza por 30×50 (el default de viga) y ofrece 40×60", () => {
    expect(PRESETS_VIGA[0]).toEqual({
      clase: "rectangular",
      b: 300,
      h: 500,
      etiqueta: "30×50",
    });
    expect(PRESETS_VIGA.map((p) => p.etiqueta)).toEqual(["30×50", "40×60"]);
  });

  it("PRESETS_PILAR incluye los circulares Ø30 y Ø40", () => {
    const circulares = PRESETS_PILAR.filter((p) => p.clase === "circular");
    expect(circulares.map((p) => (p.clase === "circular" ? p.d : 0))).toEqual([
      300, 400,
    ]);
  });

  it("las dimensiones de todos los presets son positivas (mm)", () => {
    for (const p of PRESETS_HORMIGON) {
      if (p.clase === "rectangular") {
        expect(p.b).toBeGreaterThan(0);
        expect(p.h).toBeGreaterThan(0);
      } else {
        expect(p.d).toBeGreaterThan(0);
      }
    }
  });
});

describe("secciones default por elemento", () => {
  it("el pilar por defecto es HA 30×30 (rectangular 300×300)", () => {
    expect(DEFAULT_SECCION_PILAR.nombre).toBe("HA 30×30");
    expect(DEFAULT_SECCION_PILAR.preset).toEqual({
      clase: "rectangular",
      b: 300,
      h: 300,
      etiqueta: "30×30",
    });
  });

  it("la viga por defecto es HA 30×50 (rectangular 300×500)", () => {
    expect(DEFAULT_SECCION_VIGA.nombre).toBe("HA 30×50");
    expect(DEFAULT_SECCION_VIGA.preset).toEqual({
      clase: "rectangular",
      b: 300,
      h: 500,
      etiqueta: "30×50",
    });
  });
});
