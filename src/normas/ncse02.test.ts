/**
 * VS3 (`docs/fem3d/viento-sismo.md` §5): el emplazamiento y el espectro de la NCSE-02.
 * - Lo copiado de Concreta (cap. 2, ν, el espectro elástico y el método simplificado del art. 3.7), contra
 *   sus valores congelados (`validacion/vs3/oraculo-concreta.ts`), a 1e-12.
 * - El coeficiente αᵢ del análisis por espectros (art. 3.6.2.2), que no está en Concreta, contra el
 *   texto de la norma, escrito aquí aparte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  amplificacionTerreno,
  COEFICIENTE_RIESGO,
  COEFICIENTE_TERRENO,
  coeficienteModal,
  coeficienteTerrenoPonderado,
  emplazamiento,
  espectroElastico,
  factorAmortiguamiento,
  modosSimplificado,
  periodoFundamental,
  simplificado,
  type SistemaEstructural,
  type TipoTerreno,
} from "./ncse02.ts";

interface CasoConcreta {
  nombre: string;
  ab: number;
  K: number;
  importancia: "normal" | "especial";
  terreno: TipoTerreno | { C: number; espesor: number }[];
  sistema: SistemaEstructural;
  mu: number;
  omega: number;
  pesos: number[];
  L: number;
  TF?: number;
  H: number;
  h: number[];
  emplazamiento: { ab: number; K: number; rho: number; C: number; S: number; ac: number; TA: number; TB: number };
  nu: number;
  beta: number;
  espectro: { T: number; alfa: number }[];
  simplificado: { TF: number; modos: number; cortantes: number[]; fuerzas: number[]; basal: number };
}

const CONCRETA = (JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "ncse02-concreta.json"), "utf8")) as { casos: CasoConcreta[] }).casos;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

describe("NCSE-02: lo copiado de Concreta", () => {
  it.each(CONCRETA.map((c) => [c.nombre, c] as const))("%s: emplazamiento, ν, β y espectro elástico", (_n, c) => {
    const C = typeof c.terreno === "string" ? COEFICIENTE_TERRENO[c.terreno] : coeficienteTerrenoPonderado(c.terreno);
    const e = emplazamiento(c.ab, c.K, COEFICIENTE_RIESGO[c.importancia], C);
    for (const k of ["rho", "C", "S", "ac", "TA", "TB"] as const) expect(rel(e[k], c.emplazamiento[k]), k).toBeLessThan(1e-12);
    const nu = factorAmortiguamiento(c.omega);
    expect(rel(nu, c.nu)).toBeLessThan(1e-12);
    expect(rel(nu / c.mu, c.beta)).toBeLessThan(1e-12);
    for (const p of c.espectro) expect(rel(espectroElastico(p.T, e.TA, e.TB), p.alfa), `α(${p.T})`).toBeLessThan(1e-12);
  });

  it.each(CONCRETA.map((c) => [c.nombre, c] as const))("%s: periodo fundamental, modos y cortantes del método simplificado", (_n, c) => {
    const TF = c.TF ?? periodoFundamental(c.sistema, { n: c.h.length, H: c.H, L: c.L, B: 0 })!;
    expect(rel(TF, c.simplificado.TF)).toBeLessThan(1e-12);
    expect(modosSimplificado(TF)).toBe(c.simplificado.modos);
    const s = simplificado(
      c.h.map((h, k) => ({ h, P: c.pesos[k]! })),
      TF,
      c.H,
      c.emplazamiento.ac,
      c.beta,
      c.emplazamiento.TB,
    );
    expect(s.modos).toBe(c.simplificado.modos);
    expect(rel(s.basal, c.simplificado.basal)).toBeLessThan(1e-12);
    s.cortantes.forEach((v, k) => expect(rel(v, c.simplificado.cortantes[k]!), `V${k + 1}`).toBeLessThan(1e-12));
  });

  it("los casos cubren uno, dos y tres modos, un periodo por debajo de TA y los estratos", () => {
    expect(new Set(CONCRETA.map((c) => c.simplificado.modos))).toEqual(new Set([1, 2, 3]));
    expect(CONCRETA.some((c) => c.simplificado.TF < c.emplazamiento.TA)).toBe(true);
    expect(CONCRETA.some((c) => typeof c.terreno !== "string")).toBe(true);
  });
});

describe("NCSE-02: el texto de la norma", () => {
  it("art. 2.2: S por tramos de ρ·ab, continua en 0,1 g y en 0,4 g", () => {
    // ρ·ab ≤ 0,1 g: C/1,25
    expect(amplificacionTerreno(1.6, 1, 0.08)).toBeCloseTo(1.6 / 1.25, 14);
    // 0,1 g < ρ·ab < 0,4 g: C/1,25 + 3,33·(ρ·ab − 0,1)·(1 − C/1,25); con C = 1,6 y ρ·ab = 0,23, 1,28 − 0,121212
    expect(amplificacionTerreno(1.6, 1, 0.23)).toBeCloseTo(1.28 + 3.33 * 0.13 * (1 - 1.28), 14);
    expect(amplificacionTerreno(1.6, 1.3, 0.2)).toBeCloseTo(1.28 + 3.33 * 0.16 * (1 - 1.28), 14);
    // 0,4 g ≤ ρ·ab: 1,0
    expect(amplificacionTerreno(2, 1, 0.4)).toBe(1);
    for (const C of [1, 1.3, 1.6, 2]) {
      expect(amplificacionTerreno(C, 1, 0.1 + 1e-12)).toBeCloseTo(amplificacionTerreno(C, 1, 0.1), 9);
      // en 0,4 g la expresión intermedia da C/1,25 + 0,999·(1 − C/1,25): a un 0,1 % de 1 (el 3,33 de la norma no es 1/0,3)
      expect(Math.abs(amplificacionTerreno(C, 1, 0.4 - 1e-12) - 1)).toBeLessThan(1e-3);
    }
  });

  it("art. 2.4: C ponderado en los 30 primeros metros, con el último estrato prolongado", () => {
    expect(coeficienteTerrenoPonderado([{ C: 1.3, espesor: 10 }, { C: 2, espesor: 20 }])).toBeCloseTo((1.3 * 10 + 2 * 20) / 30, 14);
    // 12 m de tipo III sobre roca que no se describe hasta los 30 m: los 18 m que faltan, como el último
    expect(coeficienteTerrenoPonderado([{ C: 1.6, espesor: 12 }])).toBeCloseTo(1.6, 14);
    // lo que pasa de 30 m no cuenta
    expect(coeficienteTerrenoPonderado([{ C: 1.0, espesor: 30 }, { C: 2, espesor: 50 }])).toBe(1);
  });

  it("art. 2.3: el espectro elástico, continuo en TA y en TB, y K·C/T por encima", () => {
    const [K, C] = [1.1, 1.6];
    const { TA, TB } = emplazamiento(0.1, K, 1, C);
    expect(TA).toBeCloseTo((K * C) / 10, 14);
    expect(TB).toBeCloseTo((K * C) / 2.5, 14);
    expect(espectroElastico(0, TA, TB)).toBe(1);
    expect(espectroElastico(TA / 2, TA, TB)).toBeCloseTo(1.75, 14);
    expect(espectroElastico(TA * (1 - 1e-12), TA, TB)).toBeCloseTo(2.5, 9);
    expect(espectroElastico(TB, TA, TB)).toBe(2.5);
    for (const T of [TB * 1.0001, 1, 2.7]) expect(espectroElastico(T, TA, TB)).toBeCloseTo((K * C) / T, 12);
  });

  it("art. 3.6.2.2: αᵢ = α(Tᵢ)·β con Tᵢ ≥ TA, y 1 + (2,5·β − 1)·Tᵢ/TA por debajo", () => {
    const [TA, TB] = [0.16, 0.64];
    for (const beta of [1, 0.5, 0.25, 1.1]) {
      // un modo muy rígido se mueve con el suelo: 1, sin reducir
      expect(coeficienteModal(0, TA, TB, beta)).toBe(1);
      // lineal hasta 2,5·β en TA, y continua allí
      expect(coeficienteModal(TA / 4, TA, TB, beta)).toBeCloseTo(1 + (2.5 * beta - 1) / 4, 14);
      expect(coeficienteModal(TA * (1 - 1e-12), TA, TB, beta)).toBeCloseTo(2.5 * beta, 9);
      expect(coeficienteModal(TA, TA, TB, beta)).toBeCloseTo(2.5 * beta, 14);
      expect(coeficienteModal(0.4, TA, TB, beta)).toBeCloseTo(2.5 * beta, 14);
      expect(coeficienteModal(1.28, TA, TB, beta)).toBeCloseTo(1.25 * beta, 14);
    }
    // No es β·(1 + 1,5·T/TA): con β = 0,5, a la mitad de TA la norma da 1,125 y eso daría 0,875
    expect(coeficienteModal(TA / 2, TA, TB, 0.5)).toBeCloseTo(1.125, 14);
    expect(0.5 * espectroElastico(TA / 2, TA, TB)).toBeCloseTo(0.875, 14);
    // Sin ductilidad ni amortiguamiento distinto del 5 % (β = 1), es el espectro elástico
    for (const T of [0, 0.05, 0.16, 0.3, 0.64, 1.5]) expect(coeficienteModal(T, TA, TB, 1)).toBeCloseTo(espectroElastico(T, TA, TB), 14);
  });

  it("art. 2.4: con C > 1,8 y el periodo fundamental mayor que TB, α = 2,5 por encima de TB", () => {
    const [TA, TB] = [0.2, 0.8];
    expect(espectroElastico(1.6, TA, TB)).toBeCloseTo(1.25, 14);
    expect(espectroElastico(1.6, TA, TB, true)).toBe(2.5);
    expect(coeficienteModal(1.6, TA, TB, 0.5, true)).toBeCloseTo(1.25, 14);
    // por debajo de TB no cambia nada
    for (const T of [0, 0.1, 0.2, 0.5, 0.8]) expect(coeficienteModal(T, TA, TB, 0.5, true)).toBe(coeficienteModal(T, TA, TB, 0.5));
  });

  it("art. 2.5: ν = (5/Ω)^0,4", () => {
    expect(factorAmortiguamiento(5)).toBe(1);
    expect(factorAmortiguamiento(4)).toBeCloseTo(1.25 ** 0.4, 14);
    expect(factorAmortiguamiento(10)).toBeCloseTo(0.5 ** 0.4, 14);
  });
});
