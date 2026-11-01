/**
 * Oráculo externo de BN1 (criterio 8): exporta el pórtico de acero de `src/pruebas/barras.ts` para
 * `oraculo_pynite.py`, que lo monta en PyNite desde su modelo físico. Después:
 *   bun validacion/bn/oraculo.ts
 *   .venv/Scripts/python.exe validacion/bn/oraculo_pynite.py
 * y el test `src/compilador/oraculo-bn.test.ts` compara.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { porticoAcero } from "../../src/pruebas/barras.ts";

const ruta = join(import.meta.dirname, "oraculo-entrada.json");
writeFileSync(ruta, JSON.stringify(porticoAcero(), null, 1));
console.log(`Escrito ${ruta}`);
