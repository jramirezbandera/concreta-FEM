/**
 * MA2 (`docs/fem3d/modelado.md` §2.2 y §8): los ábacos en los pilares (`reticular.abacosPilares`) y la
 * unión de los que se solapan o quedan a menos de h/2.
 *
 * - Criterio 2: la vivienda con `{ lado: 2 }` en lugar de sus 21 ábacos a mano da los mismos ábacos
 *   (los tres pares unidos incluidos) y el mismo modelo analítico, bit a bit.
 * - Dos ábacos dados que se solapan se unen en su envolvente, con el aviso, y el modelo es el de la
 *   envolvente dada a mano; el resultado no depende del orden.
 * - Un pilar con el eje en un ábaco dado no lleva otro; los ábacos siguen al pilar.
 * - La sensatez de A3 pesa los mismos ábacos que el compilador.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Plantas, pesoPropioEsperado, pesoPropioCalculado } from "../agente/sensatez.ts";
import { leerProyecto } from "../agente/proyecto.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { abacosLosa, resolverAbacos } from "./abacos.ts";
import { compilar } from "./compilar.ts";
import type { Losa, ModeloFisico, Vec2 } from "./fisico.ts";
import { ordenarPoligonos } from "./validar.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Un reticular de 10 × 6 m sobre seis pilares de 30 × 30 a 0, 4 y 10 en x y 0 y 6 en y, más uno a (4,3; 1,9). */
function reticular(abacos: Partial<NonNullable<Losa["reticular"]>> = {}): ModeloFisico {
  const pilares = [
    [0, 0],
    [4, 0],
    [10, 0],
    [0, 6],
    [4, 6],
    [10, 6],
    [4.3, 1.9],
  ].map(([x, y], i) => ({ id: `P${i + 1}`, x: x!, y: y!, seccion: "P30", desde: "N0", hasta: "N1" }));
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares,
    losas: [{ id: "L", planta: "N1", contorno: rect(-0.15, -0.15, 10.15, 6.15), espesor: 0.3, material: "H", reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, ...abacos } }],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

const vivienda = (): ModeloFisico => {
  const r = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!r.valido) throw new Error("la vivienda no es válida");
  return r.proyecto.modelo;
};

