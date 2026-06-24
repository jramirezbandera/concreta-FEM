// CONTRATO DE RESULTADOS del motor (Capa 2 -> UI). Tipos + Zod de la salida que
// el glue Python (pynite_glue.py) serializa tras analyze() y que el solverClient
// devuelve a la app. El glue DEBE emitir exactamente estos nombres de campo: este
// fichero es la frontera Python<->TS y se valida con safeParse antes de cruzar a la UI.
//
// Patron identico a contratoFEM.ts: cada entidad un `...Schema`, el tipo via `z.infer`.
// Forma JSON PURA y serializable (sin numpy): el glue convierte ndarrays a listas
// (`.tolist()`) y escalares a `float(...)` antes de json.dumps (guia §11.3, §13.1.5).
//
// UNIDADES (sistema interno kN-m, CLAUDE.md §14):
//   desplazamientos DX/DY/DZ -> m ; giros RX/RY/RZ -> rad
//   reacciones FX/FY/FZ -> kN ; MX/MY/MZ -> kN·m
//   esfuerzos: axil/cortante -> kN ; momento/torsor -> kN·m ; flecha -> m
//   posiciones x de los arrays -> m (distancia local desde el extremo i)
import { z } from "zod";

// --- Estado del motor (worker Pyodide) ---------------------------------------
// Lo consume la UI (CLAUDE.md §7): habilitar "Calcular" solo en "listo", mostrar
// "cargando motor"/"calculando". Maquina de estados del ciclo de vida del worker.
export const EstadoMotorSchema = z.enum([
  "descargado", // worker sin arrancar; Pyodide aun no instanciado
  "cargando", // descargando/instalando Pyodide + numpy/scipy + PyNiteFEA
  "listo", // motor instalado y ocioso; admite calcular
  "calculando", // analyze() en curso
  // SOLO fallo de CARGA (FIX F5-7): el motor quedo inservible al arrancar y
  // error() expone el ErrorMotor{fase:"carga"}. Los fallos de CALCULO NO entran
  // aqui: se PROPAGAN por la excepcion de calcular() y el motor vuelve a "listo"
  // (un modelo malo es transitorio, no un estado del motor). El contrato vive en
  // la cabecera de worker.ts.
  "error",
]);
export type EstadoMotor = z.infer<typeof EstadoMotorSchema>;

// Error legible para la UI. `detalle` lleva el traceback/mensaje tecnico crudo de
// Python (no se muestra al arquitecto salvo modo avanzado); `mensaje` es el texto
// en lenguaje de obra. `fase` distingue fallo al cargar el motor vs. al calcular.
export const ErrorMotorSchema = z.object({
  fase: z.enum(["carga", "calculo"]),
  mensaje: z.string(), // texto legible para la UI
  detalle: z.string().optional(), // traceback/mensaje crudo de Python
});
export type ErrorMotor = z.infer<typeof ErrorMotorSchema>;

// --- Resultados por nodo -----------------------------------------------------
// Tuplas de 6 en el orden FIJO de los GDL de PyNite (guia §3.3 y §11.3), para
// cruzar Comlink como typed-array-friendly y mapear 1:1 a las tablas de la UI.
//   disp = [DX, DY, DZ, RX, RY, RZ]   (m, m, m, rad, rad, rad)
//   rxn  = [FX, FY, FZ, MX, MY, MZ]   (kN, kN, kN, kN·m, kN·m, kN·m)
const SeisComponentesSchema = z.array(z.number()).length(6);

// Resultado de UN nodo en UNA combinacion. El glue emite un objeto de estos por
// cada combo calculado (ver indexacion por combo en ResultadoNodo).
export const EstadoNodoComboSchema = z.object({
  disp: SeisComponentesSchema, // [DX,DY,DZ,RX,RY,RZ]
  rxn: SeisComponentesSchema, // [FX,FY,FZ,MX,MY,MZ] (0 en GDL no apoyados)
});
export type EstadoNodoCombo = z.infer<typeof EstadoNodoComboSchema>;

// Resultados de un nodo indexados por nombre de combinacion ("ELU","ELS"...),
// reflejando que en PyNite todo resultado es un dict {combo: valor} (guia §7).
export const ResultadoNodoSchema = z.record(z.string(), EstadoNodoComboSchema);
export type ResultadoNodo = z.infer<typeof ResultadoNodoSchema>;

// --- Resultados por barra ----------------------------------------------------
// Cada diagrama es la salida de un `*_array()`: forma (2, n_points) donde fila 0 =
// posiciones x (m, local desde i) y fila 1 = valor del esfuerzo (guia §7.2).
//
// FIX F5-6 (endurecer el borde, regla de oro #8): el esquema fija la FORMA real.
// `z.array(...).length(2)` exige EXACTAMENTE 2 filas (ni vacio, ni 1, ni 3); el
// `.refine()` exige que ambas filas tengan IGUAL longitud (n_points puntos cada
// una). No se cruza el valor `analysis.n_points` aqui porque Zod no comparte
// estado entre campos hermanos con facilidad; al menos garantizamos 2 filas
// alineadas, que es la invariante de los `*_array()` de PyNite. n_points es
// variable (de ahi number[][] y no tupla fija).
const DiagramaSchema = z
  .array(z.array(z.number()))
  .length(2) // exactamente [posiciones_x, valores]
  .refine(([xs, vs]) => xs.length === vs.length, {
    message: "Las dos filas del diagrama (posiciones x y valores) deben tener igual longitud",
  }); // (2, n_points)

