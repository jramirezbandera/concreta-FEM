/**
 * Criterio 1 de E1: restricciones (diafragma, enlace rígido y cadenas), muelles, apoyos y
 * desplazamientos impuestos frente a OpenSeesPy, con sus dos tratamientos de restricciones
 * (Transformation y Lagrange). Modelos en validacion/e1/modelos-oraculo.ts; oráculo en
 * validacion/e1/oraculo_opensees.py → __fixtures__/opensees-e1.json.
 *
 * Las cadenas sólo se comparan con Lagrange: el Transformation de OpenSees 3.8 da resultados
 * erróneos sin avisar cuando el maestro de una restricción es esclavo de otra (difiere hasta un
 * 250 % de su propio Lagrange; hallazgo E1-1 en docs/fem3d/fase-e1.md).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_ORACULO } from "../../validacion/e1/modelos-oraculo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../pruebas/comparar.ts";
import { calcular } from "./calcular.ts";

const oraculo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "opensees-e1.json"), "utf8")).modelos as Record<
  string,
  Record<string, Record<"Transformation" | "Lagrange", { u: number[]; reacciones: number[] }>>
>;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("E1 frente a la investigación (H07)", () => {
  it("diafragma de exp_diafragma.py: u_x de las esquinas = 1,71662 / 0,38806 mm (maestro-esclavo exacto sobre la K de PyNite)", () => {
    // Mismo modelo que diafragma-h07, pero con los datos de exp_diafragma.py (J = 0,0028)
    const E = 30e6;
    const sec = { E, G: E / 2.4, A: 0.15, Iy: (0.3 * 0.5 ** 3) / 12, Iz: (0.5 * 0.3 ** 3) / 12, J: 0.0028 };
    const m = MODELOS_ORACULO["diafragma-h07"]!();
    const modelo = { ...m, barras: m.barras!.map((b) => ({ ...b, seccion: sec })), casos: [m.casos[0]!] };
    const [c] = casosValidos(calcular(modelo, { solver: "perfil" }));
    const cabezas = [1, 3, 5, 7];
    const ux = cabezas.map((v) => c!.u[6 * v]! * 1e3);
    for (const [i, ref] of [1.71662, 1.71662, 0.38806, 0.38806].entries()) expect(Math.abs(ux[i]! - ref)).toBeLessThan(5e-6);
  });
});

describe("E1 frente a OpenSeesPy", () => {
  for (const [nombre, fabrica] of Object.entries(MODELOS_ORACULO)) {
    const modelo = fabrica();
    // nudos con reacción: apoyos y muelles a tierra
    const conReaccion = [
      ...new Set([...(modelo.apoyos ?? []).map((a) => a.nudo), ...(modelo.muelles ?? []).filter((m) => m.nudos.length === 1).map((m) => m.nudos[0])]),
    ];
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver}): u y reacciones a ≤ 1e-10 de OpenSees`, () => {
        const casos = casosValidos(calcular(modelo, { solver }));
        for (const c of casos) {
          const os = oraculo[nombre]![c.id]!;
          for (const handler of nombre === "cadenas" ? (["Lagrange"] as const) : (["Transformation", "Lagrange"] as const)) {
            const ref = os[handler];
            expect(errorPorGrupos(c.u, ref.u), `${c.id} u ${handler}`).toBeLessThan(1e-10);
            expect(errorPorGrupos(c.reacciones, ref.reacciones, conReaccion), `${c.id} R ${handler}`).toBeLessThan(1e-10);
          }
          expect(c.equilibrio.fuerzas).toBeLessThan(1e-12);
          expect(c.equilibrio.momentos).toBeLessThan(1e-12);
        }
      });
    }
  }
});
