// tiposDxf: fuente de verdad de tipos (Zod) de las plantillas DXF (feature-15).
//
// Una plantilla DXF es AYUDA DE DIBUJO (calco), NO Capa 1: no entra en el Modelo
// ni en el discretizador. Estos tipos describen las entidades ya normalizadas a
// METROS (sistema interno, CLAUDE.md §14): la conversion de unidades ocurre una
// sola vez en el borde de importacion (parseDxf), nunca aqui.
//
// Modulo PURO: solo Zod. Sin three.js, sin React. Las coordenadas se piensan para
// el render con BufferGeometry/lineSegments (ver GeometriaModelo.tsx): la linea es
// (x1,y1)->(x2,y2); la polilinea es una secuencia de puntos.
import { z } from "zod";
import { IdSchema, NombreSchema } from "../../../dominio/comunes";

// --- Entidades DXF (union discriminada por `tipo`) ---------------------------
// Todas las coordenadas en metros. Angulos de arco en RADIANES (es lo que entrega
// el parser tras leer los grados del DXF); se mantienen en radianes para no volver
// a convertir en el render.

// Coordenadas en metros: SIEMPRE finitas (rechaza NaN/Infinity). Endurecer aqui
// blinda TODO el borde: tanto la importacion (parseDxf -> PanelPlantillas) como la
// hidratacion desde Dexie validan contra este mismo esquema (single source).
export const LineaDxfSchema = z.object({
  tipo: z.literal("linea"),
  x1: z.number().finite(),
  y1: z.number().finite(),
  x2: z.number().finite(),
  y2: z.number().finite(),
});

export const PuntoXYSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const PolilineaDxfSchema = z.object({
  tipo: z.literal("polilinea"),
  puntos: z.array(PuntoXYSchema),
  cerrada: z.boolean(),
});

export const PuntoDxfSchema = z.object({
  tipo: z.literal("punto"),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const CirculoDxfSchema = z.object({
  tipo: z.literal("circulo"),
  cx: z.number().finite(),
  cy: z.number().finite(),
  // Radio finito y > 0: un circulo de radio 0/negativo no es geometria valida.
  r: z.number().finite().positive(),
});

export const ArcoDxfSchema = z.object({
  tipo: z.literal("arco"),
  cx: z.number().finite(),
  cy: z.number().finite(),
  r: z.number().finite().positive(),
  // Radianes. anguloInicio/anguloFin antihorario respecto al eje +X local.
  anguloInicio: z.number().finite(),
  anguloFin: z.number().finite(),
});

export const EntidadDxfSchema = z.discriminatedUnion("tipo", [
  LineaDxfSchema,
  PolilineaDxfSchema,
  PuntoDxfSchema,
  CirculoDxfSchema,
  ArcoDxfSchema,
]);

// --- Caja envolvente ---------------------------------------------------------
export const BboxSchema = z.object({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
});

// --- Plantilla (registro de referencia, fuera de Capa 1) ---------------------
// La transform coloca el dibujo sobre la planta: escala (>0), rotacion en GRADOS
// (lo que el usuario ajusta en el panel), traslacion (x,y) en metros y opacidad
// 0..1. `creadaEn` es epoch ms: lo inyecta el LLAMADOR (no usar Date.now() en
// codigo puro), para mantener parseo/transform deterministas y testeables.
export const TransformPlantillaSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  escala: z.number().finite().positive(),
  rotacion: z.number().finite(), // grados
  opacidad: z.number().min(0).max(1),
});

export const PlantillaSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  nombreArchivo: z.string(),
  plantaId: z.string(),
  entidades: z.array(EntidadDxfSchema),
  transform: TransformPlantillaSchema,
  visible: z.boolean(),
  bloqueado: z.boolean(),
  creadaEn: z.number(),
});

// --- Tipos (fuente unica via z.infer, CLAUDE.md §8) --------------------------
export type EntidadDxf = z.infer<typeof EntidadDxfSchema>;
export type LineaDxf = z.infer<typeof LineaDxfSchema>;
export type PolilineaDxf = z.infer<typeof PolilineaDxfSchema>;
export type PuntoDxf = z.infer<typeof PuntoDxfSchema>;
export type CirculoDxf = z.infer<typeof CirculoDxfSchema>;
export type ArcoDxf = z.infer<typeof ArcoDxfSchema>;
export type PuntoXY = z.infer<typeof PuntoXYSchema>;
export type Bbox = z.infer<typeof BboxSchema>;
export type TransformPlantilla = z.infer<typeof TransformPlantillaSchema>;
export type Plantilla = z.infer<typeof PlantillaSchema>;
