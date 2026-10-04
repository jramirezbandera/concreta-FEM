/**
 * Modelos de los muros de ETABS 15 para el oráculo de OpenSeesPy (oraculo_opensees.py), con la
 * geometría del PDF y la malla gruesa de cada uno (h(0)), la misma que usa el test.
 *
 * `bun validacion/e6/modelos-oraculo.ts` escribe validacion/e6/modelos-oraculo.json (regenerable,
 * fuera del repositorio): por modelo, el modelo analítico y los nudos cuyos desplazamientos se leen.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { modeloMuro, murosEtabs15 } from "./etabs15.ts";

const salida: Record<string, unknown> = {};
for (const m of murosEtabs15()) {
  const h = m.h(0);
  const { modelo, maestros } = modeloMuro(m, h);
  salida[`${m.id}@${h}`] = { modelo, nudos: maestros };
}
writeFileSync(join(import.meta.dirname, "modelos-oraculo.json"), JSON.stringify(salida));
console.log(`${Object.keys(salida).length} modelos`);
