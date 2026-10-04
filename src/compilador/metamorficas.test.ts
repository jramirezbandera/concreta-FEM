/**
 * Criterio 3 de C1: relaciones metamórficas del compilador sobre modelos físicos aleatorios
 * (`pruebas/fisicoAleatorio.ts`; las relaciones, en `pruebas/metamorficasFisicas.ts`):
 * 1. reordenar las listas: el mismo modelo analítico, bit a bit;
 * 2. trasladar y girar la planta (90° exacto y 37°): resultados transformados a 1e-9;
 * 3. un ruido de 1e-8 m (< ε_geom): la misma topología, sin avisos nuevos y resultados a 1e-6;
 * 4. un ruido de ±1,5 cm (< ε_snap) en las vigas: la misma topología, sólo con avisos de fusión;
 * 5. partir vigas en dos colineales (sin diafragma): los mismos desplazamientos y reacciones;
 * 6. invertir el sentido de las vigas: los mismos desplazamientos y los esfuerzos con el cambio
 *    de signo de Vz y Mz;
 * 7. partir una carga repartida en dos: el mismo resultado.
 */
import { describe, expect, it } from "vitest";
import { fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { planos, relacionInvertir, relacionOrden, relacionPartirCargas, relacionPartirVigas, relacionPlano, relacionRuido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";

const SEMILLAS = [1, 2, 5, 6, 9, 13, 14, 17, 21, 25, 29, 30];

describe("criterio 3 de C1: relaciones metamórficas del compilador", () => {
  it.each(SEMILLAS)("semilla %i: reordenar las listas da el mismo modelo analítico bit a bit", (s) => {
    expect(relacionOrden(fisicoAleatorio(s), s)).toBe(true);
  });

  it.each(SEMILLAS)("semilla %i: trasladar y girar la planta transforma los resultados (≤ 1e-9)", (s) => {
    for (const diafragma of [true, false]) {
      for (const { nombre, t } of planos()) {
        const e = relacionPlano(fisicoAleatorio(s, { diafragma }), t);
        expect(e.u, nombre).toBeLessThan(1e-9);
        expect(e.reacciones, nombre).toBeLessThan(1e-9);
        expect(e.barras, nombre).toBeLessThan(1e-9);
      }
    }
  });

  it.each(SEMILLAS)("semilla %i: un ruido de 1e-8 m (< ε_geom) no cambia la topología y los resultados quedan a 1e-6", (s) => {
    const f = fisicoAleatorio(s);
    const e = relacionRuido(f, s, 1e-8);
    expect(e.topologia).toBe(true);
    expect(e.codigos).toEqual(compilar(f).diagnosticos.map((d) => d.codigo));
    expect(e.u).toBeLessThan(1e-6);
  });

  it.each(SEMILLAS)("semilla %i: un ruido de ±1,5 cm (< ε_snap) en las vigas da la misma topología, con avisos de fusión", (s) => {
    const e = relacionRuido(fisicoAleatorio(s), s, 0.015, true);
    expect(e.topologia).toBe(true);
    for (const c of e.codigos) expect(c).toBe("topologia/fusion");
  });

  it.each(SEMILLAS)("semilla %i: partir vigas en dos colineales (sin diafragma) no cambia los desplazamientos", (s) => {
    const e = relacionPartirVigas(fisicoAleatorio(s, { diafragma: false }));
    expect(e.partidas).toBeGreaterThan(0);
    expect(e.u).toBeLessThan(1e-9);
    expect(e.reacciones).toBeLessThan(1e-9);
  });

  it.each(SEMILLAS)("semilla %i: invertir el sentido de las vigas: mismos desplazamientos; Vz y Mz cambian de signo", (s) => {
    const e = relacionInvertir(fisicoAleatorio(s));
    expect(e.u).toBeLessThan(1e-9);
    expect(e.barras).toBeLessThan(1e-9);
  });

  it.each(SEMILLAS)("semilla %i: partir cada carga repartida en dos da el mismo resultado", (s) => {
    expect(relacionPartirCargas(fisicoAleatorio(s))).toBeLessThan(1e-12);
  });
});
