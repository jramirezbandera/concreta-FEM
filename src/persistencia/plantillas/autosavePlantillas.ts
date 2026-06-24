// Autosave y carga de plantillas DXF (feature-15, T2.3). Persistencia-REFERENCIA,
// INDEPENDIENTE del autosave del Modelo (autosave.ts): suscribe `vistaStore.plantillas`
// (estado de UI, no de obra) y, tras un debounce, guarda el bloque de plantillas del
// proyecto que se le pase. La maquinaria de debounce (timer, serializacion de
// escrituras, hook de espera para tests) la aporta crearAutosaveDebounced (T4), sin la
// concurrencia optimista del Modelo: las plantillas son referencia, no fuente de verdad
// de calculo.
//
// Async no bloqueante (CLAUDE.md §7): el listener del store agenda un timer; el
// guardado real corre fuera del ciclo de set() de Zustand.
import { vistaStore } from "../../estado/vistaStore";
import type { Plantilla } from "../../ui/viewport/dxf/tiposDxf";
import {
  crearAutosaveDebounced,
  type AutosaveDebounceHandle,
} from "../autosaveDebounce";
import {
  cargarPlantillasDeProyecto,
  guardarPlantillasDeProyecto,
} from "./repositorioPlantillas";

// Handle del autosave en curso (singleton de modulo). Expuesto indirectamente via
// _esperarGuardadoPlantillas para que los tests cierren la cadena de Dexie antes de
// leer la DB. `null` mientras no haya autosave activo (cadena ya resuelta).
let handle: AutosaveDebounceHandle | null = null;

// Espera al ultimo guardado en vuelo (solo tests; en produccion nadie la observa).
// Delega en el handle activo; si no hay autosave en marcha, la cadena esta resuelta.
export function _esperarGuardadoPlantillas(): Promise<void> {
  return handle?.esperarGuardado() ?? Promise.resolve();
}

interface OpcionesAutosavePlantillas {
  // Configurable sobre todo para tests (timers cortos / falsos).
  debounceMs?: number;
  // Callback de errores no recuperables del guardado: rechazo de Dexie (cuota, DB
  // cerrada). El autosave NUNCA relanza: surfacea por aqui para que F9 lo muestre
  // sin romper la edicion de plantillas en curso.
  onError?: (error: unknown) => void;
}

// Arranca el autosave de plantillas para `proyectoId` y devuelve una funcion de BAJA
// (teardown). INDEPENDIENTE del autosave del Modelo: tiene su propia suscripcion, su
// propio timer y su propia tabla. Pensado para iniciarse al ABRIR un proyecto (ya se
// conoce su id) y darse de baja al cerrarlo/cambiar de proyecto.
//
// El `proyectoId` se fija al iniciar (no se lee de un puntero activo como hace el
// autosave del Modelo): la plantilla es referencia ligada a SU proyecto; reiniciar el
// autosave al cambiar de proyecto es responsabilidad del cableado (T4.1).
//
// Baja: NO hace flush (decision del helper). Es un teardown (desmontaje, cambio de
// proyecto): cancela el timer pendiente y desuscribe, dejando CERO guardados en vuelo.
// Un guardado tardio tras la baja escribiria plantillas de un proyecto que quiza ya no
// es el activo.
export function iniciarAutosavePlantillas(
  proyectoId: string,
  opciones?: OpcionesAutosavePlantillas,
): () => void {
  const onError = opciones?.onError;

  // El guardado efectivo: lee las plantillas actuales del store y las persiste para
  // ESTE proyecto. Async fire-and-forget (el helper no espera). Envuelto en try/catch:
  // cualquier rechazo de Dexie se surfacea por onError, NUNCA se relanza.
  const guardar = async (): Promise<void> => {
    try {
      const plantillas: Plantilla[] = vistaStore.getState().plantillas;
      await guardarPlantillasDeProyecto(proyectoId, plantillas);
    } catch (error) {
      onError?.(error);
    }
  };

  // Suscripcion a las plantillas (estado de UI): subscribeWithSelector dispara el
  // listener solo cuando cambia la referencia de `s.plantillas`. El helper re-arma el
  // debounce en cada cambio.
  const h = crearAutosaveDebounced({
    subscribe: (onCambio) =>
      vistaStore.subscribe((s) => s.plantillas, onCambio),
    guardar,
    debounceMs: opciones?.debounceMs,
  });
  handle = h;

  // Baja: teardown del helper (cancela el debounce pendiente y desuscribe, sin flush)
  // y limpia el handle de modulo SOLO si sigue siendo el nuestro (no pisa a otro
  // autosave que pudiera haberse iniciado despues).
  return () => {
    h.teardown();
    if (handle === h) handle = null;
  };
}

// Carga las plantillas persistidas de un proyecto en el vistaStore. Valida en el
// borde (cargarPlantillasDeProyecto usa PlantillaSchema y descarta lo invalido):
// un IndexedDB manipulado no puede meter una plantilla corrupta en el store.
// Pensado para llamarse al ABRIR un proyecto, ANTES (o junto) de arrancar el autosave.
export async function cargarPlantillasEnStore(
  proyectoId: string,
): Promise<void> {
  const plantillas = await cargarPlantillasDeProyecto(proyectoId);
  vistaStore.getState().setPlantillas(plantillas);
}
