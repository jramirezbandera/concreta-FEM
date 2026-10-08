/**
 * C5.2: esfuerzos de las bandas (criterio 2, integración exacta) y Wood–Armer por combinación
 * (criterio 3), en la losa plana de 3 × 3 vanos de 6 × 5 m con las bandas propuestas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { woodArmer } from "../dimensionado/woodArmer.ts";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { proponerBandas } from "./bandas.ts";
import { compilar } from "./compilar.ts";
import { EsfuerzosBandas, woodArmerEstacion } from "./esfuerzosBandas.ts";
import type { ModeloFisico, Pilar, Vec2 } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const Q = 10;

/** Losa plana a ejes de 18 × 15 m sobre 16 pilares de 30 × 30; casos G (peso) y Q (10 kN/m²). */
function losaPlana(): ModeloFisico {
  const pilares: Pilar[] = [];
  for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares,
    losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 18, 15), espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -Q] }],
  };
}

let fisico: ModeloFisico;
let eb: EsfuerzosBandas;
let casos: ResultadoCaso[];
let cortes: Cortes;

beforeAll(() => {
  const f = losaPlana();
  fisico = { ...f, bandas: proponerBandas(f).bandas };
  const r = compilar(fisico, { tamanoMalla: 0.5 });
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  casos = casosValidos(calcular(r.modelo));
  eb = new EsfuerzosBandas(fisico, r.modelo, casos);
  cortes = new Cortes(r.modelo);
});

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

describe("estaciones de las bandas (C5.2)", () => {
  it("las caras de los pilares de la alineación y el centro de cada vano", () => {
    const e = eb.estaciones("L:1:P2")!;
    expect(e.map((x) => [x.tipo, Number(x.s.toFixed(9))])).toEqual([
      ["cara", 0.15],
      ["vano", 3],
      ["cara", 5.85],
      ["cara", 6.15],
      ["vano", 9],
      ["cara", 11.85],
      ["cara", 12.15],
      ["vano", 15],
      ["cara", 17.85],
    ]);
    expect(e.every((x) => x.valido)).toBe(true);
    expect(eb.estaciones("no-existe")).toBeNull();
  });
});

describe("integración exacta (C5, criterio 2)", () => {
  it("en una línea de caras, la suma de las bandas que la cruzan es el corte de toda la losa (≤ 1e-9)", () => {
    const ids = eb.bandas.filter((id) => id.startsWith("L:1:"));
    const enCara = (id: string) => eb.estaciones(id)!.find((x) => x.tipo === "cara" && Math.abs(x.s - 5.85) < 1e-9)!;
    const toda = cortes.cortar({ origen: [5.85, 7.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-7.5, 7.5], z: [0, 0] }, casos);
    expect(toda.valido).toBe(true);
    for (const k of [0, 1]) {
      // My y Vz de cada banda, llevados al origen del corte entero (el My no cambia: las fuerzas están en el plano)
      let My = 0;
      let Vz = 0;
      for (const id of ids) {
        const e = enCara(id);
        My += e.esfuerzos[6 * k + 4]!;
        Vz += e.esfuerzos[6 * k + 2]!;
      }
      expect(rel(My, toda.esfuerzos[6 * k + 4]!)).toBeLessThan(1e-9);
      expect(rel(Vz, toda.esfuerzos[6 * k + 2]!)).toBeLessThan(1e-9);
    }
  });

  it("el trozo de losa entre las caras de un vano está en equilibrio con su carga (≤ 1e-9)", () => {
    // Pórtico virtual entero (toda la losa) entre x = 6,15 y x = 11,85, caso Q
    const [a, b] = [6.15, 11.85];
    const corte = (x: number) => cortes.cortar({ origen: [x, 7.5, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-7.5, 7.5], z: [0, 0] }, casos);
    const [A, B] = [corte(a), corte(b)];
    const L = b - a;
    const carga = Q * 15 * L;
    const k = 1;
    const [VzA, VzB, MyA, MyB] = [A.esfuerzos[6 * k + 2]!, B.esfuerzos[6 * k + 2]!, A.esfuerzos[6 * k + 4]!, B.esfuerzos[6 * k + 4]!];
    // ΣFz = 0 y ΣMy = 0 del trozo (lo que el lado −x de A y el +x de B ejercen sobre él, y su carga)
    expect(Math.abs(VzB - VzA - carga) / carga).toBeLessThan(1e-9);
    expect(Math.abs(MyB - MyA - L * VzB + (carga * L) / 2) / ((carga * L) / 2)).toBeLessThan(1e-9);
  });
});

describe("Wood–Armer en las bandas (C5, criterio 3)", () => {
  it("por combinación, con los momentos medios, es woodArmer de su combinación de casos", () => {
    const e = eb.estaciones("L:1:P2")!.find((x) => x.tipo === "cara")!;
    const combinaciones = [Float64Array.from([1.35, 1.5]), Float64Array.from([1, 0])];
    const { porCombinacion, envolvente } = woodArmerEstacion(e, combinaciones);
    combinaciones.forEach((f, c) => {
      const m = [0, 1, 2].map((q) => f[0]! * e.medios[q]! + f[1]! * e.medios[3 + q]!);
      expect(porCombinacion[c]).toEqual(woodArmer(m[0]!, m[1]!, m[2]!));
    });
    // la envolvente no pierde el máximo y guarda la combinación (la ELU, aquí)
    expect(envolvente.valores.superiorX).toBe(Math.max(...porCombinacion.map((p) => p.superiorX)));
    expect(envolvente.combinacion.superiorX).toBe(0);
    // en la cara del pilar manda el negativo (cara superior) en la dirección de la banda
    expect(envolvente.valores.superiorX).toBeGreaterThan(0);
    expect(envolvente.valores.inferiorX).toBe(0);
  });

  it("mx medio es el My del corte entre el ancho, y las muestras punto a punto integran ese My exacto", () => {
    const e = eb.estaciones("L:1:P2")!.find((x) => x.tipo === "vano")!;
    expect(e.medios[3] * e.ancho).toBeCloseTo(e.esfuerzos[6 + 4]!, 9);
    const [a, b] = ["medios", "puntos"].map((m) => woodArmerEstacion(e, [Float64Array.from([0, 1])], m as "medios" | "puntos").porCombinacion[0]!);
    // en el vano, momento positivo: los dos métodos dan armadura inferior en x y se parecen
    expect(a!.inferiorX).toBeGreaterThan(0);
    expect(Math.abs(b!.inferiorX - a!.inferiorX) / a!.inferiorX).toBeLessThan(0.15);
  });
});
