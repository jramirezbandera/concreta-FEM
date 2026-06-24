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
import { useEffect } from "react";
import { vistaStore } from "../../estado";
import {
  abrirDB,
  cargarProyectoEnStore,
  crearProyecto,
  getProyectoActivoId,
  iniciarAutosave,
  cargarPlantillasEnStore,
  iniciarAutosavePlantillas,
} from "../../persistencia";

// Nombre del proyecto inicial cuando la biblioteca esta vacia. Coincide con el
// rotulo "Obra sin título" del Brandbar; cuando exista UI de proyectos (F2+) se
// podra renombrar.
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
// vacias); el cleanup da de baja ambos autosaves al desmontar.
export function useArranquePersistencia(): void {
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

    const arrancar = async (): Promise<void> => {
      // Puerta defensiva: si la DB no abre (modo privado, sin IndexedDB en test),
      // no persistimos. La app sigue en memoria, igual que antes de F8/F15.
      const apertura = await abrirDB();
      if (cancelado) return;
      if (!apertura.ok) {
        marcarLista();
        return;
      }

      const proyectoId = await asegurarProyectoActivo();
      if (cancelado) return;

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
        marcarLista();
        return;
      }

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
}
