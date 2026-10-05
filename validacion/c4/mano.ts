/**
 * Criterio 1 de C4: paños unidireccionales con su modelo analítico escrito a mano a partir de la
 * descripción física (rectas de viguetas centradas en el ancho, nudos en los ejes de las vigas,
 * torsión liberada en un extremo, zonas rígidas en las huellas y reparto por la regla de la
 * palanca), sin llamar al compilador. Los compara `src/compilador/oraculo-c4.test.ts` (a ≤ 1e-10).
 *
 * Todos van con el nudo entero rígido y sin modificadores (`OPCIONES_MANO` de C1), como los de C1.
 */
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import type { CargaBarra, CargaNodal, Seis, Vec3 } from "../../src/motor/modelo.ts";
import { uniformeANudo } from "../../src/pruebas/compilador.ts";
import { Constructor, EMPOTRADO } from "../../src/pruebas/constructor.ts";
import { hormigon, rectangular, seccionT } from "../../src/secciones/seccion3D.ts";
import { OPCIONES_MANO, type CasoMano } from "../c1/mano.ts";

const HA = hormigon(25);
const T = seccionT(0.75, 0.05, 0.12, 0.3, HA).seccion;
const LIB_T: { i: Seis<boolean> } = { i: [false, false, false, true, false, false] };
const g = (q: number): Vec3 => [0, 0, q];
const dl = (barra: number, q: Vec3, a: number, b: number): CargaBarra => ({ tipo: "distribuida", barra, ejes: "global", qa: q, a, b });
const MATERIALES: ModeloFisico["materiales"] = [{ id: "HA", tipo: "hormigon", fck: 25 }];
const SECCIONES: ModeloFisico["secciones"] = [
  { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "P80", material: "HA", forma: "rectangular", b: 0.8, h: 0.8 },
  { id: "V", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
  { id: "T", material: "HA", forma: "T", bf: 0.75, hf: 0.05, bw: 0.12, h: 0.3 },
];

/** Las rectas de las viguetas de un paño de ancho 6 con intereje 0,75: 8, centradas (la primera a 0,375). */
const Y = Array.from({ length: 8 }, (_, j) => 0.375 + 0.75 * j);

export function casosManoC4(): CasoMano[] {
  return [unPano(0), unPano(30), dosVanosConVoladizo(), viguetaEnHuella(), panoConHueco()];
}

/** Giro de un punto en planta. */
const girar = (a: number) => {
  const [c, s] = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
  return (p: readonly [number, number]): Vec2 => [c * p[0] - s * p[1], s * p[0] + c * p[1]];
};

/**
 * Una viga recta partida en los nudos `cadena` (σ crecientes a lo largo de su eje A + σ·u), con
 * zonas rígidas `ri` y `rj` en sus extremos. Devuelve sus barras con el σ de su i' y su j'.
 */
function viga(m: Constructor, cadena: { n: number; s: number }[], u: Vec2, sec: ReturnType<typeof rectangular>, ri: number, rj: number) {
  const r: { b: number; s0: number; s1: number }[] = [];
  for (let k = 0; k + 1 < cadena.length; k++) {
    const [a, b] = [cadena[k]!, cadena[k + 1]!];
    const di = k === 0 ? ri : 0;
    const dj = k + 2 === cadena.length ? rj : 0;
    const off: { i?: Vec3; j?: Vec3 } = {};
    if (di) off.i = [di * u[0], di * u[1], 0];
    if (dj) off.j = [-dj * u[0], -dj * u[1], 0];
    r.push({ b: m.barra(a.n, b.n, sec, [0, 0, 1], Object.keys(off).length ? { offsets: off } : undefined), s0: a.s + di, s1: b.s - dj });
  }
  return r;
}

/**
 * Carga uniforme q sobre [sa, sb] de una viga partida (`viga`) de eje A + σ·u a la cota z: en los
 * tramos flexibles, carga de barra; en las zonas rígidas de sus extremos, a su nudo.
 */
function cargarViga(
  barras: { b: number; s0: number; s1: number }[],
  cadena: { n: number; s: number }[],
  A: Vec2,
  u: Vec2,
  z: number,
  sa: number,
  sb: number,
  q: Vec3,
  lista: CargaBarra[],
  nodales: CargaNodal[],
) {
  const X = (s: number): Vec3 => [A[0] + s * u[0], A[1] + s * u[1], z];
  for (const br of barras) {
    const [a, b] = [Math.max(sa, br.s0), Math.min(sb, br.s1)];
    if (b > a) lista.push(dl(br.b, q, a - br.s0, b - br.s0));
  }
  // Zonas rígidas: la barra k va de cadena[k] a cadena[k + 1]; lo que queda entre dos barras es del nudo común
  const aNudo = (c: { n: number; s: number }, a0: number, b0: number) => {
    const [a, b] = [Math.max(sa, a0), Math.min(sb, b0)];
    if (b > a) nodales.push(uniformeANudo(c.n, X(c.s), X(a), X(b), q));
  };
  aNudo(cadena[0]!, cadena[0]!.s, barras[0]!.s0);
  for (let k = 0; k + 1 < barras.length; k++) aNudo(cadena[k + 1]!, barras[k]!.s1, barras[k + 1]!.s0);
  aNudo(cadena[cadena.length - 1]!, barras[barras.length - 1]!.s1, cadena[cadena.length - 1]!.s);
}

/**
 * Paño de 5 × 6 m entre cuatro vigas sobre cuatro pilares, viguetas según su lado de 5 m, girado
 * `giro` grados (0 o 30: el paño oblicuo). 8 viguetas de 5 m (n = round(6/0,75)), sus 16 nudos
 * sobre las vigas de los lados de 6 m y la torsión liberada en su primer extremo. Las vigas de los
 * lados de 5 m son paralelas a las viguetas: reciben la franja hasta la primera (0,375/2 m).
 * Cargas: peso propio (pilares, vigas por su descuelgue y el pp del paño), una de superficie, una
 * puntual entre dos viguetas y una lineal paralela a ellas, entre otras dos.
 */
function unPano(giro: number): CasoMano {
  const G = girar(giro);
  const f: ModeloFisico = {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: (
      [
        ["C1", 0, 0],
        ["C2", 5, 0],
        ["C3", 5, 6],
        ["C4", 0, 6],
      ] as const
    ).map(([id, x, y]) => ({ id, x: G([x, y])[0], y: G([x, y])[1], desde: "P0", hasta: "P1", seccion: "P30", giro })),
    vigas: (
      [
        ["VA", [0, 0], [0, 6]],
        ["VB", [5, 0], [5, 6]],
        ["VC", [0, 0], [5, 0]],
        ["VD", [0, 6], [5, 6]],
      ] as const
    ).map(([id, a, b]) => ({ id, planta: "P1", puntos: [G(a), G(b)], seccion: "V" })),
    panos: [{ id: "F1", planta: "P1", contorno: ([[0, 0], [5, 0], [5, 6], [0, 6]] as const).map(G), direccion: giro, intereje: 0.75, seccion: "T", pp: 3 }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "S", caso: "Q", planta: "P1", pano: "F1", q: [0, 0, -2] },
      { tipo: "puntual", id: "P", caso: "Q", planta: "P1", x: G([2.2, 2])[0], y: G([2.2, 2])[1], F: [0, 0, -10] },
      { tipo: "lineal", id: "L", caso: "Q", planta: "P1", puntos: [G([1, 4]), G([4, 4])], q: [0, 0, -4] },
    ],
  };

  const m = new Constructor();
  const z = 3;
  const P3 = (x: number, y: number, zz = z): Vec3 => [...G([x, y]), zz];
  const nudo = (x: number, y: number, zz = z) => m.nudo(...P3(x, y, zz));
  const esquinas: Record<string, [number, number]> = { C1: [0, 0], C2: [5, 0], C3: [5, 6], C4: [0, 6] };
  const cab: Record<string, number> = {};
  const nG: CargaNodal[] = [];
  const nQ: CargaNodal[] = [];
  const bG: CargaBarra[] = [];
  const bQ: CargaBarra[] = [];
  const ez = G([1, 0]);
  for (const [id, [x, y]] of Object.entries(esquinas)) {
    const base = nudo(x, y, 0);
    cab[id] = nudo(x, y);
    m.apoyo(base, EMPOTRADO);
    // Cabeza rígida: el canto de la viga más alta (0,5)
    const b = m.barra(base, cab[id]!, rectangular(0.3, 0.3, HA), [ez[0], ez[1], 0], { offsets: { j: [0, 0, -0.5] } });
    bG.push(dl(b, g(-25 * 0.09), 0, 2.5));
    nG.push(uniformeANudo(cab[id]!, P3(x, y), P3(x, y, 2.5), P3(x, y), g(-25 * 0.09)));
  }
  const nA = Y.map((y) => nudo(0, y));
  const nB = Y.map((y) => nudo(5, y));
  const V = rectangular(0.3, 0.5, HA);
  const uY = G([0, 1]);
  const uX = G([1, 0]);
  const cadA = [{ n: cab.C1!, s: 0 }, ...nA.map((n, j) => ({ n, s: Y[j]! })), { n: cab.C4!, s: 6 }];
  const cadB = [{ n: cab.C2!, s: 0 }, ...nB.map((n, j) => ({ n, s: Y[j]! })), { n: cab.C3!, s: 6 }];
  const cadC = [
    { n: cab.C1!, s: 0 },
    { n: cab.C2!, s: 5 },
  ];
  const cadD = [
    { n: cab.C4!, s: 0 },
    { n: cab.C3!, s: 5 },
  ];
  const VA = viga(m, cadA, uY, V, 0.15, 0.15);
  const VB = viga(m, cadB, uY, V, 0.15, 0.15);
  const VC = viga(m, cadC, uX, V, 0.15, 0.15);
  const VD = viga(m, cadD, uX, V, 0.15, 0.15);
  // Peso de las vigas: sólo su descuelgue, γ·(b·h − (b/2)·min(h, t)) con t = 0,3 (C2-g)
  const wv = g(-(25 * 0.3 * 0.5 - 25 * 0.15 * 0.3));
  cargarViga(VA, cadA, G([0, 0]), uY, z, 0, 6, wv, bG, nG);
  cargarViga(VB, cadB, G([5, 0]), uY, z, 0, 6, wv, bG, nG);
  cargarViga(VC, cadC, G([0, 0]), uX, z, 0, 5, wv, bG, nG);
  cargarViga(VD, cadD, G([0, 6]), uX, z, 0, 5, wv, bG, nG);
  // Viguetas
  const vig = Y.map((_, j) => m.barra(nA[j]!, nB[j]!, T, [0, 0, 1], { liberaciones: LIB_T }));
  // Palanca: las de borde, 0,375/2 + 0,75/2 = 0,5625 m; las demás, 0,75; las vigas paralelas, 0,1875
  const ancho = (j: number) => (j === 0 || j === 7 ? 0.5625 : 0.75);
  for (const [q, lista, nodales] of [
    [-3, bG, nG],
    [-2, bQ, nQ],
  ] as const) {
    vig.forEach((b, j) => lista.push(dl(b, g(q * ancho(j)), 0, 5)));
    cargarViga(VC, cadC, G([0, 0]), uX, z, 0, 5, g(q * 0.1875), lista, nodales);
    cargarViga(VD, cadD, G([0, 6]), uX, z, 0, 5, g(q * 0.1875), lista, nodales);
  }
  // Puntual en (2,2; 2,0): entre las viguetas de 1,875 y 2,625, a 1/6 de la primera
  bQ.push({ tipo: "puntual", barra: vig[2]!, ejes: "global", x: 2.2, F: [0, 0, (-10 * 5) / 6] });
  bQ.push({ tipo: "puntual", barra: vig[3]!, ejes: "global", x: 2.2, F: [0, 0, -10 / 6] });
  // Lineal en y = 4,0 de x = 1 a 4: entre las de 3,375 y 4,125, a 5/6 de la primera
  bQ.push(dl(vig[4]!, g(-4 / 6), 1, 4));
  bQ.push(dl(vig[5]!, g((-4 * 5) / 6), 1, 4));
  m.diafragma(nudo(2.5, 3), [...Object.values(cab), ...nA, ...nB]);
  m.caso("G", nG, [], bG);
  m.caso("Q", nQ, [], bQ);
  return {
    nombre: giro ? `el mismo paño girado ${giro}° (viguetas oblicuas)` : "paño entre cuatro vigas: viguetas, vigas paralelas que reciben la franja de borde, puntual y lineal entre viguetas",
    fisico: f,
    mano: m.modelo(),
    avisos: [],
    opciones: OPCIONES_MANO,
  };
}

