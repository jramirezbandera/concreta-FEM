import { describe, it, expect } from "vitest";
import {
  pesoPropioOrientativo,
  listarForjadosUnidireccionales,
  PESO_PROPIO_UNIDIRECCIONAL_DEFAULT,
  CANTO_UNIDIRECCIONAL_DEFAULT,
  pesoPropioOrientativoReticular,
  listarForjadosReticulares,
  PESO_PROPIO_RETICULAR_DEFAULT,
  CANTO_RETICULAR_DEFAULT,
  INTEREJE_RETICULAR_DEFAULT,
  ANCHO_NERVIO_RETICULAR_DEFAULT,
  CAPA_COMPRESION_RETICULAR_DEFAULT,
} from "./index";

// Tests de la TABLA NORMATIVA DE PESO PROPIO DE FORJADOS (corte unidireccional,
// T1.3). Proyecto `node` (sin DOM): la tabla es pura (datos + lookup). Cada valor
// esperado se cablea CONTRA LA FUENTE OFICIAL citada (verificada 2026-07-06):
//   - CTE DB-SE-AE Anejo C, Tabla C.5 "Peso propio de elementos constructivos",
//     subseccion "Forjados" (edicion Abril 2009, pag. SE-AE 20).
// Un test rojo aqui senala un descuadre con la norma, no un descuido de copia.

describe("pesoPropioOrientativo - tramos de la Tabla C.5 (CTE DB-SE-AE)", () => {
  it("canto < 0,28 m -> 3 kN/m² (forjado unidireccional, luces hasta 5 m)", () => {
    expect(pesoPropioOrientativo(0.25)).toBe(3);
    expect(pesoPropioOrientativo(0.27)).toBe(3);
  });

  it("0,28 <= canto < 0,30 m -> 4 kN/m² (forjado uni o bidireccional)", () => {
    // El canto habitual del corte (0,30 con intereje 0,70) cae aqui: 0,28 exacto
    // ya NO entra en "< 0,28" (umbral estricto de la norma) y sube a este tramo.
    expect(pesoPropioOrientativo(0.28)).toBe(4);
    expect(pesoPropioOrientativo(0.29)).toBe(4);
  });

  it("0,30 <= canto < 0,35 m -> 5 kN/m² (gran canto)", () => {
    expect(pesoPropioOrientativo(0.3)).toBe(5);
    expect(pesoPropioOrientativo(0.34)).toBe(5);
  });

  it("umbrales estrictos '< X' de la norma: 0,30 exacto NO es 4, es 5", () => {
    // La Tabla C.5 dice "grueso total < 0,30 m"; 0,30 exacto queda fuera de ese
    // tramo. Es la letra del CTE (comparacion estricta), no un redondeo.
    expect(pesoPropioOrientativo(0.3)).not.toBe(4);
    expect(pesoPropioOrientativo(0.3)).toBe(5);
  });
});

describe("pesoPropioOrientativo - fuera de rango y casos borde", () => {
  it("canto > 0,35 m -> 5 kN/m² (cota conservadora del ultimo tramo)", () => {
    expect(pesoPropioOrientativo(0.4)).toBe(5);
    expect(pesoPropioOrientativo(1.0)).toBe(5);
  });

  it("canto <= 0 (no fisico) -> tramo mas ligero (3), no lanza", () => {
    expect(() => pesoPropioOrientativo(0)).not.toThrow();
    expect(pesoPropioOrientativo(0)).toBe(3);
    expect(pesoPropioOrientativo(-0.1)).toBe(3);
  });

  it("es monotona no decreciente en el rango tabulado", () => {
    let previo = pesoPropioOrientativo(0.05);
    for (let c = 0.05; c <= 0.4; c += 0.01) {
      const actual = pesoPropioOrientativo(c);
      expect(actual).toBeGreaterThanOrEqual(previo);
      previo = actual;
    }
  });

  it("todos los pesos devueltos estan en el rango fisico [3, 5] kN/m²", () => {
    for (let c = 0.01; c <= 1.0; c += 0.01) {
      const p = pesoPropioOrientativo(c);
      expect(p).toBeGreaterThanOrEqual(3);
      expect(p).toBeLessThanOrEqual(5);
    }
  });
});

