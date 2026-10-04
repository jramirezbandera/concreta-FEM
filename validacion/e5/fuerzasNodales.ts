/**
 * Medidas del criterio 1 de E5 (fuerzas nodales de los elementos y de las restricciones): las usan
 * el test (src/motor/fuerzasNodales.test.ts) y el resumen del informe (resumen.ts).
 */
import { calcular } from "../../src/motor/calcular.ts";
import { FuerzasNodales } from "../../src/motor/fuerzasNodales.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio, type OpcionesEdificio } from "../../src/pruebas/edificio.ts";
import { laminaPlegada } from "../e3/metamorficas.ts";

export const BASE_E5: OpcionesEdificio = { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true, barrasE2: true, laminasE3: true };

export const MODELOS_FUERZAS_NODALES: [string, () => ModeloAnalitico][] = [
  ["lámina plegada", laminaPlegada],
  ["edificio E3 con diafragma y huellas", () => edificio({ ...BASE_E5, diafragma: true }).modelo],
  ["edificio E3 con muelles", () => edificio({ ...BASE_E5, muelles: true }).modelo],
];

/**
 * |ΣF| y |ΣM| (respecto al primer nudo) de unas fuerzas nodales (6 por nudo) aplicadas en `X`, y
 * su escala: max|F| y max(|M|, |x − x₀|·|F|). Las láminas de una huella no se deforman y su k·u es
 * puro redondeo: por eso el test compara con la escala de todo el modelo.
 */
export function autoequilibrio(g: ArrayLike<number>, X: readonly (readonly number[])[]): { F: number; M: number; escalaF: number; escalaM: number } {
  const F = [0, 0, 0];
  const M = [0, 0, 0];
  let escalaF = 0;
  let escalaM = 0;
  const x0 = X[0]!;
  X.forEach((xa, a) => {
    const x = [xa[0]! - x0[0]!, xa[1]! - x0[1]!, xa[2]! - x0[2]!];
    const f = [g[6 * a]!, g[6 * a + 1]!, g[6 * a + 2]!];
    const m = [g[6 * a + 3]!, g[6 * a + 4]!, g[6 * a + 5]!];
    for (let c = 0; c < 3; c++) F[c]! += f[c]!;
    M[0]! += m[0]! + x[1]! * f[2]! - x[2]! * f[1]!;
    M[1]! += m[1]! + x[2]! * f[0]! - x[0]! * f[2]!;
    M[2]! += m[2]! + x[0]! * f[1]! - x[1]! * f[0]!;
    escalaF = Math.max(escalaF, Math.hypot(...f));
    escalaM = Math.max(escalaM, Math.hypot(...m), Math.hypot(...x) * Math.hypot(...f));
  });
  return { F: Math.hypot(...F), M: Math.hypot(...M), escalaF, escalaM };
}

/** Peores errores de un modelo: [autoequilibrio de k·u, equilibrio de los nudos]. */
export function erroresFuerzasNodales(modelo: ModeloAnalitico): [number, number] {
  const casos = casosValidos(calcular(modelo));
  const fn = new FuerzasNodales(modelo);
  const nn = modelo.nudos.length;
  const xyz = (v: number) => [modelo.nudos[v]!.x, modelo.nudos[v]!.y, modelo.nudos[v]!.z];
  let peorElemento = 0;
  let peorNudo = 0;
  const restricciones = fn.restricciones(casos);
  casos.forEach((r, k) => {
    const suma = new Float64Array(6 * nn);
    const equilibrios: ReturnType<typeof autoequilibrio>[] = [];
    for (const e of fn.elementos) {
      if (e.tipo === "muelle" && e.nudos.length === 1) continue; // los muelles a tierra van en R
      equilibrios.push(autoequilibrio(fn.deElemento(e, null, r.u), e.nudos.map(xyz)));
      const g = fn.deElemento(e, k, r.u);
      e.nudos.forEach((v, a) => {
        for (let c = 0; c < 6; c++) suma[6 * v + c]! += g[6 * a + c]!;
      });
    }
    const eF = Math.max(...equilibrios.map((q) => q.escalaF));
    const eM = Math.max(...equilibrios.map((q) => q.escalaM));
    for (const q of equilibrios) peorElemento = Math.max(peorElemento, q.F / eF, q.M / eM);
    const C = new Float64Array(6 * nn);
    const lista = modelo.restricciones ?? [];
    for (const [ir, f] of restricciones[k]!) {
      const rs = lista[ir]!;
      [rs.maestro, ...rs.esclavos].forEach((v, a) => {
        for (let c = 0; c < 6; c++) C[6 * v + c]! += f[6 * a + c]!;
      });
    }
    const P = fn.cargasNodales(k);
    let escalaF = 0;
    let escalaM = 0;
    for (let v = 0; v < nn; v++) {
      escalaF = Math.max(escalaF, Math.hypot(suma[6 * v]!, suma[6 * v + 1]!, suma[6 * v + 2]!));
      escalaM = Math.max(escalaM, Math.hypot(suma[6 * v + 3]!, suma[6 * v + 4]!, suma[6 * v + 5]!));
    }
    for (let v = 0; v < nn; v++) {
      for (let c = 0; c < 6; c++) {
        const res = suma[6 * v + c]! - P[6 * v + c]! - r.reacciones[6 * v + c]! - C[6 * v + c]!;
        peorNudo = Math.max(peorNudo, Math.abs(res) / (c < 3 ? escalaF : escalaM));
      }
    }
  });
  return [peorElemento, peorNudo];
}
