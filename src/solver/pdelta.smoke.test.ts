// =============================================================================
// SMOKE TEST de la rama P-Δ del motor FEM (feature F2.2 / plan E6).
//
// OBJETIVO: probar que la rama PDelta del glue (pynite_glue.py:run_analysis) es de
// primera clase y endurecida:
//   (A) AMPLIFICACION REAL: una columna esbelta en voladizo con carga axil de
//       compresion + carga lateral. El momento en la base CRECE de `analyze`
//       (1.º orden, M ≈ H·L) a `pDelta` (2.º orden, amplificado por 1/(1-P/Pcr)).
//       Usa CARGA LATERAL EXPLICITA (plan CV2): sin sway no hay nada que
//       amplificar; el golden de Fase 3 reusa esta idea.
//   (B) INESTABILIDAD -> ErrorMotor LEGIBLE: la misma columna con una axil por
//       encima de la critica de pandeo (Euler) dispara la inestabilidad de 2.º
//       orden; analyze_PDelta(check_stability=True) lanza y el glue lo traduce a
//       "La estructura es inestable bajo P-Δ: revise rigidez o arriostramiento."
//       (no un traceback crudo ni un error generico).
//
// ENTORNO: Pyodide en Node (mismo nucleo compartido que smoke.test.ts), OFFLINE
// con wheels vendorizados. Si el motor no arranca (sin red/instalacion), SKIP con
// motivo, nunca rojo (misma politica que smoke.test.ts). NO es la validacion
// numerica exhaustiva: eso es el golden P-Δ de Fase 3 (carga lateral + caso
// inestable). Aqui solo demostramos que la fontaneria P-Δ y el error-path andan.
//
// MODELO (sistema interno kN-m): columna en voladizo a lo largo del eje GLOBAL Y.
//   N1 = base (0,0,0)  empotrada (todos los GDL).
//   N2 = cabeza (0,L,0) libre, con:
//     - carga axil de compresion P en -Y (case "P"),
//     - carga lateral H en +X (case "H").
//   Material/seccion de acero genericos; I escogida para que Pcr sea moderada.
//   Combos: ELU mete G(=P) y la lateral con sus factores; cada caso prueba uno.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import type { ModeloFEM } from "../discretizador/contratoFEM";
import type { ResultadosCalculo } from "./resultados";
import {
  arrancarMotorNode,
  ErrorArranquePyodide,
  descr,
  TIMEOUT_ARRANQUE,
  type MotorArrancado,
} from "../../tests/golden/_arnes/pyodideNode";

// --- Geometria y material ----------------------------------------------------
const L = 4; // m (altura de la columna)
const E = 2.1e8; // kN/m² (acero, 210 GPa)
const G = 8.077e7; // kN/m²
const NU = 0.3;
const RHO = 78.5; // kN/m³ (no influye: el peso propio no se aplica aqui)

// Seccion: I sobre el eje de flexion en el plano XY (flexion por la lateral en X
// con el voladizo en Y -> giro RZ). En PyNite la flexion en el plano de la carga
// lateral X con el eje de la barra en Y la gobierna Iz (momento Mz). Elegimos una
// Iz moderada para que la critica de Euler caiga en un rango comodo de probar.
const A = 5.3e-3; // m²
const IY = 8.36e-6; // m⁴
const IZ = 1.5e-5; // m⁴  (eje fuerte para la flexion XY)
const J = 1.0e-7; // m⁴

// Critica de Euler de un voladizo (empotrado-libre): Pcr = π²·E·I / (4L²).
// Con E·Iz y L => referencia para elegir P_ESTABLE (< Pcr) y P_INESTABLE (> Pcr).
const PCR = (Math.PI * Math.PI * E * IZ) / (4 * L * L);

// Carga lateral pequena (provoca el sway que P-Δ amplifica).
const H = 5; // kN en +X

