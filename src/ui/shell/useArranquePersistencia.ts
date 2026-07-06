// Arranque de persistencia (feature-15, T4.1). Ata el ciclo de vida del proyecto
// activo a la app: al montar asegura un proyecto activo, rehidrata el Modelo (Capa 1)
// Y las plantillas DXF (referencia) desde IndexedDB, y arranca AMBOS autosaves; al
// desmontar, da de baja los dos.
//
// Por que aqui y no antes: feature-8 dejo lista la persistencia (autosave + carga de
// proyecto) pero feature-9 nunca la cableo al arranque (App solo inicializaba el
// grupo/planta activos). feature-15 necesita un `proyectoId` real al que colgar la
// persistencia-referencia de plantillas, asi que cerramos aqui ese hueco: un UNICO
// punto de arranque para Modelo + plantillas, con el MISMO proyectoId y momento.
//
// CLAUDE.md §7/§12: el guardado es asincrono y no bloqueante; solo se persiste la
// Capa 1 (el autosave del Modelo) y la referencia de plantillas (store separado,
// fuera de la Capa 1). Defensivo: si IndexedDB no esta disponible (modo privado,
// almacenamiento denegado, entorno de test sin IndexedDB) la app sigue funcionando
// en memoria, sin persistir.
import { useCallback, useEffect, useState } from "react";
import { vistaStore } from "../../estado";
import {
  abrirDB,
  cargarProyecto,
  cargarProyectoEnStore,
  crearProyecto,
  getProyectoActivoId,
  iniciarAutosave,
  cargarPlantillasEnStore,
  iniciarAutosavePlantillas,
} from "../../persistencia";

// Estado del arranque de persistencia que la UI (banner del Shell) necesita conocer:
//   - "ok": persistencia operativa (o aun en curso, sin fallo conocido). Sin aviso.
//   - "sin-indexeddb": el navegador no permite IndexedDB (modo privado, denegado). Es
//     esperado; aviso DISCRETO no alarmista (los cambios no se guardan, pero nada se
//     perdio: es de partida).
//   - "carga-fallida": habia un proyecto guardado y NO se pudo recuperar (corrupto). Es
//     GRAVE: el autosave no arranco para no machacar el registro bueno, asi que esta
//     sesion no se esta guardando. Banner persistente role="alert".
export type EstadoArranquePersistencia = "ok" | "sin-indexeddb" | "carga-fallida";

// [D13] Estado que el arranque de persistencia devuelve a la UI. Ademas del `aviso` del
// banner, expone el NOMBRE real del proyecto activo (metadato de persistencia, NO Capa 1,
// NO undo) para el Brandbar, el `proyectoActivoId` (el diálogo Datos generales lo necesita
// para renombrar) y `refrescarNombre` (relee el nombre del registro tras renombrar).
export interface ArranquePersistencia {
  aviso: EstadoArranquePersistencia;
  /** Nombre del proyecto activo (o el rótulo inicial si aún no hay id). */
  nombreObra: string;
  /** Id del proyecto activo, o null si no hay persistencia (sin IndexedDB / fallo). */
  proyectoActivoId: string | null;
  /** Relee el nombre del registro activo (tras renombrar) y refresca el Brandbar. */
  refrescarNombre: () => void;
}

// Nombre del proyecto inicial cuando la biblioteca esta vacia. Coincide con el
// rotulo "Obra sin título" del Brandbar; el diálogo Datos generales (D13) permite
// renombrar el proyecto activo.
const NOMBRE_OBRA_INICIAL = "Obra sin título";

// Asegura un proyecto activo: devuelve el id del activo o, si no hay ninguno, crea
// uno nuevo (que crearProyecto deja activo). Aisla la decision en una funcion para
// que el efecto quede legible.
async function asegurarProyectoActivo(): Promise<string> {
  const activo = await getProyectoActivoId();
  if (activo !== undefined) return activo;
  const proyecto = await crearProyecto(NOMBRE_OBRA_INICIAL);
  return proyecto.id;
}

