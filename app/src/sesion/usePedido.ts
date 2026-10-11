/**
 * Un pedido a la sesión desde una pantalla. Mientras llega la respuesta de un pedido nuevo se
 * conserva la anterior (cambiar de planta no deja la pantalla en blanco), salvo si cambió el cliente:
 * entonces era de otra versión del proyecto y se borra en el acto (criterio 3 de V1).
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

export function usePedido<K extends TipoPedido>(cliente: ClienteSesion | null, pedido: Extract<Pedido, { tipo: K }> | null): Pedido_<K> {
  const clave = pedido ? JSON.stringify(pedido) : null;
  const [r, setR] = useState<Pedido_<K> & { cliente: ClienteSesion | null; clave: string | null }>({ datos: null, diagnosticos: null, cargando: false, ms: null, cliente: null, clave: null });
  useEffect(() => {
    if (!cliente || !clave) return;
    let vivo = true;
    setR((x) => (x.cliente === cliente ? { ...x, cargando: true, clave } : { datos: null, diagnosticos: null, cargando: true, ms: null, cliente, clave }));
    cliente.pedir(JSON.parse(clave) as Extract<Pedido, { tipo: K }>).then(
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
