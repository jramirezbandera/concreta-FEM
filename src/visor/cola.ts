/**
 * La cola del worker de sesión: quién se atiende y cuándo.
 *
 * Casi todos los pedidos se contestan de una vez, de uno en uno y en el orden en que llegan (un pedido
 * asíncrono, como los resultados guardados, no deja que otro vea la sesión a medias). Unos pocos son
 * **tareas** (`Atendedor.tarea`): proponer el armado de la obra, comprobar todas las piezas de un
 * tipo. En un edificio grande tardan minutos, y antes paraban el worker entero: nada se dibujaba ni
 * se podía cambiar de pestaña hasta que acababan, sin decir por dónde iban.
 *
 * Una tarea va **por pasos** (un generador que avisa tras cada pieza) y por turnos:
 *  - mientras hay pedidos de los que se contestan de una vez, van ellos;
 *  - si no, avanza una rebanada (unas decenas de ms) la tarea **más reciente**: lo último que ha pedido
 *    la interfaz (la tabla de la pestaña que se acaba de abrir) pasa delante de la propuesta que lleva
 *    un minuto en marcha. Las tareas comparten lo que van dejando hecho (las demandas de cada pieza,
 *    lo ya comprobado), así que turnarse no repite trabajo;
 *  - tras cada rebanada se le dice a la interfaz por dónde va (`progreso`, con `avance`) y se cede el
 *    hilo, para que entren los mensajes que hayan llegado;
 *  - una tarea se puede cancelar (`cancelar`): contesta en su siguiente turno, con `visor/cancelado`.
 *
 * Los números no dependen de los turnos: cada paso es el mismo cálculo que de una vez.
 *
 * Puro (sin `postMessage` ni temporizadores propios): quien la crea da cómo enviar y cómo ceder el
 * hilo. La usan el worker del navegador y los tests.
 */
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Atendedor, Contestacion } from "./atender.ts";
import { transferibles } from "./atender.ts";
import type { ProgresoTarea } from "./comprobaciones.ts";
import type { MensajeDelWorker, Pedido } from "./protocolo.ts";

/** Sólo los pedidos que devuelven arrays recién hechos van por Transferable (los de la sesión se quedan en ella). */
const TRANSFERIR = new Set(["geometria", "deformada", "escena", "alzado", "elegir", "alambrico", "losas", "pilares", "paquete"]);

/** Lo que dura un turno de una tarea, ms: lo que puede esperar un pedido que llega mientras tanto. */
export const REBANADA = 40;
/** Cada cuánto se avisa del avance de una tarea, ms. */
export const CADENCIA_AVANCE = 120;

interface Tarea {
  id: number;
  pedido: Pedido;
  g: Generator<ProgresoTarea, Contestacion>;
  /** Cuándo llegó y cuánto lleva trabajado (sin lo que ha esperado su turno). */
  t0: number;
  ms: number;
  /** El último avance, y cuándo se avisó del anterior. */
  avance: ProgresoTarea | null;
  avisado: number;
}

export interface OpcionesCola {
  /** Envía un mensaje a la interfaz. */
  enviar: (m: MensajeDelWorker, transferir?: ArrayBuffer[]) => void;
  /** Cede el hilo hasta la siguiente vuelta del bucle de eventos (para que entren los mensajes que esperan). */
  ceder: () => Promise<void>;
  /** El reloj, ms (por defecto, `performance.now`). */
  ahora?: () => number;
  rebanada?: number;
}

const fallo = (codigo: string, mensaje: string): Diagnostico[] => [{ codigo, severidad: "error", mensaje }];

export class Cola {
  private readonly at: Atendedor;
  private readonly o: OpcionesCola;
  private readonly ahora: () => number;
  private readonly pendientes: { id: number; pedido: Pedido }[] = [];
  /** Las tareas en marcha, de la más antigua a la más reciente. */
  private readonly tareas: Tarea[] = [];
  private readonly cancelados = new Set<number>();
  private bombeando: Promise<void> | null = null;
  private adelantar = false;

  constructor(at: Atendedor, o: OpcionesCola) {
    this.at = at;
    this.o = o;
    this.ahora = o.ahora ?? (() => performance.now());
  }

  /** Un pedido que llega. */
  recibir(m: { id: number; pedido: Pedido }): void {
    this.pendientes.push(m);
    this.bombear();
  }

  /** Cancela una tarea en marcha (o un pedido que aún espera): contesta con `visor/cancelado`. Lo que ya se contestó, nada. */
  cancelar(id: number): void {
    const i = this.pendientes.findIndex((m) => m.id === id);
    if (i >= 0) {
      this.pendientes.splice(i, 1);
      this.responder(id, { ok: false, diagnosticos: fallo("visor/cancelado", "Cancelado.") }, 0, "armar");
      return;
    }
    if (this.tareas.some((t) => t.id === id)) {
      this.cancelados.add(id);
      this.bombear();
    }
  }

  /** Tareas en marcha (para los tests). */
  get enMarcha(): number {
    return this.tareas.length;
  }

