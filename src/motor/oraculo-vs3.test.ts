/**
 * VS3, criterio 3 (`docs/fem3d/viento-sismo.md` §5): el análisis por espectros de respuesta del motor
 * frente a OpenSeesPy 3.8 (`responseSpectrumAnalysis`, modo a modo) en un pórtico compilado.
 *
 * De cada modo y cada dirección, la respuesta de OpenSees con el espectro de la NCSE-02 (programado
 * en el oráculo aparte del texto de la norma): los desplazamientos de unos nudos, los esfuerzos de
 * extremo de unas barras y la suma de las reacciones. Aquí, lo mismo con el motor: el caso base de
 * cada modo por su coeficiente (`respuestaEspectral`), modo a modo y con su signo, y la combinación
 * de cada variable con `Superposicion` frente a la que el oráculo hace en Python (la del art. 3.6.2.4
 * y la cuadrática completa).
 *
 * Lo de OpenSees está en `__fixtures__/opensees-vs3.json`, de `validacion/vs3/oraculo_opensees.py`
 * (con el resumen, también del pórtico objetivo de 7 plantas, en `validacion/vs3/out_opensees.txt`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { modalDe, MODELOS } from "../../validacion/vs2/modelos-oraculo.ts";
import { respuestaMotor } from "../../validacion/vs3/modelos-oraculo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { COEFICIENTE_RIESGO, COEFICIENTE_TERRENO, emplazamiento } from "../normas/ncse02.ts";
import { casosModales, Superposicion, type OpcionesRegla } from "./espectral.ts";
import type { ResultadoCaso, ResultadoModal } from "./modelo.ts";

interface Variables {
  u: number[][];
  barras: number[][];
  reaccion: number[];
}
interface Oraculo {
  variables: { nudos: number[]; barras: number[]; apoyos: number[] };
  espectro: { ab: number; K: number; rho: number; C: number; mu: [number, number]; omega: number };
  periodos: number[];
  direcciones: { mu: number; ac: number; TA: number; TB: number; beta: number; Sa: number[]; modos: Variables[]; srss: Variables; cqc: Variables }[];
}

const ORACULO = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-vs3.json"), "utf8")) as Record<string, Oraculo>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/**
 * Los esfuerzos de extremo del motor ([N, Vy, Vz, T, My, Mz] en i' y en j') como las fuerzas de los
 * extremos sobre la barra en ejes locales, que es lo que da OpenSees (`localForce`): el mismo triedro
 * (vecxz = vz), y de esfuerzos a fuerzas, los signos de `fuerzasDeExtremo` (`cargasBarra.ts`).
 */
const SIGNOS = [-1, -1, -1, -1, 1, -1, 1, 1, 1, 1, -1, 1];

/** Las variables del oráculo en un caso (un modo) del motor. */
function variablesDe(r: ResultadoCaso, v: Oraculo["variables"]): Variables {
  return {
    u: v.nudos.map((k) => Array.from(r.u.subarray(6 * k, 6 * k + 6))),
    barras: v.barras.map((b) => SIGNOS.map((s, c) => s * r.esfuerzosBarras[12 * b + c]!)),
    reaccion: [0, 1].map((c) => v.apoyos.reduce((t, k) => t + r.reacciones[6 * k + c]!, 0)),
  };
}

const plano = (x: Variables): number[] => [...x.u.flat(), ...x.barras.flat(), ...x.reaccion];
/** Escala de cada número de `plano`: el mayor de su clase (desplazamientos, giros, fuerzas, momentos, reacciones). */
function escalas(xs: Variables[]): number[] {
  const max = (sel: (x: Variables) => number[]) => Math.max(...xs.flatMap((x) => sel(x).map(Math.abs)));
  const [d, g] = [max((x) => x.u.flatMap((u) => u.slice(0, 3))), max((x) => x.u.flatMap((u) => u.slice(3)))];
  const [f, m] = [max((x) => x.barras.flatMap((b) => [0, 1, 2, 6, 7, 8].map((c) => b[c]!))), max((x) => x.barras.flatMap((b) => [3, 4, 5, 9, 10, 11].map((c) => b[c]!)))];
  const R = max((x) => x.reaccion);
  const x0 = xs[0]!;
  return [...x0.u.flatMap(() => [d, d, d, g, g, g]), ...x0.barras.flatMap(() => [f, f, f, m, m, m, f, f, f, m, m, m]), ...x0.reaccion.map(() => R)];
}

