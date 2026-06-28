// CONTRATO DE RESULTADOS MODALES del motor (Capa 2 -> UI). Tipos + Zod de la salida
// que el glue Python (pynite_glue.py, rama `analyze_modal`) serializa y que el
// solverClient.calcularModal() devuelve a la app. El glue DEBE emitir exactamente
// estos nombres de campo: este fichero es la frontera Python<->TS del camino modal y
// se valida con safeParse antes de cruzar a la UI.
//
// SEPARADO de ResultadosCalculo (resultados.ts) A PROPOSITO: el analisis modal NO
// produce esfuerzos/reacciones por combinacion -> no encaja en el contrato por-combo.
// Modal es un camino INDEPENDIENTE (decision de alcance F2b): frecuencias propias +
// formas de vibracion por nudo. Contrato propio para no contaminar el por-combo.
//
// API real de PyNiteFEA 2.0.2 CONFIRMADA empiricamente (spike F2b, motor real):
//   - analyze_modal(num_modes, mass_combo_name, mass_direction, gravity, ...) devuelve
//     las frecuencias en `model.frequencies` (ndarray, YA en Hz: sqrt(lambda)/2pi),
//     orden ascendente.
//   - cada modo i (1-indexado) queda como un combo interno "Mode i"; los
//     desplazamientos por nudo se leen como cualquier combo: node.DX["Mode 1"], etc.
//   - NO hay reacciones por modo (node.RxnFY["Mode 1"] lanza KeyError) -> este
//     contrato NO incluye reacciones, solo desplazamientos.
//
// Forma JSON PURA y serializable (sin numpy): el glue convierte el ndarray de
// frecuencias a lista (`[float(x) for x in m.frequencies]`) y cada GDL a `float(...)`
// antes de json.dumps (guia §11.3, §13.1.5).
//
// UNIDADES (sistema interno kN-m, CLAUDE.md §14):
//   frecuencias -> Hz (1/s) ; desplazamientos modales DX/DY/DZ -> m ; giros RX/RY/RZ
//   -> rad. Las amplitudes modales vienen normalizadas a masa modal unitaria (signo y
//   escala arbitrarios); la UI las renormaliza para dibujar.
import { z } from "zod";

// --- Forma modal de un nudo --------------------------------------------------
// Tupla de 6 en el orden FIJO de los GDL de PyNite (igual que disp en resultados.ts):
//   [DX, DY, DZ, RX, RY, RZ]   (m, m, m, rad, rad, rad)
// `z.tuple` (no `z.array().length(6)`) para fijar el tipo a una tupla de 6 numeros:
// asi la UI indexa por posicion con tipos exactos. La amplitud es relativa
// (normalizada a masa modal unitaria), no un desplazamiento fisico absoluto.
// `.finite()` (rechaza NaN E Infinity): defensa en profundidad del borde. El glue ya
// filtra los modos no finitos (serialize_results_modal), pero si uno se colara, un
// `z.number()` pelado ACEPTA Infinity y la UI dibujaria un GDL "infinito"; con
// `.finite()` el safeParse falla limpio en vez de propagar un artefacto numerico.
const SeisGdlSchema = z.tuple([
  z.number().finite(), // DX
  z.number().finite(), // DY
  z.number().finite(), // DZ
  z.number().finite(), // RX
  z.number().finite(), // RY
  z.number().finite(), // RZ
]);

// --- Un modo de vibracion ----------------------------------------------------
// `numero` = indice 1-indexado del modo (== combo interno "Mode N" de PyNite).
// `frecuencia` = la misma de `frecuencias[numero-1]` (redundante pero comodo para la
// UI: cada modo lleva su Hz sin cruzar el indice). `nodos` mapea nombre de nudo ->
// su forma modal (6 GDL). SIN reacciones (modal no las tiene; ver cabecera).
export const ModoSchema = z.object({
  numero: z.number().int().positive(), // 1, 2, 3, ... (contiguo tras el saneo del glue)
  frecuencia: z.number().finite(), // Hz; == frecuencias[numero-1] (no NaN/Inf)
  nodos: z.record(z.string(), SeisGdlSchema), // "N1" -> [DX,DY,DZ,RX,RY,RZ]
});
export type Modo = z.infer<typeof ModoSchema>;

// --- Tipo raiz: salida completa del analisis modal ---------------------------
// Lo que devuelve solverClient.calcularModal() a la app tras validar con safeParse.
//
// NOTA sobre `.nullish().transform(...)`: ResultadosCalculo SI lo necesita en
// `check_statics` porque ese campo puede ser Python `None` (P-Δ/modal lo fuerzan a
// false) y `None` cruza Pyodide como `undefined` (clave ausente), no como `null`, lo
// que rompe un `.nullable()`. AQUI NO hace falta: el contrato modal no tiene campos
// opcionales/None que crucen el borde -tras un analisis exitoso, frecuencias y
// desplazamientos son SIEMPRE numeros-, asi que todos los campos son obligatorios y
// numericos. Si en el futuro se anade algun campo derivable que pueda faltar (p. ej.
// masa participante), revisar ese truco entonces.
export const ResultadosModalesSchema = z.object({
  units: z.literal("kN-m"), // metadato: confirma el sistema interno (CLAUDE.md §14)
  // Eco del analisis ejecutado. `num_modes` = nº de modos REALMENTE calculados
  // (== len(frecuencias)); puede ser < el pedido si la estructura tiene menos GDL.
  // nonnegative (no positive): una estructura degenerada podria dar 0 modos; el
  // borde no debe rechazar ese caso (lo gestiona el error-path del glue/UI).
  analysis: z.object({
    type: z.literal("modal"),
    num_modes: z.number().int().nonnegative(),
  }),
  // Frecuencias propias en Hz, orden ascendente. PyNite las entrega YA en Hz
  // (sqrt(lambda)/2pi): el glue NO divide por 2pi. Array (no tupla): el nº de modos
  // es variable.
  frecuencias: z.array(z.number().finite()),
  // Un objeto por modo, en el mismo orden que `frecuencias` (modos[k] <-> frecuencias[k]).
  modos: z.array(ModoSchema),
});
export type ResultadosModales = z.infer<typeof ResultadosModalesSchema>;
