/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9, criterios 12 y 13): proponer una zapata.
 *
 * Lo propuesto cumple, y con cualquiera de sus puestos uno menos (el lado, el canto, cada parrilla)
 * no; la posición (linderos, centradoras) y el hormigón del proyecto se quedan; es determinista. Con
 * demandas escritas a mano, de una zapata de 600 a 1 100 kN con momentos en las dos direcciones.
 */
import { describe, expect, it } from "vitest";
import type { CargaZapata } from "../demandas/zapatas.ts";
import { sintetica } from "../../../validacion/co/modelosZapatas.ts";
import { comprobarZapata, datosZapata, type ZapataCompleta } from "../comprobar/zapatas.ts";
import { CANTOS, LADOS, proponerZapata, tablaBarrasZapata } from "./zapatas.ts";

const carga = (comb: string, situacion: CargaZapata["situacion"], N: number, Mx: number, My: number, Hx = 0, Hy = 0): CargaZapata => ({ comb, situacion, N, Mx, My, Hx, Hy });
const GEO = [carga("GEO-1", "GEO", 600, 30, -45, 12, 5), carga("GEO-2", "GEO", 420, -60, 20, -18, 9), carga("GEO-3", "GEO", 800, 5, 80, 25, 0)];
const ELU = [carga("ELU-1", "ELU-PT", 850, 45, -70, 18, 8), carga("ELU-2", "ELU-PT", 600, -90, 30, -27, 14), carga("ELU-3", "ELU-PT", 1100, 8, 120, 38, 0)];
const DATOS = datosZapata(25, { recubrimientoZapatas: 50 }, { tensionAdmisible: 200, tierras: 0.5 });

describe("CO5: proponer una zapata", () => {
  const barras = tablaBarrasZapata();

  it("la tabla de barras, de menos a más acero por metro", () => {
    const a = barras.map((b) => (Math.PI * b.diametro ** 2) / 4 / b.separacion);
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThanOrEqual(a[i - 1]! - 1e-12);
    expect(LADOS[0]).toBe(0.8);
    expect(CANTOS[0]).toBe(0.4);
    expect(LADOS.at(-1)).toBe(8);
  });

  for (const [nombre, linderos] of [["centrada", []], ["medianera", ["-x"]], ["esquina", ["+x", "-y"]]] as const) {
    it(`${nombre}: cumple, y un puesto menos en cualquier cosa, no`, () => {
      const D = sintetica(GEO, ELU, { cx: 0.5, cy: 0.3 });
      const previa = { ...(linderos.length ? { linderos: [...linderos] } : {}), material: "H" };
      const p = proponerZapata(D, previa, DATOS);
      expect(p.motivo).toBeUndefined();
      const z = p.zapata!;
      expect(z.linderos ?? []).toEqual(linderos);
      expect(z.material).toBe("H");
      expect(z.B).toBe(z.L);
      expect(comprobarZapata(D, z, DATOS).cumple).toBe(true);
      // Un puesto menos: el lado, el canto, cada dirección de la parrilla inferior
      const menos: ZapataCompleta[] = [];
      const il = LADOS.indexOf(z.B);
      if (il > 0 && LADOS[il - 1]! >= 0.5 + 0.3) menos.push({ ...z, B: LADOS[il - 1]!, L: LADOS[il - 1]! });
      const ih = CANTOS.indexOf(z.h);
      if (ih > 0) menos.push({ ...z, h: CANTOS[ih - 1]! });
      for (const k of ["x", "y"] as const) {
        const ib = barras.findIndex((b) => b.diametro === z.inferior[k].diametro && b.separacion === z.inferior[k].separacion);
        if (ib > 0) menos.push({ ...z, inferior: { ...z.inferior, [k]: barras[ib - 1]! } });
      }
      expect(menos.length).toBeGreaterThan(0);
      for (const m of menos) expect(comprobarZapata(D, m, DATOS).cumple, JSON.stringify(m)).toBe(false);
      // Determinista
      expect(proponerZapata(D, previa, DATOS).zapata).toEqual(z);
    });
  }

  it("sin la tensión admisible, no hay propuesta", () => {
    const p = proponerZapata(sintetica(GEO, ELU), undefined, datosZapata(25, undefined, undefined));
    expect(p.zapata).toBeNull();
    expect(p.motivo).toContain("tensión admisible");
  });

  it("con un pilar que tira de la zapata, se propone con las demás y el arranque queda pendiente", () => {
    const D = sintetica([...GEO, carga("GEO-4", "GEO", -20, 0, 0)], ELU);
    const p = proponerZapata(D, undefined, DATOS);
    expect(p.zapata).not.toBeNull();
    expect(p.comprobacion.cumple).toBe(false);
    expect(p.comprobacion.pendientes.every((x) => x.arranque)).toBe(true);
  });

  it("si no cabe en la tabla, no hay propuesta y dice por qué", () => {
    const p = proponerZapata(sintetica([carga("GEO-1", "GEO", 60000, 0, 0)], [carga("ELU-1", "ELU-PT", 80000, 0, 0)]), undefined, DATOS);
    expect(p.zapata).toBeNull();
    expect(p.motivo).toContain("terreno");
  });
});
