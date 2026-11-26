/**
 * El registro de una propuesta de armado: lo que el worker va haciendo, paso a paso y con sus tiempos
 * (la pestaña «Proceso» de Comprobación). La tira del avance dice por dónde va; esto, lo que ya ha
 * pasado: cada tipo, cada fase con cuántas piezas y cuánto tardó, y al final lo propuesto y lo que se
 * queda sin propuesta, con su motivo.
 *
 * Es de la página, no del proyecto: se llena con los avisos de avance del pedido `armar` (uno por
 * pieza: sólo se anota una línea al cambiar de fase) y se vacía al empezar la propuesta siguiente.
 */
import type { ProgresoTarea, TipoComprobacion } from "../../../src/visor/comprobaciones.ts";

export type ClaseLinea = "inicio" | "tipo" | "fase" | "hecho" | "dato" | "aviso" | "error" | "fin";

export interface LineaProceso {
  /** ms desde que empezó el proceso. */
  t: number;
  clase: ClaseLinea;
  texto: string;
}

export interface EstadoProceso {
  titulo: string | null;
  lineas: readonly LineaProceso[];
  enMarcha: boolean;
  /** `performance.now()` al empezar; lo que duró, al acabar. */
  inicio: number;
  duracion: number | null;
}

const NOMBRE: Record<TipoComprobacion, string> = { pilares: "Pilares", vigas: "Vigas", losas: "Losas", punzonamiento: "Punzonamiento" };
const PIEZAS: Record<TipoComprobacion, string> = { pilares: "pilares", vigas: "vigas", losas: "losas", punzonamiento: "pilares" };

/** «12 s», «1 min 05 s», «menos de 1 s». */
export function duracion(ms: number): string {
  const s = Math.round(ms / 1000);
  if (ms < 950) return "menos de 1 s";
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** «03:25», el tiempo de una línea. */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Cuántas lleva una fase, en palabras: «120 de 560 vanos»; las reglas de obra no saben cuántas subidas harán. */
export function cuentaAvance(a: ProgresoTarea): string {
  if (a.fase === "hecho") return "";
  if (a.fase === "reglas de obra") return `${a.hecho} ${a.hecho === 1 ? "ajuste" : "ajustes"}`;
  return `${a.hecho} de ${a.total} ${a.unidad ?? PIEZAS[a.tipo]}`;
}

interface FaseAbierta {
  tipo: TipoComprobacion;
  ultimo: ProgresoTarea;
  desde: number;
}

export class RegistroProceso {
  private e: EstadoProceso = { titulo: null, lineas: [], enMarcha: false, inicio: 0, duracion: null };
  private fase: FaseAbierta | null = null;
  private tipo: TipoComprobacion | null = null;
  private tipoDesde = 0;
  private readonly oyentes = new Set<() => void>();

  estado = (): EstadoProceso => this.e;

  alCambiar = (f: () => void): (() => void) => {
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  };

  private poner(c: Partial<EstadoProceso>): void {
    this.e = { ...this.e, ...c };
    for (const f of this.oyentes) f();
  }

  private linea(clase: ClaseLinea, texto: string, ahora: number): void {
    this.poner({ lineas: [...this.e.lineas, { t: ahora - this.e.inicio, clase, texto }] });
  }

  /** Empieza un proceso: el registro de antes se tira. */
  empezar(titulo: string, detalle: string, ahora = performance.now()): void {
    this.fase = null;
    this.tipo = null;
    this.e = { titulo, lineas: [], enMarcha: true, inicio: ahora, duracion: null };
    this.linea("inicio", detalle, ahora);
  }

  private cerrarFase(ahora: number): void {
    const f = this.fase;
    this.fase = null;
    if (!f) return;
    // Acabada (empieza la siguiente): todas las suyas, aunque el último aviso llegara antes de la última
    const u = f.ultimo;
    const c = u.fase !== "reglas de obra" && u.total > 0 ? `${u.total} ${u.unidad ?? PIEZAS[u.tipo]}` : cuentaAvance(u);
    this.linea("fase", `${u.fase}${c ? ` · ${c}` : ""} · ${duracion(ahora - f.desde)}`, ahora);
  }

  /** Un aviso de avance del worker. Anota al cambiar de tipo o de fase y al acabar un tipo. */
  avance(a: ProgresoTarea, ahora = performance.now()): void {
    if (!this.e.enMarcha) return;
    const f = this.fase;
    if (f && f.tipo === a.tipo && f.ultimo.fase === a.fase && a.hecho >= f.ultimo.hecho) {
      f.ultimo = a;
      return;
    }
    this.cerrarFase(ahora);
    // (un tipo que acaba sin avisar de ninguna fase, por rápido, también tiene su línea)
    if (this.tipo !== a.tipo) {
      this.tipo = a.tipo;
      this.tipoDesde = ahora;
      this.linea("tipo", `${a.partes && a.partes > 1 ? `${a.parte} de ${a.partes} · ` : ""}${NOMBRE[a.tipo]}`, ahora);
    }
    if (a.fase === "hecho") {
      this.linea("hecho", `${NOMBRE[a.tipo]}: propuesto y comprobado en ${duracion(ahora - this.tipoDesde)}. Ya se puede ver en su pestaña.`, ahora);
      return;
    }
    this.fase = { tipo: a.tipo, ultimo: a, desde: ahora };
  }

  /** La fase que está abierta (lo que se hace ahora) y desde cuándo. */
  abierta(): { avance: ProgresoTarea; desde: number } | null {
    return this.fase ? { avance: this.fase.ultimo, desde: this.fase.desde } : null;
  }

  /** Una línea suelta (el resumen de un tipo, una pieza sin propuesta). */
  anotar(clase: ClaseLinea, texto: string, ahora = performance.now()): void {
    this.linea(clase, texto, ahora);
  }

  /** Acaba el proceso, con su última línea. */
  acabar(clase: "fin" | "aviso" | "error", texto: string, ahora = performance.now()): void {
    if (!this.e.enMarcha) return;
    if (clase !== "fin") this.fase = null;
    else this.cerrarFase(ahora);
    const d = ahora - this.e.inicio;
    this.linea(clase, `${texto} Tiempo total: ${duracion(d)}.`, ahora);
    this.poner({ enMarcha: false, duracion: d });
  }
}

/** El registro de la página. */
export const registroProceso = new RegistroProceso();
