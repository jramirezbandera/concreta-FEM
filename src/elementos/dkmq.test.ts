/**
 * Criterio 1 del spike E0: la DKMQ en TypeScript coincide con Quad3D de PyNite 3.2.0 a 1e-10
 * en flexión pura. Oráculo congelado: __fixtures__/dkmq-pynite.json (spike/e0/dkmq/oraculo_pynite.py).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { autovaloresSimetrica, asimetria, errorRelativo, maxAbs, producto } from "../pruebas/densa.ts";
import { ModeloPrueba } from "../pruebas/ensamblador.ts";
import { PARCHE_EXTERIORES, PARCHE_NUDOS, PARCHE_QUADS } from "../pruebas/parche.ts";
import { cargaPresionDkmq, esfuerzosDkmq, extrapolarGauss, rigidezDkmq, type MaterialLamina } from "./dkmq.ts";
import { expandir, GDL_FLEXION, marcoLocal, rigidezAGlobales, vectorAGlobales, vectorALocales } from "./lamina.ts";

interface ElementoOraculo {
  nombre: string;
  X: number[];
  xy: number[];
  t: number;
  E: number;
  nu: number;
  kb: number[];
  f_presion_unitaria: number[];
}
interface ModeloOraculo {
  nombre: string;
  t: number;
  E: number;
  nu: number;
  presion: number;
  nudos: number[][];
  quads: number[][];
  apoyos: boolean[][];
  desplazamientos: number[][];
  momentos_centroide: number[][];
  cortantes_centroide: number[][];
  punto_gauss: [number, number];
  momentos_gauss: number[][];
  cortantes_gauss: number[][];
}
const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "dkmq-pynite.json"), "utf8")) as {
  elementos: ElementoOraculo[];
  modelos: ModeloOraculo[];
};

const TOL = 1e-10;
const erroresElemento: Record<string, unknown>[] = [];

describe("DKMQ: elemento frente a PyNite", () => {
  for (const e of oraculo.elementos) {
    const mat: MaterialLamina = { E: e.E, nu: e.nu, t: e.t };
    it(`${e.nombre}: rigidez de flexión y carga de presión`, () => {
      const k = rigidezDkmq(e.xy, mat);
      const ek = errorRelativo(k, e.kb);
      const ef = errorRelativo(cargaPresionDkmq(e.xy, 1), e.f_presion_unitaria);
      erroresElemento.push({ elemento: e.nombre, k: ek, f: ef });
      expect(ek).toBeLessThan(TOL);
      expect(ef).toBeLessThan(TOL);
    });
    it(`${e.nombre}: los ejes locales son los de PyNite`, () => {
      expect(errorRelativo(marcoLocal(e.X).xy, e.xy)).toBeLessThan(1e-13);
    });
  }
});

describe("DKMQ: propiedades", () => {
  const casos = oraculo.elementos.filter((_, i) => i % 3 === 0);
  for (const e of casos) {
    it(`${e.nombre}: simétrica, semidefinida y con exactamente 3 modos rígidos`, () => {
      const k = rigidezDkmq(e.xy, { E: e.E, nu: e.nu, t: e.t });
      expect(asimetria(k, 12)).toBeLessThan(1e-14);
      // Modos de sólido rígido en flexión: w = 1; giro θx (w = y); giro θy (w = −x).
      const modos: number[][] = [[], [], []];
      for (let a = 0; a < 4; a++) {
        const x = e.xy[2 * a]!;
        const y = e.xy[2 * a + 1]!;
        modos[0]!.push(1, 0, 0);
        modos[1]!.push(y, 1, 0);
        modos[2]!.push(-x, 0, 1);
      }
      for (const r of modos) expect(maxAbs(producto(k, r, 12)) / maxAbs(k)).toBeLessThan(1e-12);
      const lambda = autovaloresSimetrica(k, 12);
      const escala = lambda[11]!;
      expect(Math.abs(lambda[2]!) / escala).toBeLessThan(1e-12);
      expect(lambda[3]! / escala).toBeGreaterThan(1e-9);
    });
  }

  it("la rigidez global no depende de la orientación del elemento ni del nudo de inicio", () => {
    const e = oraculo.elementos.find((x) => x.nombre === "distorsionado_t0.25")!;
    const mat = { E: e.E, nu: e.nu, t: e.t };
    // Mismo elemento numerado empezando por el nudo 3: misma K global salvo permutación de nudos.
    const X = e.X;
    const Xrot = [...X.slice(6), ...X.slice(0, 6)];
    const kGlobal = (coords: number[]) => {
      const m = marcoLocal(coords);
      const k24 = new Float64Array(576);
      expandir(k24, rigidezDkmq(m.xy, mat), GDL_FLEXION);
      return rigidezAGlobales(k24, m.R);
    };
    const k1 = kGlobal(X);
    const k2 = kGlobal(Xrot);
    // nudo a de Xrot = nudo (a + 2) % 4 de X
    const k2p = new Float64Array(576);
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        const ii = 6 * ((Math.floor(i / 6) + 2) % 4) + (i % 6);
        const jj = 6 * ((Math.floor(j / 6) + 2) % 4) + (j % 6);
        k2p[24 * ii + jj] = k2[24 * i + j]!;
      }
    }
    expect(errorRelativo(k2p, k1)).toBeLessThan(1e-12);
  });
});

/** Resuelve un modelo de placa del oráculo con la DKMQ en TS y el núcleo WASM. */
function resolverPlaca(m: ModeloOraculo) {
  const nn = m.nudos.length;
  const modelo = new ModeloPrueba(6 * nn);
  const mat: MaterialLamina = { E: m.E, nu: m.nu, t: m.t };
  const elementos = m.quads.map((q) => {
    const X = q.flatMap((v) => m.nudos[v]!);
    const marco = marcoLocal(X);
    const k24 = new Float64Array(576);
    expandir(k24, rigidezDkmq(marco.xy, mat), GDL_FLEXION);
    const f24 = new Float64Array(24);
    const fp = cargaPresionDkmq(marco.xy, m.presion);
    GDL_FLEXION.forEach((g, i) => (f24[g] = fp[i]!));
    const gdl = q.flatMap((v) => [0, 1, 2, 3, 4, 5].map((c) => 6 * v + c));
    modelo.sumarRigidez(gdl, rigidezAGlobales(k24, marco.R));
    modelo.sumarCarga(gdl, vectorAGlobales(f24, marco.R));
    return { marco, gdl };
  });
  m.apoyos.forEach((mascara, v) => mascara.forEach((c, i) => c && modelo.coartar(6 * v + i)));
  const { u, reacciones } = modelo.resolver();
  return { u, reacciones, elementos, mat, modelo };
}

