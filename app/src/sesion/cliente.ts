/**
 * Cliente del worker de sesión, en el hilo principal. Un cliente por versión del proyecto: abrir
 * otro, o el mismo cambiado, es crear otro cliente y cerrar el anterior (`terminate`), así que una
 * respuesta de una versión anterior no puede llegar. Por si acaso, cada respuesta trae la huella de
 * su sesión y se rechaza si no es la que este cliente abrió (criterio 3 de V1).
 */
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { ProgresoTarea } from "../../../src/visor/comprobaciones.ts";
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

/**
 * Una tarea larga del worker en marcha (`src/visor/cola.ts`: proponer el armado, comprobar un tipo
 * entero): el pedido, por dónde va y desde cuándo. La interfaz las enseña con su avance.
 */
export interface TareaEnMarcha {
  id: number;
  pedido: Pedido;
  avance: ProgresoTarea;
  /** Cuándo llegó su primer aviso y cuándo empezó la fase en la que está (`performance.now()`): para estimar lo que le queda. */
  desde: number;
  desdeFase: number;
  /** Lo hecho al empezar a contar la fase (un aviso puede llegar con la fase ya empezada). */
  hechoFase: number;
}

let wasm: Promise<ArrayBuffer> | null = null;
/**
 * Los bytes del núcleo, una vez por página (cada worker recibe su copia). Si la descarga falla, se
 * olvida: el siguiente proyecto que se abra lo vuelve a intentar (UI-28; antes, todo lo que se
 * abría después fallaba hasta recargar la página).
 */
function bytesNucleo(): Promise<ArrayBuffer> {
  const p = (wasm ??= fetch(urlNucleo).then((r) => {
    if (!r.ok) throw new Error(`No se pudo descargar el núcleo de cálculo (${r.status}).`);
    return r.arrayBuffer();
  }));
  p.catch(() => {
    if (wasm === p) wasm = null;
  });
  return p;
}

export class ClienteSesion {
  private readonly worker: Worker;
  private siguiente = 1;
  private readonly pendientes = new Map<number, { resolver: (r: Respuesta<TipoPedido>) => void; rechazar: (e: Error) => void; tipo: TipoPedido; pedido: Pedido; alProgreso?: (fase: string, ms: number) => void; alAvance?: (a: ProgresoTarea) => void }>();
  /** Las tareas en marcha, por su pedido; `oyentes`, quien las mira (`useTareas`). */
  private enMarcha: readonly TareaEnMarcha[] = [];
  private readonly oyentes = new Set<() => void>();
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
        if (m.tipo === "progreso") {
          const p = this.pendientes.get(m.id);
          if (!p) return;
          if (m.avance) {
            this.anotarAvance(m.id, p.pedido, m.avance);
            p.alAvance?.(m.avance);
          } else p.alProgreso?.(m.fase, m.ms);
          return;
        }
        if (m.tipo === "listo") {
          this.motor = m.motor;
          alListo(m.motor);
        } else alFallo(new Error(m.mensaje));
        return;
      }
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      this.quitarTarea(m.id);
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

  /**
   * `alProgreso` (R-25): las fases del cálculo según terminan, en `calcular`. `alAvance`: por dónde va
   * una tarea larga (una propuesta de armado: pieza a pieza, y el armado parcial al acabar cada tipo).
   * `senal`: al abortarla, la tarea se cancela en el worker y el pedido contesta con `visor/cancelado`.
   */
  async pedir<K extends TipoPedido>(pedido: Extract<Pedido, { tipo: K }>, opciones: { alProgreso?: (fase: string, ms: number) => void; alAvance?: (a: ProgresoTarea) => void; senal?: AbortSignal } = {}): Promise<Respuesta<K>> {
    await this.listo;
    if (this.cerrado) throw new ErrorObsoleto();
    const id = this.siguiente++;
    return new Promise<Respuesta<K>>((resolver, rechazar) => {
      this.pendientes.set(id, { resolver: resolver as (r: Respuesta<TipoPedido>) => void, rechazar, tipo: pedido.tipo, pedido, ...(opciones.alProgreso ? { alProgreso: opciones.alProgreso } : {}), ...(opciones.alAvance ? { alAvance: opciones.alAvance } : {}) });
      this.enviar({ id, pedido });
      opciones.senal?.addEventListener("abort", () => this.pendientes.has(id) && this.enviar({ tipo: "cancelar", id }), { once: true });
    });
  }

  /** Cancela una tarea en marcha (la de `tareas()`): su pedido contesta con `visor/cancelado`. */
  cancelar(id: number): void {
    if (this.pendientes.has(id)) this.enviar({ tipo: "cancelar", id });
  }

  /** Las tareas largas en marcha, con su avance (la misma lista mientras no cambia). */
  tareas(): readonly TareaEnMarcha[] {
    return this.enMarcha;
  }

  /** Avisa cuando cambian las tareas en marcha o su avance; devuelve cómo dejar de escuchar. */
  alCambiarTareas(f: () => void): () => void {
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  }

  private anotarAvance(id: number, pedido: Pedido, avance: ProgresoTarea): void {
    const ahora = performance.now();
    const previa = this.enMarcha.find((t) => t.id === id);
    const mismaFase = previa && previa.avance.fase === avance.fase && previa.avance.tipo === avance.tipo && avance.hecho >= previa.hechoFase;
    const nueva: TareaEnMarcha = { id, pedido, avance, desde: previa?.desde ?? ahora, desdeFase: mismaFase ? previa.desdeFase : ahora, hechoFase: mismaFase ? previa.hechoFase : avance.hecho };
    this.enMarcha = previa ? this.enMarcha.map((t) => (t.id === id ? nueva : t)) : [...this.enMarcha, nueva];
    for (const f of this.oyentes) f();
  }

  private quitarTarea(id: number): void {
    if (!this.enMarcha.some((t) => t.id === id)) return;
    this.enMarcha = this.enMarcha.filter((t) => t.id !== id);
    for (const f of this.oyentes) f();
  }

  cerrar(): void {
    this.cerrado = true;
    this.worker.terminate();
    for (const p of this.pendientes.values()) p.rechazar(new ErrorObsoleto());
    this.pendientes.clear();
    if (this.enMarcha.length) {
      this.enMarcha = [];
      for (const f of this.oyentes) f();
    }
  }
}
