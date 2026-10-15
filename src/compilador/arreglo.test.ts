/**
 * Arreglo plano de C2: uniones con ε_snap, trazos doblados, cruces y solapes colineales, y una
 * prueba de estrés al azar en la que constrainautor tiene que aceptar el resultado.
 */
import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { describe, expect, it } from "vitest";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { Arreglo } from "./arreglo.ts";
import type { Vec2 } from "./fisico.ts";
import { distanciaASegmento } from "./poligonos.ts";

const EG = 1e-6;
const ES = 0.05;
const cuadrado = (x0: number, y0: number, L: number): Vec2[] => [
  [x0, y0],
  [x0 + L, y0],
  [x0 + L, y0 + L],
  [x0, y0 + L],
];

/** Triangula el arreglo con sus lados restringidos (lanza si constrainautor no lo acepta). */
function triangular(a: Arreglo): number {
  const coords = a.puntos.flatMap((p) => [p.x, p.y]);
  const d = new Delaunator(Float64Array.from(coords));
  const c = new Constrainautor(d);
  c.constrainAll(a.lados().map((s) => [s.a, s.b] as [number, number]));
  return d.triangles.length / 3;
}

describe("arreglo plano", () => {
  it("losa con una viga que la cruza en diagonal", () => {
    const a = new Arreglo(EG, ES);
    a.trazo("V1", "viga", 0, [
      [-1, -1],
      [11, 11],
    ], false);
    const l = a.trazo("L1", "losa", -1, cuadrado(0, 0, 10), true)!;
    expect(a.resolver()).toBe(true);
    expect(a.defecto()).toBeNull();
    // Las esquinas (0,0) y (10,10) caen sobre la viga y la parten; la losa sigue con 4 puntos
    expect(l.puntos.length).toBe(4);
    expect(a.trazos[0]!.puntos.length).toBe(4);
    expect(a.movimientos).toEqual([]);
    expect(triangular(a)).toBeGreaterThan(0);
  });

  it("une un vértice a un nudo fijo cercano y lo avisa", () => {
    const a = new Arreglo(EG, ES);
    const n = a.fijo(0.03, 0, 7);
    const l = a.trazo("L1", "losa", -1, cuadrado(0, 0, 5), true)!;
    a.resolver();
    expect(l.puntos[0]).toBe(n);
    expect(a.movimientos).toHaveLength(1);
    expect(a.movimientos[0]!.distancia).toBeCloseTo(0.03, 12);
  });

  it("dobla un lado para que pase por un nudo fijo cercano", () => {
    const a = new Arreglo(EG, ES);
    const n = a.fijo(2, 0.02, 3);
    const l = a.trazo("L1", "losa", -1, cuadrado(0, 0, 5), true)!;
    a.resolver();
    expect(l.puntos).toContain(n);
    expect(a.movimientos.some((m) => m.que === "un lado" && Math.abs(m.distancia - 0.02) < 1e-12)).toBe(true);
    expect(a.defecto()).toBeNull();
  });

  it("un vértice cerca de un segmento se une a su proyección", () => {
    const a = new Arreglo(EG, ES);
    a.trazo("V1", "viga", 0, [
      [0, 0],
      [10, 0],
    ], false);
    const z = a.trazo("Z1", "zona", -1, [
      [3, 0.04],
      [6, 0.04],
      [6, 3],
      [3, 3],
    ], true)!;
    a.resolver();
    // Los dos vértices bajos se proyectan sobre la viga, que queda partida en ellos
    expect(a.puntos[z.puntos[0]!]!.y).toBe(0);
    expect(a.puntos[z.puntos[1]!]!.y).toBe(0);
    expect(a.trazos[0]!.puntos.length).toBe(4);
    expect(a.lados().filter((s) => s.trazos.length === 2)).toHaveLength(1); // el lado común
  });

  it("cruces y solape colineal", () => {
    const a = new Arreglo(EG, ES);
    a.trazo("V1", "viga", 0, [
      [0, 5],
      [10, 5],
    ], false);
    a.trazo("V2", "viga", 1, [
      [5, 0],
      [5, 10],
    ], false);
    a.trazo("L1", "losa", -1, cuadrado(0, 0, 10), true); // sus lados x = 0 y x = 10 tocan los extremos de V1
    a.trazo("B1", "banda", -1, [
      [2, 4],
      [8, 4],
      [8, 5],
      [2, 5],
    ], true); // su lado superior va sobre V1
    expect(a.resolver()).toBe(true);
    expect(a.defecto()).toBeNull();
    const cruce = a.puntos.findIndex((p) => p.x === 5 && p.y === 5);
    expect(cruce).toBeGreaterThanOrEqual(0);
    expect(a.trazos[0]!.puntos).toContain(cruce);
    expect(a.trazos[1]!.puntos).toContain(cruce);
    // El lado de la banda sobre V1 se comparte con la viga
    expect(a.lados().some((s) => s.trazos.includes(0) && s.trazos.includes(3))).toBe(true);
    expect(triangular(a)).toBeGreaterThan(0);
  });

  it("un trazo exacto (cara de banda, C5-g) no se dobla hacia la esquina de un pilar a 5 cm, ni dobla nada hacia él", () => {
    // Pilar de fachada con la huella [4,75, 5,25] × [−0,15, 0,15] sobre el borde y = 0 de la losa, y
    // la cara común de su línea en x = 4,8 (la de un pilar menor), de y = 0 a y = 2
    const montar = (exacto: boolean, x = 4.8) => {
      const a = new Arreglo(EG, ES);
      const h = a.trazo("P", "huella", 0, [
        [4.75, -0.15],
        [5.25, -0.15],
        [5.25, 0.15],
        [4.75, 0.15],
      ], true)!;
      a.trazo("L1", "losa", -1, cuadrado(0, 0, 10), true);
      const c = a.trazo("B", "banda", -1, [
        [x, 0],
        [x, 2],
      ], false, exacto)!;
      expect(a.resolver()).toBe(true);
      expect(a.defecto()).toBeNull();
      expect(triangular(a)).toBeGreaterThan(0);
      return { a, h, c };
    };
    const { a, h, c } = montar(true);
    // La cara sigue recta, y la huella con sus lados: corta el borde de la losa en (4,75, 0), no en el
    // extremo de la cara, y la cara la corta en (4,8, 0,15), a 5 cm de su esquina
    for (const p of c.puntos) expect(a.puntos[p]!.x).toBe(4.8);
    const enBorde = (p: number) => {
      const { x, y } = a.puntos[p]!;
      return Math.abs(Math.abs(x - 5) - 0.25) < 1e-12 || Math.abs(Math.abs(y) - 0.15) < 1e-12;
    };
    expect(h.puntos.every(enBorde)).toBe(true);
    const en = (x: number, y: number) => a.puntos.findIndex((p) => Math.abs(p.x - x) < 1e-12 && Math.abs(p.y - y) < 1e-12);
    expect(h.puntos).toContain(en(4.75, 0));
    expect(h.puntos).toContain(en(4.8, 0.15));
    expect(c.puntos).toContain(en(4.8, 0.15));
    expect(a.movimientos).toEqual([]);
    // Sin ser exacta, la cara a 4 cm de la esquina del pilar se dobla hasta ella (lo que hacía C5.2); a
    // justo ε_snap (5 cm), ya no: el empate no lo decide un redondeo (fase LV)
    const otro = montar(false, 4.79);
    expect(otro.c.puntos.some((p) => Math.abs(otro.a.puntos[p]!.x - 4.75) < 1e-12)).toBe(true);
    expect(otro.a.movimientos.some((m) => m.id === "B")).toBe(true);
    const justo = montar(false);
    expect(justo.c.puntos.every((p) => justo.a.puntos[p]!.x === 4.8)).toBe(true);
  });

  it("estrés al azar: converge, sin defectos, y constrainautor lo acepta", () => {
    for (let semilla = 1; semilla <= 30; semilla++) {
      const r = azar(semilla);
      const a = new Arreglo(EG, ES);
      for (let i = 0; i < 12; i++) a.fijo(10 * r(), 10 * r(), i);
      const originales: { puntos: Vec2[]; cerrado: boolean }[] = [];
      for (let i = 0; i < 25; i++) {
        const cerrado = r() < 0.3;
        const n = cerrado ? 3 + Math.floor(3 * r()) : 2 + Math.floor(2 * r());
        const ps: Vec2[] = [];
        // A veces casi alineado con algo ya puesto: vértices en una cuadrícula de 0,5 m con ruido de ±3 cm
        for (let k = 0; k < n; k++) ps.push(r() < 0.5 ? [10 * r(), 10 * r()] : [Math.round(20 * r()) / 2 + 0.06 * (r() - 0.5), Math.round(20 * r()) / 2 + 0.06 * (r() - 0.5)]);
        if (a.trazo(`T${i}`, r() < 0.5 ? "losa" : "zona", -1, ps, cerrado)) originales.push({ puntos: ps, cerrado });
      }
      expect(a.resolver(), `semilla ${semilla}`).toBe(true);
      expect(a.defecto(), `semilla ${semilla}`).toBeNull();
      // Ningún par de puntos a ≤ ε_snap
      let dmin = Infinity;
      for (let i = 0; i < a.puntos.length; i++)
        for (let j = i + 1; j < a.puntos.length; j++) {
          const dx = a.puntos[i]!.x - a.puntos[j]!.x;
          const dy = a.puntos[i]!.y - a.puntos[j]!.y;
          dmin = Math.min(dmin, Math.sqrt(dx * dx + dy * dy));
        }
      expect(dmin, `semilla ${semilla}`).toBeGreaterThan(ES);
      // Los trazos no se alejan de lo dibujado más de unas pocas ε_snap
      let deriva = 0;
      a.trazos.forEach((t, ti) => {
        const o = originales[ti]!;
        for (const p of t.puntos) {
          let d = Infinity;
          const n = o.puntos.length;
          for (let k = 0; k < (o.cerrado ? n : n - 1); k++) d = Math.min(d, distanciaASegmento([a.puntos[p]!.x, a.puntos[p]!.y], o.puntos[k]!, o.puntos[(k + 1) % n]!));
          deriva = Math.max(deriva, d);
        }
      });
      expect(deriva, `semilla ${semilla}`).toBeLessThan(3 * ES);
      expect(() => triangular(a), `semilla ${semilla}`).not.toThrow();
    }
  });
});
