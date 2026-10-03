/**
 * Barra de Timoshenko de E2 (elemento aislado): rigidez frente a la flexibilidad de la ménsula,
 * modos de sólido rígido con offsets y liberaciones, juegos de liberaciones inestables, FER frente
 * a un modelo de dos barras y a la integral de cargas puntuales, y coherencia del diagrama
 * (los desplazamientos integrados llegan exactamente a los del extremo j').
 */
import { describe, expect, it } from "vitest";
import { autovaloresSimetrica, errorRelativo, gaussLegendre, maxAbs, producto, resolverDenso } from "../pruebas/densa.ts";
import {
  aGlobales,
  aplicarOffsets,
  condensarFer,
  condensarLiberaciones,
  desplazamientosExtremos,
  fuerzasANudos,
  liberacionInestable,
  marcoBarra,
  recuperarLiberados,
  rigidezBarraGlobal,
  rigidezBarraLocal,
  type SeccionBarra,
} from "./barra.ts";
import { arranqueDeFuerzas, cargasDeBarra, DiagramaBarra, diagramaDeCargas, type CargaLocal } from "./cargasBarra.ts";

/** Sección de 0,3×0,6 con áreas de cortante: Φ ≈ 0,2–0,6 en L = 2 m (cortante muy visible). */
const TIMO: SeccionBarra = { E: 3e7, G: 1.25e7, A: 0.18, Iy: 0.0054, Iz: 0.00135, J: 0.0037, Avy: 0.15, Avz: 0.15 };
const EB: SeccionBarra = { E: 3e7, G: 1.25e7, A: 0.18, Iy: 0.0054, Iz: 0.00135, J: 0.0037 };

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/** Rigidez de un extremo de ménsula (i empotrado) invirtiendo su flexibilidad en j, por plano. */
function rigidezMenslaPorFlexibilidad(L: number, s: SeccionBarra): Float64Array {
  // F en j (6×6, locales): u = F·f con la ménsula empotrada en i
  const F = new Float64Array(36);
  F[0] = L / (s.E * s.A);
  F[21] = L / (s.G * s.J);
  // plano x-y: v = Fy·(L³/3EIz + L/GAvy) + Mz·L²/2EIz ; θz = Fy·L²/2EIz + Mz·L/EIz
  F[7] = L ** 3 / (3 * s.E * s.Iz) + L / (s.G * s.Avy!);
  F[11] = F[31] = L ** 2 / (2 * s.E * s.Iz);
  F[35] = L / (s.E * s.Iz);
  // plano x-z: w = Fz·(L³/3EIy + L/GAvz) − My·L²/2EIy ; θy = −Fz·L²/2EIy + My·L/EIy
  F[14] = L ** 3 / (3 * s.E * s.Iy) + L / (s.G * s.Avz!);
  F[16] = F[26] = -(L ** 2) / (2 * s.E * s.Iy);
  F[28] = L / (s.E * s.Iy);
  const K = new Float64Array(36);
  for (let c = 0; c < 6; c++) {
    const e = new Float64Array(6);
    e[c] = 1;
    const col = resolverDenso(F, e, 6);
    for (let r = 0; r < 6; r++) K[6 * r + c] = col[r]!;
  }
  return K;
}

/** Los 6 modos de sólido rígido de dos nudos en Xi y Xj (globales, 12). */
function modosRigidos(Xi: readonly number[], Xj: readonly number[]): Float64Array[] {
  const modos: Float64Array[] = [];
  for (let c = 0; c < 3; c++) {
    const u = new Float64Array(12);
    u[c] = 1;
    u[6 + c] = 1;
    modos.push(u);
  }
  for (let c = 0; c < 3; c++) {
    const th = [0, 0, 0];
    th[c] = 1;
    const u = new Float64Array(12);
    for (const [b, X] of [[0, Xi], [6, Xj]] as const) {
      // u = θ × X
      u[b] = th[1]! * X[2]! - th[2]! * X[1]!;
      u[b + 1] = th[2]! * X[0]! - th[0]! * X[2]!;
      u[b + 2] = th[0]! * X[1]! - th[1]! * X[0]!;
      u[b + 3 + c] = 1;
    }
    modos.push(u);
  }
  return modos;
}

