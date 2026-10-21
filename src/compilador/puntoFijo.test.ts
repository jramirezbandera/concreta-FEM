/**
 * Fase PF (`docs/fem3d/punto-fijo.md`): el punto fijo de los pilares, como CYPECAD.
 * - La geometría: el eje de cada tramo, para los nueve puntos, girados y circulares.
 * - Sin punto fijo, o con el centro, el modelo de antes bit a bit; con una sola sección, un punto
 *   fijo es sólo otro modo de dar el eje.
 * - Oráculo a mano: un pilar en ménsula con cambio de sección y la esquina fija, con su modelo
 *   analítico escrito a mano a ≤ 1e-10, y la estática exacta (N·e en el tramo de abajo).
 * - El mismo pórtico con vigas, peso propio y una carga de pilar que pasa por el cambio de sección,
 *   frente a dos pilares, el de encima apeado en el de abajo y unido a su nudo con la misma
 *   excentricidad (la fusión de C1, con ε_snap mayor que la excentricidad): ≤ 1e-10.
 * - Girar o trasladar la planta (el punto fijo va en los ejes de la sección) da lo mismo girado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OPCIONES_MANO } from "../../validacion/c1/mano.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compararModelos } from "../pruebas/compilador.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO } from "../pruebas/constructor.ts";
import { nudosRigidosFuera } from "../pruebas/huellasRigidas.ts";
import { planos, relacionPlano, relacionPlanoC2 } from "../pruebas/metamorficasFisicas.ts";
import { edificioPuntoFijo } from "../pruebas/puntoFijo.ts";
import { hormigon, rectangular } from "../secciones/seccion3D.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import type { CargaFisica, ModeloFisico, OpcionesCompilacion, Pilar, Vec2 } from "./fisico.ts";
import { huellaPilar } from "./geometria2d.ts";
import { ejePilar, PUNTOS_FIJOS, SIGNOS_PUNTO_FIJO } from "./puntoFijo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type Valido = Extract<ResultadoCompilacion, { valido: true }>;
const valido = (r: ResultadoCompilacion): Valido => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
};

describe("PF: el eje de cada tramo", () => {
  const P = { x: 1, y: 2 };
  it("con giro 0, derecha es +X y superior, +Y", () => {
    const m = { h: 0.4, b: 0.3 };
    expect(ejePilar({ ...P }, m)).toEqual([1, 2]);
    expect(ejePilar({ ...P, fijo: "centro" }, m)).toEqual([1, 2]);
    expect(ejePilar({ ...P, fijo: "esquina-inferior-izquierda" }, m)).toEqual([1.2, 2.15]);
    expect(ejePilar({ ...P, fijo: "mitad-derecha" }, m)).toEqual([0.8, 2]);
    expect(ejePilar({ ...P, fijo: "mitad-superior" }, m)).toEqual([1, 1.85]);
    // Sin medidas (un error de validar), el punto tal cual
    expect(ejePilar({ ...P, fijo: "mitad-derecha" }, null)).toEqual([1, 2]);
  });
  it("con giro 90, la derecha es +Y y la superior, −X", () => {
    const [x, y] = ejePilar({ ...P, giro: 90, fijo: "esquina-superior-derecha" }, { h: 0.4, b: 0.3 });
    expect(x).toBeCloseTo(1.15, 15);
    expect(y).toBeCloseTo(1.8, 15);
  });
  it("circular: el cuadrado de lado D", () => {
    expect(ejePilar({ ...P, fijo: "esquina-inferior-izquierda" }, { h: 0.5, b: 0.5 })).toEqual([1.25, 2.25]);
  });
  it("con cualquier giro, el punto fijo es la esquina o el centro de lado de la huella", () => {
    for (const giro of [0, 30, 90, 135, -70]) {
      for (const fijo of PUNTOS_FIJOS) {
        const m = { h: 0.6, b: 0.25 };
        const c = ejePilar({ ...P, giro, fijo }, m);
        const hu = huellaPilar(c[0], c[1], giro, { tipo: "rectangulo", ...m });
        const [u, v] = SIGNOS_PUNTO_FIJO[fijo];
        // «superior» es −y local de la huella
        const X = [c[0] + (u * m.h * hu.ez[0]) / 2 - (v * m.b * hu.ey[0]) / 2, c[1] + (u * m.h * hu.ez[1]) / 2 - (v * m.b * hu.ey[1]) / 2];
        expect(Math.hypot(X[0]! - P.x, X[1]! - P.y)).toBeLessThan(1e-14);
      }
    }
  });
});

const MATERIALES: ModeloFisico["materiales"] = [{ id: "HA", tipo: "hormigon", fck: 25 }];
const SECCIONES: ModeloFisico["secciones"] = [
  { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
  { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
];
const PLANTAS: ModeloFisico["plantas"] = [
  { id: "P2", altura: null },
  { id: "P1", altura: 3 },
  { id: "C", altura: 3.5, tipo: "sotano" },
];

describe("PF: sin punto fijo, el modelo de antes", () => {
  const base = (fijo?: Pilar["fijo"], dx = 0, dy = 0): ModeloFisico => ({
    plantas: PLANTAS,
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: [
      { id: "A", x: dx, y: dy, desde: "C", hasta: "P2", seccion: "p40", giro: 30, ...(fijo ? { fijo } : {}) },
      { id: "B", x: 6 + dx, y: dy, desde: "C", hasta: "P2", seccion: "p40", giro: 30, ...(fijo ? { fijo } : {}) },
    ],
    vigas: ["P1", "P2"].map((p) => ({ id: `V-${p}`, planta: p, puntos: [[dx, dy], [6 + dx, dy]] as const, seccion: "v" })),
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  });
  it("«centro» es lo mismo que nada, bit a bit", () => {
    expect(JSON.stringify(valido(compilar(base("centro"))).modelo)).toBe(JSON.stringify(valido(compilar(base())).modelo));
  });
  it("con una sola sección, un punto fijo es otro modo de dar el eje: el mismo modelo bit a bit", () => {
    const [dx, dy] = ejePilar({ x: 0, y: 0, giro: 30, fijo: "esquina-superior-derecha" }, { h: 0.4, b: 0.4 });
    const conFijo = base("esquina-superior-derecha");
    // Las vigas, por los ejes, en los dos
    conFijo.vigas = ["P1", "P2"].map((p) => ({ id: `V-${p}`, planta: p, puntos: [[dx, dy], [6 + dx, dy]] as const, seccion: "v" }));
    const a = valido(compilar(conFijo)).modelo;
    const b = valido(compilar(base(undefined, dx, dy))).modelo;
    // Los ejes de B salen de 6 + dx en los dos (en `ejePilar`, 6 + du·c − dv·s)
    expect(compararModelos(a, b).u).toBeLessThan(1e-12);
    expect(a.nudos.length).toBe(b.nudos.length);
  });
});

describe("PF: oráculo a mano, ménsula con cambio de sección", () => {
  // 40 × 40 de C a P1 y 30 × 30 de P1 a P2, con la esquina inferior izquierda en (0, 0): ejes en
  // (0,2; 0,2) y (0,15; 0,15). Cabeza libre, sin vigas ni losas (sin zonas rígidas) ni diafragmas.
  const F = { fx: 10, fz: -100 };
  const fisico: ModeloFisico = {
    plantas: PLANTAS.map((p) => ({ ...p, diafragma: "ninguno" as const })),
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: [{ id: "P", x: 0, y: 0, desde: "C", hasta: "P2", seccion: "p40", tramos: [{ planta: "P2", seccion: "p30" }], fijo: "esquina-inferior-izquierda" }],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "puntual", id: "F", caso: "Q", planta: "P2", x: 0.15, y: 0.15, F: [F.fx, 0, F.fz] }],
  };
  const opciones: OpcionesCompilacion = { ...OPCIONES_MANO, empotramientoCabeza: 1 };
  const r = valido(compilar(fisico, opciones));

  it("el modelo analítico es el escrito a mano", () => {
    const HA = hormigon(25);
    const m = new Constructor();
    const n0 = m.nudo(0.2, 0.2, -3.5);
    const n1 = m.nudo(0.2, 0.2, 0);
    const n2 = m.nudo(0.15, 0.15, 3);
    m.barra(n0, n1, rectangular(0.4, 0.4, HA), [1, 0, 0]);
    m.barra(n1, n2, rectangular(0.3, 0.3, HA), [1, 0, 0], { offsets: { i: [-0.05, -0.05, 0] } });
    m.apoyo(n0, EMPOTRADO);
    m.caso("Q", [carga(n2, F)]);
    const c = compararModelos(r.modelo, m.modelo());
    expect(c.nBarras).toBe(2);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });

  it("la estática: la base lleva N·e, y el tramo de abajo, el momento de la excentricidad", () => {
    const [caso] = casosValidos(calcular(r.modelo, { solver: "perfil" }));
    const nb = r.mapeo.nudosPilar["P@C"]!;
    const R = caso!.reacciones.subarray(6 * nb, 6 * nb + 6);
    // r × F desde la base (0,2; 0,2; −3,5) hasta (0,15; 0,15; 3): (5, 60, 0,5); la reacción, al revés
    const esperado = [-F.fx, 0, -F.fz, -5, -60, -0.5];
    for (let i = 0; i < 6; i++) expect(R[i]).toBeCloseTo(esperado[i]!, 9);
    // En la cabeza del tramo de abajo (z = 0), el momento de la carga respecto a su eje, con
    // r = (−0,05; −0,05; 3): (5, 30 − 5, 0,5). Los signos de los esfuerzos, los del oráculo a mano;
    // aquí, la flexión, la torsión y el axil por su valor
    const b = r.modelo.barras!.findIndex((x) => x.id === "P:P1");
    const e = caso!.esfuerzosBarras.subarray(12 * b, 12 * b + 12);
    expect(Math.hypot(e[10]!, e[11]!)).toBeCloseTo(Math.hypot(5, 25), 9);
    expect(Math.abs(e[9]!)).toBeCloseTo(0.5, 9);
    expect(Math.abs(e[6]!)).toBeCloseTo(100, 9);
  });

  it("la hipótesis nombra el pilar", () => {
    expect(r.hipotesis.some((h) => h.includes("punto fijo") && h.includes("(P)"))).toBe(true);
  });
});

/** Pórtico de dos pilares con cambio de sección en P1, vigas, peso propio, viento y una carga de pilar entera. */
function portico(): ModeloFisico {
  const cargas: CargaFisica[] = [
    { tipo: "viga", id: "q", caso: "Q", viga: "V-P2", ejes: "global", q: [0, 0, -12] },
    { tipo: "puntual", id: "H", caso: "Q", planta: "P2", x: 3, y: 0.15, F: [15, 4, 0] },
    { tipo: "pilar", id: "w", caso: "Q", pilar: "A", ejes: "global", q: [0, 3, 0], qb: [2, 1, 0], desde: 1, hasta: 5.5 },
  ];
  return {
    plantas: PLANTAS,
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P2", seccion: "p40", tramos: [{ planta: "P2", seccion: "p30" }], fijo: "esquina-inferior-izquierda" },
      { id: "B", x: 6, y: 0, desde: "C", hasta: "P2", seccion: "p40", tramos: [{ planta: "P2", seccion: "p30" }], fijo: "mitad-inferior" },
    ],
    vigas: [
      { id: "V-P1", planta: "P1", puntos: [[0.2, 0.2], [6, 0.2]], seccion: "v" },
      { id: "V-P2", planta: "P2", puntos: [[0.15, 0.15], [6, 0.15]], seccion: "v" },
    ],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas,
  };
}

