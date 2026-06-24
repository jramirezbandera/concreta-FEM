// Persistencia (feature-8): Dexie/IndexedDB + export/import .json validado con Zod.
// SOLO se persiste la Capa 1 (Modelo). La Capa 2 (JSON FEM) y los resultados son
// derivados y se regeneran/recalculan: nunca tocan IndexedDB (CLAUDE.md §12, §17).
//
// Este barrel es la unica superficie publica del modulo: el resto de la app (F9)
// habla con estas funciones y NO conoce Dexie. Los internos (instancia `db`,
// clase `ConcretaDB`, clave del puntero, helpers de test) quedan encapsulados.

// Frontera de importacion: valida con Zod + migra por schemaVersion. Nunca lanza.
export { migrarYValidar } from "./migracion";
export type { ResultadoImport } from "./migracion";

// Tipo del registro persistido (envuelve el Modelo con metadatos) y apertura
// defensiva de la DB (F9 muestra "persistencia no disponible" si falla).
export type { ProyectoGuardado, ResultadoAbrirDB } from "./esquema";
export { abrirDB } from "./esquema";

// Repositorio: biblioteca multi-proyecto sobre IndexedDB + puntero al activo.
export {
  crearProyecto,
  guardarProyecto,
  guardarModeloDeProyecto,
  cargarProyecto,
  listarProyectos,
  borrarProyecto,
  renombrarProyecto,
  getProyectoActivoId,
  setProyectoActivoId,
} from "./repositorio";
// Resultado discriminado de guardarModeloDeProyecto (guardado/no-existe/conflicto).
export type { ResultadoGuardarModelo } from "./repositorio";

// Export/import del proyecto como fichero .json propio de Concreta.
export { exportarProyecto, exportarProyectoComoTexto, importarProyecto } from "./serializacion";
// Resultado de importar desde fichero (incluye el nombre del envoltorio).
export type { ResultadoImportArchivo } from "./serializacion";

// Autosave: F9 invoca iniciarAutosave() al arrancar (suscribe el modeloStore con
// debounce) y cargarProyectoEnStore(id) al abrir un proyecto (valida en el borde).
export { iniciarAutosave, cargarProyectoEnStore } from "./autosave";
// Error de conflicto de concurrencia optimista que el autosave surfacea por onError.
export type { ErrorConflictoAutosave } from "./autosave";

// Persistencia-REFERENCIA de plantillas DXF (feature-15): store Dexie separado,
// keyed por proyectoId, FUERA de la Capa 1 (no toca Modelo ni ProyectoGuardado).
// Las plantillas son ayuda de dibujo (calco), no geometria de calculo (CLAUDE.md §3).
// Al abrir proyecto: cargarPlantillasEnStore(id) + iniciarAutosavePlantillas(id),
// INDEPENDIENTES del autosave del Modelo. NO entran en el .json export/import del
// proyecto (no son Capa 1; ver decision en plantillas/repositorioPlantillas.ts).
export {
  guardarPlantillasDeProyecto,
  cargarPlantillasDeProyecto,
  borrarPlantillasDeProyecto,
  iniciarAutosavePlantillas,
  cargarPlantillasEnStore,
} from "./plantillas";
