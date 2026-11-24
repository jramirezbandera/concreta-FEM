/**
 * Worker de sesión del visor (V1, docs/fem3d/visor.md §3.1). Carga el núcleo WASM, guarda la sesión
 * (`src/visor/atender.ts`) y contesta los pedidos de uno en uno, en el orden en que llegan: un pedido
 * asíncrono (los resultados guardados) no deja que otro vea la sesión a medias. Las tareas largas
 * (proponer el armado, comprobar un tipo entero) van por turnos y avisando de por dónde van
 * (`src/visor/cola.ts`).
 */
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Atendedor, type PesoAparte } from "../../../src/visor/atender.ts";
import { Cola } from "../../../src/visor/cola.ts";
import { infoNavegador, type NavegadorParcial } from "../../../src/worker/limites.ts";
import type { PedidoPeso, RespuestaPeso } from "./pesoPropio.worker.ts";
import type { MensajeAlWorker, MensajeDelWorker } from "../../../src/visor/protocolo.ts";
import { sha256Bytes } from "../../../src/visor/sesion.ts";

interface AmbitoWorker {
  onmessage: ((e: MessageEvent<MensajeAlWorker>) => void) | null;
  postMessage(m: MensajeDelWorker, transferir?: Transferable[]): void;
}

const ambito = globalThis as unknown as AmbitoWorker;
let atendedor: Atendedor | null = null;

/**
 * El peso propio calculado de la Revisión en un worker anidado (`pesoPropio.worker.ts`), salvo en un
 * móvil: dos compilaciones a la vez doblan el pico de memoria, y allí se hace detrás, como antes.
 *
 * El worker anidado se crea antes de que haga falta y queda cargado: en Chrome se carga a través
 * de este hilo, y si se creara al pedir la revisión no empezaría hasta que acabase la provisional,
 * que lo bloquea unos segundos (medido: la final llegaba más tarde que compilándolo aquí). Cada uno
 * contesta una vez y se cierra (la memoria de la compilación se va con él); en ese momento se crea
 * el siguiente.
 */
function pesoAparte(): PesoAparte | undefined {
  if (typeof Worker === "undefined" || infoNavegador(navigator as unknown as NavegadorParcial).movil) return undefined;
  const crear = () => new Worker(new URL("./pesoPropio.worker.ts", import.meta.url), { type: "module" });
  let listo = crear();
  return (modelo, opciones) =>
    new Promise((resolver, rechazar) => {
      const w = listo;
      const fin = () => {
        w.terminate();
        listo = crear();
      };
      w.onmessage = (e: MessageEvent<RespuestaPeso>) => {
        fin();
        if (e.data.ok) resolver(e.data.peso);
        else rechazar(new Error(e.data.mensaje));
      };
      w.onerror = (e) => {
        fin();
        rechazar(new Error(e.message));
      };
      w.postMessage({ modelo, opciones } satisfies PedidoPeso);
    });
}
let cola: Cola | null = null;

/**
 * Cede el hilo sin esperar: un mensaje a uno mismo (un `setTimeout(0)` anidado espera 4 ms, la décima
 * parte de un turno de `cola.ts`). Los mensajes de la interfaz que ya esperaban entran antes.
 */
const canal = new MessageChannel();
let alCeder: (() => void) | null = null;
canal.port1.onmessage = () => {
  const f = alCeder;
  alCeder = null;
  f?.();
};
const ceder = () =>
  new Promise<void>((r) => {
    alCeder = r;
    canal.port2.postMessage(0);
  });

async function iniciar(wasm: ArrayBuffer): Promise<void> {
  const t0 = performance.now();
  try {
    const motor = await sha256Bytes(new Uint8Array(wasm));
    await iniciarNucleo(wasm);
    const aparte = pesoAparte();
    atendedor = new Atendedor(motor, aparte ? { pesoAparte: aparte } : {});
    cola = new Cola(atendedor, { enviar: (m, transferir) => ambito.postMessage(m, transferir ?? []), ceder });
    ambito.postMessage({ tipo: "listo", motor, ms: performance.now() - t0 });
  } catch (e) {
    ambito.postMessage({ tipo: "fallo", mensaje: `No se pudo cargar el núcleo de cálculo: ${String(e)}` });
  }
}

/** El núcleo se carga antes que nada: los pedidos que lleguen mientras tanto esperan a que esté. */
let listo: Promise<void> = Promise.resolve();

ambito.onmessage = (e) => {
  const m = e.data;
  if ("tipo" in m && m.tipo === "iniciar") {
    listo = iniciar(m.wasm);
    return;
  }
  void listo.then(() => {
    if (!cola) {
      if (!("tipo" in m)) ambito.postMessage({ id: m.id, huella: null, ok: false, diagnosticos: [{ codigo: "visor/sin-nucleo", severidad: "error", mensaje: "El núcleo de cálculo no está cargado." }], ms: 0 });
      return;
    }
    // Las tareas largas (proponer el armado, comprobar un tipo entero) van por turnos: `cola.ts`
    if ("tipo" in m) cola.cancelar(m.id);
    else cola.recibir(m);
  });
};
