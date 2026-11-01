/**
 * Referencia congelada de la fase BN (criterio 7 de BN1, `docs/fem3d/barras.md`): el pórtico
 * arriostrado de dos plantas con losas, una cruz, un tornapuntas a una viga y una diagonal a la losa
 * (`src/pruebas/barras.ts`), con las opciones por defecto y con la malla de 1 m. El test
 * (src/compilador/congelado-bn.test.ts) los recompila y recalcula con los dos solvers.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte):
 *   bun validacion/bn/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { porticoArriostrado } from "../../src/pruebas/barras.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { referenciaC2 } from "../c2/congelar.ts";

export const MODELOS_CONGELADOS_BN: Record<string, () => ModeloCongelado> = {
  "portico-arriostrado": () => ({ fisico: porticoArriostrado() }),
  "portico-arriostrado-h1": () => ({ fisico: porticoArriostrado(), opciones: { tamanoMalla: 1 } }),
};

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_BN).map(([k, f]) => [k, referenciaC2(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-bn.json");
  writeFileSync(ruta, JSON.stringify(salida, (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v)));
  console.log(`Escrito ${ruta}`);
}
