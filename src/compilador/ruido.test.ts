/**
 * A2-53 (`docs/fem3d/auditoria-2.md` §10.2 y §11): la malla de las losas no depende de un ruido menor
 * que ε_geom en el dibujo (regla del mallador). En la retícula al azar 7, un ruido de ±ε_geom/3 la
 * llevaba de 1 617 a 2 894 láminas, por dos empates sin holgura:
 * - la cara común de una línea de pilares (C5-g, `carasComunes`): un 25 × 60 con un 30 × 30 en su eje
 *   está justo en el doble de la semiextensión, y con 1e-12 de holgura un ruido de 3e-10 lo sacaba;
 * - la tira de borde (TB, `tirasBorde`): el lado del borde, paralelo a la viga sólo si |sen| ≤ 1e-9;
 *   con un vértice movido 3e-7 en un lado de 20 m, sin tira y con la franja mallada.
 * Lo que quedaba (§11.2):
 * - las vigas se partían en algún nudo más de la malla (+1…+7 barras): en la diagonal del cruce de dos
 *   vigas, un nudo de la cara está a la misma distancia de los dos ejes, y `anchoMasCercano` decidía a
 *   cuál iba con 1e-9 (ahora, 10·ε_geom);
 * - el núcleo de 10 de 48 retículas con muros no compilaba con ruido (`malla/area` del muro, error de
 *   1e-9 a 8e-9): la comprobación no dejaba la holgura de la fusión de las estaciones a ε_geom.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { transformar } from "../pruebas/metamorficasFisicas.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";

const conRuido = (f: ModeloFisico, amp: number, semilla: number): ModeloFisico => {
  const r = azar(semilla);
  const e = () => (2 * r() - 1) * amp;
  return transformar(f, { p: (q: Vec2) => [q[0] + e(), q[1] + e()], v: (q) => [q[0]!, q[1]!, q[2]!], giro: 0 });
};

describe("A2-53: la malla de las losas no cambia con un ruido menor que ε_geom", () => {
  it("retícula al azar 7, con ±ε_geom/3 en todo: las mismas láminas, en el mismo sitio", () => {
    const f = reticulaAleatoria(7);
    const a = compilar(f);
    if (!a.valido) throw new Error("no compila");
    const centros = (c: Extract<ReturnType<typeof compilar>, { valido: true }>) =>
      c.modelo.laminas!.map((l) => {
        const N = l.nudos.map((n) => c.modelo.nudos[n]!);
        return [N.reduce((s, n) => s + n.x, 0) / N.length, N.reduce((s, n) => s + n.y, 0) / N.length];
      });
    const ca = centros(a);
    for (const semilla of [555, 7]) {
      const b = compilar(conRuido(f, 1e-6 / 3, semilla));
      if (!b.valido) throw new Error("no compila con ruido");
      expect(b.modelo.laminas!.length, `semilla ${semilla}`).toBe(a.modelo.laminas!.length);
      const cb = centros(b);
      const lejos = cb.filter((p) => !ca.some((q) => Math.abs(p[0]! - q[0]!) + Math.abs(p[1]! - q[1]!) <= 1e-5)).length;
      expect(lejos, `semilla ${semilla}`).toBe(0);
    }
  }, 120_000);

  it("las vigas se parten en los mismos sitios: retículas 7 y 16, cada pieza con sus barras", () => {
    for (const [ret, semilla] of [[7, 555], [16, 555]] as const) {
      const f = reticulaAleatoria(ret);
      const [a, b] = [compilar(f), compilar(conRuido(f, 1e-6 / 3, semilla))];
      if (!a.valido || !b.valido) throw new Error("no compila");
      const distintas = Object.keys(a.mapeo.piezas).filter((p) => a.mapeo.piezas[p]!.length !== (b.mapeo.piezas[p]?.length ?? 0));
      expect(distintas, `retícula ${ret}`).toEqual([]);
    }
  }, 120_000);

  it("una retícula con muros compila con el ruido (el área de la malla del núcleo, con la holgura de ε_geom)", () => {
    const f0 = reticulaAleatoria(3);
    const f = conMurosAleatorios({ ...f0, secciones: [...f0.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f0.casos, { id: "V" }] }, 3);
    const b = compilar(conRuido(f, 1e-6 / 3, 7));
    expect(b.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo)).toEqual([]);
  }, 120_000);
});
