// Esquema de IndexedDB (Dexie) de Concreta · Estructuras.
// Solo se persiste la Capa 1 (`Modelo`). NUNCA la Capa 2 (nodes/members FEM),
// los resultados, ni la pila de undo: son derivados/recalculables (CLAUDE.md §12, §17).
import Dexie, { type Table } from "dexie";
import type { Modelo } from "../dominio";

// Un proyecto guardado: el `Modelo` (Capa 1) mas metadatos de biblioteca.
// `schemaVersion` viaja con el registro para permitir migracion incremental
// (feature-8); `creadoEn`/`actualizadoEn` en epoch ms para ordenar e indexar.
export type ProyectoGuardado = {
  id: string;
  nombre: string;
  modelo: Modelo;
  schemaVersion: number;
  creadoEn: number;
  actualizadoEn: number;
};

// Almacen keyval para punteros sueltos (p. ej. el proyecto activo). Se modela como
// tabla `meta` con PK `clave` en vez de IndexedDB sin clave: asi reutilizamos el
// mismo mecanismo tipado de Dexie (put/get atomicos) sin una segunda API, y queda
// trivial anadir mas punteros (ultima vista, preferencias) sin cambiar el esquema.
export type MetaEntry = {
  clave: string;
  valor: string;
};

// Clave del puntero al proyecto activo dentro de la tabla `meta`.
export const CLAVE_PROYECTO_ACTIVO = "proyectoActivoId";

export class ConcretaDB extends Dexie {
  // `proyectos`: indexamos SOLO metadatos (id, actualizadoEn). El `modelo` viaja
  // como blob en el registro, no indexado (no se consulta por su contenido).
  proyectos!: Table<ProyectoGuardado, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("concreta-estructuras");
    // PK `id`; `actualizadoEn` como indice secundario para listar por recientes.
    this.version(1).stores({
      proyectos: "id, actualizadoEn",
      meta: "clave",
    });
  }
}

// Singleton de modulo: una unica instancia de la DB para toda la app.
export const db = new ConcretaDB();

// Ciclo de vida de la conexion (T4). Si otra pestana sube el esquema, IndexedDB
// dispara `versionchange` en las conexiones abiertas con la version vieja: cerramos
// la nuestra para no BLOQUEAR el upgrade de la otra pestana (que se quedaria
// colgada esperando). F9 puede luego reabrir o pedir recargar.
db.on("versionchange", () => {
  db.close();
});

// `blocked`: nuestra conexion (vieja) impide un upgrade de otra pestana. Tras el
// handler de versionchange esto deberia ser raro; lo reportamos en DEV por si una
// conexion no cooperante deja el upgrade en espera.
db.on("blocked", () => {
  if (import.meta.env.DEV) {
    console.warn(
      "[persistencia] upgrade de IndexedDB bloqueado por otra conexion abierta.",
    );
  }
});

// Resultado legible de abrir la DB (T4): IndexedDB puede no estar disponible
// (modo privado en algunos navegadores, almacenamiento deshabilitado). F9 usa el
// `motivo` para mostrar "persistencia no disponible" sin romper la app.
export type ResultadoAbrirDB =
  | { ok: true }
  | { ok: false; motivo: string };

// Apertura defensiva del singleton: nunca lanza. Devuelve un resultado discriminado
// en lenguaje legible. Idempotente: si la DB ya esta abierta, `db.open()` resuelve
// sin reabrir.
export async function abrirDB(): Promise<ResultadoAbrirDB> {
  try {
    await db.open();
    return { ok: true };
  } catch (error) {
    const motivo =
      error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      motivo: `No se pudo abrir el almacenamiento local (IndexedDB no disponible o modo privado): ${motivo}`,
    };
  }
}
