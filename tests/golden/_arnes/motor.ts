// =============================================================================
// ARNES DEL MOTOR para los golden tests (feature-6) — ARRANQUE UNICO COMPARTIDO.
//
// PROBLEMA: arrancar Pyodide + numpy/scipy + PyNiteFEA cuesta ~7-9 s (medido en
// smoke.test.ts). Pagar eso por cada caso golden seria prohibitivo. SOLUCION: un
// modulo con la promesa de arranque CACHEADA a nivel de modulo. Vitest, por
// defecto, ejecuta cada fichero de test en su PROPIO worker/proceso aislado, asi
// que la cache de modulo se comparte entre los `it` de UN MISMO fichero, no entre
// ficheros. Para compartir entre ficheros, los golden tests T1.1/T1.2 deben
// CONCENTRARSE EN UN UNICO fichero (.test.ts) que importe este arnes, o ejecutar
// el proyecto node con `--pool=threads --poolOptions.threads.singleThread` /
// `fileParallelism:false` para reusar el mismo contexto. DECISION (documentada
// abajo): un solo fichero de pipeline golden + cache de modulo. Es la opcion mas
// simple y robusta; no acopla la config global de Vitest.
//
// FIX Q1 (DRY): la receta de arranque (loadPyodide local, loadPackage, instalar
// los wheels vendorizados con la URL file:// normalizada, runPythonAsync del glue,
// leer versiones y construir calcular() con safeParse en el borde) ya NO vive
// aqui: se extrajo al NUCLEO compartido ./pyodideNode (`arrancarMotorNode`), que
// tambien usa src/solver/smoke.test.ts. Este arnes SOLO aporta su politica de
// test: envolver el nucleo en ArranqueMotor {ok|skip+motivo} y cachear la promesa.
// =============================================================================

import {
  arrancarMotorNode,
  ErrorArranquePyodide,
  descr,
  TIMEOUT_ARRANQUE,
  type MotorArrancado,
  type VersionesRuntime,
} from "./pyodideNode";
import type { ResultadosCalculo } from "../../../src/solver/resultados";
import type { ResultadosModales } from "../../../src/solver/resultadosModales";
import type { ResultadosCR } from "../../../src/solver/resultadosCR";
import type { ModeloFEM } from "../../../src/discretizador/contratoFEM";
import type { PlantaInfoCR } from "../../../src/discretizador/modeloCR";

// Re-export: T1.1/T1.2 importan VersionesRuntime y el timeout desde el arnes.
export { TIMEOUT_ARRANQUE, type VersionesRuntime };

// -----------------------------------------------------------------------------
// API publica del arnes (otros tests dependen de ella: NO cambiar la forma).
// -----------------------------------------------------------------------------
export type MotorGolden = {
  /** Llama al glue calcular(modeloFEM) y devuelve ResultadosCalculo VALIDADO. */
  calcular(modeloFEM: ModeloFEM): ResultadosCalculo;
  /**
   * Camino MODAL: llama al glue (analysis.type:"modal") y devuelve ResultadosModales
   * VALIDADO contra ResultadosModalesSchema (no contra el por-combo). El golden modal
   * (Capa B) lo usa para asertar f1 ≈ analitico sin acoplarse al smoke de src/solver.
   */
  calcularModal(modeloFEM: ModeloFEM): ResultadosModales;
  /**
   * Camino CENTRO DE RIGIDEZ (F1.2): llama al glue `calcular_cr(payload, plantasInfo)`
   * y devuelve ResultadosCR VALIDADO con ResultadosCRSchema (salida cruda del glue:
   * solo {x,y} por planta; ex/ey null). Lo usa el golden del CR (F3.1, el GATE).
   */
  calcularCR(modeloFEM: ModeloFEM, plantasInfo: PlantaInfoCR[]): ResultadosCR;
  /** Versiones reales del runtime (re-asercion del par; CLAUDE.md §18). */
  versiones: VersionesRuntime;
};

// Resultado del arranque. Si falla por red/instalacion NO rompemos en rojo: el
// arnes expone `skip` + motivo para que el test marque SKIP con mensaje claro
// (mismo criterio que smoke.test.ts: distinguir "sin red" de un bug real).
export type ArranqueMotor =
  | { ok: true; motor: MotorGolden }
  | { ok: false; motivo: string };

// CACHE A NIVEL DE MODULO: la promesa se crea UNA vez; todas las llamadas la
// reusan. Comparte el motor entre los `it` del fichero que importe este modulo.
let arranquePromesa: Promise<ArranqueMotor> | null = null;

/**
 * Arranca el motor (idempotente): devuelve SIEMPRE la misma promesa cacheada, de
 * modo que el coste de ~7 s se paga una sola vez por proceso de test. Los golden
 * tests llaman `await obtenerMotor()` en un `beforeAll` y reusan `calcular`.
 */
export function obtenerMotor(): Promise<ArranqueMotor> {
  if (arranquePromesa === null) {
    arranquePromesa = arrancar();
  }
  return arranquePromesa;
}

async function arrancar(): Promise<ArranqueMotor> {
  let motor: MotorArrancado;
  try {
    motor = await arrancarMotorNode();
  } catch (e) {
    // El nucleo lanza ErrorArranquePyodide con la fase; cualquier otro error se
    // describe igual. Politica del arnes: SKIP con motivo, nunca rojo por red.
    const motivo =
      e instanceof ErrorArranquePyodide ? e.message : descr(e);
    return { ok: false, motivo };
  }
  // Exponemos {calcular, calcularModal, calcularCR, versiones} (la instancia py cruda
  // no es parte del contrato del arnes golden).
  return {
    ok: true,
    motor: {
      calcular: motor.calcular,
      calcularModal: motor.calcularModal,
      calcularCR: motor.calcularCR,
      versiones: motor.versiones,
    },
  };
}
