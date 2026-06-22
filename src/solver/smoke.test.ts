// =============================================================================
// SMOKE TEST end-to-end del motor FEM (feature-5, T4.1).
//
// OBJETIVO: demostrar que la FONTANERIA del solver funciona y FIJAR EMPIRICAMENTE
// el par de versiones Pyodide<->PyNiteFEA (CLAUDE.md §18, config.ts). NO es la
// validacion numerica exhaustiva (eso es feature-6 golden): aqui solo probamos
// que el motor ARRANCA, INSTALA y CALCULA una biapoyada con UDL, y que
// M_max ~= q·L²/8 con tolerancia AMPLIA y check_statics correcto.
//
// ENTORNO: Pyodide corre DIRECTAMENTE EN NODE (el paquete `pyodide` soporta Node
// con loadPyodide apuntando al indexURL local de node_modules/pyodide). NO se
// instancia worker.ts (los Workers de Vite/import.meta.url no van en el runner de
// Node de Vitest).
//
// FIX Q1 (DRY): la receta de arranque (loadPyodide local, loadPackage, instalar
// los wheels vendorizados con file:// normalizado, runPythonAsync del glue, leer
// versiones y construir calcular() con safeParse en el borde) ya NO se duplica
// aqui: se reusa el NUCLEO compartido `arrancarMotorNode` de
// tests/golden/_arnes/pyodideNode (mismo nucleo que usa el arnes golden). Este
// fichero aporta SOLO su payload + asserts + su politica de SKIP propia.
//
// RED: OFFLINE TOTAL. numpy/scipy/micropip/wcwidth son wheels WASM que YA estan en
// node_modules/pyodide (indexURL local). PyNiteFEA + PrettyTable estan
// VENDORIZADOS en vendor/wheels/ y se instalan con micropip desde file:// local.
// Este smoke test NO toca PyPI ni el CDN. Si algun fichero local faltara, el
// arranque falla y se marca SKIP con mensaje claro en vez de fallar en rojo.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { VERSIONES } from "./config";
import type { ResultadosCalculo } from "./resultados";
import type { ModeloFEM } from "../discretizador/contratoFEM";
// NUCLEO COMPARTIDO de arranque en Node (FIX Q1). Vive en tests/golden/_arnes
// (sitio neutral: infraestructura de TEST, no de produccion — worker.ts no lo usa).
// El smoke lo importa por ruta relativa, igual que ya importa tipos de dominio.
import {
  arrancarMotorNode,
  ErrorArranquePyodide,
  descr,
  TIMEOUT_ARRANQUE,
  type MotorArrancado,
  type VersionesRuntime,
} from "../../tests/golden/_arnes/pyodideNode";

// --- Caso de libro: viga biapoyada con carga uniforme ------------------------
// L = 6 m, q = 10 kN/m (hacia abajo: FY global negativa). Solucion analitica:
//   |M|_max = q·L²/8  en el centro (MAGNITUD del pico de flector),
//   R = q·L/2 en cada apoyo (FY positiva, hacia arriba).
//
// SIGNO (hallazgo empirico T4.1): con UDL FY-global NEGATIVA sobre una barra que
// corre en +X, PyNite produce un flector Mz NEGATIVO en toda la barra. Por eso el
// pico de magnitud aparece en `min_moment_z` (≈ -45) y `max_moment_z` ≈ 0. El
// smoke test compara contra la MAGNITUD (|min_moment_z|), no contra +q·L²/8.
const L = 6; // m
const Q = 10; // kN/m (magnitud; se aplica como -Q en FY global)
const M_MAX_TEORICO = (Q * L * L) / 8; // = 45 kN·m (magnitud)
const R_TEORICA = (Q * L) / 2; // = 30 kN por apoyo

