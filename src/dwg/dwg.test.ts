/**
 * El lector de DWG frente a AutoCAD (fase DW, `docs/fem3d/dwg.md` §5). Las muestras de ACadSharp
 * son el mismo dibujo guardado por AutoCAD en cada versión, con su DXF ASCII al lado; se traen con
 * `bun validacion/dwg/muestras.ts` (DW-d). Sin ellas, la prueba falla diciendo cómo traerlas.
 *
 * Tramos DW1 a DW3: R14, 2000, 2004, 2010, 2013 y 2018, con las capas, los bloques y todo lo que dibuja
 * `aplanar.ts`.
 */
import { describe, expect, it } from "vitest";
import { muestra } from "../../validacion/dwg/muestras.ts";
import { aplanarDxf } from "../dxf/aplanar.ts";
import { type Dxf, type Entidad, ErrorDxf, leerDxf, texto } from "../dxf/lector.ts";
import { compararDwgConDxf } from "./comparar.ts";
import { esDwg, leerDwg } from "./lector.ts";

/** Todas las entidades (modelo, bloques e hijos) por bloque y handle. */
function todas(d: Dxf): Map<string, Entidad> {
  const m = new Map<string, Entidad>();
  const poner = (l: Entidad[], b: string) =>
    l.forEach((e) => {
      m.set(`${b}:${texto(e, 5)}`, e);
      for (const h of e.hijos ?? []) m.set(`${b}:${texto(h, 5)}`, h);
    });
  poner(d.entidades, "");
  for (const [n, b] of d.bloques) poner(b.entidades, n.toUpperCase());
  return m;
}

/** Una variable de la cabecera del DXF (los tres valores de un punto). */
function variableDxf(n: string, nombre: string): number[] {
  const t = new TextDecoder().decode(muestra(n));
  const i = t.indexOf(`\n${nombre}\n`);
  const l = t.slice(i).split("\n");
  return [Number(l[3]), Number(l[5]), Number(l[7])];
}

/**
 * Las diferencias conocidas con el DXF de AutoCAD (`dwg.md` §10.3 y §11.3), con su motivo: se quitan
 * de los dos lados y lo demás tiene que salir igual.
 */
const LEADER = ["512", "DW2-4: el gancho del LEADER no está en el DWG; AutoCAD lo añade al escribir el DXF con el DIMASZ del estilo"] as const;
const SPLINE = ["434", "DW3-5: desde 2013, una SPLINE por ajuste sólo guarda el ajuste; los puntos de control del DXF los calcula AutoCAD"] as const;
const conocidas = (v: string) => new Map<string, string>(Number(v.slice(2)) >= 1027 ? [LEADER, SPLINE] : [LEADER]);

/** Las versiones con su DXF de AutoCAD al lado (la de R14 no lo tiene; la de 2007 es de DW5). */
const CON_DXF = ["AC1015", "AC1018", "AC1024", "AC1027", "AC1032"];

for (const v of CON_DXF)
  describe(`DWG ${v} frente al DXF de AutoCAD (criterio 1)`, () => {
    const dwg = leerDwg(muestra(`sample_${v}.dwg`));
    const dxf = leerDxf(muestra(`sample_${v}_ascii.dxf`));

    it("lo dibujado: el dibujo entero y cada entidad por su handle (modelo y bloques)", () => {
      const r = compararDwgConDxf(dwg, dxf, 1e-9, conocidas(v));
      expect(r.fallos).toEqual([]);
      expect(r.emparejadas).toBe(Number(v.slice(2)) >= 1027 ? 333 : 334);
      // Lo que queda es el redondeo del DXF (16 cifras) en coordenadas de hasta ~1850
      expect(r.errorMaximo).toBeLessThan(1e-11);
      // DW2-5: el bloque de la tabla, AutoCAD lo regenera con otros handles al escribir el DXF
      expect(r.regenerados).toEqual(["bloque «*U25»"]);
      expect(r.huerfanos).toEqual([]);
    });

    it("las mismas entidades en el espacio modelo y los mismos bloques", () => {
      expect(dwg.entidades.length).toBe(dxf.entidades.length);
      expect(dwg.entidades.length).toBe(163);
      expect([...dwg.bloques.keys()].sort()).toEqual([...dxf.bloques.keys()].sort());
      expect(dwg.bloques.size).toBe(27);
    });

    it("lo no leído por aplanar, igual", () => {
      expect(aplanarDxf(dwg).ignoradas).toEqual(aplanarDxf(dxf).ignoradas);
    });

    it("la cabecera: $INSUNITS, $EXTMIN y $EXTMAX", () => {
      expect(dwg.insunits).toBe(1);
      for (const [nombre, x0] of [
        ["$EXTMIN", dwg.cabeceraDwg.extmin],
        ["$EXTMAX", dwg.cabeceraDwg.extmax],
      ] as const) {
        const x = variableDxf(`sample_${v}_ascii.dxf`, nombre);
        for (let i = 0; i < 3; i++) expect(Math.abs(x0[i]! - x[i]!)).toBeLessThanOrEqual(1e-15 * Math.max(1, Math.abs(x[i]!)));
      }
    });

    it("se leen todos los objetos y la página de códigos es la del dibujo", () => {
      expect(dwg.fallos).toEqual([]);
      expect(dwg.codificacion).toBe("windows-1252");
      expect(dwg.version).toBe(v);
    });
  });

