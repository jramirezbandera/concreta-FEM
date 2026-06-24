// Repositorio de plantillas DXF (feature-15, T2.3). Persistencia-REFERENCIA, fuera
// de la Capa 1: las plantillas son ayuda de dibujo (calco), no geometria de calculo
// (CLAUDE.md §3, §12). Viven en su propia tabla Dexie keyed por `proyectoId`, sin
// tocar `ProyectoGuardado` ni `Modelo`/`SCHEMA_VERSION`.
//
// Capa fina sobre `db`: una fila por proyecto con TODAS sus plantillas como bloque
// (put atomico). La VALIDACION Zod ocurre AL LEER (frontera de confianza): un
// IndexedDB manipulado o una plantilla de una version vieja no debe romper la app.
import { db } from "../esquema";
import {
  PlantillaSchema,
  type Plantilla,
} from "../../ui/viewport/dxf/tiposDxf";

// Reemplaza el bloque de plantillas de un proyecto y refresca `actualizadoEn`. Put
// atomico: la coleccion entera se sustituye de golpe (igual que el autosave del
// Modelo reemplaza el modelo completo). Si el proyecto no tenia plantillas, crea la
// fila; si las tenia, la machaca. Una lista vacia es valida (deja la fila con []).
//
// No valida la entrada: el llamador (vistaStore) ya produce `Plantilla[]` tipadas;
// la frontera de validacion es la LECTURA, no la escritura.
export async function guardarPlantillasDeProyecto(
  proyectoId: string,
  plantillas: Plantilla[],
): Promise<void> {
  await db.plantillas.put({
    proyectoId,
    plantillas,
    actualizadoEn: Date.now(),
  });
}

// Lee las plantillas de un proyecto, validando cada una en el borde con
// `PlantillaSchema` (safeParse, NO parse: nunca lanza). Las plantillas que NO
// validan se DESCARTAN con un aviso en DEV: "cargar nunca rompe la app". Devuelve
// `[]` si el proyecto no tiene fila (nunca importo plantillas) o si todas son
// invalidas. El orden de las validas se conserva.
export async function cargarPlantillasDeProyecto(
  proyectoId: string,
): Promise<Plantilla[]> {
  const registro = await db.plantillas.get(proyectoId);
  if (registro === undefined) return [];

  // `registro.plantillas` es `unknown[]`: dato de origen no confiable (pudo
  // manipularse el IndexedDB o venir de una version anterior del esquema DXF).
  const crudas = Array.isArray(registro.plantillas) ? registro.plantillas : [];

  const validas: Plantilla[] = [];
  for (const cruda of crudas) {
    const parsed = PlantillaSchema.safeParse(cruda);
    if (parsed.success) {
      validas.push(parsed.data);
    } else if (import.meta.env.DEV) {
      // Una plantilla corrupta no aborta la carga del resto: se descarta y se avisa.
      console.warn(
        `[plantillas] descartada una plantilla invalida del proyecto ${proyectoId}: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
          .join("; ")}`,
      );
    }
  }
  return validas;
}

// Borra la fila de plantillas de un proyecto (p. ej. al borrar el proyecto). No-op
// si no existe. Se expone para que el borrado de proyecto pueda limpiar tambien su
// referencia y no dejar filas huerfanas en la tabla `plantillas`.
export async function borrarPlantillasDeProyecto(
  proyectoId: string,
): Promise<void> {
  await db.plantillas.delete(proyectoId);
}
