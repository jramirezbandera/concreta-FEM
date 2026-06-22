// Pano (Capa 1). Reservado para F3 (paños uni/reticular/losa, isovalores). Schema
// minimo solo con identidad: permite ensanchar en F3 sin romper Zod ni Immer.
import { z } from "zod";
import { IdSchema } from "./comunes";

export const PanoSchema = z.object({ id: IdSchema });
export type Pano = z.infer<typeof PanoSchema>;