// =============================================================================
// Construye el ModeloFEM de la columna en voladizo para un tipo de analisis y una
// axil de compresion P (kN, magnitud; se aplica como -P en FY global).
// =============================================================================
function payloadColumna(
  tipo: "analyze" | "PDelta",
  P: number,
  // checkStatics se pasa para PROBAR que el glue lo IGNORA bajo P-Δ (E6): aunque
  // llegue true en el payload, _check_statics NO debe correr en PDelta.
  checkStatics = false,
): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 }, // base
      { name: "N2", x: 0, y: L, z: 0 }, // cabeza
    ],
    materials: [{ name: "ACERO", E, G, nu: NU, rho: RHO }],
    sections: [{ name: "SEC", A, Iy: IY, Iz: IZ, J }],
    members: [
      {
        name: "C1",
        i: "N1",
        j: "N2",
        material: "ACERO",
        section: "SEC",
        rotation: 0,
        tension_only: false,
        comp_only: false,
        releases: null,
      },
    ],
    // Base empotrada (voladizo). Cabeza libre.
    supports: [
      { node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true },
    ],
    // Carga axil de compresion en cabeza (-Y) y lateral en +X. Casos separados
    // para combinarlos con factor 1 en un unico combo (sin mayorar: comparamos
    // 1.º vs 2.º orden directamente).
    node_loads: [
      { node: "N2", direction: "FY", P: -P, case: "P" }, // compresion
      { node: "N2", direction: "FX", P: H, case: "H" }, // lateral (sway)
    ],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: { P: 1, H: 1 } }],
    analysis: { type: tipo, check_statics: checkStatics },
  };
}

/** Momento en la base = |reaccion de momento RxnMZ en N1| para el combo ELU. */
function momentoBase(res: ResultadosCalculo): number {
  // rxn = [FX, FY, FZ, MX, MY, MZ]; el flector de la columna en su plano XY es MZ.
  return Math.abs(res.nodos["N1"]["ELU"].rxn[5]);
}

// =============================================================================
// Caso CON PLACA (quads): forjado de losa sobre 4 pilares empotrados + carga (corte
// T-f3-masa-placa). PRUEBA que la rama P-Δ del glue YA NO bloquea con panos
// (MotorAnalisisConPanos eliminado): analyze_PDelta(sparse=True) corre con quads
// presentes y devuelve ok:true. El motor SI corre P-Δ con quads (spike
// pdelta_placa_spike.md): los quads aportan rigidez elastica y transmiten carga, y el
// P-Δ amplifica por el axil de los PILARES (PyNite 2.0.2 no da rigidez geometrica al
// quad, pero eso no impide que el analisis corra). Aqui basta el SMOKE (corre + ok);
// la amplificacion y el equilibrio exactos los aserta el golden losa-plana-pdelta (F3).
//
// GEOMETRIA (FEM Y-up, plano de losa X-Z): losa cuadrada 6x6 m a altura Y=H_PILAR sobre
// 4 pilares en las esquinas que bajan a base empotrada en Y=0. Malla 2x2 quads = 3x3
// nudos de losa (los 4 de esquina coinciden con las cabezas de pilar). HA-25 realista.
const LADO_LOSA = 6;
const ESPESOR_LOSA = 0.25;
const H_PILAR = 3; // altura de los pilares (m)
const E_HA25 = 3.1477e7; // kN/m2 (Ecm HA-25 Codigo Estructural)
const NU_HA25 = 0.2;
const G_HA25 = E_HA25 / (2 * (1 + NU_HA25));
const RHO_HA25 = 25; // kN/m3 (PESO especifico)
const Q_SUP = 5; // kN/m2 sobrecarga superficial (gravitatoria, presion POSITIVA)
const H_LAT = 4; // kN carga lateral en +X por cabeza (provoca el sway que P-Δ toca)