describe("MA2: ábacos en los pilares y unidos", () => {
  it("criterio 2: la vivienda con { lado: 2 } da sus ábacos a mano y el mismo modelo analítico, bit a bit", () => {
    const f = vivienda();
    const g: ModeloFisico = { ...f, losas: f.losas!.map((l) => ({ ...l, reticular: { ...l.reticular!, abacos: undefined, abacosPilares: { lado: 2 } } })) };
    for (const l of g.losas!) delete (l.reticular as { abacos?: unknown }).abacos;
    const res = resolverAbacos(g);
    for (const l of f.losas!) expect(ordenarPoligonos(res.porLosa.get(l.id)!.abacos), l.id).toEqual(ordenarPoligonos(l.reticular!.abacos!));
    const a = valido(compilar(f));
    const b = valido(compilar(g));
    expect(JSON.stringify(b.modelo)).toBe(JSON.stringify(a.modelo));
    // Los tres pares de la cubierta baja que el agente unió a mano
    const unidos = b.diagnosticos.filter((d) => d.codigo === "reticular/abacos-unidos").map((d) => d.ids!.slice(1).sort().join("+"));
    expect(unidos.sort()).toEqual(["P1+P7", "P18+P22", "P19+P23"]);
  });

  it("los ábacos dados que se solapan se unen en su envolvente, con el aviso; el modelo es el de la envolvente dada", () => {
    // Los de los demás pilares (AC-d), lejos de los que se unen
    const otros = [rect(-1, -1, 1, 1), rect(9, -1, 11, 1), rect(-1, 5, 1, 7), rect(3, 5, 5, 7), rect(9, 5, 11, 7)];
    const a = compilar(reticular({ abacos: [rect(3, -1, 5, 1), rect(4.5, 0.5, 6, 2), ...otros] }));
    expect(a.valido).toBe(true);
    const aviso = a.diagnosticos.find((d) => d.codigo === "reticular/abacos-unidos")!;
    expect(aviso.severidad).toBe("aviso");
    expect(aviso.mensaje).toContain("3 × 3 m");
    const b = compilar(reticular({ abacos: [rect(3, -1, 6, 2), ...otros] }));
    expect(JSON.stringify(valido(a).modelo)).toBe(JSON.stringify(valido(b).modelo));
  });

  it("a menos de h/2 se unen; a h/2 o más, no (y con otro tamaño de malla, su mitad)", () => {
    const de = (gap: number, h?: number) => {
      const f = reticular({ abacos: [rect(3, -1, 5, 1), rect(5 + gap, -1, 7, 1)] });
      return abacosLosa(f, f.losas![0]!, h === undefined ? undefined : h / 2)!.abacos.length;
    };
    expect(de(0)).toBe(1);
    expect(de(0.374)).toBe(1);
    expect(de(0.376)).toBe(2);
    expect(de(0.24, 0.5)).toBe(1);
    expect(de(0.26, 0.5)).toBe(2);
  });

  it("en los pilares: uno por pilar que llega a la losa, centrado y según el eje1; los cercanos, unidos; no depende del orden", () => {
    const f = reticular({ abacosPilares: { lados: [2, 1.6] } });
    const r = abacosLosa(f, f.losas![0]!)!;
    expect(r.enPilares.map((x) => x.pilar)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    expect(r.enPilares[0]!.poligono).toEqual(rect(-1, -0.8, 1, 0.8));
    // P7 (4,3; 1,9): su ábaco (1,1…2,7 en y) queda a 0,3 m del de P2 (hasta 0,8): se unen; del de P5 (desde 5,2), lejos
    expect(r.unidos.map((u) => u.origen.sort().join("+"))).toEqual(["P2+P7"]);
    expect(r.abacos).toHaveLength(6);
    expect(r.unidos[0]!.poligono).toEqual(rect(3, -0.8, 5.3, 2.7));
    // Girado el eje1, los ábacos van según él
    const g = { ...f, losas: [{ ...f.losas![0]!, eje1: 90 }] };
    expect(abacosLosa(g, g.losas[0]!)!.enPilares[0]!.poligono).toEqual([
      [0.8, -1],
      [0.8, 1],
      [-0.8, 1],
      [-0.8, -1],
    ]);
    // Las listas en otro orden dan los mismos ábacos
    const h = { ...f, pilares: [...f.pilares!].reverse() };
    expect(ordenarPoligonos(abacosLosa(h, h.losas![0]!)!.abacos)).toEqual(ordenarPoligonos(r.abacos));
    expect(compilar(f).valido).toBe(true);
  });

  it("un pilar con el eje en un ábaco dado no lleva otro; los demás siguen a su pilar", () => {
    const f = reticular({ abacos: [rect(-1.5, -1.5, 1.5, 1.5)], abacosPilares: { lado: 1 } });
    const r = abacosLosa(f, f.losas![0]!)!;
    expect(r.enPilares.map((x) => x.pilar)).not.toContain("P1");
    const g = { ...f, pilares: f.pilares!.map((p) => (p.id === "P3" ? { ...p, x: 9.5 } : p)) };
    expect(abacosLosa(g, g.losas![0]!)!.enPilares.find((x) => x.pilar === "P3")!.poligono).toEqual(rect(9, -0.5, 10, 0.5));
  });

  it("sin abacosPilares ni nada que unir, el mismo objeto (los proyectos de antes, bit a bit)", () => {
    const f = reticular({ abacos: [rect(3, -1, 5, 1)] });
    expect(resolverAbacos(f).modelo).toBe(f);
  });

  it("la sensatez de A3 pesa los mismos ábacos que el compilador", () => {
    const f = reticular({ abacosPilares: { lado: 2 } });
    const calc = pesoPropioCalculado(f, undefined)!;
    for (const x of pesoPropioEsperado(f, new Plantas(f))) expect(Math.abs(calc.get(x.planta)! - x.esperado), x.planta).toBeLessThanOrEqual(1e-9 * Math.max(1, x.esperado));
  });

  it("abacosPilares mal formado es un error que lo nombra", () => {
    for (const a of [{ lado: -1 }, { lados: [2] }, { lado: 2, lados: [2, 2] }]) {
      const r = compilar(reticular({ abacosPilares: a as never }));
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.some((d) => d.severidad === "error" && d.mensaje.includes("abacosPilares"))).toBe(true);
    }
  });
});

describe("A2-32: el aviso de la unión dice cuánta losa maciza que no es de ningún ábaco", () => {
  const aviso = (abacos: Vec2[][]) => compilar(reticular({ abacos })).diagnosticos.find((d) => d.codigo === "reticular/abacos-unidos")!;

  it("dos en diagonal: la envolvente maciza más de la mitad de lo que une, y lo destaca", () => {
    // Dos de 2 × 2 solapados 0,5 × 0,5 en una esquina: unión 7,75 m², envolvente 3,5 × 3,5 = 12,25
    const a = aviso([rect(4.5, 0.5, 6.5, 2.5), rect(6, 2, 8, 4)]);
    expect(a.detalles!.areaEnvolvente).toBeCloseTo(12.25, 9);
    expect(a.detalles!.areaUnidos).toBeCloseTo(7.75, 9);
    expect(a.detalles!.macizadoDeMas).toBeCloseTo(4.5, 9);
    expect(a.mensaje).toContain("4,5 m² no son de ningún ábaco");
    expect(a.mensaje).toContain("maciza mucha losa aligerada");
  });

  it("dos alineados a 20 cm: casi nada de más, sin destacarlo", () => {
    const a = aviso([rect(5, 1, 7, 3), rect(7.2, 1, 9.2, 3)]);
    expect(a.detalles!.macizadoDeMas).toBeCloseTo(0.4, 9);
    expect(a.mensaje).toContain("0,4 m² no son de ningún ábaco");
    expect(a.mensaje).not.toContain("maciza mucha losa aligerada");
  });
});