/**
 * Dos vanos de 5 m y un voladizo de 1,5 m (tres paños contiguos del mismo grupo) entre vigas en
 * x = 0, 5 y 10 sobre pilares, con vigas en y = 0 y 6 de x = 0 a 10. Las viguetas son continuas
 * sobre las vigas de x = 5 y x = 10; las del voladizo conservan su torsión. En el voladizo los lados
 * paralelos no tienen viga: la franja de borde va a la última vigueta con su momento de transporte.
 */
function dosVanosConVoladizo(): CasoMano {
  const f: ModeloFisico = {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: [0, 5, 10].flatMap((x) => [
      { id: `C${x}a`, x, y: 0, desde: "P0", hasta: "P1", seccion: "P30" },
      { id: `C${x}b`, x, y: 6, desde: "P0", hasta: "P1", seccion: "P30" },
    ]),
    vigas: [
      ...[0, 5, 10].map((x) => ({ id: `VX${x}`, planta: "P1", puntos: [[x, 0], [x, 6]] as Vec2[], seccion: "V" })),
      { id: "VY0", planta: "P1", puntos: [[0, 0], [10, 0]], seccion: "V" },
      { id: "VY6", planta: "P1", puntos: [[0, 6], [10, 6]], seccion: "V" },
    ],
    panos: [
      { id: "F1", planta: "P1", contorno: [[0, 0], [5, 0], [5, 6], [0, 6]], direccion: 0, intereje: 0.75, seccion: "T", pp: 3 },
      { id: "F2", planta: "P1", contorno: [[5, 0], [10, 0], [10, 6], [5, 6]], direccion: 180, intereje: 0.75, seccion: "T", pp: 3 },
      { id: "F3", planta: "P1", contorno: [[10, 0], [11.5, 0], [11.5, 6], [10, 6]], direccion: 0, intereje: 0.75, seccion: "T", pp: 3 },
    ],
    casos: [{ id: "G" }],
    cargas: [{ tipo: "superficie", id: "S", caso: "G", planta: "P1", zona: [[0, 0], [11.5, 0], [11.5, 6], [0, 6]], q: [0, 0, -5] }],
  };
  const m = new Constructor();
  const z = 3;
  const nG: CargaNodal[] = [];
  const bG: CargaBarra[] = [];
  const cab: Record<string, number> = {};
  for (const x of [0, 5, 10])
    for (const y of [0, 6]) {
      const base = m.nudo(x, y, 0);
      cab[`${x},${y}`] = m.nudo(x, y, z);
      m.apoyo(base, EMPOTRADO);
      m.barra(base, cab[`${x},${y}`]!, rectangular(0.3, 0.3, HA), [1, 0, 0], { offsets: { j: [0, 0, -0.5] } });
    }
  const V = rectangular(0.3, 0.5, HA);
  const enX: Record<number, number[]> = {};
  for (const x of [0, 5, 10]) {
    enX[x] = Y.map((y) => m.nudo(x, y, z));
    viga(m, [{ n: cab[`${x},0`]!, s: 0 }, ...enX[x]!.map((n, j) => ({ n, s: Y[j]! })), { n: cab[`${x},6`]!, s: 6 }], [0, 1], V, 0.15, 0.15);
  }
  const libres = Y.map((y) => m.nudo(11.5, y, z));
  const vy: Record<number, ReturnType<typeof viga>> = {};
  const cadY: Record<number, { n: number; s: number }[]> = {};
  for (const y of [0, 6]) {
    cadY[y] = [0, 5, 10].map((x) => ({ n: cab[`${x},${y}`]!, s: x }));
    // La viga pasa por el pilar central: zonas rígidas a los dos lados de él
    const b1 = m.barra(cab[`0,${y}`]!, cab[`5,${y}`]!, V, [0, 0, 1], { offsets: { i: [0.15, 0, 0], j: [-0.15, 0, 0] } });
    const b2 = m.barra(cab[`5,${y}`]!, cab[`10,${y}`]!, V, [0, 0, 1], { offsets: { i: [0.15, 0, 0], j: [-0.15, 0, 0] } });
    vy[y] = [
      { b: b1, s0: 0.15, s1: 4.85 },
      { b: b2, s0: 5.15, s1: 9.85 },
    ];
  }
  const q = -5;
  const ancho = (j: number) => (j === 0 || j === 7 ? 0.5625 : 0.75);
  Y.forEach((_, j) => {
    const v1 = m.barra(enX[0]![j]!, enX[5]![j]!, T, [0, 0, 1], { liberaciones: LIB_T });
    const v2 = m.barra(enX[5]![j]!, enX[10]![j]!, T, [0, 0, 1], { liberaciones: LIB_T });
    const v3 = m.barra(enX[10]![j]!, libres[j]!, T, [0, 0, 1]);
    bG.push(dl(v1, g(q * ancho(j)), 0, 5), dl(v2, g(q * ancho(j)), 0, 5), dl(v3, g(q * 0.75), 0, 1.5));
    // Voladizo: la franja de borde (0,375 m) a la vigueta extrema, con su transporte n × q
    if (j === 0 || j === 7) {
      const brazo = j === 0 ? -0.375 / 2 : 0.375 / 2;
      // ∫(η − η_j) dA = brazo·0,375·1,5; n = +Y, n × (0, 0, q) = (q, 0, 0)
      bG.push({ tipo: "puntual", barra: v3, ejes: "global", x: 0.75, F: [0, 0, 0], M: [q * brazo * 0.375 * 1.5, 0, 0] });
    }
  });
  // Franjas de borde de los dos vanos a las vigas en y = 0 y 6 (de x = 0 a 10)
  for (const y of [0, 6]) cargarViga(vy[y]!, cadY[y]!, [0, y], [1, 0], z, 0, 10, g(q * 0.1875), bG, nG);
  m.diafragma(m.nudo(5.75, 3, z), [...Object.values(cab), ...enX[0]!, ...enX[5]!, ...enX[10]!, ...libres]);
  m.caso("G", nG, [], bG);
  return { nombre: "dos vanos y un voladizo: viguetas continuas sobre las vigas comunes y torsión en el voladizo", fisico: f, mano: m.modelo(), avisos: [], opciones: OPCIONES_MANO };
}

