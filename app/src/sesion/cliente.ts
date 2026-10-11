/**
 * Cliente del worker de sesión, en el hilo principal. Un cliente por versión del proyecto: abrir
 * otro, o el mismo cambiado, es crear otro cliente y cerrar el anterior (`terminate`), así que una
 * respuesta de una versión anterior no puede llegar. Por si acaso, cada respuesta trae la huella de
 * su sesión y se rechaza si no es la que este cliente abrió (criterio 3 de V1).
 */
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { MensajeAlWorker, MensajeDelWorker, Pedido, Respuestas, TipoPedido } from "../../../src/visor/protocolo.ts";
import urlNucleo from "../../../src/nucleo/pkg/nucleo_bg.wasm?url";

export type Respuesta<K extends TipoPedido> = { ok: true; valor: Respuestas[K]; ms: number } | { ok: false; diagnosticos: Diagnostico[]; ms: number };

/** La respuesta era de otra huella (la sesión cambió): no se presenta. */
export class ErrorObsoleto extends Error {
  constructor() {
    super("respuesta de otra versión del proyecto");
    this.name = "ErrorObsoleto";
  }
}

let wasm: Promise<ArrayBuffer> | null = null;
/** Los bytes del núcleo, una vez por página (cada worker recibe su copia). */
function bytesNucleo(): Promise<ArrayBuffer> {
  return (wasm ??= fetch(urlNucleo).then((r) => {
    if (!r.ok) throw new Error(`No se pudo descargar el núcleo de cálculo (${r.status}).`);
    return r.arrayBuffer();
  }));
}

export class ClienteSesion {
  private readonly worker: Worker;
  private siguiente = 1;
  private readonly pendientes = new Map<number, { resolver: (r: Respuesta<TipoPedido>) => void; rechazar: (e: Error) => void; tipo: TipoPedido }>();
  private listo: Promise<string>;
  private cerrado = false;
  /** La huella que abrió este cliente (null hasta abrir). */
  huella: string | null = null;
  motor: string | null = null;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let alListo: (m: string) => void = () => {};
    let alFallo: (e: Error) => void = () => {};
    this.listo = new Promise<string>((res, rej) => {
      alListo = res;
      alFallo = rej;
    });
    this.worker.onmessage = (e: MessageEvent<MensajeDelWorker>) => {
      const m = e.data;
      if ("tipo" in m) {
        if (m.tipo === "listo") {
          this.motor = m.motor;
          alListo(m.motor);
        } else alFallo(new Error(m.mensaje));
        return;
      }
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      // La respuesta de «abrir» fija la huella; las demás tienen que traer esa misma
      if (p.tipo === "abrir") this.huella = m.huella;
      else if (m.huella !== this.huella) {
        p.rechazar(new ErrorObsoleto());
        return;
      }
      p.resolver(m.ok ? { ok: true, valor: m.valor as never, ms: m.ms } : { ok: false, diagnosticos: m.diagnosticos, ms: m.ms });
    };
    this.worker.onerror = (e) => {
      const err = new Error(`El worker de sesión falló: ${e.message}`);
      alFallo(err);
      for (const p of this.pendientes.values()) p.rechazar(err);
      this.pendientes.clear();
    };
    void bytesNucleo().then(
      (b) => this.enviar({ tipo: "iniciar", wasm: b.slice(0) }),
      (e: Error) => alFallo(e),
    );
  }

  private enviar(m: MensajeAlWorker, transferir: Transferable[] = []): void {
    if (!this.cerrado) this.worker.postMessage(m, transferir);
  }

  /** sha256 del núcleo, cuando está cargado. */
  iniciado(): Promise<string> {
    return this.listo;
  }

  async pedir<K extends TipoPedido>(pedido: Extract<Pedido, { tipo: K }>): Promise<Respuesta<K>> {
    await this.listo;
    if (this.cerrado) throw new ErrorObsoleto();
    const id = this.siguiente++;
    return new Promise<Respuesta<K>>((resolver, rechazar) => {
      this.pendientes.set(id, { resolver: resolver as (r: Respuesta<TipoPedido>) => void, rechazar, tipo: pedido.tipo });
      this.enviar({ id, pedido });
    });
  }

  cerrar(): void {
    this.cerrado = true;
    this.worker.terminate();
    for (const p of this.pendientes.values()) p.rechazar(new ErrorObsoleto());
    this.pendientes.clear();
  }
}
