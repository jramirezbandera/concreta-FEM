/**
 * Machones y dinteles del muro acoplado de ETABS 15c (C5, criterio 4) para el oráculo de OpenSeesPy
 * (`oraculo_cortes.py`): el modelo físico de C3 (`validacion/c3/etabs15.ts`), compilado con h = 20 y 10 in,
 * y los cortes por fuerzas nodales de sus machones (base y cabeza) y de sus dinteles (sus extremos).
 * ETABS 15 sólo publica desplazamientos, así que el oráculo es otro elemento (ASDShellQ4, que en E6
 * coincidió con el motor a ≤ 0,5 %) con los mismos cortes calculados aparte, en Python.
 *
 * `bun validacion/c5/etabs15c-modelos.ts` escribe validacion/c5/etabs15c-modelos.json (regenerable,
 * fuera del repositorio): por modelo y tamaño de malla («15c-3-60@10»), el modelo analítico y sus cortes
 * (definición, si va invertido y los esfuerzos del motor).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosMuros, type EsfuerzosCorte } from "../../src/compilador/esfuerzosMuros.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoEtabs } from "../c3/etabs15.ts";
import { IN } from "../e6/csi.ts";
import { murosEtabs15 } from "../e6/etabs15.ts";

/** Los modelos de 15c que se comparan: 3 y 6 plantas con dinteles de 60 y 240 in. */
export const MODELOS_15C = ["15c-3-60", "15c-3-240", "15c-6-60", "15c-6-240"];
/** Tamaños de malla, in: el de C3 (20) y la mitad (10), con el que se prueba. */
export const H_15C = [20, 10];

export interface CorteMuro {
  id: string;
  /** "machon" o "dintel". */
  pieza: string;
  corte: EsfuerzosCorte["corte"];
  invertido: boolean;
  /** Del motor: [N, Vy, Vz, T, My, Mz] por caso. */
  esfuerzos: number[];
}

/** El modelo 15c compilado y calculado, con los cortes de sus machones y dinteles. */
export function cortes15c(id: string, h: number): { fisico: ModeloFisico; modelo: ModeloAnalitico; cortes: CorteMuro[] } {
  const fisico = fisicoEtabs(murosEtabs15().find((m) => m.id === id)!);
  const r = compilar(fisico, { tamanoMalla: h * IN });
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const em = new EsfuerzosMuros(fisico, r, casos);
  const cortes: CorteMuro[] = [];
  const poner = (pieza: string, idc: string, e: EsfuerzosCorte) => cortes.push({ id: idc, pieza, corte: e.corte, invertido: e.invertido, esfuerzos: Array.from(e.esfuerzos) });
  for (const w of fisico.muros ?? []) {
    for (const m of em.machones(w.id)!) {
      poner("machon", `${m.id}:base`, m.base);
      poner("machon", `${m.id}:cabeza`, m.cabeza);
    }
    for (const d of em.dinteles(w.id)!) {
      poner("dintel", `${d.id}:inicio`, d.inicio);
      poner("dintel", `${d.id}:fin`, d.fin);
    }
  }
  return { fisico, modelo: r.modelo, cortes };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  for (const id of MODELOS_15C)
    for (const h of H_15C) {
      const { modelo, cortes } = cortes15c(id, h);
      salida[`${id}@${h}`] = { modelo, cortes };
      console.log(`${id}, h = ${h} in: ${modelo.nudos.length} nudos, ${cortes.length} cortes`);
    }
  writeFileSync(join(import.meta.dirname, "etabs15c-modelos.json"), JSON.stringify(salida));
}
