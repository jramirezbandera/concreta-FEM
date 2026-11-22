/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9, criterios 7 a 10): las demandas de las zapatas.
 *
 * - En un pilar en ménsula con cargas en su cabeza, lo que llega a la zapata en cada combinación es la
 *   estática a mano: N, H y M de las cargas, y en la cara inferior de la zapata M + H·(altura + h).
 * - Girado el pilar 90°, lo de x pasa a y (los ejes de la zapata son los del pilar).
 * - En el edificio de SO, la suma de los N de las zapatas en una combinación es la carga vertical de esa
 *   combinación (equilibrio, regla de oro 2).
 * - Con el sismo del programa, las ternas de una combinación son los signos pésimos de N, Mx y My (S ± A)
 *   con H aumentado, y nunca dan menos que la combinación con el signo de un solo modo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioZapatas, pilarAislado, type VariantePilar } from "../../../validacion/co/modelosZapatas.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { SITUACIONES_ELU } from "./pilares.ts";
import { demandasZapata, pilaresConZapata, SITUACIONES_GEO } from "./zapatas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

export function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

const cerca = (a: number, b: number, que: string, tol = 1e-9) => expect(Math.abs(a - b), `${que}: ${a} frente a ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("CO5: las demandas de las zapatas", () => {
  const ménsula = (v: VariantePilar) => {
    const q = consultas(pilarAislado(v));
    const d = demandasZapata(q, "P1");
    if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
    return { q, D: d.valor };
  };

  it("un pilar en ménsula: lo que llega a la zapata es la estática de sus cargas, en su cara inferior", () => {
    const v = { P: 400, Fx: 20, Fy: -8, Mx: 5, My: -12, altura: 3 };
    const { q, D } = ménsula(v);
    expect(D.planta).toBe("CIM");
    expect([D.cx, D.cy, D.circular]).toEqual([0.4, 0.4, false]);
    const combs = q.combinaciones({ situaciones: [...SITUACIONES_GEO, ...SITUACIONES_ELU] });
    if (!combs.valido) throw new Error("sin combinaciones");
    for (const h of [0, 0.6, 1.1]) {
      const c = D.cargas(h);
      expect(c.geo.length + c.elu.length).toBe(combs.valor.length);
      for (const x of [...c.geo, ...c.elu]) {
        const cb = combs.valor.find((y) => y.id === x.comb)!;
        const [fG, fW] = [cb.factores[0]!, cb.factores[1]!];
        // Las cargas de la cabeza, a la cara inferior de la zapata: r = (0, 0, altura + h)
        const z = v.altura + h;
        const [Fx, Fy] = [fW * v.Fx, fW * v.Fy];
        cerca(x.N, fG * v.P, `${x.comb} N`);
        cerca(x.Hx, Fx, `${x.comb} Hx`);
        cerca(x.Hy, Fy, `${x.comb} Hy`);
        cerca(x.Mx, fW * v.Mx - z * Fy, `${x.comb} Mx (h = ${h})`, 1e-8);
        cerca(x.My, fW * v.My + z * Fx, `${x.comb} My (h = ${h})`, 1e-8);
      }
    }
  });

  it("girado el pilar 90°, lo de x pasa a y en los ejes de la zapata", () => {
    const v = { P: 400, Fx: 20, Fy: -8, Mx: 5, My: -12, b: 0.3, h: 0.5 };
    const a = ménsula(v).D;
    const b = ménsula({ ...v, giro: 90 }).D;
    expect([a.cx, a.cy]).toEqual([0.5, 0.3]);
    expect(b.giro).toBe(90);
    for (const [x, y] of a.cargas(0.5).elu.map((x, i) => [x, b.cargas(0.5).elu[i]!] as const)) {
      // x' = +Y, y' = −X
      cerca(y.Hx, x.Hy, "Hx'");
      cerca(y.Hy, -x.Hx, "Hy'");
      cerca(y.Mx, x.My, "Mx'", 1e-8);
      cerca(y.My, -x.Mx, "My'", 1e-8);
      cerca(y.N, x.N, "N");
    }
  });

  it("un pilar circular: su diámetro en las dos direcciones", () => {
    const { D } = ménsula({ circular: true, h: 0.45 });
    expect([D.cx, D.cy, D.circular]).toEqual([0.45, 0.45, true]);
  });

  it("en el edificio, la suma de los N de las zapatas es la carga vertical de cada combinación", () => {
    const f = edificioZapatas({ sinImperfeccion: true });
    const q = consultas(f);
    const ids = pilaresConZapata(q);
    expect(ids).toHaveLength(9);
    const D = ids.map((id) => {
      const d = demandasZapata(q, id);
      if (!d.valido) throw new Error("demanda");
      return d.valor.cargas(0.6);
    });
    const porCaso = (caso: string) => (f.cargas ?? []).filter((c) => c.tipo === "puntual" && c.caso === caso).reduce((s, c) => s - (c.tipo === "puntual" ? (c.F?.[2] ?? 0) : 0), 0);
    const combs = q.combinaciones({ situaciones: [...SITUACIONES_GEO, ...SITUACIONES_ELU] });
    if (!combs.valido) throw new Error("sin combinaciones");
    for (const cb of combs.valor) {
      const esperado = f.casos.reduce((s, c, k) => s + cb.factores[k]! * porCaso(c.id), 0);
      const suma = D.reduce((s, x) => s + [...x.geo, ...x.elu].find((y) => y.comb === cb.id)!.N, 0);
      cerca(suma, esperado, cb.id, 1e-9);
    }
  });

  it("con el sismo del programa, los signos pésimos de cada combinación, nunca menos que un solo signo", () => {
    const q = consultas(edificioZapatas({ sismo: true }));
    const d = demandasZapata(q, "P1");
    if (!d.valido) throw new Error("demanda");
    const c = d.valor.cargas(0.7);
    const sismicas = c.elu.filter((x) => x.situacion === "ELU-SIS");
    expect(sismicas.length).toBeGreaterThan(0);
    expect(sismicas.every((x) => x.pesimos)).toBe(true);
    const porComb = new Map<string, typeof sismicas>();
    for (const x of sismicas) porComb.set(x.comb, [...(porComb.get(x.comb) ?? []), x]);
    // La parte estática y la amplitud de cada componente, de Consultas (por la reacción girada, aquí sin giro)
    const R = q.reacciones("P1");
    if (!R.valido) throw new Error("reacción");
    const combs = q.combinaciones({ situaciones: ["ELU-SIS"] });
    if (!combs.valido) throw new Error("sin combinaciones");
    for (const cb of combs.valor) {
      const ternas = porComb.get(cb.id)!;
      const { estatica: S, sismo: A } = q.sup.partir(R.valor.resultante, 6, cb.factores);
      // N = Fz de la reacción, con sus dos signos
      expect(new Set(ternas.map((t) => t.N))).toEqual(new Set(A[2] ? [S[2]! + A[2]!, S[2]! - A[2]!] : [S[2]!]));
      expect(ternas.length).toBe((A[2] ? 2 : 1) * 4);
      // H, con el signo que aumenta su valor absoluto: |H| = |S| + A
      for (const t of ternas) {
        cerca(Math.abs(t.Hx), Math.abs(S[0]!) + A[0]!, `${cb.id} Hx`);
        cerca(Math.abs(t.Hy), Math.abs(S[1]!) + A[1]!, `${cb.id} Hy`);
      }
      // Ningún signo de un solo modo da más de lo que cubren las ternas en N, Mx y My
      for (const k of ["N", "Mx", "My"] as const) {
        const v = ternas.map((t) => t[k]);
        const [lo, hi] = [Math.min(...v), Math.max(...v)];
        expect(hi - lo).toBeGreaterThanOrEqual(0);
        if (k === "N") {
          cerca(hi, S[2]! + A[2]!, `${cb.id} N máx`);
          cerca(lo, S[2]! - A[2]!, `${cb.id} N mín`);
        }
      }
    }
  });
});
