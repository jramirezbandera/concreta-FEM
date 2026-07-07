// Frontera de importacion (CLAUDE.md §2.8, §8, §12): "todo dato que entra se
// valida". Funcion PURA (sin Dexie, store ni I/O): toma datos crudos de origen
// desconocido (fichero .json importado o blob de IndexedDB), los migra a la
// version de esquema vigente y los valida con `ModeloSchema`. Nunca lanza:
// devuelve un resultado discriminado en lenguaje legible para el usuario.
import { SCHEMA_VERSION } from "../dominio/comunes";
import { ModeloSchema, type Modelo } from "../dominio/modelo";
import { ID_HIP_PESO_PROPIO } from "../dominio/helpers";
// Ids RESERVADOS de los cases sinteticos de cargas de planta (F3.4; antes de
// grupo, F3.2 [OV-4]). Import directo al modulo HOJA (puro, solo depende de
// ../dominio): no arrastra el resto del discretizador a la frontera de persistencia.
import { CASE_CM_PLANTA, CASE_USO_PLANTA } from "../discretizador/cargasPlanta";
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

// Tipos de forma para leer un raw v3 sin validarlo todavia (la migracion v3->v4
// solo toca grupos/plantas; el resto viaja intacto).
type GrupoCrudo = {
  id?: unknown;
  categoriaUso?: unknown;
  sobrecargaUso?: unknown;
  cargasMuertas?: unknown;
};
type PlantaCruda = Record<string, unknown> & { grupoId?: unknown };

// Migracion de model-schema v3 -> v4 (F3.4, "plantas sin grupos"). v4 ELIMINA el
// concepto de Grupo: `Modelo.grupos` desaparece y cada `Planta` absorbe
// categoriaUso/sobrecargaUso/cargasMuertas de su antiguo grupo (y pierde `grupoId`).
//
// REGLAS:
//  - Planta cuyo grupoId resuelve: HEREDA los tres valores del grupo tal cual
//    (aunque fueran invalidos: la validacion Zod final los señalara con la ruta de
//    la planta, igual que antes lo hacia con la del grupo). Preserva resultados: el
//    calculo con los valores heredados es identico al de v3.
//  - Planta con grupoId roto o ausente: categoriaUso "A" y cargas a CERO (no se
//    INVENTA carga en un proyecto ajeno) + aviso en lenguaje de obra.
//  - `grupos` se elimina del raw.
function migrarV3aV4(datos: unknown): ResultadoMigracion {
  // Si el raw no es un objeto, no reestructuramos: la validacion Zod final lo
  // rechazara con una ruta legible (no es trabajo de la migracion validar).
  if (typeof datos !== "object" || datos === null) {
    return { datos: { ...(datos as object), schemaVersion: 4 } };
  }
  const obj = { ...(datos as Record<string, unknown>) };
  const avisos: string[] = [];

  const gruposOriginal: GrupoCrudo[] = Array.isArray(obj.grupos)
    ? (obj.grupos as GrupoCrudo[])
    : [];
  const grupoPorId = new Map<string, GrupoCrudo>();
  for (const g of gruposOriginal) {
    if (typeof g?.id === "string") grupoPorId.set(g.id, g);
  }

  const plantasOriginal: PlantaCruda[] = Array.isArray(obj.plantas)
    ? (obj.plantas as PlantaCruda[])
    : [];
  const huerfanas: string[] = [];
  obj.plantas = plantasOriginal.map((p) => {
    const { grupoId, ...resto } = p;
    const grupo = typeof grupoId === "string" ? grupoPorId.get(grupoId) : undefined;
    if (grupo !== undefined) {
      return {
        ...resto,
        categoriaUso: grupo.categoriaUso,
        sobrecargaUso: grupo.sobrecargaUso,
        cargasMuertas: grupo.cargasMuertas,
      };
    }
    huerfanas.push(typeof p.nombre === "string" ? p.nombre : "(sin nombre)");
    return { ...resto, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 };
  });
  delete obj.grupos;

  if (huerfanas.length > 0) {
    avisos.push(
      `Al actualizar el proyecto no se encontró el grupo de ${
        huerfanas.length === 1 ? "la planta" : "las plantas"
      } ${huerfanas.map((n) => `"${n}"`).join(", ")}: sus cargas de uso y muertas quedaron a cero. Revísalas en el diálogo de Plantas.`,
    );
  }

  return { datos: { ...obj, schemaVersion: 4 }, avisos };
}

