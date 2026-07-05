// =============================================================================
// GOLDEN MODAL de PLACA / LOSA MACIZA (corte T-f3-masa-placa, FASE 3) — PRECISION.
//
// Es la red de seguridad NUMERICA de la masa de placa en el analisis modal. El bug
// del corte (verificado en el codigo de PyNite 2.0.2, spike T0.1): el `Quad3D` NO
// tiene m()/kg() ni guarda `rho`, y `add_member_self_weight` IGNORA los quads -> una
// losa maciza modelada con quads entra en `analyze_modal` con MASA CERO y sus modos de
// flexion de placa NO aparecen. La Fase 1 (T1.1) lo arreglo en el glue con
// `_agregar_masa_quads`: masa LUMPED tributaria (W = rho·t·area por quad, repartida
// W/4 como add_node_load(FY,-W/4) en sus 4 nudos, case=__masa_modal__) que
// analyze_modal(mass_direction="Y", gravity=9.81) convierte en masa W/g. Este golden,
// con el MOTOR REAL, afirma que esa masa produce la frecuencia fundamental CORRECTA de
// una placa (no una f absurda, no la placa "sin masa").
//
// La Capa 2 (ModeloFEM con quads + analysis.type:"modal") se monta A MANO aqui, igual
// orden de nudos i->j->m->n y misma estabilizacion en plano que el discretizador
// (mallado.ts:540: esq(0,0) DX+DZ, esq(nx,0) DZ) — espejo del golden estatico de placa
// (placa.golden.test.ts) pero por el camino modal. Este golden prueba el GLUE + el
// contrato ResultadosModales, NO el discretizador (eso es otro lane). El borde se valida
// con ResultadosModalesSchema (via motor.calcularModal del arnes).
//
// -----------------------------------------------------------------------------
// REFERENCIA ANALITICA y por que TOL_REL = 0.03 (3 %), NO 1 %  (decision del spike T0.1):
//
//   Placa cuadrada SSSS (simplemente apoyada en los 4 bordes), primer modo (1,1),
//   solucion de LEISSA para placa DELGADA (Kirchhoff), calculada EN EL TEST:
//       f1 = (pi/2)·(1/a² + 1/b²)·sqrt(D/mu)
//       D  = E·t³ / (12·(1−nu²))        (rigidez a flexion)
//       mu = rho·t / g                  (masa por unidad de area; rho es PESO especifico)
//   Con a=b=6 m, t=0.25 m, HA-25 (E=3.148e7 kN/m², nu=0.2, rho=25 kN/m³, g=9.81):
//       f1_Leissa = 22.591 Hz  (D=42697 kN·m, mu=0.6371).
//
//   El elemento de PyNite es un cuadrilatero de placa GRUESA (Mindlin/DKMQ) con
//   deformacion por cortante transversal: la placa es mas flexible que la delgada de
//   Leissa -> f1 converge a un valor POR DEBAJO de Leissa. El spike midio (motor real):
//       malla  8×8  -> f1 = 22.208 Hz  (−1.70 % vs Leissa)
//       malla 16×16 -> f1 = 22.269 Hz  (−1.43 % vs Leissa)
//   y — SORPRESA que fija la TOL — la curva NO converge a 0 % respecto a Leissa: es NO
//   monotona (minimo de |error| ~16×16) y tiende a ≈ −2.2 % (limite fisico Mindlin) al
//   refinar mas. Por eso:
//     · TOL_REL = 0.03 cubre el error real (≤1.7 %) con margen para el cambio de build
//       numpy/scipy local↔Pyodide y la banda −1.4 %..−2.2 %.
//     · NO estrechar a 1 %: fallaria por el sesgo Mindlin FISICO, no por un bug.
//     · NO refinar la malla buscando 0 %: al refinar el |error| CRECE hacia −2.2 %
//       (converge a Mindlin, no a Leissa). Para TOL <1 % la referencia correcta seria
//       una tabla de placa GRUESA (Mindlin), fuera del alcance de este corte.
//   Ver src/solver/spikes/masa_placa_spike.md (tabla completa y numeros exactos).
//
//   3 % es holgado para el resultado CORRECTO y MORTAL para los fallos que caza:
//     · masa de placa OLVIDADA -> el modo de flexion no existe (o f absurda);
//     · gravity mal -> f1 ×/÷ sqrt(9.81) ≈ ×/÷ 3.13 (7.2 Hz o 70.8 Hz, MUY fuera de banda);
//     · factor de masa equivocado -> f desplazada varias decenas de %.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";

