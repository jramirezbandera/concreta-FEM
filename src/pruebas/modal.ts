/**
 * Modos de vibración y combinaciones espectrales de modelos pequeños, para validar el motor estático
 * con los ejemplos de CSI que dan periodos (SAP2000 1-022 y 1-024): no es código del motor (el
 * análisis modal es de E7).
 *
 * Cuando la masa sólo está en unos pocos GDL (los de los diafragmas), condensar la rigidez a esos
 * GDL es exacto: los demás no tienen inercia y siguen estáticamente a los primeros. La rigidez
 * condensada es la inversa de la flexibilidad en esos GDL, que da el motor con una solución
 * estática por GDL con masa. Los periodos salen así de soluciones estáticas, sin aproximación.
 */
import { calcular } from "../motor/calcular.ts";
import type { CargaNodal, Gdl, ModeloAnalitico } from "../motor/modelo.ts";
import { casosValidos } from "./comparar.ts";

export interface GdlMasa {
  nudo: number;
  gdl: Gdl;
}

/**
 * Flexibilidad F (n×n, por filas) en los GDL dados: F[i][j] = desplazamiento del GDL j bajo una
 * fuerza unidad en el GDL i. Se calcula con los apoyos y restricciones del modelo y sin sus casos.
 */
export function flexibilidad(modelo: ModeloAnalitico, gdl: readonly GdlMasa[]): number[][] {
  const casos = gdl.map((g, i) => {
    const f = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
    f[g.gdl] = 1;
    return { id: `unidad${i}`, nodales: [{ nudo: g.nudo, f } as CargaNodal] };
  });
  const r = casosValidos(calcular({ ...modelo, casos }));
  return r.map((c) => gdl.map((g) => c.u[6 * g.nudo + g.gdl]!));
}

/** Inversa de una matriz pequeña por Gauss–Jordan con pivote parcial. */
export function inversa(A: readonly (readonly number[])[]): number[][] {
  const n = A.length;
  const a = A.map((f, i) => [...f, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(a[i]![c]!) > Math.abs(a[p]![c]!)) p = i;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const piv = a[c]![c]!;
    for (let j = 0; j < 2 * n; j++) a[c]![j]! /= piv;
    for (let i = 0; i < n; i++) {
      if (i === c) continue;
      const f = a[i]![c]!;
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[i]![j]! -= f * a[c]![j]!;
    }
  }
  return a.map((f) => f.slice(n));
}

export interface Modos {
  /** ω² en orden creciente (rad²/s²). */
  omega2: number[];
  /** Periodos T = 2π/ω (s). */
  periodos: number[];
  /** Modos normalizados a la masa (φᵀ·M·φ = 1): `modos[n][i]` es la componente i del modo n. */
  modos: number[][];
}

/**
 * Problema K·φ = ω²·M·φ con M diagonal positiva: Jacobi cíclico sobre M^(−1/2)·K·M^(−1/2),
 * con los vectores. K tiene que ser simétrica (se simetriza: la de la flexibilidad lo es por Betti).
 */
export function modos(K: readonly (readonly number[])[], masas: readonly number[]): Modos {
  const n = K.length;
  const s = masas.map((m) => 1 / Math.sqrt(m));
  const a = K.map((f, i) => f.map((_, j) => (0.5 * (K[i]![j]! + K[j]![i]!)) * s[i]! * s[j]!));
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let barrido = 0; barrido < 100; barrido++) {
    let off = 0;
    let tot = 0;
    for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) (p === q ? (tot += a[p]![q]! ** 2) : (off += a[p]![q]! ** 2));
    if (off <= 1e-32 * tot) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (apq === 0) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sn = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - sn * akq;
          a[k]![q] = sn * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - sn * aqk;
          a[q]![k] = sn * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - sn * vkq;
          v[k]![q] = sn * vkp + c * vkq;
        }
      }
    }
  }
  const orden = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[x]![x]! - a[y]![y]!);
  const omega2 = orden.map((i) => a[i]![i]!);
  return {
    omega2,
    periodos: omega2.map((w2) => (2 * Math.PI) / Math.sqrt(w2)),
    modos: orden.map((col) => v.map((fila, i) => fila[col]! * s[i]!)),
  };
}

/** Factores de participación Γₙ = φₙᵀ·M·r (modos normalizados a la masa) para la dirección r. */
export function participacion(m: Modos, masas: readonly number[], r: readonly number[]): number[] {
  return m.modos.map((phi) => phi.reduce((acc, p, i) => acc + p * masas[i]! * r[i]!, 0));
}

/** Coeficiente de correlación de la CQC con el mismo amortiguamiento ζ en los dos modos (Der Kiureghian). */
export function rhoCqc(wi: number, wj: number, zeta: number): number {
  const r = wj / wi;
  return (8 * zeta * zeta * (1 + r) * r ** 1.5) / ((1 - r * r) ** 2 + 4 * zeta * zeta * r * (1 + r) ** 2);
}

/** Combinaciones modales de una respuesta con valores modales `R` (con signo) y frecuencias ω. */
export function combinar(R: readonly number[], omega: readonly number[], zeta: number): { srss: number; abs: number; cqc: number; nrc10: number } {
  const n = R.length;
  let srss = 0;
  let abs = 0;
  let cqc = 0;
  let cercanos = 0;
  for (let i = 0; i < n; i++) {
    srss += R[i]! ** 2;
    abs += Math.abs(R[i]!);
    for (let j = 0; j < n; j++) cqc += rhoCqc(omega[i]!, omega[j]!, zeta) * R[i]! * R[j]!;
    // NRC (Regulatory Guide 1.92) del 10 %: pares de frecuencias que difieren ≤ 10 % de la menor
    for (let j = i + 1; j < n; j++) {
      const [a, b] = [Math.min(omega[i]!, omega[j]!), Math.max(omega[i]!, omega[j]!)];
      if ((b - a) / a <= 0.1) cercanos += 2 * Math.abs(R[i]! * R[j]!);
    }
  }
  return { srss: Math.sqrt(srss), abs, cqc: Math.sqrt(cqc), nrc10: Math.sqrt(srss + cercanos) };
}
