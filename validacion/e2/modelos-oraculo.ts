/**
 * Modelos de validación de E2 (barras) frente a dos oráculos independientes:
 * - PyNite 3.2.0 (oraculo_pynite.py): Euler–Bernoulli con liberaciones y todas las cargas de
 *   barra (puntuales, momentos y trapeciales parciales, en ejes locales y globales), con los
 *   esfuerzos en estaciones a lo largo de cada barra. PyNite no tiene cortante ni offsets.
 * - OpenSeesPy 3.8 (oraculo_opensees.py): Timoshenko (ElasticTimoshenkoBeam), offsets con
 *   `-jntOffset` y, por separado, con `rigidLink` a nudos auxiliares, y liberaciones con nudos
 *   duplicados y `equalDOF`. OpenSees no admite cargas puntuales en la barra de Timoshenko ni
 *   trapeciales parciales: el oráculo trocea las barras en las cargas puntuales y sólo se usan
 *   cargas distribuidas uniformes en toda la barra.
 *
 * `bun validacion/e2/modelos-oraculo.ts` escribe validacion/e2/modelos-oraculo.json, que leen los
 * dos oráculos. El test (src/motor/oraculos-e2.test.ts) construye los mismos modelos con estas
 * funciones.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CargaBarra, ModeloAnalitico, Vec3 } from "../../src/motor/modelo.ts";
import { carga, Constructor, seccionRectangular, seccionRectangularTimoshenko } from "../../src/pruebas/constructor.ts";

const ART_IJ = { i: [false, false, false, false, true, true] as const, j: [false, false, false, true, true, true] as const };

/** Pórtico espacial de dos plantas con cubierta a cuatro aguas, tornapunta y rótulas (EB). */
function porticoEspacial(): ModeloAnalitico {
  const m = new Constructor();
  const planta = [
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ] as const;
  const niveles = [0, 3.2, 6.4].map((z) => planta.map(([x, y]) => m.nudo(x, y, z)));
  const cumbrera = m.nudo(2.5, 2, 8.1, "cumbrera");
  for (const v of niveles[0]!) m.apoyo(v);
  const col = seccionRectangular(0.3, 0.4);
  const vig = seccionRectangular(0.3, 0.5);
  const par = seccionRectangular(0.2, 0.3);
  const tir = seccionRectangular(0.1, 0.1);
  const vzCol: Vec3[] = [[1, 0, 0], [0, 1, 0], [1, 0.5, 0], [0, 1, 0]];
  // pilares 0–7
  for (let k = 0; k < 2; k++) for (let c = 0; c < 4; c++) m.barra(niveles[k]![c]!, niveles[k + 1]![c]!, col, vzCol[c]!);
  // vigas 8–15 (la 9 biarticulada en My; la 14 con My liberado en j)
  for (let k = 1; k <= 2; k++) {
    for (let c = 0; c < 4; c++) {
      const opciones =
        k === 1 && c === 1
          ? { liberaciones: { i: [false, false, false, false, true, false] as const, j: [false, false, false, false, true, false] as const } }
          : k === 2 && c === 2
            ? { liberaciones: { j: [false, false, false, false, true, false] as const } }
            : undefined;
      m.barra(niveles[k]![c]!, niveles[k]![(c + 1) % 4]!, vig, [0, 0, 1], opciones);
    }
  }
  // pares 16–19 (el 16 con Mz liberado en i)
  for (let c = 0; c < 4; c++) m.barra(niveles[2]![c]!, cumbrera, par, [0, 0, 1], c === 0 ? { liberaciones: { i: [false, false, false, false, false, true] } } : undefined);
  // tornapunta 20, biarticulada con la torsión liberada en j
  m.barra(niveles[0]![0]!, niveles[1]![1]!, tir, [0, 1, 0], { liberaciones: ART_IJ });
  const gravedad: CargaBarra[] = [];
  for (let b = 8; b < 16; b++) gravedad.push({ tipo: "distribuida", barra: b, ejes: "global", qa: [0, 0, -12] });
  for (let b = 16; b < 20; b++) gravedad.push({ tipo: "distribuida", barra: b, ejes: "global", qa: [0, 0, -3] });
  gravedad.push({ tipo: "puntual", barra: 8, ejes: "global", x: 1.37, F: [0, 0, -20] });
  m.caso("G", [carga(cumbrera, { fz: -15 })], [], gravedad);
  m.caso(
    "V",
    [carga(niveles[1]![0]!, { fx: 10 }), carga(niveles[2]![0]!, { fx: 6, fy: -3 })],
    [],
    [
      { tipo: "distribuida", barra: 0, ejes: "local", qa: [0.3, 3, -1], qb: [-0.2, 1, 2], a: 0.4, b: 2.6 },
      { tipo: "puntual", barra: 11, ejes: "local", x: 1.13, M: [1.5, -2.5, 3.5] },
      { tipo: "puntual", barra: 12, ejes: "local", x: 2.71, F: [2, -4, 6] },
      { tipo: "distribuida", barra: 4, ejes: "global", qa: [1.5, 0, 0], qb: [2.5, 0, 0] },
    ],
  );
  m.caso("Mixto", [], [], [
    { tipo: "distribuida", barra: 17, ejes: "global", qa: [1, -2, -4], qb: [-1, 0.5, -6], a: 0.5, b: 2.2 },
    { tipo: "puntual", barra: 14, ejes: "local", x: 3.41, F: [0, 5, -8], M: [0.7, 0, 0] },
    { tipo: "puntual", barra: 5, ejes: "global", x: 1.23, F: [7, 0, 0] },
    { tipo: "puntual", barra: 18, ejes: "global", x: 1.9, M: [2, -3, 1.5] },
    { tipo: "distribuida", barra: 13, ejes: "local", qa: [0, -2, -5], qb: [0, 1, -9], a: 1.1, b: 3.6 },
    { tipo: "distribuida", barra: 20, ejes: "local", qa: [0, 0, -1] },
  ]);
  return m.modelo();
}

