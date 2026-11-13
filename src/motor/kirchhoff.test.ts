/**
 * A2-14 y AU-18: la fuerza de borde de Kirchhoff de los cortes por campos. Placa de 6 × 6 con carga
 * uniforme, corte de borde a borde, frente al cortante exacto del modelo (la carga y las reacciones de
 * un lado). Antes, un borde apoyado en uz no la llevaba (+88 % con h = 0,75) y uno libre la llevaba
 * entera también con h < t (+6 %). Medida completa en `validacion/au2/kirchhoff.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { Constructor } from "../pruebas/constructor.ts";
import { mallaRectangular } from "../pruebas/placa.ts";
import { calcular } from "./calcular.ts";
import { CamposLaminas, pesoKirchhoff } from "./campos.ts";
import { Cortes } from "./cortes.ts";
import type { CargaLamina } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const q = -10;
/** Error relativo del Vz de un corte por campos en x ≈ x0 de la placa. */
function errorVz(tipo: "apoyada" | "esquinas", t: number, h: number, x0: number, giroCoartado = false): number {
  const n = Math.round(6 / h);
  const m = new Constructor();
  const g = mallaRectangular(m, { a: 6, b: 6, nx: n, ny: n, material: { E: 3e7, nu: 0.2, t } });
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const borde = i === 0 || j === 0 || i === n || j === n;
      const esquina = (i === 0 || i === n) && (j === 0 || j === n);
      // Con `giroCoartado`, empotrada (uz, rx y ry en los cuatro lados)
      if (tipo === "apoyada" ? borde : esquina) m.apoyo(g.nudos[i]![j]!, [i === 0 && j === 0, (i === 0 && j === 0) || (i === n && j === 0), true, giroCoartado, giroCoartado, false]);
    }
  m.caso("q", [], [], [], g.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, q] })));
  const modelo = m.modelo();
  const casos = casosValidos(calcular(modelo));
  const x = (Math.floor(x0 / h) + 0.5) * h;
  let Fz = q * 6 * x;
  const R = casos[0]!.reacciones;
  modelo.nudos.forEach((nd, v) => {
    if (nd.x < x) Fz += R[6 * v + 2]!;
  });
  const r = new Cortes(modelo).cortar({ origen: [x, 3, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-3, 3], metodo: "campos" }, casos, new CamposLaminas(modelo));
  return r.esfuerzos[2]! / -Fz - 1;
}

describe("A2-14: la fuerza de borde de Kirchhoff, también en un borde apoyado sólo en uz, con su peso", () => {
  it("el peso: 0 hasta h = 0,4·t y casi 1 desde h = 2·t", () => {
    expect(pesoKirchhoff(0.3)).toBe(0);
    expect(pesoKirchhoff(0.5)).toBeCloseTo(0.26, 2);
    expect(pesoKirchhoff(1)).toBeCloseTo(0.83, 2);
    expect(pesoKirchhoff(2)).toBeGreaterThan(0.99);
  });

  it.each([0.75, 0.25, 0.125])("placa apoyada en uz en sus cuatro lados, h = %f: Vz a ≤ 3 % (antes +88 % con 0,75)", (h) => {
    for (const x0 of [1.2, 2.2]) expect(Math.abs(errorVz("apoyada", 0.25, h, x0)), `x ≈ ${x0}`).toBeLessThan(0.03);
  });

  it("placa sobre sus esquinas (bordes libres) con h = t/2: Vz a ≤ 1 % (antes +6 %)", () => {
    for (const x0 of [1.2, 2.2]) expect(Math.abs(errorVz("esquinas", 0.25, 0.125, x0)), `x ≈ ${x0}`).toBeLessThan(0.01);
  });

  it("un borde empotrado no lleva la fuerza de borde (el Mxy de Kirchhoff se anula en él)", () => {
    // Sin ella, a ≤ 2 % con h ≤ 2·t; con ella entera, −3…−8 % (`validacion/au2/kirchhoff.ts`)
    expect(Math.abs(errorVz("apoyada", 0.25, 0.5, 1.2, true))).toBeLessThan(0.03);
    expect(Math.abs(errorVz("apoyada", 0.25, 0.25, 1.2, true))).toBeLessThan(0.03);
  });
});
