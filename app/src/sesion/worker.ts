/**
 * Worker de sesión del visor (V1, docs/fem3d/visor.md §3.1). Carga el núcleo WASM, guarda la sesión
 * (`src/visor/atender.ts`) y contesta los pedidos de uno en uno, en el orden en que llegan: un pedido
 * asíncrono (los resultados guardados) no deja que otro vea la sesión a medias.
 */
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Atendedor, transferibles } from "../../../src/visor/atender.ts";
import type { MensajeAlWorker, MensajeDelWorker } from "../../../src/visor/protocolo.ts";
import { sha256Bytes } from "../../../src/visor/sesion.ts";

interface AmbitoWorker {
  onmessage: ((e: MessageEvent<MensajeAlWorker>) => void) | null;
  postMessage(m: MensajeDelWorker, transferir?: Transferable[]): void;
}

const ambito = globalThis as unknown as AmbitoWorker;
let atendedor: Atendedor | null = null;
let cola: Promise<void> = Promise.resolve();

/**
 * Sólo los pedidos que devuelven arrays recién hechos van por Transferable (los de la sesión se
 * quedan en ella). Las escenas preparadas se hacen en cada pedido; la sesión guarda las de A4.
 */
const TRANSFERIR = new Set(["geometria", "deformada", "escena", "alzado", "elegir", "alambrico", "losas", "pilares", "paquete"]);

async function procesar(m: MensajeAlWorker): Promise<void> {
  const t0 = performance.now();
  if ("tipo" in m) {
    try {
      const motor = await sha256Bytes(new Uint8Array(m.wasm));
      await iniciarNucleo(m.wasm);
      atendedor = new Atendedor(motor);
      ambito.postMessage({ tipo: "listo", motor, ms: performance.now() - t0 });
    } catch (e) {
      ambito.postMessage({ tipo: "fallo", mensaje: `No se pudo cargar el núcleo de cálculo: ${String(e)}` });
    }
    return;
  }
  const at = atendedor;
  if (!at) {
    ambito.postMessage({ id: m.id, huella: null, ok: false, diagnosticos: [{ codigo: "visor/sin-nucleo", severidad: "error", mensaje: "El núcleo de cálculo no está cargado." }], ms: 0 });
    return;
  }
  try {
    const r = await at.atender(m.pedido);
    const ms = performance.now() - t0;
    if (r.ok) ambito.postMessage({ id: m.id, huella: at.huella, ok: true, valor: r.valor, ms }, TRANSFERIR.has(m.pedido.tipo) ? transferibles(r.valor) : []);
    else ambito.postMessage({ id: m.id, huella: at.huella, ok: false, diagnosticos: r.diagnosticos, ms });
    // Con resultados nuevos, lo que se puede adelantar va detrás de los pedidos que ya esperan
    if (r.ok && (m.pedido.tipo === "calcular" || m.pedido.tipo === "guardados")) setTimeout(() => (cola = cola.then(() => at.ocioso())), 0);
  } catch (e) {
    // El motor nunca lanza por un dato del modelo (E6); lo que llegue aquí es un fallo del visor
    ambito.postMessage({ id: m.id, huella: at.huella, ok: false, diagnosticos: [{ codigo: "visor/error-interno", severidad: "error", mensaje: `Error interno del visor: ${e instanceof Error ? e.message : String(e)}` }], ms: performance.now() - t0 });
  }
}

ambito.onmessage = (e) => {
  cola = cola.then(() => procesar(e.data));
};
