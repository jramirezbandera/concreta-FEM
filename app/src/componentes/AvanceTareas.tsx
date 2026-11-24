/**
 * El avance de las tareas largas del worker (`src/visor/cola.ts`): proponer el armado de la obra o
 * comprobar todas las piezas de un tipo, que en un edificio grande son minutos. Dice qué se hace, por
 * qué pieza va, cuántas son y lo que queda más o menos, y deja cancelar una propuesta.
 *
 * Las tareas son del cliente de la sesión (`ClienteSesion.tareas`): las ve cualquier pantalla, pida
 * quien pida. `AvanceTareas` es la tira del pie de la app; `AvanceTarea`, la de una tarea, más grande,
 * donde la pantalla espera por ella.
 */
import { useSyncExternalStore } from "react";
import type { TipoComprobacion } from "../../../src/visor/comprobaciones.ts";
import { fmt } from "../fmt.ts";
import type { ClienteSesion, TareaEnMarcha } from "../sesion/cliente.ts";

const NINGUNA: readonly TareaEnMarcha[] = [];
const sinOyente = () => () => {};

/** Las tareas largas en marcha del cliente, al día. */
export function useTareas(cliente: ClienteSesion | null): readonly TareaEnMarcha[] {
  // (un cliente sin tareas: los de los tests, que sólo contestan pedidos)
  const con = cliente && typeof cliente.alCambiarTareas === "function" ? cliente : null;
  return useSyncExternalStore(
    con ? (f) => con.alCambiarTareas(f) : sinOyente,
    () => con?.tareas() ?? NINGUNA,
  );
}

const NOMBRE: Record<TipoComprobacion, string> = { pilares: "pilares", vigas: "vigas", losas: "losas", punzonamiento: "punzonamiento" };
const PIEZAS: Record<TipoComprobacion, string> = { pilares: "pilares", vigas: "vigas", losas: "losas", punzonamiento: "pilares" };

/** Lo que queda de la fase, en palabras: de lo que han tardado las piezas ya hechas de esta fase. */
export function quedan(t: TareaEnMarcha, ahora: number): string | null {
  const a = t.avance;
  const hechas = a.hecho - t.hechoFase;
  const pasado = ahora - t.desdeFase;
  if (a.total <= a.hecho || hechas < 2 || pasado < 1500) return null;
  const s = ((pasado / hechas) * (a.total - a.hecho)) / 1000;
  if (s < 5) return "unos segundos";
  if (s < 90) return `~${Math.round(s / 5) * 5} s`;
  return `~${fmt(s / 60, s < 600 ? 1 : 0)} min`;
}

/** Qué hace una tarea, en palabras: «Proponiendo el armado · 2 de 4: vigas» o «Comprobando las vigas». */
export function tituloTarea(t: TareaEnMarcha): string {
  const a = t.avance;
  if (t.pedido.tipo === "armar") return `Proponiendo el armado${a.partes && a.partes > 1 ? ` · ${a.parte} de ${a.partes}: ${NOMBRE[a.tipo]}` : ` · ${NOMBRE[a.tipo]}`}`;
  return a.tipo === "punzonamiento" ? "Comprobando el punzonamiento" : `Comprobando ${a.tipo === "vigas" ? "las vigas" : a.tipo === "losas" ? "las losas" : "los pilares"}`;
}

/** Por dónde va: «armado de la tabla · 12 de 80 pilares · P13». */
export function detalleTarea(t: TareaEnMarcha): string {
  const a = t.avance;
  // (las reglas de obra no saben cuántas subidas harán: dan las hechas)
  const cuenta = a.fase === "reglas de obra" ? `${a.hecho} ${a.hecho === 1 ? "ajuste" : "ajustes"}` : a.fase === "hecho" ? "" : `${a.hecho} de ${a.total} ${a.unidad ?? PIEZAS[a.tipo]}`;
  return [a.fase === "hecho" ? "acabando" : a.fase, cuenta, a.pieza].filter(Boolean).join(" · ");
}

const fraccion = (t: TareaEnMarcha) => (t.avance.fase === "reglas de obra" || t.avance.total <= 0 ? null : Math.min(1, t.avance.hecho / t.avance.total));

/** Una tarea con su barra, su detalle y lo que le queda. `grande`: donde la pantalla espera por ella. */
export function AvanceTarea({ tarea: t, cliente, grande }: { tarea: TareaEnMarcha; cliente: ClienteSesion; grande?: boolean }) {
  const f = fraccion(t);
  const eta = quedan(t, performance.now());
  return (
    <div className={grande ? "avance avance-grande" : "avance"} role="status" data-avance={t.pedido.tipo} data-avance-tipo={t.avance.tipo}>
      <span className="avance-titulo">{tituloTarea(t)}</span>
      <span className="avance-barra" aria-hidden="true">
        <span data-indeterminada={f === null || undefined} style={f === null ? undefined : { width: `${Math.round(100 * f)}%` }} />
      </span>
      <span className="avance-detalle">
        {detalleTarea(t)}
        {eta ? ` · quedan ${eta}` : ""}
      </span>
      {t.pedido.tipo === "armar" && (
        <button type="button" className="btn" style={{ height: grande ? 24 : 18, padding: "0 8px", fontSize: grande ? 12 : 11 }} onClick={() => cliente.cancelar(t.id)} title="Deja de proponer: lo ya propuesto (los tipos acabados) se queda">
          Cancelar
        </button>
      )}
    </div>
  );
}

/** La tira del pie de la app: la tarea más reciente (la que el worker lleva delante) y cuántas esperan detrás. */
export function AvanceTareas({ cliente }: { cliente: ClienteSesion | null }) {
  const tareas = useTareas(cliente);
  // Varias tareas que piden lo mismo (la tabla y la planta de un tipo) se ven como una: la última
  const t = tareas[tareas.length - 1];
  if (!cliente || !t) return null;
  const otras = tareas.filter((x) => x !== t && x.pedido.tipo === "armar").length;
  return (
    <span className="avance-pie" data-avance-pie>
      <AvanceTarea tarea={t} cliente={cliente} />
      {otras > 0 && <span className="avance-detalle">· detrás, la propuesta de armado</span>}
    </span>
  );
}
