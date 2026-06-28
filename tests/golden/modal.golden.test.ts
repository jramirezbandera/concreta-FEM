// =============================================================================
// GOLDEN del ANALISIS MODAL (F2b, FASE 4.1) — red de seguridad por CAPAS.
//
// El analisis modal es un camino INDEPENDIENTE del estatico: frecuencias propias
// (Hz) + formas de vibracion por nudo. Esta suite es su red de seguridad,
// separada por capa (CLAUDE.md §13; I+D "golden del discretizador independiente
// del worker"):
//
//  - CAPA A (discretizador, SIN Pyodide): discretizar(modelo,{modal:{numModos}})
//    produce un ModeloFEM con analysis.type:"modal" + num_modes, check_statics:false,
//    y los MISMOS combos que el camino estatico (la masa la fabrica el glue, NO se
//    emite combo de masa en Capa 2). Esto NO duplica los unit tests de
//    src/discretizador/*.test.ts (que ya cubren type/num_modes/guards a nivel de
//    funcion): aqui se verifica al NIVEL DE PIPELINE, arrancando de una OBRA real
//    (fixturePorticoSimple) y contrastando modal vs estatico end-to-end del
//    discretizador.
//
//  - CAPA B (motor real PyNite): f1 de una viga biapoyada de acero == valor
//    ANALITICO de libro (π/2)·√(E·Iz/(m̄·L⁴)) con m̄ = (ρ/g)·A. Esta es la asercion
//    que CAZA los dos modos de fallo del spike (contrato-modal-confirmado.md §5):
//      (i) `gravity` mal (=1) -> f1 ÷√g ≈ 4.12 Hz (−68%) o, si el factor se aplica
//          al reves, ×√g ≈ 40.4 Hz;  (ii) camino de masa LUMPED -> −15% ≈ 10.97 Hz.
//    Con tolerancia <1% (banda ±0.129 Hz alrededor de 12.905) ninguno pasa.
//    Ademas: acotado de num_modes > GDL (el glue ACOTA, no lanza) y el error-path
//    de masa nula alimentando el glue en Capa 2 directa (defensa en profundidad;
//    el guard MODAL_SIN_MASA de Capa 1 ya lo bloquea antes, F2.2).
//
// La VALIDACION del borde modal corre por `motor.calcularModal` (arnes), que valida
// con ResultadosModalesSchema (NO con el por-combo ResultadosCalculoSchema). El
// borde Zod en si (payloads validos/malformados) ya se cubre en
// src/solver/resultadosModales.test.ts: aqui NO se duplica.
//
// VALOR ANALITICO (verificado con el motor real en el spike, error +0.002%):
//   E=210e6 kN/m², Iz=6.6667e-5 m⁴, ρ=78.5 kN/m³ (PESO especifico), L=6 m, A=0.02 m².
//   m̄ = (ρ/g)·A = (78.5/9.81)·0.02 = 0.160041 ;  f1 = (π/2)·√(E·Iz/(m̄·L⁴)) = 12.9053 Hz.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import {
  obtenerMotor,
  TIMEOUT_ARRANQUE,
  discretizarOExplotar,
  fixturePorticoSimple,
  type ArranqueMotor,
} from "./_arnes";
import { discretizar } from "../../src/discretizador";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";

// --- Caso analitico: viga biapoyada de acero (el del spike F2b) --------------
// MISMOS numeros que el smoke (src/solver/modal.smoke.test.ts) y el spike, para que
// el golden mida sobre el caso ya confirmado. La masa la FABRICA el glue
// (add_member_self_weight + gravity=9.81); el payload solo lleva material con `rho`,
// geometria y analysis.type:"modal".
const L = 6;
const NSUB = 8;
const E = 2.1e8; // kN/m²
const RHO = 78.5; // kN/m³ (PESO especifico)
const A = 0.02; // m²
const IZ = 6.6667e-5; // m⁴ (gobierna la flexion vertical de la biapoyada)
const G = 9.81; // m/s² (g fisico; la masa = peso/g)

