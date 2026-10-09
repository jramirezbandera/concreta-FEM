/**
 * A-9 (`docs/fem3d/fase-a0-a2.md`): una viga rectangular de hormigón que corre por el eje de un
 * muro que le llega desde abajo pesa sólo lo que sobresale de él, w·max(0, b − t)/b, porque cuelga
 * del forjado dentro del muro, que pesa de forjado a forjado. El pilar sigue sin descontar su cruce
 * con la losa (hipótesis del lado de la seguridad).
 */
import { describe, expect, it } from "vitest";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { resultanteAnalitica } from "./cargas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

/** Peso propio del caso G compilado sin las demás cargas, kN. */
function peso(f: ModeloFisico): number {
  const c = compilar({ ...f, casos: f.casos.filter((x) => x.pesoPropio), cargas: [] });
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("; "));
  return -resultanteAnalitica(c.modelo, 0, [0, 0, 0]).F[2];
}

describe("A-9: vigas sobre el eje de un muro", () => {
  it("a mano: la retícula con núcleo descuenta 22 m de descuelgue de 0,3 × 0,28 menos lo que sobresale (0,05 m)", () => {
    // Antes de A-9 pesaba 2 085,47 kN (A3-1: lo mismo que Σ V·γ sin la malla)
    const quita = 22 * 25 * (0.3 - 0.05) * (0.5 - 0.22);
    expect(peso(reticulaConNucleo())).toBeCloseTo(2085.47 - quita, 9);
  });

  it("con un muro más grueso que la viga, la viga no pesa sobre él", () => {
    const f = reticulaConNucleo();
    const grueso = { ...f, muros: f.muros!.map((m) => ({ ...m, espesor: 0.35 })) };
    const muroMas = (0.35 - 0.25) * 22 * 1.5 * 25 - (0.35 - 0.25) * 1 * 1.2 * 25; // el muro más grueso (con su puerta)…
    const solape = 0.1 * 0.22 * 22 * 25 * 0.5; // …menos su solape con la losa (C3-g, la mitad de la losa por el lado de abajo)
    expect(peso(grueso)).toBeCloseTo(2085.47 - 22 * 25 * 0.3 * 0.28 + muroMas - solape, 6);
  });
});
