// resolverVistaActiva: logica PURA de coherencia de la vista activa frente al
// modelo (feature-9, T3). Extraida de App.tsx para poder testearla en el project
// "node" sin arrastrar React/three.js.
//
// FAILURE MODE que repara: al cargar una segunda obra (restaurar autosave o
// cambiar de proyecto) el grupo/planta activos conservan ids de la obra anterior,
// que no existen en la nueva -> el viewport filtra por un grupo inexistente y
// queda vacio sin error. Esta funcion detecta los ids obsoletos y re-selecciona
// el primer grupo y la planta cabecera (mayor cota, orden CYPECAD), preservando
// una seleccion del usuario que SI siga siendo valida (idempotente).
import type { Modelo } from "../../dominio";

export interface VistaActiva {
  grupoActivoId: string | null;
  plantaActivaId: string | null;
}

export function resolverVistaActiva(modelo: Modelo, vista: VistaActiva): VistaActiva {
  const { grupos, plantas } = modelo;

  // Grupo: conservar si sigue existiendo; si no (null o id de otra obra),
  // re-seleccionar el primer grupo (o null si el modelo no tiene grupos).
  const grupoVigente =
    vista.grupoActivoId !== null && grupos.some((g) => g.id === vista.grupoActivoId);
  const grupoActivoId = grupoVigente ? vista.grupoActivoId : (grupos[0]?.id ?? null);

  if (grupoActivoId === null) {
    return { grupoActivoId: null, plantaActivaId: null };
  }

  // Planta: conservar solo si pertenece al grupo resuelto; si no (null,
  // inexistente o de otro grupo), re-seleccionar la cabecera (mayor cota).
  const plantasGrupo = plantas.filter((p) => p.grupoId === grupoActivoId);
  const plantaVigente =
    vista.plantaActivaId !== null &&
    plantasGrupo.some((p) => p.id === vista.plantaActivaId);
  if (plantaVigente) {
    return { grupoActivoId, plantaActivaId: vista.plantaActivaId };
  }
  const cabecera = plantasGrupo.slice().sort((a, b) => b.cota - a.cota)[0];
  return { grupoActivoId, plantaActivaId: cabecera?.id ?? null };
}
