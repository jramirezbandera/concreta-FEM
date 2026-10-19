/**
 * Fase HR, criterio 11 (`docs/fem3d/huella-rigida.md` §3.4): la regresión de precisión local junto a
 * los pilares, con umbrales. Tres retículas al azar de G (1, 12 y 16) y la losa 3 × 3 mezclada de F3,
 * con h = 0,75, frente a la referencia fina congelada (`__fixtures__/precision-fina.json`, de
 * `validacion/hr/congelar-fina.ts`: h = 0,25 en las retículas y 0,1 en la 3 × 3): el momento de las
 * vigas en las caras de sus pilares y las estaciones de cara y de apoyo de las franjas junto a cada
 * pilar, con y sin viga, respecto al máximo de la viga o de la franja (`src/pruebas/precisionLocal.ts`).
 * Los umbrales son los medidos al cerrar la fase (`validacion/lv2/out_asoma.txt`), con holgura; las
 * estaciones que no convergen van listadas por su clave, nunca en silencio.
 * Falla si se vuelve a la regla antigua de C2-d en el modelo compilado (los nudos de fuera a ≤ ε_snap,
 * rígidos): es la medida de LV2-4 y F3-8.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_PRECISION, type ReferenciaFina } from "../../validacion/hr/congelar-fina.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { diferenciasLocales, medirLocal, type MedidaLocal } from "../pruebas/precisionLocal.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "precision-fina.json"), "utf8")) as Record<string, ReferenciaFina>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

interface Umbral {
  /** Mediana de |error| (sobre la escala), máximo, y cuántas pueden pasar del 10 y del 20 %. */
  mediana: number;
  maximo: number;
  masDe10: number;
  masDe20: number;
}
/** Umbrales por grupo, con las excepciones conocidas (estaciones que no convergen con h = 0,75) por clave. */
const UMBRALES: Record<string, { vigas?: Umbral; conViga?: Umbral; sinViga?: Umbral; excepciones?: string[] }> = {
  // Medido al cerrar la fase (2026-10-19): vigas 2,0 / 16,8 % (1 > 10 %); con viga 5,2 / 21,9 % (23 > 10 %, 4 > 20 %); sin viga 0,8 / 2,4 %
  "reticula-1": { vigas: { mediana: 0.03, maximo: 0.2, masDe10: 2, masDe20: 0 }, conViga: { mediana: 0.07, maximo: 0.3, masDe10: 30, masDe20: 6 }, sinViga: { mediana: 0.02, maximo: 0.05, masDe10: 0, masDe20: 0 } },
  // vigas 1,1 / 5,3 %; con viga 2,7 / 26,5 % (8 > 10 %, 1 > 20 %: L-N2:Y1 4,150:−1, la cara de un pilar de borde); sin pilares sin viga
  "reticula-12": { vigas: { mediana: 0.02, maximo: 0.08, masDe10: 0, masDe20: 0 }, conViga: { mediana: 0.04, maximo: 0.33, masDe10: 12, masDe20: 2 } },
  // vigas 0,9 / 7,9 %; con viga 2,7 / 31,6 % (11 > 10 %, 1 > 20 %: L-N1:Y1 0,300:+1, la cara de un pilar de esquina); sin pilares sin viga
  "reticula-16": { vigas: { mediana: 0.02, maximo: 0.1, masDe10: 0, masDe20: 0 }, conViga: { mediana: 0.04, maximo: 0.38, masDe10: 16, masDe20: 2 } },
  // Sin vigas: todas sus caras, 0,7 / 2,0 % frente a h = 0,1 (y a ≤ 1,5 % de la malla tensorial, `validacion/hr/out_tensorial.txt`)
  "losa-3x3-mezclada": { sinViga: { mediana: 0.015, maximo: 0.04, masDe10: 0, masDe20: 0 } },
};

const grupo = (m: ReferenciaFina, g: "vigas" | "conViga" | "sinViga") =>
  new Map(g === "vigas" ? Object.entries(m.vigas) : Object.entries(m.franjas).filter(([k]) => m.franjasConViga.includes(k) === (g === "conViga")));
const grupoM = (m: MedidaLocal, g: "vigas" | "conViga" | "sinViga") => (g === "vigas" ? m.vigas : new Map([...m.franjas].filter(([k]) => m.franjasConViga.has(k) === (g === "conViga"))));

describe("criterio 11 de HR: precisión local junto a los pilares, con h = 0,75 frente a la referencia fina congelada", () => {
  for (const [nombre, m] of Object.entries(MODELOS_PRECISION))
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const u = UMBRALES[nombre]!;
      const medida = medirLocal(m.fisico(), m.gruesa);
      expect(medida.rigidosFuera).toBe(0);
      for (const g of ["vigas", "conViga", "sinViga"] as const) {
        const umbral = u[g];
        if (!umbral) continue;
        const d = diferenciasLocales(grupoM(medida, g), grupo(ref, g)).filter((x) => !u.excepciones?.includes(x.k));
        expect(d.length, `${g}: estaciones comparadas`).toBeGreaterThan(0);
        const abs = d.map((x) => Math.abs(x.d)).sort((a, b) => a - b);
        const mediana = abs[Math.floor(abs.length / 2)]!;
        const peores = [...d].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5).map((x) => `${x.k}: ${(100 * x.d).toFixed(1)} %`);
        expect(mediana, `${g}: mediana; peores ${peores.join("; ")}`).toBeLessThanOrEqual(umbral.mediana);
        expect(abs.at(-1)!, `${g}: máximo; peores ${peores.join("; ")}`).toBeLessThanOrEqual(umbral.maximo);
        expect(abs.filter((x) => x > 0.1).length, `${g}: > 10 %; peores ${peores.join("; ")}`).toBeLessThanOrEqual(umbral.masDe10);
        expect(abs.filter((x) => x > 0.2).length, `${g}: > 20 %; peores ${peores.join("; ")}`).toBeLessThanOrEqual(umbral.masDe20);
      }
    }, 120_000);
});
