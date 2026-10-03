/**
 * Barras de E2 en el motor: convenio de signos (H02) en tres orientaciones, soluciones cerradas
 * de Timoshenko, offsets (zona rígida y punto de inserción), liberaciones, cargas sin trocear
 * (una barra = N barras), equilibrio con cargas de barra y diagnósticos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SeccionBarra } from "../elementos/barra.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO, seccionRectangular, seccionRectangularTimoshenko, type OpcionesBarra } from "../pruebas/constructor.ts";
import { DiagramasBarras } from "./barras.ts";
import { calcular } from "./calcular.ts";
import type { CargaBarra, ModeloAnalitico, Vec3 } from "./modelo.ts";
import type { TipoSolver } from "./solucion.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const SOLVERS: TipoSolver[] = ["nucleo", "perfil"];
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const T = seccionRectangularTimoshenko(0.3, 0.5);
const EB = seccionRectangular(0.3, 0.5);

/** Esfuerzos [N, Vy, Vz, T, My, Mz] de la barra b en i' (lado 0) o j' (lado 1). */
const esfuerzos = (e: Float64Array, b: number, lado: 0 | 1) => Array.from(e.subarray(12 * b + 6 * lado, 12 * b + 6 * lado + 6));

/** Ménsula de longitud L desde el origen en la dirección `eje`, empotrada en el nudo 0. */
function mensula(L: number, eje: Vec3, vz: Vec3, s: SeccionBarra, opciones?: OpcionesBarra) {
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(L * eje[0], L * eje[1], L * eje[2]);
  m.barra(a, b, s, vz, opciones);
  m.apoyo(a);
  return { m, a, b };
}