/**
 * Pilares de 80 × 80 en las esquinas: la primera y la última vigueta acaban dentro de su huella
 * (a 0,375 del eje), así que van al nudo del pilar con un offset hasta su extremo y la zona rígida
 * de C1-a (toda la huella, con el nudo entero rígido): del eje x = 0 a la cara x = 0,4.
 */
function viguetaEnHuella(): CasoMano {
  const f: ModeloFisico = {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: (
      [
        ["C1", 0, 0],
        ["C2", 5, 0],
        ["C3", 5, 6],
        ["C4", 0, 6],
      ] as const
    ).map(([id, x, y]) => ({ id, x, y, desde: "P0", hasta: "P1", seccion: "P80" })),
    vigas: [
      { id: "VA", planta: "P1", puntos: [[0, 0], [0, 6]], seccion: "V" },
      { id: "VB", planta: "P1", puntos: [[5, 0], [5, 6]], seccion: "V" },
    ],
    panos: [{ id: "F1", planta: "P1", contorno: [[0, 0], [5, 0], [5, 6], [0, 6]], direccion: 0, intereje: 0.75, seccion: "T", pp: 3 }],
    casos: [{ id: "G" }],
    cargas: [{ tipo: "superficie", id: "S", caso: "G", planta: "P1", pano: "F1", q: [0, 0, -5] }],
  };
  const m = new Constructor();
  const z = 3;
  const nG: CargaNodal[] = [];
  const bG: CargaBarra[] = [];
  const cab: Record<string, number> = {};
  for (const [id, x, y] of [
    ["C1", 0, 0],
    ["C2", 5, 0],
    ["C3", 5, 6],
    ["C4", 0, 6],
  ] as const) {
    const base = m.nudo(x, y, 0);
    cab[id] = m.nudo(x, y, z);
    m.apoyo(base, EMPOTRADO);
    m.barra(base, cab[id]!, rectangular(0.8, 0.8, HA), [1, 0, 0], { offsets: { j: [0, 0, -0.5] } });
  }
  const V = rectangular(0.3, 0.5, HA);
  const interior = Y.slice(1, 7);
  const nA = interior.map((y) => m.nudo(0, y, z));
  const nB = interior.map((y) => m.nudo(5, y, z));
  // Las vigas, con su zona rígida de 0,4 dentro de los pilares
  viga(m, [{ n: cab.C1!, s: 0 }, ...nA.map((n, j) => ({ n, s: interior[j]! })), { n: cab.C4!, s: 6 }], [0, 1], V, 0.4, 0.4);
  viga(m, [{ n: cab.C2!, s: 0 }, ...nB.map((n, j) => ({ n, s: interior[j]! })), { n: cab.C3!, s: 6 }], [0, 1], V, 0.4, 0.4);
  const q = -5;
  // Sin vigas paralelas: las franjas de borde (0,375) van enteras a las viguetas extremas, con su transporte
  Y.forEach((y, j) => {
    const extremo = j === 0 || j === 7;
    const [i0, i1] = extremo ? [cab[j === 0 ? "C1" : "C4"]!, cab[j === 0 ? "C2" : "C3"]!] : [nA[j - 1]!, nB[j - 1]!];
    const off = extremo ? { offsets: { i: [0.4, y - (j === 0 ? 0 : 6), 0] as Vec3, j: [-0.4, y - (j === 0 ? 0 : 6), 0] as Vec3 } } : {};
    const b = m.barra(i0, i1, T, [0, 0, 1], { ...off, liberaciones: LIB_T });
    // Flexible de x = 0,4 a 4,6 en las extremas; el resto de la vigueta (dentro de las huellas) va a su pilar
    const [a, L] = extremo ? [0.4, 4.2] : [0, 5];
    bG.push(dl(b, g(q * 0.75), 0, L));
    if (extremo) {
      nG.push(uniformeANudo(i0, [0, j === 0 ? 0 : 6, z], [0, y, z], [a, y, z], g(q * 0.75)));
      nG.push(uniformeANudo(i1, [5, j === 0 ? 0 : 6, z], [5 - a, y, z], [5, y, z], g(q * 0.75)));
      // Transporte de la franja de borde: ∫(η − η_j) dA = ∓(0,375²/2)·5, n × q = (q, 0, 0); va a la
      // estación media del paño (x = 2,5), en el tramo flexible
      const brazo = j === 0 ? -(0.375 ** 2) / 2 : 0.375 ** 2 / 2;
      bG.push({ tipo: "puntual", barra: b, ejes: "global", x: 2.5 - a, F: [0, 0, 0], M: [q * brazo * 5, 0, 0] });
    }
  });
  m.diafragma(m.nudo(2.5, 3, z), [...Object.values(cab), ...nA, ...nB]);
  m.caso("G", nG, [], bG);
  return { nombre: "viguetas que acaban en la huella de un pilar: nudo del pilar, offset y zona rígida", fisico: f, mano: m.modelo(), avisos: [], opciones: OPCIONES_MANO };
}

