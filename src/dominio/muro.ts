// Muro (Capa 1): pantalla de hormigon — superficie VERTICAL entre dos plantas.
// F3 corte "muros/pantallas" lo expande del stub `{id}` (v1..v5) a la forma completa.
// Es el hermano vertical del `Pano`: el discretizador lo malla en quads (Capa 2) en su
// plano vertical; la rigidez de MEMBRANA del quad (verificada en el spike
// src/solver/spikes/muro_membrana_spike.md) es la que rigidiza lateralmente el edificio.
//
// GEOMETRIA: segmento del EJE en planta con coordenadas CRUDAS (x1,y1)-(x2,y2), espejo
// de `Pilar.x/y` — NO nudos de obra: el acople al portico es por CELDA cuantizada
// (clavePosicion), no por identidad de nudo; un `Nudo` no porta planta y el muro cruza
// varias; y las recetas crear/eliminar quedan sin higiene de huerfanos. El espesor se
// centra en el eje. Corte 1: el segmento debe ser PARALELO a un eje de obra (X o Y);
// la validacion (MURO_NO_ALINEADO) lo exige — muro diagonal = deuda T-muro-diagonal.
//
// TRAMO VERTICAL: `plantaInicial`/`plantaFinal` como el pilar (de cota de la planta
// inicial a cota de la final). `vinculacionExterior` = la fila BASE se empotra al
// terreno (6 GDL, espejo del arranque empotrado de pilar; arranque articulado/elastico
// de muro = deuda). Sin base vinculada, el muro debe quedar sujeto por su acople al
// portico (lo exige validaciones: MURO_SIN_SUJECION).
//
// UNIDADES (CLAUDE.md §14): espesor y tamMalla en METROS (sistema interno); la UI
// muestra mm y convierte SOLO en el borde.
import { z } from "zod";
import { IdSchema, NombreSchema, NumeroFinitoSchema } from "./comunes";

export const MuroSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  // Segmento del eje en planta (m, coordenadas de obra).
  x1: NumeroFinitoSchema,
  y1: NumeroFinitoSchema,
  x2: NumeroFinitoSchema,
  y2: NumeroFinitoSchema,
  plantaInicial: IdSchema,
  plantaFinal: IdSchema,
  // [A-3] finito+positivo: .positive() solo NO basta (Infinity es positivo).
  espesor: NumeroFinitoSchema.positive(), // m
  materialId: IdSchema,
  tamMalla: NumeroFinitoSchema.positive(), // m, tamano objetivo de elemento de malla
  vinculacionExterior: z.boolean(),
});
export type Muro = z.infer<typeof MuroSchema>;
