/**
 * Fase LC, criterio 3 (`docs/fem3d/losa-cimentacion.md` §6): la losa de cimentación de
 * `validacion/lc/oraculo.ts` frente a OpenSeesPy 3.8 (`validacion/lc/oraculo_balasto.py`: los mismos
 * nudos, muelles, apoyos y enlaces, con ASDShellQ4 en vez de la DKMQ24 del motor). El asiento de cada
 * nudo con muelle, a ≤ 0,5 % del mayor, y la suma de las reacciones de los muelles, la misma.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { modeloOraculo, OPCIONES_ORACULO } from "../../validacion/lc/oraculo.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-lc.json"), "utf8")) as Record<string, { uz: number[]; fz: number }>;

describe("losa de cimentación frente a OpenSeesPy", () => {
  it("el asiento de cada nudo a ≤ 0,5 % del mayor y las reacciones de los muelles, las mismas", () => {
    const r = valido(compilar(modeloOraculo(), OPCIONES_ORACULO));
    const casos = casosValidos(calcular(r.modelo));
    const c = r.mapeo.cimentacion!.L!;
    r.modelo.casos.forEach((caso, k) => {
      const o = oraculo[caso.id]!;
      const u = casos[k]!.u;
      expect(o.uz.length).toBe(c.nudos.length);
      const escala = Math.max(...o.uz.map(Math.abs));
      let peor = 0;
      c.nudos.forEach((n, i) => (peor = Math.max(peor, Math.abs(u[6 * n + 2]! - o.uz[i]!) / escala)));
      expect(peor).toBeLessThan(5e-3);
      const fz = c.nudos.reduce((s, n, i) => s + c.balasto * c.areas[i]! * -u[6 * n + 2]!, 0);
      expect(Math.abs(fz - o.fz)).toBeLessThan(1e-6 * Math.max(1, Math.abs(o.fz)));
    });
  });
});
