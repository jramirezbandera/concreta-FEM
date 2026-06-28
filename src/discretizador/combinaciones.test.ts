import { describe, it, expect } from "vitest";
import { generarCombos } from "./combinaciones";
import { ComboFEMSchema } from "./contratoFEM";
import { GAMMA_G_DESFAV, GAMMA_Q_DESFAV, GAMMA_ELS } from "../biblioteca";
import { type Modelo, type Hipotesis, SCHEMA_VERSION } from "../dominio";

// Tests de generarCombos (feature-13, T2.1). Node PURO: SIN Pyodide. Se prueba la
// generacion de combos ELU/ELS a partir de las hipotesis del modelo, leyendo los
// coeficientes gamma de la biblioteca (no numeros a mano). Cubre: factores por
// tipo, nombres/tags de los dos combos, determinismo del orden y modelo vacio.

// Hipotesis "ligera" sin `automatica` (la mayoria de los tests no la fijan): el
// helper la normaliza a false. Asi los literales `{id,nombre,tipo}` siguen siendo
// concisos y solo los tests de la automatica (E4) la marcan explicitamente.
type HipotesisLite = Omit<Hipotesis, "automatica"> & { automatica?: boolean };

// Modelo minimo: solo lo que `generarCombos` consulta (modelo.hipotesis + el flag
// incluirPesoPropio). El resto va vacio; generarCombos no toca geometria/cargas.
function modeloConHipotesis(
  hipotesis: HipotesisLite[],
  incluirPesoPropio = false,
): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [],
    plantas: [],
    secciones: [],
    nudos: [],
    pilares: [],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: hipotesis.map((h) => ({ ...h, automatica: h.automatica ?? false })),
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio },
  };
}

describe("generarCombos - factores por tipo de hipotesis", () => {
  it("permanente -> GAMMA_G_DESFAV (1.35) en ELU", () => {
    const combos = generarCombos(
      modeloConHipotesis([{ id: "h1", nombre: "Peso propio", tipo: "permanente" }]),
    );
    const elu = combos.find((c) => c.name === "ELU")!;
    expect(elu.factors.h1).toBe(GAMMA_G_DESFAV);
    expect(elu.factors.h1).toBe(1.35);
  });

  it("variable -> GAMMA_Q_DESFAV (1.5) en ELU", () => {
    const combos = generarCombos(
      modeloConHipotesis([{ id: "h1", nombre: "Uso", tipo: "variable" }]),
    );
    const elu = combos.find((c) => c.name === "ELU")!;
    expect(elu.factors.h1).toBe(GAMMA_Q_DESFAV);
    expect(elu.factors.h1).toBe(1.5);
  });

  it("ELS: GAMMA_ELS (1.0) para permanente y variable por igual", () => {
    const combos = generarCombos(
      modeloConHipotesis([
        { id: "h1", nombre: "Peso propio", tipo: "permanente" },
        { id: "h2", nombre: "Uso", tipo: "variable" },
      ]),
    );
    const els = combos.find((c) => c.name === "ELS")!;
    expect(els.factors.h1).toBe(GAMMA_ELS);
    expect(els.factors.h2).toBe(GAMMA_ELS);
    expect(els.factors.h1).toBe(1.0);
  });

  it("modelo con permanente y variable: ELU mezcla 1.35 y 1.5", () => {
    const combos = generarCombos(
      modeloConHipotesis([
        { id: "g", nombre: "Permanentes", tipo: "permanente" },
        { id: "q", nombre: "Sobrecarga", tipo: "variable" },
      ]),
    );
    const elu = combos.find((c) => c.name === "ELU")!;
    expect(elu.factors).toEqual({ g: 1.35, q: 1.5 });
  });
});

