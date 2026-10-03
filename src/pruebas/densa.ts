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

/** Resuelve A·x = b (n×n por filas) por eliminación de Gauss con pivoteo parcial. */
export function resolverDenso(A: ArrayLike<number>, b: ArrayLike<number>, n: number): Float64Array {
  const a = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[n * i + k]!) > Math.abs(a[n * p + k]!)) p = i;
    if (a[n * p + k] === 0) throw new Error("resolverDenso: matriz singular");
    if (p !== k) {
      for (let j = 0; j < n; j++) [a[n * k + j], a[n * p + j]] = [a[n * p + j]!, a[n * k + j]!];
      [x[k], x[p]] = [x[p]!, x[k]!];
    }
    for (let i = k + 1; i < n; i++) {
      const f = a[n * i + k]! / a[n * k + k]!;
      if (f === 0) continue;
      for (let j = k; j < n; j++) a[n * i + j]! -= f * a[n * k + j]!;
      x[i]! -= f * x[k]!;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i]!;
    for (let j = i + 1; j < n; j++) s -= a[n * i + j]! * x[j]!;
    x[i] = s / a[n * i + i]!;
  }
  return x;
}

/** Nudos y pesos de Gauss–Legendre de n puntos en [a, b] (Newton sobre Pₙ). */
export function gaussLegendre(n: number, a = -1, b = 1): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let t = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = t;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * t * p1 - (k - 1) * p0) / k];
      dp = (n * (t * p1 - p0)) / (t * t - 1);
      const dt = p1 / dp;
      t -= dt;
      if (Math.abs(dt) < 1e-16) break;
    }
    x.push(((b - a) / 2) * t + (a + b) / 2);
    w.push(((b - a) / 2) * (2 / ((1 - t * t) * dp * dp)));
  }
  return { x, w };
}
