// Muro (Capa 1). Reservado para F3 (muros y pantallas). Schema minimo solo con
// identidad: permite ensanchar en F3 sin romper Zod ni Immer.
import { z } from "zod";
import { IdSchema } from "./comunes";

export const MuroSchema = z.object({ id: IdSchema });
export type Muro = z.infer<typeof MuroSchema>;
