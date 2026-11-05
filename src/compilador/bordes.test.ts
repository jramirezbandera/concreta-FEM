/**
 * MA4 (`docs/fem3d/modelado.md` §2.4 y §8): la carga de borde de losa (`tipo: "borde"`).
 *
 * - Criterio 4: los petos de la vivienda como cargas de borde dan los mismos desplazamientos que las
 *   cargas de viga a mano sobre sus zunchos (a 1e-12) y la malla no cambia.
 * - Sus tramos: el anillo entero cerrado, los huecos con `huecos`, un segmento de `excepto` y lo que
 *   toca otra losa (`junto`), con los puntos sólo donde empieza o acaba un tramo.
 * - El modelo analítico es, bit a bit, el de las mismas cargas lineales escritas a mano.
 * - Lo que no se puede resolver es un error que lo dice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { leerProyecto } from "../agente/proyecto.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { lineasBorde, resolverBordes, tramosBorde, type CargaBorde } from "./bordes.ts";
import { compilar } from "./compilar.ts";
import type { CargaFisica, ModeloFisico, Vec2 } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Una losa de 8 × 6 m con un hueco de 2 × 1 sobre un apoyo lineal en su contorno, y otra junto a ella en otra planta. */
function losa(cargas: CargaFisica[]): ModeloFisico {
  return {
    plantas: [
      { id: "N2", altura: null, tipo: "escalon", diafragma: "ninguno" },
      { id: "N1", altura: 0.9, diafragma: "ninguno" },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [],
    losas: [
      { id: "L", planta: "N1", contorno: rect(0, 0, 8, 6), huecos: [rect(3, 2, 5, 3)], espesor: 0.25, material: "H" },
      { id: "S", planta: "N2", contorno: rect(8, 1, 12, 5), espesor: 0.25, material: "H" },
    ],
    apoyosLineales: [
      { id: "AL", planta: "N1", puntos: [...rect(0, 0, 8, 6), [0, 0]], coartados: [true, true, true, false, false, false] },
      { id: "AS", planta: "N2", puntos: [...rect(8, 1, 12, 5), [8, 1]], coartados: [true, true, true, false, false, false] },
    ],
    casos: [{ id: "G", pesoPropio: true }],
    cargas,
  };
}

/**
 * La misma malla: los mismos nudos (ids y coordenadas a 1e-12 m: sembrar otra vez el borde cambia el
 * orden en que se crean los puntos del arreglo y con él un ulp, como «Renumerar», LV2 §17) y las mismas láminas.
 */
function mismaMalla(a: ModeloAnalitico, b: ModeloAnalitico): void {
  expect(b.nudos.map((n) => n.id)).toEqual(a.nudos.map((n) => n.id));
  for (let i = 0; i < a.nudos.length; i++) for (const k of ["x", "y", "z"] as const) expect(Math.abs(a.nudos[i]![k] - b.nudos[i]![k])).toBeLessThan(1e-12);
  expect(JSON.stringify((b.laminas ?? []).map((l) => l.nudos))).toBe(JSON.stringify((a.laminas ?? []).map((l) => l.nudos)));
}

const borde = (o: Partial<CargaBorde> = {}): CargaBorde => ({ tipo: "borde", id: "B", caso: "G", losa: "L", q: [0, 0, -3], ...o });

describe("MA4: la carga de borde de losa", () => {
  it("criterio 4: los petos de la vivienda como borde dan lo de las cargas en sus zunchos, con la misma malla", () => {
    const r = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
    if (!r.valido) throw new Error("la vivienda no es válida");
    const f = r.proyecto.modelo;
    const g: ModeloFisico = {
      ...f,
      cargas: [
        ...(f.cargas ?? []).filter((c) => !c.id.startsWith("PETO")),
        borde({ id: "PETO-CUB", losa: "L-CUB", excepto: [[[4.26, 1.87], [4.26, 15.67]]] }),
        borde({ id: "PETO-CUB-S", losa: "L-CUB-S" }),
      ],
    };
    const [a, b] = [valido(compilar(f)).modelo, valido(compilar(g)).modelo];
    mismaMalla(a, b);
    const [ca, cb] = [casosValidos(calcular(a)), casosValidos(calcular(b))];
    for (let k = 0; k < ca.length; k++) {
      const umax = ca[k]!.u.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      let d = 0;
      for (let i = 0; i < ca[k]!.u.length; i++) d = Math.max(d, Math.abs(ca[k]!.u[i]! - cb[k]!.u[i]!));
      expect(d / umax, ca[k]!.id).toBeLessThan(1e-12);
    }
  });

  it("sin excepciones, el contorno entero y cerrado; con huecos, también el del hueco", () => {
    const f = losa([]);
    expect(tramosBorde(f, borde())).toEqual([[...rect(0, 0, 8, 6), [0, 0]]]);
    expect(tramosBorde(f, borde({ huecos: true }))).toEqual([
      [...rect(0, 0, 8, 6), [0, 0]],
      [...rect(3, 2, 5, 3), [3, 2]],
    ]);
  });

  it("un segmento de excepto quita lo que va por él; junto a otra losa, lo que la toca en planta (aunque esté en otra planta)", () => {
    const f = losa([]);
    // Sin el lado de y = 0 entre x = 2 y x = 5: un tramo de 5 a 2 dando la vuelta
    expect(tramosBorde(f, borde({ excepto: [[[2, 0], [5, 0]]] }))).toEqual([
      [
        [5, 0],
        [8, 0],
        [8, 6],
        [0, 6],
        [0, 0],
        [2, 0],
      ],
    ]);
    // Junto a S (x = 8, y de 1 a 5): el lado de x = 8 pierde de 1 a 5
    expect(tramosBorde(f, borde({ excepto: [{ junto: "S" }] }))).toEqual([
      [
        [8, 5],
        [8, 6],
        [0, 6],
        [0, 0],
        [8, 0],
        [8, 1],
      ],
    ]);
    // Los dos: dos tramos, con sus ids
    expect(lineasBorde(f, borde({ excepto: [[[2, 0], [5, 0]], { junto: "S" }] }))!.map((c) => c.id)).toEqual(["B:1", "B:2"]);
  });

  it("el modelo analítico es, bit a bit, el de las mismas lineales escritas a mano; y la malla, la de sin la carga", () => {
    const c = borde({ huecos: true, excepto: [[[2, 0], [5, 0]], { junto: "S" }] });
    const a = valido(compilar(losa([c])));
    const b = valido(compilar(losa(lineasBorde(losa([]), c)!)));
    expect(JSON.stringify(a.modelo)).toBe(JSON.stringify(b.modelo));
    // Sin excepciones, el borde ya está en la malla: no siembra nada
    mismaMalla(valido(compilar(losa([]))).modelo, valido(compilar(losa([borde({ huecos: true })]))).modelo);
  });

  it("sin cargas de borde, el mismo objeto", () => {
    const f = losa([]);
    expect(resolverBordes(f).modelo).toBe(f);
  });

  it("lo que no se puede resolver es un error que lo dice", () => {
    const casos: [CargaBorde, string][] = [
      [borde({ losa: "X" }), "no hay ninguna losa «X»"],
      [borde({ excepto: [{ junto: "X" }] }), "no hay ninguna losa «X»"],
      [borde({ excepto: [[[0, 0]]] as never }), "excepto tiene que ser"],
      [borde({ excepto: [[[-1, -1], [9, -1]], { junto: "L" }] }), "junto a sí misma"],
      [borde({ excepto: [[[0, 0], [8, 0]], [[8, 0], [8, 6]], [[8, 6], [0, 6]], [[0, 6], [0, 0]]] }), "sin ningún tramo"],
    ];
    for (const [c, texto] of casos) {
      const r = compilar(losa([c]));
      expect(r.valido, texto).toBe(false);
      expect(r.diagnosticos.some((d) => d.severidad === "error" && d.ids?.includes("B") && d.mensaje.includes(texto)), texto).toBe(true);
    }
  });
});
