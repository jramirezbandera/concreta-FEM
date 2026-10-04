/**
 * Cliente del worker del motor en el hilo principal (E4; H16, H20, H27). Es la versión asíncrona
 * de `calcular()`: el mismo modelo entra y el mismo `ResultadoCalculo` sale, calculado en otro hilo.
 *
 * - **Un worker caliente.** Arranca con `calentar()` o con el primer cálculo y recibe el núcleo ya
 *   compilado, así que arrancar cuesta instanciarlo, no compilarlo.
 * - **En cola, de uno en uno.** El worker no atiende mensajes mientras calcula; el cliente envía el
 *   siguiente cálculo cuando llega el resultado del anterior.
 * - **Cancelar (H20)** es `terminate()`: se rechaza lo pendiente con `ErrorCancelado` y se calienta
 *   otro worker en segundo plano.
 * - **Reciclar (H16).** Ni la memoria lineal del núcleo ni el heap de V8 del worker bajan tras un
 *   cálculo, y el worker no puede medir su heap JS (no hay `performance.memory` en un worker). Por
 *   defecto el worker se recicla tras cada cálculo: el siguiente arranca en ~10 ms y pierde el JIT
 *   caliente (un 7–12 % más lento, E4). Con `umbralReciclaje`, sólo cuando la memoria lineal pasa
 *   de él. Tras un fallo (`ErrorWorker`: excepción o trampa del WASM) se recicla siempre.
 * - **Reposo.** Sin cálculos durante `reposoMs`, el worker se termina y se vuelve a arrancar al
 *   calcular.
 *
 * No usa el DOM: el worker lo fabrica `crearWorker`. En el navegador,
 *   crearWorkerWeb(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }))
 */
import type { LimitesCalculo } from "../motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCalculo } from "../motor/modelo.ts";
import type { MemoriaNucleo, MensajeAlWorker, MensajeDelWorker, OpcionesWorker } from "./protocolo.ts";

export interface PuertoWorker {
  postMessage(m: MensajeAlWorker, transferir: Transferable[]): void;
  terminate(): void;
}

/** Fabrica un worker que llama a `alMensaje` con cada mensaje y a `alError` si se cae o no carga. */
export type CrearWorker = (alMensaje: (m: MensajeDelWorker) => void, alError: (mensaje: string) => void) => PuertoWorker;

/** `CrearWorker` para el navegador, a partir de una fábrica de `Worker`. */
export function crearWorkerWeb(fabrica: () => Worker): CrearWorker {
  return (alMensaje, alError) => {
    const w = fabrica();
    w.onmessage = (e: MessageEvent<MensajeDelWorker>) => alMensaje(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      alError(e.message || "error al cargar o ejecutar el worker");
    };
    w.onmessageerror = () => alError("mensaje del worker que no se puede leer");
    return w;
  };
}

/** El cálculo se canceló (o se cerró el cliente) antes de terminar. */
export class ErrorCancelado extends Error {
  constructor(mensaje = "cálculo cancelado") {
    super(mensaje);
    this.name = "ErrorCancelado";
  }
}

/** El worker falló (excepción del motor, trampa del WASM o caída); el cliente ya lo ha reciclado. */
export class ErrorWorker extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorWorker";
  }
}

export interface Progreso {
  fase: string;
  ms: number;
  memoria: MemoriaNucleo;
}

export interface OpcionesCliente {
  crearWorker: CrearWorker;
  /** Núcleo WASM compilado una vez (`WebAssembly.compileStreaming(fetch(url))`), para todos los workers. */
  nucleo: WebAssembly.Module | Promise<WebAssembly.Module>;
  /**
   * Memoria lineal del núcleo (bytes) por encima de la cual se recicla el worker tras un cálculo.
   * Por defecto, 0: tras cada cálculo (ver la cabecera y `LIMITES` en `limites.ts`).
   */
  umbralReciclaje?: number;
  /** Milisegundos sin cálculos tras los que se termina el worker. Por defecto, nunca. */
  reposoMs?: number;
  /** Límites del dispositivo para todos los cálculos (ver `limites.ts`); cada cálculo puede cambiarlos. */
  limites?: LimitesCalculo;
}

