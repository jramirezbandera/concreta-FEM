/**
 * Empotramiento parcial de los extremos de barra (CY2, `docs/fem3d/hipotesis-cype.md` §3): la
 * rigidez es la interpolación de CYPECAD α·K_biempotrada + (1 − α)·K_empotrada-articulada.
 * - criterio 3: α = 1 deja la barra igual bit a bit, y α = 0 es la liberación de los dos giros;
 * - la definición, con la solución cerrada de una viga empotrada-apoyada con α en el empotramiento;
 * - criterio 5: equilibrio con α al azar en los dos extremos, con offsets, liberaciones y cargas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { modeloAleatorio } from "../pruebas/aleatorio.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { erroresMetamorficos, RELACIONES } from "../pruebas/metamorficas.ts";
import { carga, Constructor, seccionRectangular, seccionRectangularTimoshenko, type OpcionesBarra } from "../pruebas/constructor.ts";
import { DiagramasBarras } from "./barras.ts";
import { calcular } from "./calcular.ts";
import type { SeccionBarra } from "../elementos/barra.ts";
import type { TipoSolver } from "./solucion.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const SOLVERS: TipoSolver[] = ["nucleo", "perfil"];
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const EB = seccionRectangular(0.3, 0.3);
const T = seccionRectangularTimoshenko(0.3, 0.3);
const L = 3.2;
const q = 7;

/** Pórtico en L: pilar de 3,2 m empotrado en la base y viga de 5 m apoyada (y sin girar a torsión) en su extremo, con carga en la viga. */
function portico(s: SeccionBarra, pilar?: OpcionesBarra, viga?: OpcionesBarra) {
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(0, 0, L);
  const c = m.nudo(5, 0, L);
  m.barra(a, b, s, [1, 0, 0], pilar);
  m.barra(b, c, s, [0, 0, 1], viga);
  m.apoyo(a);
  m.apoyo(c, [true, true, true, true, false, false]);
  m.caso("q", [carga(b, { fy: 3 })], [], [{ tipo: "distribuida", barra: 1, ejes: "global", qa: [0, 0, -q] }]);
  return m.modelo();
}

describe.each(SOLVERS)("empotramiento parcial (solver %s)", (solver) => {
  it("α = 1 deja la barra igual bit a bit", () => {
    const [x] = casosValidos(calcular(portico(T), { solver }));
    const [y] = casosValidos(calcular(portico(T, { empotramiento: { i: 1, j: 1 } }, { empotramiento: { i: 1 } }), { solver }));
    expect(y!.u).toEqual(x!.u);
    expect(y!.reacciones).toEqual(x!.reacciones);
    expect(y!.esfuerzosBarras).toEqual(x!.esfuerzosBarras);
  });

  it("α = 0 es la liberación de los dos giros de flexión de ese extremo", () => {
    const giros = [false, false, false, false, true, true] as const;
    const [x] = casosValidos(calcular(portico(T, { liberaciones: { j: giros } }), { solver }));
    const [y] = casosValidos(calcular(portico(T, { empotramiento: { j: 0 } }), { solver }));
    expect(y!.u).toEqual(x!.u);
    expect(y!.reacciones).toEqual(x!.reacciones);
    expect(y!.esfuerzosBarras).toEqual(x!.esfuerzosBarras);
  });

  it("la definición de CYPECAD: viga empotrada-apoyada con α en el empotramiento (solución cerrada)", () => {
    // K = α·K_biempotrada + (1 − α)·K_articulada-en-i: en el giro libre de j, k = (3 + α)·EI/L y
    // la carga, α·qL²/12 + (1 − α)·qL²/8; el momento en i es α·(qL²/12 + 2·EI·θj/L).
    for (const alfa of [0.3, 0.7, 0.05]) {
      const m = new Constructor();
      const a = m.nudo(0, 0, 0);
      const b = m.nudo(L, 0, 0);
      m.barra(a, b, EB, [0, 0, 1], { empotramiento: { i: alfa } });
      m.apoyo(a);
      m.apoyo(b, [true, true, true, true, false, true]);
      m.caso("q", [], [], [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -q] }]);
      const [c] = casosValidos(calcular(m.modelo(), { solver }));
      const EI = EB.E * EB.Iy;
      const th = (q * L ** 3 * (alfa / 12 + (1 - alfa) / 8)) / ((3 + alfa) * EI);
      const Mi = alfa * ((q * L ** 2) / 12 + (2 * EI * th) / L);
      expect(rel(Math.abs(c!.u[6 * b + 4]!), th)).toBeLessThan(1e-12);
      expect(rel(Math.abs(c!.reacciones[4]!), Mi)).toBeLessThan(1e-12);
      // reacciones verticales: Ri = qL/2 + Mi/L
      expect(rel(c!.reacciones[2]!, (q * L) / 2 + Mi / L)).toBeLessThan(1e-12);
      // y el diagrama cierra con los esfuerzos de extremo: momento nulo en j
      const d = new DiagramasBarras(m.modelo()).diagrama(0, 0, c!);
      expect(Math.abs(d.esfuerzosEn(L)[4]!)).toBeLessThan(1e-9 * Mi);
      expect(rel(Math.abs(d.esfuerzosEn(0)[4]!), Mi)).toBeLessThan(1e-12);
    }
  });

  it("equilibrio con α al azar en los dos extremos, offsets, liberaciones y cargas de barra", () => {
    let semilla = 12345;
    const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 20; k++) {
      const modelo = portico(
        k % 2 ? T : EB,
        { empotramiento: { i: azar(), j: azar() }, offsets: { j: [0, 0, -0.15] } },
        { empotramiento: { i: azar() }, liberaciones: k % 3 ? undefined : { j: [false, false, false, true, false, false] } },
      );
      const r = calcular(modelo, { solver });
      const [c] = casosValidos(r);
      expect(c!.equilibrio.fuerzas).toBeLessThan(1e-9);
      expect(c!.equilibrio.momentos).toBeLessThan(1e-9);
    }
  });

  it("un coeficiente fuera de [0, 1] es un error del modelo", () => {
    expect(calcular(portico(T, { empotramiento: { i: -0.1 } }), { solver }).valido).toBe(false);
    const r = calcular(portico(T, { empotramiento: { j: 1.5 } }), { solver });
    expect(r.diagnosticos.some((d) => d.codigo === "modelo/propiedad-no-valida" && d.severidad === "error")).toBe(true);
  });
});

describe("criterio 5 de CY: la batería metamórfica de E6 con empotramientos al azar", () => {
  it("40 modelos aleatorios con α en la mitad de las barras: todas las relaciones a ≤ 1e-10, determinismo exacto", () => {
    const peores = Object.fromEntries(RELACIONES.map((k) => [k, 0])) as Record<string, number>;
    for (let s = 1; s <= 40; s++) {
      const ma = modeloAleatorio(s);
      let semilla = s;
      const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      const barras = ma.modelo.barras!.map((b, k) => (k % 2 ? b : { ...b, empotramiento: { i: azar(), j: azar() < 0.5 ? 1 : azar() } }));
      const e = erroresMetamorficos({ ...ma, modelo: { ...ma.modelo, barras } }, s);
      for (const k of RELACIONES) peores[k] = Math.max(peores[k]!, e[k]);
    }
    expect(peores.determinismo).toBe(0);
    for (const k of RELACIONES) expect(peores[k], k).toBeLessThan(1e-10);
  }, 300_000);
});
