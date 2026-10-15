/**
 * SP-3 y SP-4 (`docs/fem3d/spr-abacos.md` §9): el metro de los pilares sin cara de franja (los que
 * atraviesa una viga según la transversal, y los de borde) en cada una de sus caras, por la recta de
 * la cara si sigue la malla o por el escalón de F3 desde la línea de apoyo que atraviesa su huella.
 * Antes, la franja sólo tenía allí la estación de apoyo en el eje, sin lo que pasa por la huella, y
 * estaciones de paso por campos pegadas a la esquina: con h = 0,75, el máximo salía un 40 % bajo.
 *
 * SP-6 (§10): el corte por la recta de la cara no entraba nunca sin nudos de la huella delante (cortaba
 * con el enlace, que no la cruza), y los pilares de borde de una losa plana sin vigas, sin recta desde
 * la que hacer el escalón, se quedaban sin metro (sólo el aviso); en la de H25, las franjas de borde
 * salían un 37 % bajas.
 *
 * Todo con la unión de la losa con las vigas de antes (`unionLosaViga: "eje"`): con la de la fase LV, un
 * pilar dentro del ancho de una viga no tiene metro, y las estaciones de apoyo van en las caras de la
 * viga (`unionLosaViga.test.ts`). Los pilares de borde de la losa plana no tienen vigas y no cambian.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../../validacion/c2/losaPlana.ts";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

// 4 × 4 pilares de 40 × 40 con vigas por todos los ejes: ninguno tiene caras de franja
const fisico = conAcciones(edificioReticular(1, 3, 3));
const ELU = [1.35, 1.5, 0, 0];

function consultas(opciones: OpcionesCompilacion, f: ModeloFisico = fisico): Consultas {
  const c = compilar(f, opciones);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  return new Consultas(f, c, k.casos, opciones);
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
    gruesa = consultas({ unionLosaViga: "eje" });
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
    const fina = consultas({ tamanoMalla: 0.25, epsSnap: 0.01, unionLosaViga: "eje" });
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

describe("el corte directo por la cara de un pilar sin cara de franja (SP-6)", () => {
  // La losa plana de H25: 12 × 12 m, pilares de 0,6 × 0,6 en x, y = 0, 6 y 12 (los de borde, con el
  // centro en el borde), sin vigas: los de borde no tienen cara de franja ni recta para el escalón
  const h25 = { ...losaPlanaFisica(), bandas: undefined };
  const op = (o: OpcionesCompilacion): OpcionesCompilacion => ({ ...OPCIONES_LOSA_PLANA, ...o });
  /** mx (el único caso) y ancho de las estaciones de cara de P6-0 en la franja X1 (y de 0 a 1). */
  const metro = (q: Consultas) => {
    const e = q.franja("LOSA:X1");
    if (!e.valido) throw new Error("LOSA:X1");
    return { diag: e.diagnosticos, caras: e.valor.estaciones.filter((x) => x.tipo === "cara" && x.piezas.join() === "P6-0") };
  };

  it("los pilares de borde de una losa plana tienen su metro en cada cara, a ≤ 15 % de la malla fina", () => {
    const g = metro(consultas(op({ tamanoMalla: 0.75 }), h25));
    const f = metro(consultas(op({ tamanoMalla: 0.25, epsSnap: 0.01 }), h25));
    expect(g.diag.filter((d) => d.codigo === "franja/pilar-sin-cara")).toEqual([]);
    expect(g.caras.map((x) => [x.s, x.lado])).toEqual([
      [5.7, -1],
      [6.3, 1],
    ]);
    for (const x of g.caras) {
      // La ventana de 1 m centrada en el pilar, en la losa: de y = 0 a 0,5
      expect(x.anchoEnLosa).toBeCloseTo(0.5, 9);
      const y = f.caras.find((z) => Math.abs(z.s - x.s) < 1e-9)!;
      expect(x.medios[0]).toBeLessThan(0);
      expect(Math.abs(x.medios[0]! / y.medios[0]! - 1)).toBeLessThan(0.15);
    }
  }, 120_000);

  it("el ancho de un metro por la recta de la cara es el de su ventana en la losa, aunque la recta deje la malla en su extremo", () => {
    // P0-5, de borde (x = 0) y con la viga de fachada a lo largo: por y = 5,2 la recta sólo sigue la
    // malla delante de la huella; una lámina la cruza con el centroide fuera de la ventana, el corte no
    // la ve y el medio salía de 0,2 m en vez de 0,41 (el doble)
    const q = consultas({ unionLosaViga: "eje" }, conAcciones(edificioReticular(1, 2, 2)));
    const e = q.franja("L-N1:Y1");
    if (!e.valido) throw new Error("L-N1:Y1");
    const caras = e.valor.estaciones.filter((x) => x.tipo === "cara" && x.piezas.join() === "P0-5");
    expect(caras.length).toBe(2);
    for (const x of caras) {
      expect(x.ventana).toBeDefined();
      expect(x.anchoEnLosa).toBeCloseTo(Math.min(x.ventana![1], 12) - Math.max(x.ventana![0], 0), 9);
    }
  }, 60_000);
});
