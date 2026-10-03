/**
 * Criterio 1 de E2: barras frente a oráculos independientes.
 * - PyNite 3.2.0 (Euler–Bernoulli, liberaciones y todas las cargas de barra): desplazamientos,
 *   reacciones y esfuerzos en 7 estaciones por barra. Con los mismos ejes locales PyNite da los
 *   esfuerzos con el signo cambiado (H02), así que se comparan con −PyNite.
 * - OpenSeesPy 3.8 (Timoshenko, offsets con jntOffset y con rigidLink, liberaciones con nudos
 *   duplicados y equalDOF): desplazamientos, reacciones y fuerzas de extremo de cada trozo de
 *   barra (OpenSees trocea en las cargas puntuales), frente al diagrama de la barra entera.
 * Modelos en validacion/e2/modelos-oraculo.ts; oráculos en validacion/e2/oraculo_*.py.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { erroresOpenSees, erroresPynite, fixture } from "../../validacion/e2/comparar.ts";
import { MODELOS_OPENSEES, MODELOS_PYNITE } from "../../validacion/e2/modelos-oraculo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { calcular } from "./calcular.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("E2 frente a PyNite 3.2.0 (Euler–Bernoulli, liberaciones y cargas de barra)", () => {
  for (const [nombre, fabrica] of Object.entries(MODELOS_PYNITE)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver}): u, reacciones y esfuerzos en estaciones a ≤ 1e-10`, () => {
        const modelo = fabrica();
        const [eu, er, ee] = erroresPynite(nombre, modelo, casosValidos(calcular(modelo, { solver })));
        expect(eu, "u").toBeLessThan(1e-10);
        expect(er, "reacciones").toBeLessThan(1e-10);
        expect(ee, "esfuerzos").toBeLessThan(1e-10);
      });
    }
  }
});

describe("E2 frente a OpenSeesPy 3.8 (Timoshenko, offsets y liberaciones)", () => {
  const ref = (() => {
    try {
      return fixture("opensees-e2.json").modelos as Record<string, Record<string, unknown>>;
    } catch {
      return null;
    }
  })();
  for (const [nombre, fabrica] of Object.entries(MODELOS_OPENSEES)) {
    for (const variante of Object.keys(ref?.[nombre] ?? {})) {
      it(`${nombre} [${variante}]: u, reacciones y fuerzas de extremo a ≤ 1e-10`, () => {
        const modelo = fabrica();
        const [eu, er, ee] = erroresOpenSees(nombre, variante, modelo, casosValidos(calcular(modelo)));
        expect(eu, "u").toBeLessThan(1e-10);
        expect(er, "reacciones").toBeLessThan(1e-10);
        expect(ee, "esfuerzos").toBeLessThan(1e-10);
      });
    }
  }
});
