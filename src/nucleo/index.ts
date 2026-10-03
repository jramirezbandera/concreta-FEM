/**
 * Envoltorio TypeScript del núcleo WASM (kernel/, faer): LDLᵀ dispersa supernodal.
 *
 * El motor es puro (sin IO): quien lo usa pasa los bytes o el `WebAssembly.Module` de
 * `pkg/nucleo_bg.wasm` a `iniciarNucleo()` una vez por hilo (worker).
 *
 * Patrón: triángulo superior de K en CSC, con los índices de fila ordenados y sin repetir.
 * La factorización se puede repetir con valores nuevos sobre el mismo patrón, y la resolución
 * trabaja por bloques de lados derechos en orden de columnas (n·nrhs valores).
 */
import iniciar, { Nucleo, memoria, versionApi } from "./pkg/nucleo.js";

const VERSION_API = 1;

let iniciado = false;

/** Carga el módulo WASM. Idempotente. */
export async function iniciarNucleo(fuente: BufferSource | WebAssembly.Module): Promise<void> {
  if (iniciado) return;
  await iniciar({ module_or_path: fuente });
  const v = versionApi();
  if (v !== VERSION_API) throw new Error(`núcleo WASM con API ${v}; el envoltorio espera la ${VERSION_API}`);
  iniciado = true;
}

/** Bytes de la memoria lineal del núcleo: sólo crece (H16), así que es el pico del hilo. */
export function memoriaNucleo(): number {
  return (memoria() as WebAssembly.Memory).buffer.byteLength;
}

export interface PatronCsc {
  n: number;
  colPtr: Uint32Array;
  rowIdx: Uint32Array;
}

export type ModoFactor = "auto" | "supernodal" | "simplicial";

export interface EstadisticasFactor {
  n: number;
  nnzA: number;
  nnzL: number;
  supernodal: boolean;
  supernodos: number;
}

const MODOS: Record<ModoFactor, number> = { auto: 0, supernodal: 1, simplicial: 2 };

/** Factorización LDLᵀ sobre un patrón fijo. Hay que llamar a `liberar()` al terminar. */
export class FactorLdlt {
  readonly n: number;
  readonly nnz: number;
  private nucleo: Nucleo | null;

  /** `perm`: permutación de llenado (perm[k] = GDL original en la posición k); por defecto, AMD. */
  constructor(patron: PatronCsc, opciones: { perm?: Uint32Array; modo?: ModoFactor } = {}) {
    if (!iniciado) throw new Error("núcleo WASM sin iniciar: llama antes a iniciarNucleo()");
    this.n = patron.n;
    this.nnz = patron.rowIdx.length;
    this.nucleo = new Nucleo(patron.n, patron.colPtr, patron.rowIdx, opciones.perm, MODOS[opciones.modo ?? "auto"]);
  }

  private vivo(): Nucleo {
    if (!this.nucleo) throw new Error("factorización liberada");
    return this.nucleo;
  }

  /** Factoriza con los valores de K (uno por entrada del patrón, en su orden). */
  factorizar(valores: Float64Array): void {
    if (valores.length !== this.nnz) throw new Error(`${valores.length} valores para ${this.nnz} entradas`);
    const nucleo = this.vivo();
    const mem = memoria() as WebAssembly.Memory;
    new Float64Array(mem.buffer, nucleo.valoresPtr(), this.nnz).set(valores);
    nucleo.factorizar();
  }

  /** Resuelve K·X = B; `b` tiene n·nrhs valores en orden de columnas. Devuelve X (copia). */
  resolver(b: Float64Array, nrhs = 1): Float64Array {
    if (b.length !== this.n * nrhs) throw new Error(`el bloque tiene ${b.length} valores; se esperaban ${this.n * nrhs}`);
    const nucleo = this.vivo();
    const ptr = nucleo.ladosPtr(nrhs);
    const mem = memoria() as WebAssembly.Memory;
    new Float64Array(mem.buffer, ptr, b.length).set(b);
    nucleo.resolver(nrhs);
    return new Float64Array((memoria() as WebAssembly.Memory).buffer, ptr, b.length).slice();
  }

  /** Diagonal D de LDLᵀ en el orden original de los GDL (pivotes; inercia). */
  diagonal(): Float64Array {
    return this.vivo().diagonal();
  }

  estadisticas(): EstadisticasFactor {
    const [n, nnzA, nnzL, sup, nSup] = this.vivo().estadisticas();
    return { n: n!, nnzA: nnzA!, nnzL: nnzL!, supernodal: sup === 1, supernodos: nSup! };
  }

  liberar(): void {
    this.nucleo?.free();
    this.nucleo = null;
  }
}
