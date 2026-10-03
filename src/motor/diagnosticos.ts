/**
 * Diagnósticos del motor (§16 del diseño, H12): cada uno nombra los objetos analíticos por su
 * `id`, nunca sólo por un índice interno del solver.
 */

export type Severidad = "info" | "aviso" | "error";

export interface Diagnostico {
  /** Código estable, «área/causa» (p. ej. `restriccion/esclavo-doble`). */
  codigo: string;
  severidad: Severidad;
  mensaje: string;
  /** Ids analíticos de los nudos, elementos, muelles o restricciones implicados. */
  ids?: string[];
  detalles?: Record<string, unknown>;
}

/** Máximo de ids que se listan en un diagnóstico (en el mensaje y en `ids`). */
export const MAX_IDS = 20;

export class Diagnosticos {
  readonly lista: Diagnostico[] = [];

  agregar(d: Diagnostico): void {
    if (d.ids && d.ids.length > MAX_IDS) {
      d.detalles = { ...d.detalles, totalIds: d.ids.length };
      d.ids = d.ids.slice(0, MAX_IDS);
    }
    this.lista.push(d);
  }

  error(codigo: string, mensaje: string, ids?: string[], detalles?: Record<string, unknown>): void {
    this.agregar({ codigo, severidad: "error", mensaje, ids, detalles });
  }

  aviso(codigo: string, mensaje: string, ids?: string[], detalles?: Record<string, unknown>): void {
    this.agregar({ codigo, severidad: "aviso", mensaje, ids, detalles });
  }

  info(codigo: string, mensaje: string, ids?: string[], detalles?: Record<string, unknown>): void {
    this.agregar({ codigo, severidad: "info", mensaje, ids, detalles });
  }

  get hayErrores(): boolean {
    return this.lista.some((d) => d.severidad === "error");
  }
}

/** «N1, N2, N3 y 12 más» para los mensajes. */
export function listaIds(ids: readonly string[], max = 5): string {
  if (ids.length <= max) return ids.join(", ");
  return `${ids.slice(0, max).join(", ")} y ${ids.length - max} más`;
}
