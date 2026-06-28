// Generacion de COMBINACIONES de calculo (Capa 1 -> combos de la Capa 2).
// feature-13 (Cargas, hipotesis y combinaciones), T2.1.
//
// PURO: sin React, sin IO, sin Pyodide; ejecutable y testeable en Node. Solo
// importa de ../dominio (tipos) y ../biblioteca (coeficientes gamma) y del
// contrato FEM (tipo ComboFEM). Es el unico lugar que decide los combos del
// discretizador; `discretizar.ts` solo lo invoca.
//
// ALCANCE F1 (CLAUDE.md §15): hay UNA unica accion variable dominante (la
// sobrecarga de uso). NO hay concomitancia de varias variables, asi que NO entra
// el coeficiente de simultaneidad psi0 en los factores (eso es F2). Por tanto los
// combos se reducen a:
//   - ELU persistente:        1,35·(permanentes) + 1,50·(variables)
//   - ELS caracteristica:     1,00·(todas)
// Referencia: CTE DB-SE §4.2.2 (combinacion ELU persistente o transitoria) y
// §4.3.2 (combinacion ELS caracteristica). Como solo hay una variable, el termino
// SUM(psi0·Qk) de §4.2.2 desaparece (no hay variables concomitantes que ponderar).
//
// TRAZABILIDAD: los coeficientes gamma NO se escriben a mano aqui; se leen de
// `../biblioteca` (tabla `acciones.ts`, verificada contra CTE DB-SE Tabla 4.1),
// de modo que una correccion normativa sea un cambio de UN dato y no de codigo.

import type { Modelo } from "../dominio";
import { esHipotesisAutomatica } from "../dominio";
import { GAMMA_G_DESFAV, GAMMA_Q_DESFAV, GAMMA_ELS } from "../biblioteca";
import type { ComboFEM } from "./contratoFEM";

// Factor de mayoracion de una hipotesis en ELU persistente segun su tipo. En F1
// toda accion es DESFAVORABLE (gravitatoria que suma esfuerzo): permanente ->
// GAMMA_G_DESFAV (1,35), variable -> GAMMA_Q_DESFAV (1,50). La hipotesis de
// favorabilidad (GAMMA_G_FAV/GAMMA_Q_FAV) es de fases posteriores (envolventes).
function factorELU(tipo: "permanente" | "variable"): number {
  return tipo === "permanente" ? GAMMA_G_DESFAV : GAMMA_Q_DESFAV;
}

// Genera los combos del modelo: ELU persistente y ELS caracteristica.
//
// - `factors` mapea hipotesisId -> coeficiente. Se declaran EXPLICITAMENTE todas
//   las hipotesis (no se depende del "Combo 1" implicito de PyNite que toma factor
//   1 por defecto). Un modelo sin hipotesis produce dos combos con `factors` vacio
//   pero bien formados (el solver no calcula esfuerzo alguno, lo cual es correcto).
// - Determinismo byte a byte (CLAUDE.md §2): se itera las hipotesis ordenadas por
//   `id` (orden total estable, como el resto del discretizador), de modo que el
//   orden de insercion en `modelo.hipotesis` no altera la Capa 2.
// - Tags ["ELU"] / ["ELS"]: agrupan los combos para que el solver y los resultados
//   filtren por estado limite. Se mantienen como hasta ahora (los golden y la UI
//   los consumen por nombre y por tag).
export function generarCombos(modelo: Modelo): ComboFEM[] {
  const hipotesisOrdenadas = [...modelo.hipotesis].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const factoresELU: Record<string, number> = {};
  const factoresELS: Record<string, number> = {};
  for (const h of hipotesisOrdenadas) {
    // E4 (sin combo fantasma): la hipotesis AUTOMATICA de peso propio se persiste
    // SIEMPRE en el modelo, pero el discretizador solo emite sus cargas si
    // `incluirPesoPropio` esta activo. Con el flag OFF no genera carga alguna, asi
    // que su factor en los combos multiplicaria cero esfuerzo: es un termino inutil
    // que ensucia la Capa 2. Se EXCLUYE del combo cuando esta desactivada. Se
    // identifica por el predicado (flag), no por el id, para que no diverjan. La
    // hipotesis se factoriza como cualquier PERMANENTE (gamma_G) cuando si aporta.
    if (esHipotesisAutomatica(h) && !modelo.analisis.incluirPesoPropio) {
      continue;
    }
    factoresELU[h.id] = factorELU(h.tipo);
    factoresELS[h.id] = GAMMA_ELS;
  }

  return [
    { name: "ELU", factors: factoresELU, combo_tags: ["ELU"] },
    { name: "ELS", factors: factoresELS, combo_tags: ["ELS"] },
  ];
}