export interface OpcionesCalculoCliente extends OpcionesWorker {
  alProgreso?: (p: Progreso) => void;
}

export interface EstadoCliente {
  /** Hay un worker (arrancando o listo). */
  vivo: boolean;
  /** El worker ha cargado el núcleo y puede calcular. */
  listo: boolean;
  /** Cálculos en curso o en cola. */
  pendientes: number;
  /** La última memoria del núcleo que informó el worker. */
  memoria?: MemoriaNucleo;
  /** Workers arrancados desde que se creó el cliente. */
  arranques: number;
  /** Workers reciclados por memoria o por fallo. */
  reciclajes: number;
}

interface Tarea {
  id: number;
  modelo: ModeloAnalitico;
  opciones: OpcionesCalculoCliente;
  resolver: (r: ResultadoCalculo) => void;
  rechazar: (e: Error) => void;
}

interface Activo {
  generacion: number;
  puerto: PuertoWorker;
  listo: Promise<void>;
  esListo: boolean;
  resolverListo: () => void;
  rechazarListo: (e: Error) => void;
}


export class ClienteMotor {
  private readonly opciones: OpcionesCliente;
  private activo: Activo | null = null;
  private generacion = 0;
  private siguienteId = 1;
  private enCurso: Tarea | null = null;
  private readonly cola: Tarea[] = [];
  private reposo: ReturnType<typeof setTimeout> | null = null;
  private memoria?: MemoriaNucleo;
  private arranques = 0;
  private reciclajes = 0;

  constructor(opciones: OpcionesCliente) {
    this.opciones = opciones;
  }

  get estado(): EstadoCliente {
    return {
      vivo: this.activo !== null,
      listo: this.activo?.esListo ?? false,
      pendientes: this.cola.length + (this.enCurso ? 1 : 0),
      memoria: this.memoria,
      arranques: this.arranques,
      reciclajes: this.reciclajes,
    };
  }

  /** Arranca el worker si no lo está y espera a que tenga el núcleo cargado. */
  calentar(): Promise<void> {
    return this.asegurar().listo;
  }

  /** Calcula el modelo en el worker. Rechaza con `ErrorCancelado` o `ErrorWorker`, nunca con un resultado a medias. */
  calcular(modelo: ModeloAnalitico, opciones: OpcionesCalculoCliente = {}): Promise<ResultadoCalculo> {
    this.pararReposo();
    return new Promise((resolver, rechazar) => {
      this.cola.push({ id: this.siguienteId++, modelo, opciones, resolver, rechazar });
      this.despachar();
    });
  }

  /** Cancela el cálculo en curso y los de la cola, termina el worker y calienta otro. */
  cancelar(): void {
    this.rechazarTodo(new ErrorCancelado());
    this.descartar();
    this.asegurar();
  }

  /** Termina el worker sin calentar otro; lo pendiente se rechaza con `ErrorCancelado`. */
  cerrar(): void {
    this.pararReposo();
    this.rechazarTodo(new ErrorCancelado("cliente del motor cerrado"));
    this.descartar();
  }

  private asegurar(): Activo {
    if (this.activo) return this.activo;
    const generacion = ++this.generacion;
    let resolverListo!: () => void;
    let rechazarListo!: (e: Error) => void;
    const listo = new Promise<void>((ok, mal) => {
      resolverListo = ok;
      rechazarListo = mal;
    });
    listo.catch(() => {}); // si nadie espera, que no sea un rechazo sin manejar
    const puerto = this.opciones.crearWorker(
      (m) => this.alMensaje(generacion, m),
      (mensaje) => this.alFallo(generacion, mensaje),
    );
    const activo: Activo = { generacion, puerto, listo, esListo: false, resolverListo, rechazarListo };
    this.activo = activo;
    this.arranques++;
    Promise.resolve(this.opciones.nucleo).then(
      (nucleo) => {
        if (this.activo === activo) puerto.postMessage({ tipo: "iniciar", nucleo }, []);
      },
      (e: unknown) => this.alFallo(generacion, `no se pudo compilar el núcleo: ${e instanceof Error ? e.message : String(e)}`),
    );
    return activo;
  }