function payloadLosaSobrePilares(): ModeloFEM {
  const N = 2; // 2x2 quads
  const h = LADO_LOSA / N;
  const nombre = (ix: number, iz: number): string => `L_${ix}_${iz}`;

  // Nudos de la LOSA (a altura Y=H_PILAR) en el plano X-Z.
  const nodes = [];
  for (let iz = 0; iz <= N; iz++) {
    for (let ix = 0; ix <= N; ix++) {
      nodes.push({ name: nombre(ix, iz), x: ix * h, y: H_PILAR, z: iz * h });
    }
  }
  // Bases de los 4 pilares de esquina (Y=0), empotradas.
  const esquinas: Array<[number, number]> = [
    [0, 0],
    [N, 0],
    [0, N],
    [N, N],
  ];
  const bases = esquinas.map(([ix, iz], k) => ({
    name: `B${k}`,
    x: ix * h,
    y: 0,
    z: iz * h,
  }));
  nodes.push(...bases);

  // Quads de la losa (orden CANONICO i->j->m->n CCW visto desde +Y).
  const quads = [];
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      quads.push({
        name: `Q_${ix}_${iz}`,
        i: nombre(ix, iz),
        j: nombre(ix + 1, iz),
        m: nombre(ix + 1, iz + 1),
        n: nombre(ix, iz + 1),
        t: ESPESOR_LOSA,
        material: "HA25",
      });
    }
  }

  // Pilares: cada base -> su cabeza de esquina de la losa (member vertical en Y).
  const members = esquinas.map(([ix, iz], k) => ({
    name: `P${k}`,
    i: `B${k}`,
    j: nombre(ix, iz),
    material: "HA25",
    section: "PILAR",
    rotation: 0,
    tension_only: false,
    comp_only: false,
    releases: null,
  }));

  // Apoyos: solo las 4 bases empotradas. La losa cuelga de los pilares (sin apoyos
  // propios); los pilares empotrados le dan sujecion sobrada -> P-Δ estable (spike).
  const supports = bases.map((b) => ({
    node: b.name,
    DX: true,
    DY: true,
    DZ: true,
    RX: true,
    RY: true,
    RZ: true,
  }));

  // Carga vertical: presion superficial gravitatoria (POSITIVA = hacia abajo) en cada
  // quad, case "G". Carga lateral en +X en las 4 cabezas, case "H" (sway).
  const quad_loads = quads.map((q) => ({ quad: q.name, presion: Q_SUP, case: "G" }));
  const node_loads = esquinas.map(([ix, iz]) => ({
    node: nombre(ix, iz),
    direction: "FX" as const,
    P: H_LAT,
    case: "H",
  }));

  return {
    units: "kN-m",
    nodes,
    materials: [{ name: "HA25", E: E_HA25, G: G_HA25, nu: NU_HA25, rho: RHO_HA25 }],
    // Pilar 0.30x0.30 (robusto, spike caso A): A, Iy, Iz, J de la seccion cuadrada.
    sections: [{ name: "PILAR", A: 0.09, Iy: 6.75e-4, Iz: 6.75e-4, J: 1.14e-3 }],
    members,
    quads,
    supports,
    node_loads,
    dist_loads: [],
    pt_loads: [],
    quad_loads,
    combos: [{ name: "ELU", factors: { G: 1, H: 1 } }],
    // P-Δ con quads: ya NO se bloquea (MotorAnalisisConPanos eliminado en T1.1).
    analysis: { type: "PDelta", check_statics: false },
  };
}

// -----------------------------------------------------------------------------
// Arranque del motor (politica de skip propia, identica a smoke.test.ts).
// -----------------------------------------------------------------------------
type Arranque =
  | { motor: MotorArrancado; skip: false }
  | { motor: null; skip: true; motivo: string };

let arranque: Arranque | null = null;

async function arrancar(): Promise<Arranque> {
  try {
    const motor = await arrancarMotorNode();
    return { motor, skip: false };
  } catch (e) {
    const motivo = e instanceof ErrorArranquePyodide ? e.message : descr(e);
    return { motor: null, skip: true, motivo };
  }
}