// Migracion de model-schema v4 -> v5 (F3, forjado unidireccional). v5 añade a `Pano`
// CINCO campos OPCIONALES a nivel Zod (direccionViguetas/intereje/canto/anchoNervio/
// pesoPropio) que solo tienen sentido bajo `tipo:"unidireccional"`. Al ser OPCIONALES,
// la migracion de DATOS es un NO-OP: un `Pano` v4 (siempre losa, porque unidireccional
// se rechazaba aguas arriba y no era calculable) NO los lleva, y no hace falta
// sembrarlos — ModeloSchema v5 los acepta ausentes.
//
// Por que NO se siembran valores: no existe un default fisicamente correcto para
// intereje/canto/anchoNervio (dependen de la geometria real del forjado, que la
// migracion no conoce). Un `Pano` v4 unidireccional PUEDE existir en un proyecto
// guardado (el usuario lo creo y no calculo, porque se rechazaba): la migracion lo
// deja SIN los campos nuevos, y `validaciones` lo bloqueara con `PANO_UNI_CAMPOS`
// hasta que el usuario los rellene — comportamiento honesto (no se inventa geometria).
//
// Por tanto esta migracion SOLO bumpea la version (espejo del bump de v3->v4 cuando no
// hay huerfanas). No emite avisos propios: el aviso generico de actualizacion de
// esquema lo añade `migrarYValidar` al cierre de la cadena. La forma final v5 la
// valida `ModeloSchema` una sola vez al final.
function migrarV4aV5(datos: unknown): ResultadoMigracion {
  // Si el raw no es un objeto, no reestructuramos: la validacion Zod final lo
  // rechazara con una ruta legible (no es trabajo de la migracion validar). Espejo
  // exacto de las migraciones anteriores para ser robustos ante un raw corrupto.
  if (typeof datos !== "object" || datos === null) {
    return { datos: { ...(datos as object), schemaVersion: 5 } };
  }
  const obj = { ...(datos as Record<string, unknown>) };
  // No-op de datos: solo se eleva la version. Los paños viajan intactos (los campos
  // nuevos, ausentes en v4, siguen ausentes; ModeloSchema v5 los admite opcionales).
  return { datos: { ...obj, schemaVersion: 5 } };
}

// Tipo de forma para leer un `Muro` crudo v5 sin validarlo todavia. En v1..v5 un
// `Muro` era un STUB reservado: solo `{ id }` (nunca hubo UI que creara muros). v6
// (F3 muros/pantallas) lo expande a la forma completa. Solo describimos los campos
// que la migracion inspecciona para separar stub de muro-completo.
type MuroCrudo = {
  id?: unknown;
  x1?: unknown;
  y1?: unknown;
  x2?: unknown;
  y2?: unknown;
  plantaInicial?: unknown;
  plantaFinal?: unknown;
  espesor?: unknown;
  materialId?: unknown;
  tamMalla?: unknown;
};

// ¿Tiene este `Muro` crudo la GEOMETRIA minima de la forma v6? Un stub `{id}`
// (v1..v5) carece de segmento/espesor/etc.: NO se puede completar (nunca tuvo
// geometria de obra). La VALIDACION Zod estricta de cada campo la hace `MuroSchema`
// despues; esto solo separa stub de no-stub (espejo de panoTieneGeometriaV3).
function muroTieneGeometriaV6(muro: MuroCrudo): boolean {
  return (
    typeof muro.x1 === "number" &&
    typeof muro.y1 === "number" &&
    typeof muro.x2 === "number" &&
    typeof muro.y2 === "number" &&
    typeof muro.plantaInicial === "string" &&
    typeof muro.plantaFinal === "string" &&
    typeof muro.espesor === "number" &&
    typeof muro.materialId === "string" &&
    typeof muro.tamMalla === "number"
  );
}

