// Aplicación de una importación de obra confirmada (D2). Separa la LÓGICA de import
// (parsear+validar por la frontera Zod existente, materializar el proyecto en Dexie,
// hidratar el store) de la UI (file input, confirmación, aviso), para poder testearla
// en jsdom sin Radix ni file pickers. Vive en /src/ui (efecto de persistencia+store).
//
// FRONTERA ÚNICA: la validación la hace `importarProyecto` (serializacion.ts), que a su
// vez delega en `migrarYValidar` (Zod, `safeParse`, `.issues`). NO se duplica aquí:
// importar SIEMPRE valida (regla del proyecto). Un .json corrupto/ajeno/de versión
// futura devuelve `{ ok: false, errores }` en lenguaje de obra y esta función NO toca
// ni el store ni Dexie (la obra actual sobrevive intacta).
import {
  importarProyecto,
  crearProyectoConModelo,
  cargarProyectoEnStore,
  type ResultadoImportArchivo,
} from "../../persistencia";

// Nombre por defecto de la obra importada si el envoltorio no traía nombre útil.
const NOMBRE_IMPORTADO_POR_DEFECTO = "Obra importada";

// Resultado de VALIDAR (aún sin aplicar) el texto de un fichero. Espejo de
// ResultadoImportArchivo, pero es el paso que la UI usa para decidir si mostrar la
// confirmación (ok) o el aviso de error (no ok). No toca store ni Dexie.
export type ResultadoValidacionImport = ResultadoImportArchivo;

// Valida el texto de un fichero SIN aplicarlo (paso previo a la confirmación). Delega
// en la frontera Zod existente. Puro respecto al store y a Dexie.
export function validarTextoImport(texto: string): ResultadoValidacionImport {
  return importarProyecto(texto);
}

// Resultado de APLICAR una importación ya validada y confirmada por el usuario.
export type ResultadoAplicarImport = {
  /** Id del proyecto nuevo creado en la biblioteca (queda activo). */
  proyectoId: string;
  /** Nombre con el que quedó el proyecto importado (para refrescar el Brandbar). */
  nombre: string;
};

// APLICA una importación ya validada: materializa la obra importada como un PROYECTO
// NUEVO de la biblioteca (D2 · decisión "nuevo proyecto, no sobrescribir"): así la obra
// actual se conserva como su propio registro y el usuario no la pierde. crearProyectoConModelo
// fija el puntero activo al nuevo proyecto; cargarProyectoEnStore revalida en el borde,
// cancela timers de autosave pendientes, reancla la baseline optimista al nuevo registro y
// vuelca el modelo al store vía cargarModelo.
//
// cargarModelo (modeloStore) RESETEA el undo/redo y DESCARTA resultados/modal/CR: una
// importación NO es un comando reversible (reemplaza la obra entera; permitir "deshacer"
// hasta la obra anterior sería confuso y mezclaría dos proyectos). Esa invalidación es el
// flujo normal del store; aquí no hay que forzar nada extra.
//
// Recibe el resultado YA validado (no vuelve a validar): la UI valida primero para poder
// mostrar el aviso/confirmación antes de tocar nada. Si `validado` no es ok, es un error de
// programación del llamador; se rechaza.
export async function aplicarImport(
  validado: ResultadoValidacionImport,
): Promise<ResultadoAplicarImport> {
  if (!validado.ok) {
    throw new Error("aplicarImport requiere un resultado de importación válido");
  }
  const nombre =
    validado.nombre.trim().length > 0
      ? validado.nombre.trim()
      : NOMBRE_IMPORTADO_POR_DEFECTO;
  const proyecto = await crearProyectoConModelo(nombre, validado.modelo);
  // Hidrata el store desde el registro recién creado: revalida, fija baseline, resetea
  // undo y descarta resultados (todo dentro de cargarProyectoEnStore).
  await cargarProyectoEnStore(proyecto.id);
  return { proyectoId: proyecto.id, nombre };
}
