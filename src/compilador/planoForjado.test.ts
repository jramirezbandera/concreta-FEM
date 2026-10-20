/**
 * Los nudos del forjado en su cara superior (RV-b, `docs/fem3d/fase-lv.md` §2.3; compilador RV1):
 * - por defecto, la cota de la planta es la cara superior del forjado: la cabeza de cada tramo de
 *   pilar es rígida en todo el canto de la losa de su huella o de la viga más alta que le llega, y la
 *   base arranca en el nudo (la `zonaRigidaBase` de LV-d no actúa); `factorZonaRigidaPilares` la escala;
 * - una viga con la cara superior en el forjado da la misma cabeza y sigue con el eje h/2 más abajo;
 * - entre dos forjados del mismo canto la altura libre es la del plano medio; bajo el primero, la
 *   altura menos el canto entero;
 * - con `planoForjado: "medio"`, el modelo de LVD1–ZR1 (las referencias congeladas de antes lo llevan);
 * - un tramo que no cabe bajo su cabeza es `pilar/tramo-flexible-nulo`, sin zona en la base;
 * - el brazo de la cabeza da el cociente entre el momento del pie y el de la cabeza de un pilar
 *   empotrado en el pie con la cabeza sin desplazarse y un giro θ en el nudo: con el empotramiento
 *   parcial α de la cabeza (CY2), el brazo e y el tramo flexible L, (α·(2 + 6e/L) + (1 − α)·3e/L) /
 *   (α·(4 + 6e/L)) (`fase-lv.md` §2.1), a 1e-9 con Euler–Bernoulli;
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

/** Pórtico de tres plantas (P0 → P3) con vigas de 30 × 50 en P1 y P2 y, en P3, otra viga o una losa de 0,30. */
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
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [{ tipo: "viga", id: "q", caso: "G", viga: "V2", ejes: "global", q: [0, 0, -20] }],
  };
}

type Valido = Extract<ResultadoCompilacion, { valido: true }>;
const red = (v?: readonly number[]) => v?.map((x) => Math.round(x * 1e12) / 1e12 + 0);
const offsets = (r: Valido, id: string) => {
  const o = r.modelo.barras!.find((b) => b.id === id)!.offsets ?? {};
  return { i: red(o.i), j: red(o.j) };
};
const estaciones = (r: Valido, id: string) => r.mapeo.barras[r.modelo.barras!.findIndex((b) => b.id === id)]!.s.map((s) => Math.round(s * 1e9) / 1e9);