describe("rigidez de Timoshenko", () => {
  it("el bloque de j coincide con la inversa de la flexibilidad de la ménsula (≤ 1e-13)", () => {
    for (const L of [0.8, 2, 7]) {
      const k = rigidezBarraLocal(L, TIMO);
      const K = rigidezMenslaPorFlexibilidad(L, TIMO);
      const bloque = new Float64Array(36);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) bloque[6 * r + c] = k[12 * (6 + r) + 6 + c]!;
      expect(errorRelativo(bloque, K)).toBeLessThan(1e-13);
    }
  });

  it("sin áreas de cortante es Euler–Bernoulli, y converge a ella al crecer Av", () => {
    const L = 3;
    const kEB = rigidezBarraLocal(L, EB);
    expect(kEB[12 * 8 + 8]).toBeCloseTo((12 * EB.E * EB.Iy) / L ** 3, 6);
    const kGrande = rigidezBarraLocal(L, { ...EB, Avy: 1e9, Avz: 1e9 });
    expect(errorRelativo(kGrande, kEB)).toBeLessThan(1e-8);
  });

  it("con offsets y liberaciones conserva exactamente los 6 modos rígidos, la simetría y es semidefinida", () => {
    const Xi = [1.2, -0.4, 3.0];
    const Xj = [5.1, 2.3, 4.4];
    const di = [0.1, 0.25, -0.3];
    const dj = [-0.2, 0.05, -0.3];
    const ip = Xi.map((v, a) => v + di[a]!);
    const jp = Xj.map((v, a) => v + dj[a]!);
    const { R, L } = marcoBarra(ip, jp, [0.1, 0.2, 1]);
    const juegos: boolean[][] = [
      new Array(12).fill(false),
      [false, false, false, false, true, true, false, false, false, true, true, true], // articulada, torsión en j
      [false, true, false, false, false, true, false, false, false, false, false, false], // Vy y Mz en i
      [true, false, false, false, false, false, false, false, false, false, true, false], // axil en i, My en j
    ];
    for (const lib of juegos) {
      expect(liberacionInestable(lib)).toBeNull();
      const { k } = condensarLiberaciones(rigidezBarraLocal(L, TIMO), lib);
      const Kn = aplicarOffsets(rigidezBarraGlobal(k, R), di, dj);
      const escala = maxAbs(Kn);
      for (const m of modosRigidos(Xi, Xj)) expect(maxAbs(producto(Kn, m, 12)) / escala).toBeLessThan(1e-13);
      const ev = autovaloresSimetrica(Kn, 12);
      expect(ev[0]! / ev[11]!).toBeGreaterThan(-1e-14);
      // rango: 6 modos rígidos + uno por cada GDL liberado... salvo los subsistemas que quedan nulos
      expect(ev.filter((v) => Math.abs(v) > 1e-10 * ev[11]!).length).toBeLessThanOrEqual(6);
    }
  });

  it("detecta los juegos de liberaciones inestables (reglas de CSI) y acepta los estables", () => {
    const lib = (...g: number[]) => Array.from({ length: 12 }, (_, i) => g.includes(i));
    // inestables
    for (const g of [[0, 6], [3, 9], [1, 7], [2, 8], [5, 11, 1], [5, 11, 7], [4, 10, 2], [4, 10, 8], [1, 5, 7], [2, 4, 10]]) {
      expect(liberacionInestable(lib(...g)), `liberadas ${g}`).not.toBeNull();
    }
    // estables
    for (const g of [[], [5], [5, 11], [4, 10], [4, 5, 10, 11, 9], [1], [1, 5], [7, 11], [1, 11], [0], [3], [0, 4, 5, 9, 10, 11]]) {
      expect(liberacionInestable(lib(...g)), `liberadas ${g}`).toBeNull();
    }
  });

  it("biempotrada con una rótula: la rigidez condensada es la de la viga empotrada-articulada (3EI/L³ en EB)", () => {
    const L = 4;
    const { k } = condensarLiberaciones(rigidezBarraLocal(L, EB), Array.from({ length: 12 }, (_, i) => i === 10));
    // plano x-z con θy liberado en j: k(wᵢ, wᵢ) = 3EI/L³, k(θyᵢ, θyᵢ) = 3EI/L
    expect(rel(k[12 * 2 + 2]!, (3 * EB.E * EB.Iy) / L ** 3)).toBeLessThan(1e-14);
    expect(rel(k[12 * 4 + 4]!, (3 * EB.E * EB.Iy) / L)).toBeLessThan(1e-14);
    expect(k[12 * 10 + 10]).toBe(0);
  });
});

