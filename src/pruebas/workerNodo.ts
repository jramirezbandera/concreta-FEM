/**
 * `CrearWorker` para Node (`worker_threads`): el cliente del motor se prueba con workers de verdad,
 * en otro hilo, con el núcleo compilado una vez y pasado a cada worker como en el navegador.
 */
import { Worker } from "node:worker_threads";
import type { CrearWorker, PuertoWorker } from "../worker/cliente.ts";
import type { MensajePrueba } from "./workerNodo.entrada.ts";

export interface PuertoNodo extends PuertoWorker {
  /** Mensajes que sólo entiende el worker de pruebas. */
  prueba(m: MensajePrueba): void;
}

/** Fabrica workers de Node; `creados` guarda cada puerto para poder provocar fallos desde las pruebas. */
export function crearWorkerNodo(creados: PuertoNodo[] = []): CrearWorker {
  return (alMensaje, alError) => {
    const w = new Worker(new URL("./workerNodo.entrada.ts", import.meta.url));
    let terminado = false;
    w.on("message", alMensaje);
    w.on("error", (e) => alError(e.message));
    w.on("exit", (codigo) => {
      if (!terminado) alError(`el worker terminó con código ${codigo}`);
    });
    const puerto: PuertoNodo = {
      postMessage: (m, transferir) => w.postMessage(m, transferir as ArrayBuffer[]),
      terminate: () => {
        terminado = true;
        void w.terminate();
      },
      prueba: (m) => w.postMessage(m),
    };
    creados.push(puerto);
    return puerto;
  };
}