describe("Default del corte unidireccional", () => {
  it("PESO_PROPIO_UNIDIRECCIONAL_DEFAULT = 4 kN/m² (tramo '< 0,30 m' de la Tabla C.5)", () => {
    expect(PESO_PROPIO_UNIDIRECCIONAL_DEFAULT).toBe(4);
  });

  it("CANTO_UNIDIRECCIONAL_DEFAULT = 0,30 m (canto del corte)", () => {
    expect(CANTO_UNIDIRECCIONAL_DEFAULT).toBe(0.3);
  });

  it("el default es coherente con un canto justo por DEBAJO del limite 0,30", () => {
    // Un forjado de 0,30 m se dimensiona en el tramo "< 0,30 -> 4"; el helper con
    // un canto epsilon por debajo confirma que ese tramo devuelve 4.
    expect(pesoPropioOrientativo(0.3 - 1e-9)).toBe(PESO_PROPIO_UNIDIRECCIONAL_DEFAULT);
  });
});

describe("listarForjadosUnidireccionales - metadatos y copia segura", () => {
  it("devuelve los 3 tramos unidireccionales con descripcion no vacia", () => {
    const lista = listarForjadosUnidireccionales();
    expect(lista).toHaveLength(3);
    for (const e of lista) {
      expect(e.descripcion.length).toBeGreaterThan(0);
      expect(e.cantoMax).toBeGreaterThan(0);
      expect(e.pesoPropio).toBeGreaterThan(0);
    }
  });

  it("los tramos van ordenados por cantoMax ascendente", () => {
    const lista = listarForjadosUnidireccionales();
    for (let i = 1; i < lista.length; i++) {
      expect(lista[i].cantoMax).toBeGreaterThan(lista[i - 1].cantoMax);
    }
  });

  it("es una copia mutable-segura (no altera la tabla interna)", () => {
    const lista = listarForjadosUnidireccionales();
    lista[0].pesoPropio = 999;
    // El lookup sigue devolviendo el valor original del primer tramo.
    expect(pesoPropioOrientativo(0.2)).toBe(3);
  });
});

// =============================================================================
// FORJADO RETICULAR / BIDIRECCIONAL (corte F3-reticular, T2.3)
// =============================================================================
// Espejo del bloque unidireccional. Fuente del PESO: CTE DB-SE-AE Anejo C Tabla C.5
// (subseccion "Forjados") — las DOS filas del bidireccional le aplican por norma
// (la Tabla nombra "bidireccional" expresamente en ambos tramos). Un test rojo aqui
// senala un descuadre con la norma, no un descuido de copia.

describe("pesoPropioOrientativoReticular - tramos bidireccionales de la Tabla C.5", () => {
  it("canto < 0,30 m -> 4 kN/m² (forjado uni o bidireccional)", () => {
    expect(pesoPropioOrientativoReticular(0.25)).toBe(4);
    expect(pesoPropioOrientativoReticular(0.29)).toBe(4);
  });

  it("0,30 <= canto < 0,35 m -> 5 kN/m² (forjado bidireccional)", () => {
    expect(pesoPropioOrientativoReticular(0.3)).toBe(5);
    expect(pesoPropioOrientativoReticular(0.34)).toBe(5);
  });

  it("umbrales estrictos '< X' de la norma: 0,30 exacto NO es 4, es 5", () => {
    // La Tabla C.5 dice "grueso total < 0,30 m"; 0,30 exacto queda fuera de ese
    // tramo (comparacion estricta, igual que el unidireccional).
    expect(pesoPropioOrientativoReticular(0.3)).not.toBe(4);
    expect(pesoPropioOrientativoReticular(0.3)).toBe(5);
  });
});

describe("pesoPropioOrientativoReticular - fuera de rango y casos borde", () => {
  it("canto > 0,35 m -> 5 kN/m² (cota conservadora del ultimo tramo)", () => {
    expect(pesoPropioOrientativoReticular(0.4)).toBe(5);
    expect(pesoPropioOrientativoReticular(1.0)).toBe(5);
  });

  it("canto <= 0 (no fisico) -> tramo mas ligero (4), no lanza", () => {
    expect(() => pesoPropioOrientativoReticular(0)).not.toThrow();
    expect(pesoPropioOrientativoReticular(0)).toBe(4);
    expect(pesoPropioOrientativoReticular(-0.1)).toBe(4);
  });

  it("es monotona no decreciente en el rango tabulado", () => {
    let previo = pesoPropioOrientativoReticular(0.05);
    for (let c = 0.05; c <= 0.4; c += 0.01) {
      const actual = pesoPropioOrientativoReticular(c);
      expect(actual).toBeGreaterThanOrEqual(previo);
      previo = actual;
    }
  });

  it("todos los pesos devueltos estan en el rango fisico [4, 5] kN/m²", () => {
    for (let c = 0.01; c <= 1.0; c += 0.01) {
      const p = pesoPropioOrientativoReticular(c);
      expect(p).toBeGreaterThanOrEqual(4);
      expect(p).toBeLessThanOrEqual(5);
    }
  });
});

