// =============================================================================
// GOLDEN de MURO/PANTALLA (F3, muros) — GATE del motor de membrana.
//
// Es el guardian del muro como elemento de RIGIDEZ LATERAL: verifica, con el MOTOR
// REAL PyNite (Capa B, sin mocks), que un muro mallado con quads en su plano
// VERTICAL trabaja como pantalla (membrana en plano), con las convenciones que el
// spike F0 pinno empiricamente (src/solver/spikes/muro_membrana_spike.md):
//
//   1) MAGNITUD de la rigidez de membrana: voladizo ESBELTO (L=1.5, H=6, flexion
//      domina) con carga lateral EN PLANO en coronacion vs Timoshenko
//      d = PH³/3EI + k·PH/GA (k=1.2). El spike midio err -1.62% a malla h=L/6:
//      TOL_REL = 2.6% (err + margen local<->Pyodide).
//   2) Regimen de CORTANTE: voladizo ACHAPARRADO (L=4, H=3, el regimen real de una
//      pantalla) vs la misma referencia. Spike: -0.77% a h=0.5 -> TOL 5%.
//   3) ESTABILIDAD (drilling): base empotrada 6 GDL + nudos interiores solo-quad
//      resuelven sin singularidad y SIN reacciones parasitas (spike P3: drilling y
//      fuera-de-plano = 0.0 exactos; aqui tolerancia numerica).
//   4) EQUILIBRIO lateral: SumaFX de reacciones de base = -P.
//
// La Capa 2 se monta A MANO (igual que placa.golden): este golden prueba el GLUE +
// el elemento; la Capa 2 del discretizador la cubre muro-capa2 (estructura) y
// muro-discretizado (fisica de extremo a extremo).
//
// Orden de nudos i,j,m,n = el del PLAN (col = s ascendente, fila = cota ascendente):
// la fuente de Quad3D da y_local = +Y (vertical) con este orden — NO cambiarlo sin
// re-spikear (fija los ejes de la membrana para F6/resultados).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";

// --- Material: HA-25 REAL del proyecto (Codigo Estructural, biblioteca/hormigon) --
const FCK_MPA = 25.0;
const ECM_MPA = 22000.0 * ((FCK_MPA + 8.0) / 10.0) ** 0.3; // ~31476 MPa
const E = ECM_MPA * 1.0e3; // kN/m²
const NU = 0.2;
const G = E / (2 * (1 + NU));
const RHO = 25.0; // kN/m³ (no interviene: sin peso propio aqui)
const KAPPA = 1.2; // factor de cortante de seccion rectangular

const ESPESOR = 0.3; // m
const P_LATERAL = 100.0; // kN (total, repartida en la fila de coronacion)

// Tolerancias PINADAS por el spike F0 (no las relajes sin re-spikear).
const TOL_ESBELTO = 0.026; // err real -1.62% a h=L/6, +60% margen
const TOL_ACHAPARRADO = 0.05; // err real -0.77% a h=0.5

// Referencia de Timoshenko del voladizo con carga puntual en cabeza.
function deltaTimoshenko(L: number, H: number, t: number, P: number): number {
  const I = (t * L ** 3) / 12;
  const A = t * L;
  return (P * H ** 3) / (3 * E * I) + (KAPPA * P * H) / (G * A);
}

