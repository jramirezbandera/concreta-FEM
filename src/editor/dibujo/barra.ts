/**
 * BN3 (`docs/fem3d/barras.md` §6): la herramienta Barra, que dibuja una barra entre dos niveles con
 * dos clics, en un alzado o en planta. Lo que hace es el punto del modelo de cada clic (planta, x, y):
 *
 * - **En un alzado:** el punto del modelo del enganche (`alzado.ts`): el nudo de un pilar, un punto de
 *   una viga o de un muro, el cruce con un eje, el extremo de otra barra o un punto de una línea de
 *   nivel. Un punto que no engancha vale si cae en una línea de nivel; si no, es un error: en BN una
 *   barra va de planta a planta (`dz` = 0).
 * - **En planta:** el primer clic, en la planta de la vista; el segundo, en la de la plantilla (`fin`)
 *   o, si no dice ninguna, en la de la vista del segundo clic: con dos vistas de planta, cada clic en
 *   la suya.
 *
 * El primer extremo es del modelo, así que no se pierde al pasar a otra vista: se ve en todas y el
 * segundo clic puede ir en cualquiera. Lo que se crea es lo mismo que daría la fila de la tabla
 * Barras: el inicio, el primer clic; la sección, el giro, «sólo tracción» y, con `articulada`, las
 * liberaciones de una diagonal (los giros de flexión libres en los dos extremos y la torsión en el
 * fin, `LIBERACIONES_ARTICULADA`).
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { rotulo } from "../../agente/render/escena.ts";
import type { Barra, ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import type { Objeto } from "../referencias.ts";
import { idNuevo } from "../tablas.ts";
import { puntoEnVista, puntoModeloAlzado } from "./alzado.ts";
import type { Enganche, PuntoModelo } from "./enganches.ts";
import { ESTADO_INICIAL, igual, seccionValida, type Borrador, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Paso, type Plantillas } from "./herramientas.ts";

export type NombreBarra = "barraNiveles";

export interface PlantillaBarra {
  seccion?: string;
  /** De la sección alrededor del eje de la barra, °. */
  giro?: number;
  /** Las uniones de una diagonal de arriostramiento (`LIBERACIONES_ARTICULADA`). */
  articulada?: boolean;
  soloTraccion?: boolean;
  /** En planta, la planta del segundo extremo; sin ella, la de la vista del segundo clic. */
  fin?: string;
}

/** Las liberaciones de una barra articulada: My y Mz en los dos extremos y la torsión en el fin (sin ella, un mecanismo). */
export const LIBERACIONES_ARTICULADA: NonNullable<Barra["liberaciones"]> = {
  inicio: [false, false, false, false, true, true],
  fin: [false, false, false, true, true, true],
};

const SIN_NIVEL = "En un alzado, una barra va de planta a planta: lleve el punto a la línea de nivel de una planta (o a un nudo, una viga o un eje en ella).";
const SIN_SECCION = "Elija en Propiedades la sección de la barra (o cree una).";

/** «P1 (5; 0)»: un punto del modelo. */
export const textoPunto = (q: PuntoModelo) => `${q.planta} (${rotulo(q.p[0], 4)}; ${rotulo(q.p[1], 4)})`;

/** El punto del modelo del clic p (con su enganche); `primero`, el del primer extremo. */
export function extremoBarra(p: Vec2, enganche: Enganche | null | undefined, ctx: ContextoHerramienta, primero: boolean): { ok: true; extremo: PuntoModelo } | { ok: false; mensaje: string } {
  const a = ctx.indice.alzado;
  if (a) {
    const q = puntoModeloAlzado(a, p, enganche);
    return q ? { ok: true, extremo: q } : { ok: false, mensaje: SIN_NIVEL };
  }
  const planta = primero ? ctx.planta : ctx.plantillas.barraNiveles?.fin || ctx.planta;
  if (!ctx.modelo.plantas.some((x) => x.id === planta)) return { ok: false, mensaje: `No hay ninguna planta «${planta}»: elija otra en Propiedades.` };
  return { ok: true, extremo: { planta, p } };
}

