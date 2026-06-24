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

// Registro de plantillas DXF de un proyecto (feature-15). Persistencia-REFERENCIA:
// las plantillas son ayuda de dibujo (calco), NO Capa 1, NO geometria de calculo.
// Por eso viven en su PROPIA tabla, keyed por `proyectoId`, fuera de
// `ProyectoGuardado` y SIN tocar `Modelo`/`SCHEMA_VERSION` (CLAUDE.md §3, §12).
//
// Diseno: UNA fila por proyecto con TODAS sus plantillas como bloque. Mas simple
// que fila-por-plantilla: el put es atomico (la coleccion entera se reemplaza de
// golpe, igual que el autosave del Modelo), no hay que sincronizar altas/bajas
// individuales, y el llamador (vistaStore) ya maneja `plantillas` como array unico.
// El tipo del array es `unknown[]`: lo que entra a Dexie no se valida (no es un
// borde de confianza); la VALIDACION Zod ocurre AL LEER (cargarPlantillasDeProyecto),
// que es donde un IndexedDB manipulado podria intentar romper la app.
export type RegistroPlantillas = {
  proyectoId: string;
  plantillas: unknown[];
  actualizadoEn: number;
};

// Clave del puntero al proyecto activo dentro de la tabla `meta`.
export const CLAVE_PROYECTO_ACTIVO = "proyectoActivoId";

export class ConcretaDB extends Dexie {
  // `proyectos`: indexamos SOLO metadatos (id, actualizadoEn). El `modelo` viaja
  // como blob en el registro, no indexado (no se consulta por su contenido).
  proyectos!: Table<ProyectoGuardado, string>;
  meta!: Table<MetaEntry, string>;
  // `plantillas`: persistencia-referencia (feature-15), fila por proyecto. PK
  // `proyectoId`. Las `Plantilla[]` viajan como blob no indexado (no se consultan
  // por contenido), como el `modelo` de `proyectos`.
  plantillas!: Table<RegistroPlantillas, string>;

  constructor() {
    super("concreta-estructuras");
    // PK `id`; `actualizadoEn` como indice secundario para listar por recientes.
    this.version(1).stores({
      proyectos: "id, actualizadoEn",
      meta: "clave",
    });
    // v2 (feature-15): anade la tabla `plantillas` SIN tocar las existentes. Dexie
    // aplica el upgrade de forma incremental y NO destructiva: crea el nuevo object
    // store y conserva intactos `proyectos`/`meta` (no hace falta funcion de
    // migracion al solo ANADIR una tabla). Las tablas no mencionadas en una version
    // se heredan; aqui las re-declaramos por claridad del esquema vigente.
    this.version(2).stores({
      proyectos: "id, actualizadoEn",
      meta: "clave",
      plantillas: "proyectoId",
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
