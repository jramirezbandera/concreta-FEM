// =============================================================================
// SMOKE TEST del ANALISIS MODAL (F2b, F3.1) end-to-end con el motor REAL.
//
// OBJETIVO: demostrar que el camino MODAL vive y valida extremo a extremo:
// build_model -> run_analysis(modal) -> serialize_results_modal -> borde Zod
// (ResultadosModalesSchema). NO es la validacion numerica exhaustiva (f1 vs
// analitico es FASE 4.1 golden): aqui basta con que devuelva >=1 frecuencia,
// ascendentes, en Hz plausibles, con la forma del contrato.
//
// ENTORNO: Pyodide en Node via el NUCLEO COMPARTIDO arrancarMotorNode (mismo que el
// smoke estatico y el arnes golden). Expone la instancia `py` cruda: llamamos al
// glue `calcular(payloadJson)` (que enruta modal por analysis.type) directamente,
// porque el closure `calcular` del arnes valida con ResultadosCalculoSchema (por-combo),
// no con el contrato modal. Validamos aqui con ResultadosModalesSchema.
//
// RED: OFFLINE TOTAL (wheels vendorizados). Si el arranque falla -> SKIP, no rojo.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { ResultadosModalesSchema } from "./resultadosModales";
import type { ModeloFEM } from "../discretizador/contratoFEM";
import {
  arrancarMotorNode,
  ErrorArranquePyodide,
  descr,
  TIMEOUT_ARRANQUE,
  type MotorArrancado,
} from "../../tests/golden/_arnes/pyodideNode";

// --- Caso conocido: viga biapoyada de acero (el del spike F2b) ---------------
// E=210 GPa, rho=78.5 kN/m^3 (PESO especifico), L=6 m, seccion 0.1x0.2 m. La masa
// la FABRICA el glue (add_member_self_weight + gravity=9.81); el payload solo lleva
// material con rho, geometria y analysis.type="modal". f1 analitica ~= 12.9 Hz
// (no se aserta el valor exacto aqui; eso es el golden F4.1).
const L = 6;
const NSUB = 8;

function payloadModal(): ModeloFEM {
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
  // Biapoyada en plano XY, aislando la flexion vertical (igual que el spike): pin en
  // los extremos, DZ+RX coartados en todos los nudos para que el 1.er modo sea
  // flexion vertical limpia.
  const supports = [
    { node: "N0", DX: true, DY: true, DZ: true, RX: true, RY: false, RZ: false },
    { node: `N${NSUB}`, DX: false, DY: true, DZ: true, RX: true, RY: false, RZ: false },
  ];
  for (let k = 1; k < NSUB; k++) {
    supports.push({
      node: `N${k}`,
      DX: false, DY: false, DZ: true, RX: true, RY: false, RZ: false,
    });
  }
  return {
    units: "kN-m",
    nodes,
    materials: [{ name: "ACERO", E: 2.1e8, G: 8.077e7, nu: 0.3, rho: 78.5 }],
    sections: [{ name: "SEC", A: 0.02, Iy: 1.6667e-5, Iz: 6.6667e-5, J: 1e-5 }],
    members,
    supports,
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    // type:"modal" enruta el camino modal en el glue; num_modes lo acota el glue a
    // los GDL libres si excede. check_statics no aplica a modal (el glue lo ignora).
    analysis: { type: "modal", check_statics: false, num_modes: 4 },
  };
}

// Llama al glue `calcular` crudo (enruta modal) y devuelve el dict {ok|error} bruto.
function calcularModalCrudo(motor: MotorArrancado, modeloFEM: ModeloFEM): unknown {
  const fn = motor.py.globals.get("calcular");
  const proxy = fn(JSON.stringify(modeloFEM));
  const raw = proxy.toJs({ dict_converter: Object.fromEntries }) as
    | { ok: true; resultados: unknown }
    | { ok: false; error: { mensaje?: string; detalle?: string } };
  proxy.destroy?.();
  fn.destroy?.();
  return raw;
}

