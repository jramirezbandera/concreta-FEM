/**
 * Pruebas metamórficas de E3 (H38) con láminas, multiplicadores, ejes de usuario y cargas de
 * lámina: giro, renumeración (con cambio del nudo inicial de cada lámina), inversión del orden de
 * los nudos de las láminas y superposición. Las usan el test (src/motor/propiedades-e3.test.ts) y
 * el resumen del informe (resumen.ts).
 */
import { calcular } from "../../src/motor/calcular.ts";
import type { CargaBarra, CargaLamina, CasoCarga, ModeloAnalitico, ResultadoCaso, Vec3 } from "../../src/motor/modelo.ts";
import { casosValidos, errorLaminas, errorPorGrupos } from "../../src/pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO, seccionRectangularTimoshenko } from "../../src/pruebas/constructor.ts";
import { edificio, RETICULAR, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";
import { fijarEjes, girarModelo, girarVector6, invertirLaminas, matrizGiro, permutacion, renumerarModelo } from "../../src/pruebas/transformar.ts";

export { fijarEjes };
import { MODELOS_PYNITE_E3 } from "./modelos-oraculo.ts";

/**
 * Lámina plegada: losa horizontal de 4 × 3 (reticular con eje 1 a 30°), muro vertical que cuelga
 * de un borde (ejes de CSI) y faldón inclinado en el borde opuesto (eje 1 dado), con una viga de
 * borde descolgada en el pliegue. Empotrada al pie del muro y articulada al pie del faldón. Cargas
 * de lámina de los tres tipos, en ejes locales y globales.
 */
export function laminaPlegada(): ModeloAnalitico {
  const m = new Constructor();
  const mat = { E: 3e7, nu: 0.2, t: 0.2 };
  const c30 = Math.cos(Math.PI / 6);
  const s30 = Math.sin(Math.PI / 6);
  // losa: x ∈ [0, 4], y ∈ [0, 3], z = 3
  const losa = mallaRectangular(m, { a: 4, b: 3, nx: 4, ny: 3, origen: [0, 0, 3], material: mat, prefijo: "S", lamina: { multiplicadores: RETICULAR, eje1: [c30, s30, 0] } });
  // muro: cuelga del borde y = 0 hasta z = 0 (normal −Y); comparte con la losa los nudos de z = 3
  const muro = mallaRectangular(m, { a: 4, b: 3, nx: 4, ny: 3, origen: [0, 0, 0], ey: [0, 0, 1], material: { ...mat, t: 0.25 }, prefijo: "W", existente: (i, j) => (j === 3 ? losa.nudos[i]![0]! : undefined) });
  // faldón: del borde y = 3 baja hasta (y = 5, z = 1.5); comparte con la losa los nudos de y = 3
  const d = Math.hypot(2, 1.5);
  const faldon = mallaRectangular(m, {
    a: 4,
    b: d,
    nx: 4,
    ny: 2,
    origen: [0, 3, 3],
    ey: [0, 2 / d, -1.5 / d],
    material: mat,
    prefijo: "F",
    lamina: { eje1: [1, 0, 0.3] },
    existente: (i, j) => (j === 0 ? losa.nudos[i]![3]! : undefined),
  });
  // viga de borde en y = 3 (pliegue), descolgada
  for (let i = 0; i < 4; i++) m.barra(losa.nudos[i]![3]!, losa.nudos[i + 1]![3]!, seccionRectangularTimoshenko(0.3, 0.5), [0, 0, 1], { offsets: { i: [0, 0, -0.15], j: [0, 0, -0.15] } });
  for (let i = 0; i <= 4; i++) {
    m.apoyo(muro.nudos[i]![0]!, EMPOTRADO);
    m.apoyo(faldon.nudos[i]![2]!, [true, true, true, false, false, false]);
  }
  const cl: CargaLamina[] = [
    ...losa.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -9] })),
    ...faldon.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "local", q: [0.4, -0.3, -2.5] })),
    { tipo: "linea", lamina: losa.laminas[1]![1]!, ejes: "global", a: losa.punto(1.2, 1.3), b: losa.punto(1.8, 1.9), qa: [0, 0, -6], qb: [0.5, 0, -3] },
    { tipo: "puntual", lamina: losa.laminas[2]![2]!, ejes: "local", punto: losa.punto(2.4, 2.7), F: [1, 2, -15], M: [2, -1, 0.5] },
  ];
  const empuje: CargaLamina[] = muro.laminas.flat().map((l, k) => {
    const j = k % 3;
    const p = (z: number): Vec3 => [0, 0, -4 * (3 - z)];
    return { tipo: "superficie", lamina: l, ejes: "local", q: [p(j), p(j), p(j + 1), p(j + 1)] };
  });
  const viga: CargaBarra[] = [{ tipo: "distribuida", barra: 1, ejes: "global", qa: [0, 0, -5] }];
  m.caso("G", [], [], viga, cl);
  m.caso("empuje", [carga(losa.nudos[4]![0]!, { fx: 3 })], [], [], empuje);
  m.caso("puntual", [carga(losa.nudos[2]![2]!, { fz: -20, mx: 2 })]);
  return m.modelo();
}

const BASE_E3: OpcionesEdificio = { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true, barrasE2: true, laminasE3: true };