// Migracion de model-schema v5 -> v6 (F3, muros/pantallas). v6 expande `Muro` de
// stub `{id}` a la forma completa (segmento en planta + tramo de plantas + espesor/
// material/malla/vinculacion). Un `Muro` v1..v5 era un STUB reservado: se DESCARTA
// con aviso (espejo EXACTO de migrarV2aV3 con los paños-stub, pero mas simple: no
// hay cargas que purgar porque ninguna carga podia apuntar a un muro). En la
// practica es un NO-OP: nunca existio UI de muros, todo proyecto real tiene
// `muros: []`. Pero la migracion es robusta ante un .json editado a mano.
function migrarV5aV6(datos: unknown): ResultadoMigracion {
  // Si el raw no es un objeto, no reestructuramos: la validacion Zod final lo
  // rechazara con una ruta legible (no es trabajo de la migracion validar).
  if (typeof datos !== "object" || datos === null) {
    return { datos: { ...(datos as object), schemaVersion: 6 } };
  }
  const obj = { ...(datos as Record<string, unknown>) };
  const avisos: string[] = [];

  const murosOriginal: MuroCrudo[] = Array.isArray(obj.muros)
    ? (obj.muros as MuroCrudo[])
    : [];
  const murosConservados = murosOriginal.filter(muroTieneGeometriaV6);
  const nDescartados = murosOriginal.length - murosConservados.length;
  obj.muros = murosConservados;

  if (nDescartados > 0) {
    avisos.push(
      `Se descartaron ${nDescartados} muro${nDescartados === 1 ? "" : "s"} sin geometría de una versión anterior.`,
    );
  }

  return { datos: { ...obj, schemaVersion: 6 }, avisos };
}

// Campos que conserva cada variante de `Pano` tras la union discriminada v7
// (T-f3-pano-schema-union). Los COMUNES viajan siempre; los PROPIOS de cada
// variante se conservan solo bajo su `tipo`, y CUALQUIER otro campo (los ajenos a
// la variante que un raw v6 arrastrase) se PODA. El orden no es contractual (Zod no
// lo exige); se listan agrupados por claridad.
const CAMPOS_COMUNES_PANO_V7 = [
  "id",
  "nombre",
  "tipo",
  "plantaId",
  "perimetro",
  "materialId",
  "bordeApoyo",
] as const;
// Propios por variante (contrato §2 del corte reticular). `losa` conserva
// espesor/tamMalla; `unidireccional` sus 5 campos (y pierde espesor/tamMalla, que en
// v5/v6 estaban declaradamente ignorados bajo ese tipo). El `reticular` NO figura
// aqui: un paño reticular v6 NO existe con forma valida (ver `migrarV6aV7`).
const CAMPOS_PROPIOS_PANO_V7: Record<string, readonly string[]> = {
  losa: ["espesor", "tamMalla"],
  unidireccional: [
    "direccionViguetas",
    "intereje",
    "canto",
    "anchoNervio",
    "pesoPropio",
  ],
};

// Poda un `Pano` crudo a los campos permitidos por su variante v7: comunes + los
// propios de su `tipo`. Copia SOLO las claves presentes (no siembra ausentes: la
// validacion Zod final exige la presencia de los obligatorios y señalara con ruta si
// falta alguno). Todo lo demas (campos ajenos a la variante) se descarta.
function podarPanoV7(pano: PanoCrudo, tipo: string): Record<string, unknown> {
  const permitidos = new Set<string>([
    ...CAMPOS_COMUNES_PANO_V7,
    ...(CAMPOS_PROPIOS_PANO_V7[tipo] ?? []),
  ]);
  const origen = pano as Record<string, unknown>;
  const podado: Record<string, unknown> = {};
  for (const clave of Object.keys(origen)) {
    if (permitidos.has(clave)) podado[clave] = origen[clave];
  }
  return podado;
}

