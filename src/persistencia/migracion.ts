// Frontera de importacion (CLAUDE.md §2.8, §8, §12): "todo dato que entra se
// valida". Funcion PURA (sin Dexie, store ni I/O): toma datos crudos de origen
// desconocido (fichero .json importado o blob de IndexedDB), los migra a la
// version de esquema vigente y los valida con `ModeloSchema`. Nunca lanza:
// devuelve un resultado discriminado en lenguaje legible para el usuario.
import { SCHEMA_VERSION } from "../dominio/comunes";
import { ModeloSchema, type Modelo } from "../dominio/modelo";
import { ID_HIP_PESO_PROPIO } from "../dominio/helpers";
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
//
// Para poder superficiar avisos en lenguaje de obra (p. ej. una colision de
// nombre al sembrar una hipotesis automatica), una migracion puede devolver, en
// vez del raw a secas, un ENVOLTORIO `{ datos, avisos }`. La cadena recoge esos
// avisos y los anade al canal `avisos` de `migrarYValidar`. Devolver el raw
// directamente sigue siendo valido (sin avisos): retrocompatible con migraciones
// que no necesitan avisar (y con el registro sintetico de los tests).
export type ResultadoMigracion = { datos: unknown; avisos?: string[] };
export type Migracion = (datos: unknown) => unknown | ResultadoMigracion;

// Normaliza la salida de una migracion al envoltorio comun. Distingue el
// envoltorio `{ datos, avisos }` de un Modelo crudo: un Modelo nunca tiene un
// campo `datos`, asi que la presencia de `datos` (con `avisos` array u omitido)
// es la firma inequivoca del envoltorio.
function normalizarSalida(salida: unknown): ResultadoMigracion {
  if (
    typeof salida === "object" &&
    salida !== null &&
    "datos" in salida &&
    (!("avisos" in salida) ||
      Array.isArray((salida as Record<string, unknown>).avisos))
  ) {
    const env = salida as { datos: unknown; avisos?: unknown };
    return {
      datos: env.datos,
      avisos: Array.isArray(env.avisos) ? (env.avisos as string[]) : undefined,
    };
  }
  return { datos: salida };
}

// Tipos de forma para leer un raw v1 sin validarlo todavia (aun no paso Zod).
// Solo describen los campos que la migracion toca; el resto viaja intacto.
type HipotesisCruda = {
  id?: unknown;
  nombre?: unknown;
  tipo?: unknown;
  automatica?: unknown;
};

// Nombre canonico de la hipotesis automatica de peso propio (estilo CYPECAD).
// El modelo vacio (helpers.ts) la siembra con este mismo nombre.
const NOMBRE_PESO_PROPIO = "Peso propio";
// Nombre seguro de respaldo cuando "Peso propio" ya lo ocupa una hipotesis de
// usuario: no se machaca el dato del usuario, se siembra la automatica aparte.
const NOMBRE_PESO_PROPIO_AUTO = "Peso propio (automatico)";

// Elige un nombre libre para la hipotesis automatica sin colisionar con los
// nombres ya tomados por hipotesis de usuario. Prueba "Peso propio", luego
// "Peso propio (automatico)" y, si tambien estan ocupados, sufija con un contador
// hasta encontrar uno libre. Devuelve tambien si hubo colision (para avisar).
function elegirNombrePesoPropio(nombresTomados: Set<string>): {
  nombre: string;
  colision: boolean;
} {
  if (!nombresTomados.has(NOMBRE_PESO_PROPIO)) {
    return { nombre: NOMBRE_PESO_PROPIO, colision: false };
  }
  if (!nombresTomados.has(NOMBRE_PESO_PROPIO_AUTO)) {
    return { nombre: NOMBRE_PESO_PROPIO_AUTO, colision: true };
  }
  let n = 2;
  // Sufija hasta libre: "Peso propio (automatico) (2)", "(3)", ...
  let candidato = `${NOMBRE_PESO_PROPIO_AUTO} (${n})`;
  while (nombresTomados.has(candidato)) {
    n += 1;
    candidato = `${NOMBRE_PESO_PROPIO_AUTO} (${n})`;
  }
  return { nombre: candidato, colision: true };
}

