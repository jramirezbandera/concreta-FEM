/**
 * AC-d (decisión del usuario del 2026-11-07): un forjado reticular lleva siempre un ábaco macizo en
 * cada pilar, así que un pilar que llega a un reticular sin ábaco es un error
 * (`reticular/pilar-sin-abaco`), con la losa y los pilares. Antes se calculaba sin él.
 *
 * - Sin ábacos, el error nombra todos los pilares que llegan a la losa, y no se calcula.
 * - Con `abacosPilares`, o con los ábacos dados en cada pilar (también los de borde y esquina, que
 *   se salen de la losa), compila.
 * - Un pilar que no llega a la losa (en un hueco o fuera de ella) no lo necesita; una maciza tampoco.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { Losa, ModeloFisico, Vec2 } from "./fisico.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Dos recuadros de 5 × 6 m sobre seis pilares de 30 × 30, más los de `extra`. */
function modelo(losa: Partial<Losa>, extra: [number, number][] = []): ModeloFisico {
  const pilares = [
    ...[0, 5, 10].flatMap((x) => [0, 6].map((y): [number, number] => [x, y])),
    ...extra,
  ].map(([x, y], i) => ({ id: `P${i + 1}`, x, y, seccion: "P30", desde: "N0", hasta: "N1" }));
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares,
    losas: [{ id: "L", planta: "N1", contorno: rect(-0.15, -0.15, 10.15, 6.15), espesor: 0.3, material: "H", ...losa }],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

const ret = { intereje: 0.8, nervio: 0.12, capa: 0.05 };
const errores = (f: ModeloFisico) => compilar(f).diagnosticos.filter((d) => d.codigo === "reticular/pilar-sin-abaco");

describe("AC-d: un reticular lleva un ábaco en cada pilar", () => {
  it("sin ábacos es un error con la losa y todos sus pilares, y no compila", () => {
    const f = modelo({ reticular: ret });
    const r = compilar(f);
    expect(r.valido).toBe(false);
    const e = errores(f);
    expect(e).toHaveLength(1);
    expect(e[0]!.severidad).toBe("error");
    expect(e[0]!.ids).toEqual(["L", "P1", "P2", "P3", "P4", "P5", "P6"]);
  });

  it("con un pilar sin su ábaco, sólo ése", () => {
    const abacos = [0, 5, 10].flatMap((x) => [0, 6].map((y) => rect(x - 1, y - 1, x + 1, y + 1)));
    expect(compilar(modelo({ reticular: { ...ret, abacos } })).valido).toBe(true);
    expect(errores(modelo({ reticular: { ...ret, abacos: abacos.filter((_, i) => i !== 3) } }))[0]!.ids).toEqual(["L", "P4"]);
  });

  it("con abacosPilares compila, también con los pilares de borde y esquina", () => {
    expect(compilar(modelo({ reticular: { ...ret, abacosPilares: { lado: 2 } } })).valido).toBe(true);
  });

  it("un pilar en un hueco de la losa, o fuera de ella, no lo necesita; una maciza, tampoco", () => {
    const abacosPilares = { lado: 2 };
    expect(compilar(modelo({ huecos: [rect(2, 2, 3.5, 4)], reticular: { ...ret, abacosPilares } }, [[2.75, 3]])).valido).toBe(true);
    // El de fuera de la losa no arranca de nada que lo sujete arriba, así que se mira sólo que no lo pida
    expect(errores(modelo({ reticular: { ...ret, abacosPilares } }, [[12, 3]]))).toHaveLength(0);
    expect(compilar(modelo({})).valido).toBe(true);
  });
});
