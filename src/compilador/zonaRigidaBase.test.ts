/**
 * Zona rígida en la base de los tramos de pilar (LV-d, `docs/fem3d/fase-lv.md` §2.2; compilador LVD1):
 * - por defecto, la base de un tramo sobre un forjado es rígida como la cabeza del tramo de debajo
 *   (f · canto de lo que el nudo tiene encima); el arranque sin forjado debajo no cambia;
 * - la losa de la huella cuenta, y una viga con la cara superior en el forjado no cuenta en la base
 *   (queda entera por debajo del nudo) aunque sí en la cabeza;
 * - con `zonaRigidaBase: false`, el modelo de antes bit a bit (las referencias congeladas de C1–C5 y F
 *   lo llevan);
 * - un tramo que no cabe entre sus dos zonas rígidas es `pilar/tramo-flexible-nulo`;
 * - el tramo flexible más corto es más rígido: menos deriva y más cortante en el tramo corto, con el
 *   equilibrio a 1e-9; los esfuerzos de la base se dan en la cara del forjado (i'), como en la cabeza;
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
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Viga } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Pórtico de tres plantas (P0 → P3) con vigas de 30 × 50 en P1 y P2 y una losa de 0,30 en P3. */
function portico(extra: { alturaP2?: number; vigaP2?: Partial<Viga>; losaP3?: boolean } = {}): ModeloFisico {
  return {
    plantas: [
      { id: "P3", altura: null },
      { id: "P2", altura: 3 },
      { id: "P1", altura: extra.alturaP2 ?? 3 },
      { id: "P0", altura: 3.2 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "P0", hasta: "P3", seccion: "p" },
      { id: "B", x: 5, y: 0, desde: "P0", hasta: "P3", seccion: "p" },
    ],
    vigas: [
      { id: "V1", planta: "P1", puntos: [[0, 0], [5, 0]], seccion: "v" },
      { id: "V2", planta: "P2", puntos: [[0, 0], [5, 0]], seccion: "v", ...extra.vigaP2 },
      ...(extra.losaP3 ? [] : [{ id: "V3", planta: "P3", puntos: [[0, 0], [5, 0]], seccion: "v" } as Viga]),
    ],
    losas: extra.losaP3 ? [{ id: "L3", planta: "P3", material: "H", espesor: 0.3, contorno: [[-1, -1], [6, -1], [6, 1], [-1, 1]] }] : undefined,
    casos: [
      { id: "G", pesoPropio: true },
      { id: "W" },
    ],
    cargas: [
      { tipo: "viga", id: "q", caso: "G", viga: "V2", ejes: "global", q: [0, 0, -20] },
      { tipo: "puntual", id: "w", caso: "W", planta: "P3", x: 0, y: 0, F: [10, 0, 0] },
    ],
  };
}

const red = (v?: readonly number[]) => v?.map((x) => Math.round(x * 1e12) / 1e12 + 0);
const offsets = (r: Extract<ResultadoCompilacion, { valido: true }>, id: string) => {
  const o = r.modelo.barras!.find((b) => b.id === id)!.offsets ?? {};
  return { i: red(o.i), j: red(o.j) };
};
const barraP = (r: Extract<ResultadoCompilacion, { valido: true }>, id: string) => r.mapeo.barras[r.modelo.barras!.findIndex((b) => b.id === id)]!;

