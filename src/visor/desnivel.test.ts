/**
 * Los desniveles en el dibujo (fase DN, `docs/fem3d/desniveles.md`, criterio 4):
 * - el sólido pone cada forjado con su cara superior en la cota más su desnivel, las vigas en el del
 *   forjado más alto que tocan, y los pilares hasta la cara inferior de la losa de su cabeza y desde la
 *   cara superior de la de su base: el volumen de cada pieza es el de sus datos (el de los dos tramos de
 *   un pilar, el mismo que sin desnivel);
 * - el alzado corta cada forjado en su cota real y rotula su desnivel;
 * - las cargas de superficie, lineales, puntuales y de viga, en la cara superior real;
 * - el alámbrico físico, en la misma cota;
 * - sin desniveles, lo de antes (las pruebas de cada dibujo siguen dándolo bit a bit).
 */
import { describe, expect, it } from "vitest";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { Losa, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { geometriaCargas } from "../agente/render/cargas.ts";
import { vistaAlzado } from "../agente/render/alzado.ts";
import { etiquetaLosa } from "../agente/render/modelo.ts";
import { alambrico } from "./alambrico.ts";
import { piezasSolido, volumen } from "./solido.ts";

const L = 6;
const e = 0.15;
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Dos plantas: en N1, A (en la cota) y B (con su desnivel), con la viga VE en el escalón y el zuncho VZ en B; en N2, C entera. */
function modelo(dzB?: number): ModeloFisico {
  const B: Losa = { id: "B", planta: "N1", material: "H", espesor: 0.25, contorno: rect(L, -e, 2 * L + e, L + e) };
  if (dzB !== undefined) B.desnivel = dzB;
  return {
    plantas: [
      { id: "N2", altura: null },
      { id: "N1", altura: 3 },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "z", material: "H", forma: "rectangular", b: 0.3, h: 0.4 },
    ],
    pilares: [0, L, 2 * L].flatMap((x, i) => [0, L].map((y, j) => ({ id: `P${i + 1}${j + 1}`, x, y, desde: "N0", hasta: "N2", seccion: "p" }))),
    vigas: [
      { id: "VE", planta: "N1", puntos: [[L, 0], [L, L]], seccion: "v" },
      { id: "VZ", planta: "N1", puntos: [[2 * L, 0], [2 * L, L]], seccion: "z" },
    ],
    losas: [{ id: "A", planta: "N1", material: "H", espesor: 0.25, contorno: rect(-e, -e, L, L + e) }, B, { id: "C", planta: "N2", material: "H", espesor: 0.25, contorno: rect(-e, -e, 2 * L + e, L + e) }],
    casos: [{ id: "G", pesoPropio: true }, { id: "CM" }],
    cargas: [
      { tipo: "superficie", id: "sB", caso: "CM", planta: "N1", losa: "B", q: [0, 0, -2] },
      { tipo: "superficie", id: "sZ", caso: "CM", planta: "N1", zona: rect(4, 1, 8, 2), q: [0, 0, -1] },
      { tipo: "puntual", id: "pB", caso: "CM", planta: "N1", x: 9, y: 3, F: [0, 0, -10] },
      { tipo: "lineal", id: "lB", caso: "CM", planta: "N1", puntos: [[8, 1], [8, 5]], q: [0, 0, -3] },
      { tipo: "viga", id: "vZ", caso: "CM", viga: "VZ", ejes: "global", q: [0, 0, -4] },
    ],
  };
}

const zs = (caras: { p: readonly (readonly number[])[] }[]) => {
  const z = caras.flatMap((c) => c.p.map((q) => q[2]!));
  return [Math.min(...z), Math.max(...z)].map((x) => Math.round(x * 1e9) / 1e9);
};

