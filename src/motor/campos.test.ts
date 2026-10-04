/**
 * Criterio 3 de E5: campos recuperados por SPR (N, M y Q por equilibrio).
 * - Exactos donde la DKMQ lo es: patch test de MacNeal–Harder con malla irregular (N y M
 *   constantes, Q = 0) y ménsula con M lineal y Q constante, también con una sola fila de láminas.
 * - Convergencia frente a Navier (Mindlin): Q recuperado con orden ≈ 2 y sin depender del espesor;
 *   ≤ 5 % con h/t ≈ 2 en la réplica de exp01d (S5 #3), donde el Q de la DKMQ queda un 17–42 % bajo.
 * - Metamórficas: giro, renumeración e inversión del orden de los nudos; ejes de usuario
 *   mezclados dentro de una región.
 * - Regiones: losa, muro y faldón separados; huellas fuera; filas sueltas, degradadas sin fallar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { laminaPlegada } from "../../validacion/e3/metamorficas.ts";
import { CASOS_NAVIER } from "../../validacion/e3/navier.ts";
import { BASE_E5 } from "../../validacion/e5/fuerzasNodales.ts";
import {
  cortanteExp01d,
  errorEjesMezclados,
  errorMensulaSpr,
  errorParcheSpr,
  erroresMetamorficosCampos,
  erroresSprNavier,
  MODELOS_METAMORFICOS_CAMPOS,
} from "../../validacion/e5/spr.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { edificio, RETICULAR } from "../pruebas/edificio.ts";
import { calcular } from "./calcular.ts";
import { CamposLaminas } from "./campos.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 3 de E5: exactitud donde la DKMQ es exacta", () => {
  it("patch test de MacNeal–Harder (isótropo y reticular con el eje 1 a 30°): N y M exactos, Q = 0", () => {
    for (const e of [errorParcheSpr(), errorParcheSpr(RETICULAR, 30)]) {
      expect(e.N).toBeLessThan(1e-9);
      expect(e.M).toBeLessThan(1e-9);
      expect(e.Q).toBeLessThan(1e-9);
    }
  });

  it("ménsula con ν = 0: Mx = −F(L − x) y Qx = −F en todos los nudos, también con una sola fila", () => {
    for (const [nx, ny] of [[8, 2], [3, 3], [6, 1]] as const) expect(errorMensulaSpr(nx, ny), `${nx} × ${ny}`).toBeLessThan(1e-9);
  });
});

describe("criterio 3 de E5: convergencia frente a Navier (Mindlin)", () => {
  it("réplica de exp01d: Q recuperado ≤ 5 % con h/t ≈ 2, de orden 2 y sin depender del espesor (S5 #3)", () => {
    for (const at of [25, 40]) {
      const [dkmqBorde, , sprBorde16, sprCuarto16] = cortanteExp01d(at, 16);
      const [, , sprBorde32, sprCuarto32] = cortanteExp01d(at, 32);
      expect(Math.abs(sprBorde16!)).toBeLessThan(0.05);
      expect(Math.abs(sprCuarto16!)).toBeLessThan(0.05);
      expect(Math.abs(dkmqBorde!)).toBeGreaterThan(0.15); // H18: el de la DKMQ, no
      expect(Math.log2(Math.abs(sprBorde16! / sprBorde32!))).toBeGreaterThan(1.8);
      expect(Math.abs(sprCuarto32!)).toBeLessThan(0.01);
    }
    // El error depende de la malla por vano, no del espesor
    const delgada = cortanteExp01d(100, 16);
    const gruesa = cortanteExp01d(10, 16);
    expect(Math.abs(delgada[2]! - gruesa[2]!)).toBeLessThan(0.002);
  });

  for (const c of CASOS_NAVIER) {
    it(`${c.nombre}: M, Mxy y Q nodales de orden 2 y pequeños con h = 0,125 m`, () => {
      const g = erroresSprNavier(c, 0.25);
      const f = erroresSprNavier(c, 0.125);
      for (const k of ["eMx", "eMy", "eMxy", "eQx", "eQy"] as const) {
        expect(Math.abs(f[k]), k).toBeLessThan(0.005);
        expect(Math.log2(Math.abs(g[k] / f[k])), k).toBeGreaterThan(1.8);
      }
      expect(Math.abs(f.eQx4)).toBeLessThan(0.005);
    });
  }
});

describe("criterio 3 de E5: pruebas metamórficas de los campos (≤ 1e-9)", () => {
  for (const [nombre, fabrica, R] of MODELOS_METAMORFICOS_CAMPOS) {
    it(nombre, () => {
      const [giro, ren, inv] = erroresMetamorficosCampos(fabrica, R);
      if (R) expect(giro, "giro").toBeLessThan(1e-9);
      expect(ren, "renumeración").toBeLessThan(1e-9);
      expect(inv, "inversión del orden de los nudos").toBeLessThan(1e-9);
    });
  }

  it("ejes de usuario mezclados dentro de una región isótropa", () => {
    expect(errorEjesMezclados()).toBeLessThan(1e-9);
  });
});

describe("criterio 3 de E5: regiones", () => {
  it("lámina plegada: losa, muro y faldón son tres regiones; el pliegue tiene un valor por región", () => {
    const modelo = laminaPlegada();
    const campos = new CamposLaminas(modelo);
    expect(campos.regiones.length).toBe(3);
    // nudo del pliegue losa–muro (y = 0, z = 3): dos plazas
    const pliegue = modelo.nudos.findIndex((v) => v.x === 2 && v.y === 0 && v.z === 3);
    expect([...campos.nudoDePlaza].filter((v) => v === pliegue).length).toBe(2);
  });

  it("edificio: las láminas de las huellas quedan fuera y el muro de una fila por planta se degrada sin fallar", () => {
    const { modelo } = edificio({ ...BASE_E5, diafragma: true, plantas: 1 });
    const [r] = casosValidos(calcular(modelo));
    const campos = new CamposLaminas(modelo);
    const fuera = modelo.laminas!.map((_, l) => campos.region(l)).filter((g) => g < 0).length;
    expect(fuera).toBeGreaterThan(0);
    // Las de fuera son exactamente las que tienen sus 4 nudos en un mismo enlace rígido
    const enlaces = modelo.restricciones!.filter((x) => x.tipo === "enlace-rigido").map((x) => new Set([x.maestro, ...x.esclavos]));
    modelo.laminas!.forEach((l, k) => expect(campos.region(k) < 0).toBe(enlaces.some((s) => l.nudos.every((v) => s.has(v)))));
    const ev = campos.evaluador(r!.u);
    const valores = campos.nodales(r!.u);
    expect(valores.every(Number.isFinite)).toBe(true);
    for (let p = 0; p < campos.nPlazas; p++) ev.plaza(p);
    expect(ev.degradadas).toBeGreaterThan(0);
  });
});
