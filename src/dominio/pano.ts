// Pano (Capa 1): superficie horizontal de forjado. El paño pertenece a una planta y su
// contorno se define por nudos (F3 corte 1: rectangulo de 4 nudos PROPIOS, sin compartir
// con el portico). Segun su `tipo` se discretiza de tres formas distintas — por eso
// `PanoSchema` es una UNION DISCRIMINADA por `tipo` (cierra T-f3-pano-schema-union): cada
// variante declara SOLO sus campos, obligatorios, y el discretizador ESTRECHA por `tipo`.
//
//   - "losa"           -> placa maciza: se malla en quads (Capa 2). Campos: espesor, tamMalla.
//   - "unidireccional" -> forjado de viguetas en UNA direccion (members sinteticos, no malla).
//                         Campos: direccionViguetas, intereje, canto, anchoNervio, pesoPropio.
//   - "reticular"      -> forjado bidireccional (emparrillado de nervios). Campos: intereje,
//                         canto, anchoNervio, capaCompresion, pesoPropio. En ESTA fase el
//                         discretizador lo RECHAZA con un error de obra (PANO_TIPO_NO_SOPORTADO);
//                         el calculo del reticular llega en un corte posterior (F3/F4).
//
// `bordeApoyo` es una propiedad de OBRA (no jerga FEM): como descansa el borde del forjado.
//   - "simple"    -> borde apoyado (impide la flecha vertical) = losa simplemente apoyada.
//   - "empotrado" -> borde empotrado (impide flecha y giro) = continuidad/encastre.
//   - "libre"     -> borde sin apoyo (voladizo / apoyado en otros bordes).
// El discretizador lo traduce a apoyos del perimetro + estabilizacion en el plano.
//
// UNIDADES (CLAUDE.md §14): TODAS las longitudes/geometrias en METROS (sistema interno);
// pesoPropio en kN/m². La UI las muestra en mm (o kN/m²) y convierte SOLO en el borde.
//
// POSITIVIDAD a nivel Zod: longitudes/geometrias con NumeroFinitoSchema.positive() (finito
// y > 0: .positive() solo NO basta, Infinity es positivo); `pesoPropio` con .nonnegative()
// (0 es legitimo, un forjado sin peso tabulado). SIN `.default` en ninguna variante: un
// default volveria la clave obligatoria en el tipo de SALIDA y contaminaria los literales de
// las otras variantes (mismo gotcha documentado del corte 1, `quads?` en contratoFEM.ts).
import { z } from "zod";
import { IdSchema, NombreSchema, NumeroFinitoSchema } from "./comunes";

export const TipoPanoSchema = z.enum(["losa", "reticular", "unidireccional"]);
export type TipoPano = z.infer<typeof TipoPanoSchema>;

export const BordeApoyoSchema = z.enum(["simple", "empotrado", "libre"]);
export type BordeApoyo = z.infer<typeof BordeApoyoSchema>;

// Direccion de las viguetas de un forjado unidireccional (en ejes de OBRA/planta).
export const TipoDireccionViguetasSchema = z.enum(["x", "y"]);
export type TipoDireccionViguetas = z.infer<typeof TipoDireccionViguetasSchema>;

// Campos COMUNES a las tres variantes (sin `tipo`: cada variante lo fija como z.literal).
// Se extiende con .extend() por variante para no repetir la lista.
const CamposComunesPanoSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  plantaId: IdSchema,
  // Nudos del contorno por id (orden de recorrido). Corte 1: 4 nudos en rectangulo de ejes.
  // >=3 a nivel de schema (un poligono necesita 3); la geometria concreta (rectangular,
  // no degenerado) la valida el discretizador.
  perimetro: z.array(IdSchema).min(3),
  materialId: IdSchema,
  bordeApoyo: BordeApoyoSchema,
});

// Variante LOSA MACIZA: se malla en quads. Espesor (canto de la placa) y tamMalla (tamaño
// objetivo de elemento de la rejilla), ambos finitos y > 0.
export const PanoLosaSchema = CamposComunesPanoSchema.extend({
  tipo: z.literal("losa"),
  espesor: NumeroFinitoSchema.positive(), // m
  tamMalla: NumeroFinitoSchema.positive(), // m, tamano objetivo de elemento de malla
});
export type PanoLosa = z.infer<typeof PanoLosaSchema>;

// Variante UNIDIRECCIONAL: forjado de viguetas en UNA direccion (members sinteticos).
// `direccionViguetas`: "x" -> viguetas paralelas al eje obra-X (apoyan en x=xMin/xMax);
// "y" -> paralelas al eje obra-Y. La luz de la vigueta = dimension del paño en esa direccion;
// el intereje se mide en la perpendicular. `intereje/canto/anchoNervio` finitos y > 0;
// `pesoPropio` TABULADO (kN/m², >= 0): se reparte a las viguetas como carga gravitatoria, sin
// añadir rho*A del nervio (evita doble conteo). Todos OBLIGATORIOS en esta variante.
export const PanoUnidireccionalSchema = CamposComunesPanoSchema.extend({
  tipo: z.literal("unidireccional"),
  direccionViguetas: TipoDireccionViguetasSchema,
  intereje: NumeroFinitoSchema.positive(), // m, separacion OBJETIVO entre viguetas
  canto: NumeroFinitoSchema.positive(), // m, canto del nervio (gobierna la flexion vertical)
  anchoNervio: NumeroFinitoSchema.positive(), // m, ancho del nervio
  pesoPropio: NumeroFinitoSchema.nonnegative(), // kN/m², peso propio tabulado del forjado
});
export type PanoUnidireccional = z.infer<typeof PanoUnidireccionalSchema>;

// Variante RETICULAR: forjado bidireccional (emparrillado de nervios en dos direcciones).
// NO lleva `espesor` ni `tamMalla` (no hay malla de quads: la retícula la fija el intereje) ni
// `direccionViguetas` (es bidireccional). `canto` es el TOTAL (incluida la capa de compresion);
// `capaCompresion` es el espesor de la capa (minimo normativo 0,05 m; 0,04 con caseton perdido).
// `intereje/canto/anchoNervio/capaCompresion` finitos y > 0; `pesoPropio` TABULADO >= 0.
// Todos OBLIGATORIOS. En esta fase el discretizador lo RECHAZA (PANO_TIPO_NO_SOPORTADO): el
// calculo del emparrillado llega en un corte posterior; el esquema ya lo modela para que la
// UI/persistencia puedan portarlo sin inventar campos.
export const PanoReticularSchema = CamposComunesPanoSchema.extend({
  tipo: z.literal("reticular"),
  intereje: NumeroFinitoSchema.positive(), // m, separacion OBJETIVO entre nervios (por direccion)
  canto: NumeroFinitoSchema.positive(), // m, canto TOTAL del forjado
  anchoNervio: NumeroFinitoSchema.positive(), // m, ancho del nervio
  capaCompresion: NumeroFinitoSchema.positive(), // m, espesor de la capa de compresion
  pesoPropio: NumeroFinitoSchema.nonnegative(), // kN/m², peso propio tabulado del forjado
});
export type PanoReticular = z.infer<typeof PanoReticularSchema>;

export const PanoSchema = z.discriminatedUnion("tipo", [
  PanoLosaSchema,
  PanoUnidireccionalSchema,
  PanoReticularSchema,
]);
export type Pano = z.infer<typeof PanoSchema>;
