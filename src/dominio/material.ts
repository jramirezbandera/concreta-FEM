// Material (Capa 1). Minimo en F1: solo identidad y tipo.
// Las propiedades de calculo (E, G, densidad) llegan en feature-3.
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

export const MaterialSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  tipo: z.enum(["hormigon", "acero"]),
});
export type Material = z.infer<typeof MaterialSchema>;
