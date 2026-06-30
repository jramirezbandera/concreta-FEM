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
  // num_modes: nº de modos propios a calcular. SOLO aplica con type:"modal" (el glue
  // lo pasa a analyze_modal); en los demas analisis se omite. Opcional para no romper
  // el contrato de los analisis estaticos (linear/analyze/PDelta) que no lo llevan.
  // La masa modal la FABRICA el glue (add_member_self_weight + gravity=9.81), por eso
  // NO hay aqui mass_combo/mass_direction: no se emite ningun combo de masa en Capa 2.
  num_modes: z.number().int().positive().optional(),
});
export type AnalisisFEM = z.infer<typeof AnalisisFEMSchema>;

// --- Trazabilidad obra (Capa 1) <-> ids FEM (Capa 2) -------------------------
// Mapa derivado por discretizar() junto al ModeloFEM. Es la FUENTE UNICA que la UI
// de Resultados (feature-14) usa para (a) dibujar la deformada sobre la obra y (b)
// mapear el elemento de obra seleccionado a su `member` FEM para los diagramas.
// NO es entrada que validar (es salida derivada del propio discretizador, ya
// determinista), por eso es un `interface` puro y no un schema Zod: sigue el
// patron del fichero (tipos puros) sin pagar el coste de una validacion de algo
// que el codigo construye con invariantes propias. PURA: sin React/IO/Pyodide.
export interface Trazabilidad {
  // pilar (obra) -> sus barras FEM en orden pie->cabeza. Un pilar pasante por varias
  // plantas se trocea en varios `member`; el array los lista de menor a mayor cota.
  pilarAMembers: Record<string, string[]>;
  // viga (obra) -> su barra FEM. En F1 una viga = un solo member.
  vigaAMember: Record<string, string>;
  // pilar con vinculacionExterior -> nodo FEM de su arranque (el pie, cota menor).
  // Solo aparecen los pilares que generan apoyo; util para dibujar reacciones.
  pilarANodoArranque: Record<string, string>;
  // nudo de obra (usado por alguna viga) -> nodo FEM donde se localiza.
  nudoANodo: Record<string, string>;
  // nombre de nudo FEM (p.ej. "N3") -> plantaId al que pertenece. Mapea TODOS los
  // nudos FEM estructurales (cabezas/pies de pilar, nudos intermedios de troceo y
  // extremos de viga), no solo los extremos de viga: TODO nudo de `nodes` tiene
  // entrada. Es la asignacion AUTORITATIVA derivada del CONTEXTO DE CREACION de cada
  // nudo (la planta declarada de la viga; la planta de la cota para los nudos de
  // pilar), NO el heuristico de cargas `localizarNodoDeNudo` (que es nodoFEM->load,
  // por primera viga). La consume F2 (centro de rigidez) para construir el diafragma
  // rigido POR PLANTA: agrupa los nudos de cada planta para atarlos a su nudo maestro.
  nodoFEMAPlanta: Record<string, string>;

  // --- Procedencia de la MALLA de paños (F3, decision 2A) --------------------
  // Mapas que marcan que parte de la Capa 2 NACE de la malla de un paño (losa), para
  // que las vistas de resultados (F2.4) NO se inunden con los nudos/apoyos/quads de
  // borde de la malla: la TablaReacciones agrega o filtra los apoyos de malla, y los
  // overlays nodales ignoran sus nudos. Son SALIDA derivada (no entrada que validar),
  // por eso son campos del interface, no schema Zod. Vacios cuando no hay paños (un
  // portico de barras no toca nada de esto: regresion byte-a-byte de la Capa 2).

  // pano (obra) -> nombres de sus quads FEM (en el orden determinista del mallado).
  panoAQuads: Record<string, string[]>;
  // quad FEM (p.ej. "PQ0-Q3") -> el pano de obra que lo genero (mapa inverso).
  quadAPano: Record<string, string>;
  // quad FEM -> sus 4 nudos en orden canonico [i,j,m,n] (CCW desde +Y). La UI de
  // isovalores promedia el valor por-quad a los nudos usando este mapa.
  quadANodos: Record<string, [string, string, string, string]>;
  // Nombres de nudos FEM creados por la MALLA de algun paño (NO estructurales: no son
  // cabezas/pies de pilar ni extremos de viga). La UI los excluye de las vistas nodales.
  nodosDeMalla: string[];
  // Nombres de nudos FEM que tienen un apoyo PROCEDENTE de la malla (borde del paño o
  // estabilizacion en el plano). La TablaReacciones (F2.4) los agrega/oculta para no
  // inundar la tabla con las reacciones de borde de la losa.
  apoyosDeMalla: string[];
}

