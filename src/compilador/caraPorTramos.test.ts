/**
 * La recta de una cara de franja sólo se siembra en sus tramos: se corta junto a los pilares ajenos y
 * las vigas casi paralelas (`carasFranjas`). Su estación se medía cortando la recta entera, de lado a
 * lado de la losa: fuera de los tramos atraviesa láminas, el corte no valía y todas las franjas que la
 * cruzan se quedaban sin estación de cara (`franja/cara-sin-corte`), también las del tramo. Ahora, si
 * la recta entera no sigue la malla, un corte por tramo (puerta de uso con la vivienda de Alhaurín,
 * `docs/fem3d/spr-abacos.md` §13). Con la recta entera, los mismos bits.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { conAcciones, losaPilaresMezclados } from "../../validacion/c5/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";

describe("la cara de franja cortada en tramos", () => {
  // Pilares de varios tamaños: la cara común de una fila pasa a menos de h de los de otra y se corta
  const fisico = conAcciones(losaPilaresMezclados());
  let q: Consultas;
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    const c = compilar(fisico, {});
    if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
    const k = calcular(c.modelo);
    if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
    q = new Consultas(fisico, c, k.casos, {});
  }, 60_000);

  it("ninguna franja se queda sin estación de cara, y todas sus caras valen", () => {
    const fs = q.franjas("L-N1");
    if (!fs.valido) throw new Error("L-N1");
    let caras = 0;
    for (const f of fs.valor) {
      const r = q.franja(f.id);
      if (!r.valido) throw new Error(f.id);
      expect(r.diagnosticos.filter((d) => d.codigo === "franja/cara-sin-corte").map((d) => d.mensaje), f.id).toEqual([]);
      for (const e of r.valor.estaciones.filter((x) => x.tipo === "cara")) {
        caras++;
        expect(e.valido, `${f.id} s = ${e.s}`).toBe(true);
        expect(e.anchoEnLosa).toBeGreaterThan(0);
      }
    }
    expect(caras).toBeGreaterThan(0);
  });
});
