/**
 * Medidas del criterio 2 de E5 (corte por fuerzas nodales): las usan los tests
 * (src/motor/cortes.test.ts) y el resumen del informe (resumen.ts).
 *
 * Oráculo de equilibrio: si un corte separa el modelo en dos, lo que el lado B ejerce sobre el A
 * es exactamente −(cargas + reacciones del lado A). La resultante de las cargas se calcula por otro
 * camino que el corte: con las resultantes reales de las cargas de E2 y E3 (integrales cerradas,
 * no las fuerzas equivalentes), partiendo las cargas de las barras que cruzan el plano, más las
 * cargas nodales y las reacciones de los nudos del lado A.
 */
import { cargasDeBarrasDelCaso, type BarraPreparada } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes, TOL_CORTE, type Corte, type ResultadoCorte } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { elementosDelModelo, geometria } from "../../src/motor/elementos.ts";
import { cargasDeLaminasDelCaso, type LaminaPreparada } from "../../src/motor/laminas.ts";
import type { CargaBarra, CargaLamina, ModeloAnalitico, ResultadoCaso, Vec3 } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { ARTICULADO, carga, Constructor, seccionRectangularTimoshenko } from "../../src/pruebas/constructor.ts";
import { edificio } from "../../src/pruebas/edificio.ts";
import { girar, girarModelo, invertirBarras, invertirLaminas, matrizGiro, permutacion, renumerarModelo } from "../../src/pruebas/transformar.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";
import { fijarEjes, laminaPlegada } from "../e3/metamorficas.ts";
import { BASE_E5 } from "./fuerzasNodales.ts";