/**
 * El paño de `unPano` con un hueco de 1 × 1 m (x de 2 a 3, y de 2,5 a 3,5) sin brochales: corta las
 * viguetas de y = 2,625 y 3,375, que quedan en voladizo desde cada viga (aviso). En x ∈ [2, 3], la
 * franja entre el hueco y las viguetas de 1,875 y 4,125 va entera a ellas, con su transporte.
 */
function panoConHueco(): CasoMano {
  const base = unPano(0);
  const f: ModeloFisico = {
    ...base.fisico,
    panos: [{ ...base.fisico.panos![0]!, huecos: [[[2, 2.5], [3, 2.5], [3, 3.5], [2, 3.5]]] }],
    casos: [{ id: "G" }],
    cargas: [{ tipo: "superficie", id: "S", caso: "G", planta: "P1", pano: "F1", q: [0, 0, -5] }],
  };
  const m = new Constructor();
  const z = 3;
  const nG: CargaNodal[] = [];
  const bG: CargaBarra[] = [];
  const cab: Record<string, number> = {};
  for (const [id, x, y] of [
    ["C1", 0, 0],
    ["C2", 5, 0],
    ["C3", 5, 6],
    ["C4", 0, 6],
  ] as const) {
    const b = m.nudo(x, y, 0);
    cab[id] = m.nudo(x, y, z);
    m.apoyo(b, EMPOTRADO);
    m.barra(b, cab[id]!, rectangular(0.3, 0.3, HA), [1, 0, 0], { offsets: { j: [0, 0, -0.5] } });
  }
  const V = rectangular(0.3, 0.5, HA);
  const nA = Y.map((y) => m.nudo(0, y, z));
  const nB = Y.map((y) => m.nudo(5, y, z));
  const cadC = [
    { n: cab.C1!, s: 0 },
    { n: cab.C2!, s: 5 },
  ];
  const cadD = [
    { n: cab.C4!, s: 0 },
    { n: cab.C3!, s: 5 },
  ];
  viga(m, [{ n: cab.C1!, s: 0 }, ...nA.map((n, j) => ({ n, s: Y[j]! })), { n: cab.C4!, s: 6 }], [0, 1], V, 0.15, 0.15);
  viga(m, [{ n: cab.C2!, s: 0 }, ...nB.map((n, j) => ({ n, s: Y[j]! })), { n: cab.C3!, s: 6 }], [0, 1], V, 0.15, 0.15);
  const VC = viga(m, cadC, [1, 0], V, 0.15, 0.15);
  const VD = viga(m, cadD, [1, 0], V, 0.15, 0.15);
  const q = -5;
  const ancho = (j: number) => (j === 0 || j === 7 ? 0.5625 : 0.75);
  const libres: number[] = [];
  Y.forEach((y, j) => {
    if (j === 3 || j === 4) {
      // Cortadas por el hueco: dos voladizos (con su torsión), de 0 a 2 y de 3 a 5
      const l1 = m.nudo(2, y, z);
      const l2 = m.nudo(3, y, z);
      libres.push(l1, l2);
      const b1 = m.barra(nA[j]!, l1, T, [0, 0, 1]);
      const b2 = m.barra(l2, nB[j]!, T, [0, 0, 1]);
      bG.push(dl(b1, g(q * 0.75), 0, 2), dl(b2, g(q * 0.75), 0, 2));
      return;
    }
    const b = m.barra(nA[j]!, nB[j]!, T, [0, 0, 1], { liberaciones: LIB_T });
    if (j === 2 || j === 5) {
      // Fuera del hueco, la palanca normal (0,75); en x ∈ [2, 3], 0,375 de la palanca con su vecina
      // de fuera más la franja hasta el hueco (0,625), con el transporte ±0,625²/2
      bG.push(dl(b, g(q * 0.75), 0, 2), dl(b, g(q * 0.75), 3, 5), dl(b, g(q * (0.375 + 0.625)), 2, 3));
      const brazo = j === 2 ? 0.625 ** 2 / 2 : -(0.625 ** 2) / 2;
      bG.push({ tipo: "puntual", barra: b, ejes: "global", x: 2.5, F: [0, 0, 0], M: [q * brazo, 0, 0] });
    } else bG.push(dl(b, g(q * ancho(j)), 0, 5));
  });
  cargarViga(VC, cadC, [0, 0], [1, 0], z, 0, 5, g(q * 0.1875), bG, nG);
  cargarViga(VD, cadD, [0, 6], [1, 0], z, 0, 5, g(q * 0.1875), bG, nG);
  m.diafragma(m.nudo(2.5, 3, z), [...Object.values(cab), ...nA, ...nB, ...libres]);
  m.caso("G", nG, [], bG);
  return { nombre: "paño con un hueco sin brochales: viguetas en voladizo y franjas junto al hueco", fisico: f, mano: m.modelo(), avisos: ["pano/vigueta-en-voladizo"], opciones: OPCIONES_MANO };
}
