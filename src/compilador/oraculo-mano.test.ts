/**
 * Criterio 2 de C1: cada modelo físico se compara con su modelo analítico escrito a mano a partir
 * de la descripción física (nudos, zonas rígidas, excentricidades, liberaciones, diafragmas y
 * cargas repartidas en tramos flexibles y nudos), sin llamar al compilador. Desplazamientos,
 * reacciones y esfuerzos de extremo tienen que coincidir a ≤ 1e-10.
 */
import { describe, expect, it } from "vitest";
import type { CargaBarra, CargaNodal, ModeloAnalitico, Vec3 } from "../motor/modelo.ts";
import { compararModelos, puntualANudo, uniformeANudo } from "../pruebas/compilador.ts";
import { Constructor, EMPOTRADO } from "../pruebas/constructor.ts";
import { hormigon, rectangular } from "../secciones/seccion3D.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

const HA = hormigon(25);
const rect = (b: number, h: number) => rectangular(b, h, HA);
const TOL = 1e-10;

function compilado(f: ModeloFisico): { modelo: ModeloAnalitico; codigos: string[] } {
  const r = compilar(f);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return { modelo: r.modelo, codigos: r.diagnosticos.map((d) => d.codigo) };
}

function comprobar(f: ModeloFisico, mano: ModeloAnalitico) {
  const { modelo, codigos } = compilado(f);
  const c = compararModelos(modelo, mano);
  expect(c.nBarras).toBe((mano.barras ?? []).length);
  expect(c.u, c.porCaso.join("; ")).toBeLessThan(TOL);
  expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(TOL);
  expect(c.barras, c.porCaso.join("; ")).toBeLessThan(TOL);
  return { modelo, codigos, c };
}

const g = (q: number): Vec3 => [0, 0, q];
const dl = (barra: number, q: Vec3, a: number, b: number): CargaBarra => ({ tipo: "distribuida", barra, ejes: "global", qa: q, a, b });

const MATERIALES: ModeloFisico["materiales"] = [{ id: "HA", tipo: "hormigon", fck: 25 }];

