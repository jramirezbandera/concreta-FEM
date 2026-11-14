/**
 * Referencia congelada de la fase LC (`docs/fem3d/losa-cimentacion.md`): las losas de cimentación de
 * `oraculo.ts` (tres pilares; con lo horizontal coartado y con kh; con un muro y una viga de atado
 * sobre la losa) y la retícula de 3 × 3 vanos sobre dos balastos de `malla.ts`, con las opciones por
 * defecto. El test (src/compilador/congelado-lc.test.ts) los recompila y recalcula con los dos solvers.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte):
 *   bun validacion/lc/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { referenciaC2 } from "../c2/congelar.ts";
import { reticulaCimentacion } from "./malla.ts";
import { modeloOraculo } from "./oraculo.ts";

function conKh(): ModeloFisico {
  const f = modeloOraculo();
  return { ...f, losas: f.losas!.map((l) => ({ ...l, cimentacion: { balasto: 40000, horizontal: { kh: 8000 } } })) };
}

function conMuroYViga(): ModeloFisico {
  const f = modeloOraculo();
  return {
    ...f,
    materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [...f.secciones, { id: "v40", material: "H", forma: "rectangular", b: 0.4, h: 0.8 }],
    muros: [{ id: "M1", puntos: [[1, 5], [9, 5]], desde: "C", hasta: "N1", espesor: 0.25, material: "H" }],
    vigas: [{ id: "V1", planta: "C", puntos: [[2, 3], [8, 3]], seccion: "v40" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "W" }],
  };
}

export const MODELOS_CONGELADOS_LC: Record<string, () => ModeloCongelado> = {
  "tres-pilares": () => ({ fisico: modeloOraculo() }),
  "tres-pilares-kh": () => ({ fisico: conKh() }),
  "muro-y-viga": () => ({ fisico: conMuroYViga() }),
  "reticula-dos-balastos": () => ({ fisico: reticulaCimentacion() }),
};

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_LC).map(([k, f]) => [k, referenciaC2(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-lc.json");
  writeFileSync(ruta, JSON.stringify(salida, (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v)));
  console.log(`Escrito ${ruta}`);
}
