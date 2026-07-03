// AUDITORÍA [A-3 + M-2]: blindaje numérico de los BORDES Zod contra ±Infinity.
//
// Zod acepta ±Infinity en un `z.number()` pelado (solo rechaza NaN): sin `.finite()`
// un Infinity en una coordenada/carga/dimensión cruza ModeloSchema (Capa 1),
// ModeloFEMSchema (Capa 2) y ResultadosCalculoSchema (frontera de resultados) y
// llega a PyNite o a la UI como número "válido" — cálculo o presentación basura
// sin aviso. El vector real de entrada es la carga desde IndexedDB (structured
// clone preserva Infinity, a diferencia de JSON.parse que lo rechaza).
//
// Los esquemas de plantillas DXF (tiposDxf.ts), modal (resultadosModales.ts) y CR
// (resultadosCR.ts) YA usaban `.finite()` como defensa de borde documentada; estos
// tests exigen la misma política en los tres bordes del CÁLCULO, que estaban menos
// blindados que el overlay cosmético.
import { describe, it, expect } from "vitest";
import { ModeloSchema, SCHEMA_VERSION, type Modelo } from "./index";
import { ModeloFEMSchema } from "../discretizador/contratoFEM";
import { ResultadosCalculoSchema } from "../solver/resultados";

// Modelo mínimo VÁLIDO (la integridad referencial no es asunto de ModeloSchema).
function modeloMinimo(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [{ id: "g1", nombre: "G", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 }],
    plantas: [{ id: "p1", nombre: "P1", cota: 3, altura: 3, grupoId: "g1" }],
    secciones: [{ id: "s1", nombre: "S", tipo: "generico", A: 0.01, Iy: 1e-4, Iz: 1e-5, J: 1e-6 }],
    nudos: [{ id: "n1", x: 0, y: 0 }],
    pilares: [],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [{ id: "c1", tipo: "lineal", ambito: "v1", valor: 10, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "H", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: false, incluirPesoPropio: false },
  };
}

describe("AUDITORIA A-3: ModeloSchema (Capa 1) rechaza ±Infinity", () => {
  it("control: el modelo minimo valido pasa", () => {
    expect(ModeloSchema.safeParse(modeloMinimo()).success).toBe(true);
  });

  it("control: NaN ya se rechazaba (z.number() rechaza NaN)", () => {
    const m = modeloMinimo();
    m.nudos[0].x = NaN;
    expect(ModeloSchema.safeParse(m).success).toBe(false);
  });

  const casos: Array<[string, (m: Modelo) => void]> = [
    ["nudo.x = Infinity", (m) => { m.nudos[0].x = Infinity; }],
    ["nudo.y = -Infinity", (m) => { m.nudos[0].y = -Infinity; }],
    ["planta.cota = Infinity", (m) => { m.plantas[0].cota = Infinity; }],
    ["planta.altura = Infinity", (m) => { m.plantas[0].altura = Infinity; }],
    ["carga.valor = Infinity", (m) => { m.cargas[0].valor = Infinity; }],
    ["grupo.sobrecargaUso = Infinity", (m) => { m.grupos[0].sobrecargaUso = Infinity; }],
    [
      "seccion generica Iy = Infinity",
      (m) => {
        const s = m.secciones[0];
        if (s.tipo === "generico") s.Iy = Infinity;
      },
    ],
  ];
  it.each(casos)("rechaza %s", (_titulo, mutar) => {
    const m = modeloMinimo();
    mutar(m);
    expect(ModeloSchema.safeParse(m).success).toBe(false);
  });
});

