/**
 * SP-5 (`docs/fem3d/spr-abacos.md`): una puntual sólo horizontal que cae en una losa de una planta
 * con diafragma rígido va al nudo del diafragma más cercano con su momento de transporte, sin
 * sembrar su punto en la malla. Es exacto: ux, uy y rz de los nudos de la losa dependen del maestro.
 * - la malla no cambia con la carga;
 * - moverla por la losa con el torsor que compensa su resultante da los mismos desplazamientos;
 * - una carga con Fz, Mx o My, o en una planta sin diafragma, se siembra como antes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import type { CargaFisica, ModeloFisico } from "./fisico.ts";

/** La retícula enrasada de 2 plantas con diafragma rígido en N2 y sin él en N1, y un caso H. */
function base(cargas: CargaFisica[] = []): ModeloFisico {
  const f = reticulaEnrasada();
  return {
    ...f,
    plantas: f.plantas.map((p) => (p.id === "N2" ? { ...p, diafragma: "rigido" as const } : p.id === "N1" ? { ...p, diafragma: "ninguno" as const } : p)),
    casos: [...f.casos, { id: "H" }],
    cargas: [...(f.cargas ?? []), ...cargas],
  };
}

const puntual = (planta: string, x: number, y: number, F: [number, number, number], M?: [number, number, number]): CargaFisica => ({ tipo: "puntual", id: `H-${planta}`, caso: "H", planta, x, y, F, ...(M ? { M } : {}) });

function malla(f: ModeloFisico): { nudos: string; laminas: number } {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  return { nudos: c.modelo.nudos.map((n) => `${n.x},${n.y},${n.z}`).join(";"), laminas: c.modelo.laminas!.length };
}

describe("puntuales horizontales al diafragma (SP-5)", () => {
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  });

  it("en una planta con diafragma rígido, la malla no cambia con la carga", () => {
    const sin = malla(base());
    expect(malla(base([puntual("N2", 7.3, 2.6, [40, -25, 0], [0, 0, 12])]))).toEqual(sin);
  });

  it("con Fz, con Mx o en una planta sin diafragma, su punto se siembra como antes", () => {
    const sin = malla(base());
    expect(malla(base([puntual("N2", 7.3, 2.6, [40, 0, -1])])).nudos).not.toBe(sin.nudos);
    expect(malla(base([puntual("N2", 7.3, 2.6, [40, 0, 0], [5, 0, 0])])).nudos).not.toBe(sin.nudos);
    expect(malla(base([puntual("N1", 7.3, 2.6, [40, 0, 0])])).nudos).not.toBe(sin.nudos);
  });

  it("moverla por la losa con el torsor que compensa su resultante no cambia nada", () => {
    const F: [number, number, number] = [40, -25, 0];
    const [P, Q]: [number, number][] = [
      [7.3, 2.6],
      [16.1, 8.7],
    ];
    // Misma resultante: en Q, Mz = (P − Q) × F
    const Mz = (P[0] - Q[0]) * F[1] - (P[1] - Q[1]) * F[0];
    const resultados = [puntual("N2", P[0], P[1], F), puntual("N2", Q[0], Q[1], F, [0, 0, Mz])].map((c) => {
      const r = compilar(base([c]));
      if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
      const k = calcular(r.modelo);
      if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
      return k.casos.find((x) => x.id === "H")!;
    });
    const [a, b] = resultados as [(typeof resultados)[number], (typeof resultados)[number]];
    const maxU = Math.max(...Array.from(a.u, Math.abs));
    expect(maxU).toBeGreaterThan(0);
    expect(Math.max(...Array.from(a.u, (v, i) => Math.abs(v - b.u[i]!)))).toBeLessThan(1e-10 * maxU);
    const maxR = Math.max(...Array.from(a.reacciones, Math.abs));
    expect(Math.max(...Array.from(a.reacciones, (v, i) => Math.abs(v - b.reacciones[i]!)))).toBeLessThan(1e-10 * maxR);
  });

  it("en el eje de una viga del diafragma, también al diafragma: la viga no recibe un cortante lateral (A2-11)", () => {
    // (9, 5): a media luz de la viga interior X5-N2. Antes iba a la viga como carga de barra, y le dejaba
    // Vy y Mz que no existen (la del viento del programa en la viga central)
    const F: [number, number, number] = [0, 30, 0];
    const r = compilar(base([puntual("N2", 9, 5, F)]));
    if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
    const k = calcular(r.modelo);
    if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
    const iH = r.modelo.casos.findIndex((c) => c.id === "H");
    expect(r.modelo.casos[iH]!.barras ?? []).toEqual([]);
    const vigaX5 = (r.mapeo.piezas["X5-N2"] ?? []).map((b) => k.casos[iH]!.esfuerzosBarras.subarray(12 * b, 12 * b + 12));
    expect(vigaX5.length).toBeGreaterThan(0);
    for (const e of vigaX5) for (const q of [1, 5, 7, 11]) expect(Math.abs(e[q]!)).toBeLessThan(1e-9);
    // Y la misma carga en la losa, a 1 m, con su torsor de transporte, da lo mismo
    // Mz = (P − Q) × F con P = (9, 5) y Q = (9, 6): (0)·Fy − (−1)·Fx
    const otra = compilar(base([puntual("N2", 9, 6, F, [0, 0, 0 * F[1] + 1 * F[0]])]));
    if (!otra.valido) throw new Error("no compila");
    const ko = calcular(otra.modelo);
    if (!ko.valido) throw new Error("no calcula");
    const a = k.casos[iH]!.u;
    const b = ko.casos.find((x) => x.id === "H")!.u;
    const maxU = Math.max(...Array.from(a, Math.abs));
    expect(Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i]!)))).toBeLessThan(1e-10 * maxU);
  });
});
