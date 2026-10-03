/**
 * Criterio 2 de E3 (oráculo): láminas en el motor frente a PyNite 3.2.0 (Quad3D, la misma flexión
 * DKMQ y la misma presión) a ≤ 1e-10, en placas planas en cualquier orientación: desplazamientos,
 * reacciones y resultantes en los ejes de usuario, en el centroide y en los 4 puntos de Gauss. El
 * oráculo (validacion/e3/oraculo_pynite.py) gira por su cuenta los momentos de PyNite a los ejes de
 * usuario. Fixture: __fixtures__/pynite-e3.json.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_PYNITE_E3 } from "../../validacion/e3/modelos-oraculo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../pruebas/comparar.ts";
import { calcular } from "./calcular.ts";
import { ResultantesLaminas } from "./laminas.ts";

interface CasoOraculo {
  u: number[];
  reacciones: number[];
  centroide: number[][];
  gauss: number[][][];
}
const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "pynite-e3.json"), "utf8")) as {
  modelos: Record<string, Record<string, CasoOraculo>>;
};

const TOL = 1e-10;

/** Error de las resultantes por grupos (M y Q), relativo al máximo del grupo en el oráculo. */
function errorResultantes(calc: ArrayLike<number>, ref: ArrayLike<number>): { M: number; Q: number; N: number } {
  const grupo = (c0: number, c1: number) => {
    let d = 0;
    let m = 0;
    for (let i = 0; i < ref.length; i += 8) {
      for (let c = c0; c < c1; c++) {
        d = Math.max(d, Math.abs(calc[i + c]! - ref[i + c]!));
        m = Math.max(m, Math.abs(ref[i + c]!));
      }
    }
    return { d, m };
  };
  const M = grupo(3, 6);
  const Q = grupo(6, 8);
  const N = grupo(0, 3);
  return { M: M.d / M.m, Q: Q.d / Q.m, N: N.d / Q.m };
}

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 2 de E3: láminas frente a PyNite", () => {
  for (const [nombre, construir] of Object.entries(MODELOS_PYNITE_E3)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver}): u, reacciones y resultantes en ejes de usuario`, () => {
        const modelo = construir();
        const ref = oraculo.modelos[nombre]!;
        const casos = casosValidos(calcular(modelo, { solver }));
        const rl = new ResultantesLaminas(modelo);
        for (const c of casos) {
          const o = ref[c.id]!;
          expect(errorPorGrupos(c.u, o.u), `${c.id} u`).toBeLessThan(TOL);
          expect(errorPorGrupos(c.reacciones, o.reacciones), `${c.id} R`).toBeLessThan(TOL);
          const ec = errorResultantes(c.esfuerzosLaminas, o.centroide.flat());
          expect(ec.M, `${c.id} M`).toBeLessThan(TOL);
          expect(ec.Q, `${c.id} Q`).toBeLessThan(TOL);
          expect(ec.N, `${c.id} N`).toBeLessThan(TOL);
          const g = modelo.laminas!.flatMap((_, l) => Array.from(rl.enGauss(l, c.u)));
          const eg = errorResultantes(g, o.gauss.flat(2));
          expect(eg.M, `${c.id} M Gauss`).toBeLessThan(TOL);
          expect(eg.Q, `${c.id} Q Gauss`).toBeLessThan(TOL);
          expect(c.equilibrio.fuerzas).toBeLessThan(1e-12);
          expect(c.equilibrio.momentos).toBeLessThan(1e-12);
        }
      });
    }
  }
});
