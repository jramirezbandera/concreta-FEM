/**
 * Criterio 2 de E6: los muros del ejemplo 15 de ETABS (S5 #1) con la malla gruesa de cada uno.
 * Modelos, fuentes y el «modelado de SAP2000» en validacion/e6/etabs15.ts; las tres mallas, la
 * extrapolación y la tabla completa, en validacion/e6/out_etabs15.txt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { lecturas, modeloMuro, murosEtabs15, resultadosMuro, type MuroEtabs } from "../../validacion/e6/etabs15.ts";
import { iniciarNucleo } from "../nucleo/index.ts";

const opensees = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-e6.json"), "utf8"));
const muros = murosEtabs15();
const gruesa = new Map<string, Record<string, number>>();

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  for (const m of muros) gruesa.set(m.id, resultadosMuro(m, m.h(0)));
});

/** Las mismas magnitudes leídas en los desplazamientos de OpenSees (malla h(0)). */
function deOpenSees(m: MuroEtabs): Record<string, number> {
  const res = opensees[`${m.id}@${m.h(0)}`];
  const { maestros } = modeloMuro(m, m.h(0));
  const u = m.direcciones.map((d) => {
    const v = new Float64Array(6 * (Math.max(...maestros) + 1));
    for (const n of maestros) v.set(res[d][String(n)], 6 * n);
    return v;
  });
  return lecturas(m, maestros, u);
}

/** Diferencia admisible con un valor publicado: la tolerancia relativa o su redondeo, la mayor. */
function admisible(publicado: number, tolRel: number): number {
  const decimales = publicado.toString().split(".")[1]?.length ?? 0;
  return Math.max(tolRel * Math.abs(publicado), 0.5 * 10 ** -decimales);
}

describe("criterio 2 de E6: muros de ETABS 15", () => {
  it("frente a OpenSeesPy ASDShellQ4 con la misma malla: ≤ 0,5 % (≤ 1,1 % en los muros de una planta)", () => {
    for (const m of muros) {
      const os = deOpenSees(m);
      const motor = gruesa.get(m.id)!;
      for (const k of Object.keys(m.sap)) {
        expect(Math.abs(motor[k]! / os[k]! - 1), `${m.id} ${k}`).toBeLessThan(m.plantas === 1 ? 0.011 : 0.005);
      }
    }
  });

  it("15a, 15e y 15f con la geometría del PDF: a ≤ 2 % de SAP2000 en 6 plantas y ≤ 5 % en 1 y 3 (o su redondeo)", () => {
    for (const m of muros.filter((m) => /^15[aef]/.test(m.id))) {
      const motor = gruesa.get(m.id)!;
      for (const k of Object.keys(m.sap)) {
        const ref = m.sap[k]!;
        expect(Math.abs(motor[k]! - ref), `${m.id} ${k}: ${motor[k]} frente a ${ref}`).toBeLessThanOrEqual(admisible(ref, m.plantas === 6 ? 0.02 : 0.05));
      }
    }
  });

  it("15b, 15c y 15d con el modelado de SAP2000 (E6-2): a ≤ 1,2 % de SAP2000 (o su redondeo)", () => {
    for (const m of muros.filter((m) => /^15[bcd]/.test(m.id))) {
      const r = resultadosMuro(m, m.modeladoSap.h, m.modeladoSap);
      for (const k of Object.keys(m.sap)) {
        const ref = m.sap[k]!;
        expect(Math.abs(r[k]! - ref), `${m.id} ${k}: ${r[k]} frente a ${ref}`).toBeLessThanOrEqual(admisible(ref, 0.012));
      }
    }
  });
});
