/**
 * Ensamblador mínimo para los tests del spike E0: GDL globales numerados por el llamador,
 * apoyos por eliminación y resolución con el núcleo WASM. No es el ensamblador del motor (E1):
 * no hay restricciones, ni patrón simbólico reutilizable, ni diagnósticos.
 */
import { FactorLdlt, type PatronCsc } from "../nucleo/index.ts";

export class ModeloPrueba {
  readonly nGdl: number;
  private filas: number[] = [];
  private cols: number[] = [];
  private vals: number[] = [];
  readonly cargas: Float64Array;
  readonly coartado: Uint8Array;
  /** Desplazamientos impuestos en los GDL coartados (0 por defecto). */
  readonly impuesto: Float64Array;

  constructor(nGdl: number) {
    this.nGdl = nGdl;
    this.cargas = new Float64Array(nGdl);
    this.coartado = new Uint8Array(nGdl);
    this.impuesto = new Float64Array(nGdl);
  }

  /** Suma una matriz de elemento (m×m por filas) en los GDL globales `gdl`. */
  sumarRigidez(gdl: ArrayLike<number>, k: ArrayLike<number>): void {
    const m = gdl.length;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        const v = k[m * i + j]!;
        if (v === 0) continue;
        this.filas.push(gdl[i]!);
        this.cols.push(gdl[j]!);
        this.vals.push(v);
      }
    }
  }

  sumarCarga(gdl: ArrayLike<number>, f: ArrayLike<number>): void {
    for (let i = 0; i < gdl.length; i++) this.cargas[gdl[i]!]! += f[i]!;
  }

  coartar(gdl: number, valor = 0): void {
    this.coartado[gdl] = 1;
    this.impuesto[gdl] = valor;
  }

  /** Producto K·u con la K completa ensamblada (para reacciones y residuos). */
  productoK(u: ArrayLike<number>): Float64Array {
    const y = new Float64Array(this.nGdl);
    for (let k = 0; k < this.vals.length; k++) y[this.filas[k]!]! += this.vals[k]! * u[this.cols[k]!]!;
    return y;
  }

  /**
   * Regla de oro 2: residuo de equilibrio global entre las cargas y las reacciones de los GDL
   * coartados, con 6 GDL por nudo [ux, uy, uz, rx, ry, rz] y momentos respecto al origen.
   * Devuelve |ΣF|/Σ|F| y |ΣM|/(Σ|F|·L), con L la mayor distancia de un nudo al origen.
   */
  equilibrio(nudos: ArrayLike<number>, reacciones: ArrayLike<number>): { fuerzas: number; momentos: number } {
    const nn = this.nGdl / 6;
    const F = [0, 0, 0];
    const M = [0, 0, 0];
    let escalaF = 0;
    let L = 0;
    for (let v = 0; v < nn; v++) {
      const total = (c: number) => this.cargas[6 * v + c]! + (this.coartado[6 * v + c] ? reacciones[6 * v + c]! : 0);
      const f = [total(0), total(1), total(2)];
      const x = nudos[3 * v]!;
      const y = nudos[3 * v + 1]!;
      const z = nudos[3 * v + 2]!;
      L = Math.max(L, Math.hypot(x, y, z));
      for (let c = 0; c < 3; c++) {
        F[c]! += f[c]!;
        escalaF += Math.abs(this.cargas[6 * v + c]!);
      }
      M[0]! += y * f[2]! - z * f[1]! + total(3);
      M[1]! += z * f[0]! - x * f[2]! + total(4);
      M[2]! += x * f[1]! - y * f[0]! + total(5);
    }
    return { fuerzas: Math.hypot(F[0]!, F[1]!, F[2]!) / escalaF, momentos: Math.hypot(M[0]!, M[1]!, M[2]!) / (escalaF * L) };
  }

  /** Resuelve y devuelve los desplazamientos de todos los GDL y las reacciones (K·u − f). */
  resolver(): { u: Float64Array; reacciones: Float64Array } {
    const n = this.nGdl;
    const libre = new Int32Array(n).fill(-1);
    let nl = 0;
    for (let i = 0; i < n; i++) if (!this.coartado[i]) libre[i] = nl++;

    // Triángulo superior de K_ll en CSC, con duplicados sumados
    const porCol: Map<number, number>[] = Array.from({ length: nl }, () => new Map());
    const b = new Float64Array(nl);
    for (let i = 0; i < n; i++) if (libre[i]! >= 0) b[libre[i]!] = this.cargas[i]!;
    for (let k = 0; k < this.vals.length; k++) {
      const fi = libre[this.filas[k]!]!;
      const cj = libre[this.cols[k]!]!;
      const v = this.vals[k]!;
      if (fi >= 0 && cj < 0) b[fi]! -= v * this.impuesto[this.cols[k]!]!;
      if (fi < 0 || cj < 0 || fi > cj) continue;
      const col = porCol[cj]!;
      col.set(fi, (col.get(fi) ?? 0) + v);
    }
    const colPtr = new Uint32Array(nl + 1);
    for (let j = 0; j < nl; j++) colPtr[j + 1] = colPtr[j]! + porCol[j]!.size;
    const rowIdx = new Uint32Array(colPtr[nl]!);
    const valores = new Float64Array(colPtr[nl]!);
    for (let j = 0; j < nl; j++) {
      const entradas = [...porCol[j]!.entries()].sort((a, c) => a[0] - c[0]);
      entradas.forEach(([i, v], p) => {
        rowIdx[colPtr[j]! + p] = i;
        valores[colPtr[j]! + p] = v;
      });
    }
    const patron: PatronCsc = { n: nl, colPtr, rowIdx };
    const f = new FactorLdlt(patron);
    try {
      f.factorizar(valores);
      const x = f.resolver(b);
      const u = Float64Array.from(this.impuesto);
      for (let i = 0; i < n; i++) if (libre[i]! >= 0) u[i] = x[libre[i]!]!;
      const ku = this.productoK(u);
      const reacciones = ku.map((v, i) => v - this.cargas[i]!);
      return { u, reacciones };
    } finally {
      f.liberar();
    }
  }
}
