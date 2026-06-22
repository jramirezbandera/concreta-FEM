// =============================================================================
// HUMO de la INFRAESTRUCTURA golden (feature-6, T0.2). NO contiene asserts
// numericos de golden (eso es T1.2) ni golden del discretizador (T1.1): solo
// comprueba que los CIMIENTOS que esas tareas consumiran estan en pie:
//   A) Los 4 fixtures de obra canonica DISCRETIZAN ok (Capa 1 valida -> Capa 2),
//      SIN arrancar Pyodide (golden del discretizador independiente del worker).
//   B) La politica de tolerancias se comporta (relativa + piso absoluto).
//   C) El arnes de motor compartido arranca UNA vez y el pipeline completo
//      devuelve un ResultadosCalculo que cumple el contrato. Si NO hay red /
//      falla la instalacion, se marca SKIP con motivo claro (no rojo), igual que
//      smoke.test.ts. Aqui NO se verifican numeros (M=qL²/8 lo hace T1.2): solo
//      que el pipeline cruza de extremo a extremo y respeta el contrato.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import {
  obtenerMotor,
  TIMEOUT_ARRANQUE,
  ejecutarPipeline,
  discretizarOExplotar,
  fixtureBiapoyadaUDL,
  fixtureVoladizoPuntual,
  fixtureBiapoyadaPuntualCentro,
  fixturePorticoSimple,
  compararEsfuerzo,
  compararFlecha,
  type ArranqueMotor,
} from "./_arnes";

// --- A) Fixtures discretizan ok (sin Pyodide) --------------------------------
describe("infra golden: fixtures de obra canonica discretizan a Capa 2", () => {
  it("biapoyada UDL -> Capa 2 valida con barras, apoyos y una carga distribuida", () => {
    const fem = discretizarOExplotar(fixtureBiapoyadaUDL({ L: 6, q: 10 }));
    expect(fem.members.length).toBeGreaterThan(0);
    expect(fem.supports.length).toBe(2); // dos pilares articulados
    expect(fem.dist_loads.length).toBe(1); // la UDL sobre la viga
  });

  it("voladizo puntual -> Capa 2 valida con un empotramiento (6 GDL) y una carga puntual", () => {
    const fem = discretizarOExplotar(fixtureVoladizoPuntual({ L: 3, P: 20 }));
    expect(fem.supports.length).toBe(1);
    const s = fem.supports[0];
    expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([true, true, true, true, true, true]);
    // P sobre el NUDO libre (node_load): F1 no emite puntuales sobre barra.
    expect(fem.node_loads.length).toBe(1);
    expect(fem.pt_loads.length).toBe(0);
  });

  it("biapoyada puntual centrada -> dos vanos y la carga sobre el nudo central (node_load)", () => {
    const fem = discretizarOExplotar(fixtureBiapoyadaPuntualCentro({ L: 8, P: 40 }));
    expect(fem.supports.length).toBe(2);
    expect(fem.node_loads.length).toBe(1); // P en el nudo central
    // Dos vanos de viga colineales -> al menos dos barras de dintel (+ pilares).
    expect(fem.members.length).toBeGreaterThanOrEqual(4);
  });

  it("portico simple -> dos pilares empotrados + dintel", () => {
    const fem = discretizarOExplotar(fixturePorticoSimple({ B: 5, H: 3, q: 12 }));
    expect(fem.supports.length).toBe(2);
    for (const s of fem.supports) {
      expect([s.RX, s.RY, s.RZ]).toEqual([true, true, true]); // bases empotradas
    }
    expect(fem.dist_loads.length).toBe(1);
  });
});

// --- B) Politica de tolerancias ----------------------------------------------
describe("infra golden: politica de tolerancias", () => {
  it("esfuerzo dentro de 0,1% pasa; fuera, falla", () => {
    expect(compararEsfuerzo(45.02, 45).ok).toBe(true); // 0,044 % < 0,1 %
    expect(compararEsfuerzo(45.1, 45).ok).toBe(false); // 0,22 % > 0,1 %
  });

  it("flecha dentro de 1% pasa; fuera, falla", () => {
    expect(compararFlecha(0.0101, 0.01).ok).toBe(true); // 1 %
    expect(compararFlecha(0.0102, 0.01).ok).toBe(false); // 2 % > 1 %
  });

  it("teorico ~0 con real ~0 pasa por el piso absoluto (cero numerico)", () => {
    expect(compararEsfuerzo(1e-9, 0).ok).toBe(true);
    expect(compararFlecha(1e-12, 0).ok).toBe(true);
  });
});

// --- C) Pipeline completo (motor compartido) con SKIP si no hay red ----------
describe("infra golden: arnes de motor compartido + pipeline E2E", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-INFRA][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN-INFRA][PAR REAL] python=${v.python} numpy=${v.numpy} ` +
          `scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  it(
    "obra -> discretizar -> motor devuelve ResultadosCalculo conforme al contrato",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-INFRA][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // Pipeline completo sobre la biapoyada UDL. NO se verifican numeros (T1.2):
      // solo que cruza de extremo a extremo y la salida respeta el contrato.
      const res = ejecutarPipeline(fixtureBiapoyadaUDL({ L: 6, q: 10 }), arranque.motor);
      expect(res.units).toBe("kN-m");
      // Combos provisionales del discretizador (paso 7): ELU y ELS.
      expect(res.combos).toContain("ELU");
      expect(res.combos).toContain("ELS");
      expect(Object.keys(res.barras).length).toBeGreaterThan(0);
      expect(Object.keys(res.nodos).length).toBeGreaterThan(0);
      // Equilibrio comprobado (el fixture pide check_statics).
      expect(res.check_statics).not.toBeNull();
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "el arnes reusa el MISMO motor entre llamadas (arranque unico)",
    async () => {
      const a = await obtenerMotor();
      const b = await obtenerMotor();
      // Misma promesa cacheada -> mismo objeto de arranque (no re-arranca Pyodide).
      expect(a).toBe(b);
    },
    TIMEOUT_ARRANQUE,
  );
});