describe.each(SOLVERS)("barras (solver %s)", (solver) => {
  describe("convenio de signos (H02): ménsula de 2 m con carga en la punta en ejes locales", () => {
    // [eje x local, vz] y los ejes locales (x, y, z) que resultan
    const orientaciones: { nombre: string; x: Vec3; vz: Vec3; y: Vec3 }[] = [
      { nombre: "según +X, canto Z", x: [1, 0, 0], vz: [0, 0, 1], y: [0, 1, 0] },
      { nombre: "según +Y, canto Z", x: [0, 1, 0], vz: [0, 0, 1], y: [-1, 0, 0] },
      { nombre: "pilar según +Z, canto X", x: [0, 0, 1], vz: [1, 0, 0], y: [0, -1, 0] },
    ];
    // carga local en la punta → esfuerzos en el empotramiento (tabla de H02, con CSI)
    const casos: { carga: number[]; esperado: number[] }[] = [
      { carga: [1, 0, 0, 0, 0, 0], esperado: [1, 0, 0, 0, 0, 0] },
      { carga: [0, -1, 0, 0, 0, 0], esperado: [0, -1, 0, 0, 0, -2] },
      { carga: [0, 0, -1, 0, 0, 0], esperado: [0, 0, -1, 0, -2, 0] },
      { carga: [0, 0, 0, 1, 0, 0], esperado: [0, 0, 0, 1, 0, 0] },
      { carga: [0, 0, 0, 0, 1, 0], esperado: [0, 0, 0, 0, -1, 0] },
      { carga: [0, 0, 0, 0, 0, 1], esperado: [0, 0, 0, 0, 0, 1] },
    ];
    for (const o of orientaciones) {
      it(o.nombre, () => {
        const { m, b } = mensula(2, o.x, o.vz, T);
        const z = o.vz;
        const aGlobal = (v: number[]) => [0, 1, 2].map((c) => v[0]! * o.x[c]! + v[1]! * o.y[c]! + v[2]! * z[c]!);
        for (const [k, c] of casos.entries()) m.caso(`C${k}`, [{ nudo: b, f: [...aGlobal(c.carga.slice(0, 3)), ...aGlobal(c.carga.slice(3))] as never }]);
        const r = casosValidos(calcular(m.modelo(), { solver }));
        for (const [k, c] of casos.entries()) {
          const s = esfuerzos(r[k]!.esfuerzosBarras, 0, 0);
          for (let q = 0; q < 6; q++) expect(s[q]!, `caso ${k}, componente ${q}`).toBeCloseTo(c.esperado[q]!, 12);
        }
      });
    }

    it("biapoyada con gravedad: Vz < 0 en el apoyo izquierdo, My > 0 en el vano", () => {
      const m = new Constructor();
      const a = m.nudo(0, 0, 0);
      const b = m.nudo(6, 0, 0);
      m.barra(a, b, T, [0, 0, 1]);
      m.apoyo(a, [true, true, true, true, false, false]);
      m.apoyo(b, [false, true, true, false, false, false]);
      m.caso("G", [], [], [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -10] }]);
      const modelo = m.modelo();
      const [c] = casosValidos(calcular(modelo, { solver }));
      expect(esfuerzos(c!.esfuerzosBarras, 0, 0)[2]).toBeCloseTo(-30, 10);
      expect(esfuerzos(c!.esfuerzosBarras, 0, 1)[2]).toBeCloseTo(30, 10);
      const d = new DiagramasBarras(modelo).diagrama(0, 0, c!);
      expect(d.esfuerzosEn(3)[4]).toBeCloseTo((10 * 36) / 8, 10);
      expect(d.desplazamientosEn(3)[2]).toBeLessThan(0);
    });
  });

  describe("soluciones cerradas de Timoshenko (≤ 1e-12)", () => {
    const L = 3;
    const EIy = T.E * T.Iy;
    const EIz = T.E * T.Iz;
    const GAv = T.G * T.Avz!;

    it("ménsula con carga en la punta y con carga uniforme, en los dos planos", () => {
      const { m, b } = mensula(L, [1, 0, 0], [0, 0, 1], T);
      m.caso("Pz", [carga(b, { fz: -10 })]);
      m.caso("Py", [carga(b, { fy: -10 })]);
      m.caso("qz", [], [], [{ tipo: "distribuida", barra: 0, ejes: "local", qa: [0, 0, -4] }]);
      const [pz, py, qz] = casosValidos(calcular(m.modelo(), { solver }));
      expect(rel(pz!.u[6 * b + 2]!, -10 * (L ** 3 / (3 * EIy) + L / GAv))).toBeLessThan(1e-12);
      expect(rel(py!.u[6 * b + 1]!, -10 * (L ** 3 / (3 * EIz) + L / (T.G * T.Avy!)))).toBeLessThan(1e-12);
      expect(rel(qz!.u[6 * b + 2]!, -(4 * L ** 4 / (8 * EIy) + (4 * L ** 2) / (2 * GAv)))).toBeLessThan(1e-12);
      expect(rel(qz!.u[6 * b + 4]!, (4 * L ** 3) / (6 * EIy))).toBeLessThan(1e-12);
      expect(rel(qz!.reacciones[2]!, 4 * L)).toBeLessThan(1e-13);
      expect(rel(qz!.reacciones[4]!, -(4 * L ** 2) / 2)).toBeLessThan(1e-13);
    });

    it("biempotrada con carga uniforme: qL/2, qL²/12, qL²/24 y flecha qL⁴/384EI + qL²/8GAv", () => {
      const m = new Constructor();
      const a = m.nudo(0, 0, 0);
      const b = m.nudo(L, 0, 0);
      m.barra(a, b, T, [0, 0, 1]);
      m.apoyo(a);
      m.apoyo(b);
      m.caso("q", [], [], [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -4] }]);
      const modelo = m.modelo();
      const [c] = casosValidos(calcular(modelo, { solver }));
      expect(rel(c!.reacciones[2]!, 2 * L)).toBeLessThan(1e-13);
      expect(rel(c!.reacciones[4]!, -(4 * L ** 2) / 12)).toBeLessThan(1e-12);
      expect(rel(c!.reacciones[6 + 4]!, (4 * L ** 2) / 12)).toBeLessThan(1e-12);
      const d = new DiagramasBarras(modelo).diagrama(0, 0, c!);
      expect(rel(d.esfuerzosEn(L / 2)[4]!, (4 * L ** 2) / 24)).toBeLessThan(1e-12);
      expect(rel(d.desplazamientosEn(L / 2)[2]!, -((4 * L ** 4) / (384 * EIy) + (4 * L ** 2) / (8 * GAv)))).toBeLessThan(1e-12);
      expect(d.ceros(2).map((x) => x / L)).toEqual([expect.closeTo(0.5, 12)]);
    });

    it("empotrada-apoyada por liberación de My en j (Timoshenko, método de las fuerzas)", () => {
      const m = new Constructor();
      const a = m.nudo(0, 0, 0);
      const b = m.nudo(L, 0, 0);
      m.barra(a, b, T, [0, 0, 1], { liberaciones: { j: [false, false, false, false, true, false] } });
      m.apoyo(a);
      m.apoyo(b);
      const q = 4;
      m.caso("q", [], [], [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -q] }]);
      const modelo = m.modelo();
      const [c] = casosValidos(calcular(modelo, { solver }));
      // redundante R_B: flecha de la ménsula en B anulada
      const wq = (q * L ** 4) / (8 * EIy) + (q * L ** 2) / (2 * GAv);
      const fBB = L ** 3 / (3 * EIy) + L / GAv;
      const RB = wq / fBB;
      expect(rel(c!.reacciones[6 + 2]!, RB)).toBeLessThan(1e-12);
      expect(rel(c!.reacciones[2]!, q * L - RB)).toBeLessThan(1e-12);
      expect(rel(c!.reacciones[4]!, RB * L - (q * L ** 2) / 2)).toBeLessThan(1e-12);
      expect(Math.abs(c!.reacciones[6 + 4]!)).toBeLessThan(1e-12);
      expect(Math.abs(esfuerzos(c!.esfuerzosBarras, 0, 1)[4]!)).toBeLessThan(1e-12);
      // el giro de la rótula: el del extremo B de la viga, no el del nudo (empotrado)
      const d = new DiagramasBarras(modelo).diagrama(0, 0, c!);
      expect(c!.u[6 * b + 4]).toBe(0);
      expect(Math.abs(d.desplazamientosEn(L)[4]!)).toBeGreaterThan(1e-6);
    });
  });

  describe("offsets", () => {
    it("zonas rígidas en los extremos: la parte flexible es la biempotrada de L' y los nudos reciben el brazo", () => {
      const m = new Constructor();
      const a = m.nudo(0, 0, 0);
      const b = m.nudo(6, 0, 0);
      m.barra(a, b, T, [0, 0, 1], { offsets: { i: [0.2, 0, 0], j: [-0.25, 0, 0] } });
      m.apoyo(a);
      m.apoyo(b);
      const q = 7;
      m.caso("q", [], [], [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -q] }]);
      const [c] = casosValidos(calcular(m.modelo(), { solver }));
      const Lf = 5.55;
      expect(rel(c!.reacciones[2]!, (q * Lf) / 2)).toBeLessThan(1e-13);
      expect(rel(c!.reacciones[4]!, -(q * Lf ** 2) / 12 - (0.2 * q * Lf) / 2)).toBeLessThan(1e-12);
      expect(rel(c!.reacciones[6 + 4]!, (q * Lf ** 2) / 12 + (0.25 * q * Lf) / 2)).toBeLessThan(1e-12);
      // en las caras, el momento de empotramiento de la parte flexible
      expect(rel(esfuerzos(c!.esfuerzosBarras, 0, 0)[4]!, -(q * Lf ** 2) / 12)).toBeLessThan(1e-12);
      expect(c!.equilibrio.momentos).toBeLessThan(1e-14);
    });

    it("punto de inserción (offset lateral): axil excéntrico → My = −F·e y ux = FL/EA + F·e²·L/EI", () => {
      const e = 0.2;
      const L = 4;
      const { m, b } = mensula(L, [1, 0, 0], [0, 0, 1], T, { offsets: { i: [0, 0, -e], j: [0, 0, -e] } });
      const F = 100;
      m.caso("N", [carga(b, { fx: F })]);
      const [c] = casosValidos(calcular(m.modelo(), { solver }));
      const s = esfuerzos(c!.esfuerzosBarras, 0, 0);
      expect(rel(s[0]!, F)).toBeLessThan(1e-13);
      expect(rel(s[4]!, -F * e)).toBeLessThan(1e-12);
      expect(rel(c!.u[6 * b]!, (F * L) / (T.E * T.A) + (F * e * e * L) / (T.E * T.Iy))).toBeLessThan(1e-12);
      expect(Math.abs(c!.reacciones[4]!)).toBeLessThan(1e-11);
      expect(rel(c!.reacciones[0]!, -F)).toBeLessThan(1e-14);
    });
  });

  describe("cargas sin trocear: una barra = la misma barra troceada en los puntos de carga", () => {
    /**
     * Viga de Timoshenko inclinada con offsets, una rótula en j y modificadores; cargas puntuales
     * y distribuidas en ejes locales y globales. Troceada, las cargas puntuales pasan a los nudos
     * intermedios y las distribuidas se reparten por tramos.
     */
    const Xi: Vec3 = [1, 2, 3];
    const Xj: Vec3 = [6, 4, 5];
    const di: Vec3 = [0.1, 0.2, -0.3];
    const dj: Vec3 = [-0.2, 0.1, -0.3];
    const vz: Vec3 = [0, 0.3, 1];
    const lib = { j: [false, false, false, false, true, false] as const };
    const mods = { A: 2, J: 0.3, Iz: 0.8 };
    const ip = Xi.map((v, c) => v + di[c]!);
    const jp = Xj.map((v, c) => v + dj[c]!);
    const Lf = Math.hypot(...jp.map((v, c) => v - ip[c]!));
    const cortes = [0, 1.1, 2.3, 4.0, Lf];
    const cargasBarra = (b: number, a0 = 0, a1 = Lf): CargaBarra[] => {
      const r: CargaBarra[] = [];
      const lin = (x: number, qa: number[], qb: number[], a: number, bb: number) => qa.map((v, c) => v + ((qb[c]! - v) * (x - a)) / (bb - a)) as unknown as Vec3;
      // distribuida local en todo el tramo flexible y global trapecial en [0,5; 3,7]
      const loc = { qa: [0.5, -2, -6], qb: [1, -1, -3], a: 0, b: Lf };
      const glo = { qa: [2, -3, -8], qb: [-1, 4, -2], a: 0.5, b: 3.7 };
      for (const [ejes, d] of [["local", loc], ["global", glo]] as const) {
        const a = Math.max(a0, d.a);
        const bb = Math.min(a1, d.b);
        if (bb > a) r.push({ tipo: "distribuida", barra: b, ejes, qa: lin(a, d.qa, d.qb, d.a, d.b), qb: lin(bb, d.qa, d.qb, d.a, d.b), a: a - a0, b: bb - a0 });
      }
      return r;
    };
    const puntuales: { x: number; ejes: "local" | "global"; F: Vec3; M: Vec3 }[] = [
      { x: 1.1, ejes: "local", F: [3, -4, 10], M: [1, -2, 3] },
      { x: 2.3, ejes: "global", F: [-5, 2, -7], M: [0, 4, -1] },
      { x: 4.0, ejes: "local", F: [0, 6, -3], M: [2, 0, 0] },
    ];

    function unaBarra(): ModeloAnalitico {
      const m = new Constructor();
      const a = m.nudo(...Xi);
      const b = m.nudo(...Xj);
      m.barra(a, b, T, vz, { offsets: { i: di, j: dj }, liberaciones: lib, modificadores: mods });
      m.apoyo(a);
      m.apoyo(b);
      m.caso("C", [], [], [...cargasBarra(0), ...puntuales.map((p) => ({ tipo: "puntual" as const, barra: 0, ...p }))]);
      return m.modelo();
    }

    function troceada(): { modelo: ModeloAnalitico; ejes: number[][] } {
      const m = new Constructor();
      const e1 = jp.map((v, c) => (v - ip[c]!) / Lf);
      const n = cortes.length - 1;
      const nudos: number[] = [m.nudo(...Xi)];
      for (let k = 1; k < n; k++) nudos.push(m.nudo(...([0, 1, 2].map((c) => ip[c]! + cortes[k]! * e1[c]!) as [number, number, number])));
      nudos.push(m.nudo(...Xj));
      const barrasC: CargaBarra[] = [];
      for (let k = 0; k < n; k++) {
        m.barra(nudos[k]!, nudos[k + 1]!, T, vz, {
          offsets: { i: k === 0 ? di : undefined, j: k === n - 1 ? dj : undefined },
          liberaciones: k === n - 1 ? lib : undefined,
          modificadores: mods,
        });
        barrasC.push(...cargasBarra(k, cortes[k]!, cortes[k + 1]!));
      }
      // puntuales en el extremo i de la barra siguiente (x = 0): van al nudo intermedio
      for (const p of puntuales) {
        const k = cortes.indexOf(p.x);
        barrasC.push({ tipo: "puntual", barra: k, ejes: p.ejes, x: 0, F: p.F, M: p.M });
      }
      m.apoyo(nudos[0]!);
      m.apoyo(nudos[n]!);
      m.caso("C", [], [], barrasC);
      return { modelo: m.modelo(), ejes: [e1] };
    }

    it("reacciones iguales y diagrama igual a los esfuerzos de las barras troceadas (≤ 1e-12)", () => {
      const m1 = unaBarra();
      const { modelo: m2 } = troceada();
      const [c1] = casosValidos(calcular(m1, { solver }));
      const [c2] = casosValidos(calcular(m2, { solver }));
      const escR = Math.max(...Array.from(c1!.reacciones, Math.abs));
      for (const [p1, p2] of [[0, 0], [1, m2.nudos.length - 1]]) {
        for (let q = 0; q < 6; q++) expect(Math.abs(c1!.reacciones[6 * p1! + q]! - c2!.reacciones[6 * p2! + q]!) / escR).toBeLessThan(1e-12);
      }
      const d = new DiagramasBarras(m1).diagrama(0, 0, c1!);
      let escala = 0;
      for (let x = 0; x <= Lf; x += Lf / 50) for (const v of d.esfuerzosEn(x)) escala = Math.max(escala, Math.abs(v));
      for (let k = 0; k < cortes.length - 1; k++) {
        // inicio del tramo k (por la derecha de la carga puntual) y final (por la izquierda)
        const ini = esfuerzos(c2!.esfuerzosBarras, k, 0);
        const fin = esfuerzos(c2!.esfuerzosBarras, k, 1);
        const d0 = d.esfuerzosEn(cortes[k]!, 1);
        const d1 = d.esfuerzosEn(cortes[k + 1]!, -1);
        for (let q = 0; q < 6; q++) {
          expect(Math.abs(d0[q]! - ini[q]!) / escala, `tramo ${k} inicio, ${q}`).toBeLessThan(1e-12);
          expect(Math.abs(d1[q]! - fin[q]!) / escala, `tramo ${k} final, ${q}`).toBeLessThan(1e-12);
        }
      }
      // desplazamientos del eje en los nudos intermedios
      const dd = new DiagramasBarras(m1);
      let escU = 0;
      for (let v = 0; v < m2.nudos.length; v++) for (let q = 0; q < 3; q++) escU = Math.max(escU, Math.abs(c2!.u[6 * v + q]!));
      for (let k = 1; k < cortes.length - 1; k++) {
        const p = dd.posicion(0, d, cortes[k]!, 1);
        const n2 = m2.nudos[k]!;
        const esperado = [n2.x + c2!.u[6 * k]!, n2.y + c2!.u[6 * k + 1]!, n2.z + c2!.u[6 * k + 2]!];
        for (let q = 0; q < 3; q++) expect(Math.abs(p[q]! - esperado[q]!) / escU).toBeLessThan(1e-11);
      }
      expect(c1!.equilibrio.fuerzas).toBeLessThan(1e-13);
      expect(c1!.equilibrio.momentos).toBeLessThan(1e-13);
    });
  });

  it("celosía espacial (trípode) con barras biarticuladas: axiles por estática y giros sin rigidez restringidos con aviso", () => {
    const m = new Constructor();
    const cima = m.nudo(0, 0, 4);
    const pies = [m.nudo(3, 0, 0), m.nudo(-1.5, 1.5 * Math.sqrt(3), 0), m.nudo(-1.5, -1.5 * Math.sqrt(3), 0)];
    const biart = { liberaciones: { i: [false, false, false, false, true, true] as const, j: [false, false, false, true, true, true] as const } };
    for (const p of pies) {
      m.barra(p, cima, EB, [1, 1, 0], biart);
      m.apoyo(p, [true, true, true, false, false, false]);
    }
    m.caso("P", [carga(cima, { fz: -90 })]);
    const r = calcular(m.modelo(), { solver });
    const [c] = casosValidos(r);
    // simétrico: cada pata lleva la misma compresión, N = −90/(3·sen α)
    const Lp = Math.hypot(3, 4);
    const N = -90 / (3 * (4 / Lp));
    for (let b = 0; b < 3; b++) expect(rel(esfuerzos(c!.esfuerzosBarras, b, 0)[0]!, N)).toBeLessThan(1e-12);
    expect(r.diagnosticos.some((d) => d.codigo === "gdl/sin-rigidez")).toBe(true);
  });

  it("modificadores: axil ×2 reduce a la mitad el acortamiento", () => {
    const { m, b } = mensula(3, [0, 0, 1], [1, 0, 0], T, { modificadores: { A: 2 } });
    m.caso("N", [carga(b, { fz: -1000 })]);
    const [c] = casosValidos(calcular(m.modelo(), { solver }));
    expect(rel(c!.u[6 * b + 2]!, -(1000 * 3) / (2 * T.E * T.A))).toBeLessThan(1e-13);
  });
});