// f1 analitico de la biapoyada (modo fundamental de flexion): (π/2)·√(E·Iz/(m̄·L⁴)).
const M_BARRA = (RHO / G) * A; // masa por unidad de longitud
const F1_ANALITICO = (Math.PI / 2) * Math.sqrt((E * IZ) / (M_BARRA * L ** 4)); // ≈ 12.9053 Hz

// Tolerancia ESTRECHA (<1%) — caza el gravity mal (×/÷√g) y el camino lumped (−15%).
// La convergencia del spike (nsub=8) ya da error < 0.01%, asi que 1% es holgado para
// el resultado correcto y mortal para los dos fallos del plan.
const TOL_REL_F1 = 0.01;

// Construye el ModeloFEM (Capa 2 cruda) de la biapoyada modal, igual que el smoke:
// pin en los extremos, DZ+RX coartados en todos los nudos para aislar la flexion
// vertical como 1.er modo. `analysis.type:"modal"` enruta el camino modal; el glue
// fabrica la masa y acota num_modes a los GDL libres si excede.
function modeloFEMBiapoyadaModal(numModos: number): ModeloFEM {
  const nodes = [];
  for (let k = 0; k <= NSUB; k++) {
    nodes.push({ name: `N${k}`, x: (L * k) / NSUB, y: 0, z: 0 });
  }
  const members = [];
  for (let k = 0; k < NSUB; k++) {
    members.push({
      name: `M${k}`,
      i: `N${k}`,
      j: `N${k + 1}`,
      material: "ACERO",
      section: "SEC",
      rotation: 0,
      tension_only: false,
      comp_only: false,
      releases: null,
    });
  }
  const supports = [
    { node: "N0", DX: true, DY: true, DZ: true, RX: true, RY: false, RZ: false },
    { node: `N${NSUB}`, DX: false, DY: true, DZ: true, RX: true, RY: false, RZ: false },
  ];
  for (let k = 1; k < NSUB; k++) {
    supports.push({
      node: `N${k}`,
      DX: false,
      DY: false,
      DZ: true,
      RX: true,
      RY: false,
      RZ: false,
    });
  }
  return {
    units: "kN-m",
    nodes,
    materials: [{ name: "ACERO", E, G: 8.077e7, nu: 0.3, rho: RHO }],
    sections: [{ name: "SEC", A, Iy: 1.6667e-5, Iz: IZ, J: 1e-5 }],
    members,
    supports,
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    analysis: { type: "modal", check_statics: false, num_modes: numModos },
  };
}

// =============================================================================
// CAPA A — DISCRETIZADOR (sin Pyodide).  Pipeline-level: de OBRA real a Capa 2 modal.
// =============================================================================
describe("golden modal Capa A (discretizador, sin motor)", () => {
  it(
    "obra real + opts.modal -> analysis.type:'modal', num_modes correcto, check_statics:false",
    () => {
      // Discretizamos una OBRA canonica (portico simple, con acero rho>0) por el
      // camino modal. discretizarOExplotar usa el camino estatico; aqui invocamos
      // discretizar(...) con opts para ejercitar la rama modal end-to-end del
      // discretizador (Capa 1 -> Capa 2), no la funcion aislada.
      const numModos = 6;
      const res = discretizar(fixturePorticoSimple({ B: 5, H: 3, q: 12 }), {
        modal: { numModos },
      });
      expect(res.ok, "la obra debe discretizar ok por el camino modal").toBe(true);
      if (!res.ok) return;

      const fem = res.modeloFEM;
      expect(fem.analysis.type).toBe("modal");
      expect(fem.analysis.num_modes).toBe(numModos);
      // El analisis modal NO comprueba equilibrio por combo (no hay combo estatico que
      // verificar): check_statics:false (contrato-modal-confirmado.md, no `check_statics`).
      expect(fem.analysis.check_statics).toBe(false);
    },
  );

  it(
    "opts.modal NO altera los combos respecto al camino estatico (no hay combo de masa)",
    () => {
      // generarCombos es PERMANENTE: el camino modal produce EXACTAMENTE los combos
      // del estatico (ELU/ELS). La masa la fabrica el glue (add_member_self_weight),
      // NO se emite ningun combo de masa en Capa 2. Si esto cambiara, un combo de masa
      // fantasma habria contaminado la Capa 2.
      const obra = fixturePorticoSimple({ B: 5, H: 3, q: 12 });
      const estatico = discretizarOExplotar(obra);
      const modal = discretizar(obra, { modal: { numModos: 6 } });
      expect(modal.ok).toBe(true);
      if (!modal.ok) return;
      expect(modal.modeloFEM.combos).toEqual(estatico.combos);
    },
  );
});

