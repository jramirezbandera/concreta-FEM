/**
 * Apoyos que llegan a una viga con la unión por las caras (fase LV), o a la huella de un pilar.
 * - Lo que un apoyo coacciona dentro de una viga (sus lados en el ancho y los nudos de la cara, que
 *   son esclavos del enlace al eje) va al eje de la viga, con las mismas coacciones: un murete que
 *   llega a la viga es un apoyo puntual de la viga en el cruce. Llegar al eje o a la cara da los
 *   mismos apoyos y los mismos resultados; un apoyo puntual en el ancho, los de uno en el eje.
 * - Lo que cae en la huella de un pilar (o en la zona rígida de una viga en él) es del pilar: el
 *   apoyo acaba en su cara. Si no queda nada, es un error.
 * - La reacción del apoyo lineal cuenta los nudos del eje aunque no caigan en su polilínea, y el
 *   equilibrio cuadra (`calcular` lo comprueba a 1e-9).
 * Medida de la torsión (sólo uz frente al giro coartado y a la unión por el eje):
 * `validacion/lv/apoyosVigaTorsion.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { barajar, valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ApoyoFisico, ApoyoLineal, ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";
import { distanciaABorde, puntoEnPoligono } from "./poligonos.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const X = [0, 5, 10];
const Y = [0, 4, 8];
const UZ = [false, false, true, false, false, false] as ApoyoLineal["coartados"];

/** 2 × 2 vanos de 5 × 4 m, vigas de 30×50 por todos los ejes y pilares de 30×30, losa de 20 cm. */
function modelo(apoyosLineales: ApoyoLineal[], apoyos: ApoyoFisico[] = []): ModeloFisico {
  const pilares = X.flatMap((x, i) => Y.map((y, j) => ({ id: `P${i}${j}`, x, y, desde: "P0", hasta: "P1", seccion: "P30" })));
  const vigas = [...Y.map((y, j) => ({ id: `VX${j}`, planta: "P1", puntos: [[0, y], [10, y]] as Vec2[], seccion: "V30" })), ...X.map((x, i) => ({ id: `VY${i}`, planta: "P1", puntos: [[x, 0], [x, 8]] as Vec2[], seccion: "V30" }))];
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares,
    vigas,
    losas: [{ id: "L", planta: "P1", contorno: [[0, 0], [10, 0], [10, 8], [0, 8]], espesor: 0.2, material: "H" }],
    apoyosLineales,
    apoyos,
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "CM", caso: "G", planta: "P1", losa: "L", q: [0, 0, -2] },
      { tipo: "superficie", id: "SC", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -3] },
    ],
  };
}
const al = (puntos: Vec2[]): ApoyoLineal => ({ id: "AL", planta: "P1", puntos, coartados: UZ });
const ap = (x: number, y: number): ApoyoFisico => ({ id: "AP", planta: "P1", x, y, coartados: UZ });

const compilado = (f: ModeloFisico, op: OpcionesCompilacion = {}) => valido(compilar(f, op));
type C = ReturnType<typeof compilado>;

/** Nudos apoyados de la planta P1 (no las bases de los pilares), en planta. */
const apoyados = (r: C): Vec2[] => r.modelo.apoyos!.flatMap((a) => (r.modelo.nudos[a.nudo]!.z === 3 ? [[r.modelo.nudos[a.nudo]!.x, r.modelo.nudos[a.nudo]!.y] as Vec2] : []));
/** Esclavos de los enlaces rígidos. */
const esclavos = (r: C) => new Set((r.modelo.restricciones ?? []).flatMap((x) => (x.tipo === "enlace-rigido" ? x.esclavos : [])));
/** Mayor diferencia relativa de u y de las reacciones entre dos modelos con los mismos nudos. */
function diferencia(a: C, b: C): number {
  const [x, y] = [casosValidos(calcular(a.modelo)), casosValidos(calcular(b.modelo))];
  let d = 0;
  x.forEach((c, k) => {
    for (const campo of ["u", "reacciones"] as const) {
      const [p, q] = [c[campo], y[k]![campo]];
      const m = Math.max(...Array.from(p, Math.abs));
      for (let i = 0; i < p.length; i++) d = Math.max(d, Math.abs(p[i]! - q[i]!) / m);
    }
  });
  return d;
}
const diag = (r: ReturnType<typeof compilar>, codigo: string) => r.diagnosticos.filter((d) => d.codigo === codigo);

