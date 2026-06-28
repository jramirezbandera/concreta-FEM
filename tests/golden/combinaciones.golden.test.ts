// =============================================================================
// GOLDEN del PIPELINE para las COMBINACIONES F1 (feature-13, T3.2).
//
// RIESGO QUE CUBRE (spec feature-13): "el error de coeficiente de combinacion es
// SILENCIOSO -> cubrir con tests NUMERICOS". Un 1,35 que se cuele como 1,5 (o un
// 1,5 que se aplique a la permanente) no rompe nada: el solver corre, devuelve
// numeros plausibles y el portico "calcula". Solo un golden que compare el
// esfuerzo combinado contra la formula cerrada con los coeficientes EXACTOS lo
// caza. Esta es la red mas barata contra ese fallo.
//
// QUE ANADE sobre lo ya existente:
//  - pipeline.golden.test.ts (T1.2) ya verifica ELU como 1,35·G con UNA sola
//    hipotesis permanente (factor escalar). AQUI metemos DOS hipotesis (g
//    permanente + q variable) sobre la MISMA viga, de modo que ELU debe MEZCLAR
//    1,35·g + 1,50·q (no un unico factor). Es el caso que distingue un 1,35
//    correcto de un 1,5 espurio aplicado a todo.
//  - combinaciones.test.ts (unit) ya verifica los `factors` de `generarCombos` en
//    aislamiento. AQUI los verificamos como parte del PIPELINE real (obra ->
//    discretizar -> Capa 2) y, ademas, el efecto NUMERICO de esos factores en el
//    momento que devuelve PyNite.
//  - acciones.test.ts ya verifica `categoriaUso(cat).qk` exhaustivamente por
//    categoria. AQUI NO se duplica: solo se anade el angulo "pipeline/combo" (que
//    una sobrecarga variable de magnitud qk se mayora por 1,50 en ELU a traves del
//    generarCombos REAL). OJO: el CABLEADO categoria -> grupo.sobrecargaUso NO vive
//    en el pipeline, sino en el dialogo de grupos (DialogoGruposYPlantas); esa parte
//    se prueba en su test de componente, no aqui. Este golden solo ejercita los
//    FACTORES de combinacion (que es lo unico que el pipeline decide).
//
// PIRAMIDE (igual que el resto de golden):
//  - CAPA A (SIEMPRE, sin Pyodide): estructura de los combos generados + factores
//    por hipotesis. Node puro, instantaneo.
//  - CAPA B (motor PyNite real, con SKIP si no hay runtime): el momento combinado
//    end-to-end contra la formula cerrada. Mismo arnes y mismas tolerancias que
//    pipeline.golden.test.ts; arranque de motor compartido (obtenerMotor cachea).
//
// CONVENCION DE SIGNO (feature-5): UDL gravitatoria (FY global negativa) sobre
// barra en +X -> Mz NEGATIVO; el pico de magnitud vive en `min_moment_z`. Se
// compara contra |min_moment_z|. Mapeo de ejes / inercia que gobierna la flecha:
// ver cabecera de pipeline.golden.test.ts (no se repite aqui).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import {
  obtenerMotor,
  TIMEOUT_ARRANQUE,
  discretizarOExplotar,
  fixtureBiapoyadaUDL,
  compararEsfuerzo,
  compararFlecha,
  type ArranqueMotor,
  type ResultadoComparacion,
} from "./_arnes";
import type { Modelo } from "../../src/dominio";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import type { ResultadosCalculo } from "../../src/solver/resultados";
import { discretizar } from "../../src/discretizador/discretizar";
import { generarCombos } from "../../src/discretizador/combinaciones";
import { categoriaUso } from "../../src/biblioteca";

// --- Constantes de material/seccion del fixture (S275 + IPE300), ver pipeline --
// E (S275) = 2.1e8 kN/m²; Iz (IPE300, eje que gobierna la flexion vertical de
// estas vigas) = 6.038e-5 m⁴. Necesarias para la flecha caracteristica (ELS).
const E_ACERO = 2.1e8; // kN/m²
const IZ_IPE300 = 6.038e-5; // m⁴

