/**
 * Worker del motor en Node (`worker_threads`), para las pruebas del cliente: el mismo atendedor
 * que el worker del navegador, más dos mensajes que sólo existen aquí para provocar fallos.
 * - `prueba-ocupar`: hace crecer la memoria lineal del núcleo hasta dejar `libres` bytes antes de
 *   su tope de 4 GiB, para agotar la memoria con modelos pequeños.
 * - `prueba-lanzar`: una excepción fuera del atendedor (el worker se cae).
 */
import { parentPort } from "node:worker_threads";
import { memoria } from "../nucleo/pkg/nucleo.js";
import { crearAtendedor } from "../worker/atender.ts";
import type { MensajeAlWorker } from "../worker/protocolo.ts";

export type MensajePrueba = { tipo: "prueba-ocupar"; libres: number } | { tipo: "prueba-lanzar" };

const puerto = parentPort!;
const atender = crearAtendedor((m, transferir) => puerto.postMessage(m, transferir ?? []));
puerto.on("message", (m: MensajeAlWorker | MensajePrueba) => {
  if (m.tipo === "prueba-ocupar") {
    const mem = memoria() as WebAssembly.Memory;
    const paginas = Math.floor((2 ** 32 - m.libres) / 65536) - mem.buffer.byteLength / 65536;
    if (paginas > 0) mem.grow(paginas);
    return;
  }
  if (m.tipo === "prueba-lanzar") throw new Error("caída provocada");
  void atender(m);
});
