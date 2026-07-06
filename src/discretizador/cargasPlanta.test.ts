// Tests de cargasPlanta (F3.4, "plantas sin grupos"; antes cargasGrupo/F3.2 D-1): la
// FUENTE UNICA de las cargas automaticas de PLANTA sobre paños [2A] y su integracion
// con generarCombos (mismo criterio de activacion: sin consumidor, sin termino
// fantasma). Node puro. Añade cobertura del helper NUEVO plantasConCargaSinPano
// (honestidad: planta con carga y sin paño que la reciba).
import { describe, it, expect } from "vitest";
import {
  CASE_CM_PLANTA,
  CASE_USO_PLANTA,
  cargasPlantaDePano,
  casesPlantaActivos,
  plantasConValorNegativo,
  plantasConCargaSinPano,
} from "./cargasPlanta";
import { generarCombos } from "./combinaciones";
import { GAMMA_G_DESFAV, GAMMA_Q_DESFAV, GAMMA_ELS } from "../biblioteca";
import type { Modelo, Pano } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";

// Modelo con UNA planta (p1) que lleva sus cargas de planta y, por defecto, un paño
// losa que las recibe. En v4 los valores SU/CM viven en la propia planta (no en un
// grupo): cada test los ajusta o retira el paño.
function modeloConPano(opts?: {
  sobrecargaUso?: number;
  cargasMuertas?: number;
  sinPano?: boolean;
  tipoPano?: Pano["tipo"];
}): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      {
        id: "p1",
        nombre: "Planta 1",
        cota: 3,
        altura: 3,
        categoriaUso: "A",
        sobrecargaUso: opts?.sobrecargaUso ?? 2,
        cargasMuertas: opts?.cargasMuertas ?? 1,
      },
    ],
    secciones: [],
    nudos: [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: 4, y: 0 },
      { id: "q3", x: 4, y: 3 },
      { id: "q4", x: 0, y: 3 },
    ],
    pilares: [],
    vigas: [],
    panos: opts?.sinPano
      ? []
      : [
          {
            id: "f1", nombre: "F1", tipo: opts?.tipoPano ?? "losa", plantaId: "p1",
            perimetro: ["q1", "q2", "q3", "q4"],
            espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
          },
        ],
    muros: [],
    cargas: [],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

describe("cargasPlantaDePano", () => {
  it("emite CM (G) y uso (Q) de la planta del paño, en ese orden", () => {
    const m = modeloConPano({ cargasMuertas: 1.5, sobrecargaUso: 2 });
    expect(cargasPlantaDePano(m, m.panos[0])).toEqual([
      { case: CASE_CM_PLANTA, presion: 1.5 },
      { case: CASE_USO_PLANTA, presion: 2 },
    ]);
  });

  it("valor 0 o negativo NO se emite (el negativo lo avisa validaciones)", () => {
    const m = modeloConPano({ cargasMuertas: 0, sobrecargaUso: -2 });
    expect(cargasPlantaDePano(m, m.panos[0])).toEqual([]);
  });

  it("paño no losa o con planta irresoluble -> [] (sin lanzar)", () => {
    const ret = modeloConPano({ tipoPano: "reticular" });
    expect(cargasPlantaDePano(ret, ret.panos[0])).toEqual([]);
    const rota = modeloConPano();
    rota.panos[0] = { ...rota.panos[0], plantaId: "NO_EXISTE" };
    expect(cargasPlantaDePano(rota, rota.panos[0])).toEqual([]);
  });
});

describe("casesPlantaActivos + generarCombos (fuente unica, sin termino fantasma)", () => {
  it("con paño y valores > 0: los cases sinteticos entran en ELU/ELS con su gamma", () => {
    const m = modeloConPano();
    expect(casesPlantaActivos(m)).toEqual({ cm: true, uso: true });
    const combos = generarCombos(m);
    const elu = combos.find((c) => c.name === "ELU")!;
    const els = combos.find((c) => c.name === "ELS")!;
    expect(elu.factors[CASE_CM_PLANTA]).toBe(GAMMA_G_DESFAV); // G: 1,35
    expect(elu.factors[CASE_USO_PLANTA]).toBe(GAMMA_Q_DESFAV); // Q: 1,50
    expect(els.factors[CASE_CM_PLANTA]).toBe(GAMMA_ELS);
    expect(els.factors[CASE_USO_PLANTA]).toBe(GAMMA_ELS);
  });

  it("SIN paños: combos byte-identicos a los de siempre (sin claves sinteticas)", () => {
    const m = modeloConPano({ sinPano: true });
    expect(casesPlantaActivos(m)).toEqual({ cm: false, uso: false });
    const combos = generarCombos(m);
    for (const combo of combos) {
      expect(combo.factors[CASE_CM_PLANTA]).toBeUndefined();
      expect(combo.factors[CASE_USO_PLANTA]).toBeUndefined();
    }
  });

  it("planta a CERO con paño: sin cases sinteticos (sin termino fantasma, espejo E4)", () => {
    const m = modeloConPano({ cargasMuertas: 0, sobrecargaUso: 0 });
    expect(casesPlantaActivos(m)).toEqual({ cm: false, uso: false });
    const elu = generarCombos(m).find((c) => c.name === "ELU")!;
    expect(elu.factors[CASE_CM_PLANTA]).toBeUndefined();
    expect(elu.factors[CASE_USO_PLANTA]).toBeUndefined();
  });

  it("solo CM > 0: entra el case de CM y NO el de uso (activacion por case)", () => {
    const m = modeloConPano({ cargasMuertas: 1, sobrecargaUso: 0 });
    expect(casesPlantaActivos(m)).toEqual({ cm: true, uso: false });
    const elu = generarCombos(m).find((c) => c.name === "ELU")!;
    expect(elu.factors[CASE_CM_PLANTA]).toBe(GAMMA_G_DESFAV);
    expect(elu.factors[CASE_USO_PLANTA]).toBeUndefined();
  });
});