describe("AUDITORIA A-3: ModeloFEMSchema (Capa 2) rechaza ±Infinity", () => {
  // Capa 2 mínima válida (calcada de contratoFEM.test.ts).
  function femMinimo(): unknown {
    return {
      units: "kN-m",
      nodes: [
        { name: "N1", x: 0, y: 0, z: 0 },
        { name: "N2", x: 5, y: 0, z: 0 },
      ],
      materials: [{ name: "HA-25", E: 27264000, G: 11360000, nu: 0.2, rho: 25 }],
      sections: [{ name: "30x50", A: 0.15, Iy: 0.0011, Iz: 0.0003125, J: 0.0008 }],
      members: [
        {
          name: "M1", i: "N1", j: "N2", material: "HA-25", section: "30x50",
          rotation: 0, tension_only: false, comp_only: false, releases: null,
        },
      ],
      supports: [
        { node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true },
      ],
      node_loads: [],
      dist_loads: [
        { member: "M1", direction: "FY", w1: -8, w2: -8, x1: null, x2: null, case: "G" },
      ],
      pt_loads: [],
      combos: [{ name: "ELS", factors: { G: 1.0 } }],
      analysis: { type: "linear", check_statics: false },
    };
  }

  it("control: la Capa 2 minima valida pasa", () => {
    expect(ModeloFEMSchema.safeParse(femMinimo()).success).toBe(true);
  });

  // Tipo estructural minimo de las rutas que mutan los casos (sin `any`).
  type FemMut = {
    nodes: { x: number }[];
    materials: { E: number }[];
    sections: { Iz: number }[];
    dist_loads: { w1: number }[];
    combos: { factors: Record<string, number> }[];
  };
  const casos: Array<[string, (fem: FemMut) => void]> = [
    ["node.x = Infinity", (f) => { f.nodes[0].x = Infinity; }],
    ["material.E = Infinity", (f) => { f.materials[0].E = Infinity; }],
    ["section.Iz = Infinity", (f) => { f.sections[0].Iz = Infinity; }],
    ["dist_load.w1 = -Infinity", (f) => { f.dist_loads[0].w1 = -Infinity; }],
    ["combo factor = Infinity", (f) => { f.combos[0].factors.G = Infinity; }],
  ];
  it.each(casos)("rechaza %s", (_titulo, mutar) => {
    const fem = femMinimo();
    mutar(fem as FemMut);
    expect(ModeloFEMSchema.safeParse(fem).success).toBe(false);
  });
});

describe("AUDITORIA M-2: ResultadosCalculoSchema rechaza ±Infinity", () => {
  // Resultados mínimos válidos (1 nudo, 1 barra, 1 combo, n_points=2).
  function resultadosMinimos(): unknown {
    const diagrama = [[0, 5], [0, -8]];
    const deformada = [[0, 0], [0, -0.001], [0, 0]];
    return {
      units: "kN-m",
      analysis: { type: "linear", n_points: 2 },
      combos: ["ELS"],
      nodos: {
        N1: { ELS: { disp: [0, 0, 0, 0, 0, 0], rxn: [0, 20, 0, 0, 0, 0] } },
      },
      barras: {
        M1: {
          ELS: {
            axial: diagrama, shear_y: diagrama, moment_z: diagrama, defl_y: diagrama,
            deformada_global: deformada,
            max_moment_z: 0, min_moment_z: -8, max_shear_y: 20,
          },
        },
      },
      check_statics: null,
    };
  }

  it("control: los resultados minimos validos pasan", () => {
    expect(ResultadosCalculoSchema.safeParse(resultadosMinimos()).success).toBe(true);
  });

  // Tipo estructural minimo de las rutas que mutan los casos (sin `any`).
  type ResMut = {
    nodos: Record<string, Record<string, { disp: number[]; rxn: number[] }>>;
    barras: Record<
      string,
      Record<string, { moment_z: number[][]; min_moment_z: number; deformada_global: number[][] }>
    >;
  };
  const casos: Array<[string, (r: ResMut) => void]> = [
    ["rxn FY = Infinity", (r) => { r.nodos.N1.ELS.rxn[1] = Infinity; }],
    ["disp DY = -Infinity", (r) => { r.nodos.N1.ELS.disp[1] = -Infinity; }],
    ["moment_z[1][1] = Infinity", (r) => { r.barras.M1.ELS.moment_z[1][1] = Infinity; }],
    ["min_moment_z = -Infinity", (r) => { r.barras.M1.ELS.min_moment_z = -Infinity; }],
    ["deformada_global DY = Infinity", (r) => { r.barras.M1.ELS.deformada_global[1][0] = Infinity; }],
  ];
  it.each(casos)("rechaza %s", (_titulo, mutar) => {
    const res = resultadosMinimos();
    mutar(res as ResMut);
    expect(ResultadosCalculoSchema.safeParse(res).success).toBe(false);
  });
});
