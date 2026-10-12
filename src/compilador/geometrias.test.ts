/**
 * G: el compilador con plantas no ortogonales (rombo, circular con vigas curvas, abanico, dos alas
 * en ángulo y triangular, con huecos, giradas y con pilares circulares) y con retículas al azar en
 * las que entra la rejilla (huecos junto a pilares, voladizos, fachadas enrasadas, chaflanes):
 * todas compilan, con y sin rejilla, sin errores ni respaldo de la triangulación. La precisión
 * frente a la malla fina se mide en `validacion/geom/sondeo.ts`.
 */
import { describe, expect, it } from "vitest";
import { edificioGeometria, FAMILIAS, type OpcionesGeometria } from "../pruebas/geometrias.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

const VARIANTES: OpcionesGeometria[] = [{}, { hueco: true }, { giro: 23 }, { circulares: true }];

function compila(f: ModeloFisico, rejilla: boolean) {
  const r = compilar(f, { rejilla });
  const errores = r.diagnosticos.filter((d) => d.severidad === "error").map((d) => `${d.codigo}: ${d.mensaje}`);
  expect(errores).toEqual([]);
  expect(r.valido).toBe(true);
  expect(r.diagnosticos.filter((d) => d.codigo === "malla/sin-rejilla")).toEqual([]);
  return r;
}

describe("G: plantas no ortogonales", () => {
  for (const fam of FAMILIAS)
    it(`${fam}: compila en sus variantes, con y sin rejilla`, () => {
      for (const v of VARIANTES) for (const rejilla of [true, false]) compila(edificioGeometria(fam, v), rejilla);
    });
});

describe("G: retículas al azar", () => {
  it("24 retículas compilan con y sin rejilla, y la rejilla entra en casi todas", () => {
    let conRejilla = 0;
    for (let s = 1; s <= 24; s++) {
      const r = compila(reticulaAleatoria(s), true);
      if (r.valido && r.estadisticas.malla.laminasRejilla > 0) conRejilla++;
      compila(reticulaAleatoria(s), false);
    }
    expect(conRejilla).toBeGreaterThanOrEqual(20);
  });
});