// -----------------------------------------------------------------------------
// Monta la Capa 2 de un muro voladizo en el plano FEM X-Y (muro segun obra-X):
// rejilla ncols x nfilas de nudos W_<col>_<fila>, quads con el orden canonico del
// plan, base (fila 0) empotrada 6 GDL, carga lateral FX = P/ncols en cada nudo de
// la fila de coronacion (case "LAT").
// -----------------------------------------------------------------------------
function modeloFEMMuroVoladizo(opts: {
  L: number;
  H: number;
  h: number; // tam de celda (malla cuadrada)
}): { fem: ModeloFEM; nx: number; ny: number; nombre: (c: number, f: number) => string } {
  const { L, H, h } = opts;
  const nx = Math.round(L / h);
  const ny = Math.round(H / h);
  const nombre = (col: number, fila: number) => `W_${col}_${fila}`;

  const nodes: ModeloFEM["nodes"] = [];
  for (let fila = 0; fila <= ny; fila++) {
    for (let col = 0; col <= nx; col++) {
      nodes.push({ name: nombre(col, fila), x: (col * L) / nx, y: (fila * H) / ny, z: 0 });
    }
  }

  const quads: NonNullable<ModeloFEM["quads"]> = [];
  for (let fila = 0; fila < ny; fila++) {
    for (let col = 0; col < nx; col++) {
      quads.push({
        name: `Q_${col}_${fila}`,
        i: nombre(col, fila),
        j: nombre(col + 1, fila),
        m: nombre(col + 1, fila + 1),
        n: nombre(col, fila + 1),
        t: ESPESOR,
        material: "HA25",
      });
    }
  }

  // Base empotrada 6 GDL (espejo del Paso 6e con vinculacionExterior).
  const supports: ModeloFEM["supports"] = [];
  for (let col = 0; col <= nx; col++) {
    supports.push({
      node: nombre(col, 0),
      DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true,
    });
  }

  // Carga lateral EN PLANO: FX repartida uniforme en la fila de coronacion.
  const node_loads: ModeloFEM["node_loads"] = [];
  for (let col = 0; col <= nx; col++) {
    node_loads.push({
      node: nombre(col, ny),
      direction: "FX",
      P: P_LATERAL / (nx + 1),
      case: "LAT",
    });
  }

  const fem: ModeloFEM = {
    units: "kN-m",
    nodes,
    materials: [{ name: "HA25", E, G, nu: NU, rho: RHO }],
    sections: [],
    members: [],
    quads,
    supports,
    node_loads,
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "LAT", factors: { LAT: 1.0 } }],
    analysis: { type: "linear", check_statics: false },
  };
  return { fem, nx, ny, nombre };
}