/** Viga continua esviada en 3D sobre cuatro apoyos, con una rótula de Gerber en el vano central (EB). */
function vigaGerber(): ModeloAnalitico {
  const m = new Constructor();
  const d = [3, 2, 1].map((v) => v / Math.hypot(3, 2, 1));
  const p = (s: number) => m.nudo(1 + s * d[0]!, -2 + s * d[1]!, 0.5 + s * d[2]!);
  const xs = [0, 4, 5.5, 9, 12.5];
  const n = xs.map(p);
  const s = seccionRectangular(0.25, 0.45);
  for (let k = 0; k < 4; k++) m.barra(n[k]!, n[k + 1]!, s, [0, 0, 1], k === 1 ? { liberaciones: { j: [false, false, false, false, true, true] } } : undefined);
  m.apoyo(n[0]!);
  for (const v of [n[1]!, n[3]!, n[4]!]) m.apoyo(v, [true, true, true, false, false, false]);
  m.caso("q", [], [], [0, 1, 2, 3].map((b) => ({ tipo: "distribuida" as const, barra: b, ejes: "global" as const, qa: [0, 0, -8] as Vec3 })));
  m.caso("varias", [carga(n[2]!, { fy: 3 })], [], [
    { tipo: "distribuida", barra: 0, ejes: "local", qa: [0, 2, -6], qb: [0, -1, -2], a: 0.7, b: 3.3 },
    { tipo: "puntual", barra: 2, ejes: "local", x: 1.6, F: [1, -2, -9], M: [0.5, 1.5, -1] },
    { tipo: "puntual", barra: 3, ejes: "global", x: 2.2, F: [0, 0, -12], M: [3, 0, 0] },
  ]);
  return m.modelo();
}

