// =============================================================================
// resultadosModales.test.ts - bordes Zod del contrato de salida MODAL (F2.1).
//
// Verifica que ResultadosModalesSchema acepta la forma EXACTA que el glue modal
// emitira (segun el spike F2b) y RECHAZA payloads malformados, que es la red de
// seguridad del borde Python<->TS (regla de oro #8): la UI solo debe ver modos
// validados. Sin Pyodide ni worker: corre en el proyecto `node` de Vitest.
//
// Los payloads malformados se construyen como `unknown` (clonando el valido y
// pisando un campo) en vez de mutar un objeto tipado con `@ts-expect-error`: la
// salida del glue cruza el borde como dato sin tipar, asi que probamos el borde tal
// como lo recibe (safeParse acepta unknown). Evita ademas directivas `@ts-expect-error`
// que TS marca como no usadas cuando el tipo inferido del helper es mas ancho.
// =============================================================================

import { describe, it, expect } from "vitest";

import { ResultadosModalesSchema } from "./resultadosModales";

// Payload modal VALIDO minimo: 2 modos, 2 nudos con 6 GDL cada uno. Refleja la
// forma real confirmada por el spike (frecuencias en Hz ascendente, modos por-nudo).
// `as const` mantiene los literales ("kN-m","modal") y las tuplas de 6 estrechos para
// que el caso valido tenga tipos exactos; los malformados parten de su clon JSON.
const MODAL_VALIDO = {
  units: "kN-m",
  analysis: { type: "modal", num_modes: 2 },
  frecuencias: [12.9055, 51.6344],
  modos: [
    {
      numero: 1,
      frecuencia: 12.9055,
      nodos: {
        N1: [0, 0, 0, 0, 0, 0],
        N2: [0, 1.4432, 0, 0, 0, -0.5],
      },
    },
    {
      numero: 2,
      frecuencia: 51.6344,
      nodos: {
        N1: [0, 0, 0, 0, 0, 0],
        N2: [0, 0, 0, 0, 0, 1.5121],
      },
    },
  ],
} as const;

// Clona el valido a un objeto MUTABLE sin tipar (unknown): asi cada caso pisa un
// campo a un valor invalido sin pelear con el tipo (el dato real cruza el borde sin tipo).
function clon(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(MODAL_VALIDO)) as Record<string, unknown>;
}

describe("ResultadosModalesSchema (borde modal)", () => {
  it("acepta un payload modal valido", () => {
    const parseado = ResultadosModalesSchema.safeParse(MODAL_VALIDO);
    expect(parseado.success).toBe(true);
  });

  it("acepta num_modes=0 / sin modos (estructura degenerada, no rompe el borde)", () => {
    const vacio = {
      units: "kN-m",
      analysis: { type: "modal", num_modes: 0 },
      frecuencias: [],
      modos: [],
    };
    expect(ResultadosModalesSchema.safeParse(vacio).success).toBe(true);
  });

  it("RECHAZA frecuencias no numericas", () => {
    const malo = clon();
    malo.frecuencias = [12.9, "NaN-en-texto"];
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA un nudo con != 6 GDL (5 componentes)", () => {
    const malo = clon();
    (malo.modos as { nodos: Record<string, unknown> }[])[0].nodos.N2 = [0, 1.4432, 0, 0, 0];
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA un nudo con 7 GDL (tupla demasiado larga)", () => {
    const malo = clon();
    (malo.modos as { nodos: Record<string, unknown> }[])[0].nodos.N2 = [0, 1.4432, 0, 0, 0, -0.5, 99];
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA type distinto de 'modal'", () => {
    const malo = clon();
    (malo.analysis as Record<string, unknown>).type = "linear";
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA num_modes negativo", () => {
    const malo = clon();
    (malo.analysis as Record<string, unknown>).num_modes = -1;
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA numero de modo no positivo (0)", () => {
    const malo = clon();
    (malo.modos as Record<string, unknown>[])[0].numero = 0;
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA units distinto de 'kN-m'", () => {
    const malo = clon();
    malo.units = "N-mm";
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA un GDL no numerico dentro de la tupla", () => {
    const malo = clon();
    (malo.modos as { nodos: Record<string, unknown> }[])[0].nodos.N2 = [0, null, 0, 0, 0, -0.5];
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  // Defensa en profundidad de no-finitos (.finite()): el glue ya filtra los modos con
  // frecuencia/GDL NaN o Infinity (un autovalor negativo por redondeo da NaN; un GDL con
  // masa ~0 da Inf), pero si uno se colara, el borde debe rechazarlo en vez de dejar que
  // la UI dibuje un "infinito Hz" o un GDL infinito. NaN/Infinity NO sobreviven a
  // JSON.stringify (clon() los volveria null), asi que se construyen a mano.
  it("RECHAZA una frecuencia Infinity", () => {
    const malo: Record<string, unknown> = {
      ...MODAL_VALIDO,
      frecuencias: [12.9, Number.POSITIVE_INFINITY],
    };
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA una frecuencia de modo NaN", () => {
    const malo = {
      units: "kN-m",
      analysis: { type: "modal", num_modes: 1 },
      frecuencias: [12.9],
      modos: [{ numero: 1, frecuencia: Number.NaN, nodos: { N1: [0, 0, 0, 0, 0, 0] } }],
    };
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });

  it("RECHAZA un GDL Infinity dentro de la forma modal", () => {
    const malo = {
      units: "kN-m",
      analysis: { type: "modal", num_modes: 1 },
      frecuencias: [12.9],
      modos: [
        {
          numero: 1,
          frecuencia: 12.9,
          nodos: { N1: [0, Number.POSITIVE_INFINITY, 0, 0, 0, 0] },
        },
      ],
    };
    expect(ResultadosModalesSchema.safeParse(malo).success).toBe(false);
  });
});
