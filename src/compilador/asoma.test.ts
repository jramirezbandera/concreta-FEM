/**
 * Fase LV2, LV-8 (`docs/fem3d/refinamiento-vigas.md` §13): la malla junto a un pilar que asoma del
 * ancho de la viga que lo atraviesa.
 * - Lo que asoma más de ε_snap (un 30 × 50 bajo una viga de 30) va en tiras, cada una con la
 *   plantilla de pilar de F2/F3 contra el ancho: en la retícula al azar 1 (22 pilares que asoman),
 *   LV1 dejaba 24 cuadriláteros con el jacobiano por debajo de 0,2 (0,117) y LV2 no deja ninguno,
 *   con menos nudos.
 * - Con la huella tapada (un 40 × 40 bajo una de 30, o un 25 × 60 dentro de ella), la cara de franja
 *   acaba en la cara del ancho, no en la de la huella: sin extremos sueltos ni trozos dentro del
 *   ancho (retícula 4).
 * - El ancho es un trazo exacto y lo que la huella tiene a ≤ ε_snap de sus caras va sobre ellas: las
 *   caras siguen rectas aunque la viga acabe en un pilar circular (retícula 9) o en uno más ancho
 *   que ella con losa por el otro lado (retícula 3); antes se torcían hasta 5 cm.
 * - Cuando las tiras no caben en la rejilla (un hueco cerca), queda la malla de antes con el aviso
 *   `malla/pilar-asoma-sin-plantilla` (retícula 6).
 * Con `refinoEsquinas: false` nada cambia (lo comprueban las referencias congeladas).
 */
import { describe, expect, it } from "vitest";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { OpcionesCompilacion } from "./fisico.ts";

const compila = (semilla: number, op: OpcionesCompilacion) => valido(compilar(reticulaAleatoria(semilla), op));
const calidad = (c: ReturnType<typeof compila>) => c.diagnosticos.filter((d) => d.codigo === "malla/calidad");

describe("los pilares que asoman de su viga (LV-8)", () => {
  it("las tiras que asoman llevan plantilla: sin astillas y con menos nudos (retícula 1)", () => {
    const lv1 = compila(1, { refinoEsquinas: false });
    const lv2 = compila(1, { refinoEsquinas: true });
    expect(lv1.estadisticas.malla.jacobianoMin).toBeLessThan(0.15);
    expect(calidad(lv1)).toHaveLength(2);
    expect(calidad(lv2)).toEqual([]);
    expect(lv2.estadisticas.malla.jacobianoMin).toBeGreaterThanOrEqual(0.2);
    expect(lv2.modelo.nudos.length).toBeLessThan(lv1.modelo.nudos.length);
    expect(lv2.diagnosticos.filter((d) => d.codigo === "malla/pilar-asoma-sin-plantilla")).toEqual([]);
  });

  it("con la huella tapada, la cara de franja acaba en la cara del ancho (retícula 4)", () => {
    const lv1 = compila(4, { refinoEsquinas: false });
    const lv2 = compila(4, { refinoEsquinas: true });
    expect(calidad(lv1)).toHaveLength(1);
    expect(calidad(lv2)).toEqual([]);
    expect(lv2.estadisticas.malla.jacobianoMin).toBeGreaterThanOrEqual(0.3);
  });

  it("las caras del ancho siguen rectas aunque la viga acabe dentro de una huella (retículas 3 y 9)", () => {
    for (const s of [3, 9]) {
      const lv2 = compila(s, { refinoEsquinas: true });
      expect(calidad(lv2), `retícula ${s}`).toEqual([]);
      // Todos los nudos de las caras de X0 (b = 0,30 por su eje y = 0), exactamente a 0,15 del eje
      const enlaces = (lv2.modelo.restricciones ?? []).filter((r, k) => r.tipo === "enlace-rigido" && lv2.mapeo.restricciones[k]!.viga === "X0-N1");
      expect(enlaces.length, `retícula ${s}: los enlaces de X0`).toBeGreaterThan(0);
      for (const r of enlaces) for (const n of r.esclavos) expect(Math.abs(Math.abs(lv2.modelo.nudos[n]!.y) - 0.15), `retícula ${s}: nudo ${n}`).toBeLessThan(1e-9);
    }
  });

  it("cuando las tiras no caben en la rejilla, avisa y deja la malla de antes (retícula 6)", () => {
    const lv2 = compila(6, { refinoEsquinas: true });
    const av = lv2.diagnosticos.filter((d) => d.codigo === "malla/pilar-asoma-sin-plantilla");
    expect(av.length).toBeGreaterThanOrEqual(1);
    expect(av[0]!.severidad).toBe("aviso");
    expect(av[0]!.mensaje).toContain("P1-2");
    expect(av[0]!.mensaje).toContain("asoman del ancho");
    expect(calidad(lv2).length).toBeGreaterThanOrEqual(1);
  });
});