describe("golden muro voladizo Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-MURO][SKIP] ${arranque.motivo}\n`);
    }
  }, TIMEOUT_ARRANQUE);

  it(
    "B1) voladizo ESBELTO (L=1.5 H=6, h=0.25): d_tip ≈ Timoshenko (TOL 2.6%, spike)",
    () => {
      if (!arranque || !arranque.ok) return;
      const L = 1.5;
      const H = 6.0;
      const { fem, nx, ny, nombre } = modeloFEMMuroVoladizo({ L, H, h: 0.25 });
      const res = arranque.motor.calcular(fem);
      // d_tip = media de DX de la fila de coronacion (la carga es +X).
      let suma = 0;
      for (let col = 0; col <= nx; col++) {
        suma += res.nodos[nombre(col, ny)]["LAT"].disp[0];
      }
      const dTip = suma / (nx + 1);
      const dRef = deltaTimoshenko(L, H, ESPESOR, P_LATERAL);
      expect(dTip).toBeGreaterThan(0); // hacia +X, con la carga
      const errRel = Math.abs(dTip - dRef) / dRef;
      expect(
        errRel,
        `d_tip=${(dTip * 1e3).toFixed(4)}mm vs ref=${(dRef * 1e3).toFixed(4)}mm errRel=${errRel.toFixed(4)}`,
      ).toBeLessThan(TOL_ESBELTO);
    },
    120_000,
  );

  it(
    "B2) voladizo ACHAPARRADO (L=4 H=3, h=0.5): cortante domina, d_tip ≈ Timoshenko (TOL 5%)",
    () => {
      if (!arranque || !arranque.ok) return;
      const L = 4.0;
      const H = 3.0;
      const { fem, nx, ny, nombre } = modeloFEMMuroVoladizo({ L, H, h: 0.5 });
      const res = arranque.motor.calcular(fem);
      let suma = 0;
      for (let col = 0; col <= nx; col++) {
        suma += res.nodos[nombre(col, ny)]["LAT"].disp[0];
      }
      const dTip = suma / (nx + 1);
      const dRef = deltaTimoshenko(L, H, ESPESOR, P_LATERAL);
      const errRel = Math.abs(dTip - dRef) / dRef;
      expect(
        errRel,
        `d_tip=${(dTip * 1e3).toFixed(4)}mm vs ref=${(dRef * 1e3).toFixed(4)}mm errRel=${errRel.toFixed(4)}`,
      ).toBeLessThan(TOL_ACHAPARRADO);
    },
    120_000,
  );

  it(
    "B5) membrana [Sx,Sy,Txy]: TENSION kN/m² con Sy vertical — Sy(esquinas base) ≈ ±6M/(t·L²), flexion pura sin momentos de placa",
    () => {
      if (!arranque || !arranque.ok) return;
      const L = 1.5;
      const H = 6.0;
      const { fem, nx } = modeloFEMMuroVoladizo({ L, H, h: 0.25 });
      const res = arranque.motor.calcular(fem);
      const quads = res.quads ?? {};
      // Referencia de viga: tension de borde en la base, M = P·H.
      const syRef = (6 * P_LATERAL * H) / (ESPESOR * L ** 2);
      // Esquina i (xi,eta=-1,-1) del quad inferior-izquierdo = esquina de base s=0;
      // esquina j (1,-1) del inferior-derecho = s=L. membrane = [[Sx,Sy,Txy] x4 i,j,m,n].
      const mem0 = quads[`Q_0_0`]["LAT"].membrane;
      const memL = quads[`Q_${nx - 1}_0`]["LAT"].membrane;
      expect(mem0).toBeDefined();
      expect(memL).toBeDefined();
      const sy0 = mem0![0][1]; // esquina i, componente Sy
      const syL = memL![1][1]; // esquina j, componente Sy
      // Signos opuestos (traccion en s=0 con carga +X, spike P2b) y magnitud ≈ ref
      // (la esquina empotrada concentra ~+5%; banda [0.9, 1.25] pinada del spike).
      expect(sy0).toBeGreaterThan(0);
      expect(syL).toBeLessThan(0);
      expect(Math.abs(sy0) / syRef).toBeGreaterThan(0.9);
      expect(Math.abs(sy0) / syRef).toBeLessThan(1.25);
      expect(Math.abs(syL) / syRef).toBeGreaterThan(0.9);
      expect(Math.abs(syL) / syRef).toBeLessThan(1.25);
      // Flexion EN PLANO pura: los momentos de PLACA (fuera de plano) son ~0 — el
      // muro trabaja como membrana, no como losa.
      let maxMomento = 0;
      for (const q of Object.values(quads)) {
        for (const esquina of q["LAT"].moments) {
          for (const v of esquina) maxMomento = Math.max(maxMomento, Math.abs(v));
        }
      }
      expect(maxMomento).toBeLessThan(1e-6 * syRef);
    },
    120_000,
  );

  it(
    "B3+B4) estabilidad y equilibrio: sin reacciones parasitas (drilling MZ, fuera de plano FZ) y SumaFX = -P",
    () => {
      if (!arranque || !arranque.ok) return;
      const L = 4.0;
      const H = 3.0;
      const { fem, nx, nombre } = modeloFEMMuroVoladizo({ L, H, h: 0.5 });
      const res = arranque.motor.calcular(fem);
      let sumaFX = 0;
      let maxFZ = 0;
      let maxMZ = 0;
      let maxFY = 0;
      for (let col = 0; col <= nx; col++) {
        const rxn = res.nodos[nombre(col, 0)]["LAT"].rxn;
        expect(rxn).not.toBeNull();
        if (rxn === null) continue;
        sumaFX += rxn[0];
        maxFY = Math.max(maxFY, Math.abs(rxn[1]));
        maxFZ = Math.max(maxFZ, Math.abs(rxn[2]));
        maxMZ = Math.max(maxMZ, Math.abs(rxn[5]));
      }
      // Equilibrio lateral: la base recoge toda la carga en plano.
      expect(Math.abs(sumaFX + P_LATERAL) / P_LATERAL).toBeLessThan(1e-6);
      // Parasitas: fuera de plano (FZ) y drilling (MZ, giro alrededor de la normal)
      // despreciables frente a las reacciones de membrana FY (el par de vuelco).
      // El spike midio 0.0 exactos; aqui se acota con margen numerico.
      expect(maxFZ).toBeLessThan(1e-6 * Math.max(maxFY, 1));
      expect(maxMZ).toBeLessThan(1e-6 * Math.max(maxFY, 1));
    },
    120_000,
  );
});
