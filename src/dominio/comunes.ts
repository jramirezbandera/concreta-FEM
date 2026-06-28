// Cimientos del modelo de dominio (Capa 1).
// Schemas Zod reutilizables y la version del esquema para migracion (feature-8).
import { z } from "zod";

// Identificadores y nombres: cadenas no vacias. Las relaciones se hacen por `id`.
export const IdSchema = z.string().min(1);
export const NombreSchema = z.string().min(1);

// Version del esquema del MODELO persistido (Capa 1). La migracion (feature-8 +
// F2.3) la usa para actualizar proyectos antiguos. OJO: es distinta de la version
// de la base Dexie/IndexedDB (ya en 2 por las plantillas de F15); esta versiona la
// FORMA del Modelo. v2 (F2a) introduce `OpcionesAnalisis.incluirPesoPropio`,
// `Hipotesis.automatica` y la hipotesis automatica `hip-peso-propio`.
export const SCHEMA_VERSION = 2;
