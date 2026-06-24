// Repositorio CRUD de proyectos (Capa 1) sobre Dexie. Capa fina: traduce
// intenciones de la app a operaciones atomicas de IndexedDB. Sin validacion Zod
// (eso vive en la frontera de import/export) ni logica de UI. Solo se persiste
// la Capa 1 (CLAUDE.md §12); la Capa 2 y los resultados se recalculan.
import { crearModeloVacio, type Modelo } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";
import { nuevoId } from "../estado/ids";
import {
  CLAVE_PROYECTO_ACTIVO,
  db,
  type ProyectoGuardado,
} from "./esquema";

// Crea un proyecto nuevo con Modelo vacio y lo persiste. `creadoEn` y
// `actualizadoEn` comparten el mismo instante: un proyecto recien creado no
// tiene historia de edicion. Devuelve el registro tal cual quedo en la DB.
//
// Tras el put fija el puntero activo (T5): un proyecto recien creado queda
// activo sin paso manual, de modo que el autosave empieza a guardar en el
// proyecto correcto desde la primera edicion. Ambas escrituras en una
// transaccion para no dejar el puntero apuntando a un proyecto a medio crear.
export async function crearProyecto(
  nombre: string,
): Promise<ProyectoGuardado> {
  const ahora = Date.now();
  const proyecto: ProyectoGuardado = {
    id: nuevoId(),
    nombre,
    modelo: crearModeloVacio(),
    schemaVersion: SCHEMA_VERSION,
    creadoEn: ahora,
    actualizadoEn: ahora,
  };
  await db.transaction("rw", db.proyectos, db.meta, async () => {
    await db.proyectos.put(proyecto);
    await escribirActivo(proyecto.id);
  });
  return proyecto;
}

// Persiste un proyecto refrescando `actualizadoEn`. No muta el argumento: escribe
// una copia con el nuevo timestamp, asi quien llama conserva su objeto intacto.
export async function guardarProyecto(
  proyecto: ProyectoGuardado,
): Promise<void> {
  await db.proyectos.put({ ...proyecto, actualizadoEn: Date.now() });
}

// Resultado discriminado de guardarModeloDeProyecto (T1). El autosave lo necesita
// para distinguir tres desenlaces: guardado correcto (con su nuevo timestamp para
// mantener la baseline), proyecto inexistente (carrera con un borrado) y conflicto
// de concurrencia optimista (otra pestana escribio despues de la baseline conocida).
export type ResultadoGuardarModelo =
  | { estado: "guardado"; actualizadoEn: number }
  | { estado: "no-existe" }
  | { estado: "conflicto"; actualizadoEn: number };

// Atajo del autosave (T4.1): reemplaza solo el `modelo` de un proyecto existente
// y refresca `actualizadoEn`, preservando id/nombre/creadoEn/schemaVersion. Evita
// que el autosave tenga que hacer read-modify-write a mano.
//
// Concurrencia optimista (T1): el get+put corren DENTRO de una transaccion `rw`
// para que la comprobacion sea atomica (sin ventana entre leer y escribir). Si se
// pasa `baseActualizadoEn` y el registro en disco tiene un `actualizadoEn` MAYOR
// que esa baseline, otra pestana escribio despues de lo que conociamos: NO
// machacamos su trabajo, devolvemos `conflicto` (F9 decide recargar o sobrescribir).
// Si el id no existe es no-op (`no-existe`): el autosave puede dispararse para un
// proyecto ya borrado.
export async function guardarModeloDeProyecto(
  id: string,
  modelo: Modelo,
  baseActualizadoEn?: number,
): Promise<ResultadoGuardarModelo> {
  return db.transaction("rw", db.proyectos, async () => {
    const existente = await db.proyectos.get(id);
    if (existente === undefined) return { estado: "no-existe" as const };

    // Conflicto: el registro fue actualizado por otro escritor mas tarde que la
    // baseline conocida. Solo se comprueba si el llamador aporta una baseline.
    if (
      baseActualizadoEn !== undefined &&
      existente.actualizadoEn > baseActualizadoEn
    ) {
      return {
        estado: "conflicto" as const,
        actualizadoEn: existente.actualizadoEn,
      };
    }

    const actualizadoEn = Date.now();
    await db.proyectos.put({ ...existente, modelo, actualizadoEn });
    return { estado: "guardado" as const, actualizadoEn };
  });
}

export async function cargarProyecto(
  id: string,
): Promise<ProyectoGuardado | undefined> {
  return db.proyectos.get(id);
}

// Lista todos los proyectos, mas recientes primero, via el indice `actualizadoEn`
// (no carga ni ordena en memoria: el orden lo da IndexedDB).
export async function listarProyectos(): Promise<ProyectoGuardado[]> {
  return db.proyectos.orderBy("actualizadoEn").reverse().toArray();
}

// Borra un proyecto y TODO lo colgado de el: su fila en `proyectos`, el puntero
// activo si era el activo (no dejar referencia colgante) y su fila de plantillas
// DXF (persistencia-referencia, feature-15) para no dejar huerfanas. Las tres
// escrituras van en UNA transaccion (atomico: o se borra todo o nada). Borramos
// `db.plantillas` aqui directamente en vez de invocar borrarPlantillasDeProyecto
// (que abre su propia transaccion): Dexie no permite anidar transacciones limpio,
// y la tabla ya esta en el alcance de esta. `delete` es no-op si no hay fila.
export async function borrarProyecto(id: string): Promise<void> {
  await db.transaction("rw", db.proyectos, db.meta, db.plantillas, async () => {
    await db.proyectos.delete(id);
    await db.plantillas.delete(id);
    const activo = await leerActivo();
    if (activo === id) await escribirActivo(undefined);
  });
}

// Renombra un proyecto existente y refresca `actualizadoEn`. No-op si no existe.
export async function renombrarProyecto(
  id: string,
  nombre: string,
): Promise<void> {
  const existente = await db.proyectos.get(id);
  if (existente === undefined) return;
  await db.proyectos.put({
    ...existente,
    nombre,
    actualizadoEn: Date.now(),
  });
}

export async function getProyectoActivoId(): Promise<string | undefined> {
  return leerActivo();
}

// `undefined` borra el puntero (ningun proyecto activo) en vez de guardar un
// valor centinela: mantiene la tabla `meta` limpia y getProyectoActivoId vuelve
// a devolver `undefined` de forma natural.
export async function setProyectoActivoId(
  id: string | undefined,
): Promise<void> {
  await escribirActivo(id);
}

// --- helpers internos del puntero activo (tabla meta keyval) ---

async function leerActivo(): Promise<string | undefined> {
  const entrada = await db.meta.get(CLAVE_PROYECTO_ACTIVO);
  return entrada?.valor;
}

async function escribirActivo(id: string | undefined): Promise<void> {
  if (id === undefined) {
    await db.meta.delete(CLAVE_PROYECTO_ACTIVO);
    return;
  }
  await db.meta.put({ clave: CLAVE_PROYECTO_ACTIVO, valor: id });
}
