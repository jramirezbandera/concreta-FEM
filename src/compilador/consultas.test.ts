/**
 * C5.4: consultas por objeto físico (criterio 5). Cada consulta da lo mismo que `EsfuerzosPiezas`,
 * `Cortes` o los resultados del motor llamados a mano; las unidades y los signos se prueban con una
 * ménsula y un pilar a mano; una combinación es la de sus casos; las envolventes no pierden el
 * máximo; y lo que no existe da su diagnóstico sin lanzar (criterio 6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generarCombinaciones, type CasoCarga } from "../combinaciones/generador.ts";
import { calcular } from "../motor/calcular.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { proponerBandas } from "./bandas.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import { combinar, envolvente, factoresCaso } from "./envolventes.ts";
import type { ModeloFisico, OpcionesCompilacion, Pilar, Vec2 } from "./fisico.ts";
import { EsfuerzosPiezas } from "./resultados.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type Valido = Extract<ResultadoCompilacion, { valido: true }>;

function preparar(f: ModeloFisico, op: OpcionesCompilacion = {}): { r: Valido; casos: ResultadoCaso[]; c: Consultas } {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  return { r, casos, c: new Consultas(f, r, casos, op) };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const base = (extra: Partial<ModeloFisico>): ModeloFisico => ({
  plantas: [
    { id: "P1", altura: null, diafragma: "ninguno" },
    { id: "C", tipo: "sotano", altura: 3 },
  ],
  materiales: [{ id: "HA", tipo: "hormigon", fck: 25, peso: 0 }],
  secciones: [
    { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.4 },
  ],
  casos: [{ id: "G" }, { id: "Q" }],
  ...extra,
});

describe("unidades y signos a mano (C5, criterio 5)", () => {
  it("pilar en ménsula con H y P en la cabeza: N = −P, Vz = H, My = H·L en la base (compresión de la cara +z)", () => {
    const [H, P, L] = [12, 300, 3];
    // giro 0: el canto h (z local) según +X; H según +X
    const f = base({
      pilares: [{ id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p" }],
      cargas: [{ tipo: "puntual", id: "h", caso: "G", planta: "P1", x: 0, y: 0, F: [H, 0, -P] }],
    });
    const { c } = preparar(f, { factorZonaRigida: 0 });
    const t = c.pilar("A");
    expect(t.valido).toBe(true);
    if (!t.valido) return;
    expect(t.valor).toHaveLength(1);
    const [tr] = t.valor;
    expect(tr).toMatchObject({ planta: "P1", plantaBase: "C", longitud: L, seccion: "p", giro: 0 });
    const [N, Vy, Vz, T, My, Mz] = tr!.base.esfuerzos.subarray(0, 6);
    expect(N).toBeCloseTo(-P, 9);
    expect(Vz).toBeCloseTo(H, 9);
    expect(My).toBeCloseTo(H * L, 9);
    for (const x of [Vy!, T!, Mz!]) expect(Math.abs(x)).toBeLessThan(1e-9);
    // en la cabeza, el momento es nulo; y el caso Q no tiene carga
    expect(Math.abs(tr!.cabeza.esfuerzos[4]!)).toBeLessThan(1e-9);
    expect(Math.abs(tr!.base.esfuerzos[6 + 4]!)).toBeLessThan(1e-12);
  });

  it("ménsula de viga empotrada en un apoyo con P en la punta: un vano en voladizo, My = −P·L y Vz = −P en el empotramiento", () => {
    const [P, L] = [20, 3];
    const f = base({
      plantas: [{ id: "P1", altura: null, diafragma: "ninguno" }],
      vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [L, 0]], seccion: "v" }],
      apoyos: [{ id: "E", planta: "P1", x: 0, y: 0, coartados: [true, true, true, true, true, true] }],
      cargas: [{ tipo: "puntual", id: "punta", caso: "G", planta: "P1", x: L, y: 0, F: [0, 0, -P] }],
    });
    const { c } = preparar(f);
    const v = c.viga("V");
    expect(v.valido).toBe(true);
    if (!v.valido) return;
    expect(v.valor.apoyos).toEqual([{ objeto: "E", tipo: "apoyo", s: 0, caras: [0, 0] }]);
    expect(v.valor.vanos).toEqual([{ desde: 0, hasta: L, apoyoInicio: v.valor.apoyos[0], apoyoFin: null, torsionEquilibrio: false }]);
    expect(v.valor.axilSinValor).toBe(false);
    const e = c.vano("V", 0, factoresCaso(0, 2));
    expect(e.valido).toBe(true);
    if (!e.valido) return;
    expect(e.valor.inicio.esfuerzos[4]).toBeCloseTo(-P * L, 9);
    expect(e.valor.inicio.esfuerzos[2]).toBeCloseTo(-P, 9);
    expect(e.valor.minMy).toMatchObject({ s: 0, valor: e.valor.inicio.esfuerzos[4] });
    // sin sismo, sus esfuerzos son los concomitantes de la sección del empotramiento, y la amplitud del sismo, nula
    expect(Array.from(e.valor.minMy.partes.estatica)).toEqual(Array.from(e.valor.inicio.esfuerzos));
    expect(Array.from(e.valor.minMy.partes.sismo)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e.valor.maxMy.valor).toBeCloseTo(0, 9);
    // la reacción del empotramiento: Fz = P y My = −P·L (global, respecto al nudo: equilibra (L, 0, 0) × (0, 0, −P) = +P·L)
    const R = c.reacciones("E");
    expect(R.valido).toBe(true);
    if (!R.valido) return;
    expect(R.valor.nudos).toBe(1);
    expect(R.valor.resultante[2]).toBeCloseTo(P, 9);
    expect(R.valor.resultante[4]).toBeCloseTo(-P * L, 9);
  });
});

describe("vigas por vanos (C5, criterio 5)", () => {
  const q = 10;
  // Viga continua de dos vanos de 5 m sobre tres pilares de 30 × 40 (canto según X), con una ménsula de 1,5 m
  const f = base({
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    pilares: [0, 5, 10].map((x): Pilar => ({ id: `P${x}`, x, y: 0, desde: "C", hasta: "P1", seccion: "p" })),
    vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [11.5, 0]], seccion: "v" }],
    cargas: [
      { tipo: "viga", id: "g", caso: "G", viga: "V", ejes: "global", q: [0, 0, -q] },
      { tipo: "viga", id: "qq", caso: "Q", viga: "V", ejes: "global", q: [0, 0, -q], desde: 0, hasta: 5 },
    ],
  });
  let c: Consultas;
  let ep: EsfuerzosPiezas;
  beforeAll(() => {
    const p = preparar(f);
    c = p.c;
    ep = new EsfuerzosPiezas(p.r.modelo, p.r.mapeo, p.casos);
  });

  it("apoyos en los pilares con sus caras (±0,2: el canto de 40 va según X) y tres vanos: dos entre caras y la ménsula", () => {
    const v = c.viga("V");
    expect(v.valido).toBe(true);
    if (!v.valido) return;
    expect(v.valor.apoyos.map((a) => [a.objeto, a.tipo, a.s, a.caras])).toEqual([
      ["P0", "pilar", 0, [-0.2, 0.2]],
      ["P5", "pilar", 5, [4.8, 5.2]],
      ["P10", "pilar", 10, [9.8, 10.2]],
    ]);
    expect(v.valor.vanos.map((x) => [x.desde, x.hasta, x.apoyoInicio?.objeto ?? null, x.apoyoFin?.objeto ?? null])).toEqual([
      [0.2, 4.8, "P0", "P5"],
      [5.2, 9.8, "P5", "P10"],
      [10.2, 11.5, "P10", null],
    ]);
    // en el plano del diafragma rígido de P1, el axil no tiene valor (C1-d)
    expect(v.valor.axilSinValor).toBe(true);
  });

  it("en las caras, lo mismo que EsfuerzosPiezas a mano (bit a bit); los extremos del vano, exactos frente a un muestreo denso", () => {
    const v = c.viga("V");
    if (!v.valido) throw new Error();
    for (const [i, vano] of v.valor.vanos.entries())
      for (let k = 0; k < 2; k++) {
        const e = c.vano("V", i, factoresCaso(k, 2));
        if (!e.valido) throw new Error();
        expect(Array.from(e.valor.inicio.esfuerzos)).toEqual(ep.en("V", k, vano.desde, 1));
        expect(Array.from(e.valor.fin.esfuerzos)).toEqual(ep.en("V", k, vano.hasta, -1));
        let [mx, mn] = [-Infinity, Infinity];
        for (let j = 0; j <= 2000; j++) {
          const s = vano.desde + ((vano.hasta - vano.desde) * j) / 2000;
          const m = ep.en("V", k, s)![4]!;
          mx = Math.max(mx, m);
          mn = Math.min(mn, m);
        }
        expect(e.valor.maxMy.valor).toBeGreaterThanOrEqual(mx - 1e-9);
        expect(e.valor.minMy.valor).toBeLessThanOrEqual(mn + 1e-9);
        expect(e.valor.maxMy.valor - mx).toBeLessThan(1e-4 * Math.abs(mx) + 1e-9);
        expect(mn - e.valor.minMy.valor).toBeLessThan(1e-4 * Math.abs(mn) + 1e-9);
      }
  });

  it("una combinación: las caras son la combinación de los casos, y el máximo, el del diagrama combinado (no la combinación de los máximos)", () => {
    const f2 = Float64Array.from([1.35, 1.5]);
    const e = c.vano("V", 0, f2);
    const [a, b] = [c.vano("V", 0, factoresCaso(0, 2)), c.vano("V", 0, factoresCaso(1, 2))];
    if (!e.valido || !a.valido || !b.valido) throw new Error();
    for (let q2 = 0; q2 < 6; q2++) expect(e.valor.inicio.esfuerzos[q2]).toBeCloseTo(1.35 * a.valor.inicio.esfuerzos[q2]! + 1.5 * b.valor.inicio.esfuerzos[q2]!, 9);
    let mx = -Infinity;
    for (let j = 0; j <= 2000; j++) {
      const s = 0.2 + (4.6 * j) / 2000;
      mx = Math.max(mx, 1.35 * ep.en("V", 0, s)![4]! + 1.5 * ep.en("V", 1, s)![4]!);
    }
    expect(Math.abs(e.valor.maxMy.valor - mx)).toBeLessThan(1e-4 * mx);
    // el máximo combinado no es la combinación de los máximos (están en otro sitio)
    expect(e.valor.maxMy.valor).toBeLessThan(1.35 * a.valor.maxMy.valor + 1.5 * b.valor.maxMy.valor - 1e-6);
  });

  it("el diagrama de la pieza pasa por sus estaciones con los mismos valores", () => {
    const d = c.diagrama("V", factoresCaso(0, 2));
    if (!d.valido) throw new Error();
    for (const e of d.valor.filter((_, i) => i % 7 === 0)) expect(Array.from(e.derecha)).toEqual(ep.en("V", 0, e.s, 1)!.map((x, i) => (Math.abs(x - e.derecha[i]!) < 1e-9 ? e.derecha[i]! : x)));
  });

  it("reacciones de las bases de los pilares: su suma equilibra la carga (≤ 1e-9)", () => {
    for (let k = 0; k < 2; k++) {
      let Fz = 0;
      for (const p of ["P0", "P5", "P10"]) {
        const R = c.reacciones(p);
        if (!R.valido) throw new Error();
        Fz += R.valor.resultante[6 * k + 2]!;
      }
      const carga = k === 0 ? q * 11.5 : q * 5;
      expect(Math.abs(Fz - carga) / carga).toBeLessThan(1e-9);
    }
  });
});

describe("losa plana: plantas, flechas, reacciones, bandas y combinaciones (C5, criterio 5)", () => {
  const Q = 5;
  function losaPlana(): ModeloFisico {
    const pilares: Pilar[] = [];
    for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
    const f: ModeloFisico = {
      plantas: [
        { id: "P1", altura: null },
        { id: "C", tipo: "sotano", altura: 3 },
      ],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
      pilares,
      losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 18, 15), espesor: 0.25, material: "HA" }],
      casos: [
        { id: "G", pesoPropio: true, accion: { tipo: "G" } },
        { id: "Q", accion: { tipo: "Q", psi: { psi0: 0.7, psi1: 0.5, psi2: 0.3 } } },
        { id: "W", accion: { tipo: "W", direccion: "X", signo: 1, psi: { psi0: 0.6, psi1: 0.5, psi2: 0 } } },
      ],
      cargas: [
        { tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -Q] },
        ...pilares.map((p) => ({ tipo: "pilar" as const, id: `w-${p.id}`, caso: "W", pilar: p.id, ejes: "global" as const, q: [2, 0, 0] as const })),
      ],
    };
    return { ...f, bandas: proponerBandas(f).bandas };
  }
  let c: Consultas;
  let casos: ResultadoCaso[];
  let fisico: ModeloFisico;
  beforeAll(() => {
    fisico = losaPlana();
    const p = preparar(fisico, { tamanoMalla: 0.5 });
    c = p.c;
    casos = p.casos;
  });

  it("planta: el maestro del diafragma da el desplazamiento de sus casos; desplomes de los 16 pilares con el mayor", () => {
    const p = c.planta("P1");
    if (!p.valido) throw new Error();
    expect(p.valor.cota).toBe(0);
    expect(p.valor.maestro).not.toBeNull();
    const ux = p.valor.maestro!.u[3 * 2]!;
    expect(ux).toBeGreaterThan(0);
    const d = c.desplomes("P1", factoresCaso(2, 3));
    if (!d.valido) throw new Error();
    expect(d.valor.pilares).toHaveLength(16);
    expect(d.valor.altura).toBe(3);
    // sin giro de planta (simétrico en Y), todos se desplazan lo del maestro
    for (const x of d.valor.pilares) expect(Math.abs(x.dx - ux) / ux).toBeLessThan(1e-6);
    expect(d.valor.maximo!.relativo).toBe(Math.max(...d.valor.pilares.map((x) => x.relativo)));
    // la planta más baja no tiene desplome
    expect(c.desplomes("C", factoresCaso(0, 3)).valido).toBe(false);
  });

  it("flechas: la mayor es la uz más negativa de la losa y hay 9 recuadros con su flecha relativa", () => {
    const f = c.flechas("L", factoresCaso(1, 3));
    if (!f.valido) throw new Error();
    const r = c.mapeo.losas!.L!.flatMap((i) => [...c.modelo.laminas![i]!.nudos]);
    const minUz = Math.min(...r.map((n) => casos[1]!.u[6 * n + 2]!));
    expect(f.valor.maxima.flecha).toBeCloseTo(-minUz, 12);
    expect(f.valor.recuadros).toHaveLength(9);
    // por simetría, los cuatro recuadros de esquina tienen la misma flecha relativa (a la precisión de la malla)
    const esquinas = [0, 2, 6, 8].map((i) => f.valor.recuadros[i]!.maxima!.flecha);
    for (const x of esquinas) expect(Math.abs(x - esquinas[0]!) / esquinas[0]!).toBeLessThan(0.01);
    // el central, menos que los de esquina (continuidad por los cuatro lados)
    expect(f.valor.recuadros[4]!.maxima!.flecha).toBeLessThan(esquinas[0]!);
    expect(f.valor.recuadros[4]!.pilares).toEqual(["P6-5", "P12-5", "P6-10", "P12-10"]);
  });

  it("reacciones: la suma de las de los 16 pilares equilibra el peso y la sobrecarga (≤ 1e-9)", () => {
    let [G, Qz] = [0, 0];
    for (const p of fisico.pilares!) {
      const R = c.reacciones(p.id);
      if (!R.valido) throw new Error();
      G += R.valor.resultante[2]!;
      Qz += R.valor.resultante[6 + 2]!;
    }
    expect(Math.abs(Qz - Q * 18 * 15) / (Q * 18 * 15)).toBeLessThan(1e-9);
    expect(G).toBeGreaterThan(0);
  });

  it("bandas: las estaciones de C5.2 por la consulta", () => {
    const b = c.banda("L:1:P2");
    expect(b.valido).toBe(true);
    if (b.valido) expect(b.valor.length).toBeGreaterThan(5);
  });

  it("combinaciones: las del generador con las acciones de los casos, y una envolvente que no pierde el máximo", () => {
    const k = c.combinaciones({ situaciones: ["ELU-PT"] });
    if (!k.valido) throw new Error(k.diagnosticos[0]?.mensaje);
    const directas = generarCombinaciones(fisico.casos.map((x) => ({ ...x.accion!, id: x.id }) as CasoCarga), { situaciones: ["ELU-PT"] });
    // las del generador, tal cual; las de las consultas llevan el factor del viento por su γz del segundo orden (SO)
    const generadas = c.combinacionesGeneradas({ situaciones: ["ELU-PT"] });
    if (!generadas.valido) throw new Error(generadas.diagnosticos[0]?.mensaje);
    expect(generadas.valor.map((x) => Array.from(x.factores))).toEqual(directas.map((x) => Array.from(x.factores)));
    const kV = fisico.casos.findIndex((x) => x.accion?.tipo === "W");
    k.valor.forEach((x, i) => {
      const d = directas[i]!;
      d.factores.forEach((f, j) => {
        if (j === kV && f) {
          expect(x.amplificacion?.length).toBe(1);
          expect(x.factores[j]!).toBeGreaterThan(f);
          expect(Math.abs(x.factores[j]! - f * x.amplificacion![0]!.coeficiente)).toBeLessThan(1e-12);
        } else expect(x.factores[j]).toBe(f);
      });
    });
    // envolvente de la base de un pilar de esquina frente a la fuerza bruta
    const t = c.pilar("P0-0");
    if (!t.valido) throw new Error();
    const v = t.valor[0]!.base.esfuerzos;
    const e = envolvente(v, 6, k.valor.map((x) => x.factores));
    for (let q = 0; q < 6; q++) {
      const todos = k.valor.map((x) => combinar(v, 6, x.factores)[q]!);
      expect(e.max[q]).toBe(Math.max(...todos));
      expect(e.min[q]).toBe(Math.min(...todos));
      expect(todos[e.combinacionMax[q]!]).toBe(e.max[q]);
    }
  });
});

describe("envolventes", () => {
  it("un NaN no gobierna; si todo es NaN, la envolvente es NaN con índice −1", () => {
    const porCaso = Float64Array.from([1, Number.NaN, -2, Number.NaN]);
    const e = envolvente(porCaso, 2, [Float64Array.from([1, 0]), Float64Array.from([0, 1]), Float64Array.from([1, 1])]);
    expect(Array.from(e.max)).toEqual([1, Number.NaN]);
    expect(Array.from(e.min)).toEqual([-2, Number.NaN]);
    expect(Array.from(e.combinacionMax)).toEqual([0, -1]);
    expect(Array.from(e.combinacionMin)).toEqual([1, -1]);
  });
});

describe("viguetas (C5, criterio 5)", () => {
  it("un paño entre dos vigas sobre cuatro pilares: cada vigueta tiene un vano entre las caras de las vigas", () => {
    const f = base({
      secciones: [
        { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
        { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "T", material: "HA", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 },
      ],
      pilares: [
        [0, 0],
        [6, 0],
        [0, 5],
        [6, 5],
      ].map(([x, y]): Pilar => ({ id: `P${x}-${y}`, x: x!, y: y!, desde: "C", hasta: "P1", seccion: "p" })),
      vigas: [
        { id: "VA", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" },
        { id: "VB", planta: "P1", puntos: [[0, 5], [6, 5]], seccion: "v" },
      ],
      panos: [{ id: "F", planta: "P1", contorno: rect(0, 0, 6, 5), direccion: 90, intereje: 0.7, seccion: "T", pp: 3 }],
      casos: [{ id: "G", pesoPropio: true }],
    });
    const { c, r } = preparar(f);
    const ids = r.mapeo.panos!.F!;
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      const v = c.viga(id);
      if (!v.valido) throw new Error(v.diagnosticos[0]?.mensaje);
      expect(v.valor.tipo).toBe("vigueta");
      expect(v.valor.apoyos.map((a) => [a.objeto, a.tipo])).toEqual([
        ["VA", "viga"],
        ["VB", "viga"],
      ]);
      expect(v.valor.vanos).toHaveLength(1);
      expect(v.valor.vanos[0]!.desde).toBeCloseTo(0.15, 9);
      expect(v.valor.vanos[0]!.hasta).toBeCloseTo(4.85, 9);
      const e = c.vano(id, 0, factoresCaso(0, 1));
      if (!e.valido) throw new Error();
      expect(e.valor.maxMy.valor).toBeGreaterThan(0);
    }
  });
});

describe("lo que no existe y los factores mal dados (C5, criterio 6)", () => {
  const f = base({
    pilares: [{ id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p" }],
    cargas: [{ tipo: "puntual", id: "h", caso: "G", planta: "P1", x: 0, y: 0, F: [1, 0, -1] }],
  });
  let c: Consultas;
  beforeAll(() => {
    c = preparar(f).c;
  });

  it("cada consulta a un id que no existe da consulta/no-existe con el id, sin lanzar", () => {
    const respuestas = [c.pilar("X"), c.viga("X"), c.viga("A"), c.vano("X", 0, [1, 0]), c.diagrama("X", [1, 0]), c.banda("X"), c.machones("X"), c.dinteles("X"), c.reacciones("X"), c.planta("X"), c.desplomes("X", [1, 0]), c.flechas("X", [1, 0])];
    for (const r of respuestas) {
      expect(r.valido).toBe(false);
      expect(r.diagnosticos[0]).toMatchObject({ codigo: "consulta/no-existe", severidad: "error" });
      expect(r.diagnosticos[0]!.ids).toContain(r === respuestas[2] ? "A" : "X");
    }
  });

  it("unos factores que no son uno por caso, o no finitos, dan consulta/factores", () => {
    for (const fs of [[1], [1, 0, 0], [1, Number.NaN]]) {
      const r = c.diagrama("A", fs);
      expect(r.valido).toBe(false);
      expect(r.diagnosticos[0]!.codigo).toBe("consulta/factores");
    }
  });

  it("sin la acción de los casos no hay combinaciones (consulta/sin-accion, con los casos)", () => {
    const r = c.combinaciones();
    expect(r.valido).toBe(false);
    expect(r.diagnosticos[0]).toMatchObject({ codigo: "consulta/sin-accion", ids: ["G", "Q"] });
  });

  it("un pilar apeado no tiene reacciones (consulta/sin-reaccion)", () => {
    const g = base({
      pilares: [
        { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p" },
        { id: "B", x: 4, y: 0, desde: "C", hasta: "P1", seccion: "p" },
      ],
      vigas: [{ id: "V", planta: "P1", puntos: [[0, 0], [4, 0]], seccion: "v" }],
    });
    const plantas = [{ id: "P2", altura: null }, { id: "P1", altura: 3 }, g.plantas[1]!];
    const h = { ...g, plantas, pilares: [...g.pilares!, { id: "Ap", x: 2, y: 0, desde: "P1", hasta: "P2", seccion: "p", base: "ninguno" as const }] };
    const { c: c2 } = preparar(h);
    expect(c2.reacciones("Ap")).toMatchObject({ valido: false, diagnosticos: [{ codigo: "consulta/sin-reaccion" }] });
  });
});

describe("acciones de los casos no válidas (C5, criterio 6)", () => {
  it("cada defecto es un error del caso, sin lanzar", () => {
    const g = base({ pilares: [{ id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p" }] });
    const mal: unknown[] = [
      "G",
      { tipo: "X" },
      { tipo: "Q" }, // sin ψ
      { tipo: "Q", psi: { psi0: 2, psi1: 0, psi2: 0 } },
      { tipo: "E" }, // sin dirección
      { tipo: "N", direccion: "X", signo: 1, derivadoDe: "nada" },
      { tipo: "N", direccion: "X", signo: 1, derivadoDe: "Q" }, // Q sin acción no es un caso vertical
      { tipo: "G", derivadoDe: "Q" },
      { tipo: "G", duracion: "eterna" },
      { tipo: "W", psi: { psi0: 0.6, psi1: 0.5, psi2: 0 }, direccion: "Z" },
    ];
    for (const accion of mal) {
      const r = compilar({ ...g, casos: [{ id: "G", accion } as never, { id: "Q" }] });
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.some((d) => d.ids?.includes("G"))).toBe(true);
    }
    // una familia con dos tipos de acción
    const r = compilar({ ...g, casos: [{ id: "G", accion: { tipo: "G", familia: "f" } }, { id: "Q", accion: { tipo: "Q", familia: "f", psi: { psi0: 0.7, psi1: 0.5, psi2: 0.3 } } }] });
    expect(r.valido).toBe(false);
  });
});

describe("reacciones por objeto con nudos compartidos (A2-47)", () => {
  // Pórtico de 4 pilares de 6 × 5 con vigas y losa en P1; peso propio, uso y viento
  const portico = (): ModeloFisico => ({
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: (
      [
        [0, 0],
        [6, 0],
        [0, 5],
        [6, 5],
      ] as const
    ).map(([x, y], k) => ({ id: `C${k + 1}`, x, y, desde: "P0", hasta: "P1", seccion: "p" })),
    vigas: [
      { id: "VA", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" },
      { id: "VB", planta: "P1", puntos: [[0, 5], [6, 5]], seccion: "v" },
      { id: "V1", planta: "P1", puntos: [[0, 0], [0, 5]], seccion: "v" },
      { id: "V2", planta: "P1", puntos: [[6, 0], [6, 5]], seccion: "v" },
    ],
    losas: [{ id: "L", planta: "P1", material: "H", espesor: 0.2, contorno: rect(0, 0, 6, 5) }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "W" }],
    cargas: [
      { tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -3] },
      { tipo: "puntual", id: "w", caso: "W", planta: "P1", x: 3, y: 2, F: [30, 12, 0] },
    ],
  });
  /** Σ por objetos frente a Σ del motor, por caso y componente (fuerzas y momentos respecto al origen). */
  const comprobar = (f: ModeloFisico, compartidos: Record<string, number>) => {
    const { r, casos, c } = preparar(f);
    const ids = [...(f.pilares ?? []).map((p) => p.id), ...(f.muros ?? []).map((m) => m.id), ...(f.apoyosLineales ?? []).map((a) => a.id)];
    for (let k = 0; k < casos.length; k++) {
      const tot = [0, 0, 0, 0, 0, 0];
      r.modelo.nudos.forEach((nd, n) => {
        const R = casos[k]!.reacciones;
        const F = [R[6 * n]!, R[6 * n + 1]!, R[6 * n + 2]!];
        const M = [R[6 * n + 3]! + nd.y * F[2]! - nd.z * F[1]!, R[6 * n + 4]! + nd.z * F[0]! - nd.x * F[2]!, R[6 * n + 5]! + nd.x * F[1]! - nd.y * F[0]!];
        [...F, ...M].forEach((v, a) => (tot[a]! += v));
      });
      const obj = [0, 0, 0, 0, 0, 0];
      for (const id of ids) {
        const x = c.reacciones(id);
        if (!x.valido) throw new Error(id);
        const R = x.valor.resultante.subarray(6 * k, 6 * k + 6);
        const [px, py, pz] = x.valor.punto;
        const M = [R[3]! + py * R[2]! - pz * R[1]!, R[4]! + pz * R[0]! - px * R[2]!, R[5]! + px * R[1]! - py * R[0]!];
        [R[0]!, R[1]!, R[2]!, ...M].forEach((v, a) => (obj[a]! += v));
        if (k === 0) expect(x.valor.compartidos ?? 0, id).toBe(compartidos[id] ?? 0);
        if (k === 0) expect(x.diagnosticos.some((d) => d.codigo === "consulta/reaccion-compartida"), id).toBe((compartidos[id] ?? 0) > 0);
      }
      const esc = Math.max(1, ...tot.map(Math.abs));
      for (let a = 0; a < 6; a++) expect(Math.abs(obj[a]! - tot[a]!), `caso ${k}, componente ${a}`).toBeLessThan(1e-9 * esc);
    }
  };

  it("una losa en la planta baja sobre dos apoyos lineales que pasan por las bases de los pilares: la base es del pilar", () => {
    const f = portico();
    f.losas = [...f.losas!, { id: "L0", planta: "P0", material: "H", espesor: 0.3, contorno: rect(0, 0, 6, 5) }];
    f.apoyosLineales = [
      { id: "AL0", planta: "P0", puntos: [[0, 0], [6, 0]], coartados: [false, false, true, false, false, false] },
      { id: "AL5", planta: "P0", puntos: [[0, 5], [6, 5]], coartados: [false, false, true, false, false, false] },
    ];
    f.cargas = [...f.cargas!, { tipo: "superficie", id: "q0", caso: "Q", planta: "P0", losa: "L0", q: [0, 0, -5] }];
    // Antes: Σ objetos 828,2 kN frente a 468,0 en G (cada base, en su pilar y en su apoyo lineal)
    comprobar(f, { C1: 1, C2: 1, C3: 1, C4: 1, AL0: 2, AL5: 2 });
  }, 60_000);

  it("dos casos Q con el mismo ψ por su nombre van juntos en las combinaciones (A2-6)", () => {
    const f = portico();
    f.casos = [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
      { id: "W", accion: { tipo: "Q", psi: "uso-A" } },
    ];
    const { c } = preparar(f);
    const r = c.combinacionesGeneradas({ situaciones: ["ELU-PT"] });
    if (!r.valido) throw new Error("sin combinaciones");
    expect(r.valor.map((x) => x.etiqueta)).toContain("1.35·G + 1.5·Q + 1.5·W");
  }, 60_000);

  it("dos muros en L que comparten la arista: la esquina, a partes iguales", () => {
    const f = portico();
    f.muros = [
      { id: "M1", puntos: [[0, 0], [6, 0]], desde: "P0", hasta: "P1", espesor: 0.3, material: "H" },
      { id: "M2", puntos: [[0, 0], [0, 5]], desde: "P0", hasta: "P1", espesor: 0.3, material: "H" },
    ];
    f.vigas = f.vigas!.filter((v) => v.id !== "VA" && v.id !== "V1");
    f.pilares = f.pilares!.filter((p) => p.id === "C4");
    // Antes: la esquina en los dos muros (y con viento, una resultante vertical que no existe)
    comprobar(f, { M1: 1, M2: 1 });
  }, 60_000);
});
