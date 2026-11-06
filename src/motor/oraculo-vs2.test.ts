/**
 * VS2, criterio 4 (`docs/fem3d/viento-sismo.md` §5): los periodos del motor frente a OpenSeesPy 3.8
 * en modelos compilados, con la masa de cada diafragma en su centro de masas.
 *
 * - Pórticos (sólo barras, restricciones por transformación): `eigen` de OpenSees, todos los modos,
 *   a 1e-8 (coinciden a ~1e-13).
 * - Con losas y muros (cadenas de enlaces rígidos): la flexibilidad estática de OpenSees en los
 *   centros de masas y los valores propios de LAPACK; sus láminas son ASDShellQ4, así que los
 *   periodos coinciden a lo que difieren los elementos (≤ 1 %; medido, ≤ 0,51 %).
 *
 * Los periodos de OpenSees están en `__fixtures__/opensees-vs2.json`, de
 * `validacion/vs2/oraculo_opensees.py` (con el informe en `validacion/vs2/out_opensees.txt`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { modalDe, MODELOS } from "../../validacion/vs2/modelos-oraculo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const ORACULO = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-vs2.json"), "utf8")) as Record<string, { handler: string; periodos: number[] }>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("VS2, criterio 4: los periodos del motor frente a OpenSeesPy", () => {
  for (const [nombre, x] of Object.entries(MODELOS)) {
    if (!x.enPruebas) continue;
    it(`${nombre} (${x.handler}): todos los modos a ≤ ${x.tolerancia}`, () => {
      const o = ORACULO[nombre]!;
      expect(o.handler).toBe(x.handler);
      const md = modalDe(x.modelo());
      expect(md.modos.length).toBe(o.periodos.length);
      md.modos.forEach((m, i) => expect(Math.abs(m.periodo - o.periodos[i]!) / o.periodos[i]!, `modo ${i + 1}`).toBeLessThan(x.tolerancia));
      for (const m of md.modos) {
        expect(m.equilibrio.fuerzas).toBeLessThan(1e-9);
        expect(m.equilibrio.momentos).toBeLessThan(1e-9);
      }
    });
  }
});
