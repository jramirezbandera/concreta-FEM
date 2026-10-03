/**
 * Ensamblado de la K reducida K' = Tᵀ·K·T en CSC (triángulo superior, filas ordenadas), con el
 * patrón simbólico calculado una sola vez y reutilizable con valores nuevos (§2.7).
 *
 * Cada elemento se transforma antes de dispersarse: kₑ' = Tₑᵀ·kₑ·Tₑ, con Tₑ las filas de T de sus
 * GDL físicos. Si ninguno es esclavo, Tₑ es una selección y se dispersa kₑ tal cual.
 *
 * Los elementos que tocan GDL coartados guardan su kₑ' (son pocos: los de los apoyos) para las
 * reacciones y para los desplazamientos impuestos, sin tener que recalcularlos.
 */
import type { PatronCsc } from "../nucleo/index.ts";
import { rigidezGlobal, type ElementoMotor } from "./elementos.ts";
import { TipoGdl, type Numeracion } from "./gdl.ts";
import type { ModeloAnalitico } from "./modelo.ts";

export interface PatronSistema {
  patron: PatronCsc;
  /** Por elemento, ¿tiene algún GDL esclavo? */
  conEsclavos: Uint8Array;
  /** Por elemento, ¿toca algún GDL coartado? */
  conCoartados: Uint8Array;
}

/** Elemento transformado que toca GDL coartados: sus GDL independientes y su kₑ' (nq×nq). */
export interface ElementoCoartado {
  gdl: Uint32Array;
  k: Float64Array;
}

export interface RigidezEnsamblada {
  /** Valores de K' en el orden del patrón. */
  valores: Float64Array;
  /** Diagonal de K' por ecuación. */
  diagonal: Float64Array;
  coartados: ElementoCoartado[];
}

/**
 * Recorre los GDL independientes de un elemento: (a, q, coef) por cada término de la fila a de
 * Tₑ, omitiendo los GDL sin rigidez (sus términos son nulos).
 */
function recorrerTe(num: Numeracion, nudos: readonly number[], f: (a: number, q: number, coef: number) => void): void {
  for (let n = 0; n < nudos.length; n++) {
    for (let c = 0; c < 6; c++) {
      const a = 6 * n + c;
      const p = 6 * nudos[n]! + c;
      const fila = num.filaEsclavo[p]!;
      if (fila < 0) {
        if (num.tipo[p] !== TipoGdl.SinRigidez) f(a, p, 1);
        continue;
      }
      for (let k = num.tPtr[fila]!; k < num.tPtr[fila + 1]!; k++) {
        const q = num.tIdx[k]!;
        if (num.tipo[q] !== TipoGdl.SinRigidez) f(a, q, num.tVal[k]!);
      }
    }
  }
}

export function patronSistema(num: Numeracion, elementos: readonly ElementoMotor[]): PatronSistema {
  const nE = elementos.length;
  const nEc = num.nEcuaciones;
  const conEsclavos = new Uint8Array(nE);
  const conCoartados = new Uint8Array(nE);

  // Ecuaciones de cada elemento (CSR), sin repetir
  const sello = new Int32Array(nEc).fill(-1);
  const ePtr = new Uint32Array(nE + 1);
  let eIdx = new Uint32Array(Math.max(16, 24 * nE));
  let total = 0;
  for (let e = 0; e < nE; e++) {
    const nudos = elementos[e]!.nudos;
    for (const v of nudos) for (let c = 0; c < 6; c++) if (num.filaEsclavo[6 * v + c]! >= 0) conEsclavos[e] = 1;
    recorrerTe(num, nudos, (_a, q) => {
      if (num.tipo[q] === TipoGdl.Coartado) {
        conCoartados[e] = 1;
        return;
      }
      const eq = num.ecuacion[q]!;
      if (sello[eq] === e) return;
      sello[eq] = e;
      if (total === eIdx.length) {
        const mayor = new Uint32Array(2 * eIdx.length);
        mayor.set(eIdx);
        eIdx = mayor;
      }
      eIdx[total++] = eq;
    });
    ePtr[e + 1] = total;
  }

  // Traspuesta: elementos de cada ecuación
  const cuenta = new Uint32Array(nEc + 1);
  for (let k = 0; k < total; k++) cuenta[eIdx[k]! + 1]!++;
  for (let j = 0; j < nEc; j++) cuenta[j + 1]! += cuenta[j]!;
  const qPtr = cuenta.slice();
  const qIdx = new Uint32Array(total);
  const pos = cuenta.slice(0, nEc);
  for (let e = 0; e < nE; e++) for (let k = ePtr[e]!; k < ePtr[e + 1]!; k++) qIdx[pos[eIdx[k]!]!++] = e;

  // Columnas del triángulo superior: filas i ≤ j que comparten elemento con j
  sello.fill(-1);
  const colPtr = new Uint32Array(nEc + 1);
  const filas: number[] = [];
  let rowIdx = new Uint32Array(Math.max(16, 4 * total));
  let nnz = 0;
  for (let j = 0; j < nEc; j++) {
    filas.length = 0;
    sello[j] = j;
    filas.push(j);
    for (let k = qPtr[j]!; k < qPtr[j + 1]!; k++) {
      const e = qIdx[k]!;
      for (let r = ePtr[e]!; r < ePtr[e + 1]!; r++) {
        const i = eIdx[r]!;
        if (i < j && sello[i] !== j) {
          sello[i] = j;
          filas.push(i);
        }
      }
    }
    filas.sort((a, b) => a - b);
    if (nnz + filas.length > rowIdx.length) {
      const mayor = new Uint32Array(Math.max(2 * rowIdx.length, nnz + filas.length));
      mayor.set(rowIdx.subarray(0, nnz));
      rowIdx = mayor;
    }
    for (const i of filas) rowIdx[nnz++] = i;
    colPtr[j + 1] = nnz;
  }
  return { patron: { n: nEc, colPtr, rowIdx: rowIdx.slice(0, nnz) }, conEsclavos, conCoartados };
}

