// tramoViga: helper PURO que deriva LA planta donde caera una viga a partir del
// ambito activo (planta). Espejo de tramoColocable de pilares (#11, fuente
// unica de verdad), pero una viga vive en UNA sola planta, asi que devuelve UN
// plantaId (no un tramo inicial..final). Sin React ni three.js: solo lectura del
// modelo. Lo usan ColocacionViga (al colocar por clic) y App (guia de la barra de
// estado): si no hay planta colocable, la barra avisa ANTES de que el clic caiga
// en vacio.
import { plantasOrdenadas, plantaPorId } from "../../dominio";
import type { Modelo } from "../../dominio";

// Devuelve el plantaId donde se introducira la viga:
//  - si hay planta activa valida, esa (es la que se ve);
//  - si no, la planta mas baja por cota del edificio;
//  - si el modelo no tiene plantas -> null.
//
// Un `plantaActivaId` obsoleto (planta borrada aun no reparada por
// resolverVistaActiva) no debe colar una viga contra una planta que no existe; en
// ese caso se cae a la primera del edificio. Endurecimiento espejo del de pilares.
export function plantaColocableViga(
  modelo: Modelo,
  plantaActivaId: string | null,
): string | null {
  // Planta activa valida: es la que el usuario ve.
  if (plantaActivaId && plantaPorId(modelo, plantaActivaId) !== undefined) {
    return plantaActivaId;
  }

  // Fallback: la planta mas baja por cota del edificio.
  const plantas = plantasOrdenadas(modelo);
  return plantas.length > 0 ? plantas[0]!.id : null;
}
