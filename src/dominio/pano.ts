// Pano (Capa 1): superficie horizontal de forjado. F3 corte 1 implementa la LOSA MACIZA
// (placa); `reticular`/`unidireccional` quedan RESERVADOS (el discretizador los rechaza con
// un error de obra hasta que se implementen). El paño pertenece a una planta y su contorno
// se define por nudos (corte 1: rectangulo de 4 nudos PROPIOS, sin compartir con el portico:
// el acoplamiento malla<->vigas es un corte posterior). El discretizador (F3) lo malla en
// quads (Capa 2) que consume PyNite.
//
// `bordeApoyo` es una propiedad de OBRA (no jerga FEM): como descansa el borde de la losa.
//   - "simple"    -> borde apoyado (impide la flecha vertical) = losa simplemente apoyada.
//   - "empotrado" -> borde empotrado (impide flecha y giro) = continuidad/encastre.
//   - "libre"     -> borde sin apoyo (voladizo / apoyado en otros bordes).
// El discretizador lo traduce a apoyos del perimetro + estabilizacion en el plano.
//
// UNIDADES (CLAUDE.md §14): espesor y tamMalla en METROS (sistema interno); la UI los
// muestra en mm y convierte SOLO en el borde de entrada/salida.
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

export const TipoPanoSchema = z.enum(["losa", "reticular", "unidireccional"]);
export type TipoPano = z.infer<typeof TipoPanoSchema>;

export const BordeApoyoSchema = z.enum(["simple", "empotrado", "libre"]);
export type BordeApoyo = z.infer<typeof BordeApoyoSchema>;

export const PanoSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  tipo: TipoPanoSchema,
  plantaId: IdSchema,
  // Nudos del contorno por id (orden de recorrido). Corte 1: 4 nudos en rectangulo de ejes.
  // >=3 a nivel de schema (un poligono necesita 3); la geometria concreta (rectangular,
  // no degenerado) la valida el discretizador.
  perimetro: z.array(IdSchema).min(3),
  espesor: z.number().positive(), // m
  materialId: IdSchema,
  tamMalla: z.number().positive(), // m, tamano objetivo de elemento de malla
  bordeApoyo: BordeApoyoSchema,
});
export type Pano = z.infer<typeof PanoSchema>;
