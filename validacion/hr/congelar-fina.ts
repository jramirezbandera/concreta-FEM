/**
 * Fase HR, criterio 11 (`docs/fem3d/huella-rigida.md` §3.4): la referencia fina congelada de la
 * precisión local junto a los pilares, para `src/compilador/precision.test.ts`. Para las retículas al
 * azar 1, 12 y 16 (las que más pilares con nudos rígidos fuera de la huella tenían antes de HR) y la
 * losa 3 × 3 mezclada de F3, la medida de `src/pruebas/precisionLocal.ts` en la malla fina: h = 0,25
 * con las esquinas en las retículas, y h = 0,1 en la 3 × 3 (a ≤ 0,45 % de la malla tensorial del
 * oráculo, `out_tensorial.txt`). Se regenera sólo a sabiendas, como las demás referencias congeladas.
 *
 *   bun validacion/hr/congelar-fina.ts   → src/compilador/__fixtures__/precision-fina.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { medirLocal, type MedidaLocal } from "../../src/pruebas/precisionLocal.ts";
import { reticulaAleatoria } from "../../src/pruebas/reticulasAleatorias.ts";
import { redondeo } from "../c5/congelar.ts";
import { losa3x3Mezclada } from "../f3/modelos.ts";

export interface ReferenciaFina {
  vigas: Record<string, { v: number; escala: number }>;
  franjas: Record<string, { v: number; escala: number }>;
  franjasConViga: string[];
  nudos: number;
}

/** Los modelos, con las opciones de la malla gruesa (la de la prueba) y de la fina (la referencia). */
export const MODELOS_PRECISION: Record<string, { fisico: () => ModeloFisico; gruesa: OpcionesCompilacion; fina: OpcionesCompilacion }> = {
  "reticula-1": { fisico: () => reticulaAleatoria(1), gruesa: {}, fina: { tamanoMalla: 0.25 } },
  "reticula-12": { fisico: () => reticulaAleatoria(12), gruesa: {}, fina: { tamanoMalla: 0.25 } },
  "reticula-16": { fisico: () => reticulaAleatoria(16), gruesa: {}, fina: { tamanoMalla: 0.25 } },
  "losa-3x3-mezclada": { fisico: () => losa3x3Mezclada(), gruesa: { unionLosaViga: "eje" }, fina: { unionLosaViga: "eje", tamanoMalla: 0.1 } },
};

export function aReferencia(m: MedidaLocal): ReferenciaFina {
  return { vigas: Object.fromEntries(m.vigas), franjas: Object.fromEntries(m.franjas), franjasConViga: [...m.franjasConViga].sort(), nudos: m.nudos };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, ReferenciaFina> = {};
  for (const [nombre, m] of Object.entries(MODELOS_PRECISION)) {
    process.stderr.write(`${nombre}\n`);
    salida[nombre] = aReferencia(medirLocal(m.fisico(), m.fina));
  }
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "precision-fina.json");
  writeFileSync(ruta, JSON.stringify(salida, redondeo));
  console.log(`Escrito ${ruta}`);
}
