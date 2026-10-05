/**
 * Criterios 1 y 2 de C2: oráculos.
 * 1. Placas de Navier de E3 descritas como modelo físico (losa con apoyos lineales): con la
 *    triangulación (sin rejilla), w en los nudos y M recuperado por SPR (lo que usan los mapas y las
 *    bandas) frente a la serie de Mindlin, como la rejilla de E3 y con orden ≈ 2; el valor bruto del
 *    centroide converge con orden 1 en sus cuadriláteros (C2-1): no es dato para comprobar. Con la
 *    rejilla alineada (H52), la malla es la de E3 y da sus mismos errores.
 * 2. La losa plana de H25 descrita como modelo físico (pilares, huellas y bandas) frente a la rejilla
 *    de E5: My y Vz de la banda de pilar y del pórtico en la cara (fuerzas nodales) y My en el vano
 *    (campos). La triangulación con h = 0,15 y la rejilla con h = 0,1, a ≤ 1 % de E5 con h = 0,075;
 *    la rejilla con h = 0,15, a ≤ 1 % de la de E5 con el mismo h.
 * 3. Plantillas de pilar (H52): la retícula con la losa enrasada con los pilares de fachada
 *    (`reticulaEnrasada`), toda en rejilla y con una plantilla por pilar con h = 0,75, frente a la
 *    triangulación fina (h = 0,2): reacciones de los pilares, flecha máxima y deriva.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { erroresNavierC2, erroresNavierRejilla } from "../../validacion/c2/navier.ts";
import { losaPlanaC2 } from "../../validacion/c2/losaPlana.ts";
import { reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { OpcionesCompilacion } from "./fisico.ts";
import { CASOS_NAVIER } from "../../validacion/e3/navier.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 1 de C2: placas de Navier como modelo físico", () => {
  for (const c of CASOS_NAVIER.slice(0, 2)) {
    it(`${c.nombre}: triangulación`, () => {
      const [a, b] = [erroresNavierC2(c, 0.25, false), erroresNavierC2(c, 0.125, false)];
      const rej = erroresNavierRejilla(c, 0.25);
      // h = 0,25: w y M (SPR) del centro a ≤ 0,5 %, como la rejilla de E3
      expect(a.w).toBeLessThan(0.005);
      expect(Math.abs(a.sprMxCentro)).toBeLessThan(0.005);
      expect(Math.abs(a.sprMyCentro)).toBeLessThan(0.005);
      // M (SPR) en el peor nudo del interior, como la rejilla (con un 25 % de margen)
      expect(a.sprMxInterior).toBeLessThan(1.25 * rej.sprMxInterior);
      expect(a.sprMyInterior).toBeLessThan(1.25 * rej.sprMyInterior);
      // Orden ≈ 2 en w y en M (SPR)
      for (const k of ["w", "sprMxInterior", "sprMyInterior"] as const) expect(Math.log2(a[k] / b[k]), k).toBeGreaterThan(1.7);
      // C2-1: el valor bruto del centroide converge con orden ~1
      expect(Math.log2(a.Mx / b.Mx)).toBeLessThan(1.3);
    });

    it(`${c.nombre}: rejilla alineada, la malla de E3`, () => {
      const [a, rej] = [erroresNavierC2(c, 0.25), erroresNavierRejilla(c, 0.25)];
      expect([a.nudos, a.laminas]).toEqual([rej.nudos, rej.laminas]);
      for (const k of ["w", "sprMx", "sprMy", "Mx", "My"] as const) expect(Math.abs(a[k] / rej[k] - 1), k).toBeLessThan(1e-6);
    });
  }
});

describe("criterio 2 de C2: la losa plana de H25 frente a la rejilla de E5", () => {
  // validacion/e5/out_bandas.txt: rejilla de E5 con h = 0,075 m y con h = 0,15 m
  const E5 = { cara: [-205.58, -262.71, -251.51, -263.21], vano: [76.98, 139.0] };
  const E5_015 = { cara: [-205.5, -262.74, -254.97, -264.07], vano: [76.78, 138.9] };
  const comparar = (h: number, rejilla: boolean, ref: typeof E5) => {
    const r = losaPlanaC2(h, rejilla);
    const cara = [r.cara[0]![0]!, r.cara[0]![1]!, r.cara[1]![0]!, r.cara[1]![1]!];
    cara.forEach((v, i) => expect(Math.abs(v / ref.cara[i]! - 1), `cara ${i}`).toBeLessThan(0.01));
    r.vano.forEach((v, i) => expect(Math.abs(v / ref.vano[i]! - 1), `vano ${i}`).toBeLessThan(0.01));
  };
  it("triangulación, h = 0,15: cara (fuerzas nodales) y vano (campos) a ≤ 1 % de E5", () => comparar(0.15, false, E5));
  it("rejilla, h = 0,15: a ≤ 1 % de la rejilla de E5 con el mismo h", () => comparar(0.15, true, E5_015));
  it("rejilla, h = 0,1: a ≤ 1 % de E5", () => comparar(0.1, true, E5));
});

describe("criterio 3 de C2-a: plantillas de pilar frente a la triangulación fina", () => {
  it("retícula enrasada, h = 0,75: reacciones a ≤ 1 %, flecha máxima a ≤ 2 % y deriva a ≤ 1 %", () => {
    const f = reticulaEnrasada(1);
    const medir = (op: OpcionesCompilacion) => {
      const r = valido(compilar(f, op));
      const casos = casosValidos(calcular(r.modelo));
      const k = (id: string) => r.modelo.casos.findIndex((x) => x.id === id);
      const [G, Q, V] = [k("G"), k("Q"), k("V")];
      const z = Math.max(...r.modelo.nudos.map((n) => n.z));
      const base = Object.entries(r.mapeo.nudosPilar)
        .filter(([c]) => c.endsWith("@C"))
        .sort()
        .map(([, n]) => casos[G]!.reacciones[6 * n + 2]! + casos[Q]!.reacciones[6 * n + 2]!);
      let flecha = 0;
      r.modelo.nudos.forEach((n, i) => n.z === z && (flecha = Math.min(flecha, casos[G]!.u[6 * i + 2]! + casos[Q]!.u[6 * i + 2]!)));
      const arriba = Object.entries(r.mapeo.nudosPilar).filter(([c]) => c.endsWith("@N1")).map(([, n]) => n);
      const deriva = arriba.reduce((s, n) => s + casos[V]!.u[6 * n]!, 0) / arriba.length;
      return { base, flecha, deriva, malla: r.estadisticas.malla, laminas: r.estadisticas.laminas };
    };
    const [a, ref] = [medir({ tamanoMalla: 0.75 }), medir({ tamanoMalla: 0.2, rejilla: false })];
    expect(a.malla.plantillas).toBe(12);
    expect(a.malla.laminasRejilla).toBe(a.laminas);
    a.base.forEach((b, i) => expect(Math.abs(b / ref.base[i]! - 1), `pilar ${i}`).toBeLessThan(0.01));
    expect(Math.abs(a.flecha / ref.flecha - 1)).toBeLessThan(0.02);
    expect(Math.abs(a.deriva / ref.deriva - 1)).toBeLessThan(0.01);
  });
});