describe("smoke P-Δ: amplificacion real + inestabilidad legible", () => {
  beforeAll(async () => {
    arranque = await arrancar();
    if (arranque.skip) {
      console.warn(`\n[SMOKE P-Δ][SKIP] ${arranque.motivo}\n`);
    }
  }, TIMEOUT_ARRANQUE);

  it(
    "amplifica el momento en base de `analyze` a `pDelta` (columna esbelta con sway)",
    () => {
      if (!arranque || arranque.skip) {
        console.warn(`[SMOKE P-Δ][SKIP] ${arranque?.motivo ?? "no arrancado"}`);
        return;
      }
      // Axil ESTABLE: bien por debajo de la critica (40% de Pcr) para que el
      // 2.º orden amplifique de forma apreciable pero el sistema se sostenga.
      const P = 0.4 * PCR;

      const r1 = arranque.motor.calcular(payloadColumna("analyze", P));
      const r2 = arranque.motor.calcular(payloadColumna("PDelta", P));

      const m1 = momentoBase(r1); // 1.º orden ≈ H·L
      const m2 = momentoBase(r2); // 2.º orden (amplificado)

      // Factor de amplificacion teorico aproximado (cantilever) ≈ 1/(1 - P/Pcr).
      const ampTeor = 1 / (1 - P / PCR);
      console.warn(
        `\n[SMOKE P-Δ][AMPLIFICACION] Pcr=${PCR.toFixed(1)} kN  P=${P.toFixed(1)} kN  ` +
          `M(analyze)=${m1.toFixed(3)}  M(pDelta)=${m2.toFixed(3)}  ` +
          `amp_real=${(m2 / m1).toFixed(3)}  amp_teor≈${ampTeor.toFixed(3)}\n`,
      );

      // El eco del tipo confirma que se ejecuto la rama correcta del glue.
      expect(r1.analysis.type).toBe("analyze");
      expect(r2.analysis.type).toBe("PDelta");

      // 1.º orden ≈ H·L (referencia; tolerancia amplia).
      expect(Math.abs(m1 - H * L) / (H * L)).toBeLessThan(0.05);

      // CLAVE: el momento en base CRECE con P-Δ (amplificacion real por sway).
      expect(m2).toBeGreaterThan(m1);
      // Y crece de forma significativa (no ruido numerico): al 40% de Pcr el
      // factor teorico ronda 1.67; exigimos al menos +20% para ser robustos.
      expect(m2 / m1).toBeGreaterThan(1.2);
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "fuerza check_statics=false bajo P-Δ aunque el payload lo traiga en true (E6)",
    () => {
      if (!arranque || arranque.skip) {
        console.warn(`[SMOKE P-Δ][SKIP] ${arranque?.motivo ?? "no arrancado"}`);
        return;
      }
      const P = 0.4 * PCR;
      // El payload pide check_statics=true; el glue DEBE ignorarlo en PDelta
      // (analyze_PDelta no lo admite y _check_statics no aplica al estado de 2.º
      // orden). El resultado no debe traer comprobacion de equilibrio.
      const r = arranque.motor.calcular(payloadColumna("PDelta", P, true));
      expect(r.analysis.type).toBe("PDelta");
      expect(r.check_statics).toBeNull();
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "traduce la inestabilidad bajo P-Δ a un ErrorMotor legible en lenguaje de obra",
    () => {
      if (!arranque || arranque.skip) {
        console.warn(`[SMOKE P-Δ][SKIP] ${arranque?.motivo ?? "no arrancado"}`);
        return;
      }
      // HALLAZGO (verificado con el motor real, F2.2): con sparse=True (la ruta
      // requerida, CLAUDE.md §8) una inestabilidad GLOBAL (mecanismo, axil sobre la
      // critica de pandeo en un modelo de UNA barra) NO hace lanzar a
      // analyze_PDelta: scipy.spsolve devuelve NaN con un MatrixRankWarning en vez
      // de excepcion (el `raise ValueError(singular)` de PyNite solo cubre el solver
      // DENSO). Ademas, en F2a el P-Δ es de balanceo a nivel nudo (sin subdividir
      // barras, T-pdelta-subdivision): una barra unica no captura el pandeo de Euler
      // como singularidad. Por eso el disparador FIABLE del camino de error es una
      // inestabilidad LOCAL de nudo, que check_stability=True SÍ detecta y lanza.
      //
      // MODELO: la misma columna pero con la rotacion RZ LIBERADA en ambos extremos
      // del unico miembro -> el GDL RZ (y la traslacion X que depende de el) del
      // nudo cabeza queda con rigidez nula y sin apoyo -> "Nodal instability". El
      // glue traduce el Exception de PyNite a la frase de obra. El golden de Fase 3
      // escribira el caso inestable canonico; aqui basta demostrar el error-path.
      const rzLiberada = [
        false, false, false, false, false, true, // extremo i: RZi liberado
        false, false, false, false, false, true, // extremo j: RZj liberado
      ];
      const inestable: ModeloFEM = {
        ...payloadColumna("PDelta", 0.4 * PCR),
        members: [
          {
            name: "C1",
            i: "N1",
            j: "N2",
            material: "ACERO",
            section: "SEC",
            rotation: 0,
            tension_only: false,
            comp_only: false,
            releases: rzLiberada,
          },
        ],
      };

      let lanzo = false;
      let mensaje = "";
      try {
        arranque.motor.calcular(inestable);
      } catch (e) {
        lanzo = true;
        // El closure del arnes (pyodideNode) re-lanza un Error con el `mensaje` del
        // glue embebido en su texto; basta comprobar que aparece la frase de obra
        // (no el texto crudo de PyNite "Unstable node(s)").
        mensaje = descr(e);
      }
      console.warn(
        `\n[SMOKE P-Δ][INESTABLE] (nudo con RZ sin rigidez)  lanzo=${lanzo}\n` +
          `  mensaje: ${mensaje.split("\n").slice(0, 2).join(" | ")}\n`,
      );
      expect(lanzo).toBe(true);
      // Mensaje en lenguaje de obra (el glue lo emite; el arnes lo embebe). NO debe
      // aparecer el texto crudo de PyNite: el glue lo deja solo en `detalle`.
      expect(mensaje).toContain("inestable bajo P-Δ");
      expect(mensaje.toLowerCase()).toContain("arriostramiento");
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "corre P-Δ con PLACAS (quads) presentes sin bloquear (T-f3-masa-placa)",
    () => {
      if (!arranque || arranque.skip) {
        console.warn(`[SMOKE P-Δ][SKIP] ${arranque?.motivo ?? "no arrancado"}`);
        return;
      }
      // Forjado de losa sobre 4 pilares empotrados + carga (gravitatoria + lateral).
      // ANTES el glue bloqueaba P-Δ con panos (MotorAnalisisConPanos); T1.1 lo elimino.
      // El motor SI corre P-Δ con quads (spike pdelta_placa_spike.md): aqui basta con
      // que NO lance y devuelva un resultado por-combo valido (ok:true implicito: el
      // closure `calcular` lanza si el glue devuelve {ok:false} o si el borde Zod falla).
      const r = arranque.motor.calcular(payloadLosaSobrePilares());

      // El eco del tipo confirma que se ejecuto la rama P-Δ (no fallo ni cayo a otra).
      expect(r.analysis.type).toBe("PDelta");
      // check_statics NO aplica bajo P-Δ (el glue lo fuerza a null aunque el payload lo
      // traiga): mismo invariante que el caso de columna sin placas.
      expect(r.check_statics).toBeNull();

      // Sanidad minima: hay reacciones del combo ELU en las bases de pilar y son finitas
      // (si el P-Δ hubiera divergido/lanzado, el closure ya habria hecho throw). No se
      // asertan magnitudes (eso es el golden losa-plana-pdelta): solo que la fisica salio.
      const sumaV = ["B0", "B1", "B2", "B3"].reduce(
        (acc, b) => acc + r.nodos[b]["ELU"].rxn[1], // rxn[1] = FY (vertical)
        0,
      );
      console.warn(`\n[SMOKE P-Δ][PLACA] ok, ΣFY(bases)=${sumaV.toFixed(3)} kN\n`);
      expect(Number.isFinite(sumaV)).toBe(true);
      // El peso propio de la losa + la sobrecarga son gravitatorios (hacia abajo): la
      // reaccion vertical total en las bases es POSITIVA (sostiene la carga). Banda
      // amplia (SMOKE): solo confirma signo y orden de magnitud, no el valor exacto.
      expect(sumaV).toBeGreaterThan(0);
    },
    TIMEOUT_ARRANQUE,
  );
});
