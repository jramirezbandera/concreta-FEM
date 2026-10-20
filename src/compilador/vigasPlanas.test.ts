/**
 * Las vigas planas en un reticular (RV-a, `docs/fem3d/fase-lv.md` §2.4; compilador RV2):
 * - por defecto, los tramos de viga de hormigón rectangular con el canto del forjado y un reticular
 *   «uniforme» a sus lados llevan la flexión (Iy) ×0,6, encima de los modificadores (D4), y nada más
 *   cambia: con `rigidezVigasPlanas: 1`, el mismo modelo sin ese Iy;
 * - no se rebajan las descolgadas, las de una losa maciza, las del reticular «bruto» o con
 *   multiplicadores dados, los tramos sin losa ni los que tienen otra losa a un lado;
 * - el factor multiplica al Iy de los modificadores, tiene que estar en (0, 1] y la hipótesis lo dice.
 */
import { describe, expect, it } from "vitest";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { Losa, ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";

const R = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** El modelo A de CYPE (`validacion/sombra/minimo/modelos.py`): un recuadro de reticular 25+5 con vigas de borde. */
function modeloA(o: { canto?: number; losa?: Partial<Losa>; maciza?: boolean; vuelo?: boolean; vecina?: boolean } = {}): ModeloFisico {
  const reticular: Losa["reticular"] = { intereje: 0.82, nervio: 0.12, capa: 0.05, abacos: [R(-0.5, -0.5, 1.4, 1.3), R(4.6, -0.5, 6.5, 1.3), R(-0.5, 4.8, 1.4, 6.5), R(4.6, 4.8, 6.5, 6.5)] };
  return {
    plantas: [
      { id: "F1", altura: null },
      { id: "PB", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "H", forma: "rectangular", b: 0.3, h: o.canto ?? 0.3 },
    ],
    pilares: [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
      ...(o.vecina ? [[9, 0], [9, 6]] : []),
    ].map(([x, y], i) => ({ id: `P${i + 1}`, x: x!, y: y!, desde: "PB", hasta: "F1", seccion: "p" })),
    vigas: [
      { id: "V12", planta: "F1", puntos: [[0, 0], [o.vuelo ? 8 : 6, 0]], seccion: "v" },
      { id: "V34", planta: "F1", puntos: [[0, 6], [6, 6]], seccion: "v" },
      { id: "V13", planta: "F1", puntos: [[0, 0], [0, 6]], seccion: "v" },
      { id: "V24", planta: "F1", puntos: [[6, 0], [6, 6]], seccion: "v" },
    ],
    losas: [
      { id: "L1", planta: "F1", contorno: R(0, 0, 6, 6), espesor: 0.3, material: "H", ...(o.maciza ? {} : { pp: 4.335, reticular }), ...o.losa },
      ...(o.vecina ? [{ id: "L2", planta: "F1", contorno: R(6, 0, 9, 6), espesor: 0.3, material: "H" }] : []),
    ],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

/** Modificadores de cada barra de viga, por pieza: el conjunto de los distintos. */
function modificadores(m: ModeloFisico, op: OpcionesCompilacion = {}) {
  const r = valido(compilar(m, op));
  const por = new Map<string, Set<string>>();
  r.modelo.barras!.forEach((b, i) => {
    const pieza = r.mapeo.barras[i]!.pieza;
    if (!pieza.startsWith("V")) return;
    if (!por.has(pieza)) por.set(pieza, new Set());
    por.get(pieza)!.add(JSON.stringify(b.modificadores ?? {}));
  });
  return Object.fromEntries([...por].map(([k, v]) => [k, [...v].sort()]));
}

const D4 = JSON.stringify({ J: 0.1 });
const RVA = JSON.stringify({ J: 0.1, Iy: 0.6 });

describe("las vigas planas en un reticular (RV-a)", () => {
  it("por defecto, Iy ×0,6 en las vigas planas del reticular y nada más cambia", () => {
    expect(modificadores(modeloA())).toEqual({ V12: [RVA], V13: [RVA], V24: [RVA], V34: [RVA] });
    const a = valido(compilar(modeloA()));
    const b = valido(compilar(modeloA(), { rigidezVigasPlanas: 1 }));
    expect(modificadores(modeloA(), { rigidezVigasPlanas: 1 })).toEqual({ V12: [D4], V13: [D4], V24: [D4], V34: [D4] });
    // el mismo modelo analítico salvo ese Iy
    const sinIy = JSON.parse(JSON.stringify(a.modelo));
    for (const x of sinIy.barras) if (x.modificadores?.Iy === 0.6) delete x.modificadores.Iy;
    expect(sinIy).toEqual(JSON.parse(JSON.stringify(b.modelo)));
    expect(a.mapeo).toEqual(b.mapeo);
    // los pilares no se tocan
    expect(a.modelo.barras!.filter((x) => x.id.startsWith("P")).every((x) => x.modificadores?.Iy === undefined)).toBe(true);
  });

  it("no rebaja las descolgadas, las de una maciza ni las de un reticular bruto o con multiplicadores dados", () => {
    const todas = (x: string) => ({ V12: [x], V13: [x], V24: [x], V34: [x] });
    expect(modificadores(modeloA({ canto: 0.5 }))).toEqual(todas(D4));
    expect(modificadores(modeloA({ maciza: true }))).toEqual(todas(D4));
    expect(modificadores(modeloA(), { rigidezReticular: "bruta" })).toEqual(todas(D4));
    const m = modeloA();
    m.losas![0]!.reticular!.multiplicadores = { f11: 0.5, f22: 0.5, f12: 0.5, m11: 0.5, m22: 0.5, m12: 0.5, v13: 0.5, v23: 0.5 };
    expect(modificadores(m)).toEqual(todas(D4));
  });

  it("tramo a tramo: sin losa no, y con otra losa a un lado tampoco", () => {
    // V12 sigue en vuelo hasta x = 8: sus tramos fuera de la losa van sin rebaja
    expect(modificadores(modeloA({ vuelo: true })).V12).toEqual([D4, RVA].sort());
    // V24 entre el reticular y una maciza
    expect(modificadores(modeloA({ vecina: true }))).toEqual({ V12: [RVA], V13: [RVA], V24: [D4], V34: [RVA] });
  });

  it("multiplica al Iy de los modificadores, se valida y la hipótesis lo dice", () => {
    const op: OpcionesCompilacion = { modificadores: { vigas: { hormigon: { J: 0.1, Iy: 0.5 } } } };
    expect(modificadores(modeloA(), op).V12).toEqual([JSON.stringify({ J: 0.1, Iy: 0.3 })]);
    expect(modificadores(modeloA(), { ...op, rigidezVigasPlanas: 0.5 }).V12).toEqual([JSON.stringify({ J: 0.1, Iy: 0.25 })]);
    for (const x of [0, -0.1, 1.2, Number.NaN]) expect(compilar(modeloA(), { rigidezVigasPlanas: x }).valido).toBe(false);
    const h = valido(compilar(modeloA())).hipotesis.find((x) => x.startsWith("Vigas planas en un reticular (RV-a)"));
    expect(h).toMatch(/^Vigas planas en un reticular \(RV-a\): la flexión \(Iy\) ×0,6 en \d+ tramos de 4 vigas \(V12, V13, V24, V34\)/);
    expect(valido(compilar(modeloA({ maciza: true }))).hipotesis.some((x) => x.includes("RV-a"))).toBe(false);
  });
});
