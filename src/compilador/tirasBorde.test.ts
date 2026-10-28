/**
 * Fase TB (`anchosVigas.ts`, `tirasBorde`): la franja de losa entre la cara de fuera de una viga de
 * borde y el borde dibujado del forjado, de hasta b, va con la viga como su ancho. El forjado de 2 × 1
 * vanos con zunchos de 30 por el eje de los pilares y el borde a 0,27 m del eje (12 cm de la cara) al
 * sur, al este y al oeste; al norte, enrasado con la cara (0,15 m), con un peto por todo el borde.
 * - Las tiras salen en los tres lados con franja, a inglete en las esquinas, y en ninguna hay láminas.
 * - Las cargas no se pierden: con y sin tiras (la franja mallada), las reacciones suman lo mismo, en
 *   fuerza y en momento, a 1e-9 (el control «sin pérdidas» y el equilibrio, en cada cálculo).
 * - El peto por la cara de fuera de un zuncho enrasado, o por el borde de una tira, va a la viga
 *   (antes, `carga/fuera-de-losa`: un error).
 * - La malla es menor, ningún nudo es rígido fuera de una huella y el resultado no depende del orden
 *   del contorno.
 * - Una franja más ancha que b, o un borde dentro del ancho, no lleva tira.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { nudosRigidosFuera } from "../pruebas/huellasRigidas.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";
import { puntoEnPoligono } from "./poligonos.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const X = [0, 5, 10];
const Y = [0, 6];

/** El forjado: el borde a `fuera` del eje al sur, al este y al oeste, y a `norte` al norte. */
function modelo(fuera = 0.27, norte = 0.15): ModeloFisico {
  const contorno: Vec2[] = [
    [-fuera, -fuera],
    [10 + fuera, -fuera],
    [10 + fuera, 6 + norte],
    [-fuera, 6 + norte],
  ];
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "Z30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    pilares: X.flatMap((x, i) => Y.map((y, j) => ({ id: `P${i}${j}`, x, y, desde: "N0", hasta: "N1", seccion: "P30" }))),
    vigas: [
      ...Y.map((y, j) => ({ id: `ZX${j}`, planta: "N1", puntos: [[0, y], [10, y]] as Vec2[], seccion: "Z30" })),
      ...X.map((x, i) => ({ id: `ZY${i}`, planta: "N1", puntos: [[x, 0], [x, 6]] as Vec2[], seccion: "Z30" })),
    ],
    losas: [{ id: "L", planta: "N1", contorno, espesor: 0.3, material: "H" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "CM", caso: "G", planta: "N1", losa: "L", q: [0, 0, -2] },
      { tipo: "superficie", id: "SC", caso: "Q", planta: "N1", losa: "L", q: [0, 0, -3] },
      // Una zona que cruza la tira del sur
      { tipo: "superficie", id: "Z", caso: "Q", planta: "N1", zona: [[2, -fuera], [4, -fuera], [4, 1], [2, 1]], q: [0, 0, -4] },
      { tipo: "lineal", id: "PETO", caso: "G", planta: "N1", puntos: [...contorno, contorno[0]!], q: [0, 0, -5] },
      // Una puntual a 5 cm del borde del sur (en la tira, si la hay)
      { tipo: "puntual", id: "F", caso: "Q", planta: "N1", x: 7, y: -fuera + 0.05, F: [0, 0, -10] },
    ],
  };
}

const compilado = (f: ModeloFisico, op: OpcionesCompilacion = {}) => valido(compilar(f, op));
type C = ReturnType<typeof compilado>;
const tiras = (r: C) => (r.mapeo.anchos ?? []).filter((a) => a.tira);

/** Fuerza y momento respecto al origen de las reacciones de las bases de los pilares, por caso. */
function totales(f: ModeloFisico, r: C): number[][] {
  const cs = casosValidos(calcular(r.modelo));
  const q = new Consultas(f, r, cs, {});
  return cs.map((_, k) => {
    const t = [0, 0, 0, 0, 0, 0];
    for (const p of f.pilares!) {
      const R = q.reacciones(p.id);
      if (!R.valido) throw new Error(p.id);
      const [x, y, z] = R.valor.punto;
      const v = R.valor.resultante.slice(6 * k, 6 * k + 6);
      const [Fx, Fy, Fz] = [v[0]!, v[1]!, v[2]!];
      t[0]! += Fx;
      t[1]! += Fy;
      t[2]! += Fz;
      t[3]! += y * Fz - z * Fy + v[3]!;
      t[4]! += z * Fx - x * Fz + v[4]!;
      t[5]! += x * Fy - y * Fx + v[5]!;
    }
    return t;
  });
}