// Trazabilidad VACIA (todos los mapas/listas a su valor neutro). Factoria canonica
// para los call sites que necesitan una `Trazabilidad` valida sin datos (tests, y la
// base FEM antes de poblar). Tenerla aqui evita que cada literal tenga que enumerar
// los campos (y se rompa al anadir uno nuevo, como ocurrio con la procedencia de
// malla de F3). PURA.
export function trazabilidadVacia(): Trazabilidad {
  return {
    pilarAMembers: {},
    vigaAMember: {},
    pilarANodoArranque: {},
    nudoANodo: {},
    nodoFEMAPlanta: {},
    panoAQuads: {},
    quadAPano: {},
    quadANodos: {},
    nodosDeMalla: [],
    apoyosDeMalla: [],
  };
}

// --- Placas (F3): cuadrilatero de losa ---------------------------------------
// QuadFEM: placa cuadrilatera de 4 nudos en orden CANONICO i->j->m->n en sentido
// ANTIHORARIO visto desde +Y (la vertical). PyNite la crea con
// add_quad(name, i, j, m, n, t, material). EL ORDEN DE NUDOS FIJA LOS EJES LOCALES de la
// placa: es la fuente de consistencia de Mx/My entre quads adyacentes (imprescindible para
// promediar a nudos en los isovalores). `t` = espesor (m). El material se referencia por
// nombre (mismo catalogo E/G/nu/rho que las barras): el espesor va en el quad, no en
// SeccionFEM (que es 1D).
export const QuadFEMSchema = z.object({
  name: z.string().min(1),
  i: z.string().min(1),
  j: z.string().min(1),
  m: z.string().min(1),
  n: z.string().min(1),
  t: z.number().positive(), // espesor (m)
  material: z.string().min(1),
});
export type QuadFEM = z.infer<typeof QuadFEMSchema>;

// Carga de presion superficial sobre un quad (F3). `presion` en kN/m2, PERPENDICULAR a la
// placa. SIGNO (verificado contra el motor real, OPUESTO a la FY de barras): con el orden de
// nudos i->j->m->n CCW, una presion POSITIVA empuja la placa hacia ABAJO (gravedad: presion
// +q -> DY_centro < 0). Por eso el peso propio y las cargas gravitatorias se emiten con signo
// POSITIVO. Esto, con el orden de nudos canonico, evita que Mx/My se inviertan. PyNite:
// add_quad_surface_pressure(quad, presion, case).
export const CargaQuadFEMSchema = z.object({
  quad: z.string().min(1),
  presion: z.number(), // kN/m2 (perpendicular a la placa; gravedad = POSITIVA hacia abajo)
  case: z.string().min(1),
});
export type CargaQuadFEM = z.infer<typeof CargaQuadFEMSchema>;

// --- Modelo FEM completo (salida del discretizador) --------------------------
// `quads`/`quad_loads` son OPCIONALES (F3): el discretizador los emite SOLO cuando hay
// paños. Un modelo de barras (sin paños) NO lleva esas claves -> la Capa 2 de un portico es
// IDENTICA a antes (regresion: byte-a-byte sin claves nuevas), y los sitios que construyen
// un `ModeloFEM` sin placas siguen tipando (no es `.default`, que volveria la clave
// obligatoria en el tipo de salida y romperia esos literales). Los consumidores leen
// `quads ?? []`.
export const ModeloFEMSchema = z.object({
  units: z.literal("kN-m"),
  nodes: z.array(NodoFEMSchema),
  materials: z.array(MaterialFEMSchema),
  sections: z.array(SeccionFEMSchema),
  members: z.array(MiembroFEMSchema),
  quads: z.array(QuadFEMSchema).optional(),
  supports: z.array(ApoyoFEMSchema),
  node_loads: z.array(CargaNodoFEMSchema),
  dist_loads: z.array(CargaDistFEMSchema),
  pt_loads: z.array(CargaPuntualFEMSchema),
  quad_loads: z.array(CargaQuadFEMSchema).optional(),
  combos: z.array(ComboFEMSchema),
  analysis: AnalisisFEMSchema,
});
export type ModeloFEM = z.infer<typeof ModeloFEMSchema>;