describe("zona rígida en la base de los tramos de pilar (LV-d)", () => {
  it("por defecto, la base de un tramo sobre un forjado es rígida como la cabeza del de debajo; el arranque no cambia", () => {
    const r = valido(compilar(portico()));
    // arranque en P0: sin forjado debajo; cabeza dentro de la viga de 0,50 de P1: 0,25
    expect(offsets(r, "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    // tramo P1 → P2: base sobre la viga de P1 (0,25) y cabeza en la de P2 (0,25)
    expect(offsets(r, "A:P2")).toEqual({ i: [0, 0, 0.25], j: [0, 0, -0.25] });
    expect(offsets(r, "A:P3")).toEqual({ i: [0, 0, 0.25], j: [0, 0, -0.25] });
    // las estaciones [i, i', j', j] del tramo, y los esfuerzos de la base en i'
    expect(barraP(r, "A:P2").s.map((s) => Math.round(s * 1e9) / 1e9)).toEqual([3.2, 3.45, 5.95, 6.2]);
    // con el factor 1, el canto entero en los dos extremos
    const r1 = valido(compilar(portico(), { factorZonaRigida: 1 }));
    expect(offsets(r1, "A:P2")).toEqual({ i: [0, 0, 0.5], j: [0, 0, -0.5] });
  });

  it("con zonaRigidaBase: false, sólo la cabeza, como antes de LV-d", () => {
    const r = valido(compilar(portico(), { zonaRigidaBase: false }));
    expect(offsets(r, "A:P2")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    expect(barraP(r, "A:P2").s.map((s) => Math.round(s * 1e9) / 1e9)).toEqual([3.2, 3.2, 5.95, 6.2]);
    expect(compilar(portico(), { zonaRigidaBase: "no" as unknown as boolean }).valido).toBe(false);
  });

  it("la losa de la huella cuenta en la base; una viga con la cara superior en el forjado, no (sí en la cabeza)", () => {
    const losa = valido(compilar(portico({ losaP3: true })));
    expect(offsets(losa, "A:P3")).toEqual({ i: [0, 0, 0.25], j: [0, 0, -0.15] });
    const sup = valido(compilar(portico({ vigaP2: { insercion: "superior" } })));
    // cabeza del tramo P1 → P2 dentro del canto de V2 (como en C1); base del P2 → P3, sin nada encima
    expect(offsets(sup, "A:P2")).toEqual({ i: [0, 0, 0.25], j: [0, 0, -0.25] });
    expect(offsets(sup, "A:P3")).toEqual({ i: undefined, j: [0, 0, -0.25] });
  });

  it("un tramo que no cabe entre sus dos zonas rígidas es pilar/tramo-flexible-nulo", () => {
    const r = compilar(portico({ alturaP2: 0.45 }));
    expect(r.valido).toBe(false);
    const d = r.diagnosticos.find((d) => d.codigo === "pilar/tramo-flexible-nulo")!;
    expect(d.mensaje).toContain("0.5 m en la cabeza y 0.5 m en la base");
    expect(d.ids).toEqual(expect.arrayContaining(["A", "V1", "V2"]));
    // sin la zona de la base cabe (0,45 − 0,25 = 0,20 m flexibles)
    expect(compilar(portico({ alturaP2: 0.45 }), { zonaRigidaBase: false }).valido).toBe(true);
  });

  it("el tramo flexible más corto es más rígido: menos deriva y más cortante en el tramo corto, con equilibrio", () => {
    const res = (op?: OpcionesCompilacion) => {
      const f = portico({ alturaP2: 0.9 });
      const r = valido(compilar(f, op));
      const casos = casosValidos(calcular(r.modelo));
      const c = new Consultas(f, r, casos, op ?? {});
      const tramos = c.pilar("A");
      if (!tramos.valido) throw new Error("sin pilar");
      const corto = tramos.valor.find((t) => t.planta === "P2")!;
      const W = 1;
      return {
        deriva: casos[W]!.u[6 * r.mapeo.nudosPilar["A@P3"]!]!,
        cortante: Math.abs(corto.base.esfuerzos[6 * W + 2]!),
        base: corto.base.s,
        equilibrio: Math.max(...casos.map((x) => x.equilibrio.fuerzas)),
      };
    };
    const lvd = res();
    const antes = res({ zonaRigidaBase: false });
    expect(lvd.equilibrio).toBeLessThan(1e-9);
    expect(lvd.deriva).toBeLessThan(antes.deriva);
    expect(lvd.deriva).toBeGreaterThan(0.8 * antes.deriva);
    expect(lvd.cortante).toBeGreaterThan(antes.cortante);
    // la base del tramo corto se da en la cara del forjado: 0,25 m por encima del nudo
    expect(lvd.base - antes.base).toBeCloseTo(0.25, 12);
  });

  it("la hipótesis lo deja escrito", () => {
    expect(valido(compilar(portico())).hipotesis[0]).toMatch(/también en su base, como CYPECAD; LV-d/);
    expect(valido(compilar(portico(), { zonaRigidaBase: false })).hipotesis[0]).toMatch(/sólo en la cabeza de cada tramo/);
  });
});
