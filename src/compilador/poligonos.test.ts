/**
 * Polígonos de C2: áreas, simplicidad y la integral sobre la intersección de regiones, que el
 * control «sin pérdidas» usa como resultante física independiente de la malla.
 */
import { describe, expect, it } from "vitest";
import type { Vec2 } from "./fisico.ts";
import { areaConSigno, areaInterseccionRegiones, defectoPoligono, momentosInterseccion, momentosRegion, puntoEnRegion, recorteRegionConvexo, trozosSegmento, type Region } from "./poligonos.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const region = (contorno: Vec2[], huecos: Vec2[][] = []): Region => ({ contorno, huecos });
const L: Vec2[] = [
  [0, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 2],
];

/** Polígono estrellado al azar (simple por construcción) alrededor de c. */
function estrellado(r: () => number, c: Vec2, n: number, R: number): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.2 + 0.6 * r())) / n;
    const rr = R * (0.3 + 0.7 * r());
    p.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
  }
  return p;
}

describe("áreas y momentos", () => {
  it("región con hueco y sentido indiferente", () => {
    const m = momentosRegion(region(rect(0, 0, 4, 2), [rect(1, 0.5, 2, 1.5).reverse()]));
    expect(m.A).toBeCloseTo(7, 14);
    expect(m.Sx / m.A).toBeCloseTo((8 * 2 - 1 * 1.5) / 7, 14);
    expect(m.Sy / m.A).toBeCloseTo(1, 14);
  });
  it("punto en región", () => {
    const r = region(rect(0, 0, 4, 2), [rect(1, 0.5, 2, 1.5)]);
    expect(puntoEnRegion([0.5, 1], r)).toBe(true);
    expect(puntoEnRegion([1.5, 1], r)).toBe(false);
    expect(puntoEnRegion([5, 1], r)).toBe(false);
  });
});

describe("intersección por triángulos en abanico", () => {
  it("casos exactos", () => {
    const a = momentosInterseccion(region(rect(0, 0, 1, 1)), rect(0.5, 0.5, 1.5, 1.5));
    expect(a.A).toBeCloseTo(0.25, 14);
    expect(a.Sx / a.A).toBeCloseTo(0.75, 14);
    // L no convexa ∩ cuadrado: el cuadrado menos su cuarto superior derecho
    const b = momentosInterseccion(region(L), rect(0.5, 0.5, 1.5, 1.5));
    expect(b.A).toBeCloseTo(0.75, 14);
    expect(b.Sx).toBeCloseTo(1 - 0.25 * 1.25, 14);
    expect(b.Sy).toBeCloseTo(1 - 0.25 * 1.25, 14);
    // Con hueco
    expect(momentosInterseccion(region(rect(0, 0, 4, 4), [rect(1, 1, 2, 2)]), rect(0, 0, 3, 3)).A).toBeCloseTo(8, 13);
    // Disjuntos y contenido
    expect(momentosInterseccion(region(rect(0, 0, 1, 1)), rect(2, 2, 3, 3)).A).toBe(0);
    expect(momentosInterseccion(region(rect(0, 0, 10, 10)), L).A).toBeCloseTo(3, 13);
  });
  it("no depende del sentido de los polígonos", () => {
    const a = momentosInterseccion(region(L), rect(0.5, 0.5, 1.5, 1.5));
    const b = momentosInterseccion(region([...L].reverse()), rect(0.5, 0.5, 1.5, 1.5).reverse());
    expect(Math.abs(a.A - b.A)).toBeLessThan(1e-15);
    expect(Math.abs(a.Sx - b.Sx)).toBeLessThan(1e-15);
  });
  it("polígonos no convexos al azar, frente a una rejilla fina", () => {
    const r = azar(7);
    for (let k = 0; k < 6; k++) {
      const P = estrellado(r, [0, 0], 9, 3);
      const Z = estrellado(r, [0.8, -0.5], 7, 2.5);
      const m = momentosInterseccion(region(P), Z);
      // Rejilla de 800 × 800 en [−4, 4]²
      const n = 800;
      const h = 8 / n;
      let A = 0;
      let Sx = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const q: Vec2 = [-4 + (i + 0.5) * h, -4 + (j + 0.5) * h];
          if (puntoEnRegion(q, region(P)) && puntoEnRegion(q, region(Z))) {
            A += h * h;
            Sx += q[0] * h * h;
          }
        }
      }
      expect(Math.abs(m.A - A)).toBeLessThan(2e-2 * Math.max(A, 0.1));
      expect(Math.abs(m.Sx - Sx)).toBeLessThan(2e-2 * Math.max(Math.abs(Sx), 0.1));
      // Simétrica en sus argumentos
      expect(Math.abs(areaInterseccionRegiones(region(P), region(Z)) - areaInterseccionRegiones(region(Z), region(P)))).toBeLessThan(1e-12);
    }
  });
});