// Hook de arranque: rehidrata y arranca el autosave del Modelo y de las plantillas,
// atados al proyecto activo. Se ejecuta UNA vez al montar (idempotente por deps
// vacias); el cleanup da de baja ambos autosaves al desmontar. Devuelve el estado de
// la persistencia para que el Shell muestre (o no) el aviso correspondiente.
export function useArranquePersistencia(): ArranquePersistencia {
  const [estado, setEstado] = useState<EstadoArranquePersistencia>("ok");
  // [D13a] Nombre e id del proyecto activo. El nombre alimenta el Brandbar; el id lo usa
  // el diálogo Datos generales para renombrar. Ambos son metadato de persistencia (NO
  // Capa 1, NO undo): viven aquí, no en el Modelo.
  const [nombreObra, setNombreObra] = useState<string>(NOMBRE_OBRA_INICIAL);
  const [proyectoActivoId, setProyectoActivoId] = useState<string | null>(null);

  // [D13a] Relee el nombre del registro activo (tras renombrar) y refresca el Brandbar.
  // Defensivo: sin id (sin persistencia) es no-op; si el proyecto ya no existe, conserva
  // el nombre actual. Lee del repositorio (fuente de verdad del nombre), no del store.
  const refrescarNombre = useCallback(() => {
    if (proyectoActivoId === null) return;
    void cargarProyecto(proyectoActivoId).then((registro) => {
      if (registro !== undefined) setNombreObra(registro.nombre);
    });
  }, [proyectoActivoId]);

  useEffect(() => {
    // Bajas de los autosaves, registradas en cuanto arrancan. El cleanup las
    // invoca aunque el efecto se desmonte antes de terminar la fase async.
    let bajaModelo: (() => void) | null = null;
    let bajaPlantillas: (() => void) | null = null;
    // Guarda anti-tardanza: si el componente se desmonta durante la fase async,
    // no arrancamos autosaves que nadie va a dar de baja por la via normal.
    let cancelado = false;

    // Habilita la importacion de DXF (gate #8): la hidratacion ha terminado (o no
    // habra persistencia). Se llama en TODOS los caminos de salida normales. No toca
    // el store si el efecto ya se desmonto (guarda `cancelado`).
    const marcarLista = (): void => {
      if (!cancelado) vistaStore.getState().setPersistenciaLista(true);
    };

    // Fija el estado de la persistencia (para el banner del Shell) salvo que el efecto
    // ya se haya desmontado (no hacer setState tras desmontar).
    const fijarEstado = (e: EstadoArranquePersistencia): void => {
      if (!cancelado) setEstado(e);
    };

    const arrancar = async (): Promise<void> => {
      // Puerta defensiva: si la DB no abre (modo privado, sin IndexedDB en test),
      // no persistimos. La app sigue en memoria, igual que antes de F8/F15.
      const apertura = await abrirDB();
      if (cancelado) return;
      if (!apertura.ok) {
        // IndexedDB no disponible: la app sigue en memoria. Aviso discreto (esperado).
        fijarEstado("sin-indexeddb");
        marcarLista();
        return;
      }

      const proyectoId = await asegurarProyectoActivo();
      if (cancelado) return;
      // [D13a] Fija el id activo para el diálogo Datos generales y lee el nombre real del
      // registro (el Brandbar deja de mostrar el rótulo fijo). Si el registro no carga,
      // se queda con el nombre inicial.
      if (!cancelado) setProyectoActivoId(proyectoId);
      const registro = await cargarProyecto(proyectoId);
      if (cancelado) return;
      if (registro !== undefined) setNombreObra(registro.nombre);

      // Carga PRIMERO (rehidrata stores), luego arranca autosave: asi el primer
      // guardado no dispara por la propia carga inicial. cargarProyectoEnStore fija
      // el puntero activo y valida el Modelo en el borde.
      //
      // #9 Honrar el resultado: si el proyecto activo esta corrupto o no carga, NO
      // arrancamos autosaves. Arrancar el autosave del Modelo sobre un proyecto que
      // no pudimos cargar machacaria el registro bueno con el modelo VACIO en memoria
      // (perdida de datos). La app queda usable en memoria; la importacion se habilita.
      const resultado = await cargarProyectoEnStore(proyectoId);
      if (cancelado) return;
      if (!resultado.ok) {
        if (import.meta.env.DEV) {
          console.error(
            "[arranque] carga de proyecto fallida; autosave NO arrancado:",
            resultado.errores,
          );
        }
        // Proyecto guardado no recuperable: el autosave NO arranca (para no machacar el
        // registro bueno). GRAVE: esta sesion no se esta guardando -> banner de alerta.
        fijarEstado("carga-fallida");
        marcarLista();
        return;
      }

      // [D14 · PR3] Al cargar (cambiar de) obra, resetea el estado de UI del dock (colapso
      // entero + por sección): la obra nueva empieza con el dock abierto y sus secciones
      // abiertas (patrón resolverVistaActiva/snapActivo, estado de vista transitorio).
      vistaStore.getState().resetDockUI();
      // [UX-3.1 · guardián M-1] Mismo criterio para las capas de visibilidad: la obra
      // nueva arranca con TODO visible (una capa oculta heredada de otro proyecto seria
      // un "¿donde estan mis vigas?" sin indicio).
      vistaStore.getState().resetCapas();

      // cargarPlantillasEnStore valida las plantillas (Zod) al leer de IndexedDB.
      await cargarPlantillasEnStore(proyectoId);
      if (cancelado) return;

      // Autosaves INDEPENDIENTES (Modelo / plantillas), atados al mismo proyecto.
      bajaModelo = iniciarAutosave();
      bajaPlantillas = iniciarAutosavePlantillas(proyectoId);
      marcarLista();
    };

    void arrancar();

    return () => {
      cancelado = true;
      bajaModelo?.();
      bajaPlantillas?.();
    };
    // Arranque unico al montar: un solo proyecto activo en F1 (sin UI de cambio de
    // proyecto todavia). Cuando exista (F2+), re-arrancar carga+autosave de Modelo
    // y plantillas con el nuevo proyectoId sera responsabilidad de esa UI.
  }, []);
  return { aviso: estado, nombreObra, proyectoActivoId, refrescarNombre };
}
