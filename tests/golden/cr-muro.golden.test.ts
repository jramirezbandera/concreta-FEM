// =============================================================================
// GOLDEN del CENTRO DE RIGIDEZ CON MUROS (F3, muros) — EL punto del corte.
//
// Una pantalla domina la rigidez lateral del edificio: el CR debe IRSE al muro.
// El spike F0 (P4) lo verifico con el mecanismo replicado a mano: x_cr paso de
// 6.000 (solo pilares) a 0.011 (pantalla en x=0). Este golden lo verifica de
// EXTREMO A EXTREMO con el camino REAL: obra (Capa 1) -> prepararModeloCR REAL
// (que ahora emite la malla de MUROS en la base, revision de la decision 3A) ->
// glue `calcular_cr` REAL (sin cambios: build_model ya monta quads).
//
// Leccion durable de F2-CR: el ship-blocker de def_support se escapo porque el
// golden montaba plantasInfo A MANO — SIEMPRE testear el camino prepararModeloCR
// -> calcularCR. Aqui se hace asi desde el principio.
//
// MODELO (espejo del spike P4): 3 plantas (0,3,6); 2 pilares empotrados en obra
// (6,0) y (6,4); pantalla t=0.30 segun obra-Y en x=0 de (0,0) a (0,4), de p0 a p2,
// tamMalla 0.5 (8x12 = 96 quads), base vinculada.
//
// ASSERTS:
//   1) prepararModeloCR emite la malla del muro (quads MQ) y sus nudos entran en
//      plantasInfo de las plantas elevadas.
//   2) CON muro: x_cr ≈ 0 (el CR se va a la pantalla) y z_cr ≈ 2 (su centro);
//      la planta de cimentacion sigue null (no determinable).
//   3) SIN muro (regresion): x_cr ≈ 6 (eje de los pilares; dos pilares colineales
//      NO degeneran: resisten el giro por su GJ propia, hallazgo F2-CR), sin clave
//      quads y sin nudos MQ en plantasInfo.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { prepararModeloCR } from "../../src/discretizador";
import type { Modelo } from "../../src/dominio";
import { SCHEMA_VERSION } from "../../src/dominio";

const X_PILARES = 6.0;
const L_MURO = 4.0; // segun obra-Y, de (0,0) a (0,4)
const COTAS = [0, 3, 6] as const;

function modeloEdificio(conMuro: boolean): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: COTAS[0], altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: COTAS[1], altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p2", nombre: "Planta 2", cota: COTAS[2], altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: "sec-ipe", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" },
    ],
    nudos: [],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: X_PILARES, y: 0,
        plantaInicial: "p0", plantaFinal: "p2",
        seccionId: "sec-ipe", materialId: "S275", angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil2", nombre: "P2", x: X_PILARES, y: L_MURO,
        plantaInicial: "p0", plantaFinal: "p2",
        seccionId: "sec-ipe", materialId: "S275", angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    ],
    vigas: [],
    panos: [],
    muros: conMuro
      ? [
          {
            id: "mu1", nombre: "M1",
            x1: 0, y1: 0, x2: 0, y2: L_MURO,
            plantaInicial: "p0", plantaFinal: "p2",
            espesor: 0.3, materialId: "HA-25", tamMalla: 0.5,
            vinculacionExterior: true,
          },
        ]
      : [],
    cargas: [],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: false, incluirPesoPropio: false },
  };
}

describe("golden CR con muros Capa B (prepararModeloCR real -> calcular_cr real)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-CR-MURO][SKIP] ${arranque.motivo}\n`);
    }
  }, TIMEOUT_ARRANQUE);

  it("1) prepararModeloCR emite la malla del muro y sus nudos entran en plantasInfo", () => {
    const prep = prepararModeloCR(modeloEdificio(true));
    expect(prep.ok, prep.ok ? "" : JSON.stringify(prep)).toBe(true);
    if (!prep.ok) return;
    // La base del CR lleva los quads del muro (8 cols x 12 filas = 96).
    expect(prep.modeloFEM.quads).toHaveLength(96);
    // plantasInfo de las plantas elevadas incluye nudos MQ del muro (la fila de su
    // cota); la de cimentacion tambien tiene su fila base (soportada -> el glue la
    // clasifica como cimentacion y devuelve null).
    const porPlanta = new Map(prep.plantasInfo.map((p) => [p.plantaId, p.nodos]));
    for (const plantaId of ["p1", "p2"]) {
      const nodos = porPlanta.get(plantaId);
      expect(nodos, `plantasInfo de ${plantaId}`).toBeDefined();
      expect(nodos!.some((n) => n.startsWith("MQ0-"))).toBe(true);
      // 9 columnas del muro (L=4, tamMalla 0.5) + 1 nudo de pilar por planta y pilar.
      expect(nodos!.length).toBeGreaterThanOrEqual(9 + 2);
    }
  });

  it(
    "2) CON muro: el CR se va a la pantalla (x_cr ≈ 0, z_cr ≈ centro del muro); cimentacion null",
    () => {
      if (!arranque || !arranque.ok) return;
      const prep = prepararModeloCR(modeloEdificio(true));
      expect(prep.ok).toBe(true);
      if (!prep.ok) return;
      const r = arranque.motor.calcularCR(prep.modeloFEM, prep.plantasInfo);
      // Cimentacion: todos sus nudos con DX/DZ soportados -> no determinable (null).
      // (La forma final lleva ademas ex/ey del ensamblado con el CM: toMatchObject.)
      expect(r.cr_por_planta["p0"]).toMatchObject({ x: null, y: null });
      // Plantas elevadas: el CR practicamente EN el plano del muro (spike: 0.011 m)
      // y centrado en su desarrollo (z_cr = 2).
      for (const plantaId of ["p1", "p2"]) {
        const cr = r.cr_por_planta[plantaId];
        expect(cr.x, `x_cr de ${plantaId}`).not.toBeNull();
        expect(cr.y, `z_cr de ${plantaId}`).not.toBeNull();
        expect(Math.abs(cr.x!)).toBeLessThan(0.5); // pegado a la pantalla (x=0)
        expect(cr.y!).toBeCloseTo(L_MURO / 2, 1); // centro del muro
      }
    },
    300_000,
  );

  it(
    "3) SIN muro (regresion): CR en el eje de los pilares, sin quads ni nudos MQ",
    () => {
      if (!arranque || !arranque.ok) return;
      const prep = prepararModeloCR(modeloEdificio(false));
      expect(prep.ok).toBe(true);
      if (!prep.ok) return;
      expect(prep.modeloFEM.quads).toBeUndefined();
      for (const p of prep.plantasInfo) {
        expect(p.nodos.some((n) => n.startsWith("MQ"))).toBe(false);
      }
      const r = arranque.motor.calcularCR(prep.modeloFEM, prep.plantasInfo);
      // Dos pilares colineales NO degeneran (GJ propia, hallazgo F2-CR): CR en su eje.
      const cr = r.cr_por_planta["p1"];
      expect(cr.x).not.toBeNull();
      expect(cr.x!).toBeCloseTo(X_PILARES, 3);
      expect(cr.y!).toBeCloseTo(L_MURO / 2, 3); // simetria de los dos pilares
    },
    300_000,
  );
});
