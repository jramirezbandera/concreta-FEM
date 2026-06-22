// =============================================================================
// HELPER DEL PIPELINE de los golden tests (feature-6): obra (Capa 1) ->
// discretizar() -> motor (Pyodide/PyNite) -> ResultadosCalculo.
//
// Es el camino COMPLETO extremo a extremo que la red de seguridad verifica
// (CLAUDE.md §13). Falla con un MENSAJE CLARO si el discretizador devuelve
// {ok:false}: en un golden eso significa que la obra de un fixture quedo
// invalida (bug del fixture o regresion del discretizador), no un error de obra
// del usuario, asi que se levanta como error de test, no se traga.
//
// Separa el discretizador (puro, Node) del motor: un golden del DISCRETIZADOR
// (T1.1) puede usar solo `discretizarOExplotar` SIN arrancar Pyodide, evitando
// acoplar la red de seguridad al solver (I+D: "golden del discretizador
// independiente del worker").
// =============================================================================

import { discretizar } from "../../../src/discretizador/discretizar";
import type { ModeloFEM } from "../../../src/discretizador/contratoFEM";
import type { Modelo } from "../../../src/dominio";
import type { ResultadosCalculo } from "../../../src/solver/resultados";
import type { MotorGolden } from "./motor";

/**
 * Discretiza la obra y devuelve la Capa 2, o LANZA con los errores de obra
 * formateados si discretizar devuelve {ok:false}. Uso en golden: un fixture
 * valido SIEMPRE debe discretizar ok; si no, es un bug. Tambien util para los
 * golden del discretizador (T1.1) SIN motor.
 */
export function discretizarOExplotar(modelo: Modelo): ModeloFEM {
  const res = discretizar(modelo);
  if (!res.ok) {
    const detalle = res.errores
      .map((e) => `  - [${e.codigo}] ${e.mensaje} (elemento: ${e.elementoId})`)
      .join("\n");
    throw new Error(
      `discretizar() devolvio ok:false para un fixture golden (deberia ser valido):\n${detalle}`,
    );
  }
  return res.modeloFEM;
}

/**
 * Pipeline completo: discretiza la obra y la calcula con el motor compartido.
 * `motor` se obtiene una vez con `obtenerMotor()` (arnes/motor.ts) en un
 * beforeAll. Lanza con mensaje claro si la discretizacion falla; el motor valida
 * la salida con safeParse internamente.
 */
export function ejecutarPipeline(
  modelo: Modelo,
  motor: MotorGolden,
): ResultadosCalculo {
  const modeloFEM = discretizarOExplotar(modelo);
  return motor.calcular(modeloFEM);
}