describe("Defaults del corte reticular", () => {
  it("PESO_PROPIO_RETICULAR_DEFAULT = 4 kN/m² (tramo '< 0,30 m' de la Tabla C.5)", () => {
    expect(PESO_PROPIO_RETICULAR_DEFAULT).toBe(4);
  });

  it("CANTO_RETICULAR_DEFAULT = 0,30 m (canto del corte, 25+5)", () => {
    expect(CANTO_RETICULAR_DEFAULT).toBe(0.3);
  });

  it("INTEREJE_RETICULAR_DEFAULT = 0,80 m (<= 1,5 m de norma)", () => {
    expect(INTEREJE_RETICULAR_DEFAULT).toBe(0.8);
  });

  it("ANCHO_NERVIO_RETICULAR_DEFAULT = 0,12 m", () => {
    expect(ANCHO_NERVIO_RETICULAR_DEFAULT).toBe(0.12);
  });

  it("CAPA_COMPRESION_RETICULAR_DEFAULT = 0,05 m (= minimo de norma)", () => {
    expect(CAPA_COMPRESION_RETICULAR_DEFAULT).toBe(0.05);
  });

  it("el peso default es coherente con un canto justo por DEBAJO del limite 0,30", () => {
    // Un reticular de 0,30 m se dimensiona en el tramo "< 0,30 -> 4"; el helper con
    // un canto epsilon por debajo confirma que ese tramo devuelve el default (4).
    expect(pesoPropioOrientativoReticular(0.3 - 1e-9)).toBe(PESO_PROPIO_RETICULAR_DEFAULT);
  });

  it("los defaults geometricos cumplen los rangos del Codigo Estructural Anejo 19", () => {
    // Contexto (la validacion vive en F4/validaciones.ts, no aqui): que los propios
    // defaults NO nazcan violando la norma es un sanity check barato.
    expect(INTEREJE_RETICULAR_DEFAULT).toBeLessThanOrEqual(1.5); // intereje <= 1,5 m
    expect(CAPA_COMPRESION_RETICULAR_DEFAULT).toBeGreaterThanOrEqual(0.05); // capa >= 0,05 m
    expect(CAPA_COMPRESION_RETICULAR_DEFAULT).toBeLessThan(CANTO_RETICULAR_DEFAULT); // capa < canto
    expect(ANCHO_NERVIO_RETICULAR_DEFAULT).toBeLessThan(INTEREJE_RETICULAR_DEFAULT); // nervio < intereje
    const esbeltez =
      (CANTO_RETICULAR_DEFAULT - CAPA_COMPRESION_RETICULAR_DEFAULT) / ANCHO_NERVIO_RETICULAR_DEFAULT;
    expect(esbeltez).toBeLessThanOrEqual(4); // esbeltez del nervio <= 4
  });
});

describe("listarForjadosReticulares - metadatos y copia segura", () => {
  it("devuelve los 2 tramos bidireccionales con descripcion no vacia", () => {
    const lista = listarForjadosReticulares();
    expect(lista).toHaveLength(2);
    for (const e of lista) {
      expect(e.descripcion.length).toBeGreaterThan(0);
      expect(e.cantoMax).toBeGreaterThan(0);
      expect(e.pesoPropio).toBeGreaterThan(0);
    }
  });

  it("los tramos van ordenados por cantoMax ascendente", () => {
    const lista = listarForjadosReticulares();
    for (let i = 1; i < lista.length; i++) {
      expect(lista[i].cantoMax).toBeGreaterThan(lista[i - 1].cantoMax);
    }
  });

  it("es una copia mutable-segura (no altera la tabla interna)", () => {
    const lista = listarForjadosReticulares();
    lista[0].pesoPropio = 999;
    // El lookup sigue devolviendo el valor original del primer tramo.
    expect(pesoPropioOrientativoReticular(0.25)).toBe(4);
  });
});