// Migracion de model-schema v6 -> v7 (F3, forjado reticular). v7 parte `PanoSchema`
// en una UNION DISCRIMINADA por `tipo`: cada variante lleva SOLO sus campos, y los
// ajenos ya no son opcionales tolerados sino EXTRAÑOS. Esta migracion discrimina
// cada paño por `tipo` y PODA los campos que no pertenecen a su variante:
//   - `losa`: conserva espesor/tamMalla; ELIMINA los 5 campos uni si los arrastraba.
//   - `unidireccional`: conserva sus 5 campos; ELIMINA espesor/tamMalla (en v5/v6
//     estaban obligatorios a nivel Zod pero DECLARADAMENTE ignorados bajo este tipo).
//   - `reticular`: DESCARTE con aviso. En v6 el `tipo:"reticular"` estaba en el enum
//     (RESERVADO) pero la UI NUNCA lo ofrecio (PanelHerramientaPano: "Reticular no se
//     ofrece") y `PanoSchema` v6 exigia espesor/tamMalla OBLIGATORIOS para TODO tipo:
//     un reticular v6 solo podia existir con forma de LOSA (via .json editado a mano).
//     Esa forma NO satisface los nuevos campos reticulares obligatorios (intereje/
//     canto/anchoNervio/capaCompresion/pesoPropio) y no hay datos de obra que
//     preservar, asi que se DESCARTA (patron migrarV2aV3) junto con sus cargas
//     superficiales. NO se siembran defaults de `biblioteca/forjados.ts`: importar un
//     paño reticular v6 nunca debe romper la app, y sembrar geometria inventada
//     acoplaria esta frontera a la tabla normativa (§2 del contrato del corte).
//
// En la practica el descarte reticular es un NO-OP (nunca fue creable desde la UI);
// la poda de losa/uni tambien lo es para proyectos generados por la app (la app no
// filtraba campos ajenos, pero tampoco los sembraba). La migracion es robusta ante
// un .json HEREDADO o editado a mano que arrastrase campos cruzados.
function migrarV6aV7(datos: unknown): ResultadoMigracion {
  // Si el raw no es un objeto, no reestructuramos: la validacion Zod final lo
  // rechazara con una ruta legible (no es trabajo de la migracion validar).
  if (typeof datos !== "object" || datos === null) {
    return { datos: { ...(datos as object), schemaVersion: 7 } };
  }
  const obj = { ...(datos as Record<string, unknown>) };
  const avisos: string[] = [];

  const panosOriginal: PanoCrudo[] = Array.isArray(obj.panos)
    ? (obj.panos as PanoCrudo[])
    : [];

  // Poda por variante; descarta los reticular (sin forma valida en v6).
  const panosConservados: Record<string, unknown>[] = [];
  const idsDescartados = new Set<string>();
  let nReticularesDescartados = 0;
  for (const pano of panosOriginal) {
    const tipo = pano.tipo;
    if (tipo === "reticular") {
      // Sin datos de obra reconstruibles: se descarta (y se purgan sus cargas).
      if (typeof pano.id === "string") idsDescartados.add(pano.id);
      nReticularesDescartados += 1;
      continue;
    }
    // losa / unidireccional (o cualquier `tipo` desconocido: se poda a comunes y la
    // validacion Zod final lo rechazara por `tipo` invalido con ruta legible, en vez
    // de que la migracion invente una decision).
    panosConservados.push(podarPanoV7(pano, typeof tipo === "string" ? tipo : ""));
  }

  obj.panos = panosConservados;

  // Purga las cargas superficiales que apuntaban a un paño reticular descartado
  // (referencias colgantes; mismo criterio que migrarV2aV3). El resto viaja intacto.
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
  }

  if (nReticularesDescartados > 0) {
    const n = nReticularesDescartados;
    avisos.push(
      `Se descartaron ${n} paño${n === 1 ? "" : "s"} reticular${n === 1 ? "" : "es"} de una versión anterior que no se podían actualizar; vuelva a definirlos con el nuevo forjado reticular.`,
    );
  }

  return { datos: { ...obj, schemaVersion: 7 }, avisos };
}

