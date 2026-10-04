/**
 * Punto de entrada del worker del motor en el navegador. Se crea con
 *   new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
 * y se maneja con `ClienteMotor` (`cliente.ts`). La lógica está en `atender.ts`.
 */
import { crearAtendedor } from "./atender.ts";
import type { MensajeAlWorker, MensajeDelWorker } from "./protocolo.ts";

interface AmbitoWorker {
  onmessage: ((e: MessageEvent<MensajeAlWorker>) => void) | null;
  postMessage(m: MensajeDelWorker, transferir: Transferable[]): void;
}

const ambito = globalThis as unknown as AmbitoWorker;
const atender = crearAtendedor((m, transferir) => ambito.postMessage(m, transferir ?? []));
ambito.onmessage = (e) => void atender(e.data);
