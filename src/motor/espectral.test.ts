/**
 * VS3 (`docs/fem3d/viento-sismo.md` §5): el análisis por espectros de respuesta en el motor.
 * - Criterio 2: una ménsula de 2 masas con la combinación a mano, y un caso con dos modos a menos del
 *   10 % que comprueba la suma en valor absoluto; la combinación cuadrática completa, con su fórmula.
 * - Criterio 4: cada modo, como caso, está en equilibrio con sus fuerzas de inercia, y el cortante en
 *   la base combinado es la combinación de los de los modos.
 * - El torsor de la excentricidad accidental, escrito en los modos, es el caso estático con los pares
 *   (un cálculo aparte), a 1e-9.
 * - `Superposicion`: sin casos espectrales, los bits de la suma de siempre; con ellos, cada variable
 *   combinada; no depende del signo ni de la escala de los modos; μ sólo en los desplazamientos.
 * El espectro de SAP2000 1-022 y 1-024 (criterio 1), en `csi.test.ts`; el oráculo externo
 * (criterio 3), en `oraculo-vs3.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { combinar } from "../compilador/envolventes.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga } from "../pruebas/constructor.ts";
import { edificioCortante, type EdificioCortante } from "../pruebas/edificioCortante.ts";
import { generador as aleatorio } from "../pruebas/aleatorio.ts";
import { calcular } from "./calcular.ts";
import { casosModales, combinarModos, correlacionCqc, modeloConModos, periodosProximos, reglaModal, respuestaEspectral, Superposicion, TOL_TORSOR, valorEspectral, type CasoEspectral, type RespuestaEspectral } from "./espectral.ts";
import type { ModeloAnalitico, ResultadoModal } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function modalDe(m: ModeloAnalitico): ResultadoModal {
  const r = calcular(m);
  casosValidos(r);
  if (!r.valido || !r.modal) throw new Error("sin modal");
  return r.modal;
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

/** El caso espectral de una respuesta sobre los modos como casos base 0…n−1 (sin estáticos delante). */
const casoDe = (r: RespuestaEspectral, signoTorsor = 0): CasoEspectral => ({
  modos: Int32Array.from(r.coeficientes.keys()),
  coeficientes: r.coeficientes,
  regla: r.regla,
  dominante: r.dominante,
  lineal: signoTorsor && r.torsor ? r.torsor.map((t) => signoTorsor * t) : null,
  ductilidad: r.ductilidad,
});

// ─── La regla ───────────────────────────────────────────────────────────────────────────────────

describe("VS3: la regla de combinación de los modos (art. 3.6.2.4)", () => {
  it("raíz de la suma de los cuadrados con los periodos a más del 10 %", () => {
    const regla = reglaModal([1, 0.6, 0.3]);
    expect(regla.pesos.length).toBe(0);
    expect(combinarModos([3, -4, 12], regla)).toBe(13);
  });

  it("los modos con periodos a menos del 10 % se suman antes en valor absoluto", () => {
    // 1,00 y 0,92 difieren un 8 %; el tercero está lejos de los dos
    const regla = reglaModal([1, 0.92, 0.5]);
    expect(Array.from(regla.pares)).toEqual([0, 1]);
    // una única variable con |3| + |−4| = 7, y la otra, 24: √(7² + 24²) = 25
    expect(combinarModos([3, -4, 24], regla)).toBeCloseTo(25, 13);
    // el 10 % justo ya no es «menos del 10 %»
    expect(periodosProximos(1, 0.9)).toBe(false);
    expect(periodosProximos(1, 0.9001)).toBe(true);
    expect(periodosProximos(0.9001, 1)).toBe(true);
  });

  it("tres modos próximos entre sí son una sola variable con la suma de sus valores absolutos", () => {
    const regla = reglaModal([1, 0.97, 0.94, 0.3]);
    expect(regla.pesos.length).toBe(3);
    expect(combinarModos([1, -2, 3, 8], regla)).toBeCloseTo(Math.hypot(1 + 2 + 3, 8), 13);
  });

  it("la combinación cuadrática completa (C.3.6.2.4), con su coeficiente", () => {
    // π = 8·(Ω/100)²·(1 + f)·f^(3/2) / [(1 − f²)² + 4·(Ω/100)²·f·(1 + f)²], f = Ti/Tj
    const pi = (Ti: number, Tj: number, omega: number) => {
      const [f, z] = [Ti / Tj, omega / 100];
      return (8 * z * z * (1 + f) * Math.pow(f, 1.5)) / ((1 - f * f) ** 2 + 4 * z * z * f * (1 + f) ** 2);
    };
    expect(correlacionCqc(0.7, 0.7, 0.05)).toBeCloseTo(1, 14);
    expect(correlacionCqc(1, 0.8, 0.05)).toBeCloseTo(pi(1, 0.8, 5), 14);
    expect(correlacionCqc(0.8, 1, 0.05)).toBeCloseTo(correlacionCqc(1, 0.8, 0.05), 14);
    const T = [1, 0.95, 0.4];
    const x = [3, -4, 2];
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += pi(T[i]!, T[j]!, 4) * x[i]! * x[j]!;
    expect(combinarModos(x, reglaModal(T, { tipo: "cqc", zeta: 0.04 }))).toBeCloseTo(Math.sqrt(s), 13);
    // Con signos opuestos, dos modos casi iguales se cancelan; con el mismo signo, casi se suman
    const juntos = reglaModal([1, 0.999], { tipo: "cqc", zeta: 0.05 });
    expect(combinarModos([5, -5], juntos)).toBeLessThan(0.1);
    expect(combinarModos([5, 5], juntos)).toBeGreaterThan(9.99);
  });
});

