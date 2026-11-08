/**
 * Fase PB (`docs/fem3d/pilares-borde.md`): la malla de LV2 en los pilares de borde, con la
 * configuración más corriente en obra: pilares en el eje de vigas de borde de su ancho y la losa hasta
 * la cara de fuera de la viga (`validacion/pb/modelos.ts`).
 * - Esquinas: el pilar de esquina deja, entre los dos anchos y el borde, un cuadrado de losa apartado
 *   del resto (una isla, rígida con el pilar). Sus vértices dejaban irregular la celda de la esquina
 *   del paño, al otro lado de los anchos, y ningún pilar de esquina llevaba su plantilla
 *   (`malla/esquina-sin-refinar`). Ahora sus rasgos no cuentan para las celdas de alrededor.
 * - Bordes: la plantilla de cara (§10 de `rejilla.ts`) sólo va donde la huella del pilar cruza la cara
 *   de la viga (un 40 bajo una de 30: `asoma.test.ts`, `pilarTapado.test.ts`). Con la huella enrasada
 *   (el 30 bajo una de 30) alejaba de la malla fina la viga y la franja, así que ni va ni se avisa
 *   (`malla/pilar-tapado-sin-refinar`).
 * La precisión, en `precision.test.ts` (los modelos `recuadros-borde`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { recuadros, type OpcionesRecuadros } from "../../validacion/pb/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const MALLA = ["malla/esquina-sin-refinar", "malla/pilar-tapado-sin-refinar", "malla/cara-sin-refinar", "malla/calidad", "malla/pilar-asoma-sin-plantilla"];
const avisosMalla = (f: ModeloFisico, op: OpcionesCompilacion = {}) => {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { c, avisos: c.diagnosticos.filter((d) => MALLA.includes(d.codigo)).map((d) => `${d.codigo} [${(d.ids ?? []).join(",")}]`) };
};

describe("pilares de borde en el eje de una viga de su ancho (PB)", () => {
  const VARIANTES: [string, OpcionesRecuadros, number?][] = [
    ["maciza de 30, vigas y pilares de 30", {}],
    ["reticular con ábacos", { reticular: true }],
    ["losa 20 cm más allá de la viga (tiras de borde)", { vuelo: 0.2 }],
    ["vigas de 50 y pilares de 30", { bViga: 0.5 }],
    ["pilares de 25 dentro de vigas de 30", { pilar: 0.25 }],
    ["vigas de borde de esquina a esquina", { continuas: true }],
    ["vigas en todos los ejes", { interiores: true }],
    ["3 × 2 vanos de 5 m", { luz: 5 }, 3],
  ];
  for (const [nombre, op, n] of VARIANTES)
    it(`${nombre}: sin avisos de la malla junto a los pilares`, () => {
      expect(avisosMalla(recuadros(n ?? 2, 2, op)).avisos).toEqual([]);
    });

  it("la isla de la esquina sigue en la malla, rígida con el pilar, y el cálculo cuadra", () => {
    const { c } = avisosMalla(recuadros(2, 2));
    const m = c.modelo;
    const enIsla = (m.laminas ?? []).filter((l) => {
      const P = l.nudos.map((i) => m.nudos[i]!);
      const [x, y] = [P.reduce((s, p) => s + p.x, 0) / 4, P.reduce((s, p) => s + p.y, 0) / 4];
      return x > -0.15 && x < 0 && y > -0.15 && y < 0;
    });
    expect(enIsla.length).toBeGreaterThan(0);
    expect(calcular(m).valido).toBe(true);
  });

  it("con `refinoEsquinas: false` (la malla de LV1) no hay plantillas que avisar", () => {
    expect(avisosMalla(recuadros(2, 2), { refinoEsquinas: false }).avisos).toEqual([]);
  });

  it("un hueco junto a un pilar interior no es una isla: compila, sin láminas en él", () => {
    const f = recuadros(2, 2);
    const hueco: [number, number][] = [
      [6.15, 6.15],
      [6.65, 6.15],
      [6.65, 6.65],
      [6.15, 6.65],
    ];
    (f.losas![0]! as { huecos?: [number, number][][] }).huecos = [hueco];
    const { c, avisos } = avisosMalla(f);
    expect(avisos.filter((a) => a.startsWith("malla/calidad"))).toEqual([]);
    const m = c.modelo;
    const dentro = (m.laminas ?? []).filter((l) => {
      const P = l.nudos.map((i) => m.nudos[i]!);
      const [x, y] = [P.reduce((s, p) => s + p.x, 0) / 4, P.reduce((s, p) => s + p.y, 0) / 4];
      return x > 6.15 && x < 6.65 && y > 6.15 && y < 6.65;
    });
    expect(dentro).toEqual([]);
  });
});
