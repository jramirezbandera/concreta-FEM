// tramoPilar: helper PURO que deriva el tramo (planta inicial -> final) de un pilar
// a partir del ambito activo (planta). Sin React ni three.js: solo lectura del
// modelo. Es UNA SOLA fuente de verdad, usada por ColocacionPilar (al colocar por
// clic) y por App (para la guia de la barra de estado): si no hay tramo colocable,
// la barra avisa ANTES de que el clic caiga en vacio (endurecimiento del review).
import { plantasOrdenadas, plantaPorId } from "../../dominio";
import type { Modelo } from "../../dominio";

export interface TramoPilar {
  plantaInicial: string;
  plantaFinal: string;
}

// Sin grupos (F3.4), un pilar colocado abarca de la planta mas baja a la mas alta
// del EDIFICIO (mismo resultado que antes con un unico grupo, el caso normal). Si
// el modelo solo tiene una planta, ambos extremos son esa (el tramo degenera y el
// calculo lo bloquea como pilar de longitud 0; la UI guia a crear mas plantas).
// Devuelve null si no hay plantas ni planta activa valida: sin tramo no se puede
// colocar el pilar.
export function tramoColocable(
  modelo: Modelo,
  plantaActivaId: string | null,
): TramoPilar | null {
  const plantas = plantasOrdenadas(modelo);
  if (plantas.length > 0) {
    return {
      plantaInicial: plantas[0]!.id,
      plantaFinal: plantas[plantas.length - 1]!.id,
    };
  }
  // Fallback a la planta activa SOLO si existe en el modelo: un `plantaActivaId`
  // obsoleto (planta borrada, aún no reparado por resolverVistaActiva) no debe
  // dar luz verde a colocar un pilar contra una planta inexistente (el discretizador
  // lo rechazaría aguas abajo). Endurecimiento del review de ingenieria.
  if (plantaActivaId && plantaPorId(modelo, plantaActivaId) !== undefined) {
    return { plantaInicial: plantaActivaId, plantaFinal: plantaActivaId };
  }
  return null;
}