/** Posición de (i, j), i ≤ j, en el patrón (búsqueda binaria en la columna j). */
function posicion(p: PatronCsc, i: number, j: number): number {
  let lo = p.colPtr[j]!;
  let hi = p.colPtr[j + 1]! - 1;
  const rows = p.rowIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const r = rows[mid]!;
    if (r === i) return mid;
    if (r < i) lo = mid + 1;
    else hi = mid - 1;
  }
  throw new Error(`la entrada (${i}, ${j}) no está en el patrón`);
}

/** Producto Tₑᵀ·kₑ·Tₑ: devuelve los GDL independientes del elemento y su kₑ' (nq×nq por filas). */
export function transformarElemento(num: Numeracion, nudos: readonly number[], ke: Float64Array): ElementoCoartado {
  const m = 6 * nudos.length;
  const terminos: [number, number, number][] = [];
  const indice = new Map<number, number>();
  recorrerTe(num, nudos, (a, q, coef) => {
    let j = indice.get(q);
    if (j === undefined) {
      j = indice.size;
      indice.set(q, j);
    }
    terminos.push([a, j, coef]);
  });
  const nq = indice.size;
  // W = kₑ·Tₑ (m×nq)
  const W = new Float64Array(m * nq);
  for (const [b, j, coef] of terminos) for (let a = 0; a < m; a++) W[nq * a + j]! += ke[m * a + b]! * coef;
  // kₑ' = Tₑᵀ·W (nq×nq)
  const k = new Float64Array(nq * nq);
  for (const [a, i, coef] of terminos) for (let j = 0; j < nq; j++) k[nq * i + j]! += coef * W[nq * a + j]!;
  const gdl = new Uint32Array(nq);
  for (const [q, j] of indice) gdl[j] = q;
  return { gdl, k };
}

/** Selección sin esclavos: GDL físicos del elemento (sin los que no tienen rigidez) y kₑ reducida. */
function seleccionarElemento(num: Numeracion, nudos: readonly number[], ke: Float64Array): ElementoCoartado {
  const m = 6 * nudos.length;
  const locales: number[] = [];
  const gdl: number[] = [];
  for (let a = 0; a < m; a++) {
    const p = 6 * nudos[Math.floor(a / 6)]! + (a % 6);
    if (num.tipo[p] === TipoGdl.SinRigidez) continue;
    locales.push(a);
    gdl.push(p);
  }
  const nq = gdl.length;
  if (nq === m) return { gdl: Uint32Array.from(gdl), k: ke };
  const k = new Float64Array(nq * nq);
  for (let i = 0; i < nq; i++) for (let j = 0; j < nq; j++) k[nq * i + j] = ke[m * locales[i]! + locales[j]!]!;
  return { gdl: Uint32Array.from(gdl), k };
}

export function ensamblarRigidez(
  modelo: ModeloAnalitico,
  xyz: Float64Array,
  num: Numeracion,
  elementos: readonly ElementoMotor[],
  ps: PatronSistema,
): RigidezEnsamblada {
  const { patron } = ps;
  const valores = new Float64Array(patron.rowIdx.length);
  const coartados: ElementoCoartado[] = [];
  const eqLocal: number[] = [];
  for (let e = 0; e < elementos.length; e++) {
    const el = elementos[e]!;
    const ke = rigidezGlobal(modelo, el, xyz);
    const t = ps.conEsclavos[e] ? transformarElemento(num, el.nudos, ke) : seleccionarElemento(num, el.nudos, ke);
    const nq = t.gdl.length;
    eqLocal.length = nq;
    for (let i = 0; i < nq; i++) eqLocal[i] = num.ecuacion[t.gdl[i]!]!;
    for (let i = 0; i < nq; i++) {
      const ei = eqLocal[i]!;
      if (ei < 0) continue;
      for (let j = 0; j < nq; j++) {
        const ej = eqLocal[j]!;
        if (ej < ei) continue;
        const v = t.k[nq * i + j]!;
        if (v !== 0) valores[posicion(patron, ei, ej)]! += v;
      }
    }
    if (ps.conCoartados[e]) coartados.push(t);
  }
  const diagonal = new Float64Array(patron.n);
  for (let j = 0; j < patron.n; j++) diagonal[j] = valores[patron.colPtr[j + 1]! - 1]!;
  return { valores, diagonal, coartados };
}

/** y = K'·x con K' simétrica guardada como triángulo superior. */
export function productoSimetrico(p: PatronCsc, valores: Float64Array, x: Float64Array, y: Float64Array = new Float64Array(p.n)): Float64Array {
  y.fill(0);
  for (let j = 0; j < p.n; j++) {
    const xj = x[j]!;
    let s = 0;
    for (let q = p.colPtr[j]!; q < p.colPtr[j + 1]!; q++) {
      const i = p.rowIdx[q]!;
      const v = valores[q]!;
      if (i === j) s += v * xj;
      else {
        y[i]! += v * xj;
        s += v * x[i]!;
      }
    }
    y[j]! += s;
  }
  return y;
}
