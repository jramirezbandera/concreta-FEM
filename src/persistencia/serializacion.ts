// Serializacion export/import del proyecto Concreta (CLAUDE.md §12). Funciones
// PURAS de (de)serializacion: producen/consumen texto JSON. NO tocan Dexie ni el
// store; el guardado en disco (descarga del Blob) y la lectura de fichero los hace
// la UI/persistencia. Aqui solo vive el FORMATO del fichero .json propio.
//
// CONTRATO export <-> import (como viaja schemaVersion):
//   El fichero exportado es un ENVOLTORIO con metadatos + el Modelo (Capa 1):
//     { "formato": "concreta-proyecto", "schemaVersion": N, "nombre": "...",
//       "modelo": <Modelo> }
//   Pero la frontera de validacion (`migrarYValidar`) lee `schemaVersion` del
//   OBJETO QUE RECIBE y `ModeloSchema` exige `schemaVersion` DENTRO del Modelo.
//   Por eso el dato que dispara la migracion es `modelo.schemaVersion`, NO el del
//   envoltorio. `importarProyecto` extrae `parsed.modelo` y se lo pasa tal cual a
//   `migrarYValidar`: ese `modelo` lleva su propio `schemaVersion` visible.
//   El `schemaVersion` del envoltorio es metadato informativo (lo fijamos igual a
//   `modelo.schemaVersion` para coherencia), pero NO es la fuente de verdad de la
//   migracion. Asi export e import forman un par cerrado: lo que se exporta se
//   reimporta pasando por la misma frontera Zod.
import type { Modelo } from "../dominio/modelo";
import { migrarYValidar } from "./migracion";

// Marca del formato propio: permite distinguir un .json de Concreta de cualquier
// otro JSON y rechazar ficheros ajenos antes de mirar el modelo.
const FORMATO = "concreta-proyecto" as const;

// Resultado de importar desde FICHERO (T2): extiende el de `migrarYValidar` con el
// `nombre` del envoltorio, que la carga desde DB no necesita (el registro ya lo
// lleva). Tipo propio de la serializacion: NO se reutiliza `ResultadoImport` de
// migracion.ts para no obligar a la carga-desde-DB a transportar un nombre.
export type ResultadoImportArchivo =
  | { ok: true; modelo: Modelo; nombre: string; avisos: string[] }
  | { ok: false; errores: string[] };

// Forma del envoltorio en disco. El `schemaVersion` aqui es metadato; la version
// que migra es `modelo.schemaVersion` (ver contrato arriba).
type EnvoltorioProyecto = {
  formato: typeof FORMATO;
  schemaVersion: number;
  nombre: string;
  modelo: Modelo;
};

// Serializa a TEXTO JSON indentado (helper testeable sin Blob: en node/fake-env
// `Blob.text()` es async y a veces engorroso). `exportarProyecto` se apoya en este.
export function exportarProyectoComoTexto(nombre: string, modelo: Modelo): string {
  const envoltorio: EnvoltorioProyecto = {
    formato: FORMATO,
    // Metadato; coherente con el del modelo, que es el que realmente migra.
    schemaVersion: modelo.schemaVersion,
    nombre,
    modelo,
  };
  return JSON.stringify(envoltorio, null, 2);
}

// Produce el fichero .json propio de Concreta como Blob descargable.
export function exportarProyecto(nombre: string, modelo: Modelo): Blob {
  return new Blob([exportarProyectoComoTexto(nombre, modelo)], {
    type: "application/json",
  });
}

// Vista defensiva del envoltorio parseado. `raw` es `unknown`: puede no ser objeto
// o ser null. Devuelve `undefined` si no es un objeto utilizable. NO validamos aqui
// la forma del Modelo: de eso se encarga `migrarYValidar` (Zod).
function comoObjeto(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  return raw as Record<string, unknown>;
}

// Importa desde el TEXTO de un fichero .json de Concreta. Nunca lanza: todo error
// (JSON corrupto, formato ajeno, envoltorio sin modelo, version futura, forma
// invalida) se devuelve como `{ ok: false, errores }` en lenguaje legible. Delega
// la validacion del modelo en `migrarYValidar` (frontera Zod unica) y, ademas,
// devuelve el `nombre` del envoltorio para que F9 lo proponga al guardar (T2).
export function importarProyecto(texto: string): ResultadoImportArchivo {
  // `JSON.parse` defensivo: un fichero truncado o no-JSON lanza SyntaxError.
  let raw: unknown;
  try {
    raw = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      errores: [
        "El archivo no es un JSON valido: puede estar danado o no ser un proyecto de Concreta.",
      ],
    };
  }

  const envoltorio = comoObjeto(raw);
  if (envoltorio === undefined) {
    return {
      ok: false,
      errores: [
        "El archivo no es un proyecto de Concreta valido: no contiene un modelo.",
      ],
    };
  }

  // Rechaza ficheros ajenos por la marca de formato ANTES de mirar el modelo (T2):
  // un JSON de otra app podria tener un `modelo` que casualmente valide.
  if (envoltorio.formato !== FORMATO) {
    return {
      ok: false,
      errores: [
        "El archivo no es un proyecto de Concreta: falta o no coincide la marca de formato.",
      ],
    };
  }

  // El envoltorio puede no tener el campo `modelo` (otro JSON con `formato` falso).
  const modelo = envoltorio.modelo;
  if (modelo === undefined) {
    return {
      ok: false,
      errores: [
        "El archivo no es un proyecto de Concreta valido: no contiene un modelo.",
      ],
    };
  }

  // El `modelo` lleva su propio `schemaVersion`: la frontera lo lee y valida.
  const resultado = migrarYValidar(modelo);
  if (!resultado.ok) return resultado;

  // Nombre del envoltorio si es una cadena util; si no, cadena vacia (F9 pedira uno).
  const nombre =
    typeof envoltorio.nombre === "string" ? envoltorio.nombre : "";
  return {
    ok: true,
    modelo: resultado.modelo,
    nombre,
    avisos: resultado.avisos,
  };
}
