/**
 * C5.3: machones y dinteles (criterio 4) en un muro de 6 m y una planta con una puerta de 2 m en el
 * centro, con una viga en su cabeza cargada en vertical (caso G) y en el plano del muro (caso H).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import { EsfuerzosMuros } from "./esfuerzosMuros.ts";
import type { ModeloFisico } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const [QV, QH] = [20, 10];

function muroConPuerta(): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [{ id: "v", material: "HA", forma: "rectangular", b: 0.25, h: 0.4 }],
    vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" }],
    muros: [{ id: "M", puntos: [[0, 0], [6, 0]], desde: "C", hasta: "P1", espesor: 0.25, material: "HA", huecos: [{ desde: 2, hasta: 4, z0: 0, z1: 2.2 }] }],
    casos: [{ id: "G" }, { id: "H" }],
    cargas: [
      { tipo: "viga", id: "g", caso: "G", viga: "V", ejes: "global", q: [0, 0, -QV] },
      { tipo: "viga", id: "h", caso: "H", viga: "V", ejes: "global", q: [QH, 0, 0] },
    ],
  };
}

let fisico: ModeloFisico;
let r: Extract<ResultadoCompilacion, { valido: true }>;
let casos: ResultadoCaso[];
let em: EsfuerzosMuros;

beforeAll(() => {
  fisico = muroConPuerta();
  const c = compilar(fisico, { tamanoMalla: 0.5 });
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  r = c;
  casos = casosValidos(calcular(r.modelo));
  em = new EsfuerzosMuros(fisico, r, casos);
});

const rel = (a: number, b: number, escala: number) => Math.abs(a - b) / escala;

describe("machones (C5, criterio 4)", () => {
  it("la puerta parte el muro en dos machones, de 0 a 2 y de 4 a 6", () => {
    const ms = em.machones("M")!;
    expect(ms.map((m) => [m.id, m.desde, m.hasta])).toEqual([
      ["M:P1:T1:M1", 0, 2],
      ["M:P1:T1:M2", 4, 6],
    ]);
    expect(ms.every((m) => m.base.valido && m.cabeza.valido)).toBe(true);
    expect(em.machones("no-existe")).toBeNull();
  });

  it("en la base, la suma de los machones es la estática de lo que está encima (≤ 1e-9)", () => {
    const ms = em.machones("M")!;
    for (const [k, N, Vy, Mz] of [
      [0, -QV * 6, 0, 0],
      [1, 0, QH * 6, QH * 6 * 3],
    ] as const) {
      // Llevados al centro del muro (x = 3): y de cada machón según el eje del muro
      let [n, vy, mz] = [0, 0, 0];
      for (const m of ms) {
        const e = m.base.esfuerzos;
        const y = m.base.origen[0] - 3;
        n += e[6 * k]!;
        vy += e[6 * k + 1]!;
        mz += e[6 * k + 5]! - y * e[6 * k]!;
      }
      const escala = QV * 6 + QH * 6 * 3;
      expect(rel(n, N, escala)).toBeLessThan(1e-9);
      expect(rel(vy, Vy, escala)).toBeLessThan(1e-9);
      expect(rel(mz, Mz, escala)).toBeLessThan(1e-9);
    }
  });

  it("la suma de los machones es el corte de todo el muro en esa cota (≤ 1e-9)", () => {
    const ms = em.machones("M")!;
    // En el arranque no hay nada debajo: el corte mira hacia abajo (su lado A es el muro), y con la
    // normal invertida y el mismo z, el convenio de pilar es [N, Vy, −Vz, …]
    const todo = new Cortes(r.modelo).cortar({ origen: [3, 0, ms[0]!.base.origen[2]], x: [0, 0, -1], vz: [0, 1, 0], y: [-2.999, 2.999], z: [0, 0] }, casos);
    for (let k = 0; k < 2; k++) {
      const s = [0, 1, 2].map((q) => ms.reduce((a, m) => a + m.base.esfuerzos[6 * k + q]!, 0));
      const t = [todo.esfuerzos[6 * k]!, todo.esfuerzos[6 * k + 1]!, -todo.esfuerzos[6 * k + 2]!];
      for (let q = 0; q < 3; q++) expect(Math.abs(s[q]! - t[q]!)).toBeLessThan(1e-9 * (QV * 6 + QH * 6));
    }
  });
});

describe("dinteles (C5, criterio 4)", () => {
  it("el dintel sobre la puerta va de 2 a 4 y de z = 2,2 a la cota; con la carga vertical, su cortante es antisimétrico", () => {
    const [d] = em.dinteles("M")!;
    expect(d).toMatchObject({ id: "M:H1", desde: 2, hasta: 4, planta: "P1" });
    expect(d!.z1 - d!.z0).toBeCloseTo(0.8, 9);
    const [Vi, Vf] = [d!.inicio.esfuerzos[2]!, d!.fin.esfuerzos[2]!];
    expect(Number.isFinite(Vi) && Math.abs(Vi) > 1e-3).toBe(true);
    expect(Math.abs(Vi + Vf) / Math.abs(Vi)).toBeLessThan(1e-6);
    // y el momento de su plano, simétrico
    expect(Math.abs(d!.inicio.esfuerzos[4]! - d!.fin.esfuerzos[4]!) / Math.abs(d!.inicio.esfuerzos[4]!)).toBeLessThan(1e-6);
  });
});

describe("dinteles: el nudo de la cota, a medias (A2-48)", () => {
  /** Muro de 6 m y una planta con un hueco, sin vigas ni diafragma, y una carga lineal vertical por su eje. */
  const muro = (hueco: { desde: number; hasta: number; z0: number; z1: number }, diafragma = false): ModeloFisico => ({
    plantas: [
      { id: "P1", altura: null, ...(diafragma ? {} : { diafragma: "ninguno" as const }) },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [],
    muros: [{ id: "M", puntos: [[0, 0], [6, 0]], desde: "C", hasta: "P1", espesor: 0.25, material: "HA", huecos: [hueco] }],
    casos: [{ id: "G" }],
    cargas: [{ tipo: "lineal", id: "g", caso: "G", planta: "P1", puntos: [[0, 0], [6, 0]], q: [0, 0, -QV] }],
  });
  const dintel = (f: ModeloFisico, h: number) => {
    const c = compilar(f, { tamanoMalla: h });
    if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
    return new EsfuerzosMuros(f, c, casosValidos(calcular(c.modelo))).dinteles("M")![0]!;
  };

  it("con la carga simétrica, el cortante en las caras es la estática, q·luz/2, con cualquier malla, y 0 en el centro", () => {
    // Antes, q·(luz − ancho de la columna de la cara)/2: −25 % con la malla de obra en una puerta de 2 m, −50 % en una de 1 m
    for (const [hueco, luz] of [
      [{ desde: 2, hasta: 4, z0: 0, z1: 2.2 }, 2],
      [{ desde: 2, hasta: 4, z0: 1, z1: 2 }, 2],
      [{ desde: 2.5, hasta: 3.5, z0: 0, z1: 2.2 }, 1],
    ] as const)
      for (const h of [0.25, 0.125]) {
        const d = dintel(muro(hueco), h);
        const V = (QV * luz) / 2;
        expect(Math.abs(d.fin.esfuerzos[2]! - V) / V, `luz ${luz}, h ${h}`).toBeLessThan(1e-9);
        expect(Math.abs(d.inicio.esfuerzos[2]! + V) / V, `luz ${luz}, h ${h}`).toBeLessThan(1e-9);
        expect(Math.abs(d.centro.esfuerzos[2]!) / V, `luz ${luz}, h ${h}`).toBeLessThan(1e-9);
        expect(d.fin.medioNudo?.laminas.length).toBeGreaterThan(0);
      }
  });

  it("con diafragma rígido, el mismo cortante; N y los momentos no cambian con el reparto (es sólo Vz)", () => {
    const d = dintel(muro({ desde: 2, hasta: 4, z0: 0, z1: 2.2 }, true), 0.25);
    expect(Math.abs(d.fin.esfuerzos[2]! - QV) / QV).toBeLessThan(1e-9);
    const c = compilar(muro({ desde: 2, hasta: 4, z0: 0, z1: 2.2 }, true), { tamanoMalla: 0.25 });
    if (!c.valido) throw new Error("no compila");
    const cortes = new Cortes(c.modelo);
    const casosD = casosValidos(calcular(c.modelo));
    const r = cortes.cortar(d.fin.corte, casosD);
    for (const q of [0, 1, 3, 4, 5]) expect(d.fin.esfuerzos[q]).toBe(r.esfuerzos[q]);
  });
});
