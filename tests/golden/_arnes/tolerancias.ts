// =============================================================================
// POLITICA DE TOLERANCIAS de los golden tests (feature-6) + formato del CASO
// GOLDEN. La red de seguridad del producto compara el pipeline real (obra ->
// discretizar -> PyNite/Pyodide) contra FORMULA CERRADA VERIFICADA (CLAUDE.md
// §13, I+D #9). Este modulo es la FUENTE UNICA de los umbrales y del contrato del
// caso; T1.1 (golden del discretizador) y T1.2 (asserts numericos del pipeline)
// los consumen, NO redefinen sus propios numeros.
//
// POR QUE ESTOS VALORES (no son arbitrarios):
//  - Esfuerzos y reacciones (M, V, N, R): magnitudes que en estructuras
//    ISOSTATICAS no dependen de E/I y que PyNite resuelve por equilibrio exacto.
//    El unico error es el de coma flotante WASM + muestreo del diagrama. El smoke
//    test (src/solver/smoke.test.ts) mide err = 0.00% en M y R de la biapoyada
//    UDL. Margen del producto: < 0,1 % relativo (I+D #9).
//  - Flechas (deformada): mas sensibles. Dependen de E·I, del numero de puntos de
//    muestreo del diagrama de flecha (n_points) y de la discretizacion en barras.
//    Una viga modelada como UNA sola barra muestrea la flecha en n_points
//    estaciones; el pico real puede caer entre dos. Margen del producto: < 1 %
//    relativo (I+D #9).
//
// SI UN GOLDEN FALLA por encima de tolerancia: el bug esta en el DISCRETIZADOR o
// en UNIDADES, NUNCA en la formula (estan verificadas con 0 errores de
// coeficiente, I+D #9). No se afloja la tolerancia ni se "ajusta" la formula para
// que pase (antipatron explicito del proyecto).
// =============================================================================

import type { Modelo } from "../../../src/dominio";

// -----------------------------------------------------------------------------
// UMBRALES (relativos salvo el piso absoluto). Relativo = |real - teorico| /
// |teorico|. Cuando |teorico| ~ 0 (p.ej. un cortante nulo en el centro), el error
// relativo se dispara; por eso cada comparacion admite ademas un PISO ABSOLUTO:
// si |real| y |teorico| caen por debajo de el, se considera "cero numerico" y la
// comparacion pasa. T1.2 usara `dentroDeTolerancia` que combina ambos.
// -----------------------------------------------------------------------------

/** Tolerancia RELATIVA para esfuerzos (M, V, N) y reacciones. < 0,1 % (I+D #9). */
export const TOL_REL_ESFUERZOS = 1e-3; // 0,1 %

/** Tolerancia RELATIVA para reacciones de apoyo. Mismo nivel que esfuerzos. */
export const TOL_REL_REACCIONES = 1e-3; // 0,1 %

/** Tolerancia RELATIVA para flechas/deformada. < 1 % (I+D #9). */
export const TOL_REL_FLECHAS = 1e-2; // 1 %

/**
 * Piso ABSOLUTO de esfuerzos/reacciones (kN, kN·m). Magnitudes por debajo se
 * tratan como cero numerico (residuo de equilibrio WASM). Holgado respecto al
 * residuo real del solver (el smoke test cierra equilibrio con residuos ~0) pero
 * suficiente para no exigir error relativo contra un teorico nulo.
 */
export const PISO_ABS_ESFUERZOS = 1e-6; // kN / kN·m

/**
 * Piso ABSOLUTO de flechas (m). 1e-9 m = 1 nm: por debajo, la flecha es "cero" a
 * efectos del muestreo y del solver. Evita exigir < 1 % contra un teorico nulo.
 */
export const PISO_ABS_FLECHAS = 1e-9; // m

// -----------------------------------------------------------------------------
// COMPARADOR (lo usaran T1.1/T1.2). Combina tolerancia relativa con piso
// absoluto: pasa si |real - teorico| <= tolRel·|teorico|, o si AMBOS quedan bajo
// el piso absoluto (cero numerico). Devuelve el detalle para mensajes ricos.
// -----------------------------------------------------------------------------

export type ResultadoComparacion = {
  ok: boolean;
  real: number;
  teorico: number;
  errAbs: number;
  errRel: number; // |real-teorico|/|teorico|; Infinity si teorico==0 y real!=0
};

/**
 * Compara `real` contra `teorico` con tolerancia relativa + piso absoluto. NO
 * lanza: devuelve un objeto para que el test produzca un mensaje en lenguaje de
 * verificacion (p.ej. "M_max real=44.97 teorico=45.00 err=0.07%").
 */
