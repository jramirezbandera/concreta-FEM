/**
 * Referencia congelada de C2 (regla de oro 1): para cada modelo físico con losas, el modelo
 * analítico que da el compilador (malla incluida), su mapeo y los resultados completos de todos
 * los casos (desplazamientos, reacciones y esfuerzos de barras y láminas):
 * - la losa plana de H25 (pilares, huellas, bandas, diafragma), h = 1;
 * - la placa de Navier delgada con apoyos lineales, h = 0,5;
 * - dos modelos aleatorios con losas (semilla 8 con diafragma y eje 1 al azar; 11 sin diafragma),
 *   h = 1: pilares girados y circulares, vigas embebidas y secundarias, huecos, chaflanes, zonas,
 *   tabiques, puntuales en losa y bandas.
 * Todos con la triangulación sola (`rejilla: false`), como se congelaron en C2. Con la rejilla
 * alineada de H52 (C2-a), la losa plana y el modelo aleatorio 8 otra vez, y la retícula con la losa
 * enrasada con los pilares de fachada (1 planta, h = 0,75): plantillas de pilar y franja de fachada.
 * Los números se guardan con 13 cifras significativas (el test compara el modelo a 1e-12 y los
 * resultados a 1e-9), para que el fichero no pase de unos 2 MB.
 * El test (src/compilador/congelado-c2.test.ts) los recompila y recalcula con los dos solvers.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio de los generadores):
 *   bun validacion/c2/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { Mapeo } from "../../src/compilador/mapeo.ts";
import { calcular, type OpcionesCalculo } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { CASOS_NAVIER } from "../e3/navier.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "./losaPlana.ts";
import { reticulaEnrasada } from "./modelos.ts";
import { navierFisico } from "./navier.ts";

export const MODELOS_CONGELADOS_C2: Record<string, () => ModeloCongelado> = {
  "losa-plana": () => ({ fisico: losaPlanaFisica(), opciones: { ...OPCIONES_LOSA_PLANA, tamanoMalla: 1, rejilla: false } }),
  "navier-delgada": () => ({ fisico: navierFisico(CASOS_NAVIER[0]!), opciones: { tamanoMalla: 0.5, rejilla: false } }),
  "aleatorio-8-losas": () => ({ fisico: conLosasAleatorias(fisicoAleatorio(8), 8, { eje1: "azar" }), opciones: { tamanoMalla: 1, rejilla: false } }),
  "aleatorio-11-losas-sin-diafragma": () => ({ fisico: conLosasAleatorias(fisicoAleatorio(11, { diafragma: false }), 11), opciones: { tamanoMalla: 1, rejilla: false } }),
  "losa-plana-rejilla": () => ({ fisico: losaPlanaFisica(), opciones: { ...OPCIONES_LOSA_PLANA, tamanoMalla: 1 } }),
  "aleatorio-8-losas-rejilla": () => ({ fisico: conLosasAleatorias(fisicoAleatorio(8), 8, { eje1: "azar" }), opciones: { tamanoMalla: 1 } }),
  "reticula-enrasada": () => ({ fisico: reticulaEnrasada(1), opciones: {} }),
};

export interface ReferenciaC2 {
  modelo: ModeloAnalitico;
  mapeo: Mapeo;
  casos: { u: number[]; reacciones: number[]; esfuerzosBarras: number[]; esfuerzosLaminas: number[] }[];
}

export function referenciaC2(f: () => ModeloCongelado, solver: OpcionesCalculo["solver"] = "nucleo"): ReferenciaC2 {
  const { fisico, opciones } = f();
  const r = compilar(fisico, opciones);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo, { solver })).map((c) => ({ u: [...c.u], reacciones: [...c.reacciones], esfuerzosBarras: [...c.esfuerzosBarras], esfuerzosLaminas: [...c.esfuerzosLaminas] }));
  return { modelo: r.modelo, mapeo: r.mapeo, casos };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_C2).map(([k, f]) => [k, referenciaC2(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c2.json");
  writeFileSync(ruta, JSON.stringify(salida, (_k, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v)));
  console.log(`Escrito ${ruta}`);
}
