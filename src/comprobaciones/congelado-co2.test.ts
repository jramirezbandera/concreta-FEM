/**
 * Fase CO2, criterio 14 (regla de oro 1): la referencia congelada de las comprobaciones de las vigas
 * de `validacion/co/congelarVigas.ts`. El armado propuesto de cada vano, si cumple, lo pendiente y el
 * estado de cada fila, idénticos; los aprovechamientos, a 1e-9. Si falla tras un cambio, o el cambio
 * es un error o es una mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_CO2, referenciaCO2, type ReferenciaCO2 } from "../../validacion/co/congelarVigas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-co2.json"), "utf8")) as Record<string, ReferenciaCO2>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("fase CO2: referencia congelada de las vigas", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO2)) {
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const r = referenciaCO2(f());
      expect(r.resumen).toEqual(ref.resumen);
      expect(r.vanos.length).toBe(ref.vanos.length);
      r.vanos.forEach((t, i) => {
        const o = ref.vanos[i]!;
        const donde = `${t.viga}, vano ${t.vano}`;
        expect({ viga: t.viga, vano: t.vano, texto: t.texto, cumple: t.cumple, pendientes: t.pendientes }, donde).toEqual({ viga: o.viga, vano: o.vano, texto: o.texto, cumple: o.cumple, pendientes: o.pendientes });
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
