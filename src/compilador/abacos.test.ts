/**
 * Ábacos de los reticulares y campos SPR (SP-1, SP-2; `docs/fem3d/spr-abacos.md`). Un ábaco es una
 * región SPR aparte (el momento tangente salta en su borde); el de un pilar de borde, de esquina o
 * que atraviesa una viga quedaba en unas pocas láminas sin nudos interiores, y el respaldo del SPR
 * ajustaba cada nudo con un bilineal de 4 o 5 muestras que extrapolaba hasta 30 veces su rango: en
 * el muestrario, +700 kN·m/m donde las láminas daban −40.
 * - SP-1: ningún nudo con una constante de Lebesgue mayor que LEBESGUE_MAXIMO, y en cada ábaco el
 *   mayor |M| de los nudos del SPR no pasa de 2,5 veces el mayor de sus láminas (antes, 19 y 33);
 * - SP-2: la plantilla de todo pilar que cae en un ábaco va refinada. Con la unión de la fase LV, las
 *   huellas de estos modelos (con vigas por todos los ejes) quedan tapadas por el ancho de sus vigas y
 *   no hay plantillas: SP-2 se prueba con la unión de antes (por el eje).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { CamposLaminas, LEBESGUE_MAXIMO } from "../motor/campos.ts";
import { calcular } from "../motor/calcular.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

type Compilado = Extract<ResultadoCompilacion, { valido: true }>;

const muestrario = (): ModeloFisico => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8")).modelo;

const MODELOS: Record<string, () => ModeloFisico> = {
  // 3 × 3 pilares con vigas por todos los ejes: ninguno tiene caras de franja
  "reticular 2 × 2": () => conAcciones(edificioReticular(1, 2, 2)),
  muestrario,
};

/**
 * Por ábaco (región SPR de láminas de ábaco), el mayor |M| del SPR en sus nudos (Mx, My, Mxy)
 * frente al mayor de sus láminas en el centroide, con los desplazamientos del caso: lo que se sale
 * el mapa del rango de la solución. El mayor de todos los ábacos.
 */
function excesoAbacos(c: Compilado, r: ResultadoCaso): number {
  const campos = new CamposLaminas(c.modelo);
  const ev = campos.evaluador(r.u);
  const porRegion = new Map<number, { laminas: number; nudos: number }>();
  (c.modelo.laminas ?? []).forEach((_, i) => {
    const g = campos.region(i);
    if (g < 0 || !c.mapeo.laminas?.[i]?.abaco) return;
    let x = porRegion.get(g);
    if (!x) porRegion.set(g, (x = { laminas: 0, nudos: 0 }));
    for (const q of [3, 4, 5]) x.laminas = Math.max(x.laminas, Math.abs(r.esfuerzosLaminas[8 * i + q]!));
    for (let a = 0; a < 4; a++) {
      const v = ev.plaza(campos.plazas[4 * i + a]!);
      for (const q of [3, 4, 5]) x.nudos = Math.max(x.nudos, Math.abs(v[q]!));
    }
  });
  return Math.max(...[...porRegion.values()].map((x) => x.nudos / x.laminas));
}

describe("ábacos y campos SPR (SP-1, SP-2)", () => {
  const hechos = new Map<string, { c: Compilado; casos: ResultadoCaso[] }>();
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    for (const [nombre, f] of Object.entries(MODELOS)) {
      const c = compilar(f());
      if (!c.valido) throw new Error(`${nombre}: ${c.diagnosticos[0]?.mensaje}`);
      const k = calcular(c.modelo);
      if (!k.valido) throw new Error(`${nombre}: ${k.diagnosticos[0]?.mensaje}`);
      hechos.set(nombre, { c, casos: k.casos });
    }
  }, 120_000);

  for (const nombre of Object.keys(MODELOS)) {
    it(`${nombre}: las plantillas de los pilares en un ábaco van refinadas (SP-2)`, () => {
      const e = compilar(MODELOS[nombre]!(), { unionLosaViga: "eje" });
      if (!e.valido) throw new Error(`${nombre}: ${e.diagnosticos[0]?.mensaje}`);
      const m = e.estadisticas.malla!;
      expect(m.plantillasRefinadas).toBeGreaterThan(0);
      expect(m.plantillasRefinadas).toBe(m.plantillas);
      expect(e.diagnosticos.filter((d) => d.codigo.startsWith("malla/"))).toEqual([]);
    });

    it(`${nombre}: ningún nudo amplifica sus muestras más de LEBESGUE_MAXIMO (SP-1)`, () => {
      const campos = new CamposLaminas(hechos.get(nombre)!.c.modelo);
      let max = 0;
      for (let p = 0; p < campos.nPlazas; p++) max = Math.max(max, campos.lebesgueEn(p));
      expect(max).toBeLessThanOrEqual(LEBESGUE_MAXIMO);
    });

    it(`${nombre}: en los ábacos, el SPR no se sale del rango de las láminas (SP-1)`, () => {
      const { c, casos } = hechos.get(nombre)!;
      const exceso = Math.max(...casos.filter((r) => r.id === "G" || r.id === "Q").map((r) => excesoAbacos(c, r)));
      // Con el respaldo de antes, 19 (reticular) y 33 (muestrario). Un nudo junto a la huella puede
      // pasar algo del mayor de los centroides, que quedan a 10–20 cm: el pico es real (1,9)
      expect(exceso).toBeLessThan(2.5);
    });
  }
});