describe("los anónimos (DW2-2)", () => {
  it("en 2000, el de un bloque dinámico, por su posición en la tabla, no por el nombre de su BLOCK", () => {
    const dwg = leerDwg(muestra("sample_AC1015.dwg"));
    expect(dwg.bloques.has("*U17")).toBe(true);
    expect(dwg.bloques.has("my-dynamic-block")).toBe(false);
  });
});

describe("las versiones de 2004 en adelante frente al DWG 2000 (criterio 2)", () => {
  const d15 = leerDwg(muestra("sample_AC1015.dwg"));
  /** La geometría: los pares sin textos ni nombres (1, 2, 3, 8), que AutoCAD cambia al guardar en otra versión (DW3-9). */
  const geometria = (e: Entidad) => e.codigos.map((c, i) => ([1, 2, 3, 8].includes(c) ? `${c}` : `${c}=${e.valores[i]}`)).join(" ");
  for (const v of ["AC1018", "AC1024", "AC1027", "AC1032"])
    it(`${v}: lo que está en los dos, bit a bit; lo que no, en los anónimos regenerados`, () => {
      const a = todas(leerDwg(muestra(`sample_${v}.dwg`)));
      const b = todas(d15);
      let comunes = 0;
      const faltan = new Set<string>();
      for (const [k, e] of b) {
        const x = a.get(k);
        if (!x) {
          faltan.add(k.split(":")[0]!);
          continue;
        }
        if (Number(v.slice(2)) >= 1027 && k === ":434") continue; // DW3-5
        if (v === "AC1032" && k === ":79D") continue; // DW3-6: en 2018, un atributo de varias líneas; en 2000, de una
        comunes++;
        expect(x.tipo).toBe(e.tipo);
        expect(geometria(x)).toBe(geometria(e));
      }
      expect(comunes).toBeGreaterThan(340);
      // Desde 2010, el anónimo del bloque dinámico se llama como éste también en el DXF de AutoCAD
      expect([...faltan].sort()).toEqual(v === "AC1018" ? ["*U25"] : ["*U17", "*U25"]);
    });
});

describe("DWG R14 (AC1014) frente al DWG 2000 (criterio 2)", () => {
  const r14 = leerDwg(muestra("sample_AC1014.dwg"));
  const d15 = leerDwg(muestra("sample_AC1015.dwg"));

  /** Los pares sin los nombres (capa y bloque), que R14 escribe en mayúsculas (DW1-2). */
  const pares = (e: Entidad) => e.codigos.map((c, i) => (c === 8 || c === 2 ? `${c}` : `${c}=${e.valores[i]}`)).join(" ");

  it("lo que está en los dos, bit a bit; lo que no, sólo en los anónimos que AutoCAD regenera (DW2-5)", () => {
    expect(r14.fallos).toEqual([]);
    const a = todas(r14);
    const b = todas(d15);
    let comunes = 0;
    const faltan = new Set<string>();
    for (const [k, e] of b) {
      const x = a.get(k);
      if (!x) {
        faltan.add(k.split(":")[0]!);
        continue;
      }
      comunes++;
      expect(x.tipo).toBe(e.tipo);
      expect(pares(x)).toBe(pares(e));
    }
    expect(comunes).toBe(318); // de 351: las otras 33 están en los bloques regenerados
    expect([...faltan].sort()).toEqual(["*D4", "*D5", "*D8", "*U25"]);
  });

  it("R14 no guarda $INSUNITS y escribe los nombres en mayúsculas (DW1-2)", () => {
    expect(r14.insunits).toBeNull();
    expect(r14.capas.map((c) => c.nombre)).toEqual(d15.capas.map((c) => c.nombre.toUpperCase().replace(/[^A-Z0-9_$-]/g, "_")));
  });

  it("LWPOLYLINE y HATCH, que en R14 son clases, se leen como en 2000 (DW2-3)", () => {
    const tipos = (d: Dxf) => d.entidades.map((e) => e.tipo).join(" ");
    expect(tipos(r14)).toBe(tipos(d15));
  });
});

describe("lo que no se lee", () => {
  it("la 2007 (DW5) dice cómo guardarlo", () => {
    const b = muestra("sample_AC1021.dwg");
    expect(esDwg(b)).toBe(true);
    expect(() => leerDwg(b)).toThrow(/Todavía no se leen los DWG 2007/);
  });

  it("antes de R13 y lo que no es un DWG", () => {
    const b = new TextEncoder().encode("AC1009" + "\0".repeat(100));
    expect(() => leerDwg(b)).toThrow(/antes de R13/);
    expect(() => leerDwg(new TextEncoder().encode("  0\nSECTION\n"))).toThrow(ErrorDxf);
    expect(esDwg(new TextEncoder().encode("  0\nSECTION\n"))).toBe(false);
  });
});

describe("robustez en 2018 (criterio 4)", () => {
  it("bytes cambiados al azar: o lo dice o sale lo mismo (sumas de las páginas, CRC32 de la cabecera, CRC de cada objeto)", () => {
    const original = muestra("sample_AC1032.dwg");
    const firma = (d: Dxf) => JSON.stringify([d.insunits, d.capas, d.entidades]);
    const bien = firma(leerDwg(original));
    let semilla = 99;
    const azar = () => {
      semilla = (semilla * 1103515245 + 12345) >>> 0;
      return semilla / 2 ** 32;
    };
    let avisados = 0;
    for (let k = 0; k < 150; k++) {
      const b = original.slice();
      for (let i = 0, n = 1 + Math.floor(azar() * 4); i < n; i++) b[Math.floor(azar() * b.length)]! ^= 1 + Math.floor(azar() * 255);
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
