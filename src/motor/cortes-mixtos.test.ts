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
import { mensulaPlaca } from "../../validacion/e5/cortes.ts";
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
    // Sin rejilla: la regresión es de una malla no estructurada
    const modelo = valido(compilar(navierFisico(c), { tamanoMalla: 0.25, rejilla: false })).modelo;
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

describe("AU-7: una lámina atravesada con el centroide fuera del rectángulo", () => {
  /** Ménsula de 2 × 2 con la malla regular hasta y = 1 e inclinada por encima (los nudos interiores, x += 0,2·(y − 1)). */
  function inclinada() {
    const m = mensulaPlaca(4, 4, 2, 2, 4);
    m.nudos.forEach((n) => {
      if (n.y > 1 + 1e-9 && n.x > 1e-9 && n.x < 2 - 1e-9) (n as { x: number }).x += 0.2 * (n.y - 1);
    });
    return m;
  }
  const corte = (y: [number, number], metodo?: "campos"): Corte => ({ origen: [1, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y, ...(metodo ? { metodo } : {}) });

  it("por fuerzas nodales, el corte que entra en ella lo avisa (antes salía sin diagnóstico)", () => {
    const [r] = cortarModelo(inclinada(), [corte([0, 1.1])]);
    // Sigue valiendo para lo que pasa por sus nudos (las ventanas de las franjas lo usan así)
    expect(r!.valido).toBe(true);
    const d = r!.diagnosticos.find((x) => x.codigo === "corte/borde-no-sigue-malla");
    expect(d?.severidad).toBe("aviso");
    expect(d?.mensaje).toMatch(/centroide fuera/);
  });

  it("por campos, va entero por campos: dos rectángulos complementarios suman el corte entero", () => {
    const [a, b, todo] = cortarModelo(inclinada(), [corte([0, 1.1], "campos"), corte([1.1, 2], "campos"), corte([0, 2], "campos")]);
    for (const r of [a, b, todo]) expect(r!.valido).toBe(true);
    // Cada rectángulo se recorta con TOL_CORTE (1e-6 m) de más por cada lado: ~1e-6 de diferencia.
    // Antes, el de abajo sumaba fuerzas nodales con la integral de la lámina atravesada: 1,7e-3.
    const escala = Math.max(...[...todo!.esfuerzos].map(Math.abs));
    for (let q = 0; q < 6; q++) expect(Math.abs(a!.esfuerzos[q]! + b!.esfuerzos[q]! - todo!.esfuerzos[q]!) / escala, `componente ${q}`).toBeLessThan(1e-5);
  });
});