// Registro indexado por version de origen: `MIGRACIONES[v]` transforma v -> v+1.
// `MIGRACIONES[1]` lleva v1 -> v2 (F2a, model-schema); `MIGRACIONES[2]` lleva
// v2 -> v3 (F3 corte 1, paño losa); `MIGRACIONES[3]` lleva v3 -> v4 (F3.4, plantas
// sin grupos); `MIGRACIONES[4]` lleva v4 -> v5 (F3 unidireccional, bump de version:
// campos opcionales, sin sembrado); `MIGRACIONES[5]` lleva v5 -> v6 (F3 muros,
// descarte de muros-stub); `MIGRACIONES[6]` lleva v6 -> v7 (F3 reticular, union
// discriminada de `Pano`: poda de campos ajenos por variante + descarte de paños
// reticular heredados sin forma valida). La cadena de `migrarYValidar` los aplica en
// orden ascendente hasta `SCHEMA_VERSION`.
const MIGRACIONES: Record<number, Migracion> = {
  1: migrarV1aV2,
  2: migrarV2aV3,
  3: migrarV3aV4,
  4: migrarV4aV5,
  5: migrarV5aV6,
  6: migrarV6aV7,
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

  // [OV-4] SANEO de ids reservados (F3.2): una hipotesis cuyo id colisione con los
  // cases sinteticos de cargas de grupo se RENOMBRA aqui (y sus cargas se
  // re-apuntan), en vez de dejar que el calculo la bloquee con un error que el
  // usuario no puede arreglar (los ids no se editan desde la UI). "Importar nunca
  // debe romper la app" (§2.8). Mismo patron que la rama usurpadora del peso
  // propio (F2a): busqueda de hueco libre + re-apuntado. Sin migracion de esquema:
  // es saneo independiente de la version.
  const saneado = sanearIdsReservados(parsed.data);
  return { ok: true, modelo: saneado.modelo, avisos: [...avisos, ...saneado.avisos] };
}

// Renombra las hipotesis cuyo id es un case sintetico reservado (auto-planta-cm /
// auto-planta-uso) a un id libre y re-apunta `modelo.cargas[].hipotesisId`. La
// colision es casi imposible con ids generados por la app (opacos), pero un .json
// editado a mano es justo el borde que esta frontera protege. PURA (no muta la
// entrada).
function sanearIdsReservados(modelo: Modelo): { modelo: Modelo; avisos: string[] } {
  const reservados = new Set<string>([CASE_CM_PLANTA, CASE_USO_PLANTA]);
  const intrusas = modelo.hipotesis.filter((h) => reservados.has(h.id));
  if (intrusas.length === 0) return { modelo, avisos: [] };

  const avisos: string[] = [];
  const ocupados = new Set(modelo.hipotesis.map((h) => h.id));
  const renombres = new Map<string, string>();
  for (const h of intrusas) {
    // Hueco libre determinista: "<id>-usuario", "-usuario-2", ... (espejo de
    // elegirNombrePesoPropio, aqui sobre ids).
    let candidato = `${h.id}-usuario`;
    let k = 2;
    while (ocupados.has(candidato)) {
      candidato = `${h.id}-usuario-${k}`;
      k += 1;
    }
    ocupados.add(candidato);
    renombres.set(h.id, candidato);
    avisos.push(
      `La hipótesis "${h.nombre}" usaba un identificador reservado para las cargas automáticas de planta y se ha ajustado internamente; sus cargas se conservan.`,
    );
  }
  return {
    modelo: {
      ...modelo,
      hipotesis: modelo.hipotesis.map((h) =>
        renombres.has(h.id) ? { ...h, id: renombres.get(h.id)! } : h,
      ),
      cargas: modelo.cargas.map((c) =>
        renombres.has(c.hipotesisId)
          ? { ...c, hipotesisId: renombres.get(c.hipotesisId)! }
          : c,
      ),
    },
    avisos,
  };
}
