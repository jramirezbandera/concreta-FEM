/**
 * C5, criterio 4: machones y dinteles del muro acoplado de ETABS 15c (h = 10 in) frente a OpenSeesPy
 * ASDShellQ4 con los mismos cortes calculados aparte (`validacion/c5/oraculo_cortes.py`, fixture
 * opensees-c5.json), y la estática de los machones. Detalle en validacion/c5/out_etabs15c.txt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cortes15c, MODELOS_15C } from "../../validacion/c5/etabs15c-modelos.ts";
import { peores } from "../../validacion/c5/etabs15c.ts";
import { KIP } from "../../validacion/e6/csi.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-c5.json"), "utf8")) as Record<string, { esfuerzos: Record<string, (number | null)[]>; notas: Record<string, string> }>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("ETABS 15c: machones y dinteles frente a OpenSees (C5, criterio 4)", () => {
  for (const id of MODELOS_15C) {
    it(`${id}: cada esfuerzo a ≤ 2 % del mayor de su pieza, y los machones de cada planta suman la carga (≤ 1e-9)`, () => {
      const { fisico, cortes } = cortes15c(id, 10);
      const o = oraculo[`${id}@10`]!;
      expect(o.notas).toEqual({});
      expect(Object.keys(o.esfuerzos).sort()).toEqual(cortes.map((c) => c.id).sort());
      for (const pieza of ["machon", "dintel"]) {
        const p = peores(cortes, o.esfuerzos, pieza);
        expect(p.length).toBeGreaterThanOrEqual(3);
        for (const x of p) expect(x.peor, `${pieza} ${x.q} ${x.id}`).toBeLessThan(0.02);
      }
      for (const planta of fisico.plantas.slice(0, -1)) {
        const V = cortes.filter((c) => c.pieza === "machon" && c.id.includes(`:${planta.id}:`) && c.id.endsWith(":base")).reduce((s, c) => s + c.esfuerzos[1]!, 0);
        expect(Math.abs(V / (100 * KIP) - 1)).toBeLessThan(1e-9);
      }
    });
  }
});
