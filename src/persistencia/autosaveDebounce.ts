// Helper compartido de autosave con debounce (feature-15, T4). Factoriza la
// maquinaria comun a los dos autosaves de la app (autosave.ts del Modelo y
// plantillas/autosavePlantillas.ts de las plantillas DXF): el timer de debounce,
// la cadena de serializacion de escrituras y el hook de espera para tests.
//
// Qué encapsula y qué NO:
//   - SI: timer de debounce (setTimeout global), cancelarTimer, el listener que
//     re-arma el reloj en cada cambio, la cadena `_guardadoEnVuelo` de
//     serializacion, y `esperarGuardado` para que los tests cierren los awaits.
//   - NO: a QUE store se suscribe ni que selector usa (lo aporta `subscribe`), ni
//     el cuerpo de `guardar` (lo aporta el llamante). Tampoco la concurrencia
//     optimista (baseline) del Modelo ni la coordinacion load-vs-timer: eso es
//     especifico de autosave.ts y se queda alli.
//
// Async no bloqueante (CLAUDE.md §7): el listener del store es SINCRONO y solo
// agenda un timer; el guardado real corre fire-and-forget fuera del ciclo de
// set() de Zustand, sin bloquear la edicion.

// Debounce por defecto: ventana corta tras la ultima edicion. Debounce (NO
// throttle): re-arranca el reloj en cada cambio para que una rafaga de comandos
// (arrastres, tecleo, sliders) acabe en UN solo guardado del estado final, no en
// N. UNICA FUENTE del valor: ambos autosaves lo heredan de aqui.
export const DEBOUNCE_MS_DEFECTO = 800;

export interface OpcionesAutosaveDebounce {
  // Suscripcion al store: registra `onCambio` y devuelve la funcion de baja
  // (unsubscribe). El llamante decide el store y el selector (p. ej.
  // `modeloStore.subscribe((s) => s.modelo, onCambio)`); el helper solo necesita
  // saber "cuando cambia algo" y "como desuscribirse", no de QUE.
  subscribe: (onCambio: () => void) => () => void;
  // Guardado efectivo (fire-and-forget): persiste el estado actual. El helper lo
  // encadena en la cadena de serializacion; el llamante es responsable de su
  // propio try/catch -> onError (este helper NUNCA relanza ni observa el rechazo).
  guardar: () => Promise<void>;
  // Ventana de debounce; por defecto DEBOUNCE_MS_DEFECTO. Configurable sobre todo
  // para tests (timers cortos / falsos).
  debounceMs?: number;
}

export interface AutosaveDebounceHandle {
  // Baja (teardown): cancela el timer pendiente y desuscribe del store, SIN flush.
  // Es un desmontaje (cambio de proyecto, recarga del modulo en tests): deja CERO
  // guardados en vuelo. Un guardado tardio tras la baja reintroduciria estado de
  // un store que quiza ya cambio de duenno. Si en el futuro hace falta "guardar
  // ya" (cerrar pestana), se anadira un `flush()` explicito y separado.
  teardown: () => void;
  // Espera al ultimo guardado en vuelo. El autosave es fire-and-forget (no se
  // puede await desde un listener sincrono de Zustand), pero los tests necesitan
  // saber cuando un guardado disparado por el debounce ha tocado realmente Dexie.
  // En produccion nadie la observa.
  esperarGuardado: () => Promise<void>;
  // Cancela el timer de debounce pendiente. Se expone para coordinacion externa:
  // autosave.ts lo necesita para que la carga de un proyecto aborte un timer de la
  // edicion anterior (que escribiria el modelo recien cargado en el proyecto previo).
  cancelarTimer: () => void;
}

// Crea un autosave con debounce. Cada cambio notificado por `subscribe` re-arma el
// timer; al cumplir, encola `guardar` en la cadena de serializacion. Devuelve un
// handle con teardown, esperarGuardado y cancelarTimer.
export function crearAutosaveDebounced(
  opciones: OpcionesAutosaveDebounce,
): AutosaveDebounceHandle {
  const debounceMs = opciones.debounceMs ?? DEBOUNCE_MS_DEFECTO;
  const { subscribe, guardar } = opciones;

  // Timer a nivel de cierre: el debounce se implementa a mano (sin lodash) con
  // setTimeout global, para que vi.useFakeTimers() lo intercepte en los tests.
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelarTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  // Promesa del ultimo guardado en vuelo. Sirve como CADENA de serializacion: cada
  // guardado se encola sobre el anterior (ignorando su posible rechazo) para que
  // dos guardados solapados no se entrelacen y escriban fuera de orden; gana el
  // ultimo estado. Interna al handle (cada autosave tiene la suya).
  let guardadoEnVuelo: Promise<void> = Promise.resolve();

  // Suscripcion al store. Cada cambio re-arma el debounce; al cumplir, encadena el
  // guardado sobre el ultimo en vuelo.
  const unsubscribe = subscribe(() => {
    cancelarTimer();
    timer = setTimeout(() => {
      timer = undefined;
      guardadoEnVuelo = guardadoEnVuelo.catch(() => {}).then(guardar);
    }, debounceMs);
  });

  return {
    teardown: () => {
      cancelarTimer();
      unsubscribe();
    },
    esperarGuardado: () => guardadoEnVuelo,
    cancelarTimer,
  };
}
