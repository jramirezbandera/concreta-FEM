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
import iniciar, { Nucleo, memoria, memoriaEnUso, versionApi } from "./pkg/nucleo.js";

const VERSION_API = 2;

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

/**
 * Bytes reservados y no liberados dentro del núcleo. La memoria lineal no baja, pero el asignador
 * reutiliza lo liberado: el pico de un cálculo nuevo es max(memoriaNucleo, en uso + lo que pida).
 */
export function memoriaEnUsoNucleo(): number {
  return memoriaEnUso();
}

export interface PatronCsc {
  n: number;
  colPtr: Uint32Array;
  rowIdx: Uint32Array;
}

export type ModoFactor = "auto" | "supernodal" | "simplicial";

/** Pivote exactamente nulo durante la factorización; `columna` es la ecuación original (sin permutar). */
export class ErrorPivoteNulo extends Error {
  readonly columna: number;
  constructor(columna: number) {
    super(`pivote nulo en la columna ${columna}`);
    this.name = "ErrorPivoteNulo";
    this.columna = columna;
  }
}

/**
 * El núcleo no pudo reservar memoria: su memoria lineal no pasa de 4 GiB, y el navegador puede
 * darle menos. El núcleo sigue siendo utilizable, pero su memoria ya no baja (H16).
 */
export class ErrorSinMemoria extends Error {
  constructor() {
    super("el núcleo WASM se ha quedado sin memoria");
    this.name = "ErrorSinMemoria";
  }
}

/** Traduce los errores del núcleo a errores tipados. */
function traducir(e: unknown): unknown {
  const m = e instanceof Error ? e.message : String(e);
  const nulo = /pivote nulo en la columna (\d+)/.exec(m);
  if (nulo) return new ErrorPivoteNulo(Number(nulo[1]));
  if (m === "sin memoria") return new ErrorSinMemoria();
  return e;
}

/** Bytes que pedirán la factorización y la resolución (ver `FactorLdlt.memoriaRequerida`). */
export interface MemoriaRequerida {
  /** Valores de L. */
  l: number;
  /** Memoria de trabajo de la factorización numérica. */
  factorizacion: number;
  /** Memoria de trabajo de la resolución del bloque de lados derechos. */
  resolucion: number;
  /** El propio bloque de lados derechos. */
  lados: number;
  total: number;
}

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
    try {
      this.nucleo = new Nucleo(patron.n, patron.colPtr, patron.rowIdx, opciones.perm, MODOS[opciones.modo ?? "auto"]);
    } catch (e) {
      throw traducir(e);
    }
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
    try {
      nucleo.factorizar();
    } catch (e) {
      throw traducir(e);
    }
  }

  /** Resuelve K·X = B; `b` tiene n·nrhs valores en orden de columnas. Devuelve X (copia). */
  resolver(b: Float64Array, nrhs = 1): Float64Array {
    if (b.length !== this.n * nrhs) throw new Error(`el bloque tiene ${b.length} valores; se esperaban ${this.n * nrhs}`);
    const nucleo = this.vivo();
    let ptr: number;
    try {
      ptr = nucleo.ladosPtr(nrhs);
      new Float64Array((memoria() as WebAssembly.Memory).buffer, ptr, b.length).set(b);
      nucleo.resolver(nrhs);
    } catch (e) {
      throw traducir(e);
    }
    return new Float64Array((memoria() as WebAssembly.Memory).buffer, ptr, b.length).slice();
  }

  /** Diagonal D de LDLᵀ en el orden original de los GDL (pivotes; inercia). */
  diagonal(): Float64Array {
    return this.vivo().diagonal();
  }

  /**
   * Bytes que pedirán `factorizar()` y `resolver(…, nrhs)`, calculados del análisis simbólico sin
   * reservar nada. Sirve para rechazar un modelo que no cabe antes de factorizar (H16).
   */
  memoriaRequerida(nrhs: number): MemoriaRequerida {
    const [l, factorizacion, resolucion, lados] = this.vivo().memoriaRequerida(nrhs);
    return { l: l!, factorizacion: factorizacion!, resolucion: resolucion!, lados: lados!, total: l! + factorizacion! + resolucion! + lados! };
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
