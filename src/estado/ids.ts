// Generador de IDs internos de dominio. Usamos crypto.randomUUID() (disponible en
// el navegador y en Node >=19) en lugar de un contador propio: garantiza unicidad
// sin estado global y los ids son opacos (no se muestran en la UI; el nombre
// visible CYPECAD "P1"/"V1" es aparte, derivado del modelo). El id se fija al
// construir el comando y se reutiliza en redo, por eso vive fuera de la receta.
export function nuevoId(): string {
  return crypto.randomUUID();
}
