/**
 * Referencia congelada de C1 (regla de oro 1): para cada modelo físico, el modelo analítico que da
 * el compilador, su mapeo y los resultados completos de todos los casos:
 * - SAP2000 1-022 como modelo físico (`fisico-1022.json`);
 * - el edificio objetivo reducido (2 plantas, 3 × 2 vanos) de `banco.ts`;
 * - tres modelos físicos aleatorios (semillas 6 y 13 con diafragma, 21 sin él) con pilares girados
 *   o que acaban una planta antes, vigas continuas y por vano, secundarias en T, voladizos, rótulas y cargas
 *   de todos los tipos.
 * El test (src/compilador/congelado-c1.test.ts) los recompila y recalcula con los dos solvers.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio del generador aleatorio):
 *   bun validacion/c1/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import type { Mapeo } from "../../src/compilador/mapeo.ts";
import { calcular, type OpcionesCalculo } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { edificioObjetivo } from "./banco.ts";

export const MODELOS_CONGELADOS_C1: Record<string, () => ModeloFisico> = {
  "sap-1-022": () => JSON.parse(readFileSync(join(import.meta.dirname, "fisico-1022.json"), "utf8")) as ModeloFisico,
  "edificio-2x3x2": () => edificioObjetivo(2, 3, 2),
  "aleatorio-6": () => fisicoAleatorio(6),
  "aleatorio-13": () => fisicoAleatorio(13),
  "aleatorio-21-sin-diafragma": () => fisicoAleatorio(21, { diafragma: false }),
};

export interface ReferenciaC1 {
  modelo: ModeloAnalitico;
  mapeo: Mapeo;
  casos: { u: number[]; reacciones: number[]; esfuerzosBarras: number[] }[];
}

export function referenciaC1(f: () => ModeloFisico, solver: OpcionesCalculo["solver"] = "nucleo"): ReferenciaC1 {
  const r = compilar(f());
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo, { solver })).map((c) => ({ u: [...c.u], reacciones: [...c.reacciones], esfuerzosBarras: [...c.esfuerzosBarras] }));
  return { modelo: r.modelo, mapeo: r.mapeo, casos };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_C1).map(([k, f]) => [k, referenciaC1(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c1.json");
  writeFileSync(ruta, JSON.stringify(salida));
  console.log(`Escrito ${ruta}`);
}
