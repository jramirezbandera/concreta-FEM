/**
 * El lector de DWG frente a AutoCAD (fase DW, `docs/fem3d/dwg.md` §5). Las muestras de ACadSharp
 * son el mismo dibujo guardado por AutoCAD en cada versión, con su DXF ASCII al lado; se traen con
 * `bun validacion/dwg/muestras.ts` (DW-d). Sin ellas, la prueba falla diciendo cómo traerlas.
 *
 * Tramo DW1: R14 y 2000, con las capas, `LINE`, `ARC` y `CIRCLE`.
 */
import { describe, expect, it } from "vitest";
import { muestra } from "../../validacion/dwg/muestras.ts";
import { type Dxf, ErrorDxf, leerDxf, texto } from "../dxf/lector.ts";
import { compararDwgConDxf } from "./comparar.ts";
import { esDwg, leerDwg } from "./lector.ts";

const dxf2000 = () => leerDxf(muestra("sample_AC1015_ascii.dxf"));

/** Una variable de la cabecera del DXF (los tres valores de un punto). */
function variableDxf(n: string, nombre: string): number[] {
  const t = new TextDecoder().decode(muestra(n));
  const i = t.indexOf(`\n${nombre}\n`);
  const l = t.slice(i).split("\n");
  return [Number(l[3]), Number(l[5]), Number(l[7])];
}

describe("DWG 2000 (AC1015) frente al DXF de AutoCAD", () => {
  const dwg = leerDwg(muestra("sample_AC1015.dwg"));

  it("las entidades, una a una por su handle, y en el mismo orden", () => {
    const dxf = dxf2000();
    const r = compararDwgConDxf(dwg, dxf);
    expect(r.fallos).toEqual([]);
    const traducibles = dxf.entidades.filter((e) => ["LINE", "ARC", "CIRCLE"].includes(e.tipo)).length;
    expect(r.emparejadas).toBe(traducibles);
    expect(r.emparejadas).toBe(35);
    // El DXF escribe 16 cifras: lo que queda es su redondeo
    expect(r.errorMaximo).toBeLessThan(1e-15);
  });

  it("la cabecera: $INSUNITS, $EXTMIN y $EXTMAX", () => {
    expect(dwg.insunits).toBe(1);
    for (const [nombre, v] of [
      ["$EXTMIN", dwg.cabeceraDwg.extmin],
      ["$EXTMAX", dwg.cabeceraDwg.extmax],
    ] as const) {
      const x = variableDxf("sample_AC1015_ascii.dxf", nombre);
      for (let i = 0; i < 3; i++) expect(Math.abs(v[i]! - x[i]!)).toBeLessThanOrEqual(1e-15 * Math.max(1, Math.abs(x[i]!)));
    }
  });

  it("se leen todos los objetos y la página de códigos es la del dibujo", () => {
    expect(dwg.fallos).toEqual([]);
    expect(dwg.codificacion).toBe("windows-1252");
    expect(dwg.version).toBe("AC1015");
  });
});

describe("DWG R14 (AC1014)", () => {
  const r14 = leerDwg(muestra("sample_AC1014.dwg"));

  it("frente al DXF de 2000: igual, salvo lo que R14 no guarda", () => {
    // R14 no tiene $INSUNITS y guarda los nombres en mayúsculas («Layer_Off» → «LAYER_OFF», «0 @ 1» → «0___1»)
    const x = dxf2000();
    const mayus = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_$-]/g, "_");
    const adaptado: Dxf = {
      ...x,
      insunits: null,
      capas: x.capas.map((c) => ({ ...c, nombre: mayus(c.nombre) })),
      entidades: x.entidades.map((e) => ({ ...e, capa: mayus(e.capa) })),
    };
    const r = compararDwgConDxf(r14, adaptado);
    expect(r.fallos).toEqual([]);
    expect(r.emparejadas).toBe(35);
    expect(r14.fallos).toEqual([]);
  });

  it("la misma geometría que el DWG 2000, bit a bit (criterio 2)", () => {
    const d15 = leerDwg(muestra("sample_AC1015.dwg"));
    const geo = (d: Dxf) => d.entidades.map((e) => [e.tipo, texto(e, 5), ...e.valores.slice(2)].join(" "));
    expect(geo(r14)).toEqual(geo(d15));
  });
});

