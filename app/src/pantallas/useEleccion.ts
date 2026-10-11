/** El resaltado del objeto elegido en la escena que se ve (lo que la sesión dibuja de él). */
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { VistaPlanta } from "../../../src/visor/sesion.ts";
import { useVisor } from "../contexto.ts";
import { usePedido } from "../sesion/usePedido.ts";

export function useEleccion(planta: string | null, vista: VistaPlanta, objeto: string | null, activo = true): Eleccion | null {
  const { proyecto } = useVisor();
  const r = usePedido(proyecto.cliente, activo && planta && objeto ? { tipo: "elegir", planta, vista, punto: null, radio: 0, objeto } : null);
  return r.datos && r.datos.objeto === objeto ? r.datos : null;
}
