/**
 * Lo que hace el worker del motor con cada mensaje (ver `protocolo.ts`). No toca `self` ni
 * `parentPort`: recibe cómo enviar, así que es el mismo código en el navegador (`worker.ts`) y en
 * Node (`src/pruebas/workerNodo.entrada.ts`).
 */
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo, memoriaEnUsoNucleo, memoriaNucleo } from "../nucleo/index.ts";
import { transferibles, type MemoriaNucleo, type MensajeAlWorker, type MensajeDelWorker } from "./protocolo.ts";

export type Enviar = (m: MensajeDelWorker, transferir?: ArrayBuffer[]) => void;

const texto = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export function crearAtendedor(enviar: Enviar): (m: MensajeAlWorker) => Promise<void> {
  let listo: Promise<void> | null = null;
  const memoria = (): MemoriaNucleo => ({ lineal: memoriaNucleo(), enUso: memoriaEnUsoNucleo() });

  return async (m) => {
    switch (m.tipo) {
      case "iniciar": {
        const t0 = performance.now();
        listo = iniciarNucleo(m.nucleo);
        try {
          await listo;
          enviar({ tipo: "listo", ms: performance.now() - t0, memoria: memoria() });
        } catch (e) {
          enviar({ tipo: "fallo", mensaje: `no se pudo iniciar el núcleo: ${texto(e)}` });
        }
        return;
      }
      case "calcular": {
        try {
          if (!listo) throw new Error("cálculo recibido antes de iniciar el núcleo");
          await listo;
          const t0 = performance.now();
          const resultado = calcular(m.modelo, {
            ...m.opciones,
            alProgreso: (fase, ms) => enviar({ tipo: "progreso", id: m.id, fase, ms, memoria: memoria() }),
          });
          enviar({ tipo: "resultado", id: m.id, resultado, ms: performance.now() - t0, memoria: memoria() }, transferibles(resultado));
        } catch (e) {
          // Tras una trampa del WASM el núcleo no es fiable: no se le pregunta nada más.
          enviar({ tipo: "fallo", id: m.id, mensaje: texto(e) });
        }
        return;
      }
      default:
        enviar({ tipo: "fallo", mensaje: `mensaje desconocido: ${JSON.stringify((m as { tipo?: unknown }).tipo)}` });
    }
  };
}
