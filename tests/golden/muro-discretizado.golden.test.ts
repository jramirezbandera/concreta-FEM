// =============================================================================
// GOLDEN de INTEGRACION de MURO/PANTALLA (F3, muros) — discretizar() REAL -> motor REAL.
//
// El golden de GATE (muro-voladizo) monta la Capa 2 A MANO: nunca ejercita la que
// produce el DISCRETIZADOR (leccion durable del corte 1: el signo de la presion de
// losa fue invisible al GATE). Este golden cierra el hueco de extremo a extremo:
// obra (Capa 1) -> discretizar() REAL -> PyNite REAL, y afirma la FISICA:
//
//   1) El acople FUNCIONA: un portico (2 pilares + viga) con una pantalla bajo la
//      viga de coronacion resuelve, pasa check_statics, y la viga cargada flecta
//      hacia ABAJO pero MUCHO menos que sin muro (la pantalla la recoge en continuo).
//   2) La CARGA BAJA por el muro: la suma de reacciones verticales de los apoyos de
//      base del muro recoge la mayor parte de la carga de la viga.
//   3) EQUILIBRIO global exacto: SumaV de TODAS las reacciones = carga aplicada.
//   4) PESO PROPIO NODAL de extremo a extremo: activar incluirPesoPropio con muro
//      añade EXACTAMENTE rho*t*L*H a la SumaV respecto al mismo modelo sin muro
//      (el peso del muro viaja como node_loads FY-, spike P5).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { discretizar } from "../../src/discretizador";
import type { ResultadosCalculo } from "../../src/solver/resultados";
import type { Modelo } from "../../src/dominio";
import { SCHEMA_VERSION, ID_HIP_PESO_PROPIO } from "../../src/dominio";

const L = 4.0; // m (luz de la viga = longitud del muro)
const H = 3.0; // m (altura de planta = del muro)
const ESPESOR = 0.3; // m
const RHO_HA = 25.0; // kN/m³
const W_VIGA = -20.0; // kN/m (carga lineal gravitatoria sobre la viga)