describe("recorte de una región por un convexo (A4: los ábacos en planta)", () => {
  /** Área par-impar de unos anillos anidados: el primero menos los demás. */
  const areaAnillos = (a: Vec2[][]) => a.reduce((t, p, i) => t + (i ? -1 : 1) * Math.abs(areaConSigno(p)), 0);
  it("ábacos de esquina, de borde y dentro de una losa rectangular", () => {
    const losa = region(rect(0, 0, 12, 11));
    const ab = (x: number, y: number) => rect(x - 1, y - 1, x + 1, y + 1);
    expect(areaAnillos(recorteRegionConvexo(losa, ab(0, 0))!)).toBeCloseTo(1, 12);
    expect(areaAnillos(recorteRegionConvexo(losa, ab(6, 0))!)).toBeCloseTo(2, 12);
    expect(areaAnillos(recorteRegionConvexo(losa, ab(12, 11))!)).toBeCloseTo(1, 12);
    expect(areaAnillos(recorteRegionConvexo(losa, ab(6, 5))!)).toBeCloseTo(4, 12);
    expect(recorteRegionConvexo(losa, ab(20, 5))).toEqual([]);
    // En sentido horario, igual; uno no convexo, null
    expect(areaAnillos(recorteRegionConvexo(losa, [...ab(0, 0)].reverse())!)).toBeCloseTo(1, 12);
    expect(recorteRegionConvexo(losa, L)).toBeNull();
  });
  it("regiones no convexas con hueco al azar: el área es la de la intersección", () => {
    const r = azar(11);
    for (let k = 0; k < 20; k++) {
      const P = estrellado(r, [0, 0], 9, 3);
      const H = estrellado(r, [0, 0], 6, 0.6);
      const c: Vec2 = [-2 + 4 * r(), -2 + 4 * r()];
      const g = Math.PI * r();
      const [a, b] = [0.5 + 2 * r(), 0.5 + 2 * r()];
      const Z: Vec2[] = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([x, y]) => [c[0] + x * Math.cos(g) - y * Math.sin(g), c[1] + x * Math.sin(g) + y * Math.cos(g)] as Vec2);
      const reg = region(P, [H]);
      const anillos = recorteRegionConvexo(reg, Z)!;
      expect(Math.abs(areaAnillos(anillos) - areaInterseccionRegiones(reg, region(Z)))).toBeLessThan(1e-12 * 30);
    }
  });
  it("trozos de un segmento dentro de una región", () => {
    const losa = region(rect(0, 0, 12, 11));
    const t = trozosSegmento([-1, 1], [1, 1], [losa.contorno], (q) => puntoEnRegion(q, losa));
    expect(t).toEqual([[[0, 1], [1, 1]]]);
  });
});

describe("simplicidad", () => {
  it("detecta los defectos", () => {
    expect(defectoPoligono(rect(0, 0, 1, 1), 1e-6)).toBeNull();
    expect(defectoPoligono(L, 1e-6)).toBeNull();
    expect(defectoPoligono([[0, 0], [1, 0]], 1e-6)).toMatch(/menos de 3/);
    expect(
      defectoPoligono(
        [
          [0, 0],
          [2, 2],
          [2, 0],
          [0, 1],
        ],
        1e-6,
      ),
    ).toMatch(/se cortan/);
    expect(
      defectoPoligono(
        [
          [0, 0],
          [2, 0],
          [1, 0],
          [1, 1],
        ],
        1e-6,
      ),
    ).toMatch(/vuelve/);
    expect(
      defectoPoligono(
        [
          [0, 0],
          [1, 0],
          [1, 0],
          [0, 1],
        ],
        1e-6,
      ),
    ).toMatch(/coinciden/);
    expect(
      defectoPoligono(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        1e-6,
      ),
    ).toMatch(/área nula|vuelve/);
    // Un lado que toca a otro no contiguo
    expect(
      defectoPoligono(
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [2, 0],
          [0, 2],
        ],
        1e-6,
      ),
    ).toMatch(/se cortan o se tocan/);
  });
});
