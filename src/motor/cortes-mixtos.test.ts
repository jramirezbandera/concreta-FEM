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
import { generador, modeloAleatorio } from "../pruebas/aleatorio.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { calcular } from "./calcular.ts";
import { CamposLaminas } from "./campos.ts";
import { Cortes, type Corte } from "./cortes.ts";
import type { ModeloAnalitico } from "./modelo.ts";

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

describe("A2-17: los nudos del plano que el corte sólo toca en un punto", () => {
  /**
   * Cortes al azar por campos (los del auditor de A2-17) en modelos aleatorios: dos rectángulos
   * complementarios suman el entero. Antes, una parte que no atravesaba nada iba por fuerzas nodales y
   * contaba la lámina que toca el plano sólo en un vértice (en el extremo del rectángulo o justo
   * pasado él), que la integral de campos del entero no ve: hasta 24 veces el mayor esfuerzo.
   */
  function cortesAlAzar(modelo: ModeloAnalitico, r: () => number, n: number): Corte[] {
    const nd = modelo.nudos;
    const cs: Corte[] = [];
    for (let i = 0; i < n; i++) {
      const v = nd[Math.floor(r() * nd.length)]!;
      const porNudo = r() < 0.6;
      const O: [number, number, number] = porNudo ? [v.x, v.y, v.z] : [v.x + (r() - 0.5), v.y + (r() - 0.5), v.z + (r() < 0.5 ? 0 : r() - 0.5)];
      const tipo = r();
      let x: [number, number, number];
      let vz: [number, number, number] = [0, 0, 1];
      if (tipo < 0.35) x = r() < 0.5 ? [1, 0, 0] : [0, 1, 0];
      else if (tipo < 0.55) {
        x = [0, 0, r() < 0.5 ? 1 : -1];
        vz = [1, 0, 0];
      } else if (tipo < 0.75) {
        const w = nd[Math.floor(r() * nd.length)]!;
        const d = [w.x - v.x, w.y - v.y];
        x = Math.hypot(d[0]!, d[1]!) > 1e-6 ? [-d[1]!, d[0]!, 0] : [1, 0, 0];
      } else {
        const a = r() * 6.28;
        x = [Math.cos(a), Math.sin(a), (r() - 0.5) * 0.4];
      }
      const L = r() < 0.2 ? 0 : r() * 4;
      const y: [number, number] = r() < 0.5 ? [-L, L] : [0, L];
      const z: [number, number] = r() < 0.6 ? [0, 0] : [-r() * 3, r() * 3];
      cs.push({ id: `c${i}`, origen: O, x, vz, y, z, metodo: r() < 0.5 ? "campos" : "fuerzas-nodales", soloLaminas: r() < 0.3, cuadratura: r() < 0.3 ? 2 : 4 });
    }
    return cs.filter((c) => c.metodo === "campos");
  }

  it.each([1, 5, 34, 55])("modelo aleatorio %i: los complementarios por campos suman el entero", (semilla) => {
    const modelo = modeloAleatorio(semilla).modelo;
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    const cl = new CamposLaminas(modelo);
    const r = generador(77);
    const rm = generador(5);
    let comparados = 0;
    for (const c of cortesAlAzar(modelo, r, 400)) {
      const a = ct.cortar(c, casos, cl);
      if (!a.valido || c.y![1] - c.y![0] < 0.5 || a.esfuerzos.some(Number.isNaN)) continue;
      const ym = c.y![0] + (0.2 + 0.6 * rm()) * (c.y![1] - c.y![0]);
      const p1 = ct.cortar({ ...c, y: [c.y![0], ym] }, casos, cl);
      const p2 = ct.cortar({ ...c, y: [ym, c.y![1]] }, casos, cl);
      if (!p1.valido || !p2.valido || [...p1.esfuerzos, ...p2.esfuerzos].some(Number.isNaN)) continue;
      const esc = Math.max(...[...a.esfuerzos].map(Math.abs));
      if (esc < 1e-9) continue;
      comparados++;
      for (let q = 0; q < a.esfuerzos.length; q++) expect(Math.abs(p1.esfuerzos[q]! + p2.esfuerzos[q]! - a.esfuerzos[q]!) / esc, `${c.id}, componente ${q}`).toBeLessThan(1e-3);
    }
    expect(comparados).toBeGreaterThan(20);
  });
});
