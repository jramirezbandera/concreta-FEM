/**
 * Pilares apeados sobre una losa o un muro (2026-10-12). El arranque «ninguno» se une a la losa (o al
 * muro) por la huella rígida del pilar (C2-d), como cualquier pilar que la atraviesa; antes, el
 * compilador sólo admitía que le llegara una viga u otro pilar.
 * - Estática: el axil del pilar apeado es la carga de su cabeza, exacto.
 * - Metamórfica: la carga en la cabeza da en la losa lo mismo que la carga en el arranque.
 * - Oráculo: con un pilar casi puntual, la flecha a ≥ 1 m de él es la de Navier (Mindlin) con la
 *   carga en su huella, a ≤ 0,6 %. Con 30 × 30 cm, la huella rígida hace la losa más rígida que la
 *   carga repartida (−10 % bajo el pilar, −3 % a 1 m), lo mismo que en un pilar continuo.
 * - Congelado: la flecha bajo el pilar de 30 × 30 y el axil del caso realista.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { navierFisico } from "../../validacion/c2/navier.ts";
import { A, B, placaNavier } from "../../validacion/e3/navier.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { navierMindlin } from "../pruebas/navier.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const LOSA = { nombre: "losa de 25 cm", E: 3e7, nu: 0.2, t: 0.25, mult: {} };
const P = 100;
const TRIANGULACION: OpcionesCompilacion = { tamanoMalla: 0.25, rejilla: false };

/** La placa de Navier de C2 (6 × 4 m, apoyada «hard») con un pilar apeado en (x, y) y P en su cabeza. */
function apeoEnPlaca(x: number, y: number, lado: number): ModeloFisico {
  const f = navierFisico(LOSA);
  return {
    ...f,
    plantas: [
      { id: "P1", altura: null, diafragma: "ninguno" },
      { id: "P0", altura: 3, diafragma: "ninguno" },
    ],
    secciones: [{ id: "p", material: "M", forma: "rectangular", b: lado, h: lado }],
    losas: f.losas!.map((l) => ({ ...l, planta: "P0" })),
    apoyosLineales: f.apoyosLineales!.map((a) => ({ ...a, planta: "P0" })),
    pilares: [{ id: "X", x, y, desde: "P0", hasta: "P1", seccion: "p", base: "ninguno" }],
    cargas: [{ tipo: "puntual", id: "F", caso: "q", planta: "P1", x, y, F: [0, 0, -P] }],
  };
}

function calculado(f: ModeloFisico, op: OpcionesCompilacion = {}) {
  const r = valido(compilar(f, op));
  const [res] = casosValidos(calcular(r.modelo));
  return { r, res: res!, c: new Consultas(f, r, [res!]) };
}

const axil = (c: Consultas, id: string) => {
  const t = c.pilar(id);
  if (!t.valido) throw new Error(t.diagnosticos.map((d) => d.mensaje).join(" "));
  return t.valor[0]!.base.esfuerzos[0]!;
};

/** w de los nudos de la losa (z = 0). */
function flechas(x: ReturnType<typeof calculado>): { x: number; y: number; w: number }[] {
  return x.r.modelo.nudos.flatMap((n, i) => (Math.abs(n.z) < 1e-9 ? [{ x: n.x, y: n.y, w: x.res.u[6 * i + 2]! }] : []));
}