describe("DKMQ: placas completas frente a PyNite (flexión pura)", () => {
  const errores: Record<string, unknown>[] = [];
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  });
  afterAll(() => {
    // INFORME=ruta.json bunx vitest run …: deja los errores medidos como evidencia del spike.
    if (process.env.INFORME) writeFileSync(process.env.INFORME, JSON.stringify({ elementos: erroresElemento, modelos: errores }, null, 1));
  });

  for (const m of oraculo.modelos) {
    it(`${m.nombre}: desplazamientos, esfuerzos y equilibrio`, () => {
      const { u, reacciones, elementos, mat, modelo } = resolverPlaca(m);
      expect(errorRelativo(u, m.desplazamientos.flat())).toBeLessThan(TOL);

      // Esfuerzos: PyNite da Mx, My y Mxy con el signo contrario al del motor (H02); Q igual.
      const Mc: number[] = [];
      const Qc: number[] = [];
      const Mg: number[] = [];
      const Qg: number[] = [];
      const [xi, eta] = m.punto_gauss;
      elementos.forEach(({ marco, gdl }) => {
        const ul = vectorALocales(gdl.map((g) => u[g]!), marco.R);
        const { momentos, cortantes } = esfuerzosDkmq(marco.xy, mat, GDL_FLEXION.map((g) => ul[g]!));
        Mc.push(...extrapolarGauss(momentos, 3, 0, 0).map((v) => -v));
        Qc.push(...extrapolarGauss(cortantes, 2, 0, 0));
        Mg.push(...extrapolarGauss(momentos, 3, xi, eta).map((v) => -v));
        Qg.push(...extrapolarGauss(cortantes, 2, xi, eta));
      });
      expect(errorRelativo(Mc, m.momentos_centroide.flat())).toBeLessThan(TOL);
      expect(errorRelativo(Qc, m.cortantes_centroide.flat())).toBeLessThan(TOL);
      expect(errorRelativo(Mg, m.momentos_gauss.flat())).toBeLessThan(TOL);
      expect(errorRelativo(Qg, m.cortantes_gauss.flat())).toBeLessThan(TOL);

      // Regla de oro 2: ΣF y ΣM de cargas + reacciones a 1e-9 relativo.
      const eq = modelo.equilibrio(m.nudos.flat(), reacciones);
      expect(eq.fuerzas).toBeLessThan(1e-9);
      expect(eq.momentos).toBeLessThan(1e-9);
      errores.push({ modelo: m.nombre, u: errorRelativo(u, m.desplazamientos.flat()), M: errorRelativo(Mc, m.momentos_centroide.flat()), Q: errorRelativo(Qc, m.cortantes_centroide.flat()), ...eq });
    });
  }
});

