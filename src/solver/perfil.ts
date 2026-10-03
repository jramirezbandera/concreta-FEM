/**
 * Solver de perfil (skyline) LDLᵀ en TypeScript, con ordenación de Cuthill–McKee inversa (RCM).
 *
 * Es la referencia diferencial del núcleo WASM (faer) en los tests y la reserva para modelos
 * pequeños (S7: hasta ~30 000 GDL). Algoritmo de columna activa de COLSOL (Bathe, Finite Element
 * Procedures, tabla 8.3). Entrada: triángulo superior de K en CSC (como el núcleo).
 */
import type { PatronCsc } from "../nucleo/index.ts";

/** Permutación RCM: perm[k] = GDL original en la posición k. */
export function ordenRcm(p: PatronCsc): Uint32Array {
  const n = p.n;
  // Grafo simétrico sin la diagonal
  const grado = new Uint32Array(n);
  for (let j = 0; j < n; j++) {
    for (let q = p.colPtr[j]!; q < p.colPtr[j + 1]!; q++) {
      const i = p.rowIdx[q]!;
      if (i !== j) {
        grado[i]!++;
        grado[j]!++;
      }
    }
  }
  const inicio = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) inicio[i + 1] = inicio[i]! + grado[i]!;
  const vecinos = new Uint32Array(inicio[n]!);
  const pos = inicio.slice(0, n);
  for (let j = 0; j < n; j++) {
    for (let q = p.colPtr[j]!; q < p.colPtr[j + 1]!; q++) {
      const i = p.rowIdx[q]!;
      if (i !== j) {
        vecinos[pos[i]!++] = j;
        vecinos[pos[j]!++] = i;
      }
    }
  }
  const orden = new Uint32Array(n);
  const visto = new Uint8Array(n);
  let k = 0;
  const bfs = (raiz: number, marcar: boolean): { ultimo: number; niveles: number } => {
    // BFS por niveles; si `marcar`, escribe el orden de Cuthill–McKee
    const local = marcar ? visto : new Uint8Array(n);
    const cola = [raiz];
    local[raiz] = 1;
    let cabeza = 0;
    let ultimo = raiz;
    let niveles = 0;
    while (cabeza < cola.length) {
      const fin = cola.length;
      niveles++;
      for (; cabeza < fin; cabeza++) {
        const v = cola[cabeza]!;
        ultimo = v;
        if (marcar) orden[k++] = v;
        const vs = Array.from(vecinos.subarray(inicio[v]!, inicio[v + 1]!)).filter((w) => !local[w]);
        vs.sort((a, b) => grado[a]! - grado[b]!);
        for (const w of vs) {
          local[w] = 1;
          cola.push(w);
        }
      }
    }
    return { ultimo, niveles };
  };
  for (let s = 0; s < n; s++) {
    if (visto[s]) continue;
    // nudo pseudoperiférico: unas pocas pasadas de BFS desde el de menor grado de la componente
    let raiz = s;
    let niveles = bfs(raiz, false).niveles;
    for (let iter = 0; iter < 4; iter++) {
      const r = bfs(raiz, false);
      const otro = bfs(r.ultimo, false);
      if (otro.niveles <= niveles) break;
      raiz = r.ultimo;
      niveles = otro.niveles;
    }
    bfs(raiz, true);
  }
  return orden.reverse();
}

/** Factorización LDLᵀ en perfil sobre el patrón permutado. */
export class FactorPerfil {
  readonly n: number;
  /** Tamaño del perfil (valores almacenados). */
  readonly tamano: number;
  private readonly perm: Uint32Array;
  private readonly inv: Uint32Array;
  /** Primera fila de cada columna permutada, y comienzo de cada columna en `v`. */
  private readonly primera: Uint32Array;
  private readonly inicio: Float64Array;
  private readonly v: Float64Array;

  constructor(p: PatronCsc, valores: Float64Array, perm = ordenRcm(p)) {
    const n = p.n;
    this.n = n;
    this.perm = perm;
    this.inv = new Uint32Array(n);
    for (let k = 0; k < n; k++) this.inv[perm[k]!] = k;
    const primera = Uint32Array.from({ length: n }, (_, j) => j);
    for (let j = 0; j < n; j++) {
      for (let q = p.colPtr[j]!; q < p.colPtr[j + 1]!; q++) {
        const a = this.inv[p.rowIdx[q]!]!;
        const b = this.inv[j]!;
        const [fila, col] = a < b ? [a, b] : [b, a];
        if (fila < primera[col]!) primera[col] = fila;
      }
    }
    const inicio = new Float64Array(n + 1);
    for (let j = 0; j < n; j++) inicio[j + 1] = inicio[j]! + (j - primera[j]! + 1);
    this.primera = primera;
    this.inicio = inicio;
    this.tamano = inicio[n]!;
    const v = new Float64Array(this.tamano);
    for (let j = 0; j < n; j++) {
      for (let q = p.colPtr[j]!; q < p.colPtr[j + 1]!; q++) {
        const a = this.inv[p.rowIdx[q]!]!;
        const b = this.inv[j]!;
        const [fila, col] = a < b ? [a, b] : [b, a];
        v[inicio[col]! + fila - primera[col]!] = valores[q]!;
      }
    }
    this.v = v;
    this.factorizar();
  }

  /** v(i, j) con fila ≥ primera[j] está en inicio[j] + i − primera[j]. */
  private factorizar(): void {
    const { n, primera, inicio, v } = this;
    for (let j = 0; j < n; j++) {
      const fj = primera[j]!;
      const bj = inicio[j]! - fj;
      // g_ij = a_ij − Σ_{r=max(fi,fj)}^{i−1} l_ri·g_rj
      for (let i = fj + 1; i < j; i++) {
        const fi = primera[i]!;
        const bi = inicio[i]! - fi;
        let s = 0;
        for (let r = Math.max(fi, fj); r < i; r++) s += v[bi + r]! * v[bj + r]!;
        v[bj + i]! -= s;
      }
      // l_ij = g_ij/d_i; d_j = a_jj − Σ l_ij·g_ij
      let d = v[bj + j]!;
      for (let i = fj; i < j; i++) {
        const g = v[bj + i]!;
        const l = g / v[inicio[i + 1]! - 1]!;
        d -= l * g;
        v[bj + i] = l;
      }
      if (d === 0 || !Number.isFinite(d)) throw new Error(`pivote nulo en el GDL ${this.perm[j]}`);
      v[bj + j] = d;
    }
  }

  /** Resuelve K·x = b (un lado derecho). */
  resolver(b: ArrayLike<number>): Float64Array {
    const { n, primera, inicio, v, perm } = this;
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) y[k] = b[perm[k]!]!;
    for (let j = 0; j < n; j++) {
      const bj = inicio[j]! - primera[j]!;
      let s = 0;
      for (let i = primera[j]!; i < j; i++) s += v[bj + i]! * y[i]!;
      y[j]! -= s;
    }
    for (let j = 0; j < n; j++) y[j]! /= v[inicio[j + 1]! - 1]!;
    for (let j = n - 1; j >= 0; j--) {
      const bj = inicio[j]! - primera[j]!;
      const yj = y[j]!;
      for (let i = primera[j]!; i < j; i++) y[i]! -= v[bj + i]! * yj;
    }
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) x[perm[k]!] = y[k]!;
    return x;
  }
}