describe("los nudos del forjado en su cara superior (RV-b)", () => {
  it("por defecto, la cabeza es rígida en todo el canto y la base arranca en el nudo", () => {
    const r = valido(compilar(portico()));
    expect(offsets(r, "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r, "A:P2")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r, "A:P3")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    // [i, i', j', j]: la base en el nudo y la cabeza en la cara inferior de V2
    expect(estaciones(r, "A:P2")).toEqual([3.2, 3.2, 5.7, 6.2]);
    // la losa de la huella cuenta entera; el factor de los pilares la escala
    expect(offsets(valido(compilar(portico({ losaP3: true }))), "A:P3")).toEqual({ i: undefined, j: [0, 0, -0.3] });
    expect(offsets(valido(compilar(portico(), { factorZonaRigidaPilares: 0.5 })), "A:P2")).toEqual({ i: undefined, j: [0, 0, -0.25] });
  });

  it("la zona rígida de la base (LV-d) no actúa: el nudo no ocupa nada por encima del plano", () => {
    const con = valido(compilar(portico()));
    const sin = valido(compilar(portico(), { zonaRigidaBase: false }));
    expect(JSON.stringify(sin.modelo)).toBe(JSON.stringify(con.modelo));
  });

  it("una viga con la cara superior en el forjado da la misma cabeza y sigue con el eje h/2 más abajo", () => {
    const r = valido(compilar(portico({ vigaP2: { insercion: "superior" } })));
    expect(offsets(r, "A:P2")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r, "A:P3")).toEqual({ i: undefined, j: [0, 0, -0.5] });
    expect(offsets(r, "V2:1").i![2]).toBeCloseTo(-0.25, 12);
  });

  it("con planoForjado: \"medio\", el modelo de antes: medio canto en la cabeza y en la base", () => {
    const r = valido(compilar(portico(), { planoForjado: "medio" }));
    expect(offsets(r, "A:P1")).toEqual({ i: undefined, j: [0, 0, -0.25] });
    expect(offsets(r, "A:P2")).toEqual({ i: [0, 0, 0.25], j: [0, 0, -0.25] });
    expect(estaciones(r, "A:P2")).toEqual([3.2, 3.45, 5.95, 6.2]);
    const malo = compilar(portico(), { planoForjado: "inferior" as unknown as "medio" });
    expect(malo.valido).toBe(false);
    expect(malo.diagnosticos.map((d) => d.codigo)).toEqual(["opciones/no-validas"]);
  });

  it("entre dos forjados del mismo canto, la misma altura libre que con el plano medio; bajo el primero, el canto entero menos", () => {
    const libre = (r: Valido, id: string) => {
      const s = estaciones(r, id);
      return Math.round((s[2]! - s[1]!) * 1e9) / 1e9;
    };
    const sup = valido(compilar(portico()));
    const med = valido(compilar(portico(), { planoForjado: "medio" }));
    expect(libre(sup, "A:P2")).toBe(2.5);
    expect(libre(med, "A:P2")).toBe(2.5);
    expect(libre(sup, "A:P1")).toBe(2.7);
    expect(libre(med, "A:P1")).toBe(2.95);
  });

  it("un tramo que no cabe bajo su cabeza es pilar/tramo-flexible-nulo, sin zona en la base", () => {
    const r = compilar(portico({ alturaP2: 0.45 }));
    expect(r.valido).toBe(false);
    const d = r.diagnosticos.find((d) => d.codigo === "pilar/tramo-flexible-nulo")!;
    expect(d.mensaje).toContain("(0.5 m en la cabeza)");
    // con 0,55 cabe (0,05 m flexibles), igual que con el plano medio (0,25 + 0,25)
    expect(compilar(portico({ alturaP2: 0.55 })).valido).toBe(true);
    expect(compilar(portico({ alturaP2: 0.55 }), { planoForjado: "medio" }).valido).toBe(true);
  });

  it("el brazo de la cabeza da el cociente pie/cabeza de un pilar con el nudo girado y sin desplazarse", () => {
    // Pilar A de 3 m sobre la cimentación; en P1, una viga de 30 × 50 hasta un apoyo en (4, 0), la
    // cabeza sin desplazarse (apoyo en sus traslaciones) y un momento en el nudo que lo gira en XZ
    const f: ModeloFisico = {
      plantas: [
        { id: "P1", altura: null, diafragma: "ninguno" },
        { id: "C", altura: 3, tipo: "sotano" },
      ],
      materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
      secciones: [
        { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
      ],
      pilares: [{ id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p" }],
      vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [4, 0]], seccion: "v" }],
      apoyos: [
        { id: "R0", planta: "P1", x: 0, y: 0, coartados: [true, true, true, false, false, false] },
        { id: "R4", planta: "P1", x: 4, y: 0, coartados: [true, true, true, false, false, false] },
      ],
      casos: [{ id: "M" }],
      cargas: [{ tipo: "puntual", id: "m", caso: "M", planta: "P1", x: 0, y: 0, M: [0, 10, 0] }],
    };
    const cociente = (op: OpcionesCompilacion) => {
      const opciones = { cortante: false, ...op };
      const r = valido(compilar(f, opciones));
      const casos = casosValidos(calcular(r.modelo));
      expect(casos[0]!.equilibrio.fuerzas).toBeLessThan(1e-9);
      const t = new Consultas(f, r, casos, opciones).pilar("A");
      if (!t.valido) throw new Error("sin pilar");
      const [tramo] = t.valor;
      return { cociente: Math.abs(tramo!.base.esfuerzos[4]! / tramo!.cabeza.esfuerzos[4]!), L: tramo!.cabeza.s - tramo!.base.s };
    };
    const esperado = (a: number, e: number, L: number) => (a * (2 + (6 * e) / L) + (1 - a) * ((3 * e) / L)) / (a * (4 + (6 * e) / L));
    for (const a of [0.3, 1]) {
      // RV-b: el brazo es el canto entero de la viga, 0,50, y el tramo flexible, 2,50
      const sup = cociente({ empotramientoCabeza: a });
      expect(sup.L).toBeCloseTo(2.5, 12);
      expect(Math.abs(sup.cociente / esperado(a, 0.5, 2.5) - 1)).toBeLessThan(1e-9);
      // con el plano medio, medio canto: 0,25 y 2,75
      const med = cociente({ empotramientoCabeza: a, planoForjado: "medio" });
      expect(med.L).toBeCloseTo(2.75, 12);
      expect(Math.abs(med.cociente / esperado(a, 0.25, 2.75) - 1)).toBeLessThan(1e-9);
      // el pie toma más con el brazo largo (con 0,3: 0,88 frente a 0,70 del momento de la cabeza)
      expect(sup.cociente).toBeGreaterThan(med.cociente);
    }
  });

  it("la hipótesis lo deja escrito", () => {
    expect(valido(compilar(portico())).hipotesis[0]).toMatch(/con los nudos del forjado en su cara superior, como CYPECAD \(RV-b\): la base arranca en el nudo\.$/);
    expect(valido(compilar(portico(), { planoForjado: "medio" })).hipotesis[0]).toMatch(/también en su base, como CYPECAD \(LV-d\)\.$/);
  });
});