describe("generarCombos - estructura de los combos", () => {
  it("produce exactamente dos combos: ELU y ELS", () => {
    const combos = generarCombos(
      modeloConHipotesis([{ id: "h1", nombre: "G", tipo: "permanente" }]),
    );
    expect(combos.map((c) => c.name)).toEqual(["ELU", "ELS"]);
  });

  it("tags ELU/ELS correctos", () => {
    const combos = generarCombos(
      modeloConHipotesis([{ id: "h1", nombre: "G", tipo: "permanente" }]),
    );
    expect(combos.find((c) => c.name === "ELU")!.combo_tags).toEqual(["ELU"]);
    expect(combos.find((c) => c.name === "ELS")!.combo_tags).toEqual(["ELS"]);
  });

  it("cada combo valida contra ComboFEMSchema", () => {
    const combos = generarCombos(
      modeloConHipotesis([
        { id: "h1", nombre: "G", tipo: "permanente" },
        { id: "h2", nombre: "Q", tipo: "variable" },
      ]),
    );
    for (const c of combos) expect(ComboFEMSchema.safeParse(c).success).toBe(true);
  });
});

describe("generarCombos - modelo sin hipotesis", () => {
  it("dos combos con factors vacio pero bien formados", () => {
    const combos = generarCombos(modeloConHipotesis([]));
    expect(combos.map((c) => c.name)).toEqual(["ELU", "ELS"]);
    expect(combos[0].factors).toEqual({});
    expect(combos[1].factors).toEqual({});
    // Siguen siendo combos validos del contrato (factors vacio es legal).
    for (const c of combos) expect(ComboFEMSchema.safeParse(c).success).toBe(true);
  });
});

describe("generarCombos - determinismo del orden (CLAUDE.md §2)", () => {
  it("el orden de modelo.hipotesis NO altera la salida (orden por id)", () => {
    const hips: HipotesisLite[] = [
      { id: "h1", nombre: "G", tipo: "permanente" },
      { id: "h2", nombre: "Q", tipo: "variable" },
      { id: "h3", nombre: "N", tipo: "variable" },
    ];
    const a = JSON.stringify(generarCombos(modeloConHipotesis(hips)));
    const b = JSON.stringify(generarCombos(modeloConHipotesis([...hips].reverse())));
    expect(b).toBe(a);
  });

  it("las claves de factors se insertan en orden de id ascendente", () => {
    // Hipotesis dadas desordenadas; las claves del objeto factors deben salir por id.
    const combos = generarCombos(
      modeloConHipotesis([
        { id: "c", nombre: "C", tipo: "variable" },
        { id: "a", nombre: "A", tipo: "permanente" },
        { id: "b", nombre: "B", tipo: "permanente" },
      ]),
    );
    const elu = combos.find((cb) => cb.name === "ELU")!;
    expect(Object.keys(elu.factors)).toEqual(["a", "b", "c"]);
  });
});

describe("generarCombos - hipotesis automatica de peso propio (E4)", () => {
  const hipAuto: HipotesisLite = {
    id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true,
  };

  it("flag ON: la automatica se factoriza como PERMANENTE (1.35 ELU / 1.0 ELS)", () => {
    const combos = generarCombos(
      modeloConHipotesis([hipAuto, { id: "h1", nombre: "Uso", tipo: "variable" }], true),
    );
    const elu = combos.find((c) => c.name === "ELU")!;
    const els = combos.find((c) => c.name === "ELS")!;
    expect(elu.factors["hip-peso-propio"]).toBe(1.35);
    expect(els.factors["hip-peso-propio"]).toBe(1.0);
  });

  it("E4 flag OFF: la automatica NO aparece en los combos (sin termino fantasma)", () => {
    const combos = generarCombos(
      modeloConHipotesis([hipAuto, { id: "h1", nombre: "Uso", tipo: "variable" }], false),
    );
    const elu = combos.find((c) => c.name === "ELU")!;
    const els = combos.find((c) => c.name === "ELS")!;
    expect(elu.factors["hip-peso-propio"]).toBeUndefined();
    expect(els.factors["hip-peso-propio"]).toBeUndefined();
    // El resto de hipotesis NO se ve afectado.
    expect(elu.factors.h1).toBe(1.5);
  });
});
