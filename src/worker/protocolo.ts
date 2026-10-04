/**
 * Protocolo entre el hilo principal y el worker del motor (E4; H16, H20, H27).
 *
 * - El núcleo WASM se compila una vez en el hilo principal (`WebAssembly.compileStreaming`) y se
 *   pasa ya compilado a cada worker en `iniciar`: arrancar otro worker tras cancelar o reciclar
 *   sólo cuesta instanciarlo.
 * - Los resultados vuelven por Transferable (H27): los `Float64Array` de cada caso cambian de hilo
 *   sin copiarse y sin pasar por JSON. En el worker quedan vacíos (`byteLength` 0).
 * - No hay mensaje de cancelar: `calcular` es síncrono y el mensaje no se atendería hasta el final
 *   (H20). Cancelar es terminar el worker, y lo hace el cliente.
 * - Una excepción del motor (no un diagnóstico) deja el worker sospechoso, porque puede venir de
 *   una trampa del WASM: se informa con `fallo` y el cliente lo recicla.
 */
import type { LimitesCalculo } from "../motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCalculo } from "../motor/modelo.ts";
import type { TipoSolver } from "../motor/solucion.ts";

export interface OpcionesWorker {
  solver?: TipoSolver;
  limites?: LimitesCalculo;
}

export type MensajeAlWorker =
  | { tipo: "iniciar"; nucleo: WebAssembly.Module }
  | { tipo: "calcular"; id: number; modelo: ModeloAnalitico; opciones?: OpcionesWorker };

/** Memoria del núcleo en bytes: la lineal (sólo crece, H16) y la que está en uso dentro de ella. */
export interface MemoriaNucleo {
  lineal: number;
  enUso: number;
}

export type MensajeDelWorker =
  | { tipo: "listo"; ms: number; memoria: MemoriaNucleo }
  | { tipo: "progreso"; id: number; fase: string; ms: number; memoria: MemoriaNucleo }
  | { tipo: "resultado"; id: number; resultado: ResultadoCalculo; ms: number; memoria: MemoriaNucleo }
  | { tipo: "fallo"; id?: number; mensaje: string };

/** Los `ArrayBuffer` de los resultados, sin repetir (transferir dos veces el mismo es un error). */
export function transferibles(r: ResultadoCalculo): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const casos = r.valido ? r.casos : (r.casosNoValidos ?? []);
  for (const c of casos) {
    for (const a of [c.u, c.reacciones, c.esfuerzosBarras, c.esfuerzosLaminas]) buffers.add(a.buffer as ArrayBuffer);
  }
  return [...buffers];
}
