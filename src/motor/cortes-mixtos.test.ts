/**
 * Cortes por «campos» en una malla no estructurada (C2-2). Un corte que atraviesa láminas y además
 * pasa por vértices o va a trozos por lados de la malla contaba dos veces lo que pasa por esos nudos:
 * sumaba las fuerzas nodales de las láminas del lado A que tocan el plano y la integral de las que lo
 * atraviesan (+38 % en la placa de Navier en x = 3, que pasa por la retícula de la malla de C2).
 * Ahora un corte mixto va entero por campos. Placa de Navier de E3 (6 × 4 m) mallada por C2, frente
 * a la integral de la serie de Mindlin a lo ancho de la placa y en una banda central.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { B, CASOS_NAVIER, placaNavier } from "../../validacion/e3/navier.ts";
import { cortarModelo } from "../../validacion/e5/bandas.ts";
import { navierFisico } from "../../validacion/c2/navier.ts";
import { compilar } from "../compilador/compilar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { navierMindlin } from "../pruebas/navier.ts";
import type { Corte } from "./cortes.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const S = [0.0694318442029737, 0.3300094782075719, 0.6699905217924281, 0.9305681557970263];
const W = [0.1739274225687269, 0.3260725774312731, 0.3260725774312731, 0.1739274225687269];
function integral(f: (y: number) => number, y0: number, y1: number): number {
  let r = 0;
  const n = 128;
  for (let i = 0; i < n; i++) for (let q = 0; q < 4; q++) r += (W[q]! * (y1 - y0) * f(y0 + ((i + S[q]!) * (y1 - y0)) / n)) / n;
  return r;
}

describe("cortes por campos en una malla no estructurada (C2-2)", () => {
  it("la placa de Navier mallada por C2: ∫Mx dy a ≤ 1 % también por los vértices de la malla", () => {
    const c = CASOS_NAVIER[0]!;
    const p = placaNavier(c);
    const modelo = valido(compilar(navierFisico(c), { tamanoMalla: 0.25 })).modelo;
    const xs = [1.3, 2.17, 3.0];
    const anchos = [B / 2, 0.7];
    const cortes: Corte[] = xs.flatMap((x) => anchos.map((a): Corte => ({ origen: [x, B / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-a, a], metodo: "campos" })));
    const r = cortarModelo(modelo, cortes);
    xs.forEach((x, i) =>
      anchos.forEach((a, j) => {
        const exacta = integral((y) => navierMindlin(p, x, y, 151)[1], B / 2 - a, B / 2 + a);
        expect(Math.abs(r[2 * i + j]!.esfuerzos[4]! / exacta - 1), `x = ${x}, ancho ${2 * a}`).toBeLessThan(0.01);
      }),
    );
  });
});