// Migracion de model-schema v1 -> v2 (F2a / E7). OJO terminologia: es la version
// de la FORMA del Modelo persistido (Capa 1), DISTINTA de la version de la base
// Dexie/IndexedDB (ya en 2 por las plantillas de F15). v2 introduce el peso propio
// automatico:
//   - `analisis.incluirPesoPropio = true` (default nuevo; el discretizador emite
//     w=A·rho salvo que el usuario lo desactive).
//   - cada hipotesis existente recibe `automatica: false` (eran todas de usuario).
//   - se siembra la hipotesis automatica `hip-peso-propio` (idempotente por id).
//   - `analisis.tipo` previo (lineal/general) se mantiene (no habia pDelta en v1).
//
// Invariante objetivo en el borde de import: tras migrar+validar existe EXACTAMENTE
// una hipotesis automatica valida (id=hip-peso-propio, automatica:true) y el modelo
// pasa ModeloSchema. La validacion Zod (con sus `.default`) ocurre despues, una sola
// vez, al final de la cadena.
function migrarV1aV2(datos: unknown): ResultadoMigracion {
  // Si el raw no es un objeto, no reestructuramos: dejamos que la validacion Zod
  // final lo rechace con una ruta legible (no es trabajo de la migracion validar).
  if (typeof datos !== "object" || datos === null) {
    return { datos: { ...(datos as object), schemaVersion: 2 } };
  }
  const obj = { ...(datos as Record<string, unknown>) };
  const avisos: string[] = [];

  // --- Hipotesis: defaults + sembrado idempotente de la automatica ---
  const hipotesisOriginal: HipotesisCruda[] = Array.isArray(obj.hipotesis)
    ? (obj.hipotesis as HipotesisCruda[])
    : [];

  // Reclamo silencioso (CV4-2): si ya existe una hipotesis con id=hip-peso-propio
  // pero con datos NO automaticos (automatica ausente/false, o nombre/tipo
  // distintos de la automatica canonica), NO la adoptamos como automatica: son
  // datos de usuario que casualmente reusan el id. Le reasignamos un id nuevo y
  // sembramos la automatica aparte, para no reclamar/mutilar datos de usuario.
  const usurpadora = hipotesisOriginal.find(
    (h) => h.id === ID_HIP_PESO_PROPIO && h.automatica !== true,
  );

  // Nombres ya tomados por hipotesis de usuario (para evitar colision de nombre).
  const nombresTomados = new Set<string>();
  for (const h of hipotesisOriginal) {
    if (typeof h.nombre === "string") nombresTomados.add(h.nombre);
  }

  // Reescribe cada hipotesis existente: automatica:false (eran de usuario) salvo
  // que ya viniera marcada automatica:true con el id correcto (idempotencia).
  const hipotesisMigradas = hipotesisOriginal.map((h) => {
    if (h === usurpadora) {
      // Reasigna id para no chocar con la automatica que vamos a sembrar; el
      // nombre del usuario se respeta (ya esta en nombresTomados).
      avisos.push(
        `La hipótesis con identificador '${ID_HIP_PESO_PROPIO}' no era la de peso propio automático; se conservó con un identificador nuevo para no perder sus datos.`,
      );
      nombresTomados.delete(
        typeof h.nombre === "string" ? h.nombre : "",
      );
      return { ...h, id: `${ID_HIP_PESO_PROPIO}-usuario`, automatica: false };
    }
    // Idempotencia: una automatica ya correcta no se duplica ni se degrada.
    if (h.id === ID_HIP_PESO_PROPIO && h.automatica === true) {
      return { ...h, automatica: true };
    }
    return { ...h, automatica: false };
  });

  // Recalcula nombres tomados tras el renombrado de id (la usurpadora vuelve a
  // contar con su nombre de usuario para que la automatica no choque con el).
  nombresTomados.clear();
  for (const h of hipotesisMigradas) {
    if (typeof h.nombre === "string") nombresTomados.add(h.nombre);
  }

  // Sembrado idempotente por id: si ya hay una automatica valida, no se duplica.
  const yaTieneAutomatica = hipotesisMigradas.some(
    (h) => h.id === ID_HIP_PESO_PROPIO && h.automatica === true,
  );
  if (!yaTieneAutomatica) {
    const { nombre, colision } = elegirNombrePesoPropio(nombresTomados);
    if (colision) {
      avisos.push(
        `Ya existía una hipótesis 'Peso propio'; revise posible duplicación.`,
      );
    }
    hipotesisMigradas.push({
      id: ID_HIP_PESO_PROPIO,
      nombre,
      tipo: "permanente",
      automatica: true,
    });
  }
  obj.hipotesis = hipotesisMigradas;

  // --- Analisis: default incluirPesoPropio + tipo previo preservado ---
  const analisisOriginal =
    typeof obj.analisis === "object" && obj.analisis !== null
      ? (obj.analisis as Record<string, unknown>)
      : {};
  // `tipo` previo se mantiene tal cual (lineal/general). No habia pDelta en v1;
  // si faltara o fuera invalido, la validacion Zod final lo senalara con su ruta.
  obj.analisis = {
    ...analisisOriginal,
    incluirPesoPropio:
      typeof analisisOriginal.incluirPesoPropio === "boolean"
        ? analisisOriginal.incluirPesoPropio
        : true,
  };

  return { datos: { ...obj, schemaVersion: 2 }, avisos };
}

// Tipo de forma para leer un `Pano` crudo v2 sin validarlo todavia. En v1/v2 un
// `Pano` era un STUB reservado: solo `{ id }` (nunca tuvo geometria de obra). v3
// (F3 corte 1) lo expande a la forma de LOSA. Solo describimos los campos que la
// migracion inspecciona para decidir si el paño es completable a v3 o un stub.
type PanoCrudo = {
  id?: unknown;
  tipo?: unknown;
  plantaId?: unknown;
  perimetro?: unknown;
  espesor?: unknown;
  materialId?: unknown;
  tamMalla?: unknown;
  bordeApoyo?: unknown;
};

