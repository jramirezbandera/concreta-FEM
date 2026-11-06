/**
 * Combinaciones espectrales de respuestas modales (SRSS, ABS, CQC y NRC 10 %), para validar con los
 * ejemplos de CSI que dan un espectro (SAP2000 1-022 y 1-024): no es código del motor. Los modos y
 * los periodos son ya los del motor (VS2, `src/motor/modal.ts`); la combinación pasa a él con VS3.
 */

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
