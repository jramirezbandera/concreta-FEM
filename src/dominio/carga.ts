// Hipotesis y Cargas (Capa 1). Cada carga pertenece a una hipotesis (relacion por
// id) y actua sobre un ambito (id del elemento al que se aplica). El reparto y la
// direccion FEM son responsabilidad del discretizador (feature-4).
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

// `automatica`: marca la hipotesis generada por el sistema (no por el usuario). En
// F2a la unica automatica es `hip-peso-propio` (peso propio, sembrada con
// automatica:true). Invariante de dominio: una hipotesis automatica NO se edita ni
// se elimina, y ninguna `Carga` de usuario puede apuntar a ella (sus cargas las
// genera el discretizador, no viven en `modelo.cargas`). Default false via `.default`
// para que el borde de import (Zod) lo aporte a hipotesis antiguas que no lo traen.
export const HipotesisSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  tipo: z.enum(["permanente", "variable"]),
  automatica: z.boolean().default(false),
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
