/**
 * El lector de DXF frente a ezdxf 1.4.5 (V2c-4, `docs/fem3d/dibujo.md` §10.4, criterio 1). Los DXF
 * sintéticos y lo que dice ezdxf de ellos, en `__fixtures__/` (`validacion/v2c4/oraculo_dxf.py
 * generar`). La comparación está en `compararConEzdxf`, que usa también `validacion/v2c4/vivienda.ts`
 * con el DXF del cliente.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosSin, dibujoDxf, PASO_CURVA, textoMtext, textoPlano } from "./aplanar.ts";
import { compararConEzdxf, type OraculoEzdxf } from "./comparar.ts";
import { ErrorDxf, leerDxf } from "./lector.ts";

const fixture = (n: string) => new URL(`./__fixtures__/${n}`, import.meta.url);
const leer = (n: string) => new Uint8Array(readFileSync(fixture(n)));
const oraculo = (n: string) => JSON.parse(readFileSync(fixture(`${n}.ezdxf.json`), "utf8")) as OraculoEzdxf;

describe("lector de DXF frente a ezdxf", () => {
  for (const n of ["basico", "bloques", "ocs", "r12", "cotas"]) {
    it(n, () => {
      const d = dibujoDxf(leer(`${n}.dxf`));
      const r = compararConEzdxf(d, oraculo(n));
      expect(r.fallos).toEqual([]);
      expect(r.segmentos).toBeGreaterThan(0);
    });
  }

  it("los doubles del fichero, sin transformar, salen tal cual", () => {
    const d = dibujoDxf(leer("basico.dxf"));
    const xs = Array.from(d.lineas);
    expect(xs).toContain(-5.750000000007275);
    expect(xs).toContain(7.000000000003);
    expect(Array.from(dibujoDxf(leer("r12.dxf")).lineas)).toContain(3.000000000000004);
  });

  it("la codificación: UTF-8 desde 2007 y la página de códigos antes", () => {
    expect(leerDxf(leer("basico.dxf")).codificacion).toBe("utf-8");
    const r12 = dibujoDxf(leer("r12.dxf"));
    expect(r12.codificacion).toBe("windows-1252");
    expect(r12.textos.map((t) => t.texto)).toContain("Año de la reforma: niño");
  });

  it("capas apagadas y congeladas, ocultas; lo que no se lee, contado", () => {
    const d = dibujoDxf(leer("basico.dxf"));
    const oculta = (n: string) => d.capas.find((c) => c.nombre === n)?.oculta;
    expect(oculta("APAGADA")).toBe(true);
    expect(oculta("CONGELADA")).toBe(true);
    expect(oculta("0")).toBe(false);
    expect(d.ignoradas).toEqual({ HATCH: 1, XLINE: 1 });
    // La línea del espacio papel no está
    expect(Array.from(d.lineas)).not.toContain(100);
  });

  it("insunits y extensión", () => {
    const d = dibujoDxf(leer("bloques.dxf"));
    expect(d.insunits).toBe(6);
    expect(d.extension).not.toBeNull();
  });

  it("rechaza el DXF binario, el DWG y lo que no es un DXF", () => {
    const b = new TextEncoder().encode("AutoCAD Binary DXF\r\n\u001a\u0000");
    expect(() => leerDxf(b)).toThrow(ErrorDxf);
    expect(() => leerDxf(new TextEncoder().encode("AC1032\u0000\u0000"))).toThrow(/DWG/);
    expect(() => leerDxf(new TextEncoder().encode("hola\nmundo\n"))).toThrow(ErrorDxf);
  });
});

describe("piezas del lector", () => {
  it("coseno y seno exactos en los múltiplos de 90°", () => {
    expect(cosSin(90)).toEqual([0, 1]);
    expect(cosSin(-90)).toEqual([0, -1]);
    expect(cosSin(540)).toEqual([-1, 0]);
  });

  it("textos de TEXT y de MTEXT", () => {
    expect(textoPlano("%%c12 a 30%%d %%p0,5 100%%%")).toBe("Ø12 a 30° ±0,5 100%");
    // ezdxf no resuelve \U+ y apila 3^4 como «3r»: esto es lo que escribe AutoCAD
    expect(textoMtext("{\\fArial|b1;Salón}\\P\\H0.5x;cocina \\S1/2; y \\S3^4; \\U+00E1 \\~fin")).toBe("Salón\ncocina 1/2 y 3^4 á  fin");
  });

  it("un arco, en cuerdas de 5° como mucho, con los extremos exactos", () => {
    const dxf = ["0", "SECTION", "2", "ENTITIES", "0", "ARC", "8", "0", "10", "1", "20", "2", "30", "0", "40", "3", "50", "0", "51", "90", "0", "ENDSEC", "0", "EOF", ""].join("\n");
    const d = dibujoDxf(new TextEncoder().encode(dxf));
    expect(d.curvas.length / 4).toBe(Math.ceil(90 / PASO_CURVA));
    for (let i = 0; i < d.curvas.length; i += 4) {
      const l = Math.hypot(d.curvas[i + 2]! - d.curvas[i]!, d.curvas[i + 3]! - d.curvas[i + 1]!);
      expect(l).toBeLessThan(2 * 3 * Math.sin((PASO_CURVA * Math.PI) / 360) + 1e-12);
    }
    expect([d.curvas[0], d.curvas[1]]).toEqual([4, 2]);
    expect([d.curvas.at(-2), d.curvas.at(-1)]).toEqual([1, 5]);
  });
});
