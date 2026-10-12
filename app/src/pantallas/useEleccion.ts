/** El resaltado de un objeto en una escena (lo que la sesión dibuja de él). */
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { FuenteEscena } from "../../../src/visor/sesion.ts";
import { useVisor } from "../contexto.ts";
import { usePedido } from "../sesion/usePedido.ts";

export function useEleccion(fuente: FuenteEscena | null, objeto: string | null): Eleccion | null {
  const { proyecto } = useVisor();
  const r = usePedido(proyecto.cliente, fuente && objeto ? { tipo: "elegir", fuente, punto: null, radio: 0, objetos: [objeto] } : null);
  return r.datos && r.datos.objeto === objeto ? r.datos : null;
}
