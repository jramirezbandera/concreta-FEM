// CAPA 2: el contrato JSON que consume PyNite (ver PyNite_Guia_Completa.md §11.1).
// Los nombres de campo son IDENTICOS a los del esquema de la guia para que el glue
// Python (feature-5) los pase tal cual a FEModel3D sin traduccion (snake_case incluido).
// Este modulo es PURO: solo tipos y validacion Zod, sin React/IO/Pyodide.
//
// Patron identico al dominio: cada entidad un `...Schema`, el tipo via `z.infer`.
import { z } from "zod";

// --- Direcciones de carga (hallazgo #3, el error nº1) -----------------------
// Convencion PyNite: MAYUSCULAS = ejes GLOBALES, minusculas = ejes LOCALES de barra.
// La direccion equivocada da resultados plausibles pero erroneos sin error de
// ejecucion, por eso se fija aqui de forma estricta y se blinda con golden tests.

// Cargas en nodo: PyNite SOLO admite direccion global (guia §5.4 add_node_load).
const DireccionNodoSchema = z.enum(["FX", "FY", "FZ", "MX", "MY", "MZ"]);

// Cargas distribuidas: add_member_dist_load NO admite momentos distribuidos (guia
// §5.4), por eso el enum se restringe a fuerzas (FX/FY/FZ global, Fx/Fy/Fz local).
const DireccionDistSchema = z.enum(["FX", "FY", "FZ", "Fx", "Fy", "Fz"]);

// Cargas puntuales en barra: admiten fuerzas y momentos, global y local (guia §5.4
// add_member_pt_load). F1 solo emite globales, pero el contrato deja abierto el
// local para no rehacer el esquema en fases posteriores.
const DireccionPuntualSchema = z.enum([
  "FX", "FY", "FZ", "MX", "MY", "MZ",
  "Fx", "Fy", "Fz", "Mx", "My", "Mz",
]);

// --- Entidades de la Capa 2 --------------------------------------------------

export const NodoFEMSchema = z.object({
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type NodoFEM = z.infer<typeof NodoFEMSchema>;

export const MaterialFEMSchema = z.object({
  name: z.string().min(1),
  E: z.number(),
  G: z.number(),
  nu: z.number(),
  rho: z.number(),
  // fy opcional: PyNite lo acepta como None si no se aporta (guia §11.2).
  fy: z.number().optional(),
});
export type MaterialFEM = z.infer<typeof MaterialFEMSchema>;

export const SeccionFEMSchema = z.object({
  name: z.string().min(1),
  A: z.number(),
  Iy: z.number(),
  Iz: z.number(),
  J: z.number(),
});
export type SeccionFEM = z.infer<typeof SeccionFEMSchema>;

// releases: 12 flags en el orden EXACTO de def_releases (guia §5.3):
// [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj]. `null` = barra sin liberar.
const ReleasesSchema = z.array(z.boolean()).length(12).nullable();

export const MiembroFEMSchema = z.object({
  name: z.string().min(1),
  i: z.string().min(1),
  j: z.string().min(1),
  material: z.string().min(1),
  section: z.string().min(1),
  rotation: z.number(),
  tension_only: z.boolean(),
  comp_only: z.boolean(),
  releases: ReleasesSchema,
});
export type MiembroFEM = z.infer<typeof MiembroFEMSchema>;

export const ApoyoFEMSchema = z.object({
  node: z.string().min(1),
  DX: z.boolean(),
  DY: z.boolean(),
  DZ: z.boolean(),
  RX: z.boolean(),
  RY: z.boolean(),
  RZ: z.boolean(),
});
export type ApoyoFEM = z.infer<typeof ApoyoFEMSchema>;

export const CargaNodoFEMSchema = z.object({
  node: z.string().min(1),
  direction: DireccionNodoSchema,
  P: z.number(),
  case: z.string().min(1),
});
export type CargaNodoFEM = z.infer<typeof CargaNodoFEMSchema>;

export const CargaDistFEMSchema = z.object({
  member: z.string().min(1),
  direction: DireccionDistSchema,
  w1: z.number(),
  w2: z.number(),
  // x1/x2 = null -> toda la barra (guia §5.4: x1=None, x2=None por defecto).
  x1: z.number().nullable(),
  x2: z.number().nullable(),
  case: z.string().min(1),
});
export type CargaDistFEM = z.infer<typeof CargaDistFEMSchema>;

export const CargaPuntualFEMSchema = z.object({
  member: z.string().min(1),
  direction: DireccionPuntualSchema,
  P: z.number(),
  x: z.number(), // distancia local desde el extremo i
  case: z.string().min(1),
});
export type CargaPuntualFEM = z.infer<typeof CargaPuntualFEMSchema>;

export const ComboFEMSchema = z.object({
  name: z.string().min(1),
  // factores por hipotesis, p. ej. { D: 1.35, Q: 1.5 } (guia §5.5 add_load_combo).
  factors: z.record(z.string(), z.number()),
  // combo_tags opcional: agrupa combinaciones para filtrar en el analisis.
  combo_tags: z.array(z.string()).optional(),
});
export type ComboFEM = z.infer<typeof ComboFEMSchema>;

export const AnalisisFEMSchema = z.object({
  type: z.enum(["linear", "analyze", "PDelta", "modal"]),
  check_statics: z.boolean(),
});
export type AnalisisFEM = z.infer<typeof AnalisisFEMSchema>;

// --- Modelo FEM completo (salida del discretizador) --------------------------
export const ModeloFEMSchema = z.object({
  units: z.literal("kN-m"),
  nodes: z.array(NodoFEMSchema),
  materials: z.array(MaterialFEMSchema),
  sections: z.array(SeccionFEMSchema),
  members: z.array(MiembroFEMSchema),
  supports: z.array(ApoyoFEMSchema),
  node_loads: z.array(CargaNodoFEMSchema),
  dist_loads: z.array(CargaDistFEMSchema),
  pt_loads: z.array(CargaPuntualFEMSchema),
  combos: z.array(ComboFEMSchema),
  analysis: AnalisisFEMSchema,
});
export type ModeloFEM = z.infer<typeof ModeloFEMSchema>;
