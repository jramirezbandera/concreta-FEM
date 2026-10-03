/**
 * Pruebas metamórficas de E2 (H38) con barras de Timoshenko, offsets, liberaciones y cargas de
 * barra: giro, renumeración, inversión del sentido de las barras y superposición. Las usan el
 * test (src/motor/propiedades-e2.test.ts) y el resumen del informe (resumen.ts).
 */
import { calcular } from "../../src/motor/calcular.ts";
import type { CargaBarra, CasoCarga, ModeloAnalitico, ResultadoCaso, Vec3 } from "../../src/motor/modelo.ts";
import { casosValidos, errorPorGrupos } from "../../src/pruebas/comparar.ts";
import { edificio, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";
import { girarModelo, girarVector6, invertirBarras, matrizGiro, permutacion, renumerarModelo } from "../../src/pruebas/transformar.ts";
import { MODELOS_OPENSEES, MODELOS_PYNITE } from "./modelos-oraculo.ts";

/** max|a − b| / max|b| por grupos de 6 (fuerzas y momentos) en vectores de 12 por barra. */
export function errorEsfuerzosBarras(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return errorPorGrupos(a, b);
}

const BASE_E2: OpcionesEdificio = { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true, barrasE2: true };

/** Modelos de la prueba y el giro admisible (los apoyos y diafragmas tienen que ser invariantes). */
export const MODELOS_PROPIEDADES: [string, () => ModeloAnalitico, number[]][] = [
  ["pórtico espacial", MODELOS_PYNITE["portico-espacial"]!, matrizGiro([0.3, -0.5, 0.8], 1.1)],
  ["viga de Gerber", MODELOS_PYNITE["viga-gerber"]!, matrizGiro([-0.6, 0.2, 0.4], 2.3)],
  ["Timoshenko", MODELOS_OPENSEES.timoshenko!, matrizGiro([1, 1, 1], 0.9)],
  ["offsets", MODELOS_OPENSEES.offsets!, matrizGiro([0, 0, 1], 0.7)],
  ["liberaciones", MODELOS_OPENSEES.liberaciones!, matrizGiro([0.2, -0.9, 0.4], -1.3)],
  ["edificio E2 con diafragma", () => edificio({ ...BASE_E2, diafragma: true }).modelo, matrizGiro([0, 0, 1], -0.4)],
  ["edificio E2 con muelles", () => edificio({ ...BASE_E2, muelles: true }).modelo, matrizGiro([0.3, -0.5, 0.8], 1.1)],
];

/** Errores metamórficos de un modelo: [giro, renumeración, inversión de barras, superposición]. */
export function erroresMetamorficos(m: ModeloAnalitico, R: number[]): number[] {
  const a = casosValidos(calcular(m));
  // giro y traslación
  const g = casosValidos(calcular(girarModelo(m, R, [12.3, -4.5, 2])));
  let giro = 0;
  for (let k = 0; k < a.length; k++) {
    giro = Math.max(
      giro,
      errorPorGrupos(g[k]!.u, girarVector6(R, a[k]!.u)),
      errorPorGrupos(g[k]!.reacciones, girarVector6(R, a[k]!.reacciones)),
      errorEsfuerzosBarras(g[k]!.esfuerzosBarras, a[k]!.esfuerzosBarras),
    );
  }
  // renumeración (las barras quedan en orden inverso)
  const nuevo = permutacion(m.nudos.length, 777);
  const r = casosValidos(calcular(renumerarModelo(m, nuevo)));
  const nb = m.barras!.length;
  let ren = 0;
  for (let k = 0; k < a.length; k++) {
    const ua = new Float64Array(a[k]!.u.length);
    nuevo.forEach((nv, v) => ua.set(a[k]!.u.subarray(6 * v, 6 * v + 6), 6 * nv));
    const ea = new Float64Array(12 * nb);
    for (let b = 0; b < nb; b++) ea.set(a[k]!.esfuerzosBarras.subarray(12 * b, 12 * b + 12), 12 * (nb - 1 - b));
    ren = Math.max(ren, errorPorGrupos(r[k]!.u, ua), errorEsfuerzosBarras(r[k]!.esfuerzosBarras, ea));
  }
  // inversión del sentido de las barras
  const inv = casosValidos(calcular(invertirBarras(m)));
  const signo = [1, 1, -1, 1, 1, -1];
  let invertida = 0;
  for (let k = 0; k < a.length; k++) {
    const ea = new Float64Array(12 * nb);
    for (let b = 0; b < nb; b++) {
      for (let c = 0; c < 6; c++) {
        ea[12 * b + c] = signo[c]! * a[k]!.esfuerzosBarras[12 * b + 6 + c]!;
        ea[12 * b + 6 + c] = signo[c]! * a[k]!.esfuerzosBarras[12 * b + c]!;
      }
    }
    invertida = Math.max(
      invertida,
      errorPorGrupos(inv[k]!.u, a[k]!.u),
      errorPorGrupos(inv[k]!.reacciones, a[k]!.reacciones),
      errorEsfuerzosBarras(inv[k]!.esfuerzosBarras, ea),
    );
  }
  // superposición: Σ λₖ·casoₖ (cargas nodales y de barra) = combinación de los resultados
  const lambda = m.casos.map((c, k) => (c.impuestos?.length ? 0 : [1.35, -0.8, 1.5, 0.6, -1.1][k % 5]!));
  const escalar = (v: Vec3 | undefined, f: number) => v && (v.map((x) => f * x) as unknown as Vec3);
  const combinado: CasoCarga = {
    id: "comb",
    nodales: m.casos.flatMap((c, k) => (c.nodales ?? []).map((n) => ({ nudo: n.nudo, f: n.f.map((x) => lambda[k]! * x) as never }))),
    barras: m.casos.flatMap((c, k) =>
      (c.barras ?? []).map((cb): CargaBarra =>
        cb.tipo === "puntual" ? { ...cb, F: escalar(cb.F, lambda[k]!), M: escalar(cb.M, lambda[k]!) } : { ...cb, qa: escalar(cb.qa, lambda[k]!)!, qb: escalar(cb.qb, lambda[k]!) },
      ),
    ),
  };
  const [s] = casosValidos(calcular({ ...m, casos: [combinado] }));
  const suma = (sel: (c: ResultadoCaso) => Float64Array) => {
    const t = new Float64Array(sel(a[0]!).length);
    a.forEach((c, k) => sel(c).forEach((v, i) => (t[i]! += lambda[k]! * v)));
    return t;
  };
  const sup = Math.max(errorPorGrupos(s!.u, suma((c) => c.u)), errorEsfuerzosBarras(s!.esfuerzosBarras, suma((c) => c.esfuerzosBarras)));
  return [giro, ren, invertida, sup];
}
