/**
 * Fase CO4, criterio 14 (regla de oro 1): la referencia congelada del punzonamiento de
 * `validacion/co/congelarPunzonamiento.ts`. La posición, la cara, la armadura propuesta, si cumple, lo
 * pendiente y el estado de cada fila, idénticos; β, VEd, el perímetro y los aprovechamientos, a 1e-4
 * (el fixture se escribe con Bun y la prueba corre en Node, CO3-6). Si falla tras un cambio, o el
 * cambio es un error o es una mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_CO4, referenciaCO4, type ReferenciaCO4 } from "../../validacion/co/congelarPunzonamiento.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-co4.json"), "utf8")) as Record<string, ReferenciaCO4>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const cerca = (a: number | null, b: number | null, que: string) => {
  if (a === null || b === null) expect(a, que).toBe(b);
  else expect(Math.abs(a - b), que).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(b)));
};

describe("fase CO4: referencia congelada del punzonamiento", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO4)) {
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const r = referenciaCO4(f());
      expect(r.resumen).toEqual(ref.resumen);
      expect(r.pilares.length).toBe(ref.pilares.length);
      r.pilares.forEach((t, i) => {
        const o = ref.pilares[i]!;
        const que = `${t.pilar}@${t.planta}`;
        const fijo = (x: ReferenciaCO4["pilares"][number]) => ({ pilar: x.pilar, planta: x.planta, losa: x.losa, posicion: x.posicion, cara: x.cara, armadura: x.armadura, perimetros: x.perimetros, cumple: x.cumple, pendientes: x.pendientes });
        expect(fijo(t), que).toEqual(fijo(o));
        cerca(t.beta, o.beta, `${que}: β`);
        cerca(t.VEd, o.VEd, `${que}: VEd`);
        cerca(t.u1, o.u1, `${que}: u1`);
        expect(t.filas.map((x) => `${x.id}:${x.estado}`), que).toEqual(o.filas.map((x) => `${x.id}:${x.estado}`));
        t.filas.forEach((x, k) => cerca(x.aprovechamiento, o.filas[k]!.aprovechamiento, `${que}: ${x.id}`));
      });
    }, 120_000);
  }
});
