// Composicion raiz de la Capa 1 (CLAUDE.md §6). El ModeloSchema valida SOLO
// forma/tipos/enums; la integridad referencial (que un plantaId exista, sujecion
// suficiente, etc.) es responsabilidad del discretizador (feature-4).
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";
import { CategoriaUsoSchema } from "./categoria";
import { SeccionSchema } from "./seccion";
import { NudoSchema } from "./nudo";
import { PilarSchema } from "./pilar";
import { VigaSchema } from "./viga";
import { CargaSchema, HipotesisSchema } from "./carga";
import { PanoSchema } from "./pano";
import { MuroSchema } from "./muro";

// Grupo: agrupa plantas con misma definicion de uso y cargas (vocabulario CYPECAD).
export const GrupoSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  categoriaUso: CategoriaUsoSchema,
  sobrecargaUso: z.number(),
  cargasMuertas: z.number(),
});
export type Grupo = z.infer<typeof GrupoSchema>;

// Planta: nivel con cota y altura libre, perteneciente a un grupo.
export const PlantaSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  cota: z.number(),
  altura: z.number(),
  grupoId: IdSchema,
});
export type Planta = z.infer<typeof PlantaSchema>;

// Opciones del analisis (CLAUDE.md §15: lineal en F1; general y P-Delta en F2).
//  - `tipo`: el discretizador lo mapea a AnalisisFEM.type (lineal->linear,
//    general->analyze, pDelta->PDelta). "pDelta" es nuevo en F2a (P-Delta de
//    balanceo a nivel nudo, exponiendo el analyze_PDelta del glue).
//  - `comprobarEstatica`: la UI lo deshabilita/explica cuando tipo==="pDelta"
//    (el P-Delta no realiza comprobacion de equilibrio); el glue lo fuerza a false
//    bajo P-Delta (Fase 2, F2.2/E6).
//  - `incluirPesoPropio`: si esta activo, el discretizador emite el peso propio
//    (w=A·rho, FY global negativa) como hipotesis automatica `hip-peso-propio`.
//    Default true (el modelo vacio lo siembra a true). Es un campo REQUERIDO del
//    schema: la migracion v1->v2 (Fase 2) lo aporta a proyectos antiguos.
export const OpcionesAnalisisSchema = z.object({
  tipo: z.enum(["lineal", "general", "pDelta"]),
  comprobarEstatica: z.boolean(),
  incluirPesoPropio: z.boolean(),
});
export type OpcionesAnalisis = z.infer<typeof OpcionesAnalisisSchema>;

// Modelo raiz: lo unico que se persiste. `unidades` fijo a kN-m; `schemaVersion`
// reservado para migracion (feature-8). panos/muros reservados para F3.
export const ModeloSchema = z.object({
  unidades: z.literal("kN-m"),
  schemaVersion: z.number(),
  grupos: z.array(GrupoSchema),
  plantas: z.array(PlantaSchema),
  // Recursos referenciados por pilares/vigas. Las secciones se PERSISTEN aqui
  // (a diferencia de los materiales, que son catalogo fijo: Opcion A feature-3),
  // porque guardan dimensiones de obra (b/h/d) que el arquitecto elige. Van antes
  // de pilares/vigas para reflejar la dependencia (los elementos las referencian).
  secciones: z.array(SeccionSchema),
  nudos: z.array(NudoSchema),
  pilares: z.array(PilarSchema),
  vigas: z.array(VigaSchema),
  panos: z.array(PanoSchema),
  muros: z.array(MuroSchema),
  cargas: z.array(CargaSchema),
  hipotesis: z.array(HipotesisSchema),
  analisis: OpcionesAnalisisSchema,
});
export type Modelo = z.infer<typeof ModeloSchema>;