const cruz = (a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/**
 * Fuerza y momento (respecto al origen del corte) de las cargas y reacciones del lado A, por caso
 * (6 por caso), con sus escalas: Σ|F| y Σ(|r|·|F| + |M|).
 */
export function ladoA(modelo: ModeloAnalitico, corte: Corte, casos: readonly ResultadoCaso[]): { S: Float64Array; escalaF: number[]; escalaM: number[] } {
  const geo = geometria(modelo);
  const diag = new Diagnosticos();
  const elementos = elementosDelModelo(modelo, geo, diag);
  const nn = modelo.nudos.length;
  const O = corte.origen;
  const nx = Math.hypot(...corte.x);
  const ex = corte.x.map((c) => c / nx);
  const dist = (p: ArrayLike<number>) => (p[0]! - O[0]) * ex[0]! + (p[1]! - O[1]) * ex[1]! + (p[2]! - O[2]) * ex[2]!;
  const lado = new Int8Array(nn);
  for (let v = 0; v < nn; v++) {
    const d = dist(geo.xyz.subarray(3 * v, 3 * v + 3));
    lado[v] = Math.abs(d) <= TOL_CORTE ? 0 : d < 0 ? -1 : 1;
  }
  const barras: (BarraPreparada | undefined)[] = [];
  const laminas: (LaminaPreparada | undefined)[] = [];
  for (const e of elementos) {
    if (e.barra) barras[e.indice] = e.barra;
    if (e.lamina) laminas[e.indice] = e.lamina;
  }
  const deA = (nudos: readonly number[]) => Math.min(...nudos.map((v) => lado[v]!)) === -1 && Math.max(...nudos.map((v) => lado[v]!)) <= 0;
  const S = new Float64Array(6 * casos.length);
  const escalaF: number[] = [];
  const escalaM: number[] = [];
  casos.forEach((r, k) => {
    const caso = modelo.casos[k]!;
    // Cargas de lámina sobre láminas del lado A
    const cl: CargaLamina[] = (caso.laminas ?? []).filter((c) => deA(modelo.laminas![c.lamina]!.nudos));
    // Cargas de barra: las de barras del lado A, y la parte del lado A de las que cruzan
    const cb: CargaBarra[] = [];
    for (const c of caso.barras ?? []) {
      const b = modelo.barras![c.barra]!;
      if (deA(b.nudos)) {
        cb.push(c);
        continue;
      }
      const [si, sj] = b.nudos.map((v) => lado[v]!);
      if (si! * sj! !== -1) continue;
      const pb = barras[c.barra]!;
      const dI = dist(pb.ip);
      const dJ = dist(pb.jp);
      // Parte del tramo flexible del lado A: [0, x) si el lado A es el del nudo i, (x, L] si es el
      // del j; si el cruce cae en un offset, todo el tramo o nada
      let tramo: [number, number];
      let enA: (x: number) => boolean;
      if (dI * dJ < 0) {
        const x = (dI / (dI - dJ)) * pb.L;
        tramo = si === -1 ? [0, x] : [x, pb.L];
        enA = si === -1 ? (p) => p < x : (p) => p > x;
      } else {
        const s = Math.abs(dI) > TOL_CORTE ? Math.sign(dI) : Math.sign(dJ);
        tramo = s < 0 ? [0, pb.L] : [0, 0];
        enA = () => s < 0;
      }
      if (c.tipo === "puntual") {
        if (enA(c.x)) cb.push(c);
        continue;
      }
      const a = c.a ?? 0;
      const bb = c.b ?? pb.L;
      const a2 = Math.max(a, tramo[0]);
      const b2 = Math.min(bb, tramo[1]);
      if (!(b2 > a2)) continue;
      const qb = c.qb ?? c.qa;
      const q = (x: number): Vec3 => {
        const t = (x - a) / (bb - a);
        return [0, 1, 2].map((i) => c.qa[i]! + t * (qb[i]! - c.qa[i]!)) as unknown as Vec3;
      };
      cb.push({ ...c, a: a2, b: b2, qa: q(a2), qb: q(b2) });
    }
    const rb = cargasDeBarrasDelCaso(caso.id, cb, barras, modelo, geo, diag).resultante;
    const rl = cargasDeLaminasDelCaso(caso.id, cl, laminas, modelo, geo, diag).resultante;
    const F = [rb.F[0] + rl.F[0], rb.F[1] + rl.F[1], rb.F[2] + rl.F[2]];
    // Momento de las cargas respecto a O: M_C + (C − O) × F
    const CO = [geo.centro[0] - O[0], geo.centro[1] - O[1], geo.centro[2] - O[2]];
    const mCO = cruz(CO, F);
    const M = [rb.M[0] + rl.M[0] + mCO[0], rb.M[1] + rl.M[1] + mCO[1], rb.M[2] + rl.M[2] + mCO[2]];
    let eF = rb.escalaF + rl.escalaF;
    let eM = rb.escalaM + rl.escalaM + Math.hypot(...CO) * eF;
    // Cargas nodales y reacciones de los nudos del lado A
    const f = new Float64Array(6 * nn);
    for (const c of caso.nodales ?? []) for (let g = 0; g < 6; g++) f[6 * c.nudo + g]! += c.f[g]!;
    for (let v = 0; v < nn; v++) {
      if (lado[v] !== -1) continue;
      for (const vecs of [f, r.reacciones]) {
        const Fv = vecs.subarray(6 * v, 6 * v + 3);
        const Mv = vecs.subarray(6 * v + 3, 6 * v + 6);
        if (Fv.every((c) => c === 0) && Mv.every((c) => c === 0)) continue;
        const rv = [geo.xyz[3 * v]! - O[0], geo.xyz[3 * v + 1]! - O[1], geo.xyz[3 * v + 2]! - O[2]];
        const m = cruz(rv, Fv);
        for (let c = 0; c < 3; c++) {
          F[c]! += Fv[c]!;
          M[c]! += Mv[c]! + m[c]!;
        }
        eF += Math.hypot(...Fv);
        eM += Math.hypot(...rv) * Math.hypot(...Fv) + Math.hypot(...Mv);
      }
    }
    S.set([...F, ...M], 6 * k);
    escalaF.push(eF);
    escalaM.push(eM);
  });
  if (diag.hayErrores) throw new Error(`ladoA: ${diag.lista[0]!.mensaje}`);
  return { S, escalaF, escalaM };
}

/** Fuerza y momento globales (respecto al origen) de unos esfuerzos de corte [N, Vy, Vz, T, My, Mz]. */
export function aGlobales(ejes: ArrayLike<number>, s: ArrayLike<number>): number[] {
  const F = [0, 1, 2].map((q) => s[0]! * ejes[q]! + s[1]! * ejes[3 + q]! + s[2]! * ejes[6 + q]!);
  const M = [0, 1, 2].map((q) => s[3]! * ejes[q]! - s[4]! * ejes[3 + q]! + s[5]! * ejes[6 + q]!);
  return [...F, ...M];
}

/**
 * Error de equilibrio de un corte que separa el modelo: |corte + (cargas + reacciones de A)| entre
 * la escala de las fuerzas (o de los momentos) del lado A; el peor de los casos.
 */
export function errorEquilibrioCorte(modelo: ModeloAnalitico, corte: Corte, casos: readonly ResultadoCaso[], res: ResultadoCorte): number {
  const { S, escalaF, escalaM } = ladoA(modelo, corte, casos);
  let peor = 0;
  casos.forEach((_, k) => {
    const g = aGlobales(res.ejes, res.esfuerzos.subarray(6 * k, 6 * k + 6));
    const dF = Math.hypot(g[0]! + S[6 * k]!, g[1]! + S[6 * k + 1]!, g[2]! + S[6 * k + 2]!);
    const dM = Math.hypot(g[3]! + S[6 * k + 3]!, g[4]! + S[6 * k + 4]!, g[5]! + S[6 * k + 5]!);
    if (escalaF[k]! > 0) peor = Math.max(peor, dF / escalaF[k]!);
    if (escalaM[k]! > 0) peor = Math.max(peor, dM / escalaM[k]!);
  });
  return peor;
}

// ---------------------------------------------------------------------------------------------
// Modelos

/**
 * Losa unidireccional de L × b apoyada (w = 0) en x = 0 y x = L, libre en y = 0 y y = b, con ν = 0,2
 * (hay efecto de placa: el reparto según y no es uniforme). Carga uniforme q, una carga de línea
 * oblicua y una puntual con momento dentro de elementos. Malla nx × ny.
 */
export function losaUnidireccional(nx: number, ny: number, L = 6, b = 2): { modelo: ModeloAnalitico; L: number; b: number; q: number } {
  const m = new Constructor();
  const g = mallaRectangular(m, { a: L, b, nx, ny, material: { E: 3e7, nu: 0.2, t: 0.25 } });
  for (let j = 0; j <= ny; j++) {
    m.apoyo(g.nudos[0]![j]!, [j === 0, true, true, false, false, false]);
    m.apoyo(g.nudos[nx]![j]!, [false, j === 0, true, false, false, false]);
  }
  const q = -8;
  m.caso("q", [], [], [], g.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, q] })));
  const i1 = Math.floor(nx / 3);
  const j1 = Math.floor(ny / 2);
  const centro = (i: number, j: number, fx: number, fy: number) => g.punto(((i + fx) * L) / nx, ((j + fy) * b) / ny);
  m.caso("otras", [carga(g.nudos[nx - 1]![1]!, { fz: -3, mx: 1 })], [], [], [
    { tipo: "linea", lamina: g.laminas[i1]![j1]!, ejes: "global", a: centro(i1, j1, 0.2, 0.1), b: centro(i1, j1, 0.7, 0.9), qa: [0, 0, -6], qb: [0.5, 0, -2] },
    { tipo: "puntual", lamina: g.laminas[nx - 2]![0]!, ejes: "local", punto: centro(nx - 2, 0, 0.35, 0.6), F: [0.3, 0, -10], M: [1.5, -2, 0.4] },
  ]);
  return { modelo: m.modelo(), L, b, q };
}

