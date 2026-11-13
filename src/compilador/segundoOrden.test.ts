/**
 * Fase SO (`docs/fem3d/segundo-orden.md` §9, criterios 1, 2, 4, 5 y 6): el segundo orden global por
 * el coeficiente de estabilidad global.
 *
 * Un edificio de 3 plantas de 2 × 2 vanos de 6 m, sólo barras, con las cargas como puntuales en los
 * pilares (G y Q verticales en todos, el viento en el pilar central): así todas las cargas del modelo
 * analítico son nodales y la fórmula a mano (Σ P·u de los nudos, Σ H·z) es exacta.
 * - El motor: la resultante de cada caso es la de sus cargas nodales y su trabajo P·δ es Σ P·u a 1e-12,
 *   también en los modos (criterio 1); el modelo analítico y los casos no cambian (criterio 2, en las
 *   referencias congeladas).
 * - Las consultas: Q y γz a 1e-10 de la fórmula a mano en cada combinación (criterio 4); con
 *   `amplificar: false` o sin hipótesis horizontales, las combinaciones son las del generador bit a
 *   bit (criterio 5); Q lineal con la carga gravitatoria y con el multiplicador e invariante con la
 *   escala de la carga horizontal, y γz de EX igual con +e y −e en un edificio simétrico (criterio 6).
 * - Los datos: el multiplicador fuera de rango es un error de `validar`; la hipótesis del cálculo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO as edificio, type VarianteSO as Variante } from "../../validacion/so/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import { GAMMA_TRASLACIONAL, MULTIPLICADOR_POR_DEFECTO } from "./segundoOrden.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function calculado(v: Variante = {}) {
  const f = edificio(v);
  const c = valido(compilar(f));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
  return { f, c, r, q: new Consultas(f, c, r.casos, {}, r.modal) };
}

/** La fórmula a mano con las cargas nodales del modelo analítico: Σ H·(z − z₀) y Σ P·u de cada caso. */
function aMano(modelo: ModeloAnalitico, u: Float64Array, idH: string, idsG: string[], m: number) {
  let z0 = Infinity;
  for (const a of modelo.apoyos ?? []) if (a.coartados[0] || a.coartados[1]) z0 = Math.min(z0, modelo.nudos[a.nudo]!.z);
  const nodales = (id: string) => modelo.casos.find((c) => c.id === id)!.nodales ?? [];
  let MH = 0;
  for (const n of nodales(idH)) MH += n.f[0] * (modelo.nudos[n.nudo]!.z - z0);
  const MPd: Record<string, number> = {};
  for (const g of idsG) {
    let s = 0;
    for (const n of nodales(g)) s += -n.f[2] * u[6 * n.nudo]!;
    MPd[g] = m * s;
  }
  return { z0, MH, MPd, C: Object.fromEntries(idsG.map((g) => [g, MPd[g]! / MH])) };
}

describe("SO en el motor: la resultante de las cargas y el trabajo P·δ de cada caso", () => {
  it("la resultante es la de las cargas nodales y el trabajo P·δ es Σ P·u, caso a caso y modo a modo", () => {
    const { c, r, q } = calculado({ sismo: true });
    const nc = c.modelo.casos.length;
    r.casos.forEach((caso, k) => {
      const nodales = c.modelo.casos[k]!.nodales ?? [];
      const F = [0, 0, 0];
      const zF = [0, 0];
      for (const n of nodales) {
        for (let i = 0; i < 3; i++) F[i]! += n.f[i]!;
        zF[0]! += c.modelo.nudos[n.nudo]!.z * n.f[0];
        zF[1]! += c.modelo.nudos[n.nudo]!.z * n.f[1];
      }
      expect(caso.cargas.F.map((v, i) => Math.abs(v - F[i]!))).toSatisfy((d: number[]) => d.every((x) => x < 1e-9));
      expect(Math.abs(caso.cargas.zF[0] - zF[0]!)).toBeLessThan(1e-9);
      expect(Math.abs(caso.cargas.zF[1] - zF[1]!)).toBeLessThan(1e-9);
      expect(caso.cargas.pdelta.length).toBe(2 * nc);
      // el trabajo P·δ de cada caso k en los desplazamientos de este caso
      c.modelo.casos.forEach((ck, kk) => {
        let sx = 0;
        let sy = 0;
        for (const n of ck.nodales ?? []) {
          sx += -n.f[2] * caso.u[6 * n.nudo]!;
          sy += -n.f[2] * caso.u[6 * n.nudo + 1]!;
        }
        const escala = Math.max(1e-6, Math.abs(sx), Math.abs(sy));
        expect(Math.abs(caso.cargas.pdelta[2 * kk]! - sx) / escala).toBeLessThan(1e-12);
        expect(Math.abs(caso.cargas.pdelta[2 * kk + 1]! - sy) / escala).toBeLessThan(1e-12);
      });
    });
    // los modos: la resultante de sus fuerzas de inercia (a la cota de los maestros) y Σ P·u con su forma
    expect(r.modal).toBeDefined();
    const kG = c.modelo.casos.findIndex((x) => x.id === "G");
    for (const m of r.modal!.modos) {
      let Fx = 0;
      let zFx = 0;
      r.modal!.diafragmas.forEach((d, i) => {
        Fx += m.fuerzas[3 * i]!;
        zFx += c.modelo.nudos[d.maestro]!.z * m.fuerzas[3 * i]!;
      });
      expect(Math.abs(m.cargas.F[0] - Fx)).toBeLessThan(1e-9 * Math.max(1, Math.abs(Fx)));
      expect(Math.abs(m.cargas.zF[0] - zFx)).toBeLessThan(1e-9 * Math.max(1, Math.abs(zFx)));
      let s = 0;
      for (const n of c.modelo.casos[kG]!.nodales ?? []) s += -n.f[2] * m.u[6 * n.nudo]!;
      expect(Math.abs(m.cargas.pdelta[2 * kG]! - s)).toBeLessThan(1e-12 * Math.max(1e-6, Math.abs(s)));
    }
    // y en las consultas, los casos base de los modos llevan lo mismo
    expect(q.casos.length).toBe(nc + r.modal!.modos.length);
    expect(q.casos[nc]!.cargas).toBe(r.modal!.modos[0]!.cargas);
  });
});

