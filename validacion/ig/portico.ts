/**
 * Fase IG (`docs/fem3d/imperfeccion.md`): el edificio de las pruebas de los casos derivados del motor
 * (`src/motor/derivados.test.ts`) y la comparación con la **estructura inclinada**.
 *
 * Dos plantas de 3 m de 2 × 1 vanos (5 × 4 m): seis pilares de 30 × 30, vigas de 30 × 50 según X (una
 * barra por vano) y una lámina de 20 cm por recuadro. El caso G lleva una puntual en cada cabeza de
 * pilar (distinta en cada uno: el edificio no es simétrico), una uniforme en cada viga y una de
 * superficie en cada lámina, así que la carga vertical de cada nudo se conoce a mano.
 *
 *   bun validacion/ig/portico.ts   → validacion/ig/out_inclinada.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import type { CargaBarra, CargaLamina, CargaNodal, CasoCarga, ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { carga, Constructor, seccionRectangular } from "../../src/pruebas/constructor.ts";

const [LX, LY, H] = [5, 4, 3];
const PILAR = seccionRectangular(0.3, 0.3);
const VIGA = seccionRectangular(0.3, 0.5);
const LOSA = { E: 3e7, nu: 0.2, t: 0.2 };

export interface PorticoIG {
  modelo: ModeloAnalitico;
  /** La carga vertical hacia abajo del caso G en cada nudo, a mano. */
  pesos: Float64Array;
}

export interface OpcionesPortico {
  /** Un diafragma rígido por planta. */
  diafragma?: boolean;
  /** θ: cada nudo, desplazado θ·z en X (los pilares, inclinados; los forjados, horizontales). */
  inclinacion?: number;
  /** Factor del área de los pilares (para quitarles el acortamiento). */
  axil?: number;
}

export function porticoIG(o: OpcionesPortico = {}): PorticoIG {
  const m = new Constructor();
  const th = o.inclinacion ?? 0;
  const pilar = { ...PILAR, A: PILAR.A * (o.axil ?? 1) };
  const xs = [0, LX, 2 * LX];
  const ys = [0, LY];
  const nudo = (i: number, j: number, k: number) => m.nudo(xs[i]! + th * k * H, ys[j]!, k * H, `N${i}${j}${k}`);
  const niveles = [0, 1, 2].map((k) => xs.map((_, i) => ys.map((_, j) => nudo(i, j, k))));
  for (const fila of niveles[0]!) for (const v of fila) m.apoyo(v);
  const nodales: CargaNodal[] = [];
  const barras: CargaBarra[] = [];
  const laminas: CargaLamina[] = [];
  const pesos: number[] = [];
  const pesa = (v: number, p: number) => (pesos[v] = (pesos[v] ?? 0) + p);
  for (let k = 1; k <= 2; k++) {
    const nv = niveles[k]!;
    xs.forEach((_, i) =>
      ys.forEach((_, j) => {
        m.barra(niveles[k - 1]![i]![j]!, nv[i]![j]!, pilar, [1, 0, 0]);
        // (con una componente horizontal, que no cuenta en la carga vertical)
        const P = 40 + 10 * i + 7 * j + 5 * k;
        nodales.push(carga(nv[i]![j]!, { fz: -P, fy: 3 }));
        pesa(nv[i]![j]!, P);
      }),
    );
    for (let i = 0; i < 2; i++)
      ys.forEach((_, j) => {
        const b = m.barra(nv[i]![j]!, nv[i + 1]![j]!, VIGA, [0, 0, 1]);
        const q = 12 + 3 * i + 2 * j;
        barras.push({ tipo: "distribuida", barra: b, ejes: "global", qa: [0, 0, -q] });
        pesa(nv[i]![j]!, (q * LX) / 2);
        pesa(nv[i + 1]![j]!, (q * LX) / 2);
      });
    for (let i = 0; i < 2; i++) {
      const ns = [nv[i]![0]!, nv[i + 1]![0]!, nv[i + 1]![1]!, nv[i]![1]!] as const;
      const l = m.lamina(ns, LOSA);
      const q = 6 + 2 * i + k;
      laminas.push({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -q] });
      for (const v of ns) pesa(v, (q * LX * LY) / 4);
    }
    if (o.diafragma) m.diafragma(m.nudo(LX + th * k * H, LY / 2, k * H, `M${k}`), nv.flat(), `D${k}`);
  }
  m.caso("G", nodales, [], barras, laminas);
  const modelo = m.modelo();
  return { modelo, pesos: Float64Array.from({ length: modelo.nudos.length }, (_, v) => pesos[v] ?? 0) };
}