/** Losa en ménsula de L × b empotrada en x = 0, con una carga de línea F (kN/m) a lo largo del borde libre. */
export function mensulaPlaca(nx: number, ny: number, L = 3, b = 1.5, F = 4): ModeloAnalitico {
  const m = new Constructor();
  const g = mallaRectangular(m, { a: L, b, nx, ny, material: { E: 3e7, nu: 0.3, t: 0.2 } });
  for (let j = 0; j <= ny; j++) m.apoyo(g.nudos[0]![j]!);
  m.caso("punta", [], [], [], g.laminas[nx - 1]!.map((l, j): CargaLamina => ({ tipo: "linea", lamina: l, ejes: "global", a: g.punto(L, (j * b) / ny), b: g.punto(L, ((j + 1) * b) / ny), qa: [0, 0, -F] })));
  return m.modelo();
}

/** Pórtico plano de barras de E2 con offsets, una rótula y cargas de barra, para comparar el corte con los diagramas. */
export function portico(): ModeloAnalitico {
  const m = new Constructor();
  const s = seccionRectangularTimoshenko(0.3, 0.5);
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(0, 0, 3);
  const c = m.nudo(5, 0, 3);
  const d = m.nudo(5, 0, 0);
  m.barra(a, b, s, [1, 0, 0]);
  m.barra(b, c, s, [0, 0, 1], { offsets: { i: [0.2, 0, -0.1], j: [-0.2, 0, -0.1] }, liberaciones: { j: [false, false, false, false, true, false] } });
  m.barra(d, c, s, [1, 0, 0]);
  m.apoyo(a);
  m.apoyo(d, ARTICULADO);
  m.caso("G", [carga(b, { fx: 4 })], [], [
    { tipo: "distribuida", barra: 1, ejes: "global", qa: [0, 0, -12], qb: [0, -1, -6], a: 0.4, b: 4.1 },
    { tipo: "puntual", barra: 1, ejes: "local", x: 1.7, F: [1, 2, -9], M: [0.5, 3, -1] },
    { tipo: "distribuida", barra: 0, ejes: "local", qa: [0, 1, 2] },
  ]);
  return m.modelo();
}

