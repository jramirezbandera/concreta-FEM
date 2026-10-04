/**
 * Criterios 1 y 2 de C3 (detalle y mallas en validacion/c3/out_etabs15.txt y out_oraculos.txt):
 * - los muros de ETABS 15 descritos como modelo físico dan lo mismo que el modelo a mano de E6 con
 *   la misma malla, y los valores de SAP2000 con la tolerancia de E6;
 * - el muro en voladizo, el muro de sótano con empuje, la losa sobre dos muros y la viga en el plano
 *   de un muro, frente a sus soluciones de referencia, con la malla por defecto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { murosEtabs15, resultadosMuro } from "../../validacion/e6/etabs15.ts";
import { resultadosFisico } from "../../validacion/c3/etabs15.ts";
import { losaMuros, sotano, vigaMuro, voladizo } from "../../validacion/c3/oraculos.ts";
import { TAMANO_MALLA } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Diferencia admisible con un valor publicado: la tolerancia relativa o su redondeo, la mayor (E6). */
function admisible(publicado: number, tolRel: number): number {
  const decimales = publicado.toString().split(".")[1]?.length ?? 0;
  return Math.max(tolRel * Math.abs(publicado), 0.5 * 10 ** -decimales);
}

describe("criterio 1 de C3: ETABS 15 como modelo físico", () => {
  const muros = murosEtabs15().filter((m) => ["15a-3-120", "15a-1-360", "15b", "15c-3-60", "15e-3", "15f-3", "15d-3"].includes(m.id));

  it("con la misma malla que el modelo a mano de E6 (15a, 15b, 15c, 15e, 15f): los mismos desplazamientos a ≤ 1e-9", () => {
    for (const m of muros.filter((x) => !x.id.startsWith("15d"))) {
      const h = m.h(1);
      const f = resultadosFisico(m, h);
      const a = resultadosMuro(m, h);
      expect(f.laminas, m.id).toBe(a.laminas);
      for (const k of Object.keys(m.sap)) expect(Math.abs(f[k]! / a[k]! - 1), `${m.id} ${k}`).toBeLessThan(1e-9);
    }
  });

  it("15a, 15e y 15f con la malla del compilador: los valores de SAP2000 con la tolerancia de E6", () => {
    for (const m of muros.filter((x) => /^15[aef]/.test(x.id))) {
      const f = resultadosFisico(m, m.h(1));
      for (const k of Object.keys(m.sap)) expect(Math.abs(f[k]! - m.sap[k]!), `${m.id} ${k}`).toBeLessThanOrEqual(admisible(m.sap[k]!, m.plantas === 6 ? 0.02 : 0.05));
    }
  });

  it("15d (otra malla: 8 elementos en cada ala, H17): a ≤ 1 % del modelo a mano de E6 con su malla más fina", () => {
    const m = muros.find((x) => x.id === "15d-3")!;
    const f = resultadosFisico(m, m.h(1));
    const a = resultadosMuro(m, m.h(2));
    for (const k of Object.keys(m.sap)) expect(Math.abs(f[k]! / a[k]! - 1), `${m.id} ${k}`).toBeLessThan(0.01);
  });
});

describe("criterio 2 de C3: oráculos analíticos con la malla por defecto", () => {
  it("muro en voladizo de 3 plantas frente a Timoshenko: ≤ 2 %", () => {
    expect(Math.abs(voladizo(TAMANO_MALLA).error)).toBeLessThan(0.02);
  });

  it("muro de sótano con empuje hidrostático (flexión cilíndrica): flecha y momento a ≤ 1 %", () => {
    const r = sotano(TAMANO_MALLA);
    expect(Math.abs(r.errorW)).toBeLessThan(0.01);
    expect(r.errorM).toBeLessThan(0.01);
  });

  it("losa sobre dos muros frente al pórtico equivalente: momento en el encuentro (corte) y en el vano a ≤ 2 %", () => {
    const r = losaMuros(TAMANO_MALLA);
    expect(Math.abs(r.errorExtremo)).toBeLessThan(0.02);
    expect(Math.abs(r.errorVano)).toBeLessThan(0.02);
  });

  it("viga en el plano de un muro (C3-e): a ≤ 3 % del modelo embebido de E0 y ≤ 2 veces la solución rígida (H05)", () => {
    const r = vigaMuro(TAMANO_MALLA);
    expect(r.auxiliares).toBe(2);
    expect(Math.abs(r.frenteE0)).toBeLessThan(0.03);
    expect(r.frenteRigida).toBeLessThan(2);
  });
});
