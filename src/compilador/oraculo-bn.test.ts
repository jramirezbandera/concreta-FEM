/**
 * Criterio 8 de BN1 (`docs/fem3d/barras.md`): oráculo externo. El pórtico de acero de dos plantas con
 * cruz, diagonal, puntal y barras giradas (`porticoAcero`), montado en PyNite 3.2.0 desde su modelo
 * físico (`validacion/bn/oraculo_pynite.py`, sin pasar por el compilador), frente a lo que da el
 * compilador con `cortante: false` (PyNite es Euler–Bernoulli), sin modificadores y con las cabezas
 * empotradas: desplazamientos, reacciones y axil de las barras a ≤ 1e-9 (dan ≤ 1e-11).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { porticoAcero } from "../pruebas/barras.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar } from "./compilar.ts";
import { EsfuerzosPiezas } from "./resultados.ts";

interface Oraculo {
  casos: Record<string, { nudos: { X: [number, number, number]; u: number[]; r: number[] }[]; axiles: Record<string, number> }>;
}
const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "pynite-bn.json"), "utf8")) as Oraculo;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 8 de BN1: el pórtico de acero frente a PyNite", () => {
  const f = porticoAcero();
  const r = compilar(f, { cortante: false, modificadores: {}, empotramientoCabeza: 1 });
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const casos = casosValidos(calcular(r.modelo, { solver: "perfil" }));
  const ep = new EsfuerzosPiezas(r.modelo, r.mapeo, casos);
  const clave = (x: number, y: number, z: number) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
  const nuestro = new Map(r.modelo.nudos.map((n, i) => [clave(n.x, n.y, n.z), i]));

  it("los mismos nudos", () => {
    const ref = oraculo.casos.G!.nudos;
    expect(ref.length).toBe(r.modelo.nudos.length);
    for (const n of ref) expect(nuestro.has(clave(...n.X)), clave(...n.X)).toBe(true);
  });

  f.casos.forEach((caso, k) => {
    it(`${caso.id}: desplazamientos, reacciones y axiles`, () => {
      const ref = oraculo.casos[caso.id]!;
      for (const [campo, de] of [["u", "u"], ["reacciones", "r"]] as const) {
        for (const g of [0, 3]) {
          let dif = 0;
          let esc = 0;
          for (const n of ref.nudos) {
            const i = nuestro.get(clave(...n.X))!;
            for (let c = g; c < g + 3; c++) {
              dif = Math.max(dif, Math.abs(casos[k]![campo][6 * i + c]! - n[de][c]!));
              esc = Math.max(esc, Math.abs(n[de][c]!));
            }
          }
          expect(dif / esc, `${campo} ${g ? "giros/momentos" : "traslaciones/fuerzas"}`).toBeLessThan(1e-9);
        }
      }
      const esc = Math.max(...Object.values(ref.axiles).map(Math.abs));
      for (const b of f.barras!) {
        const t = ep.tramos(b.id)[0]!;
        const N = ep.diagrama(t.barra, k).esfuerzosEn((t.s1 - t.s0) / 2, 1)[0]!;
        // PyNite = −CSI (H02)
        expect(Math.abs(N + ref.axiles[b.id]!) / esc, b.id).toBeLessThan(1e-9);
      }
    });
  });
});
