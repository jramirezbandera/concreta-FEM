// =============================================================================
// GOLDEN de INTEGRACION de PLACA (F3 corte 1) — discretizar() REAL -> motor REAL.
//
// El golden de GATE (`placa.golden.test.ts`) monta la Capa 2 (quads/quad_loads) A MANO
// para probar el GLUE y el contrato de resultados. Eso deja un HUECO: NUNCA ejercita la
// Capa 2 que produce el DISCRETIZADOR. En concreto, el SIGNO de la presion lo decide el
// discretizador (peso propio = ρ·t; carga superficial = magnitud), y la convencion de
// quad es OPUESTA a la FY de barras (en quad, presion POSITIVA = hacia abajo). Un signo
// invertido alli daria una losa que flecta hacia ARRIBA — estable pero MAL — y el golden
// de GATE no lo veria (monta su presion con signo propio).
//
// Este golden CIERRA el hueco: construye una losa de OBRA (Capa 1), la pasa por
// `discretizar()` REAL y por el motor REAL PyNite, y afirma que la losa flecta hacia
// ABAJO (DY < 0 en el centro de la malla) bajo carga gravitatoria + peso propio. Es la
// red de seguridad de extremo a extremo del signo (CLAUDE.md §13: golden del PIPELINE).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { discretizar } from "../../src/discretizador";
import type { Modelo } from "../../src/dominio";

// Losa cuadrada 4×4 m AISLADA, apoyo simple, hormigon HA-25 (ρ=25 kN/m³), en una planta a
// cota 0. Carga: peso propio (ρ·t) + una superficial gravitatoria. Sin pilares/vigas: una
// losa con bordeApoyo≠"libre" es sujecion suficiente (validarSujecion la reconoce).
const LADO = 4.0; // m
const ESPESOR = 0.25; // m
const TAM_MALLA = 1.0; // m -> 4×4 = 16 quads, 5×5 = 25 nudos
const CX = LADO / 2; // centroide X de la losa (obra y FEM coinciden: mapearEjes)
const CZ = LADO / 2; // centroide Z FEM (= y de obra)

function modeloLosaAislada(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: 3,
    grupos: [
      { id: "g1", nombre: "Grupo 1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ],
    plantas: [{ id: "p1", nombre: "Planta 1", cota: 0, altura: 3, grupoId: "g1" }],
    secciones: [],
    nudos: [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: LADO, y: 0 },
      { id: "q3", x: LADO, y: LADO },
      { id: "q4", x: 0, y: LADO },
    ],
    pilares: [],
    vigas: [],
    panos: [
      {
        id: "losa1",
        nombre: "Losa 1",
        tipo: "losa",
        plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: ESPESOR,
        materialId: "HA-25",
        tamMalla: TAM_MALLA,
        bordeApoyo: "simple",
      },
    ],
    muros: [],
    // Carga superficial gravitatoria sobre la losa (kN/m²), en la hipotesis permanente.
    cargas: [{ id: "c1", tipo: "superficial", ambito: "losa1", valor: 5, hipotesisId: "h1" }],
    hipotesis: [
      { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
      { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: false, incluirPesoPropio: true },
  };
}

describe("golden integracion placa (discretizar real -> motor real)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) console.warn(`\n[GOLDEN-PLACA-INT][SKIP] ${arranque.motivo}\n`);
  }, TIMEOUT_ARRANQUE);

  it(
    "una losa de obra mallada por discretizar() flecta hacia ABAJO (DY<0) en el centro",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA-INT][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }

      // 1) discretizar() REAL: Capa 1 (losa de obra) -> Capa 2 (quads + quad_loads).
      const res = discretizar(modeloLosaAislada());
      if (!res.ok) throw new Error("discretizar fallo: " + JSON.stringify(res.errores));
      expect(res.modeloFEM.quads, "la Capa 2 de la losa lleva quads").toBeDefined();
      expect(res.modeloFEM.quad_loads, "la Capa 2 de la losa lleva quad_loads").toBeDefined();
      // El signo lo decide el discretizador: la presion de quad gravitatoria es POSITIVA.
      for (const ql of res.modeloFEM.quad_loads!) {
        expect(ql.presion, "presion de quad gravitatoria POSITIVA (hacia abajo)").toBeGreaterThan(0);
      }

      // 2) motor REAL: misma ruta `analyze` que un portico (los quads van en el payload).
      const r = arranque.motor.calcular(res.modeloFEM);
      expect(r.quads, "el resultado de la losa lleva `quads`").toBeDefined();

      // 3) Nudo de malla mas cercano al centroide de la losa (en X-Z FEM).
      const meshNodes = res.modeloFEM.nodes.filter((n) =>
        res.trazabilidad.nodosDeMalla.includes(n.name),
      );
      expect(meshNodes.length, "la losa genero nudos de malla").toBeGreaterThan(0);
      let centro = meshNodes[0];
      let best = Infinity;
      for (const n of meshNodes) {
        const d = (n.x - CX) ** 2 + (n.z - CZ) ** 2;
        if (d < best) {
          best = d;
          centro = n;
        }
      }

      // 4) EL ASSERT QUE CAZA EL SIGNO: en TODA combinacion (todas gravitatorias), el
      //    centro de la losa flecta hacia ABAJO (DY < 0). Un signo de presion invertido
      //    en el discretizador daria DY > 0 (la losa "sube") y este test fallaria.
      for (const combo of r.combos) {
        const dy = r.nodos[centro.name][combo].disp[1]; // disp = [DX,DY,DZ,RX,RY,RZ]
        expect(dy, `combo ${combo}: centro de losa flecta hacia abajo (DY<0); real=${dy}`).toBeLessThan(0);
      }

      // 5) Refuerzo: el centro es (de los nudos de malla) el de MAYOR flecha hacia abajo
      //    en la combinacion de servicio (la losa SS flecta maximo en el centro).
      const comboServicio = r.combos[r.combos.length - 1];
      let dyMin = Infinity;
      for (const n of meshNodes) {
        dyMin = Math.min(dyMin, r.nodos[n.name][comboServicio].disp[1]);
      }
      const dyCentro = r.nodos[centro.name][comboServicio].disp[1];
      expect(
        dyCentro,
        "el centro es (cerca de) el nudo de mayor flecha hacia abajo",
      ).toBeLessThan(0.5 * dyMin); // dyMin < 0; el centro esta cerca del minimo
    },
    TIMEOUT_ARRANQUE,
  );
});