describe("VS3, criterio 3: el análisis por espectros del motor frente a OpenSeesPy", () => {
  const nombre = "portico-3x3x2";
  const o = ORACULO[nombre]!;
  let md: ResultadoModal;
  let casos: ResultadoCaso[];

  beforeAll(() => {
    md = modalDe(MODELOS[nombre]!.modelo());
    casos = casosModales(md).resultados;
  });

  it("los periodos, y el espectro de la NCSE-02 en cada uno (el del oráculo, programado aparte)", () => {
    expect(md.modos.length).toBe(o.periodos.length);
    md.modos.forEach((m, i) => expect(Math.abs(m.periodo - o.periodos[i]!) / o.periodos[i]!).toBeLessThan(1e-10));
    const e = emplazamiento(o.espectro.ab, o.espectro.K, COEFICIENTE_RIESGO.normal, COEFICIENTE_TERRENO.III);
    o.direcciones.forEach((d, eje) => {
      expect(Math.abs(d.ac - e.ac)).toBeLessThan(1e-15);
      expect(Math.abs(d.TA - e.TA)).toBeLessThan(1e-15);
      const r = respuestaMotor(md, eje as 0 | 1, {});
      md.modos.forEach((_, i) => expect(Math.abs(r.aceleraciones[i]! - d.Sa[i]!) / d.Sa[i]!, `Sa del modo ${i + 1}`).toBeLessThan(1e-9));
      // hay modos en la rama ascendente (T < TA), en la meseta y pares a menos del 10 %
      expect(md.modos.some((m) => m.periodo < d.TA)).toBe(true);
      expect(md.modos.some((m) => m.periodo >= d.TA)).toBe(true);
      expect(r.regla.pesos.length).toBeGreaterThan(0);
    });
  });

  it.each([
    [0, "X"],
    [1, "Y"],
  ] as const)("%i, la respuesta de cada modo con el sismo según %s: desplazamientos, esfuerzos de las barras y reacciones, con su signo", (eje, _nombre) => {
    const d = o.direcciones[eje]!;
    const r = respuestaMotor(md, eje, {});
    const motor = casos.map((caso, i) => {
      const x = variablesDe(caso, o.variables);
      const c = r.coeficientes[i]!;
      return { u: x.u.map((u) => u.map((v) => c * v)), barras: x.barras.map((b) => b.map((v) => c * v)), reaccion: x.reaccion.map((v) => c * v) };
    });
    const esc = escalas(d.modos);
    let peor = 0;
    d.modos.forEach((m, i) => {
      const [a, b] = [plano(motor[i]!), plano(m)];
      expect(a.length).toBe(b.length);
      a.forEach((v, q) => (peor = Math.max(peor, Math.abs(v - b[q]!) / esc[q]!)));
    });
    expect(peor).toBeLessThan(1e-8);
  });

  it.each([
    ["srss", {} as OpcionesRegla],
    ["cqc", { tipo: "cqc", zeta: 0.05 } as OpcionesRegla],
  ] as const)("la combinación de cada variable (%s) es la que el oráculo hace con sus modos", (regla, opciones) => {
    for (const eje of [0, 1] as const) {
      const d = o.direcciones[eje]!;
      const r = respuestaMotor(md, eje, opciones);
      const sup = new Superposicion(casos.length, [{ id: "E", espectral: { modos: Int32Array.from(casos.keys()), coeficientes: r.coeficientes, regla: r.regla, dominante: r.dominante, lineal: null, ductilidad: 1 } }]);
      const porModo = casos.map((caso) => plano(variablesDe(caso, o.variables)));
      const esperado = plano(d[regla]);
      const esc = escalas([d[regla]]);
      let peor = 0;
      let conSigno = 0;
      esperado.forEach((v, q) => {
        const combinado = sup.valor([1], (k) => porModo[k]![q]!);
        peor = Math.max(peor, Math.abs(Math.abs(combinado) - v) / esc[q]!);
        // el signo, el de la respuesta del modo dominante en esa variable
        const dominante = plano(d.modos[r.dominante]!)[q]!;
        if (Math.abs(dominante) > 1e-6 * esc[q]! && Math.abs(combinado) > 1e-9 * esc[q]!) {
          expect(Math.sign(combinado)).toBe(Math.sign(dominante));
          conSigno++;
        }
      });
      expect(peor, `${regla}, eje ${eje}`).toBeLessThan(1e-8);
      expect(conSigno).toBeGreaterThan(40);
      // el cortante en la base
      expect(Math.abs(r.basal - d[regla].reaccion[eje]!) / r.basal).toBeLessThan(1e-9);
    }
  });
});
