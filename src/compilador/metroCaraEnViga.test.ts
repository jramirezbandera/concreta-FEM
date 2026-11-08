/**
 * PB-11 (`docs/fem3d/pilares-borde.md` §12): el metro de la franja en la cara de un pilar de esquina cuya
 * cara en esa dirección va entera en el ancho de una viga. El 2 × 2 de PB (`validacion/pb/modelos.ts`)
 * con pilares de 30 × 50, el lado largo según X: en P2-2, la cara x = 11,75 queda dentro de la viga de
 * borde según X (y de 11,85 a 12,15) y sólo su esquina toca la losa. La franja X13 mide ahí su metro;
 * con h = 0,75 y 0,5 la recta de la cara no sigue la malla y va por el escalón desde la cara de la viga
 * según Y (x = 11,85). Lo que la losa de la tira entre las dos rectas da a la viga según X por su cara
 * (los nudos de y = 11,85, enlazados al eje de la viga junto a su zona rígida) es lo que llega al pilar,
 * y el escalón no lo contaba: el metro salía casi nulo (mx −0,57 y −0,12 frente a −6,1 con h = 0,125;
 * el Wood–Armer superior, un 52–55 % bajo), sin aviso. Ahora el escalón cuenta esos nudos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { recuadros } from "../../validacion/pb/modelos.ts";
import { woodArmer } from "../dimensionado/woodArmer.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { OpcionesCompilacion } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** mx y Wood–Armer superior del caso Q en la estación de cara de P2-2 (s = 11,75) de la franja X13. */
function metro(op: OpcionesCompilacion): { mx: number; sup: number; metodo: string } {
  const f = recuadros(2, 2, { pilar: [0.3, 0.5] });
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(f, c, k.casos, op);
  const r = q.franja("L-N1:X13");
  if (!r.valido) throw new Error("L-N1:X13");
  const e = r.valor.estaciones.find((x) => x.tipo === "cara" && x.piezas.includes("P2-2") && Math.abs(x.s - 11.75) < 1e-9);
  if (!e?.valido) throw new Error("sin estación de cara de P2-2");
  const iq = f.casos!.findIndex((x) => x.id === "Q");
  const [mx, my, mxy] = [e.medios[3 * iq]!, e.medios[3 * iq + 1]!, e.medios[3 * iq + 2]!];
  return { mx, sup: woodArmer(mx, my, mxy).superiorX, metodo: e.metodo };
}

describe("el metro de un pilar de esquina con la cara en el ancho de una viga (PB-11)", () => {
  it("con h = 0,75 y 0,5, mx a menos del 35 % y Wood–Armer superior a menos del 25 % de los de h = 0,125", () => {
    const fina = metro({ tamanoMalla: 0.125 });
    expect(fina.mx).toBeLessThan(-5);
    for (const h of [0.75, 0.5]) {
      const { mx, sup, metodo } = metro({ tamanoMalla: h });
      expect(metodo).toBe("fuerzas-nodales");
      expect(Math.abs(mx / fina.mx - 1)).toBeLessThan(0.35);
      expect(Math.abs(sup / fina.sup - 1)).toBeLessThan(0.25);
    }
  });
});