describe("SO en las consultas: Q y γz de cada hipótesis horizontal", () => {
  it("coinciden con la fórmula a mano en cada combinación, y las combinaciones salen amplificadas", () => {
    const { c, q } = calculado();
    const so = q.segundoOrden();
    expect(so.valido).toBe(true);
    if (!so.valido) return;
    const v = so.valor;
    expect(v.amplificar).toBe(true);
    expect(v.multiplicador).toBe(MULTIPLICADOR_POR_DEFECTO);
    expect(v.gravitatorios).toEqual(["G", "Q"]);
    expect(v.hipotesis.map((h) => h.caso)).toEqual(["W+", "W-"]);
    const ids = q.fisico.casos.map((x) => x.id);
    for (const h of v.hipotesis) {
      const mano = aMano(c.modelo, q.casos[ids.indexOf(h.caso)]!.u, h.caso, ["G", "Q"], v.multiplicador);
      // W− empuja hacia −X: su e se da la vuelta (el sentido de su cortante en la base) y M_H sale positivo
      const s = h.caso === "W-" ? -1 : 1;
      expect([h.direccion[0], h.direccion[1] + 0]).toEqual([s, 0]);
      expect(Math.abs(v.z0 - mano.z0)).toBeLessThan(1e-12);
      expect(Math.abs(h.MH - s * mano.MH) / Math.abs(mano.MH)).toBeLessThan(1e-10);
      for (const g of ["G", "Q"]) {
        expect(Math.abs(h.MPdelta[g]! - s * mano.MPd[g]!) / Math.abs(mano.MPd[g]!)).toBeLessThan(1e-10);
        expect(Math.abs(h.C[g]! - mano.C[g]!) / Math.abs(mano.C[g]!)).toBeLessThan(1e-10);
      }
      expect(h.C.G!).toBeGreaterThan(0);
      expect(h.C.Q!).toBeGreaterThan(0);
      // Q = M_Pδ(G) / M_H: su α_cr equivalente es 1/C
      expect(h.C.G!).toBeLessThan(0.2);
    }
    const generadas = q.combinacionesGeneradas();
    const amplificadas = q.combinaciones();
    if (!generadas.valido || !amplificadas.valido) throw new Error("sin combinaciones");
    expect(amplificadas.valor.length).toBe(generadas.valor.length);
    let conViento = 0;
    generadas.valor.forEach((g, i) => {
      const a = amplificadas.valor[i]!;
      expect(a.id).toBe(g.id);
      const hs = v.hipotesis.filter((h) => g.factores[ids.indexOf(h.caso)]);
      if (!hs.length) {
        expect(a.factores).toEqual(g.factores);
        expect(a.amplificacion).toBeUndefined();
        return;
      }
      conViento++;
      expect(a.amplificacion?.map((x) => x.caso)).toEqual(hs.map((h) => h.caso));
      for (const h of hs) {
        const k = ids.indexOf(h.caso);
        const Q = g.factores[ids.indexOf("G")]! * h.C.G! + g.factores[ids.indexOf("Q")]! * h.C.Q!;
        const x = a.amplificacion!.find((y) => y.caso === h.caso)!;
        expect(Math.abs(x.Q - Q)).toBeLessThan(1e-12);
        expect(Math.abs(x.coeficiente - 1 / (1 - Q))).toBeLessThan(1e-12);
        expect(Math.abs(a.factores[k]! - g.factores[k]! * x.coeficiente)).toBeLessThan(1e-12);
        expect(x.coeficiente).toBeGreaterThan(1);
      }
      // los demás factores, los mismos bits
      g.factores.forEach((f, k) => {
        if (!hs.some((h) => ids.indexOf(h.caso) === k)) expect(a.factores[k]).toBe(f);
      });
      // y los coeficientes de la combinación, los mismos por la otra puerta
      const cs = q.coeficientesSegundoOrden(g.factores);
      expect(cs.map((x) => x.caso)).toEqual(hs.map((h) => h.caso));
      cs.forEach((x, j) => expect(x.coeficiente).toBe(a.amplificacion![j]!.coeficiente));
    });
    expect(conViento).toBeGreaterThan(0);
    // la lista por combinación y lo peor de cada hipótesis
    expect(v.combinaciones.length).toBeGreaterThan(0);
    for (const h of v.hipotesis) {
      const m = v.maximos.find((x) => x.caso === h.caso)!;
      expect(m.Q).toBe(Math.max(...v.combinaciones.filter((x) => x.caso === h.caso).map((x) => x.Q)));
      expect(m.coeficiente).toBeCloseTo(1 / (1 - m.Q), 12);
    }
  });

  it("con amplificar: false, o sin hipótesis horizontales, las combinaciones son las del generador bit a bit", () => {
    for (const v of [{ segundoOrden: { amplificar: false } }, { sinViento: true }] as Variante[]) {
      const { q } = calculado(v);
      const g = q.combinacionesGeneradas();
      const a = q.combinaciones();
      if (!g.valido || !a.valido) throw new Error("sin combinaciones");
      expect(a.valor.length).toBe(g.valor.length);
      a.valor.forEach((x, i) => {
        expect(x.factores).toEqual(g.valor[i]!.factores);
        expect(x.amplificacion).toBeUndefined();
      });
      const so = q.segundoOrden();
      expect(so.valido).toBe(true);
      if (!so.valido) return;
      if (v.sinViento) {
        expect(so.valor.hipotesis).toEqual([]);
        expect(so.diagnosticos).toEqual([]);
      } else {
        expect(so.valor.amplificar).toBe(false);
        expect(so.valor.hipotesis.length).toBe(2);
        // desactivado y traslacional: el recordatorio de β > 1; si no, nada
        const peor = Math.max(...so.valor.maximos.map((m) => m.coeficiente ?? Infinity));
        expect(so.diagnosticos.map((d) => d.codigo)).toEqual(peor > GAMMA_TRASLACIONAL ? ["segundo-orden/sin-amplificar"] : []);
      }
    }
  });

  it("metamórficas: Q es lineal con la carga gravitatoria y con el multiplicador, e invariante con la escala del viento", () => {
    const base = calculado().q.segundoOrden();
    const dobleW = calculado({ W: 60 }).q.segundoOrden();
    const dobleG = calculado({ G: 200 }).q.segundoOrden();
    const dobleM = calculado({ segundoOrden: { multiplicadorDesplazamientos: 2 * MULTIPLICADOR_POR_DEFECTO } }).q.segundoOrden();
    if (!base.valido || !dobleW.valido || !dobleG.valido || !dobleM.valido) throw new Error("sin segundo orden");
    base.valor.hipotesis.forEach((h, i) => {
      const cerca = (a: number, b: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(1e-9);
      cerca(dobleW.valor.hipotesis[i]!.C.G!, h.C.G!);
      cerca(dobleW.valor.hipotesis[i]!.MH, 2 * h.MH);
      cerca(dobleG.valor.hipotesis[i]!.C.G!, 2 * h.C.G!);
      cerca(dobleG.valor.hipotesis[i]!.C.Q!, h.C.Q!);
      cerca(dobleM.valor.hipotesis[i]!.C.G!, 2 * h.C.G!);
      cerca(dobleM.valor.hipotesis[i]!.C.Q!, 2 * h.C.Q!);
    });
  });

  it("con el sismo del programa, EX±e y EY±e son hipótesis horizontales; en un edificio simétrico, +e y −e dan el mismo Q", () => {
    const { q } = calculado({ sismo: true });
    const so = q.segundoOrden();
    expect(so.valido).toBe(true);
    if (!so.valido) return;
    const v = so.valor;
    expect(v.hipotesis.map((h) => h.caso)).toEqual(["W+", "W-", "EX+e", "EX-e", "EY+e", "EY-e"]);
    const h = Object.fromEntries(v.hipotesis.map((x) => [x.caso, x]));
    expect(h["EX+e"]!.direccion).toEqual([1, 0]);
    expect(h["EY+e"]!.direccion).toEqual([0, 1]);
    for (const [a, b] of [
      ["EX+e", "EX-e"],
      ["EY+e", "EY-e"],
      ["EX+e", "EY+e"],
    ] as const) {
      expect(Math.abs(h[a]!.C.G! - h[b]!.C.G!) / h[a]!.C.G!).toBeLessThan(1e-6);
      expect(Math.abs(h[a]!.MH - h[b]!.MH) / h[a]!.MH).toBeLessThan(1e-6);
    }
    // el sismo pesa más que el viento (sus desplazamientos van por μ = 2) y queda cerca de lo que dan los
    // niveles de la respuesta espectral: Σ m·g·δ / Σ V·h con la masa G + 0,5·Q (una comprobación de sensatez:
    // allí se combina cada nivel y aquí la suma, no es la misma cuenta)
    const s = q.sismo();
    if (!s.valido) throw new Error("sin sismo");
    const d = s.valor.direcciones[0];
    const MPd = d.niveles.reduce((acc, n) => acc + n.masa * s.valor.g * n.desplazamiento, 0) * v.multiplicador;
    const MH = d.niveles.reduce((acc, n) => acc + n.cortante * n.altura, 0);
    const Qniveles = MPd / MH;
    const Qso = h["EX+e"]!.C.G! + 0.5 * h["EX+e"]!.C.Q!;
    expect(Math.abs(Qso / Qniveles - 1)).toBeLessThan(0.1);
    expect(h["EX+e"]!.C.G!).toBeGreaterThan(h["W+"]!.C.G!);
    // y las combinaciones sísmicas llevan sus coeficientes
    const comb = q.combinaciones({ situaciones: ["ELU-SIS"] });
    if (!comb.valido) throw new Error("sin combinaciones sísmicas");
    expect(comb.valor.length).toBeGreaterThan(0);
    for (const c of comb.valor) {
      expect(c.amplificacion?.length).toBeGreaterThan(0);
      for (const x of c.amplificacion!) expect(x.coeficiente).toBeGreaterThan(1);
    }
  });

  it("Q no depende del origen de cotas: con la ±0,00 en la primera planta (z₀ = −3), lo mismo, también con el sismo (A2-5)", () => {
    const a = calculado({ sismo: true }).q.segundoOrden();
    const f = edificio({ sismo: true });
    // La cimentación como sótano: la ±0,00 pasa a la primera planta y todo baja 3 m
    (f.plantas[f.plantas.length - 1] as { tipo?: string }).tipo = "sotano";
    const c = valido(compilar(f));
    const r = calcular(c.modelo);
    if (!r.valido) throw new Error("no calcula");
    const b = new Consultas(f, c, r.casos, {}, r.modal).segundoOrden();
    if (!a.valido || !b.valido) throw new Error("sin segundo orden");
    expect(b.valor.z0).toBeCloseTo(a.valor.z0 - 3, 12);
    a.valor.hipotesis.forEach((h, i) => {
      const o = b.valor.hipotesis[i]!;
      expect(o.caso).toBe(h.caso);
      // Antes, con el sismo, M_H salía un 1,5 % alto y Q un 1,5 % bajo
      expect(Math.abs(o.MH / h.MH - 1), h.caso).toBeLessThan(1e-9);
      expect(Math.abs(o.C.G! / h.C.G! - 1), h.caso).toBeLessThan(1e-9);
    });
  });

  it("el multiplicador fuera de rango es un error de validación, y la hipótesis del cálculo lo cuenta", () => {
    for (const m of [0, -1, 20, Number.NaN]) {
      const r = compilar(edificio({ segundoOrden: { multiplicadorDesplazamientos: m } }));
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.map((d) => d.codigo)).toContain("segundo-orden/multiplicador");
    }
    const c = valido(compilar(edificio()));
    const h = c.hipotesis.find((x) => x.includes("coeficiente de estabilidad global"));
    expect(h).toBeDefined();
    expect(h).toContain("W+, W-");
    expect(h).toContain("β = 1");
    const sin = valido(compilar(edificio({ sinViento: true })));
    expect(sin.hipotesis.some((x) => x.includes("Segundo orden"))).toBe(false);
    const off = valido(compilar(edificio({ segundoOrden: { amplificar: false } })));
    expect(off.hipotesis.find((x) => x.includes("Segundo orden"))).toContain("desactivado");
  });
});
