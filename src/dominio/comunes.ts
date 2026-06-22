// Cimientos del modelo de dominio (Capa 1).
// Schemas Zod reutilizables y la version del esquema para migracion (feature-8).
import { z } from "zod";

// Identificadores y nombres: cadenas no vacias. Las relaciones se hacen por `id`.
export const IdSchema = z.string().min(1);
export const NombreSchema = z.string().min(1);

// Version del esquema persistido. feature-8 la usa para migrar proyectos antiguos.
export const SCHEMA_VERSION = 1;
