// Cimientos del modelo de dominio (Capa 1).
// Schemas Zod reutilizables y la version del esquema para migracion (feature-8).
import { z } from "zod";

// Identificadores y nombres: cadenas no vacias. Las relaciones se hacen por `id`.
export const IdSchema = z.string().min(1);
export const NombreSchema = z.string().min(1);

// [AUDITORIA A-3] Magnitud fisica FINITA. Un `z.number()` pelado ACEPTA ±Infinity
// (solo rechaza NaN): un Infinity que entre por el borde de persistencia (el blob
// de IndexedDB cruza por structured clone, que SI preserva Infinity, a diferencia
// de JSON.parse) llegaria hasta PyNite como geometria/carga basura sin aviso.
// Toda coordenada, cota, dimension o valor de carga del dominio usa este schema.
export const NumeroFinitoSchema = z.number().finite();

// Version del esquema del MODELO persistido (Capa 1). La migracion (feature-8 +
// F2.3) la usa para actualizar proyectos antiguos. OJO: es distinta de la version
// de la base Dexie/IndexedDB (ya en 2 por las plantillas de F15); esta versiona la
// FORMA del Modelo. v2 (F2a) introduce `OpcionesAnalisis.incluirPesoPropio`,
// `Hipotesis.automatica` y la hipotesis automatica `hip-peso-propio`.
// v3 (F3, corte 1) expande `Pano` de stub `{id}` a la forma completa de LOSA
// (nombre/tipo/plantaId/perimetro/espesor/materialId/tamMalla/bordeApoyo). La
// migracion v2->v3 DESCARTA los paños-stub heredados (sin geometria) y sus cargas
// superficiales (no se pueden completar a la forma de losa).
// v4 (F3.4, "plantas sin grupos") ELIMINA `Grupo` y `Modelo.grupos`: cada `Planta`
// absorbe categoriaUso/sobrecargaUso/cargasMuertas y pierde `grupoId`. La migracion
// v3->v4 copia a cada planta los valores de su grupo (o defaults si no resuelve).
// v5 (F3, forjado unidireccional) añade a `Pano` 5 campos OPCIONALES para el tipo
// "unidireccional" (direccionViguetas/intereje/canto/anchoNervio/pesoPropio). Como son
// opcionales, la migracion v4->v5 solo bumpea la version: NO siembra valores (no hay un
// default fisicamente correcto para intereje/canto). Un paño "unidireccional" heredado
// sin esos campos lo bloqueara validaciones (PANO_UNI_CAMPOS) hasta que el usuario los
// rellene — honesto, no se inventa geometria.
// v6 (F3, muros/pantallas) expande `Muro` de stub `{id}` a la forma completa (segmento
// x1/y1/x2/y2, plantaInicial/Final, espesor, material, tamMalla, vinculacionExterior).
// La migracion v5->v6 DESCARTA los muros-stub heredados (sin geometria; nunca hubo UI
// que los creara — espejo del descarte de paños-stub en v2->v3).
// v7 (F3, forjado reticular) parte `PanoSchema` en union discriminada por `tipo`
// (T-f3-pano-schema-union): cada variante lleva SOLO sus campos. La migracion v6->v7
// PODA los campos ajenos a cada variante (un `losa` pierde los 5 campos uni si los
// arrastraba; un `unidireccional` pierde `espesor`/`tamMalla`, que en v5/v6 estaban
// declaradamente ignorados) y DESCARTA los paños `reticular` heredados (que en v6 solo
// podian tener forma de losa y no satisfacen los nuevos campos reticulares obligatorios).
export const SCHEMA_VERSION = 7;
