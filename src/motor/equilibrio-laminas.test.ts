/**
 * Regla de oro 2 con cargas de lámina: el equilibrio de cada cálculo usa la resultante real de las
 * cargas (integrales cerradas sobre el cuadrilátero, el tramo o el punto), no sus fuerzas nodales
 * equivalentes. Este test simula un error en las funciones de forma con las que se reparten
 * (un 0,1 % de más) y comprueba que el cálculo deja de ser válido para los tres tipos de carga.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Constructor, EMPOTRADO } from "../pruebas/constructor.ts";
import { mallaRectangular } from "../pruebas/placa.ts";
import { calcular } from "./calcular.ts";
import type { CargaLamina } from "./modelo.ts";

vi.mock("../elementos/lamina.ts", async (original) => {
  const m = await original<typeof import("../elementos/lamina.ts")>();
  // funcionesForma escribe en el búfer que recibe: se escala en el sitio
  return {
    ...m,
    funcionesForma: (...args: Parameters<typeof m.funcionesForma>) => {
      const N = m.funcionesForma(...args);
      for (let a = 0; a < 4; a++) N[a] *= 1.001;
      return N;
    },
  };
});

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("regla de oro 2 con cargas de lámina", () => {
  const cargas: [string, CargaLamina][] = [
    ["superficie", { tipo: "superficie", lamina: 1, ejes: "global", q: [0, 0, -5] }],
    ["línea", { tipo: "linea", lamina: 1, ejes: "global", a: [1.2, 0.2, 0], b: [1.8, 0.7, 0], qa: [0, 0, -5] }],
    ["puntual", { tipo: "puntual", lamina: 1, ejes: "global", punto: [1.3, 0.6, 0], F: [0, 0, -5] }],
  ];
  for (const [nombre, c] of cargas) {
    it(`${nombre}: unas equivalentes erróneas (×1,001) rompen el equilibrio y el cálculo no es válido`, () => {
      const m = new Constructor();
      const malla = mallaRectangular(m, { a: 2, b: 1, nx: 2, ny: 1, material: { E: 3e7, nu: 0.2, t: 0.2 } });
      for (const v of malla.nudos[0]!) m.apoyo(v, EMPOTRADO);
      m.caso("q", [], [], [], [c]);
      const r = calcular(m.modelo(), { solver: "perfil" });
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["equilibrio/no-cumple"]);
      expect(r.diagnosticos[0]!.detalles!.fuerzas as number).toBeGreaterThan(1e-5);
    });
  }
});
