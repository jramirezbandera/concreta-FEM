/**
 * Empotramiento parcial de los pilares en el compilador (CY2, `docs/fem3d/hipotesis-cype.md`):
 * - por defecto, 0,3 en la cabeza del último tramo de cada pilar, como CYPECAD (CY-b), salvo en el
 *   pilar sobre el que arranca otro en su cabeza;
 * - el del pilar se multiplica por la opción; el de la base va en el primer tramo;
 * - con `empotramientoCabeza: 1` el modelo analítico no lleva ninguno (criterio 8, con
 *   `validacion/cy/opciones.ts` sobre las referencias congeladas);
 * - valores fuera de [0, 1], errores; y la hipótesis en el informe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion, Pilar } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** Pórtico de dos plantas: A sube de P0 a P2; B llega a P1 y sobre su cabeza arranca C hasta P2. */
function portico(extra: Partial<Record<"A" | "B" | "C", Partial<Pilar>>> = {}): ModeloFisico {
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "P0", hasta: "P2", seccion: "p", ...extra.A },
      { id: "B", x: 5, y: 0, desde: "P0", hasta: "P1", seccion: "p", ...extra.B },
      { id: "C", x: 5, y: 0, desde: "P1", hasta: "P2", seccion: "p", base: "ninguno", ...extra.C },
    ],
    vigas: [
      { id: "V1", planta: "P1", puntos: [[0, 0], [5, 0]], seccion: "v" },
      { id: "V2", planta: "P2", puntos: [[0, 0], [5, 0]], seccion: "v" },
    ],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [{ tipo: "viga", id: "q", caso: "G", viga: "V2", ejes: "global", q: [0, 0, -20] }],
  };
}

const empDe = (f: ModeloFisico, op?: OpcionesCompilacion) => {
  const r = valido(compilar(f, op));
  return Object.fromEntries(r.modelo.barras!.filter((b) => r.mapeo.barras[r.modelo.barras!.indexOf(b)]!.tipo === "pilar").map((b) => [b.id, b.empotramiento]));
};

describe("empotramiento parcial de los pilares (CY2)", () => {
  it("por defecto, 0,3 en la cabeza del último tramo; no en el pilar sobre el que arranca otro", () => {
    expect(empDe(portico())).toEqual({ "A:P1": undefined, "A:P2": { j: 0.3 }, "B:P1": undefined, "C:P2": { j: 0.3 } });
  });

  it("el del pilar se multiplica por la opción, y el de la base va en el primer tramo", () => {
    expect(empDe(portico({ A: { empotramiento: { cabeza: 0.5, base: 0.4 } } }))).toEqual({ "A:P1": { i: 0.4 }, "A:P2": { j: 0.15 }, "B:P1": undefined, "C:P2": { j: 0.3 } });
    expect(empDe(portico({ A: { empotramiento: { cabeza: 0.5 } } }), { empotramientoCabeza: 1 })).toEqual({ "A:P1": undefined, "A:P2": { j: 0.5 }, "B:P1": undefined, "C:P2": undefined });
  });

  it("con empotramientoCabeza: 1, ningún tramo lleva empotramiento parcial", () => {
    expect(Object.values(empDe(portico(), { empotramientoCabeza: 1 })).every((e) => e === undefined)).toBe(true);
  });

  it("el 0,3 de la cabeza baja el momento de la cabeza del pilar A y sube el de vano de la viga", () => {
    const res = (op?: OpcionesCompilacion) => {
      const r = valido(compilar(portico(), op));
      const [c] = casosValidos(calcular(r.modelo));
      const k = r.modelo.barras!.findIndex((b) => b.id === "A:P2");
      // esfuerzos en j' del tramo de cabeza: My
      return { cabeza: Math.abs(c!.esfuerzosBarras[12 * k + 6 + 4]!), equilibrio: c!.equilibrio };
    };
    const rigido = res({ empotramientoCabeza: 1 });
    const cype = res();
    expect(cype.cabeza).toBeLessThan(0.6 * rigido.cabeza);
    expect(cype.cabeza).toBeGreaterThan(0.1 * rigido.cabeza);
    expect(cype.equilibrio.fuerzas).toBeLessThan(1e-9);
  });

  it("valores fuera de [0, 1]: error del pilar o de las opciones", () => {
    const r1 = compilar(portico({ A: { empotramiento: { cabeza: 1.2 } } }));
    expect(r1.valido).toBe(false);
    expect(r1.diagnosticos.some((d) => d.ids?.includes("A") && /empotramiento/.test(d.mensaje))).toBe(true);
    const r2 = compilar(portico(), { empotramientoCabeza: -0.1 });
    expect(r2.valido).toBe(false);
    expect(r2.diagnosticos.some((d) => d.codigo === "opciones/no-validas")).toBe(true);
  });

  it("la hipótesis va en el informe", () => {
    const r = valido(compilar(portico()));
    expect(r.hipotesis.some((h) => /Empotramiento parcial de los pilares.*cabeza 0,3 \(2 tramos\)/.test(h))).toBe(true);
    const r1 = valido(compilar(portico(), { empotramientoCabeza: 1 }));
    expect(r1.hipotesis.some((h) => /Pilares empotrados en sus dos extremos/.test(h))).toBe(true);
  });
});