/** Cortes que separan cada modelo en dos, con el rectángulo cubriéndolo entero. */
export function cortesCompletos(): [string, () => ModeloAnalitico, Corte[]][] {
  const grande = [-100, 100] as const;
  const vertical = (x: number, id: string): Corte => ({ id, origen: [x, 0.37, 1.1], x: [1, 0, 0], vz: [0, 0, 1], y: grande, z: grande });
  const losa = () => losaUnidireccional(12, 4).modelo;
  return [
    ["losa unidireccional", losa, [0.5, 1, 2.5, 3, 5.5].map((x) => vertical(x, `x = ${x}`))],
    [
      "lámina plegada",
      laminaPlegada,
      [
        vertical(2, "x = 2"),
        { id: "y = 1, hacia −Y", origen: [1.3, 1, 2], x: [0, -1, 0], vz: [0, 0, 1], y: grande, z: grande },
        { id: "z = 1, normal +Z", origen: [0, 0, 1], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande },
      ],
    ],
    [
      "edificio E3 con diafragma y huellas",
      () => edificio({ ...BASE_E5, diafragma: true }).modelo,
      [
        { id: "planta 1 (z = 3)", origen: [5, 4, 3], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande },
        vertical(2, "x = 2 (atraviesa el diafragma)"),
        vertical(5, "x = 5 (por los pilares: atraviesa las huellas)"),
        { id: "y = 4, hacia −Y (por las huellas)", origen: [5, 4, 3], x: [0, -1, 0], vz: [0, 0, 1], y: grande, z: grande },
      ],
    ],
    [
      "edificio E3 con diafragma, sin muro",
      () => edificio({ ...BASE_E5, diafragma: true, muro: false }).modelo,
      [
        { id: "mitad de la planta 1 (z = 1,4): por los pilares", origen: [5, 4, 1.4], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande },
        { id: "mitad de la planta 2 (z = 4,6), hacia abajo", origen: [3, 1, 4.6], x: [0, 0, -1], vz: [0, 1, 0], y: grande, z: grande },
      ],
    ],
    [
      "edificio E3 con muelles",
      () => edificio({ ...BASE_E5, muelles: true }).modelo,
      [
        { id: "planta 2 (z = 6)", origen: [5, 4, 6], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande },
        vertical(6, "x = 6"),
        vertical(5, "x = 5 (por los pilares)"),
      ],
    ],
    ["pórtico", portico, [vertical(1.3, "x = 1,3 (por la viga)"), { id: "z = 1,5 (por los pilares)", origen: [2, 0, 1.5], x: [0, 0, -1], vz: [1, 0, 0], y: grande, z: grande }]],
  ];
}

