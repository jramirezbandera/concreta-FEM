// Autosave (T4.1) y carga de proyecto en el store. Conecta el modeloStore (Capa 1)
// con la persistencia Dexie: cada cambio de la obra dispara, tras un debounce, un
// guardado del proyecto activo. SOLO persiste la Capa 1 (CLAUDE.md §12): el modelo
// que sale de getModelo(); nunca resultados ni Capa 2 (derivados/recalculables).
//
// Async no bloqueante (CLAUDE.md §7): el listener del store agenda un timer; el
// guardado real corre fuera del ciclo de set() del store, sin bloquear edicion.
import { modeloStore } from "../estado/modeloStore";
import { migrarYValidar, type ResultadoImport } from "./migracion";
import {
  cargarProyecto,
  getProyectoActivoId,
  guardarModeloDeProyecto,
  setProyectoActivoId,
} from "./repositorio";

// Error de conflicto de concurrencia optimista (T1). Forma discriminada y legible
// para que F9 lo distinga de otros fallos (cuota, DB cerrada) en el callback
// onError y decida que hacer (recargar el registro ajeno o sobrescribirlo).
// Documentado para F9: cuando llega un `ErrorConflictoAutosave`, otra pestana
// guardo despues de la baseline que esta pestana conocia; la edicion local NO se
// perdio (sigue en el store) pero NO se persistio. F9 debe ofrecer recargar
// (descarta lo local) o forzar guardado (re-llamar al autosave reseteando la
// baseline al `actualizadoEn` ajeno).
export interface ErrorConflictoAutosave {
  tipo: "conflicto";
  id: string;
}

// Promesa del ultimo guardado en vuelo. El autosave es fire-and-forget (no se
// puede await desde un listener sincrono de Zustand), pero los tests necesitan
// saber cuando un guardado disparado por el debounce ha tocado realmente Dexie.
// Sirve ademas como CADENA de serializacion (T1): cada guardado se encola sobre
// el anterior para que dos guardados solapados no escriban fuera de orden.
// Exportada solo para tests: en produccion nadie la observa.
let _guardadoEnVuelo: Promise<void> = Promise.resolve();
export function _esperarGuardadoAutosave(): Promise<void> {
  return _guardadoEnVuelo;
}

// Baseline de concurrencia optimista a nivel de modulo (T1): el `actualizadoEn`
// del ultimo estado que esta pestana conoce, JUNTO al id al que pertenece. Se
// actualiza al cargar/guardar con exito; en `conflicto` NO se toca (deja que F9
// decida). Guardamos el id porque el proyecto activo puede cambiar sin pasar por
// el autosave (p. ej. crearProyecto fija el puntero por su cuenta, T5): si la
// baseline es de otro proyecto, NO la aplicamos (evita falsos conflictos).
// `null` = no hay baseline util: se guarda sin comprobar conflicto.
let baseline: { id: string; actualizadoEn: number } | null = null;

// Canceller del timer de debounce pendiente, a nivel de modulo (T5). Permite que
// la carga de un proyecto cancele un timer que pertenecia a la edicion anterior,
// para que no escriba el modelo recien cargado en el proyecto previo. La baja de
// iniciarAutosave lo limpia solo si sigue siendo el suyo (no pisa a otro autosave).
let cancelarTimerPendiente: (() => void) | null = null;

// Debounce por defecto: ventana corta tras la ultima edicion. Debounce (NO
// throttle): re-arranca el reloj en cada cambio para que una rafaga de comandos
// (arrastres, tecleo) acabe en UN solo guardado del estado final, no en N.
const DEBOUNCE_MS_DEFECTO = 800;

interface OpcionesAutosave {
  // Configurable sobre todo para tests (timers cortos / falsos).
  debounceMs?: number;
  // Callback de errores no recuperables del guardado (T1): rechazo de Dexie
  // (cuota, DB cerrada) o conflicto de concurrencia. El autosave NUNCA relanza:
  // surfacea por aqui para que F9 lo muestre sin romper la edicion en curso.
  onError?: (error: unknown) => void;
}

