// CONTRATO DE RESULTADOS DEL CENTRO DE RIGIDEZ (CR) del motor (Capa 2 -> UI). Tipos +
// Zod de la salida FINAL que solverClient.calcularCR() devuelve a la app (y que guarda
// crStore). Se valida con safeParse antes de cruzar a la UI.
//
// REPARTO DE RESPONSABILIDAD (decision de arquitectura, ver plan F0.3/8A):
//   - El glue Python (`calcular_cr`) trabaja SOLO en ejes FEM y emite, por planta,
//     {x, y} = el CR en el plano horizontal FEM (X, Z), o null si no es determinable.
//     Por la convencion `mapearEjes` ([X,Y,Z]=[obra_x, cota, obra_y]) el plano horizontal
//     FEM coincide con obra por IDENTIDAD: cr_X == obra x, cr_Z == obra y. El glue NO
//     conoce ni obra ni CM (separacion limpia; regla de oro #1: PyNite solo calcula FEM).
//   - El lado TS (solverClient.calcularCR) RELLENA ex/ey a partir del centro de masas
//     PURO (calcularCentroMasaPlanta, obra) y ENSAMBLA este ResultadosCR final, que se
//     valida con este schema. La frontera Pyodide real (salida cruda del glue) se valida
//     aparte en el cliente.
//
// SEPARADO de ResultadosCalculo (resultados.ts) Y de ResultadosModales (resultadosModales.ts)
// A PROPOSITO: el CR es un calculo AUXILIAR (diafragma rigido por planta + cargas laterales
// unitarias), no un analisis por-combinacion ni una salida modal. Camino INDEPENDIENTE
// (decision 8A del plan): punto de entrada propio `calcular_cr`/`calcularCR`; el
// `ModeloFEM.analysis.type` normal NO gana "centroRigidez" (no se contamina el contrato
// por-combo). Contrato propio para no mezclar conceptos.
//
// METODO (resumen, ver el plan): por planta se fabrica un diafragma rigido, se aplican 3
// cargas unitarias (FX/FZ/MY en el nudo maestro) y se lee la respuesta (DX/DZ/RY) -> una
// flexibilidad 3x3 -> el "punto de giro cero" = centro de rigidez. PyNite es la unica fuente
// del calculo; la 3x3 es algebra trivial sobre sus salidas (regla de oro #1 intacta).
//
// UNIDADES (sistema interno kN-m, CLAUDE.md §14): x, y, ex, ey en METROS, en coordenadas de
// OBRA (replanteo: x,y de planta), NO la Y vertical del FEM. x/y los emite el glue (plano
// horizontal FEM, == obra por identidad); ex/ey los rellena el lado TS desde el CM.
import { z } from "zod";

// --- Centro de rigidez de UNA planta -----------------------------------------
// Cada entrada existe SIEMPRE por planta diafragmable (la clave del record es plantaId),
// para que la UI distinga "planta calculada" de "planta inexistente". Los cuatro campos son
// number|null:
//   x, y   -> coords de OBRA del CR (m). null = "no determinable" (planta degenerada: <3
//             nudos no colineales o sin rigidez torsional, Cθθ≈0). Van juntos: ambos number
//             o ambos null.
//   ex, ey -> excentricidad estructural CM - CR (m): ex = CM.x - CR.x, ey = CM.y - CR.y.
//             null si el CM de esa planta es null (sin masa) o si el CR es no determinable.
//
// `.nullish().transform(v => v ?? null)`: igual que check_statics en resultados.ts. Un valor
// Python `None` cruza Pyodide como `undefined` (clave ausente), no como `null`, asi que un
// `.nullable()` pelado se rompe; `.nullish()` acepta ambos y el transform los normaliza a
// `null`. `.finite()` ANTES del nullish: rechaza NaN/Infinity (defensa de borde; el glue ya
// los mapea a None, pero si uno se colara la UI dibujaria un CR "infinito").
const NumONull = z
  .number()
  .finite()
  .nullish()
  .transform((v) => v ?? null);

export const CentroRigidezPlantaSchema = z.object({
  x: NumONull, // obra x (m); null = no determinable
  y: NumONull, // obra y (m); null = no determinable
  ex: NumONull, // CM.x - CR.x (m); null si CM null o CR no determinable
  ey: NumONull, // CM.y - CR.y (m); null si CM null o CR no determinable
});
export type CentroRigidezPlanta = z.infer<typeof CentroRigidezPlantaSchema>;

// --- Tipo raiz: salida completa del analisis de centro de rigidez ------------
// Lo que devuelve solverClient.calcularCR() a la app tras validar con safeParse.
// `cr_por_planta` mapea plantaId -> su CR (o no determinable). La UI resuelve el nombre de
// la planta desde el Modelo vivo (como el modal resuelve nombres de nudo por id).
export const ResultadosCRSchema = z.object({
  units: z.literal("kN-m"), // metadato: confirma el sistema interno (CLAUDE.md §14)
  analysis: z.object({
    type: z.literal("centroRigidez"),
  }),
  cr_por_planta: z.record(z.string(), CentroRigidezPlantaSchema), // "p1" -> {x,y,ex,ey}
});
export type ResultadosCR = z.infer<typeof ResultadosCRSchema>;

// --- Salida CRUDA del glue (frontera Pyodide real) ---------------------------
// Lo que emite `calcular_cr` y materializa el worker: SOLO x/y por planta (el CR en
// el plano horizontal FEM = obra por identidad), SIN ex/ey. `solverClient.calcularCR`
// valida esto con safeParse en el borde Pyodide; luego `ensamblarResultadosCR` añade
// ex/ey (desde el CM puro) y produce el `ResultadosCR` final. La entrada de cada planta
// existe SIEMPRE (clave presente); x/y = number o null (null = no determinable,
// cond(K)>1e12). Mismo truco `.nullish()` que arriba: None Python cruza como undefined.
const CRGluePlantaSchema = z.object({
  x: NumONull,
  y: NumONull,
});

export const CRGlueSchema = z.object({
  units: z.literal("kN-m"),
  analysis: z.object({
    type: z.literal("centroRigidez"),
  }),
  cr_por_planta: z.record(z.string(), CRGluePlantaSchema),
});
export type CRGlue = z.infer<typeof CRGlueSchema>;