// Tipo de forma para leer una `Carga` cruda v2 (solo el `tipo` y el `ambito`, para
// localizar las superficiales que apuntan a un paño descartado).
type CargaCruda = {
  tipo?: unknown;
  ambito?: unknown;
};

// ¿Tiene este `Pano` crudo la GEOMETRIA minima de la forma de losa v3? Un stub
// `{id}` (v1/v2) carece de `perimetro`/`espesor`/etc., asi que NO se puede completar
// a losa: nunca tuvo geometria. Comprobamos la presencia de los campos de geometria
// que distinguen una losa real de un stub reservado; la VALIDACION Zod estricta de
// cada campo la hace `PanoSchema` despues (esto solo separa stub de no-stub). Si
// faltan campos de geometria, es un stub y se descarta.
function panoTieneGeometriaV3(pano: PanoCrudo): boolean {
  return (
    Array.isArray(pano.perimetro) &&
    typeof pano.espesor === "number" &&
    typeof pano.plantaId === "string" &&
    typeof pano.materialId === "string" &&
    typeof pano.tamMalla === "number" &&
    typeof pano.bordeApoyo === "string"
  );
}

// Migracion de model-schema v2 -> v3 (F3 corte 1). v3 expande `Pano` de stub `{id}`
// a la forma completa de LOSA. Un `Pano` v1/v2 era un STUB reservado (solo `{id}`):
// NO se puede completar a la forma de losa porque NUNCA tuvo geometria de obra
// (perimetro, espesor, material, malla, apoyo de borde). Por eso la migracion
// DESCARTA todo paño que no cumpla la forma v3 (los stubs) Y sus cargas superficiales
// (las `cargas` con `tipo:"superficial"` y `ambito` = id de un paño descartado), con
// un AVISO en lenguaje de obra. NO rompe el import.
//
// En la practica esto es un NO-OP: un proyecto v2 real tenia `panos: []` (la entrada
// de paños llega en F3; nunca se crearon stubs). Pero la migracion debe ser robusta
// y explicita ante un .json HEREDADO que llevara paños-stub.
//
// Lo demas del modelo (incluida la forma v2 de hipotesis/analisis ya migrada) viaja
// intacto: la validacion Zod final (ModeloSchema v3) ocurre una sola vez al final.
function migrarV2aV3(datos: unknown): ResultadoMigracion {
  // Si el raw no es un objeto, no reestructuramos: la validacion Zod final lo
  // rechazara con una ruta legible (no es trabajo de la migracion validar).
  if (typeof datos !== "object" || datos === null) {
    return { datos: { ...(datos as object), schemaVersion: 3 } };
  }
  const obj = { ...(datos as Record<string, unknown>) };
  const avisos: string[] = [];

  const panosOriginal: PanoCrudo[] = Array.isArray(obj.panos)
    ? (obj.panos as PanoCrudo[])
    : [];

  // Particiona en paños completables a losa (forma v3) vs stubs a descartar.
  const panosConservados: PanoCrudo[] = [];
  const idsDescartados = new Set<string>();
  for (const pano of panosOriginal) {
    if (panoTieneGeometriaV3(pano)) {
      panosConservados.push(pano);
    } else {
      // Solo registramos el id (string) para purgar sus cargas; un stub sin id
      // usable igualmente se descarta (no aporta nada).
      if (typeof pano.id === "string") idsDescartados.add(pano.id);
    }
  }

  obj.panos = panosConservados;

  // Purga las cargas superficiales que apuntaban a un paño descartado: sin paño que
  // las soporte serian referencias colgantes (y el discretizador las bloquearia).
  // Solo se descartan las `superficial` sobre paños descartados; el resto de cargas
  // (puntual/lineal, o superficiales sobre paños conservados) viaja intacto.
  if (idsDescartados.size > 0) {
    const cargasOriginal: CargaCruda[] = Array.isArray(obj.cargas)
      ? (obj.cargas as CargaCruda[])
      : [];
    obj.cargas = cargasOriginal.filter(
      (c) =>
        !(
          c.tipo === "superficial" &&
          typeof c.ambito === "string" &&
          idsDescartados.has(c.ambito)
        ),
    );
    const n = idsDescartados.size;
    avisos.push(
      `Se descartaron ${n} paño${n === 1 ? "" : "s"} sin geometría de una versión anterior y sus cargas superficiales.`,
    );
  }

  return { datos: { ...obj, schemaVersion: 3 }, avisos };
}

// Registro indexado por version de origen: `MIGRACIONES[v]` transforma v -> v+1.
// `MIGRACIONES[1]` lleva v1 -> v2 (F2a, model-schema); `MIGRACIONES[2]` lleva
// v2 -> v3 (F3 corte 1, paño losa). La cadena de `migrarYValidar` los aplica en
// orden ascendente hasta `SCHEMA_VERSION`.
const MIGRACIONES: Record<number, Migracion> = {
  1: migrarV1aV2,
  2: migrarV2aV3,
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
    const salida = normalizarSalida(migracion(datos));
    datos = salida.datos;
    if (salida.avisos) avisos.push(...salida.avisos);
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