// --- Parametros de la placa (sistema interno kN-m) — mismos que el spike T0.1 ------
const LADO = 6.0; // m (losa cuadrada a×a)
const ESPESOR = 0.25; // m (t/a ≈ 0.042: placa moderadamente delgada)
const E = 3.148e7; // kN/m² (HA-25, Ecm del Codigo Estructural = 31476 MPa)
const NU = 0.2;
const G_MAT = E / (2 * (1 + NU)); // kN/m² (modulo de cortante del material)
const RHO = 25.0; // kN/m³ (PESO especifico del hormigon; masa = peso/g)
const G_FISICO = 9.81; // m/s² (g fisico; la masa nodal = W/g, igual que en el glue)

// --- Referencia de Leissa (placa delgada SSSS, modo fundamental (1,1)) -------------
// CALCULADA EN EL TEST (no un numero magico): f1 = (pi/2)·(1/a²+1/b²)·sqrt(D/mu).
const D_PLACA = (E * ESPESOR ** 3) / (12 * (1 - NU * NU)); // rigidez a flexion
const MU_PLACA = (RHO * ESPESOR) / G_FISICO; // masa por unidad de area
const F1_LEISSA =
  (Math.PI / 2) * (1 / LADO ** 2 + 1 / LADO ** 2) * Math.sqrt(D_PLACA / MU_PLACA); // ≈ 22.591 Hz

// Tolerancia FINA contra Leissa (razonada en la cabecera): 3 %, ni mas fina (sesgo
// Mindlin FISICO) ni buscada por refinamiento (converge a −2.2 %, no a 0 %).
const TOL_REL = 0.03;

// Banda GRUESA de cordura [0.9, 1.1]·Leissa: caza el fallo catastrofico (masa olvidada
// o gravity mal) aunque un dia la constante fina se mueva. gravity mal daria f1 ÷√g ≈
// 7.2 Hz o ×√g ≈ 70.8 Hz — ambos MUY fuera de [20.3, 24.9]. Es defensa en profundidad
// ADEMAS del TOL fino: si el TOL fino se relajara por error, la banda sigue cerrando.
const BANDA_INF = 0.9 * F1_LEISSA;
const BANDA_SUP = 1.1 * F1_LEISSA;