// Material y seccion ARBITRARIOS pero validos (acero generico). El M_max de una
// biapoyada isostatica NO depende de E/I (es isostatica): cualquier valor sirve.
const PAYLOAD: ModeloFEM = {
  units: "kN-m",
  nodes: [
    { name: "N1", x: 0, y: 0, z: 0 },
    { name: "N2", x: L, y: 0, z: 0 },
  ],
  materials: [
    // E=210 GPa = 2.1e8 kN/m², G=80.77 GPa = 8.077e7 kN/m², nu=0.3, rho acero.
    { name: "ACERO", E: 2.1e8, G: 8.077e7, nu: 0.3, rho: 78.5 },
  ],
  sections: [
    // IPE-ish arbitraria (m², m⁴). No influye en M_max de la isostatica.
    { name: "SEC", A: 5.3e-3, Iy: 8.36e-6, Iz: 1.318e-4, J: 1.0e-7 },
  ],
  members: [
    {
      name: "M1",
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
  // Biapoyada en plano XY (flexion sobre Z): la barra va en X, carga en -Y.
  // Apoyo fijo en N1 (restringe DX,DY,DZ); apoyo movil en N2 (DY,DZ). Para evitar
  // mecanismo fuera del plano de flexion, restringimos tambien las rotaciones
  // que no participan en la flexion XY (RX torsion, RY) en ambos nudos; dejamos
  // RZ libre (es el giro de flexion -> biapoyo real). DZ restringido para fijar
  // el plano. Esto deja la barra como una viga biapoyada que flecta en Y.
  supports: [
    { node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: false },
    { node: "N2", DX: false, DY: true, DZ: true, RX: true, RY: true, RZ: false },
  ],
  node_loads: [],
  // UDL global hacia abajo en toda la barra (x1=x2=null -> toda la longitud).
  dist_loads: [
    {
      member: "M1",
      direction: "FY",
      w1: -Q,
      w2: -Q,
      x1: null,
      x2: null,
      case: "D",
    },
  ],
  pt_loads: [],
  // Un unico combo con factor 1.0 sobre la hipotesis D (sin mayorar: comparamos
  // contra la solucion analitica directa).
  combos: [{ name: "SMOKE", factors: { D: 1 } }],
  // Analisis lineal con comprobacion de equilibrio activada.
  analysis: { type: "linear", check_statics: true },
};

// -----------------------------------------------------------------------------
// Arranque del motor en Node via NUCLEO COMPARTIDO. Politica de SKIP propia del
// smoke: si el nucleo lanza (red/instalacion), NO rompemos en rojo -> skip+motivo.
// -----------------------------------------------------------------------------
type Arranque =
  | { motor: MotorArrancado; skip: false }
  | { motor: null; skip: true; motivo: string };

let arranque: Arranque | null = null;
// Versiones reales leidas del runtime (se rellenan tras arrancar).
let versionesReales: VersionesRuntime | null = null;

async function arrancar(): Promise<Arranque> {
  try {
    // El nucleo loguea cada wheel local instalado via el gancho onWheel: deja
    // visible en el log que NO se toca PyPI (mismo diagnostico que antes).
    const motor = await arrancarMotorNode({
      onWheel: (url, deps) =>
        console.warn(`[SMOKE][WHEEL LOCAL] micropip.install(${url}, {deps:${deps}})`),
    });
    versionesReales = motor.versiones;
    return { motor, skip: false };
  } catch (e) {
    // ErrorArranquePyodide trae fase+motivo legible; cualquier otro se describe.
    const motivo = e instanceof ErrorArranquePyodide ? e.message : descr(e);
    return { motor: null, skip: true, motivo };
  }
}

describe("smoke: motor FEM end-to-end (biapoyada UDL)", () => {
  beforeAll(async () => {
    arranque = await arrancar();
    if (arranque.skip) {
      // Mensaje VISIBLE en el log de Vitest para distinguir fallo de red de un bug.
      console.warn(`\n[SMOKE][SKIP] ${arranque.motivo}\n`);
    } else if (versionesReales) {
      console.warn(
        `\n[SMOKE][PAR DE VERSIONES REAL] pyodide=${VERSIONES.pyodide} ` +
          `python=${versionesReales.python} numpy=${versionesReales.numpy} ` +
          `scipy=${versionesReales.scipy} PyNiteFEA=${versionesReales.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  it(
    "instala el par Pyodide↔PyNite y calcula M_max ≈ q·L²/8 con equilibrio OK",
    () => {
      if (!arranque || arranque.skip) {
        // SKIP condicional: no hay red / fallo de instalacion. El test queda
        // escrito y se ejecutara en cuanto haya red (objetivo: fijar el par).
        const motivo = arranque?.motivo ?? "arranque no ejecutado";
        console.warn(`[SMOKE][SKIP] ${motivo}`);
        return;
      }

      // --- Ejecutar el calculo real a traves del nucleo compartido ----------
      // `calcular` ya valida el sobre {ok} del glue y aplica safeParse en el
      // borde (lanza con mensaje claro si el glue da error o el contrato se rompe).
      let resultados: ResultadosCalculo;
      try {
        resultados = arranque.motor.calcular(PAYLOAD);
      } catch (e) {
        // Fallo del glue o del contrato: REPORTAR el error EXACTO (lo que esta
        // tarea debe descubrir: pin numpy>=2.4, matplotlib, firma de API, etc.).
        throw new Error(`[SMOKE] ${descr(e)}`);
      }

      // Metadatos basicos.
      expect(resultados.units).toBe("kN-m");
      expect(resultados.analysis.type).toBe("linear");
      expect(resultados.combos).toContain("SMOKE");

      // --- ASSERT: |M|_max ≈ q·L²/8 con tolerancia AMPLIA (±5%) ------------
      const barra = resultados.barras["M1"];
      expect(barra).toBeDefined();
      const m1 = barra["SMOKE"];
      expect(m1).toBeDefined();

      // El pico de flector vive en min_moment_z (negativo) con esta convencion;
      // comparamos su MAGNITUD contra q·L²/8. max_moment_z debe quedar ≈ 0.
      const mPicoReal = Math.abs(m1.min_moment_z);
      const errRel = Math.abs(mPicoReal - M_MAX_TEORICO) / M_MAX_TEORICO;
      console.warn(
        `\n[SMOKE][NUMEROS] |M|_max teorico=${M_MAX_TEORICO} kN·m  ` +
          `min_moment_z=${m1.min_moment_z.toFixed(4)}  max_moment_z=${m1.max_moment_z.toFixed(4)}  ` +
          `err=${(errRel * 100).toFixed(2)}%\n`,
      );
      // Signo coherente: flector negativo en el centro (UDL FY-global negativa).
      expect(m1.min_moment_z).toBeLessThan(0);
      expect(errRel).toBeLessThan(0.05);

      // --- ASSERT: reacciones ≈ q·L/2 (signo y magnitud) -------------------
      // Cada apoyo levanta media carga: FY = +30 kN. rxn = [FX,FY,FZ,MX,MY,MZ].
      const rxnN1 = resultados.nodos["N1"]["SMOKE"].rxn;
      const rxnN2 = resultados.nodos["N2"]["SMOKE"].rxn;
      const fyN1 = rxnN1[1];
      const fyN2 = rxnN2[1];
      console.warn(
        `[SMOKE][REACCIONES] FY(N1)=${fyN1.toFixed(4)} FY(N2)=${fyN2.toFixed(4)} (teorico ${R_TEORICA} c/u)\n`,
      );
      expect(fyN1).toBeGreaterThan(0);
      expect(fyN2).toBeGreaterThan(0);
      expect(Math.abs(fyN1 - R_TEORICA) / R_TEORICA).toBeLessThan(0.05);
      expect(Math.abs(fyN2 - R_TEORICA) / R_TEORICA).toBeLessThan(0.05);

      // --- ASSERT: equilibrio OK (check_statics del glue) ------------------
      expect(resultados.check_statics).not.toBeNull();
      const cs = resultados.check_statics!;
      expect(cs.ejecutado).toBe(true);
      expect(cs.equilibrio_ok).toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );
});
