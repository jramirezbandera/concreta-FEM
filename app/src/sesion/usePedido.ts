/**
 * Un pedido a la sesión desde una pantalla. Mientras llega la respuesta de un pedido nuevo se
 * conserva la anterior (cambiar de planta no deja la pantalla en blanco), salvo si cambió el cliente:
 * entonces era de otra versión del proyecto y se borra en el acto (criterio 3 de V1).
 *
 * Desde I2, varias vistas pueden pedir lo mismo a la vez (dos plantas iguales, la vista y su panel):
 * un pedido idéntico a otro en curso del mismo cliente espera a ese, en vez de repetirlo.
 */
import { useEffect, useState } from "react";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { Pedido, Respuestas, TipoPedido } from "../../../src/visor/protocolo.ts";
import { ErrorObsoleto, type ClienteSesion } from "./cliente.ts";

export interface Pedido_<K extends TipoPedido> {
  datos: Respuestas[K] | null;
  diagnosticos: Diagnostico[] | null;
  cargando: boolean;
  /** Milisegundos que tardó en el worker. */
  ms: number | null;
}

const enCurso = new WeakMap<ClienteSesion, Map<string, Promise<unknown>>>();

/** El pedido `clave` al cliente, o el que ya está en curso con esa misma clave. */
function pedirCompartido<K extends TipoPedido>(cliente: ClienteSesion, clave: string): ReturnType<ClienteSesion["pedir"]> {
  let m = enCurso.get(cliente);
  if (!m) enCurso.set(cliente, (m = new Map()));
  const ya = m.get(clave);
  if (ya) return ya as ReturnType<ClienteSesion["pedir"]>;
  const p = cliente.pedir(JSON.parse(clave) as Extract<Pedido, { tipo: K }>);
  m.set(clave, p);
  const quitar = () => m.get(clave) === p && m.delete(clave);
  p.then(quitar, quitar);
  return p;
}

export function usePedido<K extends TipoPedido>(cliente: ClienteSesion | null, pedido: Extract<Pedido, { tipo: K }> | null): Pedido_<K> {
  const clave = pedido ? JSON.stringify(pedido) : null;
  const [r, setR] = useState<Pedido_<K> & { cliente: ClienteSesion | null; clave: string | null }>({ datos: null, diagnosticos: null, cargando: false, ms: null, cliente: null, clave: null });
  useEffect(() => {
    if (!cliente || !clave) return;
    let vivo = true;
    setR((x) => (x.cliente === cliente ? { ...x, cargando: true, clave } : { datos: null, diagnosticos: null, cargando: true, ms: null, cliente, clave }));
    pedirCompartido<K>(cliente, clave).then(
      (res) => {
        if (!vivo) return;
        setR(res.ok ? { datos: res.valor as Respuestas[K], diagnosticos: null, cargando: false, ms: res.ms, cliente, clave } : { datos: null, diagnosticos: res.diagnosticos, cargando: false, ms: res.ms, cliente, clave });
      },
      (e: unknown) => {
        if (!vivo || e instanceof ErrorObsoleto) return;
        setR({ datos: null, diagnosticos: [{ codigo: "visor/error-interno", severidad: "error", mensaje: e instanceof Error ? e.message : String(e) }], cargando: false, ms: null, cliente, clave });
      },
    );
    return () => {
      vivo = false;
    };
  }, [cliente, clave]);
  // De otro cliente (otra versión del proyecto): no se enseña
  if (r.cliente !== cliente) return { datos: null, diagnosticos: null, cargando: !!clave, ms: null };
  return { datos: r.datos, diagnosticos: r.diagnosticos, cargando: r.cargando || r.clave !== clave, ms: r.ms };
}
