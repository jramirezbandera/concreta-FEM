/**
 * Los desniveles de los forjados (fase DN, `docs/fem3d/desniveles.md`; compilador DN1):
 * - sin desniveles, o con `desnivel: 0` escrito, el mismo modelo analítico;
 * - los nudos siguen en el plano de la planta (DN-a): con un desnivel sólo cambian las zonas rígidas
 *   de los pilares y el peso de las vigas bajo el forjado. La cabeza del tramo de debajo es rígida hasta
 *   la cara inferior más baja de lo que le llega y la base del de encima arranca en la cara superior más
 *   alta, con los dos planos del forjado (oráculo a mano a 1e-12);
 * - una viga toma el desnivel del forjado más alto que la toca (DN-e);
 * - el peso de la viga bajo el forjado quita sólo lo que se solapan en canto;
 * - dos forjados con desniveles distintos que no se solapan en canto necesitan una viga, un muro o un
 *   apoyo lineal en todo su borde común (`losa/escalon-sin-apoyo`), y con un solape menor que medio
 *   canto del más delgado se avisa (`losa/escalon-solape-corto`), DN-b; sin depender del orden de las
 *   listas;
 * - la hipótesis lo deja escrito.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import { Plantas, pesoPropioEsperado } from "../agente/sensatez.ts";
import { desnivelesVigas } from "./desniveles.ts";
import type { Losa, ModeloFisico, OpcionesCompilacion, Vec2, Viga } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type Valido = Extract<ResultadoCompilacion, { valido: true }>;
const L = 6;
const e = 0.15;
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/**
 * Dos plantas sobre la cimentación: en N1, la losa A en x ∈ [0, 6] y la B en x ∈ [6, 12] (con su
 * desnivel), y una viga opcional VE en x = 6; en N2, una losa C entera. Pilares de 30 × 30 en x = 0, 6
 * y 12, y = 0 y 6.
 */