/** Un caso derivado de G: θ·P en cada nudo, en X (0) o en Y (1). */
export const derivadoDeG = (id: string, gdl: 0 | 1, factor: number): CasoCarga => ({ id, derivado: { de: "G", gdl, factor } });
export const conCasos = (m: ModeloAnalitico, ...casos: CasoCarga[]): ModeloAnalitico => ({ ...m, casos: [...m.casos, ...casos] });

export interface DiferenciaInclinada {
  /** max |inclinada − recta − derivado| / max |derivado|, en los momentos y los cortantes de los extremos de las barras y en ux. */
  M: number;
  V: number;
  u: number;
  /** Las escalas: el mayor momento (kN·m), cortante (kN) y desplazamiento (m) del caso derivado. */
  sM: number;
  sV: number;
  sU: number;
}

/**
 * La estructura inclinada θ bajo G, menos la recta bajo G, frente al caso derivado de G en la recta:
 * la definición de la imperfección (CE A19 §5.2 y su figura 5.1) frente a sus fuerzas equivalentes.
 */
export function compararInclinada(o: { diafragma: boolean; axil: number; inclinacion: number }): DiferenciaInclinada {
  const recto = porticoIG({ diafragma: o.diafragma, axil: o.axil });
  const [g, ix] = casosValidos(calcular(conCasos(recto.modelo, derivadoDeG("IX", 0, o.inclinacion))));
  const [gi] = casosValidos(calcular(porticoIG(o).modelo));
  const nb = recto.modelo.barras!.length;
  let [eM, sM, eV, sV] = [0, 0, 0, 0];
  for (let b = 0; b < nb; b++)
    for (const extremo of [0, 6])
      for (const c of [1, 2, 4, 5]) {
        const q = 12 * b + extremo + c;
        const d = gi!.esfuerzosBarras[q]! - g!.esfuerzosBarras[q]! - ix!.esfuerzosBarras[q]!;
        if (c >= 4) [eM, sM] = [Math.max(eM, Math.abs(d)), Math.max(sM, Math.abs(ix!.esfuerzosBarras[q]!))];
        else [eV, sV] = [Math.max(eV, Math.abs(d)), Math.max(sV, Math.abs(ix!.esfuerzosBarras[q]!))];
      }
  let [eU, sU] = [0, 0];
  for (let v = 0; v < recto.modelo.nudos.length; v++) {
    eU = Math.max(eU, Math.abs(gi!.u[6 * v]! - g!.u[6 * v]! - ix!.u[6 * v]!));
    sU = Math.max(sU, Math.abs(ix!.u[6 * v]!));
  }
  return { M: eM / sM, V: eV / sV, u: eU / sU, sM, sV, sU };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [];
  const di = (t: string) => {
    lineas.push(t);
    console.log(t);
  };
  const e = (v: number) => v.toExponential(2);
  di("La estructura inclinada θ bajo G, menos la recta, frente al caso derivado de G (θ·P en cada nudo):");
  di("max |inclinada − recta − derivado| / max |derivado| en los extremos de todas las barras y en ux de todos los nudos");
  di("");
  di("θ        diafragma  área de los pilares   momentos   cortantes  ux        (escalas: M kN·m, V kN, u m)");
  for (const inclinacion of [1e-5, 1 / 200])
    for (const diafragma of [false, true])
      for (const axil of [1e4, 100, 1]) {
        const r = compararInclinada({ diafragma, axil, inclinacion });
        di(`${e(inclinacion)}  ${diafragma ? "sí" : "no"}         × ${String(axil).padEnd(18)} ${e(r.M)}   ${e(r.V)}   ${e(r.u)}  (${e(r.sM)}, ${e(r.sV)}, ${e(r.sU)})`);
      }
  writeFileSync(join(import.meta.dirname, "out_inclinada.txt"), lineas.join("\n") + "\n");
}
