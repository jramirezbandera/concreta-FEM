// Frontera de importacion (CLAUDE.md §2.8, §8, §12): "todo dato que entra se
// valida". Funcion PURA (sin Dexie, store ni I/O): toma datos crudos de origen
// desconocido (fichero .json importado o blob de IndexedDB), los migra a la
// version de esquema vigente y los valida con `ModeloSchema`. Nunca lanza:
// devuelve un resultado discriminado en lenguaje legible para el usuario.
import { SCHEMA_VERSION } from "../dominio/comunes";
import { ModeloSchema, type Modelo } from "../dominio/modelo";
import type { ZodIssue } from "zod";

// Resultado espejo de `ResultadoDiscretizacion` (feature-4): mismo patron
// ok/avisos/errores. Aqui los canales son `string[]` (no `ErrorObra[]`): en
// import los fallos son de formato/version, no de elementos de obra concretos,
// asi que basta texto legible en espanol. La forma discriminada se mantiene
// para que la UI (F9) trate import y discretizacion de forma uniforme.
export type ResultadoImport =
  | { ok: true; modelo: Modelo; avisos: string[] }
  | { ok: false; errores: string[] };

// Una migracion lleva un proyecto de la version `v` a `v+1`. Recibe y devuelve
// datos crudos (`unknown`): aun no estan validados, solo reestructurados. La
// validacion final con Zod ocurre una sola vez, tras toda la cadena.
export type Migracion = (datos: unknown) => unknown;

// Registro indexado por version de origen: `MIGRACIONES[v]` transforma v -> v+1.
// En v1 esta VACIO (no hay version anterior que migrar). Listo para crecer.
//
// Para anadir una migracion v1 -> v2 en el futuro:
//   1. Subir SCHEMA_VERSION a 2 en src/dominio/comunes.ts (y el esquema nuevo).
//   2. Registrar aqui:  1: (datos) => { ...transforma forma v1 en forma v2...;
//                                        return { ...datos, schemaVersion: 2 }; }
//   3. La cadena de abajo aplicara 1->2 automaticamente a proyectos antiguos.
const MIGRACIONES: Record<number, Migracion> = {
  // v1: sin migraciones (es la version inicial).
};

// Lee `schemaVersion` de forma defensiva: `raw` es `unknown` y puede no ser un
// objeto, ser null, o carecer del campo. Devuelve `undefined` si no hay un
// numero usable (lo trata el llamador como dato corrupto).
function leerSchemaVersion(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const v = (raw as Record<string, unknown>).schemaVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// Formatea un issue de Zod a lenguaje legible: ruta del campo + mensaje. Usa
// `.issues` (NO `.errors`): `.errors` es un alias confuso; el contrato estable
// de ZodError es `.issues`.
function formatearIssue(issue: ZodIssue): string {
  const ruta = issue.path.length > 0 ? issue.path.join(".") : "(raiz)";
  return `${ruta}: ${issue.message}`;
}

// Frontera unica de validacion de proyectos importados/cargados.
//
// `migraciones` es inyectable (default: el registro real `MIGRACIONES`) para poder
// testear la cadena en aislamiento sin tocar el comportamiento de produccion (T3).
// El objetivo de la cadena es siempre `SCHEMA_VERSION` (la version vigente del
// esquema): no se parametriza porque la validacion final usa el `ModeloSchema` de
// esa misma version, y desacoplarlos permitiria validar contra un esquema que no
// corresponde. Para ejercitar la cadena en tests con SCHEMA_VERSION=1 se inyecta
// un raw con `schemaVersion` MENOR (p. ej. 0) y un registro que lo eleve a 1.
export function migrarYValidar(
  raw: unknown,
  migraciones: Record<number, Migracion> = MIGRACIONES,
): ResultadoImport {
  const version = leerSchemaVersion(raw);

  if (version === undefined) {
    return {
      ok: false,
      errores: [
        "El archivo no es un proyecto de Concreta valido: falta la version de esquema o el formato esta corrupto.",
      ],
    };
  }

  // No se migra hacia abajo: un proyecto de una version mas reciente puede usar
  // campos que esta version desconoce. Mejor avisar que mutilar datos.
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errores: [
        `Este proyecto fue creado con una version mas reciente de Concreta (esquema v${version}; esta version admite hasta v${SCHEMA_VERSION}). Actualiza la aplicacion para abrirlo.`,
      ],
    };
  }

  // Cadena de migraciones ascendente: v -> v+1 -> ... -> SCHEMA_VERSION.
  const avisos: string[] = [];
  let datos: unknown = raw;
  let versionActual = version;
  while (versionActual < SCHEMA_VERSION) {
    const migracion = migraciones[versionActual];
    if (!migracion) {
      // Hueco en la cadena: no podemos llegar a la version vigente.
      return {
        ok: false,
        errores: [
          `No es posible migrar este proyecto desde la version v${versionActual} a la v${SCHEMA_VERSION}.`,
        ],
      };
    }
    datos = migracion(datos);
    versionActual += 1;
  }
  if (versionActual !== version) {
    avisos.push(
      `El proyecto se actualizo del esquema v${version} al v${SCHEMA_VERSION}.`,
    );
  }

  // Validacion final con Zod en el borde: `safeParse` (NO `parse`), nunca lanza.
  const parsed = ModeloSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      errores: parsed.error.issues.map(formatearIssue),
    };
  }

  return { ok: true, modelo: parsed.data, avisos };
}
