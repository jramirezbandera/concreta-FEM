/**
 * Fase CO1, criterio 14 (regla de oro 1): la referencia congelada de las comprobaciones de los
 * pilares de `validacion/co/congelar.ts`. El armado propuesto de cada tramo, si cumple, lo pendiente
 * y el estado de cada fila, idénticos; los aprovechamientos, a 1e-9. Si falla tras un cambio, o el
 * cambio es un error o es una mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_CO1, referenciaCO1, type ReferenciaCO1 } from "../../validacion/co/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-co1.json"), "utf8")) as Record<string, ReferenciaCO1>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("fase CO1: referencia congelada de los pilares", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO1)) {
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const r = referenciaCO1(f());
      expect(r.resumen).toEqual(ref.resumen);
      expect(r.tramos.length).toBe(ref.tramos.length);
      r.tramos.forEach((t, i) => {
        const o = ref.tramos[i]!;
        const donde = `${t.pilar} en ${t.planta}`;
        expect({ pilar: t.pilar, planta: t.planta, texto: t.texto, ajuste: t.ajuste, cumple: t.cumple, pendientes: t.pendientes }, donde).toEqual({ pilar: o.pilar, planta: o.planta, texto: o.texto, ajuste: o.ajuste, cumple: o.cumple, pendientes: o.pendientes });
        expect(t.filas.map((x) => `${x.id}:${x.estado}`), donde).toEqual(o.filas.map((x) => `${x.id}:${x.estado}`));
        t.filas.forEach((x, k) => {
          const y = o.filas[k]!.aprovechamiento;
          if (x.aprovechamiento === null || y === null) expect(x.aprovechamiento, `${donde}: ${x.id}`).toBe(y);
          else expect(Math.abs(x.aprovechamiento - y), `${donde}: ${x.id}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(y)));
        });
      });
    });
  }
});