/** Peor error de equilibrio de los cortes completos de un modelo, con sus diagnósticos. */
export function erroresCortesCompletos(fabrica: () => ModeloAnalitico, cortes: readonly Corte[]): { error: number; resultados: ResultadoCorte[] } {
  const modelo = fabrica();
  const casos = casosValidos(calcular(modelo));
  const ct = new Cortes(modelo);
  let error = 0;
  const resultados = cortes.map((c) => {
    const r = ct.cortar(c, casos);
    if (!r.valido) throw new Error(`corte ${c.id} no válido: ${r.diagnosticos.map((d) => d.mensaje).join(" | ")}`);
    error = Math.max(error, errorEquilibrioCorte(modelo, c, casos, r));
    return r;
  });
  return { error, resultados };
}

/**
 * Pruebas metamórficas de los cortes (H38): giro y traslación del modelo y del corte, renumeración,
 * inversión del sentido de las barras e inversión del orden de los nudos de las láminas. Los
 * esfuerzos del corte no cambian. Devuelve el peor error relativo (por grupos: fuerzas y momentos).
 */
export function erroresMetamorficosCorte(fabrica: () => ModeloAnalitico, cortes: readonly Corte[], R: number[]): number {
  const m = fabrica();
  const ref = (modelo: ModeloAnalitico, cs: readonly Corte[]) => {
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    return cs.map((c) => ct.cortar(c, casos).esfuerzos);
  };
  const a = ref(m, cortes);
  const t: Vec3 = [12.3, -4.5, 2];
  const girado = cortes.map((c): Corte => ({ ...c, origen: girar(R, c.origen).map((v, q) => v + t[q]!) as unknown as Vec3, x: girar(R, c.x), vz: girar(R, c.vz) }));
  const variantes: ModeloAnalitico[] = [renumerarModelo(m, permutacion(m.nudos.length, 777)), invertirBarras(m), invertirLaminas(m).modelo];
  const resultados = [ref(girarModelo(fijarEjes(m), R, t), girado), ...variantes.map((v) => ref(v, cortes))];
  let peor = 0;
  for (const r of resultados) {
    a.forEach((ea, i) => {
      const eb = r[i]!;
      for (const g of [0, 3]) {
        let dif = 0;
        let esc = 0;
        for (let k = 0; k < ea.length; k += 6) {
          for (let c = g; c < g + 3; c++) {
            dif = Math.max(dif, Math.abs(ea[k + c]! - eb[k + c]!));
            esc = Math.max(esc, Math.abs(ea[k + c]!));
          }
        }
        peor = Math.max(peor, esc > 0 ? dif / esc : dif);
      }
    });
  }
  return peor;
}

export const GIRO_CORTES = matrizGiro([0.3, -0.5, 0.8], 1.1);
