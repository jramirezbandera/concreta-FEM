/* tslint:disable */
/* eslint-disable */

export class Nucleo {
    free(): void;
    [Symbol.dispose](): void;
    diagonal(): Float64Array;
    /**
     * [n, nnz(A superior), nnz(L), supernodal (0/1), nº de supernodos]
     */
    estadisticas(): Float64Array;
    factorizar(): void;
    /**
     * Reserva n·nrhs valores para los lados derechos y devuelve su dirección.
     * La dirección puede cambiar en cada llamada (y si la memoria crece): JS rehace la vista.
     */
    ladosPtr(nrhs: number): number;
    /**
     * `modo`: 0 = automático, 1 = supernodal, 2 = simplicial.
     */
    constructor(n: number, col_ptr: Uint32Array, row_idx: Uint32Array, perm: Uint32Array | null | undefined, modo: number);
    resolver(nrhs: number): void;
    /**
     * Dirección (en bytes) de los `nnz` valores de K en la memoria WASM.
     */
    valoresPtr(): number;
}

/**
 * Memoria lineal del módulo, para construir vistas sobre `valoresPtr()` y `ladosPtr()`.
 */
export function memoria(): any;

/**
 * Versión de la API; el envoltorio TS la comprueba al cargar el módulo.
 */
export function versionApi(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_nucleo_free: (a: number, b: number) => void;
    readonly memoria: () => any;
    readonly nucleo_diagonal: (a: number) => [number, number, number, number];
    readonly nucleo_estadisticas: (a: number) => [number, number];
    readonly nucleo_factorizar: (a: number) => [number, number];
    readonly nucleo_ladosPtr: (a: number, b: number) => [number, number, number];
    readonly nucleo_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly nucleo_resolver: (a: number, b: number) => [number, number];
    readonly nucleo_valoresPtr: (a: number) => number;
    readonly versionApi: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