  /** Termina el worker actual (si lo hay); sus mensajes posteriores se ignoran. */
  private descartar(): void {
    const a = this.activo;
    if (!a) return;
    this.activo = null;
    a.rechazarListo(new ErrorCancelado("worker terminado"));
    a.puerto.terminate();
  }

  private despachar(): void {
    if (this.enCurso || this.cola.length === 0) return;
    const tarea = this.cola.shift()!;
    this.enCurso = tarea;
    const activo = this.asegurar();
    activo.listo.then(
      () => {
        if (this.enCurso !== tarea || this.activo !== activo) return;
        const opciones: OpcionesWorker = {
          solver: tarea.opciones.solver,
          limites: tarea.opciones.limites ?? this.opciones.limites,
        };
        activo.puerto.postMessage({ tipo: "calcular", id: tarea.id, modelo: tarea.modelo, opciones }, []);
      },
      () => {}, // el fallo de arranque ya rechazó la tarea (alFallo)
    );
  }

  private alMensaje(generacion: number, m: MensajeDelWorker): void {
    const a = this.activo;
    if (!a || a.generacion !== generacion) return; // de un worker ya terminado
    switch (m.tipo) {
      case "listo":
        this.memoria = m.memoria;
        a.esListo = true;
        a.resolverListo();
        return;
      case "progreso":
        this.memoria = m.memoria;
        if (this.enCurso?.id === m.id) this.enCurso.opciones.alProgreso?.({ fase: m.fase, ms: m.ms, memoria: m.memoria });
        return;
      case "resultado": {
        this.memoria = m.memoria;
        const t = this.enCurso;
        if (t?.id !== m.id) return;
        this.enCurso = null;
        if (m.memoria.lineal > (this.opciones.umbralReciclaje ?? 0)) this.reciclar();
        t.resolver(m.resultado);
        this.despachar();
        this.programarReposo();
        return;
      }
      case "fallo":
        this.alFallo(generacion, m.mensaje);
        return;
    }
  }

  /**
   * El worker ha fallado: al arrancar (se rechaza todo lo pendiente, para no reintentar en bucle) o
   * en un cálculo (se rechaza ése y la cola sigue en un worker nuevo).
   */
  private alFallo(generacion: number, mensaje: string): void {
    const a = this.activo;
    if (!a || a.generacion !== generacion) return;
    const error = new ErrorWorker(mensaje);
    if (!a.esListo) {
      a.rechazarListo(error);
      this.rechazarTodo(error);
      this.descartar();
      return;
    }
    const t = this.enCurso;
    this.enCurso = null;
    this.reciclar();
    t?.rechazar(error);
    this.despachar();
    this.programarReposo();
  }

  private reciclar(): void {
    this.reciclajes++;
    this.descartar();
    this.asegurar();
  }

  private rechazarTodo(e: Error): void {
    const tareas = [...(this.enCurso ? [this.enCurso] : []), ...this.cola.splice(0)];
    this.enCurso = null;
    for (const t of tareas) t.rechazar(e);
  }

  private programarReposo(): void {
    const ms = this.opciones.reposoMs;
    if (ms === undefined || this.enCurso || this.cola.length) return;
    this.pararReposo();
    this.reposo = setTimeout(() => {
      this.reposo = null;
      if (!this.enCurso && this.cola.length === 0) this.descartar();
    }, ms);
  }

  private pararReposo(): void {
    if (this.reposo !== null) clearTimeout(this.reposo);
    this.reposo = null;
  }
}
