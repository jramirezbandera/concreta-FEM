// tramoPilar: helper PURO que deriva el tramo (planta inicial -> final) de un pilar
// a partir del ambito activo (grupo/planta). Sin React ni three.js: solo lectura del
// modelo. Es UNA SOLA fuente de verdad, usada por ColocacionPilar (al colocar por
// clic) y por App (para la guia de la barra de estado): si no hay tramo colocable,
// la barra avisa ANTES de que el clic caiga en vacio (endurecimiento del review).
import { plantasDeGrupo } from "../../dominio";
import type { Modelo } from "../../dominio";

export interface TramoPilar {
  plantaInicial: string;
  plantaFinal: string;
}

// En F1 un pilar del grupo activo arranca en la planta mas baja y acaba en la mas
// alta del grupo. Si el grupo no tiene plantas pero hay una planta activa, se usa esa
// para ambos extremos. Devuelve null si no hay forma de fijar el tramo (sin grupo ni
// planta activos): sin tramo no se puede colocar el pilar.
export function tramoColocable(
  modelo: Modelo,
  grupoActivoId: string | null,
  plantaActivaId: string | null,
): TramoPilar | null {
  if (grupoActivoId) {
    const plantas = plantasDeGrupo(modelo, grupoActivoId)
      .slice()
      .sort((a, b) => a.cota - b.cota);
    if (plantas.length > 0) {
      return {
        plantaInicial: plantas[0]!.id,
        plantaFinal: plantas[plantas.length - 1]!.id,
      };
    }
  }
  if (plantaActivaId) {
    return { plantaInicial: plantaActivaId, plantaFinal: plantaActivaId };
  }
  return null;
}