// Deformada GLOBAL de la barra: desplazamiento por estacion a lo largo del eje,
// en el MISMO sistema global que nodos[].disp (ejes FEM, Y-up). Forma (3, n):
// fila 0 = DX[], fila 1 = DY[], fila 2 = DZ[]; n = n_points (igual que los
// diagramas *_array). Permite al render dibujar la FLECHA DEL VANO (curva), no una
// recta entre nudos. Invariante (lo blinda el golden de motor): estacion 0 == disp
// del nudo i; estacion n-1 == disp del nudo j (continuidad con nodos[].disp).
//
// Mismo patron/endurecimiento que DiagramaSchema: `.length(3)` exige EXACTAMENTE 3
// filas (DX/DY/DZ) y el `.refine()` que las tres tengan igual longitud (n puntos).
// n es variable (de ahi number[][] y no tupla fija).
const DeformadaSchema = z
  .array(z.array(z.number()))
  .length(3) // exactamente [DX[], DY[], DZ[]]
  .refine(
    ([dx, dy, dz]) =>
      // n >= 2: un tramo necesita al menos 2 estaciones. Un payload con n<2 (solver
      // roto) FALLA la validacion en el borde, en vez de colarse y degradar en silencio.
      dx.length >= 2 && dx.length === dy.length && dy.length === dz.length,
    {
      message:
        "La deformada global debe tener 3 filas (DX, DY, DZ) de igual longitud y >= 2 estaciones",
    },
  ); // (3, n>=2)

// Resultado de UNA barra en UNA combinacion. Diagramas minimos del MVP (axil,
// cortante Fy, momento Mz, flecha dy) + extremos para etiquetar picos sin recorrer
// el array en la UI. Nombres alineados con serialize_results de la guia §11.3.
export const EstadoMiembroComboSchema = z.object({
  axial: DiagramaSchema, // axil N(x), kN
  shear_y: DiagramaSchema, // cortante local Vy(x), kN
  moment_z: DiagramaSchema, // flector local Mz(x), kN·m
  defl_y: DiagramaSchema, // flecha local dy(x), m
  // Desplazamiento GLOBAL [DX[],DY[],DZ[]] por estacion (3, n_points). Mismo
  // sistema que nodos[].disp; estacion 0/n-1 coinciden con disp de los nudos i/j.
  deformada_global: DeformadaSchema,
  max_moment_z: z.number(), // pico positivo de Mz, kN·m
  min_moment_z: z.number(), // pico negativo de Mz, kN·m
  max_shear_y: z.number(), // pico positivo de Vy, kN
});
export type EstadoMiembroCombo = z.infer<typeof EstadoMiembroComboSchema>;

// Resultados de una barra indexados por nombre de combinacion (igual que nodos).
export const ResultadoMiembroSchema = z.record(z.string(), EstadoMiembroComboSchema);
export type ResultadoMiembro = z.infer<typeof ResultadoMiembroSchema>;

// --- Comprobacion de equilibrio (check_statics) ------------------------------
// Solo presente si el analisis se lanzo con check_statics=true (guia §6, §13.5).
// PyNite imprime el balance; el glue lo resume a un flag + residuos por combo para
// que la UI pueda avisar "el equilibrio no cierra" sin parsear texto.
export const CheckStaticsSchema = z.object({
  ejecutado: z.literal(true),
  equilibrio_ok: z.boolean(), // true si todos los residuos quedan bajo tolerancia
  // Residuo maximo de fuerza/momento por combinacion (suma reacciones - cargas).
  // Vacio o cercano a 0 indica equilibrio; util para mostrar el balance al usuario.
  residuos: z.record(
    z.string(),
    z.object({
      max_fuerza: z.number(), // mayor desbalance de fuerza, kN
      max_momento: z.number(), // mayor desbalance de momento, kN·m
    }),
  ),
});
export type CheckStatics = z.infer<typeof CheckStaticsSchema>;

// --- Tipo raiz: salida completa del motor ------------------------------------
// Lo que devuelve solverClient.calcular() a la app tras validar con safeParse.
// `nodos`/`barras` indexados por nombre ("N1","M1"), igual que los dicts de PyNite.
export const ResultadosCalculoSchema = z.object({
  units: z.literal("kN-m"), // metadato: confirma el sistema interno (CLAUDE.md §14)
  // Tipo de analisis realmente ejecutado (eco de ModeloFEM.analysis.type) y
  // n_points usado al muestrear los diagramas: la UI lo necesita para escalas.
  analysis: z.object({
    type: z.enum(["linear", "analyze", "PDelta", "modal"]),
    n_points: z.number().int().positive(),
  }),
  combos: z.array(z.string()).nonempty(), // combos calculados, en orden de emision
  nodos: z.record(z.string(), ResultadoNodoSchema), // "N1" -> resultados por combo
  barras: z.record(z.string(), ResultadoMiembroSchema), // "M1" -> resultados por combo
  // null cuando el analisis no se lanzo con check_statics (no se ejecuto la comprobacion).
  check_statics: CheckStaticsSchema.nullable(),
});
export type ResultadosCalculo = z.infer<typeof ResultadosCalculoSchema>;