function modelo(o: { dzB?: number; dzA?: number; viga?: { b: number; h: number }; zuncho?: boolean; tB?: number } = {}): ModeloFisico {
  const pilares = [0, L, 2 * L].flatMap((x, i) => [0, L].map((y, j) => ({ id: `P${i + 1}${j + 1}`, x, y, desde: "N0", hasta: "N2", seccion: "p" })));
  const losaB: Losa = { id: "B", planta: "N1", material: "H", espesor: o.tB ?? 0.25, contorno: rect(L, -e, 2 * L + e, L + e) };
  if (o.dzB !== undefined) losaB.desnivel = o.dzB;
  const losaA: Losa = { id: "A", planta: "N1", material: "H", espesor: 0.25, contorno: rect(-e, -e, L, L + e) };
  if (o.dzA !== undefined) losaA.desnivel = o.dzA;
  const vigas: Viga[] = [];
  if (o.viga) vigas.push({ id: "VE", planta: "N1", puntos: [[L, 0], [L, L]], seccion: "v" });
  if (o.zuncho) vigas.push({ id: "VZ", planta: "N1", puntos: [[2 * L, 0], [2 * L, L]], seccion: "z" });
  return {
    plantas: [
      { id: "N2", altura: null },
      { id: "N1", altura: 3 },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "H", forma: "rectangular", b: o.viga?.b ?? 0.3, h: o.viga?.h ?? 0.5 },
      { id: "z", material: "H", forma: "rectangular", b: 0.3, h: 0.4 },
    ],
    pilares,
    vigas,
    losas: [losaA, losaB, { id: "C", planta: "N2", material: "H", espesor: 0.25, contorno: rect(-e, -e, 2 * L + e, L + e) }],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

const red = (v?: readonly number[]) => v?.map((x) => Math.round(x * 1e12) / 1e12 + 0);
const offsets = (r: Valido, id: string) => {
  const o = r.modelo.barras!.find((b) => b.id === id)!.offsets ?? {};
  return { i: red(o.i), j: red(o.j) };
};
const op: OpcionesCompilacion = { tamanoMalla: 1 };

describe("los desniveles de los forjados (fase DN)", () => {
  it("sin desniveles, o con desnivel 0 escrito, el mismo modelo analítico", () => {
    for (const viga of [undefined, { b: 0.3, h: 0.5 }]) {
      const sin = valido(compilar(modelo({ viga }), op));
      const cero = valido(compilar(modelo({ viga, dzA: 0, dzB: 0 }), op));
      expect(JSON.stringify(cero.modelo)).toBe(JSON.stringify(sin.modelo));
      expect(cero.hipotesis.some((h) => h.includes("desnivel"))).toBe(false);
    }
  });

  it("la cabeza, hasta la cara inferior más baja; la base de encima, desde la cara superior más alta (plano superior)", () => {
    // B 10 cm más baja, con la viga de 30 × 50 en el escalón (con el desnivel del más alto, 0)
    const r = valido(compilar(modelo({ dzB: -0.1, viga: { b: 0.3, h: 0.5 } }), op));
    // P1x, sólo en A: la de siempre
    expect(offsets(r, "P11:N1")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    expect(offsets(r, "P11:N2")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    // P2x, en el escalón: la viga (0,5) manda abajo; arriba, A y la viga en la cota
    expect(offsets(r, "P21:N1")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r, "P21:N2")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    // P3x, sólo en B: 0,25 + 0,10 por debajo, y el tramo de encima arranca 0,10 bajo el nudo
    expect(offsets(r, "P31:N1")).toEqual({ i: undefined, j: [0, 0, -0.35] });
    expect(offsets(r, "P31:N2")).toEqual({ i: [0, 0, -0.1], j: [0, 0, -0.25] });
    // Las estaciones [i, i′, j′, j] del tramo de encima de P31
    const k = r.modelo.barras!.findIndex((b) => b.id === "P31:N2");
    expect(r.mapeo.barras[k]!.s.map((s) => Math.round(s * 1e9) / 1e9)).toEqual([3, 2.9, 5.75, 6]);
    expect(r.hipotesis.some((h) => h.startsWith("Forjados con desnivel (DN): B −0,1 m"))).toBe(true);
  });

  it("un desnivel positivo: la base de encima, rígida en lo que sube", () => {
    const r = valido(compilar(modelo({ dzB: 0.1, viga: { b: 0.3, h: 0.5 } }), op));
    // B, de +0,10 a −0,15
    expect(offsets(r, "P31:N1")).toEqual({ i: undefined, j: [0, 0, -0.15] });
    expect(offsets(r, "P31:N2")).toEqual({ i: [0, 0, 0.1], j: [0, 0, -0.25] });
    // La viga sube con B (DN-e): de +0,10 a −0,40; A, de 0 a −0,25
    expect(offsets(r, "P21:N1")).toEqual({ i: undefined, j: [0, 0, -0.4] });
    expect(offsets(r, "P21:N2")).toEqual({ i: [0, 0, 0.1], j: [0, 0, -0.25] });
    expect(r.hipotesis.find((h) => h.startsWith("Forjados con desnivel"))).toContain("VE +0,1 m");
  });

  it("con el plano medio: medio canto ± el desnivel", () => {
    const r = valido(compilar(modelo({ dzB: -0.1 }), { ...op, planoForjado: "medio" }));
    expect(offsets(r, "P11:N1")).toEqual({ i: undefined, j: [0, 0, -0.125] });
    expect(offsets(r, "P31:N1")).toEqual({ i: undefined, j: [0, 0, -0.225] });
    expect(offsets(r, "P31:N2")).toEqual({ i: [0, 0, 0.025], j: [0, 0, -0.125] });
    // en el escalón sin viga, A y B: lo más bajo de B y lo más alto de A
    expect(offsets(r, "P21:N1")).toEqual({ i: undefined, j: [0, 0, -0.225] });
    expect(offsets(r, "P21:N2")).toEqual({ i: [0, 0, 0.125], j: [0, 0, -0.125] });
  });

  it("la viga, con el desnivel del forjado más alto que la toca (DN-e)", () => {
    const f = modelo({ dzB: -0.1, viga: { b: 0.3, h: 0.5 }, zuncho: true });
    const forjados = f.losas!.map((l) => ({ id: l.id, planta: l.planta, region: { contorno: l.contorno, huecos: [] }, desnivel: l.desnivel ?? 0, canto: l.espesor }));
    const vigas = f.vigas!.map((v) => ({ id: v.id, planta: v.planta, puntos: v.puntos, semiancho: 0.15 }));
    const d = desnivelesVigas(forjados, vigas, 0.02);
    expect(d.get("VE")).toBeUndefined(); // A en la cota
    expect(d.get("VZ")).toBe(-0.1); // sólo B
    // el zuncho de 40 sólo en B: lo que ocupa el nudo, 0,40 + 0,10
    const r = valido(compilar(f, op));
    expect(offsets(r, "P31:N1")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r, "P31:N2")).toEqual({ i: [0, 0, -0.1], j: [0, 0, -0.25] });
  });

  it("el peso de la viga bajo el forjado quita sólo lo que se solapan en canto", () => {
    // Una viga plana de 30 × 30 en el escalón: con A (0 / −0,25) se solapa 0,25; con B a −0,10 (−0,10 / −0,35), 0,20
    const peso = (dzB?: number) => {
      const r = valido(compilar(modelo({ dzB, viga: { b: 0.3, h: 0.3 } }), op));
      const c = casosValidos(calcular(r.modelo))[0]!;
      let s = 0;
      for (let i = 2; i < c.reacciones.length; i += 6) s += c.reacciones[i]!;
      return s;
    };
    // de cada lado se quita γ·(b/2)·solape por metro: el de B, 0,05 menos en los 6 m
    expect(peso(-0.1) - peso()).toBeCloseTo(25 * 0.15 * 0.05 * L, 9);
    // con los dos en la cota, el de siempre (C2-g)
    expect(peso(0)).toBe(peso());
    // el esperado de A3, sin la malla, es el calculado también con el desnivel (y con la viga subida)
    for (const dzB of [-0.1, 0.1, -0.2]) {
      const f = modelo({ dzB, viga: { b: 0.3, h: 0.3 } });
      const esperado = pesoPropioEsperado(f, new Plantas(f)).reduce((s, x) => s + x.esperado, 0);
      expect(esperado).toBeCloseTo(peso(dzB), 6);
    }
  });

  it("escalones: sin solape y sin viga es un error; con la viga, válido; con poco solape, aviso (DN-b)", () => {
    const codigos = (f: ModeloFisico) => compilar(f, op).diagnosticos.map((d) => d.codigo);
    // 30 cm más baja: no se solapan (0,25 − 0,30 < 0)
    const sin = compilar(modelo({ dzB: -0.3 }), op);
    expect(sin.valido).toBe(false);
    const err = sin.diagnosticos.find((d) => d.codigo === "losa/escalon-sin-apoyo")!;
    expect(err.ids).toEqual(["A", "B"]);
    expect(err.mensaje).toContain("de (6,00; 0,15) a (6,00; 5,85)"); // entre las huellas de los pilares
    expect(codigos(modelo({ dzB: -0.3, viga: { b: 0.3, h: 0.6 } }))).not.toContain("losa/escalon-sin-apoyo");
    // un apoyo lineal en todo el borde también vale; en la mitad, no
    const conApoyo = (y1: number): ModeloFisico => ({ ...modelo({ dzB: -0.3 }), apoyosLineales: [{ id: "AL", planta: "N1", puntos: [[L, -e], [L, y1]], coartados: [false, false, true, false, false, false] }] });
    expect(codigos(conApoyo(L + e))).not.toContain("losa/escalon-sin-apoyo");
    const mitad = compilar(conApoyo(3), op);
    expect(mitad.diagnosticos.find((d) => d.codigo === "losa/escalon-sin-apoyo")?.mensaje).toContain("de (6,00; 3,00) a (6,00; 5,85)");
    // 15 cm: solape de 0,10 < 0,125, aviso; 10 cm (0,15), nada; con la viga, nada
    expect(codigos(modelo({ dzB: -0.15 }))).toContain("losa/escalon-solape-corto");
    expect(valido(compilar(modelo({ dzB: -0.15 }), op)).modelo).toBeDefined();
    expect(codigos(modelo({ dzB: -0.1 }))).not.toContain("losa/escalon-solape-corto");
    expect(codigos(modelo({ dzB: -0.15, viga: { b: 0.3, h: 0.5 } }))).not.toContain("losa/escalon-solape-corto");
    // la maciza de 20 enrasada por abajo con una de 25: solape de 0,15, nada
    expect(codigos(modelo({ dzB: -0.05, tB: 0.2 }))).not.toContain("losa/escalon-solape-corto");
  });

  it("los escalones no dependen del orden de las listas", () => {
    const f = modelo({ dzB: -0.3 });
    const g: ModeloFisico = { ...f, losas: [...f.losas!].reverse(), pilares: [...f.pilares!].reverse() };
    const a = compilar(f, op).diagnosticos.filter((d) => d.codigo.startsWith("losa/escalon"));
    const b = compilar(g, op).diagnosticos.filter((d) => d.codigo.startsWith("losa/escalon"));
    expect(b.map((d) => [d.codigo, [...d.ids!].sort()])).toEqual(a.map((d) => [d.codigo, [...d.ids!].sort()]));
    expect(a.length).toBe(1);
  });
});