// -----------------------------------------------------------------------------
// Monta la Capa 2 (ModeloFEM crudo) de la losa cuadrada SSSS con malla n×n de quads en
// el plano FEM X-Z (vertical = Y), por el camino MODAL. Es el ESPEJO exacto del fixture
// del golden estatico (placa.golden.test.ts) — mismo orden de nudos i->j->m->n
// (recorrido X+ luego Z+, CCW visto desde +Y) y misma estabilizacion en plano — salvo:
//   · analysis.type = "modal" (+ num_modes), NO "linear";
//   · SIN quad_loads/combos: el modal no tiene cargas; la masa la FABRICA el glue a
//     partir de rho·t·area de cada quad (add_node_load al case interno __masa_modal__).
// El material lleva `rho` (25 kN/m³): sin el, no habria masa y el modal fallaria.
//
//   diagrama de un quad (vista desde +Y, X derecha, Z arriba):
//        n(ix,iz+1) ── m(ix+1,iz+1)
//          │               │
//        i(ix,iz)  ──  j(ix+1,iz)
// -----------------------------------------------------------------------------
function modeloFEMLosaModal(opts: { n: number; numModos: number }): ModeloFEM {
  const { n, numModos } = opts;
  const h = LADO / n;
  const nombreNudo = (ix: number, iz: number) => `N_${ix}_${iz}`;

  const nodes: ModeloFEM["nodes"] = [];
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      nodes.push({ name: nombreNudo(ix, iz), x: ix * h, y: 0, z: iz * h });
    }
  }

  const quads: NonNullable<ModeloFEM["quads"]> = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      quads.push({
        name: `Q_${ix}_${iz}`,
        i: nombreNudo(ix, iz),
        j: nombreNudo(ix + 1, iz),
        m: nombreNudo(ix + 1, iz + 1),
        n: nombreNudo(ix, iz + 1),
        t: ESPESOR,
        material: "HA",
      });
    }
  }

  // Apoyo SIMPLE de borde (DY) + estabilizacion en plano IDENTICA al discretizador
  // (mallado.ts:540): esq(0,0) DX+DZ (fija las 2 traslaciones de cuerpo rigido en plano)
  // + esq(n,0) DZ (fija el giro RY). No coarta la flexion vertical (DY de borde = apoyo
  // simple; DY interior + giros de placa libres) — el modo (1,1) es libre de aparecer.
  const supports: ModeloFEM["supports"] = [];
  const esBorde = (ix: number, iz: number) =>
    ix === 0 || ix === n || iz === 0 || iz === n;
  const flagsPlano: Record<string, { DX: boolean; DZ: boolean }> = {
    [nombreNudo(0, 0)]: { DX: true, DZ: true },
    [nombreNudo(n, 0)]: { DX: false, DZ: true },
  };
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      if (!esBorde(ix, iz)) continue;
      const nm = nombreNudo(ix, iz);
      const plano = flagsPlano[nm] ?? { DX: false, DZ: false };
      supports.push({
        node: nm,
        DX: plano.DX,
        DY: true, // apoyo simple del borde (SSSS)
        DZ: plano.DZ,
        RX: false,
        RY: false,
        RZ: false,
      });
    }
  }

  return {
    units: "kN-m",
    nodes,
    materials: [{ name: "HA", E, G: G_MAT, nu: NU, rho: RHO }],
    sections: [], // losa pura: sin barras -> sin secciones 1D
    members: [],
    quads,
    supports,
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    // SIN quad_loads/combos: el modal no tiene cargas (la masa la fabrica el glue).
    combos: [],
    analysis: { type: "modal", check_statics: false, num_modes: numModos },
  };
}

// El centro de la losa cae en el nudo (n/2, n/2) para n PAR (8 y 16 lo son): es donde
// el modo (1,1) — media onda en X y en Z — tiene su maximo DY.
const nudoCentro = (n: number) => `N_${n / 2}_${n / 2}`;