export function compararConTolerancia(
  real: number,
  teorico: number,
  tolRel: number,
  pisoAbs: number,
): ResultadoComparacion {
  const errAbs = Math.abs(real - teorico);
  // Cero numerico: ambos despreciables -> pasa sin exigir error relativo.
  if (Math.abs(teorico) <= pisoAbs && Math.abs(real) <= pisoAbs) {
    return { ok: true, real, teorico, errAbs, errRel: 0 };
  }
  const errRel = teorico === 0 ? Infinity : errAbs / Math.abs(teorico);
  // Pasa por error relativo, o por error absoluto bajo el piso (cubre teorico~0).
  const ok = errRel <= tolRel || errAbs <= pisoAbs;
  return { ok, real, teorico, errAbs, errRel };
}

/** Atajo para esfuerzos (M, V, N): tolerancia + piso de esfuerzos. */
export function compararEsfuerzo(real: number, teorico: number): ResultadoComparacion {
  return compararConTolerancia(real, teorico, TOL_REL_ESFUERZOS, PISO_ABS_ESFUERZOS);
}

/** Atajo para reacciones de apoyo. */
export function compararReaccion(real: number, teorico: number): ResultadoComparacion {
  return compararConTolerancia(real, teorico, TOL_REL_REACCIONES, PISO_ABS_ESFUERZOS);
}

/** Atajo para flechas/deformada. */
export function compararFlecha(real: number, teorico: number): ResultadoComparacion {
  return compararConTolerancia(real, teorico, TOL_REL_FLECHAS, PISO_ABS_FLECHAS);
}

// -----------------------------------------------------------------------------
// FORMATO DEL "CASO GOLDEN". Estructura comun que T1.1/T1.2 instanciaran: una
// obra de Capa 1 (la ENTRADA, via fixtures), un combo a verificar y un conjunto
// de magnitudes esperadas con su formula cerrada y su categoria de tolerancia.
//
// AQUI SOLO SE DEFINE EL TIPO. Los valores numericos esperados (los `teorico`)
// los rellena T1.2 a partir de las formulas verificadas de I+D #9; este modulo
// no fija ningun numero de un caso concreto (separacion infraestructura/asserts).
// -----------------------------------------------------------------------------

/** Categoria de tolerancia de una magnitud esperada (elige el umbral). */
export type CategoriaTolerancia = "esfuerzo" | "reaccion" | "flecha";

/**
 * Una magnitud esperada dentro de un caso golden: nombre legible (para el
 * mensaje), valor teorico de formula cerrada, y la categoria que decide su
 * tolerancia. `extraer` la rellena T1.2: dado el ResultadosCalculo del pipeline,
 * devuelve el valor REAL a comparar (p.ej. |min_moment_z| de la barra M1).
 */
export type MagnitudEsperada = {
  /** Etiqueta legible, p.ej. "M_max (centro)" o "R_izq". */
  nombre: string;
  /** Valor teorico por formula cerrada verificada (I+D #9). Lo fija T1.2. */
  teorico: number;
  /** Categoria de tolerancia: selecciona el umbral aplicable. */
  categoria: CategoriaTolerancia;
};

/**
 * Caso golden del PIPELINE: una obra (Capa 1) + el combo a inspeccionar + las
 * magnitudes esperadas. T1.2 lo construye con un fixture y las formulas; el arnes
 * de pipeline lo ejecuta y compara cada magnitud con su categoria de tolerancia.
 */
export type CasoGolden = {
  /** Nombre del caso (aparece en el `describe`/`it`). */
  nombre: string;
  /** Obra de Capa 1 a discretizar y calcular (de una factoria de fixtures). */
  modelo: Modelo;
  /** Combo del que se leen los resultados ("ELU" | "ELS" | ...). */
  combo: string;
  /** Magnitudes esperadas con su formula cerrada y su categoria de tolerancia. */
  magnitudes: MagnitudEsperada[];
};

/** Selecciona el comparador segun la categoria de tolerancia de la magnitud. */
export function compararPorCategoria(
  categoria: CategoriaTolerancia,
  real: number,
  teorico: number,
): ResultadoComparacion {
  switch (categoria) {
    case "esfuerzo":
      return compararEsfuerzo(real, teorico);
    case "reaccion":
      return compararReaccion(real, teorico);
    case "flecha":
      return compararFlecha(real, teorico);
  }
}
