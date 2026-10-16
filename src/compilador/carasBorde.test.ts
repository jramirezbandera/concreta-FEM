/**
 * Las caras de franja de los pilares de borde y junto a vigas paralelas (compilador F3.3,
 * `docs/fem3d/spr-abacos.md` §14), con la vivienda de Alhaurín: dos reticulares con zunchos por el eje
 * de los pilares de borde y sin vigas interiores. Con h = 0,75 esos pilares se quedaban sin estación
 * en la dirección del zuncho (no tenían cara de franja ni una recta de la malla por su huella desde la
 * que medirla), y la franja junto a ellos salía hasta un 73 % baja, con el aviso `franja/pilar-sin-cara`
 * y la causa equivocada; P3, además, perdía sus caras por la holgura de los zunchos cercanos.
 *
 * Con la unión de la losa con las vigas de antes (`unionLosaViga: "eje"`): con la de la fase LV, estos
 * pilares quedan dentro del ancho de su zuncho, sin metro, y la estación va en la cara del zuncho.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { leerProyecto } from "../agente/proyecto.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

const lectura = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
if (!lectura.valido) throw new Error("vivienda");
const fisico: ModeloFisico = lectura.proyecto.modelo;

function consultas(opciones: OpcionesCompilacion): Consultas {
  // Valores medidos con la cabeza de los pilares empotrada, antes de CY2: se comparan con ella (empotramientoCabeza: 1)
  const c = compilar(fisico, { empotramientoCabeza: 1, ...opciones });
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  return new Consultas(fisico, c, k.casos, opciones);
}

/** La mayor superior de ELU en las estaciones de cara del pilar en la franja (NaN si no tiene ninguna). */
function metro(q: Consultas, franja: string, pilar: string): number {
  const comb = q.combinaciones({ situaciones: ["ELU-PT"] });
  const e = q.franja(franja);
  const a = q.armadoFranja(franja, comb.valido ? comb.valor.map((c) => c.factores) : []);
  if (!e.valido || !a.valido) throw new Error(franja);
  const vs = e.valor.estaciones.flatMap((x, i) => (x.tipo === "cara" && x.piezas.includes(pilar) ? [a.valor[i]!.superior] : []));
  return vs.length ? Math.max(...vs) : NaN;
}

// Pilares de borde en la dirección de su zuncho, y P3 y P11 (los de los zunchos cercanos)
const CARAS: [string, string][] = [
  ["L-CUB:Y19", "P4"],
  ["L-CUB:Y19", "P12"],
  ["L-CUB:Y19", "P15"],
  ["L-CUB:Y19", "P19"],
  ["L-CUB:Y13", "P14"],
  ["L-CUB:Y13", "P18"],
  ["L-CUB:X21", "P2"],
  ["L-CUB-S:Y14", "P6"],
  ["L-CUB-S:Y14", "P9"],
  ["L-CUB:X21", "P3"],
  ["L-CUB:Y14", "P3"],
  ["L-CUB:X13", "P11"],
];

describe("caras de franja de los pilares de borde (F3.3)", () => {
  let gruesa: Consultas;
  let fina: Consultas;
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    gruesa = consultas({ unionLosaViga: "eje" });
    fina = consultas({ tamanoMalla: 0.375, unionLosaViga: "eje" });
  }, 120_000);

  it("con h = 0,75, ninguna franja se queda junto a un pilar sin estación en su cara", () => {
    for (const losa of ["L-CUB", "L-CUB-S"]) {
      const fs = gruesa.franjas(losa);
      if (!fs.valido) throw new Error(losa);
      for (const f of fs.valor) {
        const r = gruesa.franja(f.id);
        if (!r.valido) throw new Error(f.id);
        expect(r.diagnosticos.filter((d) => d.codigo === "franja/pilar-sin-cara").map((d) => d.mensaje), f.id).toEqual([]);
      }
    }
  });

  it("su metro con h = 0,75, a ≤ 10 % del de h = 0,375 (antes, del −30 al −73 %, o sin estación)", () => {
    for (const [franja, pilar] of CARAS) {
      const g = metro(gruesa, franja, pilar);
      const f = metro(fina, franja, pilar);
      // Un valor que dimensiona, no ruido (P14 en Y13 da 19,7 desde LV2-h: su |mxy| ya no es el de la capa límite a δ)
      expect(f, `${franja} ${pilar} (fina)`).toBeGreaterThan(15);
      expect(Math.abs(g - f) / f, `${franja} ${pilar}: ${g} frente a ${f}`).toBeLessThan(0.1);
    }
  });
});
