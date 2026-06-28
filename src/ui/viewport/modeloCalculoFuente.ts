// modeloCalculoFuente: de donde sale el ModeloFEM (Capa 2) que dibuja el overlay
// "Ver modelo de calculo" (F2c). Dos fuentes, por prioridad:
//   1) resultadosStore.modeloFEM si es VIGENTE (hay un calculo del modelo actual): se
//      reutiliza sin rediscretizar.
//   2) si no, discretizar(modelo) PURO (sin solver): ok -> modeloFEM; !ok -> motivo en
//      lenguaje de obra para que el panel explique por que no se puede mostrar.
//
// discretizar es PURO y SINCRONO (CLAUDE.md Â§2/Â§7): NO es el solver, no instancia
// Pyodide; llamarlo en el hilo principal es correcto. Solo se llama cuando el toggle
// esta ENCENDIDO (activo), para no rediscretizar de balde en cada edicion.
//
// FAIL-SAFE (G4): si discretizar lanzara (payload inesperado), se devuelve
// "no-calculable" con un motivo generico en vez de romper la escena.
import { useSyncExternalStore } from "react";
import { modeloStore, resultadosStore } from "../../estado";
import { discretizar as discretizarReal } from "../../discretizador";
import type { ModeloFEM } from "../../discretizador";
import type { Modelo } from "../../dominio";

export type FuenteModeloCalculo =
  | { estado: "inactivo" } // toggle apagado: nada que mostrar (ni se discretiza)
  | { estado: "ok"; modeloFEM: ModeloFEM; origen: "resultados" | "discretizado" }
  | { estado: "no-calculable"; motivo: string };

// Funcion discretizar inyectable (DI) para test sin construir modelos calculables.
type DiscretizarFn = typeof discretizarReal;

// PURA: dadas las entradas (toggle, modelo, vigencia y modeloFEM de resultados), decide
// la fuente. Exportada para test; la version inyectable de discretizar permite probar
// las ramas sin armar modelos reales.
export function calcularFuenteModeloCalculo(
  activo: boolean,
  modelo: Modelo,
  resultadosVigente: boolean,
  modeloFEMResultados: ModeloFEM | null,
  discretizar: DiscretizarFn = discretizarReal,
): FuenteModeloCalculo {
  if (!activo) return { estado: "inactivo" };

  // 1) Reusar el ModeloFEM del ultimo calculo si corresponde al modelo actual.
  if (resultadosVigente && modeloFEMResultados) {
    return { estado: "ok", modeloFEM: modeloFEMResultados, origen: "resultados" };
  }

  // 2) Discretizar el modelo actual (puro). Fail-safe ante excepcion inesperada.
  try {
    const r = discretizar(modelo);
    if (r.ok) return { estado: "ok", modeloFEM: r.modeloFEM, origen: "discretizado" };
    const primero = r.errores.find((e) => e.severidad === "error") ?? r.errores[0];
    return {
      estado: "no-calculable",
      motivo: primero?.mensaje ?? "La obra todavía no se puede calcular.",
    };
  } catch {
    return {
      estado: "no-calculable",
      motivo: "No se pudo generar el modelo de cálculo.",
    };
  }
}

// Snapshot estable de las entradas de store (modelo, vigencia, modeloFEM de resultados)
// para useSyncExternalStore (identidad => no re-render si nada cambia).
function leerEntradas(): readonly [Modelo, boolean, ModeloFEM | null] {
  const r = resultadosStore.getState();
  return [modeloStore.getState().modelo, r.vigente, r.modeloFEM];
}
let cache = leerEntradas();
function getEntradas(): readonly [Modelo, boolean, ModeloFEM | null] {
  const actual = leerEntradas();
  if (actual[0] === cache[0] && actual[1] === cache[1] && actual[2] === cache[2]) {
    return cache;
  }
  cache = actual;
  return actual;
}
function suscribir(cb: () => void): () => void {
  const offM = modeloStore.subscribe((s) => s.modelo, cb);
  const offV = resultadosStore.subscribe((s) => s.vigente, cb);
  const offF = resultadosStore.subscribe((s) => s.modeloFEM, cb);
  return () => {
    offM();
    offV();
    offF();
  };
}

// Memo a nivel de MODULO compartido por los DOS consumidores (el overlay de escena y
// el panel HUD): con las mismas entradas devuelve EL MISMO objeto, asi `discretizar` se
// ejecuta UNA sola vez por estado (no una por componente) y la identidad es estable
// (evita el doble-computo del estilo T-cm-overlay-recompute). Singleton: vale para el
// unico viewport de F1/F2 (igual que snapCache; T-mosaico-1 lo revisara si hay mosaico).
// NOTA: este memo SIEMPRE usa el discretizar real; la version inyectable (DI) es solo
// para tests, que llaman a calcularFuenteModeloCalculo directamente (no via fuenteMemo).
let memoKey: readonly [boolean, Modelo, boolean, ModeloFEM | null] | null = null;
let memoVal: FuenteModeloCalculo | null = null;
function fuenteMemo(
  activo: boolean,
  modelo: Modelo,
  vigente: boolean,
  fem: ModeloFEM | null,
): FuenteModeloCalculo {
  if (
    memoKey &&
    memoKey[0] === activo &&
    memoKey[1] === modelo &&
    memoKey[2] === vigente &&
    memoKey[3] === fem
  ) {
    return memoVal!;
  }
  const val = calcularFuenteModeloCalculo(activo, modelo, vigente, fem);
  memoKey = [activo, modelo, vigente, fem];
  memoVal = val;
  return val;
}

// Hook reactivo: recomputa la fuente al cambiar el modelo, la vigencia/modeloFEM de
// resultados o el toggle. Solo discretiza cuando `activo` (el toggle del overlay), y una
// sola vez por estado gracias a fuenteMemo (compartido overlay + panel).
export function useFuenteModeloCalculo(activo: boolean): FuenteModeloCalculo {
  const [modelo, vigente, modeloFEMResultados] = useSyncExternalStore(
    suscribir,
    getEntradas,
    getEntradas,
  );
  return fuenteMemo(activo, modelo, vigente, modeloFEMResultados);
}
