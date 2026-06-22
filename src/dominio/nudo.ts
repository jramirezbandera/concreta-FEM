// Nudo (Capa 1): punto en planta (x, y) en metros que las vigas referencian por
// `id` (nudoI/nudoJ). Es el anclaje geometrico de la obra; la cota/altura la aporta
// la planta de la viga, por eso aqui solo viven las coordenadas en planta.
//
// SIN `nombre`: a diferencia de pilares/vigas (elementos constructivos que el
// arquitecto nombra y selecciona), los nudos son puntos de apoyo implicitos del
// trazado, sin identidad propia en la UI (coherente con CYPECAD, que no nombra los
// nudos de las vigas). El `id` basta para las relaciones; anadir `nombre` seria
// jerga FEM filtrada a la Capa 1. El discretizador (feature-4) generara los nodos
// FEM por snapping geometrico, independiente de estos ids de dominio.
import { z } from "zod";
import { IdSchema } from "./comunes";

export const NudoSchema = z.object({
  id: IdSchema,
  x: z.number(), // posicion en planta, eje X (m, interno kN-m)
  y: z.number(), // posicion en planta, eje Y (m, interno kN-m)
});
export type Nudo = z.infer<typeof NudoSchema>;