/** Ménsula de dos barras en el eje x local (= global) para las FER de una carga en a. */
function ferDosBarras(L: number, s: SeccionBarra, a: number, F: readonly number[], M: readonly number[]): Float64Array {
  // nudos 0 (x=0), 1 (x=a), 2 (x=L); los extremos empotrados, el nudo 1 cargado
  const k1 = rigidezBarraLocal(a, s);
  const k2 = rigidezBarraLocal(L - a, s);
  // K del nudo 1 (6×6) = bloque jj de k1 + bloque ii de k2
  const K11 = new Float64Array(36);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) K11[6 * r + c] = k1[12 * (6 + r) + 6 + c]! + k2[12 * r + c]!;
  const u1 = resolverDenso(K11, [...F, ...M], 6);
  // reacciones (fuerza del empotramiento sobre la estructura) = K_{apoyo,1}·u1
  const r = new Float64Array(12);
  for (let p = 0; p < 6; p++) {
    let s0 = 0;
    let s2 = 0;
    for (let c = 0; c < 6; c++) {
      s0 += k1[12 * p + 6 + c]! * u1[c]!;
      s2 += k2[12 * (6 + p) + c]! * u1[c]!;
    }
    r[p] = s0;
    r[6 + p] = s2;
  }
  return r;
}

describe("fuerzas de empotramiento perfecto (FER)", () => {
  const L = 2.5;

  it("carga uniforme: qL/2 y qL²/12 también con Timoshenko (simetría)", () => {
    for (const s of [EB, TIMO]) {
      const { fer } = cargasDeBarra(s, L, [{ tipo: "distribuida", a: 0, b: L, qa: [0, 0, -10], qb: [0, 0, -10] }]);
      expect(rel(fer[2]!, 10 * L / 2)).toBeLessThan(1e-14);
      expect(rel(fer[8]!, 10 * L / 2)).toBeLessThan(1e-14);
      expect(rel(fer[4]!, -10 * L ** 2 / 12)).toBeLessThan(1e-13);
      expect(rel(fer[10]!, 10 * L ** 2 / 12)).toBeLessThan(1e-13);
    }
  });

  it("carga puntual en EB: Pab²/L² y Pa²b/L²", () => {
    const a = 0.7;
    const b = L - a;
    const P = 12;
    const { fer } = cargasDeBarra(EB, L, [{ tipo: "puntual", x: a, F: [0, -P, 0], M: [0, 0, 0] }]);
    // plano x-y: Mz en i (vector) = +Pab²/L² con la carga hacia −y
    expect(rel(fer[5]!, (P * a * b * b) / L ** 2)).toBeLessThan(1e-13);
    expect(rel(fer[11]!, -(P * a * a * b) / L ** 2)).toBeLessThan(1e-13);
    expect(rel(fer[1]!, (P * b * b * (3 * a + b)) / L ** 3)).toBeLessThan(1e-13);
  });

  it("fuerza y momento puntuales en Timoshenko = modelo exacto de dos barras (≤ 1e-12)", () => {
    for (const a of [0.3, 1.1, 2.2]) {
      const F = [3, -5, 7];
      const M = [2, -4, 6];
      const { fer } = cargasDeBarra(TIMO, L, [{ tipo: "puntual", x: a, F: F as unknown as [number, number, number], M: M as unknown as [number, number, number] }]);
      expect(errorRelativo(fer, ferDosBarras(L, TIMO, a, F, M))).toBeLessThan(1e-12);
    }
  });

  it("trapecial parcial en Timoshenko = ∫ q(ξ)·FER puntual(ξ) dξ (≤ 1e-12)", () => {
    const a = 0.4;
    const b = 1.9;
    const qa = [1.5, -4, 6] as const;
    const qb = [-2, 3, -1] as const;
    const { fer } = cargasDeBarra(TIMO, L, [{ tipo: "distribuida", a, b, qa, qb }]);
    const ref = new Float64Array(12);
    const g = gaussLegendre(8, a, b);
    g.x.forEach((xi, p) => {
      const t = (xi - a) / (b - a);
      const q = [0, 1, 2].map((d) => qa[d]! + t * (qb[d]! - qa[d]!));
      const f = ferDosBarras(L, TIMO, xi, q, [0, 0, 0]);
      for (let c = 0; c < 12; c++) ref[c]! += g.w[p]! * f[c]!;
    });
    expect(errorRelativo(fer, ref)).toBeLessThan(1e-12);
  });

  it("las cargas en los extremos van enteras al empotramiento de ese extremo", () => {
    const { fer } = cargasDeBarra(TIMO, L, [
      { tipo: "puntual", x: 0, F: [1, 2, 3], M: [4, 5, 6] },
      { tipo: "puntual", x: L, F: [-7, 8, -9], M: [1, -2, 3] },
    ]);
    const esperado = [-1, -2, -3, -4, -5, -6, 7, -8, 9, -1, 2, -3];
    for (let c = 0; c < 12; c++) expect(fer[c]).toBeCloseTo(esperado[c]!, 12);
  });
});