// ─── La ménsula de dos masas ────────────────────────────────────────────────────────────────────

/** Aceleración espectral de prueba, m/s²: depende del periodo, para que cada modo lleve la suya. */
const aceleracion = (T: number) => 2 + 3 * T;

describe("VS3, criterio 2: una ménsula de dos masas, a mano", () => {
  let ed: EdificioCortante;
  let md: ResultadoModal;
  let r: RespuestaEspectral;
  /** La solución cerrada: la cadena de dos masas m iguales con dos muelles k iguales. */
  let mano: { u: number[][]; F: number[][]; a: number[] };

  beforeAll(() => {
    ed = edificioCortante(2);
    md = modalDe(ed.modelo);
    r = respuestaEspectral(md, { direccion: [1, 0], aceleracion, ductilidad: 2.5 });
    const [k, m] = [ed.kx, ed.masas[0]!];
    // ω² = (k/m)·(3 ∓ √5)/2 y φ = [1, (1 ± √5)/2]
    const modos = [-1, 1].map((s) => ({ w2: ((k / m) * (3 + s * Math.sqrt(5))) / 2, phi: [1, (1 - s * Math.sqrt(5)) / 2] }));
    const a = modos.map((x) => aceleracion((2 * Math.PI) / Math.sqrt(x.w2)));
    // Γ = Σ m·φ / Σ m·φ²; desplazamiento de la planta j, Γ·φⱼ·a/ω²; su fuerza, m·Γ·φⱼ·a
    const gamma = modos.map((x) => (x.phi[0]! + x.phi[1]!) / (x.phi[0]! ** 2 + x.phi[1]! ** 2));
    mano = {
      a,
      u: modos.map((x, i) => x.phi.map((p) => (gamma[i]! * p * a[i]!) / x.w2)),
      F: modos.map((x, i) => x.phi.map((p) => m * gamma[i]! * p * a[i]!)),
    };
  });

  it("los dos modos en X llevan toda la masa en X, y el dominante es el primero", () => {
    const enX = md.modos.map((_, i) => i).filter((i) => r.masaEfectiva[i]! > 1e-12);
    expect(enX.length).toBe(2);
    expect(r.masaEfectiva.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(md.modos[r.dominante]!.periodo).toBe(Math.max(...enX.map((i) => md.modos[i]!.periodo)));
    // la aceleración de cada modo es la del espectro en su periodo
    enX.forEach((i, j) => expect(rel(r.aceleraciones[i]!, [...mano.a].sort((p, q) => p - q)[enX.length - 1 - j]!)).toBeLessThan(1e-10));
  });

  it("cortantes, fuerzas equivalentes, desplazamientos (por μ) y derivas son los de la mano", () => {
    const [u, F] = [mano.u, mano.F];
    const cortanteArriba = Math.hypot(F[0]![1]!, F[1]![1]!);
    const cortanteBase = Math.hypot(F[0]![0]! + F[0]![1]!, F[1]![0]! + F[1]![1]!);
    const [arriba, abajo] = r.niveles;
    expect(rel(arriba!.cortante, cortanteArriba)).toBeLessThan(1e-10);
    expect(rel(abajo!.cortante, cortanteBase)).toBeLessThan(1e-10);
    expect(rel(r.basal, cortanteBase)).toBeLessThan(1e-10);
    // La fuerza equivalente de cada planta, la combinación de las suyas en cada modo (VS3-d, como CYPECAD)
    expect(rel(arriba!.fuerza, cortanteArriba)).toBeLessThan(1e-10);
    expect(rel(abajo!.fuerza, Math.hypot(F[0]![0]!, F[1]![0]!))).toBeLessThan(1e-10);
    const mu = 2.5;
    expect(rel(arriba!.desplazamiento, mu * Math.hypot(u[0]![1]!, u[1]![1]!))).toBeLessThan(1e-10);
    expect(rel(abajo!.desplazamiento, mu * Math.hypot(u[0]![0]!, u[1]![0]!))).toBeLessThan(1e-10);
    expect(rel(arriba!.deriva, mu * Math.hypot(u[0]![1]! - u[0]![0]!, u[1]![1]! - u[1]![0]!))).toBeLessThan(1e-10);
    expect(rel(abajo!.deriva, abajo!.desplazamiento)).toBeLessThan(1e-14);
  });

  it("cada variable se combina ella: el cortante y el momento de cada pilar, y el desplazamiento de cada planta", () => {
    const { resultados } = casosModales(md);
    const sup = new Superposicion(resultados.length, [{ id: "EX", espectral: casoDe(r) }]);
    const [F, u] = [mano.F, mano.u];
    const cortantes = [Math.hypot(F[0]![0]! + F[0]![1]!, F[1]![0]! + F[1]![1]!), Math.hypot(F[0]![1]!, F[1]![1]!)];
    for (const planta of [1, 2]) {
      const V = cortantes[planta - 1]!;
      for (let c = 0; c < 4; c++) {
        const b = ed.pilar(planta, c);
        // El pilar lleva vz en X: su Vz es la cuarta parte del cortante de la planta, y su My en cada extremo, Vz·H/2
        const e = sup.combinar(Float64Array.from(resultados.flatMap((x) => Array.from(x.esfuerzosBarras.subarray(12 * b, 12 * b + 12)))), 12, [1]);
        expect(rel(Math.abs(e[2]!), V / 4)).toBeLessThan(1e-9);
        expect(rel(Math.abs(e[4]!), (V / 4) * (ed.H / 2))).toBeLessThan(1e-9);
        expect(rel(Math.abs(e[10]!), (V / 4) * (ed.H / 2))).toBeLessThan(1e-9);
      }
      // El desplazamiento del maestro: sin el indicador, el del espectro reducido; con él, por μ
      const m = ed.maestros[planta - 1]!;
      const ux = Math.hypot(u[0]![planta - 1]!, u[1]![planta - 1]!);
      expect(rel(Math.abs(sup.valor([1], (k) => resultados[k]!.u[6 * m]!)), ux)).toBeLessThan(1e-9);
      expect(rel(Math.abs(sup.valor([1], (k) => resultados[k]!.u[6 * m]!, true)), 2.5 * ux)).toBeLessThan(1e-9);
    }
    // No es lo mismo que combinar los desplazamientos y sacar de ellos la deriva: la deriva de la planta 2
    const [m1, m2] = ed.maestros as [number, number];
    const deriva = Math.abs(sup.valor([1], (k) => resultados[k]!.u[6 * m2]! - resultados[k]!.u[6 * m1]!));
    const mal = Math.abs(sup.valor([1], (k) => resultados[k]!.u[6 * m2]!)) - Math.abs(sup.valor([1], (k) => resultados[k]!.u[6 * m1]!));
    expect(rel(deriva, Math.hypot(u[0]![1]! - u[0]![0]!, u[1]![1]! - u[1]![0]!))).toBeLessThan(1e-9);
    expect(rel(deriva, mal)).toBeGreaterThan(1e-3);
  });

  it("el signo de todas las variables es el del modo dominante", () => {
    const { resultados } = casosModales(md);
    const sup = new Superposicion(resultados.length, [{ id: "EX", espectral: casoDe(r) }]);
    const d = r.dominante;
    const n = resultados[0]!.u.length;
    const u = sup.vector([1], (k) => resultados[k]!.u, n);
    let comparados = 0;
    for (let q = 0; q < n; q++) {
      const x = r.coeficientes[d]! * resultados[d]!.u[q]!;
      if (Math.abs(x) < 1e-12 || u[q] === 0) continue;
      expect(Math.sign(u[q]!)).toBe(Math.sign(x));
      comparados++;
    }
    expect(comparados).toBeGreaterThan(8);
    // El modo dominante responde hacia +X: el edificio se desplaza hacia +X
    for (const m of ed.maestros) expect(u[6 * m]!).toBeGreaterThan(0);
  });
});

// ─── Dos modos próximos ─────────────────────────────────────────────────────────────────────────

describe("VS3, criterio 2: dos modos con periodos a menos del 10 %", () => {
  it("un edificio con la traslación y el giro acoplados: sus cortantes se suman en valor absoluto", () => {
    // Pilares cuadrados y masas en las esquinas: la traslación en X y el giro tienen casi la misma
    // frecuencia; con un poco más de masa a un lado (en Y), se acoplan en dos modos próximos, los dos con masa en X
    const ed = edificioCortante(1, { A: 6, B: 6, seccion: { E: 3e7, G: 1.25e7, A: 0.16, Iy: 0.4 ** 4 / 12, Iz: 0.4 ** 4 / 12, J: 1e-9 }, reparto: [0.27, 0.27, 0.23, 0.23] });
    const md = modalDe(ed.modelo);
    const r = respuestaEspectral(md, { direccion: [1, 0], aceleracion });
    const enX = md.modos.map((_, i) => i).filter((i) => r.masaEfectiva[i]! > 0.05);
    expect(enX.length).toBe(2);
    const [T1, T2] = enX.map((i) => md.modos[i]!.periodo) as [number, number];
    expect(Math.min(T1, T2) / Math.max(T1, T2)).toBeGreaterThan(0.9);
    const V = Array.from(r.basalModos);
    // A mano: Σ V² + 2·|V₁·V₂| de cada par de modos próximos
    let s = 0;
    for (let i = 0; i < V.length; i++) {
      s += V[i]! ** 2;
      for (let j = i + 1; j < V.length; j++) if (Math.min(md.modos[i]!.periodo, md.modos[j]!.periodo) > 0.9 * Math.max(md.modos[i]!.periodo, md.modos[j]!.periodo)) s += 2 * Math.abs(V[i]! * V[j]!);
    }
    expect(rel(r.basal, Math.sqrt(s))).toBeLessThan(1e-12);
    // Los dos modos en X, como una sola variable: |V₁| + |V₂|, y no la raíz de la suma de sus cuadrados
    const abs = Math.abs(V[enX[0]!]!) + Math.abs(V[enX[1]!]!);
    expect(rel(r.basal, abs)).toBeLessThan(1e-9);
    expect(r.basal / Math.hypot(V[enX[0]!]!, V[enX[1]!]!)).toBeGreaterThan(1.05);
    // Los dos modos responden en fase en la base (suman la masa): el valor absoluto es aquí la suma, y el cortante, el de la masa entera
    expect(V[enX[0]!]! * V[enX[1]!]!).toBeGreaterThan(0);
    // Con la combinación cuadrática completa, entre las dos
    const cqc = respuestaEspectral(md, { direccion: [1, 0], aceleracion, regla: { tipo: "cqc", zeta: 0.05 } });
    expect(cqc.basal).toBeLessThan(r.basal);
    expect(cqc.basal).toBeGreaterThan(Math.hypot(...V));
  });
});

// ─── Criterio 4 y el torsor ─────────────────────────────────────────────────────────────────────

describe("VS3, criterio 4: los modos como casos", () => {
  let ed: EdificioCortante;
  let md: ResultadoModal;

  beforeAll(() => {
    ed = edificioCortante(3, { reparto: [0.3, 0.3, 0.2, 0.2], maestro: [1, 3.5] });
    md = modalDe(ed.modelo);
  });

  it("cada modo está en equilibrio con sus fuerzas de inercia, y sus reacciones las equilibran", () => {
    const { casos, resultados } = casosModales(md);
    expect(casos.length).toBe(md.modos.length);
    casos.forEach((c, i) => {
      const res = resultados[i]!;
      expect(res.equilibrio.fuerzas).toBeLessThan(1e-9);
      expect(res.equilibrio.momentos).toBeLessThan(1e-9);
      // ΣF de las cargas del caso (las de inercia, en los maestros) + ΣR = 0, en X y en Y
      let escala = 0;
      for (const n of c.nodales ?? []) escala += Math.abs(n.f[0]) + Math.abs(n.f[1]);
      expect(escala).toBeGreaterThan(0);
      for (const g of [0, 1]) {
        let [f, R] = [0, 0];
        for (const n of c.nodales ?? []) f += n.f[g]!;
        for (let v = 0; v < res.reacciones.length / 6; v++) R += res.reacciones[6 * v + g]!;
        expect(Math.abs(f + R) / escala).toBeLessThan(1e-9);
      }
    });
  });

  it("el modelo con los modos como casos da, calculado otra vez, los resultados de los modos", () => {
    const { casos, resultados } = casosModales(md);
    const otra = casosValidos(calcular(modeloConModos(ed.modelo, casos)));
    expect(otra.length).toBe(1 + casos.length);
    resultados.forEach((res, i) => {
      const o = otra[1 + i]!;
      for (const campo of ["u", "reacciones", "esfuerzosBarras"] as const) {
        let [d, e] = [0, 0];
        for (let q = 0; q < res[campo].length; q++) {
          d = Math.max(d, Math.abs(res[campo][q]! - o[campo][q]!));
          e = Math.max(e, Math.abs(res[campo][q]!));
        }
        expect(d / e, `${campo} del modo ${i + 1}`).toBeLessThan(1e-9);
      }
    });
  });

  it("el cortante en la base combinado es la combinación de los cortantes en la base de los modos (la suma de sus reacciones)", () => {
    const { resultados } = casosModales(md);
    for (const dir of [
      [1, 0],
      [0, 1],
    ] as const) {
      const r = respuestaEspectral(md, { direccion: dir, aceleracion });
      const sup = new Superposicion(resultados.length, [{ id: "E", espectral: casoDe(r) }]);
      const g = dir[0] ? 0 : 1;
      const total = (k: number) => {
        let s = 0;
        const R = resultados[k]!.reacciones;
        for (let v = 0; v < R.length / 6; v++) s += R[6 * v + g]!;
        return s;
      };
      expect(rel(Math.abs(sup.valor([1], total)), r.basal)).toBeLessThan(1e-10);
      // y el cortante de cada modo, el de sus fuerzas de planta: −Σ reacciones
      md.modos.forEach((_, i) => expect(Math.abs(r.coeficientes[i]! * total(i) + r.basalModos[i]!)).toBeLessThan(1e-9 * r.basal));
    }
  });

  it("el torsor de la excentricidad accidental, escrito en los modos, es el caso estático con los pares", () => {
    const excentricidades = [0.3, 0.2, 0.25];
    const r = respuestaEspectral(md, { direccion: [1, 0], aceleracion, excentricidades });
    expect(r.torsor).not.toBeNull();
    expect(r.residuoTorsor).toBeLessThan(TOL_TORSOR);
    // Los pares: la fuerza equivalente de cada planta por su excentricidad
    md.diafragmas.forEach((_, k) => expect(r.pares![k]).toBe(r.fuerzas[k]! * excentricidades[k]!));
    // (combinadas modo a modo, suman más que el cortante en la base, que es la combinación de sus sumas)
    expect(r.fuerzas.reduce((s, v) => s + v, 0)).toBeGreaterThan(r.basal);
    // Un cálculo aparte: los pares, como cargas en los maestros
    const base = ed.modelo;
    const { modal: _m, ...sinModal } = base;
    void _m;
    const [estatico] = casosValidos(calcular({ ...sinModal, casos: [{ id: "T", nodales: md.diafragmas.map((df, k) => carga(df.maestro, { mz: r.pares![k]! })) }] }));
    const { resultados } = casosModales(md);
    for (const campo of ["u", "reacciones", "esfuerzosBarras"] as const) {
      const n = resultados[0]![campo].length;
      let [d, e] = [0, 0];
      for (let q = 0; q < n; q++) {
        let s = 0;
        for (let i = 0; i < resultados.length; i++) s += r.torsor![i]! * resultados[i]![campo][q]!;
        d = Math.max(d, Math.abs(s - estatico![campo][q]!));
        e = Math.max(e, Math.abs(estatico![campo][q]!));
      }
      expect(e).toBeGreaterThan(0);
      expect(d / e, campo).toBeLessThan(1e-9);
    }
    // En el caso lógico: EX+e y EX−e son el caso de los modos más y menos el torsor
    const sup = new Superposicion(resultados.length, [
      { id: "EX", espectral: casoDe(r) },
      { id: "EX+e", espectral: casoDe(r, 1) },
      { id: "EX-e", espectral: casoDe(r, -1) },
    ]);
    const b = ed.pilar(1, 2);
    const v = (k: number) => resultados[k]!.esfuerzosBarras[12 * b + 2]!;
    const [e0, mas, menos] = [sup.valor([1, 0, 0], v), sup.valor([0, 1, 0], v), sup.valor([0, 0, 1], v)];
    expect(rel(mas - e0, estatico!.esfuerzosBarras[12 * b + 2]!)).toBeLessThan(1e-8);
    expect(rel(e0 - menos, estatico!.esfuerzosBarras[12 * b + 2]!)).toBeLessThan(1e-8);
  });

  it("sin inercia de giro (toda la masa de la planta en un punto), el torsor no se puede escribir en los modos", () => {
    // Un pilar de masa junto a cada maestro: reparto con toda la masa en una esquina
    const m1 = modalDe(edificioCortante(2, { reparto: [1, 0, 0, 0] }).modelo);
    expect(m1.diafragmas.every((df) => df.J === 0)).toBe(true);
    const r = respuestaEspectral(m1, { direccion: [1, 0], aceleracion, excentricidades: [0.3, 0.3] });
    expect(r.torsor).toBeNull();
    expect(r.residuoTorsor).toBeGreaterThan(0.1);
    // Sin excentricidades, o nulas, no hay nada que escribir
    expect(respuestaEspectral(m1, { direccion: [1, 0], aceleracion, excentricidades: [0, 0] }).torsor).not.toBeNull();
    expect(respuestaEspectral(m1, { direccion: [1, 0], aceleracion }).pares).toBeNull();
  });
});

// ─── La superposición ───────────────────────────────────────────────────────────────────────────

describe("VS3: la superposición de casos lógicos sobre casos base", () => {
  const azar = aleatorio(20261106);
  const numeros = (n: number) => Float64Array.from({ length: n }, () => (azar() - 0.5) * 20);

  /** Un caso espectral de prueba sobre los casos base `modos`. */
  const caso = (modos: number[], o: { cqc?: boolean; lineal?: boolean } = {}): CasoEspectral => ({
    modos: Int32Array.from(modos),
    coeficientes: numeros(modos.length),
    regla: reglaModal(
      modos.map((_, i) => 1 / (1 + 0.07 * i)),
      o.cqc ? { tipo: "cqc", zeta: 0.05 } : {},
    ),
    dominante: 1,
    lineal: o.lineal ? numeros(modos.length) : null,
    ductilidad: 3,
  });

  it("sin casos espectrales, los mismos bits que la combinación lineal de siempre", () => {
    const sup = Superposicion.directa(["G", "Q", "W", "S"]);
    expect(sup.conEspectrales).toBe(false);
    for (let rep = 0; rep < 20; rep++) {
      const n = 7;
      const porCaso = numeros(4 * n);
      const f = Float64Array.from([1.35, rep % 2 ? 0 : 1.5, -0, rep % 3 ? 0.9 : 0]);
      const esperado = combinar(porCaso, n, f);
      expect(Array.from(sup.combinar(porCaso, n, f))).toEqual(Array.from(esperado));
      expect(Array.from(sup.combinar(porCaso, n, f, true))).toEqual(Array.from(esperado));
      for (let q = 0; q < n; q++) {
        // la suma a mano, en el orden de los casos y saltando los factores nulos
        let s = 0;
        for (let k = 0; k < 4; k++) if (f[k]) s += f[k]! * porCaso[n * k + q]!;
        expect(Object.is(sup.valor(f, (k) => porCaso[n * k + q]!), s)).toBe(true);
        expect(Object.is(sup.combinar(porCaso, n, f)[q], esperado[q])).toBe(true);
      }
      const { lineal, espectrales } = sup.partes(f);
      expect(Array.from(lineal)).toEqual(Array.from(f, (v) => v || 0));
      expect(espectrales).toEqual([]);
      expect(sup.esLineal(f)).toBe(true);
    }
  });

  it("los factores son los de los casos lógicos: con otra longitud, lanza", () => {
    const sup = new Superposicion(5, [
      { id: "G", base: 0 },
      { id: "Q", base: 1 },
      { id: "EX", espectral: caso([2, 3, 4]) },
    ]);
    expect(sup.nl).toBe(3);
    expect(sup.nb).toBe(5);
    expect(() => sup.combinar(numeros(5), 1, [1, 1, 1, 1, 1])).toThrow(/factores/);
    expect(() => sup.combinar(numeros(3), 1, [1, 1, 1])).toThrow(/casos base/);
    expect(() => sup.valor([1, 1], () => 0)).toThrow(/factores/);
    expect(sup.defecto([1, 2])).toMatch(/2 factores para 3 casos/);
    expect(sup.defecto([1, Number.NaN, 0])).toMatch(/Q/);
    expect(sup.defecto([1, 0, -1])).toBeNull();
    // y la combinación lineal de siempre no admite un vector por caso base con factores de casos lógicos
    expect(() => combinar(numeros(5), 1, [1, 1, 1])).toThrow(/Consultas.combinar/);
    expect(() => new Superposicion(3, [{ id: "E", espectral: caso([2, 3]) }])).toThrow(/caso base 3/);
  });

  it("cada variable: la parte lineal más factor·(signo·regla + lineal), y las tres formas de pedirla dan lo mismo", () => {
    for (const o of [{}, { cqc: true }, { lineal: true }, { cqc: true, lineal: true }]) {
      const ex = caso([2, 3, 4, 5], o);
      const ey = caso([2, 3, 4, 5], o);
      const sup = new Superposicion(6, [
        { id: "G", base: 0 },
        { id: "Q", base: 1 },
        { id: "EX", espectral: ex },
        { id: "EY", espectral: ey },
      ]);
      const n = 5;
      const porBase = numeros(6 * n);
      const f = [1, 0.3, -1, 0.3];
      const r = sup.combinar(porBase, n, f);
      const x = new Float64Array(4);
      for (let q = 0; q < n; q++) {
        const v = [2, 3, 4, 5].map((b) => porBase[n * b + q]!);
        const esperado = 1 * porBase[q]! + 0.3 * porBase[n + q]! - valorEspectral(ex, v, x) + 0.3 * valorEspectral(ey, v, x);
        expect(rel(r[q]!, esperado)).toBeLessThan(1e-13);
        expect(sup.valor(f, (b) => porBase[n * b + q]!)).toBe(r[q]);
        const partes = sup.partes(f);
        expect(Array.from(partes.lineal)).toEqual([1, 0.3, 0, 0, 0, 0]);
        expect(rel(porBase[q]! + 0.3 * porBase[n + q]! + sup.deEspectrales(partes, (b) => porBase[n * b + q]!), r[q]!)).toBeLessThan(1e-13);
      }
      // por vectores, con paso
      const vec = sup.vector(f, (b) => porBase.subarray(n * b, n * b + n), n);
      expect(Array.from(vec)).toEqual(Array.from(r));
      const salteado = sup.vector(f, (b) => porBase.subarray(n * b, n * b + n), 2, false, 1, 2);
      expect(Array.from(salteado)).toEqual([r[1], r[3]]);
      // por caso lógico y después lineal
      const porLogico = sup.porLogico(porBase, n);
      const lineal = combinar(porLogico, n, f);
      for (let q = 0; q < n; q++) expect(rel(lineal[q]!, r[q]!)).toBeLessThan(1e-13);
      expect(sup.bases(f)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(sup.bases([1, 0, 0, 0])).toEqual([0]);
      expect(sup.esLineal([1, 1, 0, 0])).toBe(true);
      expect(sup.esLineal(f)).toBe(false);
    }
  });

  it("el valor de un caso espectral: a mano", () => {
    // Tres modos; los dos primeros, próximos: √((|2·3| + |−1·4|)² + (0,5·8)²) = √(100 + 16), con el signo del segundo (−4)
    const c: CasoEspectral = { modos: Int32Array.of(0, 1, 2), coeficientes: Float64Array.of(2, -1, 0.5), regla: reglaModal([1, 0.95, 0.4]), dominante: 1, lineal: Float64Array.of(0.1, 0, -0.2), ductilidad: 4 };
    const x = new Float64Array(3);
    const v = [3, 4, 8];
    const modos = -Math.sqrt(116);
    const lineal = 0.1 * 3 - 0.2 * 8;
    expect(valorEspectral(c, v, x)).toBeCloseTo(modos + lineal, 13);
    // en un desplazamiento, todo el caso (los modos y el torsor) por μ
    expect(valorEspectral(c, v, x, true)).toBeCloseTo(4 * (modos + lineal), 13);
    // el signo, de otro valor del dominante (un diagrama lo mira un poco al lado del punto)
    expect(valorEspectral(c, v, x, false, 7)).toBeCloseTo(-modos + lineal, 13);
    // un valor sin número no gobierna nada: se propaga
    expect(valorEspectral(c, [3, Number.NaN, 8], x)).toBeNaN();
  });

  it("no depende del signo ni de la escala de los modos (con sus coeficientes), y μ sólo entra en los desplazamientos", () => {
    const ex = caso([1, 2, 3, 4], { lineal: true });
    const sup = new Superposicion(5, [
      { id: "G", base: 0 },
      { id: "EX", espectral: ex },
    ]);
    const n = 6;
    const porBase = numeros(5 * n);
    const f = [1.2, -1];
    const r = sup.combinar(porBase, n, f);
    // Cada modo, con otra normalización: su forma por a, su coeficiente y su torsor entre a (también con a < 0)
    const a = [-1, 2.5, -0.4, 7];
    const otro: CasoEspectral = { ...ex, coeficientes: ex.coeficientes.map((c, i) => c / a[i]!), lineal: ex.lineal!.map((t, i) => t / a[i]!) };
    const escalado = Float64Array.from(porBase);
    for (let i = 0; i < 4; i++) for (let q = 0; q < n; q++) escalado[n * (1 + i) + q]! *= a[i]!;
    const r2 = new Superposicion(5, [
      { id: "G", base: 0 },
      { id: "EX", espectral: otro },
    ]).combinar(escalado, n, f);
    for (let q = 0; q < n; q++) expect(rel(r2[q]!, r[q]!)).toBeLessThan(1e-12);
    // μ: en los desplazamientos, la parte espectral por 3; la lineal, igual
    const d = sup.combinar(porBase, n, f, true);
    for (let q = 0; q < n; q++) expect(rel(d[q]! - 1.2 * porBase[q]!, 3 * (r[q]! - 1.2 * porBase[q]!))).toBeLessThan(1e-12);
  });

  it("VS-o, partir: la parte estática con los bits de combinar y, del sismo, Σ |factor·valor| por variable", () => {
    const ex = caso([3, 4, 5]);
    const ey = caso([3, 4, 5], { lineal: true });
    const sup = new Superposicion(6, [
      { id: "G", base: 0 },
      { id: "Q", base: 1 },
      { id: "W", base: 2 },
      { id: "EX", espectral: ex },
      { id: "EY", espectral: ey },
    ]);
    for (let rep = 0; rep < 20; rep++) {
      const n = 5;
      const porBase = numeros(6 * n);
      const f = Float64Array.from([1, 0.3, rep % 2 ? 0 : 0.5, rep % 3 ? 1 : -1, rep % 4 ? 0.3 : 0]);
      const { estatica, sismo } = sup.partir(porBase, n, f);
      const lin = Float64Array.from(f, (v, k) => (k < 3 ? v : 0));
      // sin los casos del sismo, la combinación de siempre, bit a bit
      expect(Array.from(estatica)).toEqual(Array.from(sup.combinar(porBase, n, lin)));
      const pl = sup.porLogico(porBase, n);
      for (let q = 0; q < n; q++) {
        const a = Math.abs(f[3]! * pl[n * 3 + q]!) + Math.abs(f[4]! * pl[n * 4 + q]!);
        expect(sismo[q]).toBe(a);
        // la combinación con el signo del modo dominante es uno de los estados entre estatica ± sismo
        expect(Math.abs(sup.combinar(porBase, n, f)[q]! - estatica[q]!)).toBeLessThanOrEqual(sismo[q]! * (1 + 1e-12));
      }
      expect(Array.from(sup.partirLogico(pl, n, f).sismo)).toEqual(Array.from(sismo));
    }
    // sin casos del sismo con factor, la amplitud es 0
    expect(Array.from(sup.partir(numeros(6), 1, [1, 1, 1, 0, 0]).sismo)).toEqual([0]);
  });
});