/** Modelos y giro (null: sin prueba de giro, porque sus apoyos no son invariantes). */
export const MODELOS_PROPIEDADES_E3: [string, () => ModeloAnalitico, number[] | null][] = [
  ["lámina plegada", laminaPlegada, matrizGiro([0.3, -0.5, 0.8], 1.1)],
  ["edificio E3 con diafragma", () => edificio({ ...BASE_E3, diafragma: true }).modelo, matrizGiro([0, 0, 1], -0.4)],
  ["edificio E3 con muelles", () => edificio({ ...BASE_E3, muelles: true }).modelo, matrizGiro([-0.6, 0.2, 0.4], 2.3)],
  ...Object.entries(MODELOS_PYNITE_E3).map(([k, f]): [string, () => ModeloAnalitico, null] => [`PyNite: ${k}`, f, null]),
];

/** Errores metamórficos: [giro (o NaN), renumeración, inversión del orden de nudos, superposición]. */
export function erroresMetamorficosE3(m: ModeloAnalitico, R: number[] | null): number[] {
  const a = casosValidos(calcular(m));
  const nl = m.laminas!.length;
  const nb = m.barras?.length ?? 0;
  // giro y traslación, con los ejes de las láminas fijados
  let giro = Number.NaN;
  if (R) {
    giro = 0;
    const g = casosValidos(calcular(girarModelo(fijarEjes(m), R, [12.3, -4.5, 2])));
    for (let k = 0; k < a.length; k++) {
      giro = Math.max(
        giro,
        errorPorGrupos(g[k]!.u, girarVector6(R, a[k]!.u)),
        errorPorGrupos(g[k]!.reacciones, girarVector6(R, a[k]!.reacciones)),
        nb ? errorPorGrupos(g[k]!.esfuerzosBarras, a[k]!.esfuerzosBarras) : 0,
        errorLaminas(g[k]!.esfuerzosLaminas, a[k]!.esfuerzosLaminas),
      );
    }
  }
  // renumeración: barras y láminas en orden inverso, y cada lámina empieza por su segundo nudo
  const nuevo = permutacion(m.nudos.length, 777);
  const r = casosValidos(calcular(renumerarModelo(m, nuevo)));
  let ren = 0;
  for (let k = 0; k < a.length; k++) {
    const ua = new Float64Array(a[k]!.u.length);
    nuevo.forEach((nv, v) => ua.set(a[k]!.u.subarray(6 * v, 6 * v + 6), 6 * nv));
    const la = new Float64Array(8 * nl);
    for (let l = 0; l < nl; l++) la.set(a[k]!.esfuerzosLaminas.subarray(8 * l, 8 * l + 8), 8 * (nl - 1 - l));
    ren = Math.max(ren, errorPorGrupos(r[k]!.u, ua), errorLaminas(r[k]!.esfuerzosLaminas, la));
  }
  // inversión del orden de los nudos de las láminas
  const inv = invertirLaminas(m);
  const b = casosValidos(calcular(inv.modelo));
  let invertida = 0;
  for (let k = 0; k < a.length; k++) {
    const la = new Float64Array(8 * nl);
    for (let l = 0; l < nl; l++) {
      const s = inv.signos(l);
      for (let c = 0; c < 8; c++) la[8 * l + c] = s[c]! * a[k]!.esfuerzosLaminas[8 * l + c]!;
    }
    invertida = Math.max(invertida, errorPorGrupos(b[k]!.u, a[k]!.u), errorPorGrupos(b[k]!.reacciones, a[k]!.reacciones), errorLaminas(b[k]!.esfuerzosLaminas, la));
  }
  // superposición: Σ λₖ·casoₖ (cargas nodales, de barra y de lámina) = combinación de los resultados
  const lambda = m.casos.map((c, k) => (c.impuestos?.length ? 0 : [1.35, -0.8, 1.5, 0.6, -1.1][k % 5]!));
  const f = (v: Vec3 | undefined, x: number) => v && (v.map((y) => x * y) as unknown as Vec3);
  const combinado: CasoCarga = {
    id: "comb",
    nodales: m.casos.flatMap((c, k) => (c.nodales ?? []).map((n) => ({ nudo: n.nudo, f: n.f.map((x) => lambda[k]! * x) as never }))),
    barras: m.casos.flatMap((c, k) =>
      (c.barras ?? []).map((cb): CargaBarra => (cb.tipo === "puntual" ? { ...cb, F: f(cb.F, lambda[k]!), M: f(cb.M, lambda[k]!) } : { ...cb, qa: f(cb.qa, lambda[k]!)!, qb: f(cb.qb, lambda[k]!) })),
    ),
    laminas: m.casos.flatMap((c, k) =>
      (c.laminas ?? []).map((cl): CargaLamina => {
        const x = lambda[k]!;
        if (cl.tipo === "superficie") return { ...cl, q: Array.isArray(cl.q[0]) ? ((cl.q as readonly Vec3[]).map((q) => f(q, x)!) as never) : f(cl.q as Vec3, x)! };
        if (cl.tipo === "linea") return { ...cl, qa: f(cl.qa, x)!, qb: f(cl.qb, x) };
        return { ...cl, F: f(cl.F, x), M: f(cl.M, x) };
      }),
    ),
  };
  const [s] = casosValidos(calcular({ ...m, casos: [combinado] }));
  const suma = (sel: (c: ResultadoCaso) => Float64Array) => {
    const t = new Float64Array(sel(a[0]!).length);
    a.forEach((c, k) => sel(c).forEach((v, i) => (t[i] += lambda[k]! * v)));
    return t;
  };
  const sup = Math.max(
    errorPorGrupos(s!.u, suma((c) => c.u)),
    nb ? errorPorGrupos(s!.esfuerzosBarras, suma((c) => c.esfuerzosBarras)) : 0,
    errorLaminas(s!.esfuerzosLaminas, suma((c) => c.esfuerzosLaminas)),
  );
  return [giro, ren, invertida, sup];
}