describe("diagnósticos de barras y cargas de barra", () => {
  const base = (opciones?: OpcionesBarra, s: SeccionBarra = T, vz: Vec3 = [0, 0, 1]) => {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0);
    const b = m.nudo(4, 0, 0);
    m.barra(a, b, s, vz, { id: "V1", ...opciones });
    m.apoyo(a, EMPOTRADO);
    m.apoyo(b, EMPOTRADO);
    return m;
  };
  const codigos = (modelo: ModeloAnalitico) => {
    const r = calcular(modelo, { solver: "perfil" });
    return { valido: r.valido, codigos: r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo), r };
  };

  it("liberaciones inestables", () => {
    for (const lib of [
      { i: [true, false, false, false, false, false], j: [true, false, false, false, false, false] },
      { i: [false, false, false, true, false, false], j: [false, false, false, true, false, false] },
      { i: [false, false, true, false, true, false], j: [false, false, false, false, true, false] },
    ] as const) {
      const m = base({ liberaciones: lib });
      m.caso("G", [], [], []);
      const { valido, codigos: c, r } = codigos(m.modelo());
      expect(valido).toBe(false);
      expect(c).toEqual(["modelo/liberacion-inestable"]);
      expect(r.diagnosticos[0]!.ids).toEqual(["V1"]);
    }
  });

  it("offsets que se comen o invierten la barra, vector de canto paralelo, propiedades no válidas", () => {
    const casos: [OpcionesBarra | undefined, SeccionBarra, Vec3, string][] = [
      [{ offsets: { i: [2, 0, 0], j: [-2, 0, 0] } }, T, [0, 0, 1], "modelo/elemento-degenerado"],
      [{ offsets: { i: [3, 0, 0], j: [-3, 0, 0] } }, T, [0, 0, 1], "modelo/offset-no-valido"],
      [{ offsets: { i: [0, 0, Number.NaN] } }, T, [0, 0, 1], "modelo/offset-no-valido"],
      [undefined, T, [2, 0, 0], "modelo/orientacion-no-valida"],
      [{ offsets: { j: [-3.9, 0, 3] } }, T, [0.1, 0, 3], "modelo/orientacion-no-valida"],
      [undefined, { ...T, Avz: 0 }, [0, 0, 1], "modelo/propiedad-no-valida"],
      [{ modificadores: { J: 0 } }, T, [0, 0, 1], "modelo/propiedad-no-valida"],
      [{ liberaciones: { i: [true, false, false] as never } }, T, [0, 0, 1], "modelo/propiedad-no-valida"],
    ];
    for (const [o, s, vz, codigo] of casos) {
      const m = base(o, s, vz);
      m.caso("G");
      expect(codigos(m.modelo()).codigos, codigo).toEqual([codigo]);
    }
  });

  it("cargas fuera de la barra, con tramo vacío, sobre barras inexistentes o con ejes no válidos", () => {
    const casos: [CargaBarra, string][] = [
      [{ tipo: "puntual", barra: 0, ejes: "local", x: 4.01, F: [0, 0, 1] }, "carga/fuera-de-barra"],
      [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, 1], a: -0.5, b: 2 }, "carga/fuera-de-barra"],
      [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, 1], a: 2, b: 2 }, "carga/no-valida"],
      [{ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, Number.POSITIVE_INFINITY] }, "carga/no-valida"],
      [{ tipo: "puntual", barra: 3, ejes: "local", x: 1, F: [0, 0, 1] }, "carga/no-valida"],
      [{ tipo: "puntual", barra: 0, ejes: "lokal" as never, x: 1, F: [0, 0, 1] }, "carga/no-valida"],
    ];
    for (const [cb, codigo] of casos) {
      const m = base();
      m.caso("G", [], [], [cb]);
      expect(codigos(m.modelo()).codigos, codigo).toEqual([codigo]);
    }
  });

  it("sin falsos positivos: offsets laterales, liberaciones estables, cargas en los extremos y a 1e-12 del final", () => {
    const m = base({ offsets: { i: [0.1, 0, -0.2], j: [-0.1, 0, -0.2] }, liberaciones: { i: [false, false, false, false, false, true], j: [false, false, false, false, true, true] } });
    m.caso("G", [], [], [
      { tipo: "puntual", barra: 0, ejes: "local", x: 0, F: [0, 0, -5] },
      { tipo: "puntual", barra: 0, ejes: "local", x: 3.8 + 1e-12, F: [0, 0, -5] },
      { tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -3] },
    ]);
    const r = calcular(m.modelo(), { solver: "perfil" });
    expect(r.diagnosticos).toEqual([]);
    expect(r.valido).toBe(true);
  });
});