/** La barra de a a b con la plantilla, sin id, en el orden de la fila de la tabla. */
export function barraDe(a: PuntoModelo, b: PuntoModelo, t: PlantillaBarra): Omit<Barra, "id"> {
  return {
    inicio: { planta: a.planta, x: a.p[0], y: a.p[1] },
    fin: { planta: b.planta, x: b.p[0], y: b.p[1] },
    seccion: t.seccion!,
    ...(t.giro ? { giro: t.giro } : {}),
    ...(t.soloTraccion ? { soloTraccion: true } : {}),
    ...(t.articulada ? { liberaciones: { inicio: [...LIBERACIONES_ARTICULADA.inicio!], fin: [...LIBERACIONES_ARTICULADA.fin!] } } : {}),
  } as Omit<Barra, "id">;
}

export function pasoBarra(e: EstadoHerramienta, ev: Evento, ctx: ContextoHerramienta): Paso {
  if (ev.tipo === "retroceso") return { estado: ESTADO_INICIAL };
  if (ev.tipo !== "punto") return { estado: e };
  const t = ctx.plantillas.barraNiveles ?? {};
  if (!seccionValida(ctx.modelo, t.seccion)) return { estado: e, error: SIN_SECCION };
  const r = extremoBarra(ev.p, ev.enganche, ctx, !e.extremo);
  if (!r.ok) return { estado: e, error: r.mensaje };
  const a = e.extremo;
  if (!a) return { estado: { puntos: [{ p: ev.p }], extremo: r.extremo } };
  // El segundo clic de un doble clic, en el mismo punto, no es una barra
  if (a.planta === r.extremo.planta && igual(a.p, r.extremo.p)) return { estado: e };
  const id = idNuevo(ctx.modelo, "B");
  const barra = { id, ...barraDe(a, r.extremo, t) };
  return { estado: ESTADO_INICIAL, hecho: { operacion: { op: "crear", coleccion: "barras", objeto: barra as unknown as Objeto }, etiqueta: `Barra ${id}, de ${a.planta} a ${r.extremo.planta}` } };
}

/** El primer extremo en la vista, y la línea hasta el cursor. */
export function borradorBarra(e: EstadoHerramienta, cursor: Vec2 | null, ctx: ContextoHerramienta, r: Borrador): void {
  r.puntos = [];
  const a = e.extremo ? puntoEnVista(e.extremo, ctx.indice) : null;
  if (!a) return;
  r.puntos.push(a);
  if (cursor && !igual(cursor, a)) r.lineas.push([a, cursor]);
}

/** Lo que dice la herramienta; `alzado`, si el cursor está en un alzado. */
export function ayudaBarra(e: EstadoHerramienta, t: Plantillas, alzado: boolean): string {
  const fin = t.barraNiveles?.fin;
  if (!e.extremo)
    return alzado
      ? "Barra: el primer extremo, en el nivel de una planta (el nudo de un pilar, una viga, el cruce con un eje o la línea de nivel; o «u; z» e Intro). Esc vuelve a Elegir."
      : "Barra: el primer extremo, en esta planta (o en un alzado, en un nivel). Esc vuelve a Elegir.";
  const donde = alzado ? "en el nivel de una planta" : fin ? `en ${fin} (Propiedades)` : "en la planta de la vista";
  return `Barra desde ${textoPunto(e.extremo)}: el segundo extremo, ${donde}. Retroceso o Esc lo quitan.`;
}

/** Lo que dice la barra de estado del punto del cursor: dónde quedaría el extremo. */
export function cursorBarra(p: Vec2, enganche: Enganche | null | undefined, ctx: ContextoHerramienta, primero: boolean): string | null {
  const r = extremoBarra(p, enganche, ctx, primero);
  return r.ok ? `→ ${textoPunto(r.extremo)}` : null;
}

/** La sección de por defecto de la herramienta: la más usada por las barras; si no, ninguna (se propone acero al crearla). */
export function seccionBarra(m: ModeloFisico): string | undefined {
  const n = new Map<string, number>();
  for (const b of m.barras ?? []) n.set(b.seccion, (n.get(b.seccion) ?? 0) + 1);
  let mejor: string | undefined;
  for (const [s, k] of n) if (m.secciones.some((x) => x.id === s) && (!mejor || k > n.get(mejor)!)) mejor = s;
  return mejor;
}
