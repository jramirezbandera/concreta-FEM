// Exportar la obra del menú Archivo (auditoría UI/UX, decisión D2). Un EFECTO de UI
// (descarga de fichero) que se apoya en la lógica de persistencia ya existente y
// testeada: NO reimplementa el formato .json. Vive en /src/ui (regla CLAUDE.md §9: los
// efectos solo en /solver, /persistencia y /ui). Aquí quedan los helpers PUROS (nombre
// de fichero, texto del export) y el efecto de descarga. El flujo de IMPORTACIÓN vive
// aparte: la lógica en importarObra.ts y la UI (file input, confirmación, aviso) en el
// componente ArchivoIO.tsx (fichero con casing distinto para no colisionar con este en
// sistemas de ficheros insensibles a mayúsculas).
import { modeloStore } from "../../estado";
import {
  exportarProyecto,
  exportarProyectoComoTexto,
  getProyectoActivoId,
  cargarProyecto,
} from "../../persistencia";

// Rótulo del fichero cuando la obra aún no tiene nombre (o queda vacío tras sanear):
// el mismo "obra" en minúscula, para no producir un nombre de fichero vacío.
const NOMBRE_ARCHIVO_POR_DEFECTO = "obra";

// Sanea un nombre de obra para usarlo como nombre de fichero: quita acentos/ñ
// (ASCII amable en cualquier sistema de ficheros), colapsa lo no alfanumérico a
// guiones y recorta guiones de los extremos. Determinista y puro (testeable sin
// tocar el DOM). Si el resultado queda vacío (nombre solo con símbolos), cae al
// rótulo por defecto para no generar ".json" a secas.
export function sanearNombreArchivo(nombre: string): string {
  const sinAcentos = nombre
    .normalize("NFD")
    // Elimina los diacríticos (tildes) que NFD separó como marcas combinantes.
    .replace(/[̀-ͯ]/g, "")
    // La ñ/Ñ no es una vocal acentuada: se mapea explícitamente a n/N.
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N");
  const saneado = sinAcentos
    .toLowerCase()
    // Todo lo que no sea [a-z0-9] pasa a guion (espacios, símbolos, puntos).
    .replace(/[^a-z0-9]+/g, "-")
    // Sin guiones colgando en los extremos.
    .replace(/^-+|-+$/g, "");
  return saneado.length > 0 ? saneado : NOMBRE_ARCHIVO_POR_DEFECTO;
}

// Fecha en formato YYYY-MM-DD (hora local) para sufijar el nombre de fichero. Se
// inyecta la fecha (default: ahora) para poder testear el nombre de forma estable.
function fechaISO(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Nombre completo del fichero de exportación: "<obra-saneada>-<fecha>.json". Puro y
// testeable (fecha inyectable). El nombre de obra saneado + la fecha localizan el
// fichero sin depender del sistema de archivos.
export function nombreArchivoExport(nombreObra: string, fecha: Date = new Date()): string {
  return `${sanearNombreArchivo(nombreObra)}-${fechaISO(fecha)}.json`;
}

// Dispara la descarga de un Blob con el nombre dado, vía <a download> programático.
// Efecto de UI puro (crea y revoca el object URL). Aislado para poder mockearlo/no
// ejecutarlo en tests (jsdom no descarga de verdad). No lanza si el entorno no
// soporta la descarga (defensivo).
function descargarBlob(blob: Blob, nombreArchivo: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    // No hace falta añadirlo al DOM en navegadores modernos; el click sintético basta.
    a.rel = "noopener";
    a.click();
  } finally {
    // Revoca en el siguiente tick: algunos navegadores necesitan que el URL siga vivo
    // hasta que arranca la descarga tras el click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// EXPORTA la obra ACTUAL como fichero .json descargable (D2). Lee el Modelo (Capa 1)
// del store y el nombre del proyecto activo del repositorio (metadato de persistencia,
// NO Capa 1). Sin diálogo: exportar es inocuo (no muta nada). Async porque el nombre
// del proyecto vive en IndexedDB; si no hay persistencia (sin proyecto activo), usa el
// `nombreFallback` que la UI ya conoce (el rótulo del Brandbar) para no bloquear la
// exportación en memoria.
//
// Reutiliza `exportarProyecto` (serializacion.ts) para el FORMATO del .json: aquí solo
// se resuelve el nombre y se dispara la descarga. Nunca reimplementa el envoltorio.
export async function exportarObraActual(nombreFallback: string): Promise<void> {
  const modelo = modeloStore.getState().getModelo();
  // Nombre del proyecto activo (fuente de verdad del nombre); si no hay persistencia,
  // el rótulo que la UI ya muestra en el Brandbar.
  let nombre = nombreFallback;
  const activoId = await getProyectoActivoId();
  if (activoId !== undefined) {
    const registro = await cargarProyecto(activoId);
    if (registro !== undefined) nombre = registro.nombre;
  }
  const blob = exportarProyecto(nombre, modelo);
  descargarBlob(blob, nombreArchivoExport(nombre));
}

// Variante SÍNCRONA y sin I/O de la serialización, para tests que quieran verificar el
// texto exacto del .json sin pasar por IndexedDB ni la descarga real. Delega en el
// helper puro de serializacion.ts (no duplica el formato).
export function serializarObra(nombre: string, modelo = modeloStore.getState().getModelo()): string {
  return exportarProyectoComoTexto(nombre, modelo);
}