describe("plantasConValorNegativo", () => {
  it("detecta el negativo SOLO si la planta tiene paños losa que lo recibirian", () => {
    const con = modeloConPano({ cargasMuertas: -1 });
    expect(plantasConValorNegativo(con)).toEqual([
      { plantaId: "p1", nombre: "Planta 1", campo: "cargasMuertas" },
    ]);
    const sin = modeloConPano({ cargasMuertas: -1, sinPano: true });
    expect(plantasConValorNegativo(sin)).toEqual([]);
  });

  it("distingue el campo negativo (cargasMuertas vs sobrecargaUso)", () => {
    const m = modeloConPano({ sobrecargaUso: -3, cargasMuertas: 1 });
    expect(plantasConValorNegativo(m)).toEqual([
      { plantaId: "p1", nombre: "Planta 1", campo: "sobrecargaUso" },
    ]);
  });
});

describe("plantasConCargaSinPano (F3.4, honestidad)", () => {
  it("planta con SU>0 y sin ningun paño -> aparece (su carga no entra en el calculo)", () => {
    const m = modeloConPano({ sobrecargaUso: 3, cargasMuertas: 0, sinPano: true });
    expect(plantasConCargaSinPano(m).map((p) => p.id)).toEqual(["p1"]);
  });

  it("planta con CM>0 y sin ningun paño -> aparece", () => {
    const m = modeloConPano({ sobrecargaUso: 0, cargasMuertas: 2, sinPano: true });
    expect(plantasConCargaSinPano(m).map((p) => p.id)).toEqual(["p1"]);
  });

  it("planta con paño LOSA que recibe las cargas -> NO aparece", () => {
    // El paño losa de la planta las recibe: la carga SI entra, no hay que avisar.
    const m = modeloConPano({ sobrecargaUso: 3, cargasMuertas: 2 });
    expect(plantasConCargaSinPano(m)).toEqual([]);
  });

  it("planta con valores a 0 (con o sin paño) -> NO aparece (nada que avisar)", () => {
    expect(plantasConCargaSinPano(modeloConPano({ sobrecargaUso: 0, cargasMuertas: 0 }))).toEqual([]);
    expect(
      plantasConCargaSinPano(modeloConPano({ sobrecargaUso: 0, cargasMuertas: 0, sinPano: true })),
    ).toEqual([]);
  });

  it("un paño NO losa (reticular) NO cuenta como receptor -> la planta aparece", () => {
    // Solo la losa recibe cargas de planta; un reticular no las toma, asi que la
    // planta con carga sigue sin paño que la reciba.
    const m = modeloConPano({ sobrecargaUso: 3, tipoPano: "reticular" });
    expect(plantasConCargaSinPano(m).map((p) => p.id)).toEqual(["p1"]);
  });
});

// --- F3 corte "unidireccional": el gate se extiende a losa || unidireccional -------
describe("cargasPlanta · gate unidireccional (F3, R-5)", () => {
  it("cargasPlantaDePano de un paño UNIDIRECCIONAL emite CM y uso (gate relajado)", () => {
    const m = modeloConPano({ cargasMuertas: 1.5, sobrecargaUso: 2, tipoPano: "unidireccional" });
    expect(cargasPlantaDePano(m, m.panos[0])).toEqual([
      { case: CASE_CM_PLANTA, presion: 1.5 },
      { case: CASE_USO_PLANTA, presion: 2 },
    ]);
  });

  it("casesPlantaActivos cuenta el paño unidireccional (combos con gamma)", () => {
    const m = modeloConPano({ tipoPano: "unidireccional" });
    expect(casesPlantaActivos(m)).toEqual({ cm: true, uso: true });
    const elu = generarCombos(m).find((c) => c.name === "ELU")!;
    expect(elu.factors[CASE_CM_PLANTA]).toBe(GAMMA_G_DESFAV);
    expect(elu.factors[CASE_USO_PLANTA]).toBe(GAMMA_Q_DESFAV);
  });

  it("plantasConCargaSinPano: un paño unidireccional SI cuenta como receptor -> NO aparece", () => {
    const m = modeloConPano({ sobrecargaUso: 3, tipoPano: "unidireccional" });
    expect(plantasConCargaSinPano(m)).toEqual([]);
  });

  it("plantasConValorNegativo: un paño unidireccional cuenta -> detecta el negativo", () => {
    const m = modeloConPano({ cargasMuertas: -1, tipoPano: "unidireccional" });
    expect(plantasConValorNegativo(m)).toEqual([
      { plantaId: "p1", nombre: "Planta 1", campo: "cargasMuertas" },
    ]);
  });

  it("reticular NO cuenta (solo losa/unidireccional): la planta con carga sigue sin receptor", () => {
    const m = modeloConPano({ sobrecargaUso: 3, tipoPano: "reticular" });
    expect(cargasPlantaDePano(m, m.panos[0])).toEqual([]);
    expect(plantasConCargaSinPano(m).map((p) => p.id)).toEqual(["p1"]);
  });
});