describe("pilar apeado sobre una losa", () => {
  it("compila sin avisos propios, y su axil es la carga de la cabeza", () => {
    const x = calculado(apeoEnPlaca(2, 1.5, 0.3), TRIANGULACION);
    expect(x.r.diagnosticos.filter((d) => d.codigo !== "apoyo/repetido")).toEqual([]);
    expect(Math.abs(axil(x.c, "X") + P) / P).toBeLessThan(1e-9);
  });

  it("metamórfica: la carga en la cabeza da en la losa lo mismo que en el arranque", () => {
    const f = apeoEnPlaca(2, 1.5, 0.3);
    const g: ModeloFisico = { ...f, cargas: [{ tipo: "puntual", id: "F", caso: "q", planta: "P0", x: 2, y: 1.5, F: [0, 0, -P] }] };
    const [a, b] = [flechas(calculado(f, TRIANGULACION)), flechas(calculado(g, TRIANGULACION))];
    expect(b.map((n) => [n.x, n.y])).toEqual(a.map((n) => [n.x, n.y]));
    const wmax = Math.max(...a.map((n) => Math.abs(n.w)));
    expect(Math.max(...a.map((n, i) => Math.abs(n.w - b[i]!.w))) / wmax).toBeLessThan(1e-12);
  });

  it("oráculo: con un pilar casi puntual, la flecha a ≥ 1 m es la de Navier con la carga en su huella (≤ 0,6 %)", () => {
    const [x, y, lado] = [2, 1.5, 0.05];
    const placa = { ...placaNavier(LOSA), q: -P / (lado * lado), parche: { x, y, u: lado, v: lado } };
    const w0 = Math.abs(navierMindlin(placa, x, y, 601)[0]);
    const lejos = flechas(calculado(apeoEnPlaca(x, y, lado), TRIANGULACION)).filter((n) => Math.hypot(n.x - x, n.y - y) >= 1);
    expect(lejos.length).toBeGreaterThan(100);
    const e = Math.max(...lejos.map((n) => Math.abs(n.w - navierMindlin(placa, n.x, n.y, 201)[0])));
    expect(e / w0).toBeLessThan(0.006);
  });

  it("congelado: flecha bajo el pilar de 30 × 30 en el centro (huella rígida)", () => {
    const x = calculado(apeoEnPlaca(A / 2, B / 2, 0.3), TRIANGULACION);
    const n = x.r.modelo.nudos.findIndex((v) => v.x === A / 2 && v.y === B / 2 && v.z === 0);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(Math.abs(x.res.u[6 * n + 2]! / -5.51003e-4 - 1)).toBeLessThan(1e-5);
  });

  it("caso realista: planta con diafragma rígido y rejilla, un pilar que apea en el centro de la losa", () => {
    const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const f: ModeloFisico = {
      plantas: [
        { id: "P2", altura: null },
        { id: "P1", altura: 3 },
        { id: "C", tipo: "sotano", altura: 3 },
      ],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
      pilares: [
        ...([[0, 0], [8, 0], [0, 6], [8, 6]] as const).map(([x, y], i) => ({ id: `E${i}`, x, y, desde: "C", hasta: "P2", seccion: "p" })),
        { id: "X", x: 4, y: 3, desde: "P1", hasta: "P2", seccion: "p", base: "ninguno" },
      ],
      losas: [
        { id: "L1", planta: "P1", contorno: rect(0, 0, 8, 6), espesor: 0.25, material: "HA" },
        { id: "L2", planta: "P2", contorno: rect(0, 0, 8, 6), espesor: 0.25, material: "HA" },
      ],
      casos: [{ id: "G" }],
      cargas: [
        { tipo: "superficie", id: "q", caso: "G", planta: "P2", losa: "L2", q: [0, 0, -5] },
        { tipo: "puntual", id: "H", caso: "G", planta: "P2", x: 6, y: 3, F: [10, 0, 0] },
      ],
    };
    // El axil congelado es el de la malla sin las caras de las franjas (fase F); con ellas, la malla
    // cambia y el axil, un 0,5 %. Desde SP-5, la horizontal H va al diafragma sin sembrar su punto: la
    // malla pasa de 360 a 250 nudos (la misma que sin H) y el axil, de −77,767 a −77,523, más cerca
    // del de la triangulación con h = 0,1 (−77,291: 0,30 % frente a 0,62 %)
    // Valores medidos con la cabeza de los pilares empotrada, antes de CY2, y con la zona rígida sólo en
    // la cabeza, antes de LV-d (con la base, el axil cambia un 0,4 %): se comparan con esas opciones
    const x = calculado(f, { franjas: false, empotramientoCabeza: 1, zonaRigidaBase: false });
    expect(x.r.diagnosticos).toEqual([]);
    expect(Math.abs(axil(x.c, "X") / -77.52349033034625 - 1)).toBeLessThan(1e-6);
    const y = calculado(f, { empotramientoCabeza: 1, zonaRigidaBase: false });
    expect(y.r.diagnosticos).toEqual([]);
    expect(Math.abs(axil(y.c, "X") / -77.52349033034625 - 1)).toBeLessThan(0.01);
  });

  it("fuera de la losa sigue siendo un error", () => {
    const r = compilar(apeoEnPlaca(7, 2, 0.3), TRIANGULACION);
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.some((d) => d.codigo === "pilar/arranque-sin-apoyo" && d.ids?.includes("X"))).toBe(true);
  });
});

describe("pilar apeado sobre un muro", () => {
  it("se une por su huella a la cabeza del muro, y su axil es la carga de la cabeza", () => {
    const f: ModeloFisico = {
      plantas: [
        { id: "P1", altura: null, diafragma: "ninguno" },
        { id: "P0", altura: 3 },
        { id: "C", tipo: "sotano", altura: 3 },
      ],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
      muros: [{ id: "M", puntos: [[0, 0], [6, 0]], desde: "C", hasta: "P0", espesor: 0.3, material: "HA" }],
      pilares: [{ id: "X", x: 3, y: 0, desde: "P0", hasta: "P1", seccion: "p", base: "ninguno" }],
      casos: [{ id: "G" }],
      cargas: [{ tipo: "puntual", id: "F", caso: "G", planta: "P1", x: 3, y: 0, F: [0, 0, -P] }],
    };
    const x = calculado(f);
    expect(x.r.diagnosticos).toEqual([]);
    expect(Math.abs(axil(x.c, "X") + P) / P).toBeLessThan(1e-9);
  });
});