// Arranca el autosave y devuelve una funcion de BAJA (teardown).
//
// Precondicion: para que un guardado tenga efecto debe haber un proyecto activo
// (getProyectoActivoId). Si no lo hay, el disparo es no-op silencioso. F9
// garantiza que exista un proyecto activo antes de permitir editar la obra; aqui
// no lo forzamos para no acoplar el autosave a la creacion de proyectos.
//
// Decision sobre flush-en-baja: la baja NO hace flush. Es un teardown (desmontaje,
// recarga del modulo en tests): cancela el timer pendiente y desuscribe, dejando
// CERO guardados en vuelo. Un guardado tardio tras la baja reintroduciria estado
// de un store que quiza ya cambio de duenno. Si en el futuro hace falta "guardar
// ya" (p. ej. al cerrar pestana), se anadira un `flush()` explicito y separado.
export function iniciarAutosave(opciones?: OpcionesAutosave): () => void {
  const debounceMs = opciones?.debounceMs ?? DEBOUNCE_MS_DEFECTO;
  const onError = opciones?.onError;

  // Timer a nivel de cierre: el debounce se implementa a mano (sin lodash) con
  // setTimeout global, para que vi.useFakeTimers() lo intercepte en los tests.
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Cancela el timer de debounce local. Se expone a nivel de modulo via
  // cancelarTimerPendiente para que cargarProyectoEnStore pueda abortarlo (T5).
  const cancelarTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  // El guardado efectivo: lee el proyecto activo y persiste el modelo actual.
  // Es async pero el listener no lo espera (fire-and-forget): no debe bloquear.
  // Envuelto en try/catch: cualquier rechazo de Dexie (cuota, DB cerrada) o
  // conflicto se surfacea por onError, NUNCA se relanza (no debe romper la edicion).
  const guardar = async (): Promise<void> => {
    try {
      const id = await getProyectoActivoId();
      if (id === undefined) return; // sin proyecto activo: no-op (ver precondicion)

      const modelo = modeloStore.getState().getModelo();
      // Solo aplicamos la baseline si es de ESTE proyecto (ver nota en `baseline`).
      const base =
        baseline?.id === id ? baseline.actualizadoEn : undefined;
      const r = await guardarModeloDeProyecto(id, modelo, base);

      if (r.estado === "guardado") {
        // Avanza la baseline al timestamp recien escrito (T1).
        baseline = { id, actualizadoEn: r.actualizadoEn };
      } else if (r.estado === "no-existe") {
        // El proyecto activo se borro entre el disparo y el guardado (carrera).
        // No es un error: el autosave simplemente no tiene donde escribir.
        if (import.meta.env.DEV) {
          console.warn(
            `[autosave] proyecto activo ${id} no existe; guardado omitido.`,
          );
        }
      } else {
        // Conflicto (otra pestana escribio despues de la baseline): NO actualizamos
        // la baseline ni machacamos; surfaceamos para que F9 resuelva (T1).
        onError?.({ tipo: "conflicto", id } satisfies ErrorConflictoAutosave);
      }
    } catch (error) {
      // Rechazo de Dexie (QuotaExceededError, DatabaseClosedError, etc.): no
      // relanzamos. El store sigue editable; F9 decide como reaccionar.
      onError?.(error);
    }
  };

  // Suscripcion al modelo (Capa 1): subscribeWithSelector dispara el listener solo
  // cuando cambia la referencia de `s.modelo`. Cada cambio re-arma el debounce.
  const unsubscribe = modeloStore.subscribe(
    (s) => s.modelo,
    () => {
      cancelarTimer();
      timer = setTimeout(() => {
        timer = undefined;
        // Serializa las escrituras (T1): encadena sobre el ultimo guardado en
        // vuelo (ignorando su posible rechazo) para que dos guardados solapados
        // no se entrelacen y escriban fuera de orden; gana el ultimo estado.
        _guardadoEnVuelo = _guardadoEnVuelo.catch(() => {}).then(guardar);
      }, debounceMs);
    },
  );

  // Registra el canceller del timer a nivel de modulo para que la carga de un
  // proyecto pueda abortar un timer de la edicion anterior (T5).
  cancelarTimerPendiente = cancelarTimer;

  // Baja: cancela el debounce pendiente (no quedan guardados que disparen despues)
  // y desuscribe del store. Sin flush (ver decision arriba).
  return () => {
    cancelarTimer();
    // Limpia el canceller de modulo SOLO si sigue siendo el nuestro (no pisar a
    // otro autosave que pudiera haberse iniciado despues).
    if (cancelarTimerPendiente === cancelarTimer) cancelarTimerPendiente = null;
    unsubscribe();
  };
}

// Carga un proyecto guardado en el store, validando en el borde. Defensa en
// profundidad (CLAUDE.md §2.8): aunque el dato venga de IndexedDB (no de un fichero
// importado), lo pasamos por migrarYValidar. Un IndexedDB manipulado o un proyecto
// de version vieja no debe poder romper el store: si no valida, NO lo cargamos.
export async function cargarProyectoEnStore(
  id: string,
): Promise<ResultadoImport> {
  const guardado = await cargarProyecto(id);
  if (guardado === undefined) {
    return {
      ok: false,
      errores: [`No existe el proyecto solicitado (${id}).`],
    };
  }

  // El modelo viaja como blob; lo revalidamos en el borde antes de tocar el store.
  const resultado = migrarYValidar(guardado.modelo);
  if (!resultado.ok) return resultado; // store intacto

  // Coordinacion load-vs-timer (T5): ANTES de cargar el modelo, cancela cualquier
  // timer de debounce pendiente de una edicion anterior (escribiria el modelo
  // recien cargado en el proyecto PREVIO) y fija el puntero activo al nuevo
  // proyecto. Reordenamos: setProyectoActivoId ANTES de cargarModelo, de modo que
  // si un timer dispara justo tras el load, escriba en el proyecto correcto.
  cancelarTimerPendiente?.();
  await setProyectoActivoId(id);

  // Baseline de concurrencia (T1): partimos del timestamp del registro cargado.
  baseline = { id, actualizadoEn: guardado.actualizadoEn };

  // Reemplazo total de la obra (limpia undo + descarta resultados).
  modeloStore.getState().cargarModelo(resultado.modelo);
  return resultado;
}
