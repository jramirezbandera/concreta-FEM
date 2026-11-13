/**
 * El catálogo de perfiles (GE-d) copiado de Concreta, comparado con la geometría de la sección: dos
 * alas bf×tf y un alma (h − 2·tf)×tw, sin los acuerdos. Los acuerdos suman área e inercia, así que
 * el catálogo queda algo por encima de la geometría y nunca muy lejos: así se ve una cifra mal
 * copiada o desplazada de fila (como los incidentes que cuenta `steelProfiles.ts`).
 */
import { describe, expect, it } from "vitest";
import { enCatalogo, perfilDeCatalogo, PERFILES, SERIES_PERFILES } from "./perfiles.ts";

describe("catálogo de perfiles", () => {
  it("las cuatro series, con sus tamaños, y ids únicos", () => {
    expect(SERIES_PERFILES.map((s) => PERFILES.filter((p) => p.serie === s).length)).toEqual([18, 24, 24, 21]);
    expect(new Set(PERFILES.map((p) => p.id)).size).toBe(PERFILES.length);
    expect(perfilDeCatalogo("HEB", 200)?.perfil).toEqual({ A: 78.1, Iy: 5696, Iz: 2003, It: 59.3, h: 200, b: 200, tf: 15, tw: 9 });
    expect(enCatalogo(perfilDeCatalogo("IPN", 300)!.perfil)?.id).toBe("IPN300");
  });

  it.each(PERFILES.map((p) => [p.id, p] as const))("%s frente a su geometría", (_id, { perfil: p }) => {
    const cm = 0.1;
    const [h, b, tf, tw] = [p.h * cm, p.b * cm, p.tf * cm, p.tw * cm];
    const hw = h - 2 * tf;
    const A = 2 * b * tf + hw * tw;
    const Iy = (b * h ** 3 - (b - tw) * hw ** 3) / 12;
    const Iz = (2 * tf * b ** 3 + hw * tw ** 3) / 12;
    // Los acuerdos: el IPN lleva alas inclinadas (tf es el espesor medio), y se le deja más margen
    const [min, max] = p.h > 0 && _id.startsWith("IPN") ? [0.93, 1.12] : [0.99, 1.12];
    expect(p.A / A).toBeGreaterThan(min);
    expect(p.A / A).toBeLessThan(max);
    expect(p.Iy / Iy).toBeGreaterThan(min);
    expect(p.Iy / Iy).toBeLessThan(max);
    expect(p.Iz / Iz).toBeGreaterThan(_id.startsWith("IPN") ? 0.8 : min);
    expect(p.Iz / Iz).toBeLessThan(_id.startsWith("IPN") ? 1.3 : max);
    expect(p.It).toBeGreaterThan(0);
  });

  /**
   * A2-44 (`docs/fem3d/auditoria-2.md` §11.2): el It frente a la fórmula de las secciones laminadas en I
   * de alas paralelas (SCI P385, la del catálogo de ArcelorMittal y de British Steel), con el radio de
   * acuerdo r de cada perfil. La tabla es la de Concreta (cotejada con eurocodeapplied.com) y queda por
   * debajo de la fórmula en los HEA (−0,9…−4,1 %) y los HEB (−0,1…−2,3 %); British Steel da la fórmula a
   * ±0,5 % desde 300. Para el motor, la rigidez a torsión de una barra de acero un 1–4 % menor no se nota;
   * para el vuelco lateral de Concreta, queda del lado seguro: no se cambia. Con ±5 %, una cifra mal
   * copiada o una fila desplazada (de un tamaño al siguiente, el It cambia un 15–50 %) sale aquí.
   */
  const RADIOS: Record<string, Record<number, number>> = {
    IPE: { 80: 5, 100: 7, 120: 7, 140: 7, 160: 9, 180: 9, 200: 12, 220: 12, 240: 15, 270: 15, 300: 15, 330: 18, 360: 18, 400: 21, 450: 21, 500: 21, 550: 24, 600: 24 },
    HEA: { 100: 12, 120: 12, 140: 12, 160: 15, 180: 15, 200: 18, 220: 18, 240: 21, 260: 24, 280: 24, 300: 27, 320: 27, 340: 27, 360: 27, 400: 27, 450: 27, 500: 27, 550: 27, 600: 27, 650: 27, 700: 27, 800: 30, 900: 30, 1000: 30 },
    HEB: { 100: 12, 120: 12, 140: 12, 160: 15, 180: 15, 200: 18, 220: 18, 240: 21, 260: 24, 280: 24, 300: 27, 320: 27, 340: 27, 360: 27, 400: 27, 450: 27, 500: 27, 550: 27, 600: 27, 650: 27, 700: 27, 800: 30, 900: 30, 1000: 30 },
  };
  const itFormula = (h: number, b: number, tf: number, tw: number, r: number) => {
    const a1 = -0.042 + (0.2204 * tw) / tf + (0.1355 * r) / tf - (0.0865 * r * tw) / tf ** 2 - (0.0725 * tw ** 2) / tf ** 2;
    const D1 = ((tf + r) ** 2 + (r + 0.25 * tw) * tw) / (2 * r + tf);
    return ((2 / 3) * (b - 0.63 * tf) * tf ** 3 + (1 / 3) * (h - 2 * tf) * tw ** 3 + 2 * a1 * D1 ** 4) / 1e4;
  };
  it.each(PERFILES.filter((p) => p.serie !== "IPN").map((p) => [p.id, p] as const))("%s: It a ±5 % de la fórmula de SCI P385", (_id, p) => {
    const r = RADIOS[p.serie]![p.tamano]!;
    expect(r).toBeGreaterThan(0);
    const { h, b, tf, tw, It } = p.perfil;
    expect(Math.abs(It / itFormula(h, b, tf, tw, r) - 1)).toBeLessThan(0.05);
  });
  it("la fórmula, frente a British Steel (HE 300 A 87,8; HE 500 B 548; HE 1000 A 835 cm⁴)", () => {
    expect(itFormula(290, 300, 14, 8.5, 27)).toBeCloseTo(87.8, 0);
    expect(itFormula(500, 300, 28, 14.5, 27)).toBeCloseTo(548, -1);
    expect(itFormula(990, 300, 31, 16.5, 30)).toBeCloseTo(835, -1);
  });
});