describe("los desniveles en el dibujo (fase DN)", () => {
  const cota = cotasPlantas(modelo().plantas)[1]!; // N1, a 3 m
  it("el sólido: cada pieza en su cota real, con el volumen de sus datos", () => {
    const sin = piezasSolido(modelo()).piezas;
    const con = piezasSolido(modelo(-0.1)).piezas;
    const de = (ps: typeof sin, id: string, planta?: number) => ps.filter((p) => p.id === id && (planta === undefined || p.planta === planta));
    // B, de −0,35 a −0,10; A, en la cota
    expect(zs(de(con, "B")[0]!.caras)).toEqual([cota - 0.35, cota - 0.1]);
    expect(zs(de(con, "A")[0]!.caras)).toEqual([cota - 0.25, cota]);
    // El zuncho, sólo en B, baja con ella; la viga del escalón, con A (la más alta)
    expect(zs(de(con, "VZ")[0]!.caras)).toEqual([cota - 0.5, cota - 0.1]);
    expect(zs(de(con, "VE")[0]!.caras)).toEqual([cota - 0.5, cota]);
    // Los volúmenes: las losas y las vigas, los mismos; los dos tramos de P31, entre los dos, también
    for (const id of ["A", "B", "VE", "VZ", "C"]) expect(volumen(de(con, id)[0]!.caras)).toBeCloseTo(volumen(de(sin, id)[0]!.caras), 9);
    const vP = (ps: typeof sin) => de(ps, "P31").reduce((s, p) => s + volumen(p.caras), 0);
    expect(vP(con)).toBeCloseTo(vP(sin), 9);
    // el tramo de abajo acaba en la cara inferior de B y el de arriba empieza en su cara superior
    const [abajo, arriba] = [de(con, "P31", 1), de(con, "P31", 0)];
    expect(zs(abajo[0]!.caras)[1]).toBeCloseTo(cota - 0.35, 9);
    expect(zs(arriba[0]!.caras)[0]).toBeCloseTo(cota - 0.1, 9);
  });

  it("el alzado: el forjado cortado en su cota real, con su desnivel rotulado", () => {
    const f = modelo(-0.1);
    const e = vistaAlzado(f, { desde: [-1, 3], hasta: [14, 3] }, { huella: "x" });
    const poli = e.primitivas.filter((p) => p.tipo === "poligono" && "objeto" in p && p.objeto === "B");
    expect(poli.length).toBeGreaterThan(0);
    const zB = poli.flatMap((p) => (p as { anillos: Vec2[][] }).anillos.flat().map((q) => q[1]));
    expect([Math.min(...zB), Math.max(...zB)].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([cota - 0.35, cota - 0.1]);
    expect(e.primitivas.some((p) => p.tipo === "texto" && (p as { texto: string }).texto === "B −0,1")).toBe(true);
    // en la planta, el rótulo lleva el desnivel
    expect(etiquetaLosa(f.losas![1]!)).toBe("B · maciza 25 · −0,10");
    expect(etiquetaLosa(f.losas![0]!)).toBe("A · maciza 25");
  });

  it("las cargas, en la cara superior real", () => {
    const g = new Map(geometriaCargas(modelo(-0.1), "CM").cargas.map((c) => [c.carga.id, c]));
    const z = (v: number) => Math.round(v * 1e9) / 1e9;
    expect(z(g.get("sB")!.regiones[0]!.z)).toBe(cota - 0.1);
    // la zona que cae en A y en B: una parte en cada cota
    expect(g.get("sZ")!.regiones.map((r) => z(r.z)).sort()).toEqual([cota - 0.1, cota].sort());
    expect(z(g.get("pB")!.puntos[0]!.p[2])).toBe(cota - 0.1);
    expect(z(g.get("lB")!.lineas[0]!.a[2])).toBe(cota - 0.1);
    expect(z(g.get("vZ")!.lineas[0]!.a[2])).toBe(cota - 0.1);
    // sin desniveles, la zona va entera, como antes
    expect(geometriaCargas(modelo(), "CM").cargas.find((c) => c.carga.id === "sZ")!.regiones.length).toBe(1);
  });

  it("el alámbrico físico, en la misma cota", () => {
    const a = alambrico(modelo(-0.1));
    const k = a.objetos.findIndex((o) => o.id === "B");
    const z = new Set<number>();
    for (let i = 0; i < a.objeto.length; i++) if (a.objeto[i] === k) for (const j of [2, 5]) z.add(Math.round((a.segmentos[6 * i + j]! + a.origen[2]) * 1e5) / 1e5);
    expect([...z]).toEqual([Math.round((cota - 0.1) * 1e5) / 1e5]);
  });
});
