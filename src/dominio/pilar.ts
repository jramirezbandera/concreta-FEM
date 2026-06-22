// Pilar (Capa 1). Posicion en planta (x, y en m), tramo entre dos plantas,
// giro (angulo en grados) y condiciones de arranque/vinculacion exterior.
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

export const PilarSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  x: z.number(),
  y: z.number(),
  plantaInicial: IdSchema,
  plantaFinal: IdSchema,
  seccionId: IdSchema,
  materialId: IdSchema,
  angulo: z.number(),
  vinculacionExterior: z.boolean(),
  arranque: z.enum(["empotrado", "articulado", "elastico"]),
});
export type Pilar = z.infer<typeof PilarSchema>;
