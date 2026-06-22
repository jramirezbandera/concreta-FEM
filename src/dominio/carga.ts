// Hipotesis y Cargas (Capa 1). Cada carga pertenece a una hipotesis (relacion por
// id) y actua sobre un ambito (id del elemento al que se aplica). El reparto y la
// direccion FEM son responsabilidad del discretizador (feature-4).
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

export const HipotesisSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  tipo: z.enum(["permanente", "variable"]),
});
export type Hipotesis = z.infer<typeof HipotesisSchema>;

export const CargaSchema = z.object({
  id: IdSchema,
  tipo: z.enum(["puntual", "lineal", "superficial"]),
  ambito: IdSchema,
  valor: z.number(),
  hipotesisId: IdSchema,
});
export type Carga = z.infer<typeof CargaSchema>;
