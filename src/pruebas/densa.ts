/**
 * Álgebra densa pequeña para los tests (matrices de elemento): no es código del motor.
 * Matrices cuadradas por filas en Float64Array.
 */

/** Autovalores de una matriz simétrica n×n por el método de Jacobi cíclico, en orden creciente. */
export function autovaloresSimetrica(A: ArrayLike<number>, n: number): Float64Array {
  const a = Float64Array.from(A);
  for (let barrido = 0; barrido < 100; barrido++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[n * p + q]! ** 2;
    if (off < 1e-30 * normaFrobenius(a) ** 2) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[n * p + q]!;
        if (apq === 0) continue;
        const theta = (a[n * q + q]! - a[n * p + p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[n * k + p]!;
          const akq = a[n * k + q]!;
          a[n * k + p] = c * akp - s * akq;
          a[n * k + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[n * p + k]!;
          const aqk = a[n * q + k]!;
          a[n * p + k] = c * apk - s * aqk;
          a[n * q + k] = s * apk + c * aqk;
        }
      }
    }
  }
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = a[n * i + i]!;
  return d.sort();
}

export function normaFrobenius(A: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < A.length; i++) s += A[i]! ** 2;
  return Math.sqrt(s);
}

export function maxAbs(A: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < A.length; i++) m = Math.max(m, Math.abs(A[i]!));
  return m;
}

/** max|A − B| / max|B| */
export function errorRelativo(A: ArrayLike<number>, B: ArrayLike<number>): number {
  if (A.length !== B.length) throw new Error(`longitudes distintas: ${A.length} y ${B.length}`);
  let m = 0;
  for (let i = 0; i < A.length; i++) m = Math.max(m, Math.abs(A[i]! - B[i]!));
  return m / maxAbs(B);
}

/** y = A·x */
export function producto(A: ArrayLike<number>, x: ArrayLike<number>, n: number): Float64Array {
  const y = new Float64Array(n);
  const m = x.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += A[m * i + j]! * x[j]!;
    y[i] = s;
  }
  return y;
}

/** max|A − Aᵀ| / max|A| */
export function asimetria(A: ArrayLike<number>, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) m = Math.max(m, Math.abs(A[n * i + j]! - A[n * j + i]!));
  return m / maxAbs(A);
}