// Ids de hipotesis REALES sembradas por crearModeloVacio() (src/dominio/helpers):
// la permanente "cargas muertas" (factor 1,35 en ELU) y la variable "sobrecarga de
// uso" (factor 1,50 en ELU). Usar los ids reales ata el golden al modelo de produccion.
const HIP_PERMANENTE = { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente" as const, automatica: false };
const HIP_VARIABLE = { id: "hip-sobrecarga-uso", nombre: "Sobrecarga de uso", tipo: "variable" as const, automatica: false };

// -----------------------------------------------------------------------------
// FIXTURE local: biapoyada con DOS cargas lineales sobre la MISMA viga, una en la
// hipotesis PERMANENTE (g) y otra en la VARIABLE (q). Se parte del fixture
// biapoyado canonico (geometria, pilares empotrados, viga biarticulada) y se
// SUSTITUYEN hipotesis+cargas por las dos hipotesis F1 reales con su carga. Asi:
//   - ELU = 1,35·g + 1,50·q   -> M_ELU = (1,35·g + 1,50·q)·L²/8
//   - ELS = 1,00·g + 1,00·q   -> M_ELS = (g + q)·L²/8
// La viga sigue siendo biapoyada (M=wL²/8 por hipotesis y, por linealidad, el
// combo escala/mezcla esos momentos). NO se toca el discretizador ni los fixtures
// del arnes: este fixture vive solo en el test.
// -----------------------------------------------------------------------------
function fixtureBiapoyadaDosHipotesis({
  L,
  g,
  q,
  cota = 3,
}: {
  L: number;
  g: number;
  q: number;
  cota?: number;
}): Modelo {
  const base = fixtureBiapoyadaUDL({ L, q: g, cota }); // geometria + 1 viga "viga"
  return {
    ...base,
    hipotesis: [HIP_PERMANENTE, HIP_VARIABLE],
    cargas: [
      // g sobre la viga en la hipotesis PERMANENTE.
      { id: "cg", tipo: "lineal", ambito: "viga", valor: g, hipotesisId: HIP_PERMANENTE.id },
      // q sobre la MISMA viga en la hipotesis VARIABLE.
      { id: "cq", tipo: "lineal", ambito: "viga", valor: q, hipotesisId: HIP_VARIABLE.id },
    ],
  };
}

// Helper de assert (mismo patron que pipeline.golden.test.ts): mensaje real vs
// teorico claro, sin aflojar la tolerancia (si falla, el bug es del pipeline/combo).
function assertOk(c: ResultadoComparacion, etiqueta: string): void {
  const msg =
    `${etiqueta}: real=${c.real} teorico=${c.teorico} ` +
    `errAbs=${c.errAbs.toExponential(3)} errRel=${(c.errRel * 100).toFixed(4)}%`;
  expect(c.ok, msg).toBe(true);
}

// Pico de |min_moment_z| (flector gravitatorio) entre TODAS las barras de un combo.
// En la biapoyada lo lleva la viga; los pilares de apoyo van a ~0. Independiente de
// como se localice la viga: barre y se queda con el mayor |min_moment_z|.
function picoMomentoNegativo(res: ResultadosCalculo, combo: string): number {
  let pico = 0;
  for (const porCombo of Object.values(res.barras)) {
    const v = porCombo[combo];
    if (v && Math.abs(v.min_moment_z) > pico) pico = Math.abs(v.min_moment_z);
  }
  return pico;
}

// Flecha vertical extrema (descenso) entre todos los puntos de defl_y de un combo.
function flechaMaxDescenso(res: ResultadosCalculo, combo: string): number {
  let dmin = 0;
  for (const porCombo of Object.values(res.barras)) {
    const v = porCombo[combo];
    if (!v) continue;
    for (const d of v.defl_y[1]) if (d < dmin) dmin = d;
  }
  return dmin;
}

// =============================================================================
// CAPA A — SIN Pyodide: estructura y factores de los combos del pipeline real.
// Caza el error de coeficiente ANTES de pagar el motor (instantaneo). Verifica la
// red mas barata: que los `factors` que produce el discretizador (via generarCombos)
// son EXACTAMENTE 1,35 a la permanente, 1,50 a la variable en ELU; 1,00 en ELS.
// =============================================================================
describe("combinaciones golden · CAPA A (discretizador puro, sin motor)", () => {
  const modelo = fixtureBiapoyadaDosHipotesis({ L: 6, g: 8, q: 10 });

  it("el pipeline discretiza ok y emite DOS cargas lineales (una por hipotesis) sobre la viga", () => {
    const res = discretizar(modelo);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    const fem = res.modeloFEM;
    // Dos UDL globales FY negativas, cada una con su `case` = id de hipotesis.
    expect(fem.dist_loads).toHaveLength(2);
    const porCaso = new Map(fem.dist_loads.map((d) => [d.case, d]));
    expect(porCaso.has(HIP_PERMANENTE.id)).toBe(true);
    expect(porCaso.has(HIP_VARIABLE.id)).toBe(true);
    expect(porCaso.get(HIP_PERMANENTE.id)!.w1).toBe(-8); // g, gravedad descendente
    expect(porCaso.get(HIP_VARIABLE.id)!.w1).toBe(-10); // q
    for (const d of fem.dist_loads) {
      expect(d.direction).toBe("FY"); // global vertical (mayuscula)
      expect([d.x1, d.x2]).toEqual([null, null]); // toda la barra
    }
  });

  // REGRESION DIRECTA sobre los factors (la red mas barata, spec T3.2 punto 4):
  // 1,35 a la permanente y 1,50 a la variable en ELU; 1,00 a ambas en ELS. Si
  // alguien invierte/cambia un coeficiente en generarCombos, ESTO se pone rojo sin
  // necesidad de motor.
  it("factores del combo ELU: 1,35 a la PERMANENTE y 1,50 a la VARIABLE (no al reves)", () => {
    const fem = discretizarOExplotar(modelo);
    const elu = fem.combos.find((c) => c.name === "ELU")!;
    expect(elu.combo_tags).toEqual(["ELU"]);
    expect(elu.factors[HIP_PERMANENTE.id]).toBe(1.35); // permanente -> 1,35
    expect(elu.factors[HIP_VARIABLE.id]).toBe(1.5); // variable   -> 1,50
    // Blindaje anti-inversion: el factor de la permanente NO es el de la variable.
    expect(elu.factors[HIP_PERMANENTE.id]).not.toBe(elu.factors[HIP_VARIABLE.id]);
    expect(elu.factors[HIP_PERMANENTE.id]).toBeLessThan(elu.factors[HIP_VARIABLE.id]);
  });

  it("factores del combo ELS: 1,00 a AMBAS hipotesis (caracteristica, sin mayorar)", () => {
    const fem = discretizarOExplotar(modelo);
    const els = fem.combos.find((c) => c.name === "ELS")!;
    expect(els.combo_tags).toEqual(["ELS"]);
    expect(els.factors[HIP_PERMANENTE.id]).toBe(1.0);
    expect(els.factors[HIP_VARIABLE.id]).toBe(1.0);
  });

  // El discretizador delega los combos en generarCombos: la Capa 2 del pipeline y
  // la salida directa de generarCombos coinciden (no hay un segundo punto donde se
  // reescriban los coeficientes a mano, antipatron del proyecto).
  it("la Capa 2 del pipeline usa EXACTAMENTE los combos de generarCombos (fuente unica)", () => {
    const fem = discretizarOExplotar(modelo);
    expect(fem.combos).toEqual(generarCombos(modelo));
  });

  // -------------------------------------------------------------------------
  // ANGULO PIPELINE/COMBO: una sobrecarga VARIABLE de magnitud qk se mayora por
  // 1,50 en ELU a traves del generarCombos REAL (qk * factor_variable_ELU). El
  // valor de qk por categoria y los gamma ya estan blindados EXHAUSTIVAMENTE en
  // src/biblioteca/acciones.test.ts; NO se duplican.
  //
  // HONESTIDAD DEL LIMITE: aqui NO se afirma que el discretizador "cablee" la
  // categoria a la sobrecarga. Ese cableado (categoria -> grupo.sobrecargaUso)
  // vive en el dialogo de grupos y se prueba en DialogoGruposYPlantas.test.tsx.
  // Este caso solo verifica lo que el PIPELINE decide: el factor variable de ELU
  // (1,50) y su producto por un dato de catalogo, que es lo que llega al solver.
  // -------------------------------------------------------------------------
  it("una sobrecarga variable de magnitud qk se mayora x1,50 en ELU (qk·1,50)", () => {
    const fem = discretizarOExplotar(
      // q = qk de categoria C (5 kN/m² -> aqui kN/m sobre la viga, magnitud).
      fixtureBiapoyadaDosHipotesis({ L: 6, g: 0, q: categoriaUso("C").qk }),
    );
    const factorVarELU = fem.combos.find((c) => c.name === "ELU")!.factors[HIP_VARIABLE.id];
    expect(factorVarELU).toBe(1.5);
    // El esfuerzo de la sobrecarga en ELU es qk * 1,50 (linealidad). Se verifica el
    // PRODUCTO de coeficiente x dato normativo, que es lo que llega al solver.
    expect(categoriaUso("C").qk * factorVarELU).toBe(7.5); // 5 * 1,50
    expect(categoriaUso("A").qk * factorVarELU).toBe(3.0); // 2 * 1,50
  });
});

// =============================================================================
// CAPA B — MOTOR PyNite REAL: el momento COMBINADO end-to-end contra formula
// cerrada. Es la verificacion numerica que la spec pide: un coeficiente mal puesto
// se ve en el numero final. SKIP si no hay runtime (igual que el resto de golden).
// =============================================================================
describe("combinaciones golden · CAPA B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-COMBO][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN-COMBO][PAR REAL] python=${v.python} numpy=${v.numpy} ` +
          `scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  function correrConFEM(modelo: Modelo): { res: ResultadosCalculo; fem: ModeloFEM } | null {
    if (!arranque || !arranque.ok) {
      console.warn(`[GOLDEN-COMBO][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
      return null;
    }
    const fem = discretizarOExplotar(modelo);
    const res = arranque.motor.calcular(fem);
    return { res, fem };
  }

  // ---------------------------------------------------------------------------
  // 1) ELU: biapoyada con g (permanente) + q (variable) -> M = (1,35·g+1,50·q)·L²/8.
  //    El nucleo del riesgo de la spec: el momento mayorado mezcla DOS coeficientes
  //    distintos. Si generarCombos invirtiera (1,5 a g, 1,35 a q) o aplicara un
  //    unico factor, este numero fallaria por encima de tolerancia.
  // ---------------------------------------------------------------------------
  it(
    "ELU biapoyada g+q: M = (1,35·g + 1,50·q)·L²/8 (mezcla de coeficientes)",
    () => {
      const L = 6;
      const g = 8; // permanente (kN/m)
      const q = 10; // variable   (kN/m)
      const corrida = correrConFEM(fixtureBiapoyadaDosHipotesis({ L, g, q }));
      if (!corrida) return;
      const { res } = corrida;

      // Momento de calculo ELU con los coeficientes EXACTOS de CTE DB-SE Tabla 4.1.
      const wELU = 1.35 * g + 1.5 * q; // 1,35·8 + 1,5·10 = 25,8 kN/m
      const Mteo = (wELU * L * L) / 8; // 25,8 · 36 / 8 = 116,1 kN·m

      const Mreal = picoMomentoNegativo(res, "ELU");
      assertOk(compararEsfuerzo(Mreal, Mteo), "ELU |M|=(1,35g+1,50q)L²/8");

      // Blindaje EXPLICITO anti-error-de-coeficiente: el momento ELU correcto NO
      // coincide con el que saldria si se aplicara el MISMO factor a ambas (ni 1,35
      // ni 1,5 a todo). Si generarCombos colapsara a un unico factor, Mreal caeria
      // sobre uno de estos y el assert anterior ya fallaria; estos refuerzan el porque.
      const Msi135aTodo = (1.35 * (g + q) * L * L) / 8; // 109,35
      const Msi150aTodo = (1.5 * (g + q) * L * L) / 8; // 121,5
      expect(Math.abs(Mreal - Mteo)).toBeLessThan(Math.abs(Mreal - Msi135aTodo));
      expect(Math.abs(Mreal - Mteo)).toBeLessThan(Math.abs(Mreal - Msi150aTodo));

      expect(res.check_statics?.equilibrio_ok, "ELU g+q equilibrio_ok").toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 2) ELS caracteristica: factor 1,00 a AMBAS -> M = (g+q)·L²/8 y flecha
  //    caracteristica 5(g+q)L⁴/384EIz. Verifica que ELS NO mayora (1,0 a las dos).
  // ---------------------------------------------------------------------------
  it(
    "ELS biapoyada g+q: M = (g+q)·L²/8 y flecha 5(g+q)L⁴/384EIz (factor 1,00 a ambas)",
    () => {
      const L = 6;
      const g = 8;
      const q = 10;
      const corrida = correrConFEM(fixtureBiapoyadaDosHipotesis({ L, g, q }));
      if (!corrida) return;
      const { res } = corrida;

      const wELS = g + q; // 18 kN/m (sin mayorar)
      const Mteo = (wELS * L * L) / 8; // 18 · 36 / 8 = 81 kN·m
      const flechaTeo = (5 * wELS * L ** 4) / (384 * E_ACERO * IZ_IPE300); // m (descenso)

      const Mreal = picoMomentoNegativo(res, "ELS");
      assertOk(compararEsfuerzo(Mreal, Mteo), "ELS |M|=(g+q)L²/8");

      // ELS NO debe coincidir con ningun ELU: si el factor ELS se hubiera puesto a
      // 1,35/1,5 por error, este numero (81) no saldria.
      const flechaReal = Math.abs(flechaMaxDescenso(res, "ELS"));
      assertOk(compararFlecha(flechaReal, flechaTeo), "ELS flecha 5(g+q)L⁴/384EIz");

      expect(res.check_statics?.equilibrio_ok, "ELS g+q equilibrio_ok").toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 3) Coherencia ELU/ELS sobre el MISMO modelo: el cociente de momentos
  //    M_ELU/M_ELS = (1,35g+1,50q)/(g+q) es exacto (linealidad). Es un check
  //    independiente de E/I y de L: aisla los COEFICIENTES de combinacion del resto
  //    del pipeline. Si un factor estuviera mal, el cociente se desviaria.
  // ---------------------------------------------------------------------------
  it(
    "cociente M_ELU/M_ELS = (1,35g+1,50q)/(g+q) exacto (aisla los coeficientes)",
    () => {
      const L = 6;
      const g = 8;
      const q = 10;
      const corrida = correrConFEM(fixtureBiapoyadaDosHipotesis({ L, g, q }));
      if (!corrida) return;
      const { res } = corrida;

      const Melu = picoMomentoNegativo(res, "ELU");
      const Mels = picoMomentoNegativo(res, "ELS");
      const cocienteTeo = (1.35 * g + 1.5 * q) / (g + q); // 25,8 / 18 = 1,4333…
      assertOk(compararEsfuerzo(Melu / Mels, cocienteTeo), "M_ELU/M_ELS = (1,35g+1,50q)/(g+q)");
    },
    TIMEOUT_ARRANQUE,
  );
});