// =============================================================================
// CAPA B — MOTOR REAL PyNite.  f1 == analitico + acotado de modos + masa nula.
// =============================================================================
describe("golden modal Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-MODAL][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN-MODAL][PAR REAL] python=${v.python} numpy=${v.numpy} scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  // ---------------------------------------------------------------------------
  // B1) f1 BIAPOYADA == (π/2)·√(E·Iz/(m̄·L⁴)) con m̄=(ρ/g)·A.  El CORAZON del golden
  //    modal: si `gravity` no fuera 9.81, f1 saldria ÷√g (~4.12) o ×√g (~40.4); si la
  //    masa usara el camino LUMPED, f1 caeria −15% (~10.97). La tolerancia <1% cierra
  //    ambas puertas. Ademas: orden ascendente, todas > 0, en Hz, y borde Zod valido.
  // ---------------------------------------------------------------------------
  it(
    "f1 biapoyada ≈ (π/2)·√(EIz/(m̄L⁴)) (caza el gravity mal y el camino lumped)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // motor.calcularModal valida la salida con ResultadosModalesSchema (no con el
      // por-combo): si la forma del JSON modal se rompiera, lanzaria aqui.
      const r = arranque.motor.calcularModal(modeloFEMBiapoyadaModal(4));

      // Borde modal (defensa explicita, ademas de la validacion interna del arnes).
      expect(r.units).toBe("kN-m");
      expect(r.analysis.type).toBe("modal");
      expect(r.analysis.num_modes).toBe(r.frecuencias.length);
      expect(r.modos.length).toBe(r.frecuencias.length);
      expect(r.frecuencias.length, "al menos 1 modo").toBeGreaterThanOrEqual(1);

      // Frecuencias POSITIVAS (en Hz) y ASCENDENTES (orden propio de eigsh).
      for (const f of r.frecuencias) expect(f, "frecuencia > 0 (Hz)").toBeGreaterThan(0);
      for (let k = 1; k < r.frecuencias.length; k++) {
        expect(
          r.frecuencias[k],
          `frecuencias ascendentes (modo ${k + 1} >= modo ${k})`,
        ).toBeGreaterThanOrEqual(r.frecuencias[k - 1] - 1e-9);
      }

      // f1 == analitico (tolerancia <1%). Mensaje "real vs teorico" con el error.
      const f1 = r.frecuencias[0];
      const errRel = Math.abs(f1 - F1_ANALITICO) / F1_ANALITICO;
      const msg =
        `f1 biapoyada: real=${f1.toFixed(5)} Hz teorico=${F1_ANALITICO.toFixed(5)} Hz ` +
        `errRel=${(errRel * 100).toFixed(4)}% (gravity-mal÷√g≈${(F1_ANALITICO / Math.sqrt(G)).toFixed(2)}, ` +
        `lumped≈${(F1_ANALITICO * 0.85).toFixed(2)})`;
      console.warn(`\n[GOLDEN-MODAL][f1] ${msg}\n`);
      expect(errRel, msg).toBeLessThan(TOL_REL_F1);

      // El modo 1 lleva su forma por nudo con 6 GDL; el nudo central se mueve en DY
      // (flexion vertical). modos[0].nodos["N4"] = [DX,DY,DZ,RX,RY,RZ].
      const m1 = r.modos[0];
      expect(m1.numero).toBe(1);
      expect(m1.frecuencia).toBeCloseTo(f1, 6);
      const centro = m1.nodos["N4"];
      expect(centro, "el nudo central tiene forma modal").toBeDefined();
      expect(centro.length).toBe(6);
      expect(Math.abs(centro[1]), "DY del centro no nulo (flexion vertical)").toBeGreaterThan(0);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B2) ACOTADO de num_modes > GDL libres.  El spike confirmo que num_modes >= N
  //    lanza `TypeError: ... eigh for sparse A with k >= N`; el glue debe ACOTAR
  //    num_modes por debajo de los GDL libres y devolver SIN error. Se pide un numero
  //    GRANDE (100) sobre la biapoyada pequena: num_modes real = len(frecuencias) <=
  //    GDL, sin excepcion.
  // ---------------------------------------------------------------------------
  it(
    "num_modes > GDL libres: el glue ACOTA (no lanza) -> num_modes = len(frecuencias)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // 100 modos pedidos: imposible para esta estructura (muchos menos GDL libres).
      // El glue debe acotar, no propagar el TypeError de eigh k>=N.
      const PEDIDOS = 100;
      const r = arranque.motor.calcularModal(modeloFEMBiapoyadaModal(PEDIDOS));

      // num_modes REAL devuelto = len(frecuencias), y debe ser MENOR que lo pedido
      // (acotado a los GDL disponibles), pero al menos 1.
      expect(r.frecuencias.length).toBeGreaterThanOrEqual(1);
      expect(r.analysis.num_modes).toBe(r.frecuencias.length);
      expect(
        r.analysis.num_modes,
        "num_modes acotado por debajo de lo pedido (GDL libres < pedido)",
      ).toBeLessThan(PEDIDOS);
      // Coherencia: tantos objetos `modo` como frecuencias, ascendentes.
      expect(r.modos.length).toBe(r.frecuencias.length);
      for (let k = 1; k < r.frecuencias.length; k++) {
        expect(r.frecuencias[k]).toBeGreaterThanOrEqual(r.frecuencias[k - 1] - 1e-9);
      }
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B3) ERROR-PATH MASA NULA (defensa en profundidad del glue, Capa 2 directa).  El
  //    guard MODAL_SIN_MASA del discretizador (F2.2) bloquea esto en Capa 1; aqui
  //    alimentamos el glue con un ModeloFEM CRUDO de masa nula (material rho=0) para
  //    probar la defensa del propio glue: el motor lanza "massless"/"No mass terms"
  //    y el glue lo reclasifica a un ErrorMotor LEGIBLE (mensaje de masa), no un crash.
  //    El closure calcularModal LANZA cuando el glue devuelve {ok:false}; el mensaje
  //    debe mencionar "masa"/"massless".
  // ---------------------------------------------------------------------------
  it(
    "masa nula (rho=0) en Capa 2 -> ErrorMotor legible de masa (no crash)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const motor = arranque.motor;
      // Biapoyada modal pero con material SIN peso (rho=0): no hay masa que vibrar.
      // add_member_self_weight con rho=0 produce matriz de masa nula -> "massless".
      const sinMasa = modeloFEMBiapoyadaModal(4);
      sinMasa.materials = [{ name: "ACERO", E, G: 8.077e7, nu: 0.3, rho: 0 }];

      expect(
        () => motor.calcularModal(sinMasa),
        "masa nula debe propagar un ErrorMotor del glue",
      ).toThrow(/masa|massless|mass/i);
    },
    TIMEOUT_ARRANQUE,
  );
});