/** Pórtico de Timoshenko (pilares cortos y cantos grandes: Φ apreciable) con un voladizo esviado. */
function timoshenko(): ModeloAnalitico {
  const m = new Constructor();
  const planta = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ] as const;
  const pies = planta.map(([x, y]) => m.nudo(x, y, 0));
  const cabezas = planta.map(([x, y]) => m.nudo(x, y, 2.8));
  const punta = m.nudo(6.1, 4.4, 3.5);
  const col = seccionRectangularTimoshenko(0.4, 0.8);
  const vig = seccionRectangularTimoshenko(0.3, 0.7);
  const vol = seccionRectangularTimoshenko(0.25, 0.5);
  pies.forEach((p, c) => {
    m.apoyo(p);
    m.barra(p, cabezas[c]!, col, c % 2 ? [0, 1, 0] : [1, 0, 0]);
  });
  for (let c = 0; c < 4; c++) m.barra(cabezas[c]!, cabezas[(c + 1) % 4]!, vig, [0, 0, 1]);
  m.barra(cabezas[2]!, punta, vol, [0, 0, 1]); // 8
  m.caso("G", [carga(punta, { fz: -10 })], [], [
    ...[4, 5, 6, 7].map((b) => ({ tipo: "distribuida" as const, barra: b, ejes: "global" as const, qa: [0, 0, -25] as Vec3 })),
    { tipo: "distribuida", barra: 8, ejes: "global", qa: [0, 0, -6] },
    { tipo: "puntual", barra: 4, ejes: "global", x: 1.3, F: [0, 0, -60] },
    { tipo: "puntual", barra: 5, ejes: "local", x: 2.05, F: [3, -8, -40], M: [2, 6, -4] },
  ]);
  m.caso("H", [carga(cabezas[0]!, { fx: 30, fy: 12 })], [], [
    { tipo: "distribuida", barra: 0, ejes: "local", qa: [0, 4, -3] },
    { tipo: "puntual", barra: 8, ejes: "global", x: 1.4, F: [5, -7, 2], M: [0, 0, 3] },
  ]);
  return m.modelo();
}

/**
 * Offsets: zonas rígidas en las caras de los pilares, viga descolgada y una barra esviada con
 * offsets generales. Con `timoshenko = false`, todas las barras son de Euler–Bernoulli: es la
 * versión que se compara también con `-jntOffset`, porque la ElasticTimoshenkoBeam de OpenSees
 * 3.8 lo aplica mal (hallazgo E2-1).
 */
function offsets(timoshenko = true): ModeloAnalitico {
  const m = new Constructor();
  const planta = [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ] as const;
  const pies = planta.map(([x, y]) => m.nudo(x, y, 0));
  const cabezas = planta.map(([x, y]) => m.nudo(x, y, 3));
  const col = seccionRectangular(0.4, 0.4);
  const vigT = timoshenko ? seccionRectangularTimoshenko(0.3, 0.6) : seccionRectangular(0.3, 0.6);
  const vigEB = seccionRectangular(0.3, 0.5);
  pies.forEach((p, c) => {
    m.apoyo(p);
    // pilar con zona rígida en la cabeza (canto de la viga, 0,3 m)
    m.barra(p, cabezas[c]!, col, [1, 0, 0], { offsets: { j: [0, 0, -0.3] } });
  });
  const e = 0.15; // descuelgue
  for (let c = 0; c < 4; c++) {
    const a = cabezas[c]!;
    const b = cabezas[(c + 1) % 4]!;
    const [xa, ya] = planta[c]!;
    const [xb, yb] = planta[(c + 1) % 4]!;
    const L = Math.hypot(xb - xa, yb - ya);
    const u = [(xb - xa) / L, (yb - ya) / L];
    // zona rígida de 0,2 m en cada cara y descuelgue e en las vigas pares
    const dz = c % 2 === 0 ? -e : 0;
    m.barra(a, b, c % 2 === 0 ? vigT : vigEB, [0, 0, 1], { offsets: { i: [0.2 * u[0]!, 0.2 * u[1]!, dz], j: [-0.2 * u[0]!, -0.2 * u[1]!, dz] } });
  }
  const extra = m.nudo(8.2, 6.9, 4.1);
  m.barra(cabezas[2]!, extra, vigT, [0.2, 0, 1], { offsets: { i: [0.1, -0.2, 0.05], j: [-0.15, 0.1, 0.2] } }); // 8
  m.apoyo(extra, [false, false, true, false, false, false]);
  m.caso("G", [carga(extra, { fx: 4 })], [], [
    ...[4, 5, 6, 7].map((b) => ({ tipo: "distribuida" as const, barra: b, ejes: "global" as const, qa: [0, 0, -18] as Vec3 })),
    { tipo: "distribuida", barra: 8, ejes: "local", qa: [1, -2, -7] },
    { tipo: "puntual", barra: 4, ejes: "global", x: 2.3, F: [0, 0, -35] },
    { tipo: "puntual", barra: 8, ejes: "local", x: 1.5, F: [2, 3, -10], M: [1, -2, 0.5] },
  ]);
  m.caso("H", [carga(cabezas[1]!, { fx: 25 }), carga(cabezas[3]!, { fy: -15, mz: 4 })], [], [
    { tipo: "distribuida", barra: 1, ejes: "local", qa: [0, 2.5, 0] },
    { tipo: "puntual", barra: 6, ejes: "local", x: 3.3, M: [0, 0, 6] },
  ]);
  return m.modelo();
}

