/**
 * El comparador del spike A2 (`validacion/a2/comparar.ts`): da por bueno un modelo equivalente al de
 * referencia aunque cambien los ids, el orden de las listas y el sentido de las vigas, y rechaza
 * uno que no lo es.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { comparar, magnitudes, REFERENCIAS } from "../../validacion/a2/comparar.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { barajar } from "../pruebas/metamorficasFisicas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Los ids renombrados (menos los de los casos), las vigas al revés y las listas barajadas. */
function variante(f: ModeloFisico): ModeloFisico {
  const ids: string[] = [];
  for (const k of ["plantas", "materiales", "secciones", "pilares", "vigas", "losas", "muros", "cargas"] as const) for (const o of (f[k] ?? []) as readonly { id: string }[]) ids.push(o.id);
  let t = JSON.stringify(f);
  ids.forEach((id, i) => (t = t.split(JSON.stringify(id)).join(JSON.stringify(`obj${i}`))));
  const g = JSON.parse(t) as ModeloFisico;
  const r = azar(11);
  return { ...g, vigas: barajar(g.vigas!.map((v) => ({ ...v, puntos: [...v.puntos].reverse() })), r), pilares: barajar(g.pilares!, r), cargas: barajar(g.cargas!, r) };
}

describe("comparador del spike A2", () => {
  for (const nombre of ["1022", "nucleo"]) {
    const ref = REFERENCIAS[nombre]!;
    it(`${nombre}: una variante equivalente pasa a ~1e-13 y una con otras opciones no`, () => {
      const mr = magnitudes(ref.fisico(), ref.opciones, ref);
      const filas = comparar(mr, magnitudes(variante(ref.fisico()), ref.opciones, ref));
      expect(filas.length).toBeGreaterThanOrEqual(5 + 2);
      for (const f of filas) expect(f.error, f.grupo).toBeLessThan(1e-12);
      const mal = comparar(mr, magnitudes(ref.fisico(), nombre === "1022" ? {} : { tamanoMalla: 0.75 }, ref));
      expect(mal.some((f) => !f.pasa)).toBe(true);
    });
  }
});
