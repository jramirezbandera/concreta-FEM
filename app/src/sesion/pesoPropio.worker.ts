/**
 * Worker del peso propio calculado de la Revisión, anidado en el de sesión (`worker.ts`): la
 * compilación aparte de `pesoPropioCalculado` (~2 s en el edificio objetivo), en paralelo con la
 * revisión provisional en vez de detrás de ella. No necesita el núcleo WASM (sólo compila). Un
 * worker por pedido: se cierra al contestar, y la memoria de la compilación se va con él.
 */
import type { ModeloFisico, OpcionesCompilacion } from "../../../src/compilador/fisico.ts";
import { pesoPropioCalculado } from "../../../src/agente/sensatez.ts";

export type PedidoPeso = { modelo: ModeloFisico; opciones: OpcionesCompilacion | undefined };
export type RespuestaPeso = { ok: true; peso: Map<string, number> | null } | { ok: false; mensaje: string };

interface AmbitoWorker {
  onmessage: ((e: MessageEvent<PedidoPeso>) => void) | null;
  postMessage(m: RespuestaPeso): void;
}

const ambito = globalThis as unknown as AmbitoWorker;

ambito.onmessage = (e) => {
  try {
    ambito.postMessage({ ok: true, peso: pesoPropioCalculado(e.data.modelo, e.data.opciones) });
  } catch (x) {
    ambito.postMessage({ ok: false, mensaje: x instanceof Error ? x.message : String(x) });
  }
};
