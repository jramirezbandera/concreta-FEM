/**
 * Fase SO, criterio 7 (`docs/fem3d/segundo-orden.md` §9): el coeficiente de estabilidad global del
 * motor frente al segundo orden geométrico de OpenSeesPy 3.8 (`geomTransf PDelta`) en el edificio de
 * 3 plantas de `validacion/so/modelos.ts`, compilado sin empotramiento parcial y sin áreas de cortante
 * (lo que OpenSees monta igual, VS2).
 *
 * OpenSees pone la gravedad (γ_G = 1,35·g, γ_Q = 1,05·g) y después el viento (1,5·W+) con la rigidez
 * geométrica de los axiles: el efecto del viento con P-Δ entre el lineal es la amplificación «de
 * verdad» (`validacion/so/oraculo_pdelta.py`, fixture `__fixtures__/opensees-so.json`). Aquí, el γz
 * del motor con esos mismos factores (los desplazamientos sin multiplicar: el P-Δ es elástico) tiene
 * que darla: en el desplazamiento de la planta alta y en la suma de los momentos de la base de los
 * pilares, a ≤ 3 % con Q ≲ 0,12 (hasta g = 12), y se mide hasta dónde sigue valiendo (g = 20, Q ≈ 0,17).
 *
 * De paso, el primer orden del motor es el de OpenSees (el viento lineal: momentos en la base a 1e-6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FACTOR_VIENTO, factoresNivel, modeloOraculo, NIVELES_ORACULO, OPCIONES_ORACULO } from "../../validacion/so/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Consultas } from "./consultas.ts";

interface Medida {
  uTop: number;
  Mbase: Record<string, number>;
  sumaM: number;
}
interface Oraculo {
  bases: string[];
  niveles: { g: number; factores: Record<string, number>; lineal: Medida; pdelta: Medida }[];
}

const ORACULO = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-so.json"), "utf8")) as Oraculo;

let m: ReturnType<typeof modeloOraculo>;
let r: Extract<ReturnType<typeof calcular>, { valido: true }>;
let q: Consultas;
let ids: string[];
let kW: number;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  m = modeloOraculo();
  const rc = calcular(m.modelo);
  if (!rc.valido) throw new Error(rc.diagnosticos.map((d) => d.mensaje).join(" "));
  r = rc;
  q = new Consultas(m.fisico, { modelo: m.modelo, mapeo: m.compilado.mapeo }, r.casos, OPCIONES_ORACULO, r.modal);
  ids = q.fisico.casos.map((c) => c.id);
  kW = ids.indexOf("W+");
});

describe("SO, criterio 7: el γz del motor frente al P-Δ de OpenSeesPy", () => {
  it("el primer orden es el mismo: los momentos del viento en la base de los pilares, a 1e-6", () => {
    const lineal = ORACULO.niveles[0]!.lineal;
    const barras = m.modelo.barras!;
    for (const b of m.bases) {
      const e = r.casos[kW]!.esfuerzosBarras;
      const M = FACTOR_VIENTO * Math.hypot(e[12 * b.indice + 4]!, e[12 * b.indice + 5]!);
      expect(barras[b.indice]!.id).toBe(b.id);
      expect(Math.abs(M - lineal.Mbase[b.id]!) / lineal.Mbase[b.id]!).toBeLessThan(1e-6);
    }
    expect(NIVELES_ORACULO).toEqual(ORACULO.niveles.map((n) => n.g));
  });

  it("γz da la amplificación del P-Δ geométrico a ≤ 3 % con Q ≲ 0,1, y se mide con más carga", () => {
    const lineas: string[] = [];
    for (const n of ORACULO.niveles) {
      const f = new Float64Array(ids.length);
      for (const [id, v] of Object.entries(factoresNivel(n.g))) f[ids.indexOf(id)] = v;
      expect(n.factores).toEqual(factoresNivel(n.g));
      const cs = q.coeficientesSegundoOrden(f);
      expect(cs.map((x) => x.caso)).toEqual(["W+"]);
      const { Q, coeficiente } = cs[0]!;
      const ratioU = n.pdelta.uTop / n.lineal.uTop;
      const ratioM = n.pdelta.sumaM / n.lineal.sumaM;
      lineas.push(`g = ${n.g}: Q = ${Q.toFixed(4)}, γz = ${coeficiente!.toFixed(4)}; OpenSees u ×${ratioU.toFixed(4)}, ΣM base ×${ratioM.toFixed(4)}`);
      expect(coeficiente).not.toBeNull();
      expect(Q).toBeGreaterThan(0);
      if (Q <= 0.12) {
        expect(Math.abs(coeficiente! / ratioU - 1)).toBeLessThan(0.03);
        expect(Math.abs(coeficiente! / ratioM - 1)).toBeLessThan(0.03);
      } else {
        // con más carga, el coeficiente único sigue del lado de la amplificación real o por debajo de ella a ≤ 10 %
        expect(Math.abs(coeficiente! / ratioM - 1)).toBeLessThan(0.1);
      }
    }
    // eslint-disable-next-line no-console
    console.log(lineas.join("\n"));
  });
});