describe("lo que no se lee", () => {
  it("las versiones de DW3 y DW5 dicen cómo guardarlo", () => {
    for (const v of ["AC1018", "AC1021", "AC1024", "AC1027", "AC1032"]) {
      const b = muestra(`sample_${v}.dwg`);
      expect(esDwg(b)).toBe(true);
      expect(() => leerDwg(b)).toThrow(/Todavía no se leen los DWG/);
    }
  });

  it("antes de R13 y lo que no es un DWG", () => {
    const b = new TextEncoder().encode("AC1009" + "\0".repeat(100));
    expect(() => leerDwg(b)).toThrow(/antes de R13/);
    expect(() => leerDwg(new TextEncoder().encode("  0\nSECTION\n"))).toThrow(ErrorDxf);
    expect(esDwg(new TextEncoder().encode("  0\nSECTION\n"))).toBe(false);
  });
});

describe("robustez (criterio 4)", () => {
  const original = muestra("sample_AC1015.dwg");

  /** Lee y da "ok" o el mensaje de un ErrorDxf; cualquier otra excepción hace fallar la prueba. */
  const intentar = (b: Uint8Array): string => {
    try {
      leerDwg(b);
      return "ok";
    } catch (e) {
      if (e instanceof ErrorDxf) return e.message;
      throw e;
    }
  };

  it("cortado en cualquier sitio: un ErrorDxf, nunca otra cosa", () => {
    for (const fraccion of [0.0001, 0.001, 0.01, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const r = intentar(original.subarray(0, Math.floor(original.length * fraccion)));
      expect(r).not.toBe("ok");
    }
  });

  it("bytes cambiados al azar: o lo dice (ErrorDxf o un objeto en fallos), o sale lo mismo que sin cambiar", () => {
    // Lo que no puede pasar es un dibujo distinto sin aviso: lo impiden los CRC de la cabecera del
    // fichero, de la de variables, de cada trozo del mapa y de cada objeto.
    const firma = (d: Dxf) => JSON.stringify([d.insunits, d.capas, d.entidades]);
    const bien = firma(leerDwg(original));
    let semilla = 12345;
    const azar = () => {
      semilla = (semilla * 1103515245 + 12345) >>> 0;
      return semilla / 2 ** 32;
    };
    const t0 = performance.now();
    let avisados = 0;
    for (let k = 0; k < 300; k++) {
      const b = original.slice();
      const n = 1 + Math.floor(azar() * 4);
      // Un tercio de las veces, en los primeros 64 KB (cabecera del fichero, de variables y el mapa)
      const zona = k % 3 === 0 ? Math.min(65536, b.length) : b.length;
      for (let i = 0; i < n; i++) b[Math.floor(azar() * zona)] ^= 1 + Math.floor(azar() * 255);
      try {
        const d = leerDwg(b);
        if (d.fallos.length > 0) avisados++;
        else expect(firma(d)).toBe(bien);
      } catch (e) {
        if (!(e instanceof ErrorDxf)) throw e;
        avisados++;
      }
    }
    expect(avisados).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(60_000);
  });

  it("un byte de una LINE cambiado: esa LINE va a fallos y las demás salen igual", () => {
    const d0 = leerDwg(original);
    const o = d0.posiciones.get(0x6a1)!;
    expect(o).toBeGreaterThan(0);
    const b = original.slice();
    b[o + 12]! ^= 0x10; // dentro de sus datos (el tamaño MS ocupa 2 bytes)
    const d = leerDwg(b);
    expect(d.fallos.map((f) => f.handle)).toEqual(["6A1"]);
    expect(d.entidades.map((e) => texto(e, 5))).not.toContain("6A1");
    expect(d.entidades.length).toBe(d0.entidades.length - 1);
  });
});
