// tramoViga: helper PURO que deriva LA planta donde caera una viga a partir del
// ambito activo (grupo/planta). Espejo de tramoColocable de pilares (#11, fuente
// unica de verdad), pero una viga vive en UNA sola planta, asi que devuelve UN
// plantaId (no un tramo inicial..final). Sin React ni three.js: solo lectura del
// modelo. Lo usan ColocacionViga (al colocar por clic) y App (guia de la barra de
// estado): si no hay planta colocable, la barra avisa ANTES de que el clic caiga
// en vacio.
import { plantasDeGrupo, plantaPorId, grupoPorId } from "../../dominio";
import type { Modelo } from "../../dominio";

// Devuelve el plantaId donde se introducira la viga:
//  - si hay planta activa y pertenece al grupo activo, esa (es la que se ve);
//  - si no, la planta mas baja por cota del grupo activo;
//  - si no hay forma de fijarla (sin grupo, o grupo sin plantas) -> null.
//
// El orden importa: la planta activa solo vale si CUELGA del grupo activo. Un
// `plantaActivaId` de otro grupo (o obsoleto: planta borrada aun no reparada por
// resolverVistaActiva) no debe colar una viga contra una planta que no se esta
// viendo; en ese caso se cae a la primera del grupo. Endurecimiento espejo del de
// pilares.
export function plantaColocableViga(
  modelo: Modelo,
  grupoActivoId: string | null,
  plantaActivaId: string | null,
): string | null {
  if (!grupoActivoId || grupoPorId(modelo, grupoActivoId) === undefined) {
    return null;
  }

  // Planta activa valida Y dentro del grupo activo: es la que el usuario ve.
  if (plantaActivaId) {
    const planta = plantaPorId(modelo, plantaActivaId);
    if (planta !== undefined && planta.grupoId === grupoActivoId) {
      return plantaActivaId;
    }
  }

  // Fallback: la planta mas baja por cota del grupo activo.
  const plantas = plantasDeGrupo(modelo, grupoActivoId)
    .slice()
    .sort((a, b) => a.cota - b.cota);
  return plantas.length > 0 ? plantas[0]!.id : null;
}
