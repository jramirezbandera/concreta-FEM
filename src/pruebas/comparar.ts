/**
 * Utilidades de comparación de resultados del motor para tests y oráculos: no es código del motor.
 */
import type { ResultadoCalculo, ResultadoCaso } from "../motor/modelo.ts";

/** Casos de un cálculo que tiene que ser válido; si no lo es, lanza con sus diagnósticos. */
export function casosValidos(r: ResultadoCalculo): ResultadoCaso[] {
  if (!r.valido) throw new Error(`cálculo no válido:\n${r.diagnosticos.map((d) => `  ${d.codigo}: ${d.mensaje}`).join("\n")}`);
  return r.casos;
}

/**
 * Error de resultantes de lámina (8 por lámina: N, M, Q) por grupos: max|a − b| de cada grupo
 * entre una escala. N y Q (kN/m) comparten escala, max(|N|, |Q|); la de M (kN·m/m) es max|M|, con
 * un mínimo de 1e-3 m por la de N y Q, para que un grupo de puro redondeo (la membrana de una
 * placa sin cargas en su plano) no divida ruido entre ruido. Devuelve el peor.
 */
export function errorLaminas(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dN = 0;
  let dM = 0;
  let dQ = 0;
  let mN = 0;
  let mM = 0;
  let mQ = 0;
  for (let i = 0; i < b.length; i += 8) {
    for (let c = 0; c < 8; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      const v = Math.abs(b[i + c]!);
      if (c < 3) [dN, mN] = [Math.max(dN, d), Math.max(mN, v)];
      else if (c < 6) [dM, mM] = [Math.max(dM, d), Math.max(mM, v)];
      else [dQ, mQ] = [Math.max(dQ, d), Math.max(mQ, v)];
    }
  }
  const fNQ = Math.max(mN, mQ);
  const fM = Math.max(mM, 1e-3 * fNQ);
  const r = (d: number, f: number) => (f > 0 ? d / f : d);
  return Math.max(r(dN, fNQ), r(dQ, fNQ), r(dM, fM));
}

/**
 * Error relativo por grupos de 6 por nudo (traslaciones / giros, o fuerzas / momentos):
 * max|a − b| / max|b| de cada grupo, el peor de los dos, sobre `nudos` (todos si se omite).
 */
export function errorPorGrupos(a: ArrayLike<number>, b: ArrayLike<number>, nudos?: readonly number[]): number {
  const lista = nudos ?? Array.from({ length: b.length / 6 }, (_, i) => i);
  let peor = 0;
  for (const g of [0, 3]) {
    let dif = 0;
    let ref = 0;
    for (const v of lista) {
      for (let c = g; c < g + 3; c++) {
        dif = Math.max(dif, Math.abs(a[6 * v + c]! - b[6 * v + c]!));
        ref = Math.max(ref, Math.abs(b[6 * v + c]!));
      }
    }
    peor = Math.max(peor, ref > 0 ? dif / ref : dif);
  }
  return peor;
}