describe("DKMQ: patch test de flexión de MacNeal–Harder", () => {
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  });

  for (const t of [0.001, 0.01]) {
    it(`curvatura constante con t = ${t}: nudos interiores exactos y momentos constantes`, () => {
      // w = c·(x² + xy + y²)/2 → θx = ∂w/∂y, θy = −∂w/∂x; cortante nulo (campo de Kirchhoff).
      const c = 1e-3;
      const mat: MaterialLamina = { E: 1e6, nu: 0.25, t };
      const D = (mat.E * t ** 3) / (12 * (1 - mat.nu ** 2));
      const exacto = ([x, y]: readonly [number, number]) => [(c * (x * x + x * y + y * y)) / 2, c * (x / 2 + y), -c * (x + y / 2)];
      const modelo = new ModeloPrueba(6 * PARCHE_NUDOS.length);
      const marcos = PARCHE_QUADS.map((q) => {
        const marco = marcoLocal(q.flatMap((v) => [...PARCHE_NUDOS[v]!, 0]));
        const k24 = new Float64Array(576);
        expandir(k24, rigidezDkmq(marco.xy, mat), GDL_FLEXION);
        const gdl = q.flatMap((v) => [0, 1, 2, 3, 4, 5].map((g) => 6 * v + g));
        modelo.sumarRigidez(gdl, rigidezAGlobales(k24, marco.R));
        return { marco, gdl };
      });
      PARCHE_NUDOS.forEach((p, v) => {
        for (const g of [0, 1, 5]) modelo.coartar(6 * v + g); // membrana fuera
        if ((PARCHE_EXTERIORES as readonly number[]).includes(v)) exacto(p).forEach((val, i) => modelo.coartar(6 * v + 2 + i, val));
      });
      const { u } = modelo.resolver();
      const calc: number[] = [];
      const ref: number[] = [];
      PARCHE_NUDOS.forEach((p, v) => {
        calc.push(u[6 * v + 2]!, u[6 * v + 3]!, u[6 * v + 4]!);
        ref.push(...exacto(p));
      });
      expect(errorRelativo(calc, ref)).toBeLessThan(1e-10);
      // Momentos del motor: Mx = My = D·c·(1+ν), Mxy = D·(1−ν)·c/2; Q = 0
      const Mref = [D * c * (1 + mat.nu), D * c * (1 + mat.nu), (D * (1 - mat.nu) * c) / 2];
      for (const { marco, gdl } of marcos) {
        const ul = vectorALocales(gdl.map((g) => u[g]!), marco.R);
        const { momentos, cortantes } = esfuerzosDkmq(marco.xy, mat, GDL_FLEXION.map((g) => ul[g]!));
        // Los ejes locales de cada elemento están girados: se comprueba el invariante Mx + My
        // y la norma del tensor, que no dependen del giro.
        for (let g = 0; g < 4; g++) {
          const [mx, my, mxy] = [momentos[3 * g]!, momentos[3 * g + 1]!, momentos[3 * g + 2]!];
          expect(Math.abs(mx + my - (Mref[0]! + Mref[1]!)) / Mref[0]!).toBeLessThan(1e-9);
          const det = mx * my - mxy * mxy;
          expect(Math.abs(det - (Mref[0]! * Mref[1]! - Mref[2]! ** 2)) / Mref[0]! ** 2).toBeLessThan(1e-9);
          expect(Math.abs(cortantes[2 * g]!) + Math.abs(cortantes[2 * g + 1]!)).toBeLessThan(1e-9 * Mref[0]! / 0.24);
        }
      }
    });
  }
});
