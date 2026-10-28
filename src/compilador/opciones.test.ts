/**
 * Valores por defecto del compilador decididos el 2026-10-04 (`validacion/c1/out_decisiones.txt`):
 * - C1-a: la mitad del nudo de dimensión finita es rígida en las vigas (factor 0,5); en los pilares,
 *   hasta la cara del nudo (ZR1, 2026-10-20: lo que daba ya el factor 0,5 con las vigas en el plano),
 *   que con los nudos del forjado en su cara superior es el canto entero (RV-b, 2026-10-20);
 * - D4: axil de todos los pilares ×2 y torsión de las vigas de hormigón ×0,1.
 * Y cómo se cambian: un factor dado, modificadores por material que completan a los de todos, `{}`
 * que los quita, y las hipótesis que lo dejan escrito para la memoria.
 */
import { describe, expect, it } from "vitest";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import { FACTOR_ZONA_RIGIDA, MODIFICADORES_D4, type ModeloFisico, type OpcionesCompilacion } from "./fisico.ts";

/** Pórtico de hormigón (pilares 40×40 y viga 30×50) con un pilar y una viga de acero al lado. */
const FISICO: ModeloFisico = {
  plantas: [
    { id: "P1", altura: null },
    { id: "C", altura: 3, tipo: "sotano" },
  ],
  materiales: [
    { id: "HA", tipo: "hormigon", fck: 25 },
    { id: "S", tipo: "acero" },
  ],
  secciones: [
    { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
    { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    { id: "heb", material: "S", forma: "I", perfil: { A: 91, Iy: 8090, Iz: 2840, It: 62.4, h: 200, b: 200, tf: 15, tw: 9 } },
  ],
  pilares: [
    { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
    { id: "B", x: 6, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
    { id: "S1", x: 6, y: 5, desde: "C", hasta: "P1", seccion: "heb" },
  ],
  vigas: [
    { id: "V", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" },
    { id: "VS", planta: "P1", puntos: [[6, 0], [6, 5]], seccion: "heb" },
  ],
  casos: [{ id: "G", pesoPropio: true }],
};

function compilado(o?: OpcionesCompilacion) {
  const r = compilar(FISICO, o);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r;
}
const barra = (r: Extract<ResultadoCompilacion, { valido: true }>, id: string) => r.modelo.barras!.find((b) => b.id === id)!;
/** Offsets redondeados a 1e-12 m (el extremo j sale de restar en coma flotante). */
const offsets = (r: Extract<ResultadoCompilacion, { valido: true }>, id: string) => {
  const o = barra(r, id).offsets ?? {};
  const red = (v?: readonly number[]) => v?.map((x) => Math.round(x * 1e12) / 1e12 + 0);
  return { i: red(o.i), j: red(o.j) };
};

describe("valores por defecto del compilador (C1-a y D4)", () => {
  it("por defecto, las vigas con la mitad de lo que recorren dentro del pilar y los pilares hasta la cara del nudo", () => {
    expect(FACTOR_ZONA_RIGIDA).toBe(0.5);
    const r = compilado();
    const r1 = compilado({ factorZonaRigida: 1 });
    // viga entre pilares de 40×40: 0,10 m en vez de 0,20 m en cada cara
    expect(offsets(r, "V:1")).toEqual({ i: [0.1, 0, 0], j: [-0.1, 0, 0] });
    expect(offsets(r1, "V:1")).toEqual({ i: [0.2, 0, 0], j: [-0.2, 0, 0] });
    // ZR1 y RV-b: la cabeza del pilar, hasta la cara inferior de la viga de 0,50, que cuelga entera del
    // nudo en la cara superior del forjado, con los dos factores: el de las vigas no la cambia, y nunca
    // entra en el pilar libre; con el nudo en el plano medio, su medio canto
    expect(offsets(r, "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r1, "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(compilado({ planoForjado: "medio" }), "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    // el factor de los pilares es aparte; y «de eje a eje» (factor 0) lo es también en los pilares
    expect(offsets(compilado({ factorZonaRigidaPilares: 0.5 }), "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    expect(offsets(compilado({ factorZonaRigida: 0 }), "A:P1")).toEqual({ i: undefined, j: undefined });
    expect(offsets(compilado({ factorZonaRigida: 0, factorZonaRigidaPilares: 1 }), "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(compilar(FISICO, { factorZonaRigidaPilares: 1.2 }).valido).toBe(false);
  });

  it("D4 por defecto: axil ×2 en todos los pilares y torsión ×0,1 sólo en las vigas de hormigón", () => {
    const r = compilado();
    expect(barra(r, "A:P1").modificadores).toEqual({ A: 2 });
    expect(barra(r, "S1:P1").modificadores).toEqual({ A: 2 });
    expect(barra(r, "V:1").modificadores).toEqual({ J: 0.1 });
    expect(barra(r, "VS:1").modificadores).toBeUndefined();
    expect(MODIFICADORES_D4).toEqual({ pilares: { todos: { A: 2 } }, vigas: { hormigon: { J: 0.1 } } });
  });

  it("los modificadores dados sustituyen a los de D4; los de un material completan a los de todos, y {} los quita", () => {
    const r = compilado({ modificadores: { vigas: { todos: { J: 0.5 }, hormigon: { J: 0.1, Iy: 0.8 } } } });
    expect(barra(r, "V:1").modificadores).toEqual({ J: 0.1, Iy: 0.8 });
    expect(barra(r, "VS:1").modificadores).toEqual({ J: 0.5 });
    expect(barra(r, "A:P1").modificadores).toBeUndefined();
    const sin = compilado({ modificadores: {} });
    expect(sin.modelo.barras!.every((b) => b.modificadores === undefined)).toBe(true);
  });

  it("las hipótesis lo dejan escrito para la memoria", () => {
    expect(compilado().hipotesis).toEqual([
      "Nudos de dimensión finita: las vigas son rígidas en el 50 % de lo que recorren dentro del pilar (hasta su cara); los pilares, en todo el canto de la losa o de la viga más alta que les llega, en la cabeza de cada tramo, con los nudos del forjado en su cara superior (RV-b): la base arranca en el nudo.",
      "Modificadores de rigidez (D4): tramos de pilar de hormigón: A ×2 (2); tramos de pilar de acero: A ×2 (1); tramos de viga de hormigón: J ×0,1 (1).",
      "Empotramiento parcial de los pilares (CY2: la rigidez es α·K_biempotrada + (1 − α)·K_articulada en ese extremo): cabeza 0,3 (3 tramos). Por defecto, 0,3 en la cabeza del último tramo, salvo en los pilares sobre los que arranca otro.",
      "Diafragma rígido en P1; sin diafragma en C.",
      "Eje de las vigas en el plano del forjado.",
    ]);
    expect(compilado({ factorZonaRigida: 1, modificadores: {} }).hipotesis.slice(0, 2)).toEqual([
      "Nudos de dimensión finita: las vigas son rígidas en todo lo que recorren dentro del pilar (hasta su cara); los pilares, en todo el canto de la losa o de la viga más alta que les llega, en la cabeza de cada tramo, con los nudos del forjado en su cara superior (RV-b): la base arranca en el nudo.",
      "Sin modificadores de rigidez.",
    ]);
    expect(compilado({ planoForjado: "medio" }).hipotesis[0]).toBe(
      "Nudos de dimensión finita: las vigas son rígidas en el 50 % de lo que recorren dentro del pilar (hasta su cara); los pilares, hasta la cara de la viga o la losa que les llega (el medio canto con el eje de la viga en el plano del forjado, el canto entero si cuelga de él), en la cabeza de cada tramo y, sobre un forjado, también en su base (LV-d).",
    );
    expect(compilado({ factorZonaRigidaPilares: 0.5 }).hipotesis[0]).toBe(
      "Nudos de dimensión finita: las vigas son rígidas en el 50 % de lo que recorren dentro del pilar (hasta su cara); los pilares, en el 50 % del canto de la losa o de la viga más alta que les llega, en la cabeza de cada tramo, con los nudos del forjado en su cara superior (RV-b): la base arranca en el nudo.",
    );
    // con el factor 0, ninguna barra lleva offset (los pilares tampoco): de eje a eje
    expect(compilado({ factorZonaRigida: 0 }).hipotesis[0]).toMatch(/^Nudos de eje a eje/);
    expect(compilado({ factorZonaRigidaPilares: 0.5, zonaRigidaBase: false, planoForjado: "medio" }).hipotesis[0]).toBe(
      "Nudos de dimensión finita: las vigas son rígidas en el 50 % de lo que recorren dentro del pilar (hasta su cara); los pilares, en el 50 % del nudo hacia la cara de la viga o la losa que les llega (el medio canto con el eje de la viga en el plano del forjado, el canto entero si cuelga de él), en la cabeza de cada tramo.",
    );
  });
});
