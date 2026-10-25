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
});
