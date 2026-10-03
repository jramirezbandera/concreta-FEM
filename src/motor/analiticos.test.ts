/**
 * Motor E1 frente a soluciones cerradas: ménsula, muelles en serie, diafragma rígido sobre
 * pilares en ménsula, enlace rígido y desplazamientos impuestos. Todos exactos (barra de
 * Euler–Bernoulli), así que la tolerancia es de redondeo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga, Constructor, seccionRectangular } from "../pruebas/constructor.ts";
import { calcular } from "./calcular.ts";
import type { TipoSolver } from "./solucion.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const SOLVERS: TipoSolver[] = ["nucleo", "perfil"];

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe.each(SOLVERS)("soluciones cerradas (solver %s)", (solver) => {
  it("ménsula con carga en la punta: flecha, giro y reacciones", () => {
    const s = seccionRectangular(0.3, 0.5);
    const m = new Constructor();
    const a = m.nudo(0, 0, 0);
    const b = m.nudo(3, 0, 0);
    m.barra(a, b, s, [0, 0, 1]);
    m.apoyo(a);
    m.caso("P", [carga(b, { fz: -10 })]);
    const [c] = casosValidos(calcular(m.modelo(), { solver }));
    const EI = s.E * s.Iy;
    expect(rel(c!.u[6 * b + 2]!, (-10 * 27) / (3 * EI))).toBeLessThan(1e-12);
    expect(rel(c!.u[6 * b + 4]!, (10 * 9) / (2 * EI))).toBeLessThan(1e-12);
    expect(rel(c!.reacciones[2]!, 10)).toBeLessThan(1e-12);
    expect(rel(c!.reacciones[4]!, -30)).toBeLessThan(1e-12);
    expect(c!.equilibrio.fuerzas).toBeLessThan(1e-14);
    expect(c!.equilibrio.momentos).toBeLessThan(1e-14);
  });

  it("muelles en serie (a tierra y de longitud nula), en ejes girados", () => {
    const m = new Constructor();
    const a = m.nudo(1, 2, 3);
    const b = m.nudo(1, 2, 3);
    const k1 = [100, 200, 300, 400, 500, 600];
    const k2 = [10, 20, 30, 40, 50, 60];
    // ejes del muelle 2: giro de 30° alrededor de Z
    const c30 = Math.cos(Math.PI / 6);
    const s30 = Math.sin(Math.PI / 6);
    m.muelle([a], k1);
    m.muelle([a, b], k2, [c30, s30, 0, -s30, c30, 0, 0, 0, 1]);
    const F = [1, 2, 3, 4, 5, 6] as const;
    m.caso("F", [{ nudo: b, f: [...F] }]);
    const [c] = casosValidos(calcular(m.modelo(), { solver }));
    // muelle 1 en globales: u_a = F/k1; muelle 2 en sus ejes: Δu' = R·F / k2
    const R = [c30, s30, 0, -s30, c30, 0, 0, 0, 1];
    const giro = (v: readonly number[]) => [0, 1, 2].map((i) => R[3 * i]! * v[0]! + R[3 * i + 1]! * v[1]! + R[3 * i + 2]! * v[2]!);
    const giroT = (v: readonly number[]) => [0, 1, 2].map((i) => R[i]! * v[0]! + R[3 + i]! * v[1]! + R[6 + i]! * v[2]!);
    const dT = giroT(giro(F.slice(0, 3)).map((v, i) => v / k2[i]!));
    const dR = giroT(giro(F.slice(3)).map((v, i) => v / k2[3 + i]!));
    const esperado = [...dT, ...dR].map((d, i) => F[i]! / k1[i]! + d);
    for (let i = 0; i < 6; i++) expect(rel(c!.u[6 * b + i]!, esperado[i]!)).toBeLessThan(1e-12);
    for (let i = 0; i < 6; i++) expect(rel(c!.reacciones[6 * a + i]!, -F[i]!)).toBeLessThan(1e-12);
  });

  it("diafragma rígido sobre 4 pilares en ménsula: traslación y torsión de planta", () => {
    const s = seccionRectangular(0.4, 0.4);
    const H = 3;
    const m = new Constructor();
    const esquinas = [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ];
    const cabezas = esquinas.map(([x, y]) => {
      const pie = m.nudo(x!, y!, 0);
      const cabeza = m.nudo(x!, y!, H);
      m.barra(pie, cabeza, s, [1, 0, 0]);
      m.apoyo(pie);
      return cabeza;
    });
    const maestro = m.nudo(3, 3, H, "CM");
    m.diafragma(maestro, cabezas);
    m.caso("X", [carga(cabezas[2]!, { fx: 100 })]);
    const r = calcular(m.modelo(), { solver });
    const [c] = casosValidos(r);
    const k = (3 * s.E * s.Iy) / H ** 3;
    const kt = (s.G * s.J) / H;
    const Ktt = 4 * k * 18 + 4 * kt;
    const ux = 100 / (4 * k);
    const th = -300 / Ktt;
    expect(rel(c!.u[6 * maestro]!, ux)).toBeLessThan(1e-12);
    expect(rel(c!.u[6 * maestro + 5]!, th)).toBeLessThan(1e-12);
    // esquina (6, 6): ux = uxm − (y − ym)·θ ; uy = uym + (x − xm)·θ
    expect(rel(c!.u[6 * cabezas[2]!]!, ux - 3 * th)).toBeLessThan(1e-12);
    expect(rel(c!.u[6 * cabezas[2]! + 1]!, 3 * th)).toBeLessThan(1e-12);
    expect(c!.equilibrio.fuerzas).toBeLessThan(1e-13);
    expect(c!.equilibrio.momentos).toBeLessThan(1e-13);
    // el maestro auxiliar no tiene uz, rx ni ry: se restringen solos y sin aviso
    expect(r.diagnosticos).toEqual([]);
    expect(r.valido && r.estadisticas.sinRigidez).toBe(3);
  });

  it("enlace rígido: carga en un punto desplazado de la cabeza de un pilar", () => {
    const s = seccionRectangular(0.3, 0.3);
    const H = 3;
    const m = new Constructor();
    const pie = m.nudo(0, 0, 0);
    const cabeza = m.nudo(0, 0, H);
    const punto = m.nudo(1, 0, H);
    m.barra(pie, cabeza, s, [1, 0, 0]);
    m.apoyo(pie);
    m.enlace(cabeza, [punto]);
    m.caso("Y", [carga(punto, { fy: 10 })]);
    const [c] = casosValidos(calcular(m.modelo(), { solver }));
    const EI = s.E * s.Iz; // flexión en el plano Y-Z con el canto según X: inercia Iz
    const uy = (10 * H ** 3) / (3 * EI);
    const rx = (-10 * H ** 2) / (2 * EI);
    const rz = (10 * H) / (s.G * s.J);
    expect(rel(c!.u[6 * cabeza + 1]!, uy)).toBeLessThan(1e-12);
    expect(rel(c!.u[6 * cabeza + 3]!, rx)).toBeLessThan(1e-12);
    expect(rel(c!.u[6 * cabeza + 5]!, rz)).toBeLessThan(1e-12);
    expect(rel(c!.u[6 * punto + 1]!, uy + rz)).toBeLessThan(1e-12);
    expect(Math.abs(c!.u[6 * punto]!)).toBeLessThan(1e-16);
    expect(Math.abs(c!.u[6 * punto + 2]!)).toBeLessThan(1e-16);
    expect(rel(c!.reacciones[5]!, -10)).toBeLessThan(1e-12);
  });

  it("desplazamientos impuestos: biempotrada con asiento y ménsula con giro de base", () => {
    const s = seccionRectangular(0.3, 0.5);
    const L = 4;
    const m = new Constructor();
    const a = m.nudo(0, 0, 0);
    const b = m.nudo(L, 0, 0);
    m.barra(a, b, s, [0, 0, 1]);
    m.apoyo(a);
    m.apoyo(b);
    const d = -0.01;
    m.caso("asiento", [], [{ nudo: b, gdl: 2, valor: d }]);
    const [c] = casosValidos(calcular(m.modelo(), { solver }));
    const EI = s.E * s.Iy;
    expect(rel(c!.reacciones[6 * b + 2]!, (12 * EI * d) / L ** 3)).toBeLessThan(1e-12);
    expect(rel(c!.reacciones[2]!, (-12 * EI * d) / L ** 3)).toBeLessThan(1e-12);
    expect(rel(c!.reacciones[6 * b + 4]!, (6 * EI * d) / L ** 2)).toBeLessThan(1e-12);

    const m2 = new Constructor();
    const p = m2.nudo(0, 0, 0);
    const q = m2.nudo(L, 0, 0);
    m2.barra(p, q, s, [0, 0, 1]);
    m2.apoyo(p);
    m2.caso("giro", [], [{ nudo: p, gdl: 4, valor: 0.001 }]);
    const [c2] = casosValidos(calcular(m2.modelo(), { solver }));
    // giro rígido alrededor de y: w = −θy·x
    expect(rel(c2!.u[6 * q + 2]!, -0.001 * L)).toBeLessThan(1e-12);
    expect(rel(c2!.u[6 * q + 4]!, 0.001)).toBeLessThan(1e-12);
    for (let i = 0; i < 6; i++) expect(Math.abs(c2!.reacciones[i]!)).toBeLessThan(1e-9);
  });
});