describe("diagrama de la barra", () => {
  const L = 3.2;
  const cargas: CargaLocal[] = [
    { tipo: "distribuida", a: 0, b: L, qa: [0.5, -2, -6], qb: [0.5, -1, -3] },
    { tipo: "distribuida", a: 1.0, b: 2.4, qa: [0, 4, 2], qb: [0, -1, 5] },
    { tipo: "puntual", x: 0.8, F: [2, 3, -10], M: [1.5, -2, 3] },
    { tipo: "puntual", x: 2.4, F: [0, -6, 4], M: [0, 5, 0] },
  ];

  it("con extremos en movimiento arbitrario, el diagrama llega exactamente a los desplazamientos y fuerzas de j'", () => {
    for (const s of [EB, TIMO]) {
      const kl = rigidezBarraLocal(L, s);
      const { dc, fer } = cargasDeBarra(s, L, cargas);
      const u = Float64Array.of(1e-3, -2e-3, 3e-3, 4e-4, -5e-4, 6e-4, -2e-3, 1e-3, -4e-3, -3e-4, 2e-4, 1e-4);
      const f = producto(kl, u, 12);
      for (let c = 0; c < 12; c++) f[c]! += fer[c]!;
      const d = DiagramaBarra.desde(s, dc, arranqueDeFuerzas(f), u.subarray(0, 6));
      const uL = d.desplazamientosEn(L);
      for (let c = 0; c < 6; c++) expect(Math.abs(uL[c]! - u[6 + c]!)).toBeLessThan(1e-14);
      // fuerzas en j' = esfuerzos en L⁺ con el convenio del extremo positivo
      const sL = d.esfuerzos.map((t) => t.final());
      const fj = [sL[0]!, sL[1]!, sL[2]!, sL[3]!, -sL[4]!, sL[5]!];
      for (let c = 0; c < 6; c++) expect(Math.abs(fj[c]! - f[6 + c]!) / maxAbs(f)).toBeLessThan(1e-13);
    }
  });

  it("My' = −Vz y Mz' = −Vy, con saltos en las cargas puntuales", () => {
    const dc = diagramaDeCargas(L, cargas);
    const d = DiagramaBarra.desde(TIMO, dc, [1, 2, 3, 4, 5, 6], new Float64Array(6));
    const h = 1e-6;
    for (const x of [0.3, 1.5, 2.9]) {
      const dMy = (d.esfuerzosEn(x + h)[4]! - d.esfuerzosEn(x - h)[4]!) / (2 * h);
      const dMz = (d.esfuerzosEn(x + h)[5]! - d.esfuerzosEn(x - h)[5]!) / (2 * h);
      expect(dMy).toBeCloseTo(-d.esfuerzosEn(x)[2]!, 6);
      expect(dMz).toBeCloseTo(-d.esfuerzosEn(x)[1]!, 6);
    }
    // salto de Vz en x = 0,8: −Fz = +10; de My: +My puntual = −2; de Mz: −Mz puntual = −3; de T: −1,5
    const izq = d.esfuerzosEn(0.8, -1);
    const der = d.esfuerzosEn(0.8, 1);
    expect(der[2]! - izq[2]!).toBeCloseTo(10, 12);
    expect(der[4]! - izq[4]!).toBeCloseTo(-2, 12);
    expect(der[5]! - izq[5]!).toBeCloseTo(-3, 12);
    expect(der[3]! - izq[3]!).toBeCloseTo(-1.5, 12);
  });

  it("estaciones: extremos, cuartos, cargas y los ceros del cortante; combinar es lineal", () => {
    const dc = diagramaDeCargas(L, cargas);
    const d1 = DiagramaBarra.desde(TIMO, dc, [1, 2, 3, 4, 5, 6], new Float64Array(6));
    const d2 = DiagramaBarra.desde(TIMO, diagramaDeCargas(L, [{ tipo: "puntual", x: 1.7, F: [0, 0, 5], M: [0, 0, 0] }]), [0, 1, -1, 0, 2, 0], new Float64Array(6));
    const c = DiagramaBarra.combinar([d1, d2], [1.35, -0.8]);
    for (const x of [0, 0.5, 1.7, 2.6, L]) {
      for (let k = 0; k < 6; k++) {
        expect(c.esfuerzosEn(x, -1)[k]).toBeCloseTo(1.35 * d1.esfuerzosEn(x, -1)[k]! - 0.8 * d2.esfuerzosEn(x, -1)[k]!, 10);
        expect(c.desplazamientosEn(x)[k]).toBeCloseTo(1.35 * d1.desplazamientosEn(x)[k]! - 0.8 * d2.desplazamientosEn(x)[k]!, 12);
      }
    }
    const est = c.estaciones();
    for (const x of [0, L / 4, L / 2, 0.8, 1.0, 1.7, 2.4, L]) expect(est).toContain(x);
    for (const x of c.ceros(2)) expect(Math.abs(c.esfuerzosEn(x)[2]!)).toBeLessThan(1e-10);
  });
});