describe("criterio 2 de C1: modelos físicos frente a su modelo analítico hecho a mano", () => {
  it("pórtico 3D de 2 plantas: pilares rectangulares girados, zonas rígidas, diafragmas, peso propio y cargas en zonas rígidas", () => {
    const f: ModeloFisico = {
      plantas: [
        { id: "P2", altura: null },
        { id: "P1", altura: 3 },
        { id: "C", altura: 3.5, tipo: "sotano" },
      ],
      materiales: MATERIALES,
      secciones: [
        { id: "p3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
        { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "vx", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
        { id: "vy", material: "HA", forma: "rectangular", b: 0.25, h: 0.4 },
      ],
      pilares: [
        { id: "A", x: 0, y: 0, desde: "C", hasta: "P2", seccion: "p3050" },
        { id: "B", x: 5, y: 0, desde: "C", hasta: "P2", seccion: "p3050", giro: 90 },
        { id: "C1", x: 0, y: 4, desde: "C", hasta: "P2", seccion: "p30" },
        { id: "D", x: 5, y: 4, desde: "C", hasta: "P2", seccion: "p3050" },
      ],
      vigas: ["P1", "P2"].flatMap((p) => [
        { id: `VX0-${p}`, planta: p, puntos: [[0, 0], [5, 0]] as const, seccion: "vx" },
        { id: `VX4-${p}`, planta: p, puntos: [[0, 4], [5, 4]] as const, seccion: "vx" },
        { id: `VY0-${p}`, planta: p, puntos: [[0, 0], [0, 4]] as const, seccion: "vy" },
        { id: `VY5-${p}`, planta: p, puntos: [[5, 0], [5, 4]] as const, seccion: "vy" },
      ]),
      casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
      cargas: [
        { tipo: "viga", id: "qv", caso: "Q", viga: "VX0-P2", ejes: "global", q: [0, 0, -8] },
        { tipo: "puntual", id: "H", caso: "Q", planta: "P2", x: 0.05, y: 0.02, F: [10, 0, 0] },
        { tipo: "pilar", id: "w", caso: "Q", pilar: "D", ejes: "global", q: [0, 2, 0] },
      ],
    };

    // A mano
    const m = new Constructor();
    const zs = [-3.5, 0, 3];
    const pos: Record<string, [number, number]> = { A: [0, 0], B: [5, 0], C1: [0, 4], D: [5, 4] };
    const n: Record<string, number[]> = {};
    for (const [id, [x, y]] of Object.entries(pos)) n[id] = zs.map((z) => m.nudo(x, y, z));
    const sec: Record<string, ReturnType<typeof rect>> = { A: rect(0.3, 0.5), B: rect(0.3, 0.5), C1: rect(0.3, 0.3), D: rect(0.3, 0.5) };
    const vz: Record<string, Vec3> = { A: [1, 0, 0], B: [0, 1, 0], C1: [1, 0, 0], D: [1, 0, 0] };
    const G: CargaNodal[] = [];
    const Q: CargaNodal[] = [];
    const bG: CargaBarra[] = [];
    const bQ: CargaBarra[] = [];
    const tramoPilar: Record<string, number[]> = {};
    for (const id of Object.keys(pos)) {
      const [x, y] = pos[id]!;
      tramoPilar[id] = [];
      for (let t = 0; t < 2; t++) {
        // cabeza rígida 0,5 m: el canto de la viga más alta que llega (vx)
        const b = m.barra(n[id]![t]!, n[id]![t + 1]!, sec[id]!, vz[id]!, { offsets: { j: [0, 0, -0.5] } });
        tramoPilar[id]!.push(b);
        const w = -25 * sec[id]!.A;
        const H = zs[t + 1]! - zs[t]!;
        bG.push(dl(b, g(w), 0, H - 0.5));
        G.push(uniformeANudo(n[id]![t + 1]!, [x, y, zs[t + 1]!], [x, y, zs[t + 1]! - 0.5], [x, y, zs[t + 1]!], g(w)));
      }
    }
    for (const id of Object.keys(pos)) m.apoyo(n[id]![0]!, EMPOTRADO);
    // Viento en D: cada tramo flexible y su cabeza rígida
    for (let t = 0; t < 2; t++) {
      const b = tramoPilar.D![t]!;
      const H = zs[t + 1]! - zs[t]!;
      bQ.push(dl(b, [0, 2, 0], 0, H - 0.5));
      Q.push(uniformeANudo(n.D![t + 1]!, [5, 4, zs[t + 1]!], [5, 4, zs[t + 1]! - 0.5], [5, 4, zs[t + 1]!], [0, 2, 0]));
    }
    // Vigas: zonas rígidas hasta la cara del pilar a lo largo de su eje
    const viga = (t: number, de: string, a: string, caraI: number, caraJ: number, s: ReturnType<typeof rect>, cargas: { lista: CargaBarra[]; nodales: CargaNodal[]; v: Vec3 }[]) => {
      const [xi, yi] = pos[de]!;
      const [xj, yj] = pos[a]!;
      const L = Math.hypot(xj - xi, yj - yi);
      const u = [(xj - xi) / L, (yj - yi) / L];
      const z = zs[t]!;
      const b = m.barra(n[de]![t]!, n[a]![t]!, s, [0, 0, 1], { offsets: { i: [caraI * u[0]!, caraI * u[1]!, 0], j: [-caraJ * u[0]!, -caraJ * u[1]!, 0] } });
      for (const c of cargas) {
        c.lista.push(dl(b, c.v, 0, L - caraI - caraJ));
        c.nodales.push(uniformeANudo(n[de]![t]!, [xi, yi, z], [xi, yi, z], [xi + caraI * u[0]!, yi + caraI * u[1]!, z], c.v));
        c.nodales.push(uniformeANudo(n[a]![t]!, [xj, yj, z], [xj - caraJ * u[0]!, yj - caraJ * u[1]!, z], [xj, yj, z], c.v));
      }
    };
    for (const t of [1, 2]) {
      const wx = { lista: bG, nodales: G, v: g(-25 * 0.15) };
      const wy = { lista: bG, nodales: G, v: g(-25 * 0.1) };
      // A: canto 0,5 según X; B girado 90°: canto según Y; C1: 0,3; D: canto según X
      viga(t, "A", "B", 0.25, 0.15, rect(0.3, 0.5), t === 2 ? [wx, { lista: bQ, nodales: Q, v: g(-8) }] : [wx]);
      viga(t, "C1", "D", 0.15, 0.25, rect(0.3, 0.5), [wx]);
      viga(t, "A", "C1", 0.15, 0.15, rect(0.25, 0.4), [wy]);
      viga(t, "B", "D", 0.25, 0.15, rect(0.25, 0.4), [wy]);
    }
    for (const t of [1, 2]) {
      const cm = m.nudo(2.5, 2, zs[t]!);
      m.diafragma(cm, Object.keys(pos).map((id) => n[id]![t]!));
    }
    Q.push(puntualANudo(n.A![2]!, [0, 0, 3], [0.05, 0.02, 3], [10, 0, 0]));
    m.caso("G", G, [], bG);
    m.caso("Q", Q, [], bQ);
    const { codigos, c } = comprobar(f, m.modelo());
    expect(codigos).toEqual([]);
    expect(c.nudos).toBe(12);
  });

  it("viga excéntrica respecto a sus pilares, sin diafragma: el offset lleva la zona rígida y la excentricidad", () => {
    const f: ModeloFisico = {
      plantas: [
        { id: "P1", altura: null, diafragma: "ninguno" },
        { id: "C", altura: 3, tipo: "sotano" },
      ],
      materiales: MATERIALES,
      secciones: [
        { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
        { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
      ],
      pilares: [
        { id: "E1", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
        { id: "E2", x: 6, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
      ],
      vigas: [{ id: "V", planta: "P1", puntos: [[-0.1, 0.15], [6.1, 0.15]], seccion: "v" }],
      casos: [{ id: "G" }],
      cargas: [
        { tipo: "viga", id: "q", caso: "G", viga: "V", ejes: "global", q: [0, 0, -20] },
        { tipo: "puntual", id: "P", caso: "G", planta: "P1", x: 3, y: 0.17, F: [3, 0, -4] },
      ],
    };
    const m = new Constructor();
    const e1 = [m.nudo(0, 0, -3), m.nudo(0, 0, 0)];
    const e2 = [m.nudo(6, 0, -3), m.nudo(6, 0, 0)];
    m.barra(e1[0]!, e1[1]!, rect(0.4, 0.4), [1, 0, 0], { offsets: { j: [0, 0, -0.6] } });
    m.barra(e2[0]!, e2[1]!, rect(0.4, 0.4), [1, 0, 0], { offsets: { j: [0, 0, -0.6] } });
    m.apoyo(e1[0]!);
    m.apoyo(e2[0]!);
    // Tramo flexible sobre y = 0,15, de la cara x = 0,2 a la cara x = 5,8
    const b = m.barra(e1[1]!, e2[1]!, rect(0.3, 0.6), [0, 0, 1], { offsets: { i: [0.2, 0.15, 0], j: [-0.2, 0.15, 0] } });
    const nodales = [
      uniformeANudo(e1[1]!, [0, 0, 0], [-0.1, 0.15, 0], [0.2, 0.15, 0], g(-20)),
      uniformeANudo(e2[1]!, [6, 0, 0], [5.8, 0.15, 0], [6.1, 0.15, 0], g(-20)),
    ];
    // La puntual cae a 2 cm del eje, en x = 3: x = 2,8 desde i', con el momento de transporte
    const F: Vec3 = [3, 0, -4];
    const r: Vec3 = [0, 0.02, 0];
    const M: Vec3 = [r[1] * F[2] - r[2] * F[1], r[2] * F[0] - r[0] * F[2], r[0] * F[1] - r[1] * F[0]];
    m.caso("G", nodales, [], [dl(b, g(-20), 0, 5.6), { tipo: "puntual", barra: b, ejes: "global", x: 2.8, F, M }]);
    const { codigos } = comprobar(f, m.modelo());
    expect(codigos).toEqual([]);
  });

  it("encuentro en T con hueco de 2 cm, viga en polilínea con rótula, cruce de vigas y cargas junto a un cruce", () => {
    const f: ModeloFisico = {
      plantas: [
        { id: "P1", altura: null },
        { id: "C", altura: 3, tipo: "sotano" },
      ],
      materiales: MATERIALES,
      secciones: [
        { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      ],
      pilares: [
        { id: "K1", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
        { id: "K2", x: 8, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
        { id: "K3", x: 8, y: 6, desde: "C", hasta: "P1", seccion: "p30" },
        { id: "K4", x: 0, y: 6, desde: "C", hasta: "P1", seccion: "p30" },
      ],
      vigas: [
        { id: "V1", planta: "P1", puntos: [[0, 0], [8, 0]], seccion: "v" },
        { id: "V2", planta: "P1", puntos: [[0, 6], [8, 6]], seccion: "v" },
        { id: "V3", planta: "P1", puntos: [[0, 0], [0, 6]], seccion: "v" },
        { id: "V4", planta: "P1", puntos: [[8, 0], [8, 6]], seccion: "v" },
        { id: "V5", planta: "P1", puntos: [[4, 0.02], [4, 3], [8, 3]], seccion: "v", liberaciones: { inicio: [false, false, false, false, true, true] } },
        { id: "V7", planta: "P1", puntos: [[6, 1], [6, 5]], seccion: "v" },
      ],
      casos: [{ id: "G" }],
      cargas: [
        { tipo: "viga", id: "q5", caso: "G", viga: "V5", ejes: "global", q: [0, 0, -6] },
        { tipo: "viga", id: "q7", caso: "G", viga: "V7", ejes: "global", q: [0, 0, -4] },
        { tipo: "viga", id: "q1", caso: "G", viga: "V1", ejes: "global", q: [0, 0, -5] },
        { tipo: "puntual", id: "P7", caso: "G", planta: "P1", x: 6, y: 4.5, F: [0, 0, -10] },
        { tipo: "puntual", id: "PX", caso: "G", planta: "P1", x: 6.02, y: 3.01, F: [0, 0, -7] },
      ],
    };
    const m = new Constructor();
    const s = rect(0.3, 0.5);
    const col: Record<string, number> = {};
    for (const [id, x, y] of [["K1", 0, 0], ["K2", 8, 0], ["K3", 8, 6], ["K4", 0, 6]] as const) {
      const pie = m.nudo(x, y, -3);
      col[id] = m.nudo(x, y, 0);
      m.barra(pie, col[id]!, rect(0.3, 0.3), [1, 0, 0], { offsets: { j: [0, 0, -0.5] } });
      m.apoyo(pie);
    }
    const T1 = m.nudo(4, 0, 0);
    const K = m.nudo(4, 3, 0);
    const T2 = m.nudo(8, 3, 0);
    const X = m.nudo(6, 3, 0);
    const E1 = m.nudo(6, 1, 0);
    const E2 = m.nudo(6, 5, 0);
    const z = [0, 0, 1] as const;
    const v1a = m.barra(col.K1!, T1, s, z, { offsets: { i: [0.15, 0, 0] } });
    const v1b = m.barra(T1, col.K2!, s, z, { offsets: { j: [-0.15, 0, 0] } });
    m.barra(col.K4!, col.K3!, s, z, { offsets: { i: [0.15, 0, 0], j: [-0.15, 0, 0] } });
    m.barra(col.K1!, col.K4!, s, z, { offsets: { i: [0, 0.15, 0], j: [0, -0.15, 0] } });
    m.barra(col.K2!, T2, s, z, { offsets: { i: [0, 0.15, 0] } });
    m.barra(T2, col.K3!, s, z, { offsets: { j: [0, -0.15, 0] } });
    // V5: arranca en el nudo en T (su recta se prolonga 2 cm hasta él) con rótula
    const v5a = m.barra(T1, K, s, z, { liberaciones: { i: [false, false, false, false, true, true] } });
    const v5b = m.barra(K, X, s, z);
    const v5c = m.barra(X, T2, s, z);
    const v7a = m.barra(E1, X, s, z);
    const v7b = m.barra(X, E2, s, z);
    m.diafragma(m.nudo(4, 3.2, 0), [col.K1!, col.K2!, col.K3!, col.K4!, T1, K, T2, X, E1, E2]);
    m.caso(
      "G",
      [
        uniformeANudo(col.K1!, [0, 0, 0], [0, 0, 0], [0.15, 0, 0], g(-5)),
        uniformeANudo(col.K2!, [8, 0, 0], [7.85, 0, 0], [8, 0, 0], g(-5)),
        puntualANudo(X, [6, 3, 0], [6.02, 3.01, 0], [0, 0, -7]),
      ],
      [],
      [
        dl(v1a, g(-5), 0, 3.85),
        dl(v1b, g(-5), 0, 3.85),
        dl(v5a, g(-6), 0.02, 3),
        dl(v5b, g(-6), 0, 2),
        dl(v5c, g(-6), 0, 2),
        dl(v7a, g(-4), 0, 2),
        dl(v7b, g(-4), 0, 2),
        { tipo: "puntual", barra: v7b, ejes: "global", x: 1.5, F: [0, 0, -10] },
      ],
    );
    const { codigos } = comprobar(f, m.modelo());
    // El arranque de V5 a 2 cm de V1 se avisa
    expect(codigos).toEqual(["topologia/fusion"]);
  });

  it("pilar apeado girado 30°, pilares apilados, viga con inserción superior y cargas locales y de pilar", () => {
    const f: ModeloFisico = {
      plantas: [
        { id: "P2", altura: null },
        { id: "P1", altura: 3 },
        { id: "C", altura: 3, tipo: "sotano" },
      ],
      materiales: MATERIALES,
      secciones: [
        { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "p25", material: "HA", forma: "rectangular", b: 0.25, h: 0.25 },
        { id: "pap", material: "HA", forma: "rectangular", b: 0.25, h: 0.4 },
        { id: "vb", material: "HA", forma: "rectangular", b: 0.4, h: 0.6 },
        { id: "vc", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      ],
      pilares: [
        { id: "S1", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
        { id: "S2", x: 0, y: 0, desde: "P1", hasta: "P2", seccion: "p25", base: "ninguno" },
        { id: "S3", x: 6, y: 0, desde: "C", hasta: "P2", seccion: "p30" },
        { id: "AP", x: 3, y: 0, desde: "P1", hasta: "P2", seccion: "pap", giro: 30, base: "ninguno" },
      ],
      vigas: [
        { id: "VB", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "vb", insercion: "superior" },
        { id: "VC", planta: "P2", puntos: [[0, 0], [6, 0]], seccion: "vc" },
      ],
      casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
      cargas: [
        { tipo: "puntual", id: "H", caso: "Q", planta: "P2", x: 3, y: 0, F: [0, 8, 0] },
        { tipo: "pilar", id: "w", caso: "Q", pilar: "S3", ejes: "global", q: [1.5, 0, 0], desde: 1, hasta: 5 },
        { tipo: "viga", id: "ql", caso: "Q", viga: "VC", ejes: "local", q: [0, 1, -3] },
      ],
    };
    const m = new Constructor();
    const n0 = [m.nudo(0, 0, -3), m.nudo(0, 0, 0), m.nudo(0, 0, 3)];
    const n6 = [m.nudo(6, 0, -3), m.nudo(6, 0, 0), m.nudo(6, 0, 3)];
    const n3 = [m.nudo(3, 0, 0), m.nudo(3, 0, 3)];
    m.apoyo(n0[0]!);
    m.apoyo(n6[0]!);
    const c30 = Math.cos(Math.PI / 6);
    const s30 = Math.sin(Math.PI / 6);
    const G: CargaNodal[] = [];
    const Q: CargaNodal[] = [];
    const bG: CargaBarra[] = [];
    const bQ: CargaBarra[] = [];
    const pilar = (i: number, j: number, x: number, z0: number, sec: ReturnType<typeof rect>, rz: number, vz: Vec3) => {
      const b = m.barra(i, j, sec, vz, { offsets: { j: [0, 0, -rz] } });
      const w = g(-25 * sec.A);
      bG.push(dl(b, w, 0, 3 - rz));
      G.push(uniformeANudo(j, [x, 0, z0 + 3], [x, 0, z0 + 3 - rz], [x, 0, z0 + 3], w));
      return b;
    };
    pilar(n0[0]!, n0[1]!, 0, -3, rect(0.3, 0.3), 0.6, [1, 0, 0]);
    pilar(n0[1]!, n0[2]!, 0, 0, rect(0.25, 0.25), 0.5, [1, 0, 0]);
    const s3a = pilar(n6[0]!, n6[1]!, 6, -3, rect(0.3, 0.3), 0.6, [1, 0, 0]);
    const s3b = pilar(n6[1]!, n6[2]!, 6, 0, rect(0.3, 0.3), 0.5, [1, 0, 0]);
    pilar(n3[0]!, n3[1]!, 3, 0, rect(0.25, 0.4), 0.5, [c30, s30, 0]);
    // Viento en S3 entre las estaciones 1 y 5 (z = −2 a 2)
    bQ.push(dl(s3a, [1.5, 0, 0], 1, 2.4));
    Q.push(uniformeANudo(n6[1]!, [6, 0, 0], [6, 0, -0.6], [6, 0, 0], [1.5, 0, 0]));
    bQ.push(dl(s3b, [1.5, 0, 0], 0, 2));
    // Huella del apeado girado 30° (h = 0,4 según 30°, b = 0,25): la recta y = 0 la corta en ±0,2/cos 30°
    const rAp = 0.2 / c30;
    const vigaPorTramos = (z: number, ze: number, nudos: number[], caras: number[][], sec: ReturnType<typeof rect>, cargas: { v: Vec3; lista: CargaBarra[]; nodales: CargaNodal[] }[]) => {
      const xs = [0, 3, 6];
      for (let t = 0; t < 2; t++) {
        const [xi, xj] = [xs[t]!, xs[t + 1]!];
        const [ci, cj] = [caras[t]![0]!, caras[t]![1]!];
        const b = m.barra(nudos[t]!, nudos[t + 1]!, sec, [0, 0, 1], { offsets: { i: [ci, 0, -ze], j: [-cj, 0, -ze] } });
        for (const c of cargas) {
          c.lista.push(dl(b, c.v, 0, xj - xi - ci - cj));
          c.nodales.push(uniformeANudo(nudos[t]!, [xi, 0, z], [xi, 0, z - ze], [xi + ci, 0, z - ze], c.v));
          c.nodales.push(uniformeANudo(nudos[t + 1]!, [xj, 0, z], [xj - cj, 0, z - ze], [xj, 0, z - ze], c.v));
        }
      }
    };
    // VB (40×60, inserción superior: el eje 0,30 m por debajo); en P1 las huellas son S1 (0,30), AP y S3 (0,30)
    vigaPorTramos(0, 0.3, [n0[1]!, n3[0]!, n6[1]!], [[0.15, rAp], [rAp, 0.15]], rect(0.4, 0.6), [{ v: g(-25 * 0.24), lista: bG, nodales: G }]);
    // VC (30×50); en P2: S2 (0,25), AP y S3 (0,30); carga local [0, 1, −3] = global [0, 1, −3] (y local = +Y)
    vigaPorTramos(3, 0, [n0[2]!, n3[1]!, n6[2]!], [[0.125, rAp], [rAp, 0.15]], rect(0.3, 0.5), [
      { v: g(-25 * 0.15), lista: bG, nodales: G },
      { v: [0, 1, -3], lista: bQ, nodales: Q },
    ]);
    Q.push(puntualANudo(n3[1]!, [3, 0, 3], [3, 0, 3], [0, 8, 0]));
    m.diafragma(m.nudo(3, 0.5, 0), [n0[1]!, n3[0]!, n6[1]!]);
    m.diafragma(m.nudo(3, 0.5, 3), [n0[2]!, n3[1]!, n6[2]!]);
    m.caso("G", G, [], bG);
    m.caso("Q", Q, [], bQ);
    const { codigos } = comprobar(f, m.modelo());
    expect(codigos).toEqual(["viga/insercion-con-diafragma"]);
  });
});
