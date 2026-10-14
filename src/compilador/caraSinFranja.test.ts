/**
 * SP-3 y SP-4 (`docs/fem3d/spr-abacos.md` §9): el metro de los pilares sin cara de franja (los que
 * atraviesa una viga según la transversal, y los de borde) en cada una de sus caras, por la recta de
 * la cara si sigue la malla o por el escalón de F3 desde la línea de apoyo que atraviesa su huella.
 * Antes, la franja sólo tenía allí la estación de apoyo en el eje, sin lo que pasa por la huella, y
 * estaciones de paso por campos pegadas a la esquina: con h = 0,75, el máximo salía un 40 % bajo.
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
import type { OpcionesCompilacion } from "./fisico.ts";

// 4 × 4 pilares de 40 × 40 con vigas por todos los ejes: ninguno tiene caras de franja
const fisico = conAcciones(edificioReticular(1, 3, 3));
const ELU = [1.35, 1.5, 0, 0];

function consultas(opciones: OpcionesCompilacion): Consultas {
  const c = compilar(fisico, opciones);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  return new Consultas(fisico, c, k.casos, opciones);
}

/** Las estaciones de cara del pilar en las franjas de la dirección 2 que lo tocan, con la superior de ELU. */
function carasDe(q: Consultas, pilar: string): { franja: string; s: number; lado: number; superior: number; entre: number }[] {
  const r: { franja: string; s: number; lado: number; superior: number; entre: number }[] = [];
  const fs = q.franjas("L-N1");
  if (!fs.valido) throw new Error("L-N1");
  for (const f of fs.valor) {
    if (f.direccion !== 2) continue;
    const e = q.franja(f.id);
    if (!e.valido) throw new Error(f.id);
    const ests = e.valor.estaciones;
    const caras = ests.filter((x) => x.tipo === "cara" && x.piezas.includes(pilar));
    if (!caras.length) continue;
    const a = q.armadoFranja(f.id, [ELU]);
    if (!a.valido) throw new Error(f.id);
    const [s0, s1] = [Math.min(...caras.map((x) => x.s)), Math.max(...caras.map((x) => x.s))];
    const entre = ests.filter((x) => x.s > s0 + 1e-6 && x.s < s1 - 1e-6).length;
    for (const x of caras) r.push({ franja: f.id, s: x.s, lado: x.lado, superior: a.valor[ests.indexOf(x)]!.superior, entre });
  }
  return r;
}

describe("el metro de los pilares sin cara de franja (SP-3, SP-4)", () => {
  let gruesa: Consultas;
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    gruesa = consultas({});
  }, 60_000);

  it("un pilar interior atravesado por vigas tiene su estación en cada cara, y nada entre ellas", () => {
    // P6-5, en (6; 5), con las caras en y = 4,8 y 5,2
    const c = carasDe(gruesa, "P6-5");
    expect(c.length).toBeGreaterThanOrEqual(2);
    for (const x of c) {
      expect([4.8, 5.2].some((s) => Math.abs(x.s - s) < 1e-9)).toBe(true);
      expect(x.lado).toBe(x.s < 5 ? -1 : 1);
      expect(x.entre).toBe(0);
    }
    expect(gruesa.franja(c[0]!.franja).diagnosticos.filter((d) => d.codigo === "franja/pilar-sin-cara")).toEqual([]);
  });

  it("con h = 0,75, la cara a ≤ 10 % de la malla fina (antes, un 40 % baja)", () => {
    const fina = consultas({ tamanoMalla: 0.25, epsSnap: 0.01 });
    for (const pilar of ["P6-5", "P12-10"]) {
      const g = carasDe(gruesa, pilar);
      const f = carasDe(fina, pilar);
      expect(g.length).toBeGreaterThanOrEqual(2);
      for (const x of g) {
        const y = f.find((z) => z.franja === x.franja && Math.abs(z.s - x.s) < 1e-9)!;
        expect(y).toBeDefined();
        expect(Math.abs(x.superior / y.superior - 1)).toBeLessThan(0.1);
      }
    }
  }, 120_000);
});