describe("tiras de borde (fase TB)", () => {
  const f = modelo();
  const con = compilado(f);
  const sin = compilado(f, { tirasBorde: false });

  it("salen al sur, al este y al oeste, no al norte (enrasado), a inglete en las esquinas y sin láminas dentro", () => {
    const t = tiras(con);
    // Una por lado: ZX0 es un solo tramo (los pilares van en su cadena)
    expect(t.map((a) => a.viga).sort()).toEqual(["ZX0", "ZY0", "ZY2"]);
    // La esquina sudoeste, partida por su diagonal entre ZX0 y ZY0
    const so = t.filter((a) => a.poligono.some((q) => Math.hypot(q[0] + 0.15, q[1] + 0.15) < 1e-9));
    expect(so.map((a) => a.viga).sort()).toEqual(["ZX0", "ZY0"]);
    for (const a of t) expect(a.poligono.length).toBe(4);
    // Ninguna lámina dentro de una tira
    const polis = t.map((a) => a.poligono as Vec2[]);
    for (const l of con.modelo.laminas ?? []) {
      const c = l.nudos.reduce((s, n) => [s[0] + con.modelo.nudos[n]!.x / 4, s[1] + con.modelo.nudos[n]!.y / 4] as Vec2, [0, 0] as Vec2);
      expect(polis.some((p) => puntoEnPoligono(c, p))).toBe(false);
    }
    expect(con.hipotesis.some((h) => h.includes("fase TB; 3 tiras, en ZX0, ZY0, ZY2"))).toBe(true);
    expect(sin.hipotesis.some((h) => h.includes("fase TB"))).toBe(false);
  });

  it("las reacciones suman lo mismo que con la franja mallada, en fuerza y en momento", () => {
    const [a, b] = [totales(f, con), totales(f, sin)];
    a.forEach((t, k) => {
      const escala = Math.max(...t.map(Math.abs));
      for (let i = 0; i < 6; i++) expect(Math.abs(t[i]! - b[k]![i]!), `caso ${k}, componente ${i}`).toBeLessThan(1e-9 * escala);
    });
    // Y cada pilar, cerca: la franja de 12 cm cambia poco el reparto
    const cs = casosValidos(calcular(con.modelo));
    const cs0 = casosValidos(calcular(sin.modelo));
    const [q, q0] = [new Consultas(f, con, cs, {}), new Consultas(f, sin, cs0, {})];
    for (const p of f.pilares!) {
      const [r, r0] = [q.reacciones(p.id), q0.reacciones(p.id)];
      if (!r.valido || !r0.valido) throw new Error(p.id);
      for (let k = 0; k < cs.length; k++) expect(Math.abs(r.valor.resultante[6 * k + 2]! / r0.valor.resultante[6 * k + 2]! - 1), `${p.id} caso ${k}`).toBeLessThan(0.03);
    }
  });

  it("el peto por la cara de un zuncho enrasado o por el borde de una tira va a la viga", () => {
    expect(con.diagnosticos.filter((d) => d.codigo === "carga/fuera-de-losa")).toEqual([]);
    expect(sin.diagnosticos.filter((d) => d.codigo === "carga/fuera-de-losa")).toEqual([]);
  });

  it("la malla es menor y ningún nudo es rígido fuera de una huella", () => {
    expect(con.modelo.nudos.length).toBeLessThan(sin.modelo.nudos.length);
    expect(nudosRigidosFuera(f, con).filter((x) => x.nudos.length)).toEqual([]);
  });

  it("no depende del orden del contorno: empezando en otro vértice y al revés, la misma malla", () => {
    const g = modelo();
    const l = g.losas![0]!;
    (l as unknown as { contorno: Vec2[] }).contorno = [...l.contorno.slice(2), ...l.contorno.slice(0, 2)].reverse() as Vec2[];
    const r = compilado(g);
    expect(r.modelo.nudos.length).toBe(con.modelo.nudos.length);
    expect(JSON.stringify(r.modelo.nudos)).toBe(JSON.stringify(con.modelo.nudos));
    expect(tiras(r).map((a) => JSON.stringify(a.poligono.map((q) => q.map((x) => +x.toFixed(9))).sort()))).toEqual(tiras(con).map((a) => JSON.stringify(a.poligono.map((q) => q.map((x) => +x.toFixed(9))).sort())));
  });

  it("una franja más ancha que b, o un borde dentro del ancho, no lleva tira", () => {
    // 0,5 del eje: 0,35 m de franja, más que b = 0,3
    expect(tiras(compilado(modelo(0.5, 0.5)))).toEqual([]);
    // 0,1 del eje: el borde cae en el ancho (LV)
    expect(tiras(compilado(modelo(0.1, 0.1)))).toEqual([]);
    // A 0,45 (la franja de b justo), sí
    expect(tiras(compilado(modelo(0.45, 0.15))).length).toBe(3);
  });
});