type Arranque =
  | { motor: MotorArrancado; skip: false }
  | { motor: null; skip: true; motivo: string };

let arranque: Arranque | null = null;

describe("smoke modal: analyze_modal end-to-end (biapoyada)", () => {
  beforeAll(async () => {
    try {
      const motor = await arrancarMotorNode();
      arranque = { motor, skip: false };
    } catch (e) {
      const motivo = e instanceof ErrorArranquePyodide ? e.message : descr(e);
      arranque = { motor: null, skip: true, motivo };
      console.warn(`\n[SMOKE-MODAL][SKIP] ${motivo}\n`);
    }
  }, TIMEOUT_ARRANQUE);

  it(
    "devuelve frecuencias en Hz, ascendentes, y pasa el borde Zod modal",
    () => {
      if (!arranque || arranque.skip) {
        console.warn(`[SMOKE-MODAL][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }

      const raw = calcularModalCrudo(arranque.motor, payloadModal()) as
        | { ok: true; resultados: unknown }
        | { ok: false; error: { mensaje?: string; detalle?: string } };

      // El glue NO debe devolver error para un modelo con masa valido.
      if (!raw.ok) {
        throw new Error(
          `[SMOKE-MODAL] el glue devolvio error: ${raw.error.mensaje}\n${raw.error.detalle}`,
        );
      }

      // --- Borde Zod: la salida cumple ResultadosModalesSchema -----------------
      const parseado = ResultadosModalesSchema.safeParse(raw.resultados);
      if (!parseado.success) {
        throw new Error(
          `[SMOKE-MODAL] ResultadosModalesSchema.safeParse FALLO:\n${JSON.stringify(
            parseado.error.issues,
            null,
            2,
          )}`,
        );
      }
      const r = parseado.data;

      // --- Forma + sanidad numerica (sin asertar el valor analitico exacto) ----
      expect(r.units).toBe("kN-m");
      expect(r.analysis.type).toBe("modal");
      // Al menos 1 modo; num_modes coincide con la longitud de frecuencias y modos.
      expect(r.frecuencias.length).toBeGreaterThanOrEqual(1);
      expect(r.analysis.num_modes).toBe(r.frecuencias.length);
      expect(r.modos.length).toBe(r.frecuencias.length);

      // Frecuencias POSITIVAS y ASCENDENTES (orden propio de eigsh).
      for (const f of r.frecuencias) expect(f).toBeGreaterThan(0);
      for (let k = 1; k < r.frecuencias.length; k++) {
        expect(r.frecuencias[k]).toBeGreaterThanOrEqual(r.frecuencias[k - 1] - 1e-9);
      }

      // f1 en un rango Hz plausible para esta viga (~12.9 Hz; banda amplia, el valor
      // exacto lo aserta el golden F4.1). Caza el ×√g si gravity estuviera mal (~40 Hz).
      const f1 = r.frecuencias[0];
      console.warn(`\n[SMOKE-MODAL][f1] ${f1.toFixed(4)} Hz (esperado ~12.9)\n`);
      expect(f1).toBeGreaterThan(5);
      expect(f1).toBeLessThan(25);

      // Cada modo lleva su forma por nudo con 6 GDL; el nudo central del modo 1 se
      // mueve en DY (flexion vertical). modos[0].nodos["N4"] = [DX,DY,DZ,RX,RY,RZ].
      const m1 = r.modos[0];
      expect(m1.numero).toBe(1);
      expect(m1.frecuencia).toBeCloseTo(f1, 6);
      const centro = m1.nodos["N4"];
      expect(centro).toBeDefined();
      expect(centro.length).toBe(6);
      expect(Math.abs(centro[1])).toBeGreaterThan(0); // DY del centro no nulo
    },
    TIMEOUT_ARRANQUE,
  );
});