  /** Cuando no queda nada por atender (para los tests). */
  async vacia(): Promise<void> {
    while (this.bombeando) await this.bombeando;
  }

  private bombear(): void {
    if (this.bombeando) return;
    this.bombeando = this.bucle().finally(() => {
      this.bombeando = null;
      // Lo que llegó justo al acabar
      if (this.pendientes.length || this.tareas.length || this.cancelados.size) this.bombear();
    });
  }

  private async bucle(): Promise<void> {
    for (;;) {
      const m = this.pendientes.shift();
      if (m) {
        await this.atender(m);
        continue;
      }
      // Con resultados nuevos, lo que se puede adelantar va detrás de los pedidos que ya esperaban
      if (this.adelantar) {
        this.adelantar = false;
        this.at.ocioso();
        continue;
      }
      const t = this.tareas[this.tareas.length - 1];
      if (!t) return;
      this.turno(t);
      await this.o.ceder();
    }
  }

  private responder(id: number, r: Contestacion, ms: number, tipo: string): void {
    if (r.ok) this.o.enviar({ id, huella: this.at.huella, ok: true, valor: r.valor, ms }, TRANSFERIR.has(tipo) ? transferibles(r.valor) : []);
    else this.o.enviar({ id, huella: this.at.huella, ok: false, diagnosticos: r.diagnosticos, ms });
  }

  private async atender(m: { id: number; pedido: Pedido }): Promise<void> {
    const t0 = this.ahora();
    const interno = (e: unknown): Contestacion => ({ ok: false, diagnosticos: fallo("visor/error-interno", `Error interno del visor: ${e instanceof Error ? e.message : String(e)}`) });
    let g: Generator<ProgresoTarea, Contestacion> | null;
    try {
      g = this.at.tarea(m.pedido);
    } catch (e) {
      // El motor nunca lanza por un dato del modelo (E6); lo que llegue aquí es un fallo del visor
      return this.responder(m.id, interno(e), this.ahora() - t0, m.pedido.tipo);
    }
    if (g) {
      // Su primer turno, ya: si le basta (lo que pide está hecho), contesta como un pedido cualquiera
      const t: Tarea = { id: m.id, pedido: m.pedido, g, t0, ms: 0, avance: null, avisado: -Infinity };
      this.tareas.push(t);
      this.turno(t);
      return;
    }
    try {
      // R-25: las fases del cálculo, según terminan (el hilo principal las recibe mientras el worker sigue)
      const r = await this.at.atender(m.pedido, m.pedido.tipo === "calcular" ? (fase, ms) => this.o.enviar({ tipo: "progreso", id: m.id, fase, ms }) : undefined);
      this.responder(m.id, r, this.ahora() - t0, m.pedido.tipo);
      if (r.ok && (m.pedido.tipo === "calcular" || m.pedido.tipo === "guardados")) this.adelantar = true;
    } catch (e) {
      this.responder(m.id, interno(e), this.ahora() - t0, m.pedido.tipo);
    }
  }

  /** Un turno de una tarea: avanza hasta agotar la rebanada o acabar, y avisa de por dónde va. */
  private turno(t: Tarea): void {
    const quitar = () => {
      const i = this.tareas.indexOf(t);
      if (i >= 0) this.tareas.splice(i, 1);
      this.cancelados.delete(t.id);
    };
    const t0 = this.ahora();
    const fin = t0 + (this.o.rebanada ?? REBANADA);
    try {
      for (;;) {
        if (this.cancelados.has(t.id)) {
          quitar();
          t.g.return({ ok: false, diagnosticos: [] });
          return this.responder(t.id, { ok: false, diagnosticos: fallo("visor/cancelado", "Cancelado.") }, t.ms + this.ahora() - t0, t.pedido.tipo);
        }
        const r = t.g.next();
        if (r.done) {
          quitar();
          return this.responder(t.id, r.value, t.ms + this.ahora() - t0, t.pedido.tipo);
        }
        t.avance = r.value;
        // Lo que trae un parcial no se pierde entre dos avisos
        if (r.value.parcial) this.avisar(t, true);
        if (this.ahora() >= fin) break;
      }
    } catch (e) {
      quitar();
      return this.responder(t.id, { ok: false, diagnosticos: fallo("visor/error-interno", `Error interno del visor: ${e instanceof Error ? e.message : String(e)}`) }, t.ms + this.ahora() - t0, t.pedido.tipo);
    }
    t.ms += this.ahora() - t0;
    this.avisar(t, false);
  }

  private avisar(t: Tarea, siempre: boolean): void {
    const ahora = this.ahora();
    if (!t.avance || (!siempre && ahora - t.avisado < CADENCIA_AVANCE)) return;
    t.avisado = ahora;
    this.o.enviar({ tipo: "progreso", id: t.id, fase: t.avance.fase, ms: t.ms, avance: t.avance });
    // (un parcial se envía una vez)
    if (t.avance.parcial) {
      const { parcial: _p, ...resto } = t.avance;
      t.avance = resto;
    }
  }
}