describe("offsets y liberaciones en ejes globales", () => {
  it("fuerzas y desplazamientos a través de los offsets son duales (trabajo virtual)", () => {
    const di = [0.3, -0.2, 0.5];
    const dj = [-0.1, 0.4, 0.2];
    const un = Float64Array.of(1, 2, 3, 0.1, -0.2, 0.3, -1, 0.5, 2, -0.3, 0.1, 0.2);
    const f = Float64Array.of(5, -3, 2, 1, 4, -2, -6, 1, 3, 2, -1, 5);
    const ue = desplazamientosExtremos(un, di, dj);
    const fn = fuerzasANudos(f, di, dj);
    const w1 = f.reduce((s, v, i) => s + v * ue[i]!, 0);
    const w2 = fn.reduce((s, v, i) => s + v * un[i]!, 0);
    expect(rel(w1, w2)).toBeLessThan(1e-14);
  });

  it("los giros liberados se recuperan: la rótula gira lo que pide el equilibrio", () => {
    const L = 4;
    const lib = Array.from({ length: 12 }, (_, i) => i === 10);
    const kl = rigidezBarraLocal(L, EB);
    const { k, condensaciones } = condensarLiberaciones(kl, lib);
    const { fer } = cargasDeBarra(EB, L, [{ tipo: "distribuida", a: 0, b: L, qa: [0, 0, -1], qb: [0, 0, -1] }]);
    const ferC = condensarFer(fer, condensaciones);
    // empotrada en i, apoyada en j: todos los GDL de los extremos fijos salvo θyⱼ (liberado)
    const u = new Float64Array(12);
    recuperarLiberados(u, fer, condensaciones);
    // giro en el apoyo articulado de la empotrada-apoyada con q: qL³/(48EI) (θy positivo = −w')
    expect(rel(u[10]!, -(1 * L ** 3) / (48 * EB.E * EB.Iy))).toBeLessThan(1e-13);
    // reacción en el empotramiento: 5qL/8 y momento qL²/8
    expect(rel(ferC[2]!, (5 * L) / 8)).toBeLessThan(1e-13);
    expect(rel(ferC[4]!, -(L ** 2) / 8)).toBeLessThan(1e-13);
    expect(ferC[10]).toBe(0);
    expect(k[12 * 10 + 4]).toBe(0);
    // y aGlobales/aplicarOffsets no tocan nada si no hay offsets
    expect(aplicarOffsets(k, null, null)).toBe(k);
    expect(errorRelativo(aGlobales(ferC, [1, 0, 0, 0, 1, 0, 0, 0, 1]), ferC)).toBe(0);
  });
});
