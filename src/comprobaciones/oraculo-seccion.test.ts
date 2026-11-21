/**
 * Fase CO, criterio 11 (`docs/fem3d/comprobaciones.md` §7): el módulo de pilares y la flexotracción
 * frente a un integrador de la sección que no es de Concreta (`validacion/co/oraculo_seccion.py`:
 * Python sin dependencias, hormigón por Simpson, áreas de barra y fcd sin redondear).
 *
 * El JSON congelado lo escribe ese script; aquí no hace falta Python.
 * - En compresión: el MRd de cada plano (o el de la sección circular) y NRd,máx del módulo.
 * - En tracción (y con menos de 1 kN de compresión): la fila de flexotracción con el momento
 *   resistente del oráculo como demanda da 1, del lado seguro.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DemandasTramo } from "./demandas/pilares.ts";
import { comprobarTramo, entradaModulo, type ArmadoPilar } from "./comprobar/pilares.ts";
import { calcRCColumn } from "./concreta/lib/calculations/rcColumns.ts";

interface Caso {
  id: string;
  forma: "rectangular" | "circular";
  b?: number;
  h?: number;
  D?: number;
  fck: number;
  fyk: number;
  recubrimiento: number;
  cercos: number;
  esquinas?: number;
  caraB?: [number, number];
  caraH?: [number, number];
  anillo?: [number, number];
  NRdMax: number;
  NtRd: number;
  axiles: { N: number; MRdy?: number; MRdz?: number; MRd?: number; MRdy_pivoteA?: number }[];
}

const { casos } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "validacion", "co", "oraculo-seccion.json"), "utf8")) as { casos: Caso[] };

const armado = (c: Caso): ArmadoPilar => ({
  recubrimiento: c.recubrimiento,
  fyk: c.fyk,
  cercos: { diametro: c.cercos, separacion: 100 },
  ...(c.forma === "rectangular" ? { esquinas: c.esquinas!, caraB: { n: c.caraB![0], diametro: c.caraB![1] }, caraH: { n: c.caraH![0], diametro: c.caraH![1] } } : { anillo: { n: c.anillo![0], diametro: c.anillo![1] } }),
});

/** Un tramo con una sola demanda, para la flexotracción. */
function tramo(c: Caso, esfuerzos: number[]): DemandasTramo {
  const material = { id: "HA", tipo: "hormigon" as const, fck: c.fck };
  return {
    planta: "P1",
    plantaBase: "P0",
    seccion: { id: "s", forma: "rectangular", b: c.b! / 1000, h: c.h! / 1000, material: "HA" },
    material,
    giro: 0,
    longitud: 3,
    longitudLibre: 2.7,
    base: { s: 0, demandas: [{ comb: "oráculo", esfuerzos }] },
    cabeza: { s: 2.7, demandas: [] },
  };
}

describe("CO, criterio 11: la sección frente a un integrador independiente", () => {
  let peor = 0;
  const dentro = (valor: number, referencia: number, tolerancia: number, que: string) => {
    const e = Math.abs(valor / referencia - 1);
    peor = Math.max(peor, e);
    expect(e, `${que}: ${valor} frente a ${referencia}`).toBeLessThan(tolerancia);
  };

  it("en compresión, el MRd de cada plano y NRd,máx del módulo, a menos del 1 %", () => {
    let n = 0;
    for (const c of casos) {
      for (const a of c.axiles.filter((x) => x.N >= 1)) {
        const geo = c.forma === "rectangular" ? { sectionType: "rectangular" as const, b: c.b!, h: c.h! } : { sectionType: "circular" as const, b: c.D!, h: c.D!, D: c.D! };
        const r = calcRCColumn(entradaModulo({ ...geo, fck: c.fck, Nd: a.N, MEdy: 1, MEdz: 1, L: 0.5, beta: 1 }, armado(c)));
        expect(r.valid, `${c.id}: ${r.error ?? ""}`).toBe(true);
        dentro(r.NRd_max, c.NRdMax, 0.005, `${c.id} NRd,máx`);
        if (c.forma === "rectangular") {
          dentro(r.MRdy, a.MRdy!, 0.01, `${c.id} N = ${a.N}: MRdy`);
          dentro(r.MRdz, a.MRdz!, 0.01, `${c.id} N = ${a.N}: MRdz`);
          // Limitar el acero al 1 % (pivote A) no cambia el momento resistente en más de un 1 %
          expect(Math.abs(a.MRdy_pivoteA! / a.MRdy! - 1)).toBeLessThan(0.01);
        } else dentro(r.MRd!, a.MRd!, 0.015, `${c.id} N = ${a.N}: MRd`);
        n++;
      }
    }
    expect(n).toBe(4 * 4 + 3 + 2 * 4);
    expect(peor).toBeGreaterThan(0);
  });

  it("en tracción, la flexotracción con el momento resistente del oráculo da 1, del lado seguro", () => {
    let n = 0;
    for (const c of casos.filter((x) => x.forma === "rectangular")) {
      for (const a of c.axiles.filter((x) => x.N < 1)) {
        // En cada plano por separado y repartido entre los dos (la suma de 5.8.9 con a = 1)
        for (const [fy, fz] of [[1, 0], [0, 1], [0.5, 0.5]] as const) {
          const r = comprobarTramo(tramo(c, [-a.N, 0, 0, 0, fy * a.MRdy!, fz * a.MRdz!]), armado(c));
          expect(r.pendientes).toEqual([]);
          const u = r.filas.find((f) => f.id === "flexotraccion")!.aprovechamiento;
          expect(u, `${c.id} N = ${a.N} (${fy}, ${fz})`).toBeGreaterThan(0.99);
          expect(u, `${c.id} N = ${a.N} (${fy}, ${fz})`).toBeLessThan(1.04);
          if (a.N < 0) expect(r.filas.find((f) => f.id === "traccion")!.aprovechamiento / (-a.N / c.NtRd) - 1).toBeLessThan(0.005);
          n++;
        }
      }
    }
    expect(n).toBe(3 * (4 * 3 + 2));
  });
});
