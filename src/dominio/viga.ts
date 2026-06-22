// Viga (Capa 1). Pertenece a una planta y conecta dos nudos. Los extremos pueden
// ser empotrados o articulados (el discretizador traduce a releases en feature-4).
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

export const VigaSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  plantaId: IdSchema,
  nudoI: IdSchema,
  nudoJ: IdSchema,
  seccionId: IdSchema,
  materialId: IdSchema,
  extremoI: z.enum(["empotrado", "articulado"]),
  extremoJ: z.enum(["empotrado", "articulado"]),
  tirante: z.boolean(),
});
export type Viga = z.infer<typeof VigaSchema>;