// Portico canonico: 2 pilares empotrados en (0,0) y (4,0), viga de coronacion en p1
// y (opcional) la pantalla bajo ella. `conMuro`/`conPesoPropio` parametrizan los
// gemelos de los asserts diferenciales.
function modeloPortico(opts: { conMuro: boolean; conPesoPropio: boolean; conCarga: boolean }): Modelo {
  const { conMuro, conPesoPropio, conCarga } = opts;
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: H, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: H, altura: H, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: "sec-ipe", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: L, y: 0 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: "sec-ipe", materialId: "S275", angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil2", nombre: "P2", x: L, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: "sec-ipe", materialId: "S275", angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    ],
    vigas: [
      {
        id: "v1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: "sec-ipe", materialId: "S275",
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
    ],
    panos: [],
    muros: conMuro
      ? [
          {
            id: "mu1", nombre: "M1",
            x1: 0, y1: 0, x2: L, y2: 0,
            plantaInicial: "p0", plantaFinal: "p1",
            espesor: ESPESOR, materialId: "HA-25", tamMalla: 1,
            vinculacionExterior: true,
          },
        ]
      : [],
    cargas: conCarga
      ? [{ id: "c1", tipo: "lineal", ambito: "v1", valor: W_VIGA, hipotesisId: "h1" }]
      : [],
    hipotesis: [
      { id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false },
      { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: conPesoPropio },
  };
}

// Suma de reacciones verticales (FY) de TODOS los nudos con apoyo en un combo.
function sumaV(res: ResultadosCalculo, combo: string): number {
  let suma = 0;
  for (const nombre of Object.keys(res.nodos)) {
    const rxn = res.nodos[nombre][combo]?.rxn;
    if (rxn) suma += rxn[1];
  }
  return suma;
}

describe("golden muro discretizado Capa B (obra -> discretizar -> motor real)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-MURO-INT][SKIP] ${arranque.motivo}\n`);
    }
  }, TIMEOUT_ARRANQUE);

  it(
    "1-3) la pantalla recoge la viga: equilibrio exacto, rigidizacion y carga por el muro",
    () => {
      if (!arranque || !arranque.ok) return;

      // --- SIN muro (referencia): viga biempotrada entre pilares -------------
      const dSin = discretizar(modeloPortico({ conMuro: false, conPesoPropio: false, conCarga: true }));
      expect(dSin.ok, dSin.ok ? "" : JSON.stringify(dSin)).toBe(true);
      if (!dSin.ok) return;
      const rSin = arranque.motor.calcular(dSin.modeloFEM);

      // --- CON muro: la misma viga descansa en continuo sobre la pantalla ----
      const dCon = discretizar(modeloPortico({ conMuro: true, conPesoPropio: false, conCarga: true }));
      expect(dCon.ok, dCon.ok ? "" : JSON.stringify(dCon)).toBe(true);
      if (!dCon.ok) return;
      const rCon = arranque.motor.calcular(dCon.modeloFEM);

      // check_statics del glue con quads presentes (sin quad_loads: el muro no los usa).
      expect(rCon.check_statics?.equilibrio_ok).toBe(true);

      const total = Math.abs(W_VIGA) * L; // 80 kN

      // 3) EQUILIBRIO global exacto en ELS (factor 1.0) en ambos modelos.
      expect(Math.abs(sumaV(rSin, "ELS") - total) / total).toBeLessThan(1e-6);
      expect(Math.abs(sumaV(rCon, "ELS") - total) / total).toBeLessThan(1e-6);

      // 1) RIGIDIZACION: DY del centro de vano (nudo N* en (2, 3, 0), que con muro
      // nace de la subdivision de la viga). Sin muro ese nudo NO existe (la viga no
      // se subdivide): se compara la flecha maxima de la viga (centro) contra la del
      // nudo compartido con muro.
      const nodoCentroCon = dCon.modeloFEM.nodes.find(
        (n) => n.x === L / 2 && n.y === H && n.z === 0,
      );
      expect(nodoCentroCon).toBeDefined();
      const dyCon = rCon.nodos[nodoCentroCon!.name]["ELS"].disp[1];
      // Sin muro no existe nudo a mitad de vano (la viga no se subdivide): se toma la
      // flecha REAL maxima del member (min del diagrama defl_y = [xs, valores]).
      const memberViga = dSin.trazabilidad.vigaAMembers["v1"][0];
      const dySinArr = rSin.barras[memberViga]["ELS"].defl_y;
      const dySinMin = Math.min(...dySinArr[1]);
      expect(dySinMin).toBeLessThan(0); // hacia abajo
      expect(dyCon).toBeLessThan(0); // hacia abajo tambien
      // La pantalla en continuo rigidiza la viga en ordenes de magnitud.
      expect(Math.abs(dyCon)).toBeLessThan(0.05 * Math.abs(dySinMin));

      // 2) La CARGA BAJA por el muro: reacciones de los apoyos de base PROPIOS del
      // muro (trazabilidad.apoyosDeMalla) recogen la mayor parte del total (el resto
      // baja por los pilares, fusionados con las esquinas del muro).
      let sumaMuro = 0;
      for (const nombre of dCon.trazabilidad.apoyosDeMalla) {
        const rxn = rCon.nodos[nombre]["ELS"]?.rxn;
        if (rxn) sumaMuro += rxn[1];
      }
      expect(sumaMuro).toBeGreaterThan(0.5 * total);
    },
    180_000,
  );

  it(
    "4) peso propio nodal de extremo a extremo: SumaV(con muro) - SumaV(sin muro) = rho*t*L*H",
    () => {
      if (!arranque || !arranque.ok) return;

      const dSin = discretizar(modeloPortico({ conMuro: false, conPesoPropio: true, conCarga: false }));
      expect(dSin.ok).toBe(true);
      if (!dSin.ok) return;
      const rSin = arranque.motor.calcular(dSin.modeloFEM);

      const dCon = discretizar(modeloPortico({ conMuro: true, conPesoPropio: true, conCarga: false }));
      expect(dCon.ok).toBe(true);
      if (!dCon.ok) return;
      const rCon = arranque.motor.calcular(dCon.modeloFEM);

      const pesoMuro = RHO_HA * ESPESOR * L * H; // 90 kN
      const delta = sumaV(rCon, "ELS") - sumaV(rSin, "ELS");
      expect(Math.abs(delta - pesoMuro) / pesoMuro).toBeLessThan(1e-6);
    },
    180_000,
  );

  it(
    "5) el modal CORRE con muro y rigidiza: f1 con pantalla > f1 sin pantalla",
    () => {
      if (!arranque || !arranque.ok) return;
      // La masa del muro la fabrica el glue (_agregar_masa_quads, agnostico a la
      // orientacion); su rigidez de membrana entra en K. No se replica Leissa aqui:
      // solo se asevera que el camino modal corre con muros y que la pantalla
      // RIGIDIZA el modo fundamental (el portico solo es mucho mas blando lateral).
      const dSin = discretizar(
        modeloPortico({ conMuro: false, conPesoPropio: true, conCarga: false }),
        { modal: { numModos: 3 } },
      );
      expect(dSin.ok).toBe(true);
      if (!dSin.ok) return;
      const rSin = arranque.motor.calcularModal(dSin.modeloFEM);

      const dCon = discretizar(
        modeloPortico({ conMuro: true, conPesoPropio: true, conCarga: false }),
        { modal: { numModos: 3 } },
      );
      expect(dCon.ok).toBe(true);
      if (!dCon.ok) return;
      const rCon = arranque.motor.calcularModal(dCon.modeloFEM);

      expect(rSin.frecuencias.length).toBeGreaterThan(0);
      expect(rCon.frecuencias.length).toBeGreaterThan(0);
      const f1Sin = rSin.frecuencias[0];
      const f1Con = rCon.frecuencias[0];
      expect(f1Sin).toBeGreaterThan(0);
      expect(f1Con).toBeGreaterThan(f1Sin); // la pantalla sube la frecuencia fundamental
    },
    180_000,
  );
});
