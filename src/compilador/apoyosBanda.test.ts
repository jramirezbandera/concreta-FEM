/**
 * V2b (decisión a, `docs/fem3d/visor.md` §7.4): los apoyos de una banda editada se recalculan con
 * `apoyosBanda`, que en una banda propuesta sin tocar da sus `apoyos` bit a bit; y el compilador
 * avisa de los apoyos que ya no casan con los pilares.
 */
import { describe, expect, it } from "vitest";
import { losaPlanaFisica } from "../../validacion/c2/losaPlana.ts";
import { edificioObjetivoLosas, reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { losaPilaresMezclados, reticularH25 } from "../../validacion/c5/modelos.ts";
import { edificioGeometria, FAMILIAS } from "../pruebas/geometrias.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { apoyosBanda, proponerBandas } from "./bandas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

const modelos: [string, () => ModeloFisico][] = [
  ["losa plana de H25", () => ({ ...losaPlanaFisica(), bandas: undefined })],
  ["reticular de H25 con ábacos", reticularH25],
  ["pilares mezclados con hueco", losaPilaresMezclados],
  ["edificio objetivo (2 plantas)", () => edificioObjetivoLosas(2)],
  ["retícula enrasada", () => ({ ...reticulaEnrasada(), bandas: undefined })],
  ["retícula con núcleo", () => ({ ...reticulaConNucleo(), bandas: undefined })],
  ...FAMILIAS.map((f) => [`geometría ${f}`, () => ({ ...edificioGeometria(f), bandas: undefined })] as [string, () => ModeloFisico]),
  ...[1, 2, 3, 4, 5, 6].map((s) => [`retícula al azar ${s}`, () => ({ ...reticulaAleatoria(s), bandas: undefined })] as [string, () => ModeloFisico]),
];

describe("apoyosBanda da los de la propuesta (V2b-a)", () => {
  for (const [nombre, crear] of modelos)
    it(nombre, () => {
      const f = crear();
      const { bandas } = proponerBandas(f);
      for (const b of bandas) expect([b.id, apoyosBanda(f, b)]).toEqual([b.id, b.apoyos]);
    });

  it("la misma banda dibujada al revés da los mismos tramos medidos desde el otro extremo", () => {
    const f = reticularH25();
    const { bandas } = proponerBandas(f);
    for (const b of bandas) {
      const L = Math.hypot(b.hasta[0] - b.desde[0], b.hasta[1] - b.desde[1]);
      const r = apoyosBanda(f, { ...b, desde: b.hasta, hasta: b.desde })!;
      const esperado = b.apoyos!.map(([a, c]) => [L - c, L - a]).sort((x, y) => x[0]! - y[0]!);
      expect(r.length).toBe(esperado.length);
      r.forEach(([a, c], i) => {
        expect(a).toBeCloseTo(esperado[i]![0]!, 8);
        expect(c).toBeCloseTo(esperado[i]![1]!, 8);
      });
    }
  });

  it("una banda movida a otra alineación toma los apoyos de ésa", () => {
    const f = { ...losaPlanaFisica(), bandas: undefined };
    const { bandas } = proponerBandas(f);
    const p2 = bandas.find((b) => b.tipo === "pilares" && b.id.endsWith(":1:P2"))!;
    const p3 = bandas.find((b) => b.id.endsWith(":1:P3"))!;
    const dy = p3.desde[1] - p2.desde[1];
    const movida = { ...p2, desde: [p2.desde[0], p2.desde[1] + dy] as const, hasta: [p2.hasta[0], p2.hasta[1] + dy] as const };
    expect(apoyosBanda(f, movida)).toEqual(p3.apoyos);
  });
});

describe("aviso de apoyos desfasados (V2b-a)", () => {
  it("sin aviso con la propuesta; con aviso si un pilar se mueve después", () => {
    const base = { ...losaPlanaFisica(), bandas: undefined };
    const f: ModeloFisico = { ...base, bandas: proponerBandas(base).bandas };
    const sin = compilar(f);
    expect(sin.diagnosticos.filter((d) => d.codigo === "banda/apoyos-desfasados")).toEqual([]);
    const p = f.pilares![5]!;
    const movido: ModeloFisico = { ...f, pilares: f.pilares!.map((q) => (q.id === p.id ? { ...q, x: q.x + 0.4 } : q)) };
    const con = compilar(movido);
    expect(con.diagnosticos.some((d) => d.codigo === "banda/apoyos-desfasados" && d.severidad === "aviso")).toBe(true);
  });
});
