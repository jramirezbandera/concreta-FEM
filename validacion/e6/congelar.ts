/**
 * Referencia congelada de E6 (regla de oro 1): los resultados completos (desplazamientos,
 * reacciones, esfuerzos de barras y de láminas, todos los casos) de los modelos que trae E6:
 * - SAP2000 1-022: barras, diafragma por planta y pórtico plano (GDL coartados en el maestro);
 * - ETABS 15d de 3 plantas con malla de 20 in: núcleo en C de láminas con diafragma;
 * - tres modelos aleatorios (semillas 46, 82 y 125) que tienen a la vez diafragma, huellas
 *   encadenadas, muro, muelles a tierra y entre nudos, liberaciones, multiplicadores e impuestos.
 * El test (src/motor/congelado-e6.test.ts) los recalcula con los dos solvers y compara a 1e-9.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio del generador aleatorio):
 *   bun validacion/e6/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular, type OpcionesCalculo } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { modeloAleatorio } from "../../src/pruebas/aleatorio.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { sap1022 } from "./csi.ts";
import { modeloMuro, murosEtabs15 } from "./etabs15.ts";

export const MODELOS_CONGELADOS_E6: Record<string, () => ModeloAnalitico> = {
  "sap-1-022": () => sap1022().modelo,
  "etabs-15d-3": () => {
    const m = murosEtabs15().find((x) => x.id === "15d-3")!;
    return modeloMuro(m, m.h(0)).modelo;
  },
  "aleatorio-46": () => modeloAleatorio(46).modelo,
  "aleatorio-82": () => modeloAleatorio(82).modelo,
  "aleatorio-125": () => modeloAleatorio(125).modelo,
};

export interface ReferenciaE6 {
  casos: { u: number[]; reacciones: number[]; esfuerzosBarras: number[]; esfuerzosLaminas: number[] }[];
}

export function referenciaE6(f: () => ModeloAnalitico, solver: OpcionesCalculo["solver"] = "nucleo"): ReferenciaE6 {
  return { casos: casosValidos(calcular(f(), { solver })).map((c) => ({ u: [...c.u], reacciones: [...c.reacciones], esfuerzosBarras: [...c.esfuerzosBarras], esfuerzosLaminas: [...c.esfuerzosLaminas] })) };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_E6).map(([k, f]) => [k, referenciaE6(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "motor", "__fixtures__", "congelado-e6.json");
  writeFileSync(ruta, JSON.stringify(salida));
  console.log(`Escrito ${ruta}`);
}
