/**
 * Fase CO3, criterio 14 (regla de oro 1): la referencia congelada de las comprobaciones de las losas
 * de `validacion/co/congelarLosas.ts`. El armado propuesto de cada losa, si cumple, lo pendiente y el
 * estado de cada fila, idénticos; los aprovechamientos, a 1e-4: el fixture se escribe con Bun y la
 * prueba corre en Node, y en el reticular una demanda de franja difiere 1,2e-5 entre los dos (CO3-6,
 * por investigar; en las vigas, 1e-9). Si falla tras un cambio, o el cambio es un error o es una
 * mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_CO3, referenciaCO3, type ReferenciaCO3 } from "../../validacion/co/congelarLosas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-co3.json"), "utf8")) as Record<string, ReferenciaCO3>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("fase CO3: referencia congelada de las losas", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO3)) {
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const r = referenciaCO3(f());
      expect(r.resumen).toEqual(ref.resumen);
      expect(r.losas.length).toBe(ref.losas.length);
      r.losas.forEach((t, i) => {
        const o = ref.losas[i]!;
        expect({ losa: t.losa, armado: t.armado, cumple: t.cumple, pendientes: t.pendientes, sinRefuerzo: t.sinRefuerzo }, t.losa).toEqual({ losa: o.losa, armado: o.armado, cumple: o.cumple, pendientes: o.pendientes, sinRefuerzo: o.sinRefuerzo });
        expect(t.filas.map((x) => `${x.id}|${x.seccion}|${x.armado}:${x.estado}`), t.losa).toEqual(o.filas.map((x) => `${x.id}|${x.seccion}|${x.armado}:${x.estado}`));
        t.filas.forEach((x, k) => {
          const y = o.filas[k]!.aprovechamiento;
          if (x.aprovechamiento === null || y === null) expect(x.aprovechamiento, `${t.losa}: ${x.id}`).toBe(y);
          else expect(Math.abs(x.aprovechamiento - y), `${t.losa}: ${x.id}`).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(y)));
        });
      });
    }, 120_000);
  }
});
