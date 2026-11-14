/**
 * Las astillas junto a los pilares circulares (`refinamiento-vigas.md` §21, lo que quedaba;
 * `docs/fem3d/auditoria-2.md` §11.3). El octógono de un pilar circular cruza las caras de una viga de 30
 * a milímetros del corte de su ancho por un muro:
 * - un 40 sobre un muro de 26 (retícula al azar 1 con muros, P1-0): entre la esquina del ancho y el lado
 *   del octógono quedaba un triángulo de losa de 9 × 4 mm, con láminas de 1,2 mm. El ancho llega ahora
 *   al cruce de las caras con el octógono;
 * - un muro apeado que arranca del centro del pilar del extremo de la viga (retícula 21, P2-3): el corte
 *   caía dentro de la huella, con la esquina del ancho a 8 mm del lado del octógono, y láminas de
 *   0,5 mm. Lo que queda hasta el extremo está dentro de la huella (rígido), así que no se corta.
 * Antes, `malla/astillas-junto-a-pilar` en 12 de las 24 retículas con muros; ahora en ninguna con la
 * rejilla.
 */
import { describe, expect, it } from "vitest";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  return conMurosAleatorios({ ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] }, semilla);
}

describe("astillas junto a los pilares circulares, con un muro que corta su viga", () => {
  it.each([1, 21])("retícula %i con muros: sin láminas de menos de 5 mm y sin el aviso", (s) => {
    const c = compilar(reticulaConMuros(s));
    if (!c.valido) throw new Error("no compila");
    expect(c.diagnosticos.filter((d) => d.codigo === "malla/astillas-junto-a-pilar").map((d) => d.mensaje)).toEqual([]);
    const N = c.modelo.nudos;
    const rigidos = new Set((c.modelo.restricciones ?? []).flatMap((r) => (r.tipo === "enlace-rigido" ? r.esclavos : [])));
    const finas = (c.modelo.laminas ?? []).filter((l) => {
      if (l.nudos.every((n) => rigidos.has(n))) return false;
      const X = l.nudos.map((n) => N[n]!);
      return X.some((p, m) => Math.hypot(X[(m + 1) % 4]!.x - p.x, X[(m + 1) % 4]!.y - p.y, X[(m + 1) % 4]!.z - p.z) < 0.005);
    });
    expect(finas.length).toBe(0);
  }, 120_000);
});