describe("apoyos que llegan a una viga por su ancho o su cara (fase LV)", () => {
  it("un murete que llega al eje de la viga la apoya en el cruce: válido, con su info e hipótesis", () => {
    const r = compilado(modelo([al([[2, 6], [5, 6]])]));
    const d = diag(r, "apoyo/a-viga");
    expect(d).toHaveLength(1);
    expect(d[0]!.severidad).toBe("info");
    expect(d[0]!.ids).toEqual(["AL", "VY1"]);
    expect(r.hipotesis.some((h) => h.startsWith("Los apoyos que llegan a una viga") && h.includes("AL"))).toBe(true);
    // El cruce con el eje está apoyado, y ningún nudo de las caras (esclavos)
    const P = apoyados(r);
    expect(P.some((q) => Math.hypot(q[0] - 5, q[1] - 6) < 1e-9)).toBe(true);
    const e = esclavos(r);
    for (const a of r.modelo.apoyos!) expect(e.has(a.nudo)).toBe(false);
    // Fuera del ancho, los nudos de la losa por su polilínea, como siempre
    expect(P.filter((q) => Math.abs(q[1] - 6) < 1e-9 && q[0] < 4.85 - 1e-9).length).toBeGreaterThan(3);
    expect(r.mapeo.apoyosEnVigas?.AL).toHaveLength(1);
  });

  it("llegar al eje o sólo a la cara da los mismos apoyos y los mismos resultados", () => {
    const [a, b] = [compilado(modelo([al([[2, 6], [5, 6]])])), compilado(modelo([al([[2, 6], [4.85, 6]])]))];
    expect(JSON.stringify(b.modelo.apoyos)).toBe(JSON.stringify(a.modelo.apoyos));
    expect(JSON.stringify(b.modelo.nudos)).toBe(JSON.stringify(a.modelo.nudos));
    expect(diferencia(a, b)).toBeLessThan(1e-12);
  });

  it("la reacción del apoyo lineal cuenta el nudo del eje, aunque no caiga en su polilínea", () => {
    const f = modelo([al([[2, 6], [4.85, 6]])]);
    const r = compilado(f);
    const cs = casosValidos(calcular(r.modelo));
    const q = new Consultas(f, r, cs, {});
    const R = q.reacciones("AL");
    if (!R.valido) throw new Error("AL");
    // La de los nudos de AL más la del eje, que es la del modelo con el murete hasta el eje
    const g = modelo([al([[2, 6], [5, 6]])]);
    const rg = compilado(g);
    const Rg = new Consultas(g, rg, casosValidos(calcular(rg.modelo)), {}).reacciones("AL");
    if (!Rg.valido) throw new Error("AL");
    expect(R.valor.nudos).toBe(Rg.valor.nudos);
    for (let i = 0; i < R.valor.resultante.length; i++) expect(Math.abs(R.valor.resultante[i]! - Rg.valor.resultante[i]!)).toBeLessThan(1e-9);
    // Y todas las reacciones suman la carga (G: pp de losa, vigas y pilares, y CM)
    let fz = 0;
    for (let n = 0; n < r.modelo.nudos.length; n++) fz += cs[1]!.reacciones[6 * n + 2]!;
    expect(Math.abs(fz - 3 * 80) / 240).toBeLessThan(1e-9);
  });

  it("un murete que cruza la viga de través la apoya en un solo nudo del eje", () => {
    const r = compilado(modelo([al([[2, 6], [8, 6]])]));
    const enAncho = apoyados(r).filter((q) => Math.abs(q[0] - 5) <= 0.15 + 1e-9);
    expect(enAncho).toEqual([[5, 6]]);
  });

  it("un murete oblicuo apoya los nudos del eje entre las proyecciones de sus cruces con las caras", () => {
    const r = compilado(modelo([al([[2, 5], [8, 7]])]));
    const enAncho = apoyados(r).filter((q) => Math.abs(q[0] - 5) <= 0.15 + 1e-9);
    expect(enAncho.length).toBeGreaterThanOrEqual(2);
    for (const q of enAncho) {
      expect(Math.abs(q[0] - 5)).toBeLessThan(1e-9);
      // Las proyecciones de los cruces con las caras: y = 6 ∓ 0,15/3
      expect(q[1]).toBeGreaterThanOrEqual(6 - 0.05 - 1e-9);
      expect(q[1]).toBeLessThanOrEqual(6 + 0.05 + 1e-9);
    }
    expect(casosValidos(calcular(r.modelo))).toHaveLength(2);
  });

  it("un apoyo lineal por dentro del ancho, a lo largo de la viga, apoya su eje en ese trozo", () => {
    const r = compilado(modelo([al([[5.06, 5], [5.06, 7]])]));
    expect(diag(r, "apoyo/a-viga")).toHaveLength(1);
    const P = apoyados(r).filter((q) => q[1] > 4.5 && q[1] < 7.5 && Math.abs(q[0] - 5) < 1);
    expect(P.length).toBeGreaterThanOrEqual(2);
    for (const q of P) {
      expect(Math.abs(q[0] - 5)).toBeLessThan(1e-9);
      expect(q[1]).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(q[1]).toBeLessThanOrEqual(7 + 1e-9);
    }
    expect(P.some((q) => Math.abs(q[1] - 5) < 1e-9) && P.some((q) => Math.abs(q[1] - 7) < 1e-9)).toBe(true);
  });

  it("un murete que llega a una viga de borde por fuera de la losa (su cara exterior) apoya su eje", () => {
    const r = compilado(modelo([al([[2, 2], [2, -0.15]])]));
    expect(diag(r, "apoyo/a-viga")[0]?.ids).toEqual(["AL", "VX0"]);
    expect(apoyados(r).some((q) => Math.hypot(q[0] - 2, q[1]) < 1e-9)).toBe(true);
  });

  it("un apoyo puntual en el ancho va al eje: lo mismo que puesto en el eje", () => {
    const [a, b] = [compilado(modelo([], [ap(5.1, 6)])), compilado(modelo([], [ap(5, 6)]))];
    expect(diag(compilar(modelo([], [ap(5.1, 6)])), "apoyo/a-viga")).toHaveLength(1);
    expect(JSON.stringify(a.modelo.apoyos)).toBe(JSON.stringify(b.modelo.apoyos));
    expect(a.mapeo.apoyos.AP).toBe(b.mapeo.apoyos.AP);
    expect(diferencia(a, b)).toBeLessThan(1e-12);
  });

  it("con la unión por el eje, nada cambia: el murete apoya los nudos de la losa hasta el eje", () => {
    const r = compilado(modelo([al([[2, 6], [5, 6]])]), { unionLosaViga: "eje" });
    expect(diag(r, "apoyo/a-viga")).toEqual([]);
    expect(r.mapeo.apoyosEnVigas).toBeUndefined();
  });

  it("reordenar las listas da el mismo modelo, bit a bit", () => {
    const f = modelo([al([[2, 5], [8, 7]]), { id: "AL2", planta: "P1", puntos: [[5.06, 1], [5.06, 3]], coartados: UZ }], [ap(9.9, 6)]);
    const z = azar(5);
    const g: ModeloFisico = { ...f, vigas: barajar(f.vigas!, z), pilares: barajar(f.pilares!, z), apoyosLineales: barajar(f.apoyosLineales!, z) };
    const [a, b] = [compilado(f), compilado(g)];
    expect(JSON.stringify(b.modelo) === JSON.stringify(a.modelo)).toBe(true);
    expect(JSON.stringify(b.mapeo) === JSON.stringify(a.mapeo)).toBe(true);
  });
});

