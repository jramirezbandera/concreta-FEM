// resolverVistaActiva: logica PURA de coherencia de la vista activa frente al
// modelo (feature-9, T3; simplificada en F3.4 "plantas sin grupos"). Extraida de
// App.tsx para poder testearla en el project "node" sin arrastrar React/three.js.
//
// FAILURE MODE que repara: al cargar una segunda obra (restaurar autosave o
// cambiar de proyecto) la planta activa conserva un id de la obra anterior, que no
// existe en la nueva -> el viewport filtra por una planta inexistente y queda
// vacio sin error. Esta funcion detecta el id obsoleto y re-selecciona la planta
// cabecera (mayor cota, orden CYPECAD), preservando una seleccion del usuario que
// SI siga siendo valida (idempotente).
import type { Modelo } from "../../dominio";

export interface VistaActiva {
  plantaActivaId: string | null;
}

export function resolverVistaActiva(modelo: Modelo, vista: VistaActiva): VistaActiva {
  const { plantas } = modelo;

  // Planta: conservar solo si sigue existiendo; si no (null, inexistente o de otra
  // obra), re-seleccionar la cabecera (mayor cota).
  const plantaVigente =
    vista.plantaActivaId !== null &&
    plantas.some((p) => p.id === vista.plantaActivaId);
  if (plantaVigente) {
    return { plantaActivaId: vista.plantaActivaId };
  }
  const cabecera = plantas.slice().sort((a, b) => b.cota - a.cota)[0];
  return { plantaActivaId: cabecera?.id ?? null };
}