/** Liberaciones de todos los tipos en barras alineadas con los ejes, con y sin offsets (EB y Timoshenko). */
function liberaciones(): ModeloAnalitico {
  const m = new Constructor();
  const planta = [
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ] as const;
  const pies = planta.map(([x, y]) => m.nudo(x, y, 0));
  const cabezas = planta.map(([x, y]) => m.nudo(x, y, 3));
  const col = seccionRectangularTimoshenko(0.35, 0.35);
  const vigT = seccionRectangularTimoshenko(0.3, 0.6);
  const vigEB = seccionRectangular(0.3, 0.5);
  pies.forEach((p, c) => {
    m.apoyo(p);
    m.barra(p, cabezas[c]!, col, c % 2 ? [0, 1, 0] : [1, 0, 0]);
  });
  const L = (...g: number[]) => [0, 1, 2, 3, 4, 5].map((k) => g.includes(k)) as unknown as readonly [boolean, boolean, boolean, boolean, boolean, boolean];
  // 4: My y Mz en los dos extremos, torsión en j (biarticulada en los dos planos)
  m.barra(cabezas[0]!, cabezas[1]!, vigEB, [0, 0, 1], { liberaciones: { i: L(4, 5), j: L(3, 4, 5) } });
  // 5: axil liberado en i (Timoshenko)
  m.barra(cabezas[1]!, cabezas[2]!, vigT, [0, 0, 1], { liberaciones: { i: L(0) } });
  // 6: cortante Vz liberado en j y My en i, con zona rígida en i
  m.barra(cabezas[2]!, cabezas[3]!, vigT, [0, 0, 1], { liberaciones: { i: L(4), j: L(2) }, offsets: { i: [-0.25, 0, 0] } });
  // 7: torsión liberada en i y My en j, con zonas rígidas y descuelgue
  m.barra(cabezas[3]!, cabezas[0]!, vigEB, [0, 0, 1], { liberaciones: { i: L(3), j: L(4) }, offsets: { i: [0, -0.2, -0.1], j: [0, 0.2, -0.1] } });
  m.caso("G", [carga(cabezas[2]!, { fz: -20 })], [], [
    ...[4, 5, 6, 7].map((b) => ({ tipo: "distribuida" as const, barra: b, ejes: "global" as const, qa: [0, 0, -15] as Vec3 })),
    { tipo: "puntual", barra: 4, ejes: "local", x: 1.8, F: [0, 4, -25], M: [3, 0, 0] },
    { tipo: "puntual", barra: 7, ejes: "global", x: 2.2, F: [-6, 0, -12] },
  ]);
  m.caso("H", [carga(cabezas[0]!, { fx: 20, fy: 10 }), carga(cabezas[2]!, { mx: 5, mz: -3 })], [], [{ tipo: "distribuida", barra: 5, ejes: "local", qa: [2, 0, 0] }]);
  return m.modelo();
}

/** Estaciones de PyNite: fracciones de la longitud lejos de las cargas puntuales de los modelos. */
export const FRACCIONES_PYNITE = [0.04, 0.18, 0.33, 0.5, 0.67, 0.82, 0.96];

export const MODELOS_PYNITE: Record<string, () => ModeloAnalitico> = {
  "portico-espacial": porticoEspacial,
  "viga-gerber": vigaGerber,
};

export const MODELOS_OPENSEES: Record<string, () => ModeloAnalitico> = {
  timoshenko,
  offsets: () => offsets(true),
  "offsets-eb": () => offsets(false),
  liberaciones,
};

if (import.meta.main) {
  const salida = {
    fracciones: FRACCIONES_PYNITE,
    pynite: Object.fromEntries(Object.entries(MODELOS_PYNITE).map(([k, f]) => [k, f()])),
    opensees: Object.fromEntries(Object.entries(MODELOS_OPENSEES).map(([k, f]) => [k, f()])),
  };
  const ruta = join(import.meta.dirname, "modelos-oraculo.json");
  writeFileSync(ruta, JSON.stringify(salida, null, 1));
  console.log(`escrito ${ruta}`);
}