describe("apoyos que llegan a la huella de un pilar", () => {
  const huella = (x: number, y: number): Vec2[] => [
    [x - 0.15, y - 0.15],
    [x + 0.15, y - 0.15],
    [x + 0.15, y + 0.15],
    [x - 0.15, y + 0.15],
  ];
  for (const unionLosaViga of ["cara", "eje"] as const)
    it(`un murete que entra en la huella acaba en su cara (unión por ${unionLosaViga === "cara" ? "las caras" : "el eje"})`, () => {
      const r = compilado(modelo([al([[3, 2], [4.9, 3.9]])]), { unionLosaViga });
      const d = diag(r, "apoyo/en-pilar");
      expect(d).toHaveLength(1);
      expect(d[0]!.severidad).toBe("info");
      expect(d[0]!.ids).toEqual(["AL", "P11"]);
      expect(r.hipotesis.some((h) => h.startsWith("Los apoyos que llegan a la huella"))).toBe(true);
      // Ningún nudo apoyado en la huella, ni el del pilar
      for (const q of apoyados(r)) expect(puntoEnPoligono(q, huella(5, 4)) || distanciaABorde(q, huella(5, 4)) < 1e-9, `${q}`).toBe(false);
      expect(apoyados(r).length).toBeGreaterThan(3);
    });

  it("un apoyo lineal entero dentro de la huella es un error: no apoya ningún nudo", () => {
    const r = compilar(modelo([al([[4.9, 3.9], [4.95, 3.95]])]));
    expect(r.valido).toBe(false);
    expect(diag(r, "apoyo/sin-destino")[0]?.ids).toEqual(["AL"]);
  });
});