describe("PF: lo mismo que dos pilares unidos con la excentricidad (la fusión de C1)", () => {
  it("pórtico con vigas, diafragmas, peso propio y una carga de pilar que pasa por el cambio de sección", () => {
    const f = portico();
    // Dos pilares por cada uno: A1 de C a P1 en el eje de 40 y A2 de P1 a P2 en el de 30, apeado; la
    // carga de pilar, partida en P1 (z = 3,5 desde la base)
    const ejes: Record<string, [Vec2, Vec2]> = { A: [[0.2, 0.2], [0.15, 0.15]], B: [[6, 0.2], [6, 0.15]] };
    const dos: ModeloFisico = {
      ...f,
      pilares: f.pilares!.flatMap((p) => [
        { id: `${p.id}1`, x: ejes[p.id]![0][0], y: ejes[p.id]![0][1], desde: "C", hasta: "P1", seccion: "p40" },
        { id: `${p.id}2`, x: ejes[p.id]![1][0], y: ejes[p.id]![1][1], desde: "P1", hasta: "P2", seccion: "p30", base: "ninguno" as const },
      ]),
      cargas: f.cargas!.flatMap((c): CargaFisica[] =>
        c.tipo !== "pilar"
          ? [c]
          : [
              // De s = 1 a 5,5, de (0, 3) a (2, 1): en s = 3,5, a 5/9, (10/9, 17/9)
              { ...c, id: "w1", pilar: "A1", qb: [10 / 9, 17 / 9, 0], hasta: 3.5 },
              { ...c, id: "w2", pilar: "A2", q: [10 / 9, 17 / 9, 0], desde: 0, hasta: 2 },
            ],
      ),
    };
    // ε_snap mayor que la excentricidad (7 cm en A, 5 en B) para que C1 los funda
    const op: OpcionesCompilacion = { epsSnap: 0.1 };
    const a = valido(compilar(f, op));
    const b = valido(compilar(dos, op));
    expect(b.diagnosticos.filter((d) => d.codigo === "topologia/fusion")).toHaveLength(2);
    expect(a.diagnosticos.some((d) => d.codigo === "topologia/fusion")).toBe(false);
    const c = compararModelos(a.modelo, b.modelo);
    expect(c.nBarras).toBe(b.modelo.barras!.length);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });
});