// =============================================================================
// CAPA B — MOTOR REAL PyNite. f1 de la placa ≈ Leissa (±3 %) + convergencia + fallos.
// =============================================================================
describe("golden placa-modal Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-PLACA-MODAL][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN-PLACA-MODAL][PAR REAL] python=${v.python} numpy=${v.numpy} scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
      console.warn(
        `[GOLDEN-PLACA-MODAL][Leissa] f1=${F1_LEISSA.toFixed(4)} Hz ` +
          `(D=${D_PLACA.toFixed(1)} mu=${MU_PLACA.toFixed(4)}) banda=[${BANDA_INF.toFixed(3)}, ${BANDA_SUP.toFixed(3)}]\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  // ---------------------------------------------------------------------------
  // B1) CASO CENTRAL: placa SSSS 6×6, malla 8×8. f1 ≈ Leissa (±3 %), DY dominante en el
  //     centro (modo (1,1)). El corazon del golden: la masa de placa del glue produce
  //     la frecuencia fundamental correcta.
  // ---------------------------------------------------------------------------
  it(
    "placa SSSS 8×8: f1 ≈ Leissa (±3 %), banda de cordura, modo (1,1) con DY en el centro",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // calcularModal valida la salida con ResultadosModalesSchema (no la por-combo).
      const r = arranque.motor.calcularModal(modeloFEMLosaModal({ n: 8, numModos: 6 }));

      // Borde modal (defensa explicita, ademas de la validacion interna del arnes).
      expect(r.units).toBe("kN-m");
      expect(r.analysis.type).toBe("modal");
      expect(r.analysis.num_modes).toBe(r.frecuencias.length);
      expect(r.modos.length).toBe(r.frecuencias.length);
      expect(r.frecuencias.length, "al menos 1 modo").toBeGreaterThanOrEqual(1);

      // Frecuencias POSITIVAS (en Hz) y ASCENDENTES. Si la masa de placa se hubiera
      // olvidado, no habria modo de flexion de placa que ver (o f absurda) -> este par
      // de aserciones ya empieza a cerrar el fallo.
      for (const f of r.frecuencias) expect(f, "frecuencia > 0 (Hz)").toBeGreaterThan(0);
      for (let k = 1; k < r.frecuencias.length; k++) {
        expect(
          r.frecuencias[k],
          `frecuencias ascendentes (modo ${k + 1} >= modo ${k})`,
        ).toBeGreaterThanOrEqual(r.frecuencias[k - 1] - 1e-9);
      }

      const f1 = r.frecuencias[0];

      // --- BANDA de cordura [0.9, 1.1]·Leissa (defensa en profundidad) -------------
      // Caza el fallo catastrofico (masa olvidada o gravity mal: 7.2 / 70.8 Hz) aunque
      // el TOL fino se relajara. Ver cabecera para los numeros.
      expect(
        f1,
        `f1 dentro de la banda de cordura [${BANDA_INF.toFixed(2)}, ${BANDA_SUP.toFixed(2)}] Hz; ` +
          `gravity-mal daria ÷√g≈${(F1_LEISSA / Math.sqrt(G_FISICO)).toFixed(2)} o ×√g≈${(F1_LEISSA * Math.sqrt(G_FISICO)).toFixed(2)} (fuera de banda)`,
      ).toBeGreaterThan(BANDA_INF);
      expect(f1, "f1 por debajo del techo de la banda de cordura").toBeLessThan(BANDA_SUP);

      // --- TOL FINO: f1 ≈ Leissa (±3 %). Mensaje "real vs Leissa" con el error --------
      const errRel = Math.abs(f1 - F1_LEISSA) / F1_LEISSA;
      const msg =
        `f1 placa 8×8: real=${f1.toFixed(4)} Hz Leissa=${F1_LEISSA.toFixed(4)} Hz ` +
        `errRel=${((f1 - F1_LEISSA) / F1_LEISSA * 100).toFixed(2)}% (spike: −1.70%; ` +
        `Mindlin converge a ≈−2.2%, NO a 0%)`;
      console.warn(`\n[GOLDEN-PLACA-MODAL][f1 8×8] ${msg}\n`);
      expect(errRel, msg).toBeLessThan(TOL_REL);

      // --- Modo (1,1): DY DOMINANTE en el centro de la losa ------------------------
      // El 1.er modo de una placa SSSS es la flexion (1,1): media onda en X y en Z, con
      // maximo DY en el centro. El spike confirmo DY/plano ≈ 4.6e15 (DY domina por
      // completo). Aqui lo asertamos barato: en el nudo central |DY| >> |DX|,|DZ|.
      const m1 = r.modos[0];
      expect(m1.numero).toBe(1);
      expect(m1.frecuencia).toBeCloseTo(f1, 6);
      const centro = m1.nodos[nudoCentro(8)];
      expect(centro, "el nudo central tiene forma modal").toBeDefined();
      expect(centro.length).toBe(6);
      const [dx, dy, dz] = centro;
      expect(Math.abs(dy), "DY del centro no nulo (flexion de placa)").toBeGreaterThan(0);
      // DY domina el movimiento en plano por varios ordenes de magnitud (modo de flexion,
      // no un modo espurio de traslacion/giro en plano por delante).
      const enPlano = Math.max(Math.abs(dx), Math.abs(dz));
      expect(
        Math.abs(dy),
        `1.er modo = flexion (1,1): |DY|(${Math.abs(dy).toExponential(2)}) >> |plano|(${enPlano.toExponential(2)})`,
      ).toBeGreaterThan(100 * enPlano);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B2) CONVERGENCIA: malla 16×16 tambien dentro del 3 %. OJO — la convergencia NO es
  //     monotona hacia Leissa (el motor converge a Mindlin ≈ −2.2 %, no a 0 %): el spike
  //     midio 8×8 = −1.70 % y 16×16 = −1.43 %, asi que 16×16 esta MAS cerca aqui, pero
  //     ese orden no es garantia fisica al seguir refinando. Por eso NO aseveramos
  //     "16×16 estrictamente mejor que 8×8": aseveramos que AMBAS mallas caen dentro del
  //     3 % (con un margen minusculo por si el build de Pyodide desplaza un pelo el
  //     |error| de 16×16 por encima del de 8×8). Esta es la lectura correcta del spike.
  // ---------------------------------------------------------------------------
  it(
    "convergencia 8×8 vs 16×16: ambas dentro del 3 % (la convergencia NO es monotona a Leissa)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const f1_8 = arranque.motor.calcularModal(modeloFEMLosaModal({ n: 8, numModos: 4 }))
        .frecuencias[0];
      const f1_16 = arranque.motor.calcularModal(modeloFEMLosaModal({ n: 16, numModos: 4 }))
        .frecuencias[0];

      const err8 = Math.abs(f1_8 - F1_LEISSA) / F1_LEISSA;
      const err16 = Math.abs(f1_16 - F1_LEISSA) / F1_LEISSA;
      const msg =
        `f1 8×8=${f1_8.toFixed(4)} Hz (${((f1_8 - F1_LEISSA) / F1_LEISSA * 100).toFixed(2)}%) ` +
        `16×16=${f1_16.toFixed(4)} Hz (${((f1_16 - F1_LEISSA) / F1_LEISSA * 100).toFixed(2)}%) ` +
        `Leissa=${F1_LEISSA.toFixed(4)} Hz`;
      console.warn(`\n[GOLDEN-PLACA-MODAL][convergencia] ${msg}\n`);

      // Ambas mallas dentro del 3 % (el veredicto del spike: el error a malla razonable
      // es ≤1.7 %, muy por debajo del 3 %).
      expect(err8, `8×8 dentro del 3 %: ${msg}`).toBeLessThan(TOL_REL);
      expect(err16, `16×16 dentro del 3 %: ${msg}`).toBeLessThan(TOL_REL);

      // El |error| de 16×16 no debe DISPARARSE respecto al de 8×8: como la convergencia
      // no es monotona hacia Leissa (tiende a Mindlin ≈ −2.2 %), NO exigimos mejora
      // estricta, solo que 16×16 no empeore MAS de un margen pequeno frente a 8×8. Con
      // los numeros del spike (−1.43 % vs −1.70 %) 16×16 es de hecho mejor, pero el
      // margen protege del ligero repunte que el sesgo Mindlin produce al refinar.
      const MARGEN = 0.005; // 0.5 puntos porcentuales de holgura
      expect(
        err16,
        `|error| 16×16 (${(err16 * 100).toFixed(2)}%) no dispara sobre 8×8 (${(err8 * 100).toFixed(2)}%): ${msg}`,
      ).toBeLessThanOrEqual(err8 + MARGEN);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B3) MASA CERO = ANTES del fix. Regresion directa del bug del corte: alimentamos el
  //     glue con la MISMA losa pero material rho=0 (peso especifico nulo). Sin peso, la
  //     masa de placa fabricada (W = rho·t·area = 0) es nula, add_member_self_weight de
  //     barras no aporta (no hay barras) -> matriz de masa nula. El glue reclasifica el
  //     "massless"/"no mass terms" del solver a un ErrorMotor LEGIBLE (mensaje de masa),
  //     NO un crash ni una f falsa. Si la masa de placa se calculara desde algo distinto
  //     de rho (o se ignorara rho=0), este caso NO fallaria y el bug pasaria. calcularModal
  //     LANZA cuando el glue devuelve {ok:false}.
  // ---------------------------------------------------------------------------
  it(
    "rho=0 (placa sin peso) -> ErrorMotor de masa (no crash, no f falsa)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const motor = arranque.motor;
      const sinMasa = modeloFEMLosaModal({ n: 8, numModos: 4 });
      // Peso especifico NULO: W = rho·t·area = 0 en cada quad -> masa de placa nula.
      sinMasa.materials = [{ name: "HA", E, G: G_MAT, nu: NU, rho: 0 }];

      expect(
        () => motor.calcularModal(sinMasa),
        "placa sin peso (rho=0) debe propagar un ErrorMotor legible de masa",
      ).toThrow(/masa|massless|mass|vibrar/i);
    },
    TIMEOUT_ARRANQUE,
  );
});
