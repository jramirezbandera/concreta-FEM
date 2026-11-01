/**
 * Fase BN (`docs/fem3d/barras.md`): las barras entre dos niveles.
 * - Oráculo a mano: pórtico de dos pilares de hormigón arriostrado con una diagonal de acero, con la
 *   zona rígida de CB-f en los dos extremos y una carga repartida en la barra, frente a su modelo
 *   analítico escrito a mano a ≤ 1e-10.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OPCIONES_MANO } from "../../validacion/c1/mano.ts";
import { compararModelos, uniformeANudo } from "../pruebas/compilador.ts";
import { carga, Constructor, EMPOTRADO } from "../pruebas/constructor.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { acero, circular, hormigon, rectangular } from "../secciones/seccion3D.ts";
import type { Vec3 } from "../motor/modelo.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type Valido = Extract<ResultadoCompilacion, { valido: true }>;
const valido = (r: ResultadoCompilacion): Valido => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
};

const PLANTAS: ModeloFisico["plantas"] = [
  { id: "P1", altura: null, diafragma: "ninguno" },
  { id: "C", altura: 3, diafragma: "ninguno" },
];
const MATERIALES: ModeloFisico["materiales"] = [
  { id: "HA", tipo: "hormigon", fck: 25 },
  { id: "S", tipo: "acero" },
];
const SECCIONES: ModeloFisico["secciones"] = [
  { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "d", material: "S", forma: "circular", D: 0.05 },
];
const OPCIONES: OpcionesCompilacion = { ...OPCIONES_MANO, empotramientoCabeza: 1 };

describe("BN: oráculo a mano, pórtico arriostrado", () => {
  // Pilares de 30 × 30 en (0, 0) y (4, 0), de C (cota 0) a P1 (cota 3); diagonal de acero de la base
  // del primero a la cabeza del segundo: 5 m, con la horizontal 4/5. Dentro de cada huella, 0,15 m en
  // planta: 0,1875 m de eje rígido en cada extremo (CB-f).
  const fisico: ModeloFisico = {
    plantas: PLANTAS,
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "B", x: 4, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    barras: [{ id: "D", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 4, y: 0 }, seccion: "d" }],
    casos: [{ id: "Q" }],
    cargas: [
      { tipo: "puntual", id: "H", caso: "Q", planta: "P1", x: 0, y: 0, F: [50, 0, 0] },
      { tipo: "barra", id: "q", caso: "Q", barra: "D", ejes: "global", q: [0, 0, -2] },
    ],
  };
  const r = valido(compilar(fisico, OPCIONES));

  it("el modelo analítico es el escrito a mano", () => {
    const HA = hormigon(25);
    const m = new Constructor();
    const n0 = m.nudo(0, 0, 0);
    const n1 = m.nudo(0, 0, 3);
    const n2 = m.nudo(4, 0, 0);
    const n3 = m.nudo(4, 0, 3);
    m.barra(n0, n1, rectangular(0.3, 0.3, HA), [1, 0, 0]);
    m.barra(n2, n3, rectangular(0.3, 0.3, HA), [1, 0, 0]);
    const e: Vec3 = [0.8, 0, 0.6];
    const z = 0.1875;
    const Ip: Vec3 = [e[0] * z, 0, e[2] * z];
    const Jp: Vec3 = [4 - e[0] * z, 0, 3 - e[2] * z];
    const d = m.barra(n0, n3, circular(0.05, acero(210000)), [0, 0, 1], { offsets: { i: Ip, j: [Jp[0] - 4, 0, Jp[2] - 3] } });
    m.apoyo(n0, EMPOTRADO);
    m.apoyo(n2, EMPOTRADO);
    const q: Vec3 = [0, 0, -2];
    m.caso("Q", [carga(n1, { fx: 50 }), uniformeANudo(n0, [0, 0, 0], [0, 0, 0], Ip, q), uniformeANudo(n3, [4, 0, 3], Jp, [4, 0, 3], q)], [], [{ tipo: "distribuida", barra: d, ejes: "global", qa: q }]);
    const c = compararModelos(r.modelo, m.modelo());
    expect(c.nBarras).toBe(3);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });

  it("el mapeo da la barra como pieza, con sus estaciones desde el inicio", () => {
    const i = r.mapeo.piezas.D!;
    expect(i).toHaveLength(1);
    const b = r.mapeo.barras[i[0]!]!;
    expect(b.tipo).toBe("barra");
    expect(b.s[0]).toBe(0);
    expect(b.s[1]).toBeCloseTo(0.1875, 14);
    expect(b.s[2]).toBeCloseTo(5 - 0.1875, 14);
    expect(b.s[3]).toBeCloseTo(5, 14);
  });

  it("la hipótesis nombra la barra y su zona rígida", () => {
    expect(r.hipotesis.some((h) => h.includes("Barras entre dos niveles (D)") && h.includes("CB-f): D"))).toBe(true);
  });
});