describe("PF: girar o trasladar la planta", () => {
  it.each(planos().map((p) => [p.nombre, p.t] as const))("%s", (_n, t) => {
    const r = relacionPlano(portico(), t);
    expect(r.u).toBeLessThan(1e-9);
    expect(r.reacciones).toBeLessThan(1e-9);
    expect(r.barras).toBeLessThan(1e-9);
  });
});

describe("PF: losa plana con la fachada de punto fijo (40 × 40 hasta N1 y 30 × 30 encima, la cara exterior en el borde)", () => {
  const f = edificioPuntoFijo();
  const r = valido(compilar(f));

  it("el nudo de cada planta, en el eje del tramo que llega desde abajo; en la base, en el del de encima", () => {
    const secc = { p40: { h: 0.4, b: 0.4 }, p30: { h: 0.3, b: 0.3 } } as const;
    for (const p of f.pilares!) {
      for (const [planta, s] of [["C", "p40"], ["N1", "p40"], ["N2", "p30"], ["N3", "p30"]] as const) {
        const n = r.modelo.nudos[r.mapeo.nudosPilar[`${p.id}@${planta}`]!]!;
        const [x, y] = ejePilar(p, secc[s]);
        expect([n.x, n.y], `${p.id}@${planta}`).toEqual([x, y]);
      }
    }
  });

  it("los nudos rígidos de la losa son los de la huella de ese tramo (HR), y la cara exterior de la fachada es el borde", () => {
    expect(nudosRigidosFuera(f, r).flatMap((x) => x.nudos)).toHaveLength(0);
    // Ningún nudo de la losa fuera de su contorno [0, 10]²
    for (const n of r.modelo.nudos) {
      expect(n.x).toBeGreaterThanOrEqual(-1e-12);
      expect(n.y).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("calcula, con el equilibrio en todos los casos", () => {
    const c = calcular(r.modelo);
    expect(c.valido).toBe(true);
    for (const x of casosValidos(c)) {
      expect(x.equilibrio.fuerzas).toBeLessThan(1e-9);
      expect(x.equilibrio.momentos).toBeLessThan(1e-9);
    }
  });

  it.each(planos().map((p) => [p.nombre, p.t] as const))("%s: la misma malla y los resultados transformados", (_n, t) => {
    const e = relacionPlanoC2(f, t);
    expect(e.mismaMalla).toBe(true);
    expect(e.u).toBeLessThan(1e-9);
    expect(e.reacciones).toBeLessThan(1e-9);
  });
});
