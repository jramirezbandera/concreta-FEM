/**
 * Esquinas entrantes de la losa en las franjas (`docs/fem3d/spr-abacos.md` §12): junto a la esquina de
 * un hueco o a la cóncava del contorno el momento es singular, y las estaciones de las franjas que
 * pasan cerca dependen de la malla (con h = 0,75, del −40 % al +100 %) o no convergen. La franja lleva
 * el aviso `franja/esquina-entrante` con los tramos de estaciones de cada esquina; antes, nada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { Vec2 } from "./fisico.ts";
import { esquinasEntrantes } from "./franjas.ts";

const CUADRADO: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const EN_L: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 5],
  [5, 5],
  [5, 10],
  [0, 10],
];

describe("esquinasEntrantes", () => {
  it("las de un hueco son sus cuatro vértices, en cualquier orientación", () => {
    const h: Vec2[] = [
      [2, 2],
      [3, 2],
      [3, 3],
      [2, 3],
    ];
    for (const hueco of [h, [...h].reverse()]) {
      const r = esquinasEntrantes({ contorno: CUADRADO, huecos: [hueco] });
      expect(r.map((q) => q.p).sort()).toEqual([...h].sort());
      expect(r.every((q) => q.hueco)).toBe(true);
    }
  });

  it("la de una losa en L es su esquina cóncava, en cualquier orientación, y un vértice alineado no cuenta", () => {
    for (const contorno of [EN_L, [...EN_L].reverse(), [[0, 0], [5, 0], ...EN_L.slice(1)] as Vec2[]]) {
      expect(esquinasEntrantes({ contorno, huecos: [] })).toEqual([{ p: [5, 5], hueco: false }]);
    }
    expect(esquinasEntrantes({ contorno: CUADRADO, huecos: [] })).toEqual([]);
  });
});

describe("el aviso franja/esquina-entrante", () => {
  // 3 × 3 vanos de 6 × 5 m con el hueco de la escalera en [12,6; 17,4] × [10,4; 14,6]
  const fisico = conAcciones(edificioReticular(1, 3, 3));
  let q: Consultas;
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    const c = compilar(fisico, {});
    if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
    const k = calcular(c.modelo);
    if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
    q = new Consultas(fisico, c, k.casos, {});
  }, 60_000);
  const avisos = (id: string) => {
    const r = q.franja(id);
    if (!r.valido) throw new Error(id);
    return r.diagnosticos.filter((d) => d.codigo === "franja/esquina-entrante");
  };

  it("lo lleva la franja que pasa por la esquina, con el tramo de cada una, y no una lejana", () => {
    // L-N1:Y16 va de x = 12,27 a 13,09: pasa por las dos esquinas del hueco en x = 12,6
    const a = avisos("L-N1:Y16");
    expect(a.length).toBe(1);
    expect(a[0]!.mensaje).toContain("(12.60; 10.40)");
    expect(a[0]!.mensaje).toContain("(12.60; 14.60)");
    expect(a[0]!.mensaje).toContain("(de un hueco)");
    // La estación pegada a la esquina, que no converge (s = 10,5), está en su tramo
    expect(a[0]!.mensaje).toMatch(/de s = (9\.750|10\.000) a 1[01]\.\d{3} m, junto a \(12\.60; 10\.40\)/);
    expect(avisos("L-N1:Y1")).toEqual([]);
    expect(avisos("L-N1:X1")).toEqual([]);
  });

  it("sólo las franjas a menos de máx(h, b/2) de una esquina", () => {
    const fs = q.franjas("L-N1");
    if (!fs.valido) throw new Error("L-N1");
    const radio = 0.75;
    for (const f of fs.valor) {
      const lejos = [
        [12.6, 10.4],
        [17.4, 10.4],
        [12.6, 14.6],
        [17.4, 14.6],
      ].every(([x, y]) => {
        const t = f.direccion === 1 ? y! : x!;
        return t < f.t0 - radio || t > f.t1 + radio;
      });
      if (lejos) expect(avisos(f.id), f.id).toEqual([]);
    }
  });
});
