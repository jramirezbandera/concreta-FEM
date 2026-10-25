/**
 * AU-4: el ancho de una viga de hormigón bajo un forjado pesa como hormigón. A la viga se le quita lo
 * que su ancho ya pesa como forjado ((b/2)·pp por lado, sin pasar de γ·(b/2)·min(h, t)), así que
 * añadir una viga plana de b × h y largo L a un forjado aumenta el peso propio en γ·b·h·L − b·Σ pp·ℓ:
 * en una maciza, su descuelgue; en un aligerado o un paño, también lo que el forjado no pesa en su
 * ancho. Antes, en un aligerado el ancho pesaba pp_forjado en vez de γ·t (−3,8 % del G de un
 * recuadro reticular de 6 × 6 con vigas planas).
 */
import { describe, expect, it } from "vitest";
import { pesoPropioCalculado, pesoPropioEsperado, Plantas } from "../agente/sensatez.ts";
import { resultanteAnalitica } from "./cargas.ts";
import { compilar } from "./compilar.ts";
import type { Losa, ModeloFisico, PanoUnidireccional, Vec2 } from "./fisico.ts";
import { volumenReticular } from "./reticular.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const GAMMA = 25;

/** Recuadro de 6 × 6 sobre cuatro pilares con sus vigas de borde y, si `plana`, una viga plana de 50 × 30 por y = 3. */
function recuadro(forjado: { losa?: Omit<Losa, "id" | "planta" | "contorno" | "material">; pano?: Omit<PanoUnidireccional, "id" | "planta" | "contorno" | "seccion"> }, plana: boolean): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "vp", material: "HA", forma: "rectangular", b: 0.5, h: 0.3 },
      { id: "T", material: "HA", forma: "T", bf: 0.75, hf: 0.05, bw: 0.12, h: 0.3 },
    ],
    pilares: (
      [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ] as const
    ).map(([x, y], i) => ({ id: `C${i}`, x, y, desde: "P0", hasta: "P1", seccion: "p" })),
    vigas: [
      { id: "VA", planta: "P1", puntos: [[0, 0], [0, 6]], seccion: "v" },
      { id: "VB", planta: "P1", puntos: [[6, 0], [6, 6]], seccion: "v" },
      { id: "VC", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" },
      { id: "VD", planta: "P1", puntos: [[0, 6], [6, 6]], seccion: "v" },
      ...(plana ? [{ id: "VP", planta: "P1", puntos: [[0, 3], [6, 3]] as Vec2[], seccion: "vp" }] : []),
    ],
    ...(forjado.losa ? { losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 6, 6), material: "HA", ...forjado.losa }] } : {}),
    ...(forjado.pano ? { panos: [{ id: "F", planta: "P1", contorno: rect(0, 0, 6, 6), seccion: "T", ...forjado.pano }] } : {}),
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  };
}

/** Peso propio total del modelo analítico compilado, kN. */
function pesoPropio(f: ModeloFisico): number {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("; "));
  return -resultanteAnalitica(c.modelo, 0, [0, 0, 0]).F[2];
}

const ret = { intereje: 0.8, nervio: 0.12, capa: 0.05 };
const ppAligerado = GAMMA * volumenReticular({ h: 0.3, hf: 0.05, bw: 0.12, s: 0.8 });

describe("AU-4: el peso del ancho de una viga plana en un forjado", () => {
  it.each([
    // [nombre, forjado, aumento esperado: γ·b·h·L − b·Σ pp·ℓ]
    ["maciza de 25 (su descuelgue)", { losa: { espesor: 0.25 } }, GAMMA * 0.5 * (0.3 - 0.25) * 6],
    ["maciza de 30 (nada)", { losa: { espesor: 0.3 } }, 0],
    ["reticular 25+5 con casetón perdido y pp 4,5", { losa: { espesor: 0.3, pp: 4.5, reticular: ret } }, GAMMA * 0.5 * 0.3 * 6 - 0.5 * 4.5 * 6],
    ["reticular 25+5 recuperable", { losa: { espesor: 0.3, reticular: { ...ret, caseton: "recuperable" as const } } }, GAMMA * 0.5 * 0.3 * 6 - 0.5 * ppAligerado * 6],
    ["reticular 25+5 recuperable con un ábaco que la viga cruza", { losa: { espesor: 0.3, reticular: { ...ret, caseton: "recuperable" as const, abacos: [rect(2, 2, 4, 4)] } } }, GAMMA * 0.5 * 0.3 * 6 - 0.5 * (ppAligerado * 4 + GAMMA * 0.3 * 2)],
    ["paño de viguetas de 30 con pp 3", { pano: { direccion: 90, intereje: 0.75, pp: 3 } }, GAMMA * 0.5 * 0.3 * 6 - 0.5 * 3 * 6],
  ] as const)("%s", (_n, forjado, aumento) => {
    const d = pesoPropio(recuadro(forjado, true)) - pesoPropio(recuadro(forjado, false));
    expect(Math.abs(d - aumento)).toBeLessThanOrEqual(1e-9 * 500);
  });

  it("el peso esperado de A3 sigue siendo el del cálculo", () => {
    for (const forjado of [{ losa: { espesor: 0.3, pp: 4.5, reticular: ret } }, { losa: { espesor: 0.3, reticular: { ...ret, caseton: "recuperable" as const, abacos: [rect(2, 2, 4, 4)] } } }, { pano: { direccion: 90, intereje: 0.75, pp: 3 } }]) {
      const f = recuadro(forjado, true);
      const calc = pesoPropioCalculado(f, undefined)!;
      for (const x of pesoPropioEsperado(f, new Plantas(f))) expect(Math.abs(calc.get(x.planta)! - x.esperado), x.planta).toBeLessThanOrEqual(1e-9 * Math.max(1, x.esperado));
    }
  });
});
