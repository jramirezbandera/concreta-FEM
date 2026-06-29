// =============================================================================
// CAPA A de la piramide golden (feature-6, T1.1): GOLDEN DEL DISCRETIZADOR.
//
// Para cada obra canonica (fixture de Capa 1) fijamos y assertamos la ESTRUCTURA
// del `ModeloFEM` que produce discretizar(). Esta capa NO arranca Pyodide: corre
// en Node puro, es instantanea y caza regresiones del discretizador sin acoplarse
// al solver (I+D: "golden del discretizador independiente del worker").
//
// Que blindamos aqui (las invariantes que importan, no detalles fragiles):
//   - Mapeo de ejes (#18): planta (x,y) -> global (X,Z); cota -> Y vertical.
//   - Numeracion determinista de nodos por (Y,X,Z) y de barras (pilares-luego-vigas,
//     por id). Snapping geometrico: cabeza de pilar y extremo de viga coincidentes
//     comparten nudo.
//   - Releases (#8) en el orden EXACTO segun articulado/empotrado/tirante.
//   - Apoyos: 6 GDL del empotramiento de los pilares con vinculacionExterior, en el
//     nodo del PIE (Y=0).
//   - Cargas y su SIGNO/direccion (#3): UDL -> dist_load global FY negativa; carga
//     puntual sobre nudo -> node_load FY negativa; combos ELU/ELS provisionales.
//
// NO duplicamos discretizar.test.ts (que prueba el portico generico y los helpers
// puros): aqui complementamos con los CASOS DE LIBRO completos, fijando coords y
// numeracion concretas. Los VALORES FISICOS (M=qL²/8, flecha) son de T1.2 (pipeline
// con motor): aqui no se verifica fisica, solo la traduccion estructural.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  discretizarOExplotar,
  fixtureBiapoyadaUDL,
  fixtureVoladizoPuntual,
  fixtureBiapoyadaPuntualCentro,
  fixturePorticoSimple,
  MATERIAL_GOLDEN,
  SECCION_GOLDEN,
} from "./_arnes";
import { ModeloFEMSchema, type ModeloFEM } from "../../src/discretizador/contratoFEM";
import { discretizar } from "../../src/discretizador/discretizar";
import type { Trazabilidad } from "../../src/discretizador/contratoFEM";
import type { Modelo } from "../../src/dominio";
import { SCHEMA_VERSION } from "../../src/dominio";

// Discretiza y devuelve la trazabilidad (campo aditivo de ok:true), o explota si la
// obra del fixture quedara invalida (mismo contrato que discretizarOExplotar). La
// trazabilidad es la fuente unica que la UI de Resultados (feature-14) consume.
function trazabilidadDe(modelo: Modelo): Trazabilidad {
  const res = discretizar(modelo);
  if (!res.ok) throw new Error(`fixture golden invalido: ${JSON.stringify(res.errores)}`);
  return res.trazabilidad;
}

// --- Helpers de assert reutilizables -----------------------------------------

// Devuelve la coordenada [x,y,z] de un nodo por nombre (para verificar el mapeo).
function coordDe(fem: ModeloFEM, name: string): [number, number, number] {
  const n = fem.nodes.find((nd) => nd.name === name);
  if (n === undefined) throw new Error(`nodo inexistente: ${name}`);
  return [n.x, n.y, n.z];
}

// Nombre del nodo en una coordenada exacta (la geometria de los fixtures es entera).
function nombreEn(fem: ModeloFEM, [x, y, z]: [number, number, number]): string {
  const n = fem.nodes.find((nd) => nd.x === x && nd.y === y && nd.z === z);
  if (n === undefined) {
    throw new Error(`no hay nodo en (${x},${y},${z}); nodos: ${JSON.stringify(fem.nodes)}`);
  }
  return n.name;
}

// Toda salida golden debe cumplir su propio contrato (defensa frente a regresiones
// que dejen el ModeloFEM malformado pero "pasando" los asserts especificos).
function assertContratoValido(fem: ModeloFEM): void {
  expect(ModeloFEMSchema.safeParse(fem).success).toBe(true);
}

// El material/seccion de obra de los fixtures deben aparecer mapeados por id (el
// glue Python los casa directo por name; ver feature-4-enmiendas-dominio).
function assertMaterialYSeccion(fem: ModeloFEM): void {
  expect(fem.materials.map((m) => m.name)).toContain(MATERIAL_GOLDEN);
  expect(fem.sections.map((s) => s.name)).toContain(SECCION_GOLDEN);
  // Todas las barras referencian el material y la seccion de obra del fixture.
  for (const m of fem.members) {
    expect(m.material).toBe(MATERIAL_GOLDEN);
    expect(m.section).toBe(SECCION_GOLDEN);
  }
}

// =============================================================================
// 1) BIAPOYADA con carga uniforme (UDL).  M=qL²/8, δ=5qL⁴/384EI.
//    Dos pilares de base EMPOTRADA (columnas estables) + viga ARTICULADA en ambos
//    extremos (rotula -> biapoyada en flexion). UDL gravitatoria q sobre la viga.
// =============================================================================
describe("golden discretizador · biapoyada UDL", () => {
  // L=6, q=10: geometria entera y comprobable a mano.
  const fem = discretizarOExplotar(fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 }));

  it("contrato + material/seccion del fixture", () => {
    assertContratoValido(fem);
    assertMaterialYSeccion(fem);
  });

  it("nodos: 4 nudos con el mapeo de ejes #18 (planta(x,y)->X,Z; cota->Y) y numerados por (Y,X,Z)", () => {
    // Pies a Y=0: (0,0,0),(6,0,0); cabezas a Y=3: (0,3,0),(6,3,0). Snapping: la
    // cabeza de cada pilar coincide con un extremo de viga -> 4 nodos, no 6.
    expect(fem.nodes).toHaveLength(4);
    // Numeracion determinista por (Y,X,Z): Y primero, luego X, luego Z.
    expect(coordDe(fem, "N1")).toEqual([0, 0, 0]); // pie izq
    expect(coordDe(fem, "N2")).toEqual([6, 0, 0]); // pie der
    expect(coordDe(fem, "N3")).toEqual([0, 3, 0]); // cabeza izq = extremo i viga
    expect(coordDe(fem, "N4")).toEqual([6, 3, 0]); // cabeza der = extremo j viga
  });

  it("barras: 2 pilares (por id) y luego la viga, con la viga uniendo las cabezas", () => {
    // Orden total: pilares (por id: api, apj) y luego vigas. M1,M2 pilares; M3 viga.
    expect(fem.members.map((m) => m.name)).toEqual(["M1", "M2", "M3"]);
    const m1 = fem.members.find((m) => m.name === "M1")!; // pilar api (x=0): pie->cabeza
    expect([m1.i, m1.j]).toEqual(["N1", "N3"]);
    const m2 = fem.members.find((m) => m.name === "M2")!; // pilar apj (x=6)
    expect([m2.i, m2.j]).toEqual(["N2", "N4"]);
    const viga = fem.members.find((m) => m.name === "M3")!;
    expect([viga.i, viga.j]).toEqual(["N3", "N4"]); // une las dos cabezas
  });

  it("releases #8: la viga biarticulada libera Ry,Rz en AMBOS extremos; los pilares no liberan", () => {
    const viga = fem.members.find((m) => m.name === "M3")!;
    expect(viga.releases).not.toBeNull();
    const r = viga.releases!;
    // Orden: [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj]
    expect([r[4], r[5]]).toEqual([true, true]); // Ryi,Rzi (rotula en i)
    expect([r[10], r[11]]).toEqual([true, true]); // Ryj,Rzj (rotula en j)
    expect(r[3] && r[9]).toBe(false); // NUNCA Rx en ambos (mecanismo torsional)
    // Los pilares no liberan giros (extremos empotrados).
    for (const name of ["M1", "M2"]) {
      expect(fem.members.find((m) => m.name === name)!.releases).toBeNull();
    }
  });

  it("apoyos: 2 empotramientos (6 GDL) en los PIES (Y=0), uno por pilar", () => {
    expect(fem.supports).toHaveLength(2);
    for (const s of fem.supports) {
      expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([
        true, true, true, true, true, true,
      ]);
      expect(coordDe(fem, s.node)[1]).toBe(0); // el apoyo va en el pie (Y=0)
    }
    // Los apoyos estan en los nodos de los pies (N1, N2), no en las cabezas.
    expect(fem.supports.map((s) => s.node).sort()).toEqual(["N1", "N2"]);
  });

  it("carga #3: UNA dist_load global FY NEGATIVA en la viga (toda la barra), sin pt/node loads", () => {
    expect(fem.dist_loads).toHaveLength(1);
    expect(fem.pt_loads).toHaveLength(0);
    expect(fem.node_loads).toHaveLength(0);
    const dl = fem.dist_loads[0];
    expect(dl.member).toBe("M3"); // sobre la viga
    expect(dl.direction).toBe("FY"); // GLOBAL (mayuscula), vertical
    expect(dl.w1).toBe(-10); // gravedad descendente: -q (signo en un unico punto)
    expect(dl.w2).toBe(-10);
    expect([dl.x1, dl.x2]).toEqual([null, null]); // toda la barra
    expect(dl.case).toBe("G"); // case = hipotesisId
  });

  it("combos provisionales: ELU (1.35 permanente) y ELS (1.0) con sus tags", () => {
    const elu = fem.combos.find((c) => c.name === "ELU")!;
    const els = fem.combos.find((c) => c.name === "ELS")!;
    expect(elu.factors.G).toBe(1.35); // G es permanente
    expect(elu.combo_tags).toEqual(["ELU"]);
    expect(els.factors.G).toBe(1.0);
    expect(els.combo_tags).toEqual(["ELS"]);
  });

  it("trazabilidad: cada pilar -> 1 barra; viga -> 1 barra; arranques en los pies", () => {
    const t = trazabilidadDe(fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 }));
    // Pilares de un solo tramo (no pasantes): un member cada uno, el que apunta al pie.
    expect(t.pilarAMembers).toEqual({ api: ["M1"], apj: ["M2"] });
    expect(t.vigaAMember).toEqual({ viga: "M3" });
    // Ambos pilares tienen vinculacionExterior: su arranque es el nodo del pie (N1,N2).
    expect(t.pilarANodoArranque).toEqual({ api: "N1", apj: "N2" });
    // Coincide con los nodos de apoyo (Paso 4).
    expect(Object.values(t.pilarANodoArranque).sort()).toEqual(
      fem.supports.map((s) => s.node).sort(),
    );
    // Los nudos de la viga se localizan en las cabezas (N3, N4).
    expect(t.nudoANodo).toEqual({ ni: "N3", nj: "N4" });
  });
});

// =============================================================================
// 2) VOLADIZO con carga puntual en el extremo.  M=PL, δ=PL³/3EI.
//    Un solo pilar EMPOTRADO bajo el extremo j (6 GDL); la viga es continua y
//    rigida con el (extremos empotrados). La carga puntual cae sobre el extremo
//    LIBRE (nudoI, x=0 de la barra). Sin pilar bajo el extremo libre.
// =============================================================================
describe("golden discretizador · voladizo con carga puntual", () => {
  const fem = discretizarOExplotar(fixtureVoladizoPuntual({ L: 3, P: 20, cota: 3 }));

  it("contrato + material/seccion del fixture", () => {
    assertContratoValido(fem);
    assertMaterialYSeccion(fem);
  });

  it("nodos: 3 (pie+cabeza del pilar empotrado y el extremo libre), numerados por (Y,X,Z)", () => {
    // Pie a Y=0: (3,0,0). A Y=3, ordenados por X: (0,3,0) libre, (3,3,0) empotrado.
    expect(fem.nodes).toHaveLength(3);
    expect(coordDe(fem, "N1")).toEqual([3, 0, 0]); // pie del pilar (Y=0)
    expect(coordDe(fem, "N2")).toEqual([0, 3, 0]); // extremo LIBRE (x menor)
    expect(coordDe(fem, "N3")).toEqual([3, 3, 0]); // cabeza pilar = empotramiento viga
  });

  it("barras: pilar M1 (pie->cabeza) y viga M2 del extremo libre al empotrado", () => {
    expect(fem.members.map((m) => m.name)).toEqual(["M1", "M2"]);
    const pilar = fem.members.find((m) => m.name === "M1")!;
    expect([pilar.i, pilar.j]).toEqual(["N1", "N3"]); // pie->cabeza
    const viga = fem.members.find((m) => m.name === "M2")!;
    // nudoI=libre, nudoJ=empotrado: la carga P actua sobre el NUDO libre (node_load).
    expect([viga.i, viga.j]).toEqual(["N2", "N3"]); // libre -> empotrado
  });

  it("releases #8: voladizo rigido -> ambos extremos empotrados (releases null en todas las barras)", () => {
    for (const m of fem.members) expect(m.releases).toBeNull();
  });

  it("apoyo: UN empotramiento (6 GDL) en el pie del pilar; el extremo libre no tiene apoyo", () => {
    expect(fem.supports).toHaveLength(1);
    const s = fem.supports[0];
    expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([
      true, true, true, true, true, true,
    ]);
    expect(s.node).toBe("N1"); // pie del pilar
    expect(coordDe(fem, s.node)[1]).toBe(0);
    // El extremo libre (N2) NO es apoyo.
    expect(fem.supports.map((s) => s.node)).not.toContain("N2");
  });

  it("carga #3: UNA node_load FY negativa en el extremo libre (N2), sin dist/pt loads", () => {
    // F1 no emite puntuales sobre barra (sin posicion); el voladizo aplica P sobre el
    // NUDO libre, que es donde fisicamente actua. M en el empotramiento = P·L.
    expect(fem.node_loads).toHaveLength(1);
    expect(fem.dist_loads).toHaveLength(0);
    expect(fem.pt_loads).toHaveLength(0);
    const nl = fem.node_loads[0];
    expect(nl.node).toBe("N2"); // extremo libre del voladizo
    expect(nl.direction).toBe("FY"); // GLOBAL vertical
    expect(nl.P).toBe(-20); // gravedad: -P
    expect(nl.case).toBe("G");
  });

  it("trazabilidad: 1 pilar empotrado bajo el extremo j; nudo libre y empotrado mapeados", () => {
    const t = trazabilidadDe(fixtureVoladizoPuntual({ L: 3, P: 20, cota: 3 }));
    expect(t.pilarAMembers).toEqual({ apemp: ["M1"] });
    expect(t.vigaAMember).toEqual({ viga: "M2" });
    // El pilar empotrado arranca en el pie (N1).
    expect(t.pilarANodoArranque).toEqual({ apemp: "N1" });
    // Nudo libre -> extremo libre (N2); nudo empotrado -> cabeza del pilar (N3).
    expect(t.nudoANodo).toEqual({ nlibre: "N2", nemp: "N3" });
  });
});

// =============================================================================
// 3) BIAPOYADA con carga puntual CENTRADA.  M=PL/4, δ=PL³/48EI.
//    Viga partida en dos vanos colineales que comparten el nudo central; P sobre
//    ESE nudo (node_load, no sobre barra). Dos pilares de base empotrada en los
//    extremos; viga ARTICULADA en los apoyos y CONTINUA en el centro.
// =============================================================================
describe("golden discretizador · biapoyada con carga puntual centrada", () => {
  const fem = discretizarOExplotar(fixtureBiapoyadaPuntualCentro({ L: 8, P: 40, cota: 3 }));

  it("contrato + material/seccion del fixture", () => {
    assertContratoValido(fem);
    assertMaterialYSeccion(fem);
  });

  it("nodos: 5 (2 pies + 3 a nivel de viga incluido el central), numerados por (Y,X,Z)", () => {
    // Pies Y=0: (0,0,0),(8,0,0). Nivel viga Y=3 por X: (0,3,0),(4,3,0),(8,3,0).
    expect(fem.nodes).toHaveLength(5);
    expect(coordDe(fem, "N1")).toEqual([0, 0, 0]); // pie izq
    expect(coordDe(fem, "N2")).toEqual([8, 0, 0]); // pie der
    expect(coordDe(fem, "N3")).toEqual([0, 3, 0]); // apoyo izq (cabeza pilar)
    expect(coordDe(fem, "N4")).toEqual([4, 3, 0]); // NUDO CENTRAL (L/2), sin pilar
    expect(coordDe(fem, "N5")).toEqual([8, 3, 0]); // apoyo der (cabeza pilar)
  });

  it("barras: 2 pilares + 2 vanos de viga colineales que comparten el nudo central", () => {
    // M1,M2 pilares (api,apj por id). Vigas por id: vder antes que vizq.
    expect(fem.members.map((m) => m.name)).toEqual(["M1", "M2", "M3", "M4"]);
    // Las dos barras de viga estan a nivel Y=3 y comparten el nodo central N4.
    const vigas = fem.members.filter((m) => m.name === "M3" || m.name === "M4");
    const tocanCentro = vigas.filter((v) => v.i === "N4" || v.j === "N4");
    expect(tocanCentro).toHaveLength(2); // ambos vanos pasan por el centro
    // Juntas cubren del apoyo izq (N3) al apoyo der (N5) pasando por N4.
    const extremos = new Set(vigas.flatMap((v) => [v.i, v.j]));
    expect(extremos).toEqual(new Set(["N3", "N4", "N5"]));
  });

  it("releases #8: rotula en CADA apoyo extremo, continuidad en el centro", () => {
    const vigas = fem.members.filter((m) => m.name === "M3" || m.name === "M4");
    for (const v of vigas) {
      const r = v.releases!;
      expect(r).not.toBeNull();
      // El extremo que toca un APOYO (N3 o N5) esta articulado; el que toca el
      // CENTRO (N4) esta empotrado (continuidad). Comprobamos que exactamente un
      // extremo de cada vano libera Ry,Rz y el otro no.
      const iEsCentro = v.i === "N4";
      const jEsCentro = v.j === "N4";
      // i articulado <=> i NO es el centro; idem j.
      expect([r[4], r[5]]).toEqual([!iEsCentro, !iEsCentro]); // Ryi,Rzi
      expect([r[10], r[11]]).toEqual([!jEsCentro, !jEsCentro]); // Ryj,Rzj
      expect(r[3] && r[9]).toBe(false); // nunca Rx en ambos
    }
  });

  it("apoyos: 2 empotramientos (6 GDL) en los pies; el nudo central NO es apoyo (flecta libre)", () => {
    expect(fem.supports).toHaveLength(2);
    for (const s of fem.supports) {
      expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([
        true, true, true, true, true, true,
      ]);
      expect(coordDe(fem, s.node)[1]).toBe(0); // pie
    }
    expect(fem.supports.map((s) => s.node).sort()).toEqual(["N1", "N2"]);
    // N4 (centro) no aparece como apoyo -> queda libre para flectar.
    expect(fem.supports.map((s) => s.node)).not.toContain("N4");
  });

  it("carga #3: UNA node_load FY negativa en el NUDO CENTRAL, sin dist/pt loads", () => {
    expect(fem.node_loads).toHaveLength(1);
    expect(fem.dist_loads).toHaveLength(0);
    expect(fem.pt_loads).toHaveLength(0);
    const nl = fem.node_loads[0];
    expect(nl.node).toBe(nombreEn(fem, [4, 3, 0])); // nudo central (L/2)
    expect(nl.node).toBe("N4");
    expect(nl.direction).toBe("FY"); // GLOBAL vertical
    expect(nl.P).toBe(-40); // gravedad: -P
    expect(nl.case).toBe("G");
  });

  it("trazabilidad: 2 pilares + 2 vigas (cada viga a su member); nudo central mapeado", () => {
    const t = trazabilidadDe(fixtureBiapoyadaPuntualCentro({ L: 8, P: 40, cota: 3 }));
    expect(t.pilarAMembers).toEqual({ api: ["M1"], apj: ["M2"] });
    // Dos vigas: vder (id menor) -> M3, vizq -> M4 (orden de barras: por id).
    expect(t.vigaAMember).toEqual({ vder: "M3", vizq: "M4" });
    expect(t.pilarANodoArranque).toEqual({ api: "N1", apj: "N2" });
    // Nudos de obra: apoyos (N3,N5) y el central compartido por ambas vigas (N4).
    expect(t.nudoANodo).toEqual({ ni: "N3", nc: "N4", nj: "N5" });
  });
});

// =============================================================================
// 4) PORTICO SIMPLE: dos pilares empotrados en base + dintel con UDL.
//    Hiperestatico (sin formula cerrada elemental): aqui solo blindamos la
//    TRADUCCION (uniones rigidas, apoyos, carga). T1.2 verifica los esfuerzos
//    contra valores tabulados / equilibrio global.
// =============================================================================
describe("golden discretizador · portico simple (uniones rigidas)", () => {
  const fem = discretizarOExplotar(fixturePorticoSimple({ B: 5, H: 3, q: 12 }));

  it("contrato + material/seccion del fixture", () => {
    assertContratoValido(fem);
    assertMaterialYSeccion(fem);
  });

  it("nodos: 4 (2 pies + 2 cabezas), mapeo de ejes y numeracion por (Y,X,Z)", () => {
    expect(fem.nodes).toHaveLength(4);
    expect(coordDe(fem, "N1")).toEqual([0, 0, 0]); // pie izq
    expect(coordDe(fem, "N2")).toEqual([5, 0, 0]); // pie der
    expect(coordDe(fem, "N3")).toEqual([0, 3, 0]); // cabeza izq (nudo dintel)
    expect(coordDe(fem, "N4")).toEqual([5, 3, 0]); // cabeza der (nudo dintel)
  });

  it("barras: 2 pilares + dintel, con UNIONES RIGIDAS (releases null en todo el portico)", () => {
    expect(fem.members.map((m) => m.name)).toEqual(["M1", "M2", "M3"]);
    const dintel = fem.members.find((m) => m.name === "M3")!;
    expect([dintel.i, dintel.j]).toEqual(["N3", "N4"]); // une las cabezas
    // Portico rigido: NINGUNA barra libera giros (lo que lo hace hiperestatico).
    for (const m of fem.members) expect(m.releases).toBeNull();
  });

  it("apoyos: 2 empotramientos (6 GDL) en las bases (Y=0)", () => {
    expect(fem.supports).toHaveLength(2);
    for (const s of fem.supports) {
      expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([
        true, true, true, true, true, true,
      ]);
      expect(coordDe(fem, s.node)[1]).toBe(0);
    }
    expect(fem.supports.map((s) => s.node).sort()).toEqual(["N1", "N2"]);
  });

  it("carga #3: UNA dist_load FY negativa sobre el dintel (toda la barra)", () => {
    expect(fem.dist_loads).toHaveLength(1);
    expect(fem.pt_loads).toHaveLength(0);
    expect(fem.node_loads).toHaveLength(0);
    const dl = fem.dist_loads[0];
    expect(dl.member).toBe("M3"); // el dintel
    expect(dl.direction).toBe("FY");
    expect(dl.w1).toBe(-12);
    expect(dl.w2).toBe(-12);
    expect([dl.x1, dl.x2]).toEqual([null, null]);
    expect(dl.case).toBe("G");
  });

  it("trazabilidad: cada pilar -> 1 member; dintel -> 1 member; arranques en los pies", () => {
    const t = trazabilidadDe(fixturePorticoSimple({ B: 5, H: 3, q: 12 }));
    // Orden de barras: pilares por id ("pder" < "pizq") -> pder=M1, pizq=M2.
    expect(t.pilarAMembers).toEqual({ pder: ["M1"], pizq: ["M2"] });
    expect(t.vigaAMember).toEqual({ dintel: "M3" });
    // pilarANodoArranque apunta a los nodos de apoyo (los pies): pder en (5,0,0)=N2,
    // pizq en (0,0,0)=N1.
    expect(t.pilarANodoArranque).toEqual({ pder: "N2", pizq: "N1" });
    expect(Object.values(t.pilarANodoArranque).sort()).toEqual(
      fem.supports.map((s) => s.node).sort(),
    );
    expect(t.nudoANodo).toEqual({ nizq: "N3", nder: "N4" });
  });
});

// =============================================================================
// DETERMINISMO de los casos de libro: reordenar la entrada no cambia la Capa 2.
// Complementa el determinismo del portico generico de discretizar.test.ts,
// extendiendolo a los fixtures golden (mas barras/nodos/cargas).
// =============================================================================
describe("golden discretizador · determinismo byte a byte de los casos de libro", () => {
  it("biapoyada puntual centrada: barajar nudos/cargas/vigas da la MISMA Capa 2", () => {
    const base = fixtureBiapoyadaPuntualCentro({ L: 8, P: 40, cota: 3 });
    const reordenado = {
      ...base,
      nudos: [...base.nudos].reverse(),
      vigas: [...base.vigas].reverse(),
      cargas: [...base.cargas].reverse(),
      pilares: [...base.pilares].reverse(),
    };
    const a = JSON.stringify(discretizarOExplotar(base));
    const b = JSON.stringify(discretizarOExplotar(reordenado));
    expect(b).toBe(a);
  });
});

// =============================================================================
// NUDO COMPARTIDO ENTRE PLANTAS (T-discretizar-nudo-orden).
//
// Un Nudo de Capa 1 es {id,x,y} en planta, SIN cota (dominio/nudo.ts): la cota la
// aporta la PLANTA de la viga que lo usa. Por eso el MISMO nudoId puede ser usado
// por vigas en plantas distintas -> cotas distintas -> nodos FEM distintos. Y una
// Carga sobre `ambito=nudoId` no porta planta. Este fixture monta ese caso ambiguo
// para blindar: (a) que `localizarNodoDeNudo` itere por id (determinismo, no orden
// de insercion) y (b) el desempate documentado (primera viga por id).
//
// Geometria: dos pilares pasantes en (0,0) y (5,0) que suben de cota 0 a cota 6
// atravesando la planta intermedia (cota 3) -> troceados, generan nodo FEM a cota 3
// y a cota 6. Vigas en cada nivel uniendo las cabezas/tramos de pilar; ambas usan el
// nudo compartido `nc` (id "nc") en (0,0). Bases empotradas (estructura estable).
// Carga puntual sobre `nc`.
// =============================================================================

// Ids de viga elegidos para fijar el orden total por id: "v-alta" < "v-baja".
// La viga de id menor ("v-alta") vive en la planta ALTA (cota 6); el desempate
// documentado (primera viga por id) debe atar el nudo `nc` a la cota 6 (nodo alto),
// NO a la planta baja. Asi el test distingue "primera por id" de cualquier criterio
// de cota (menor/mayor) o de orden de insercion.
function fixtureNudoCompartidoEntrePlantas(): Modelo {
  const seccion = {
    id: SECCION_GOLDEN,
    nombre: "IPE 300",
    tipo: "perfilMetalico" as const,
    perfilId: "IPE300",
  };
  const pilarPasante = (id: string, x: number) => ({
    id,
    nombre: id.toUpperCase(),
    x,
    y: 0,
    plantaInicial: "p0", // cota 0
    plantaFinal: "p2", // cota 6, atraviesa p1 (cota 3)
    seccionId: SECCION_GOLDEN,
    materialId: MATERIAL_GOLDEN,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado" as const,
  });
  const viga = (id: string, plantaId: string) => ({
    id,
    nombre: id.toUpperCase(),
    plantaId,
    nudoI: "nc", // nudo COMPARTIDO entre las dos plantas (en (0,0))
    nudoJ: "nd", // extremo opuesto (en (5,0)); tambien compartido, simetrico
    seccionId: SECCION_GOLDEN,
    materialId: MATERIAL_GOLDEN,
    extremoI: "empotrado" as const,
    extremoJ: "empotrado" as const,
    tirante: false,
  });
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      {
        id: "g1",
        nombre: "Grupo",
        categoriaUso: "A" as const,
        sobrecargaUso: 2,
        cargasMuertas: 1,
      },
    ],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta baja", cota: 3, altura: 3, grupoId: "g1" },
      { id: "p2", nombre: "Planta alta", cota: 6, altura: 3, grupoId: "g1" },
    ],
    secciones: [seccion],
    nudos: [
      { id: "nc", x: 0, y: 0 },
      { id: "nd", x: 5, y: 0 },
    ],
    pilares: [pilarPasante("pa", 0), pilarPasante("pb", 5)],
    // Orden de insercion DELIBERADAMENTE distinto al orden por id: la viga baja
    // (cota 3) se inserta PRIMERO. Con el bug original ("primera de modelo.vigas")
    // el nudo se ataria a la cota 3; con el fix ("primera por id") va a "v-alta"=cota 6.
    vigas: [viga("v-baja", "p1"), viga("v-alta", "p2")],
    panos: [],
    muros: [],
    cargas: [{ id: "P", tipo: "puntual", ambito: "nc", valor: 30, hipotesisId: "G" }],
    hipotesis: [{ id: "G", nombre: "Permanente", tipo: "permanente" as const, automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

describe("golden discretizador · localizarNodoDeNudo: determinismo y nudo compartido entre plantas", () => {
  it("determinismo: barajar modelo.vigas/cargas NO cambia node_loads ni trazabilidad.nudoANodo", () => {
    const base = fixtureNudoCompartidoEntrePlantas();
    // Reordena las colecciones que alimentan localizarNodoDeNudo (vigas) y el orden
    // de cargas. El resultado debe ser identico (deep equal byte a byte).
    const reordenado: Modelo = {
      ...base,
      vigas: [...base.vigas].reverse(),
      cargas: [...base.cargas].reverse(),
      nudos: [...base.nudos].reverse(),
      pilares: [...base.pilares].reverse(),
    };
    const a = discretizarOExplotar(base);
    const b = discretizarOExplotar(reordenado);
    // node_loads y la Capa 2 entera, byte a byte.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // trazabilidad.nudoANodo, byte a byte (canal aditivo, no parte del ModeloFEM).
    expect(trazabilidadDe(reordenado).nudoANodo).toEqual(
      trazabilidadDe(base).nudoANodo,
    );
  });

  it("desempate documentado: el nudo compartido se ata a la PRIMERA viga por id (cota 6), estable", () => {
    const fem = discretizarOExplotar(fixtureNudoCompartidoEntrePlantas());
    const t = trazabilidadDe(fixtureNudoCompartidoEntrePlantas());
    // "v-alta" < "v-baja" por id -> el desempate elige la planta alta (cota 6).
    // El nodo FEM de `nc` debe estar a Y=6, NO a Y=3 (planta baja) ni depender del
    // orden de insercion (que mete la viga baja primero).
    const nodoNc = t.nudoANodo["nc"];
    expect(nodoNc).toBeDefined();
    expect(coordDe(fem, nodoNc)).toEqual([0, 6, 0]); // cota 6 (planta alta)
    // La carga puntual sobre `nc` cae sobre ESE mismo nodo (cota 6).
    expect(fem.node_loads).toHaveLength(1);
    expect(fem.node_loads[0].node).toBe(nodoNc);
    expect(fem.node_loads[0].direction).toBe("FY");
    expect(fem.node_loads[0].P).toBe(-30); // gravedad descendente
    // `nd` (extremo opuesto, tambien compartido) se ata igualmente a la cota 6.
    expect(coordDe(fem, t.nudoANodo["nd"])).toEqual([5, 6, 0]);
  });
});

// =============================================================================
// nodoFEMAPlanta (F0.2): asignacion AUTORITATIVA de cada nudo FEM a su planta, por
// CONTEXTO DE CREACION (decision 1A). NO es el heuristico de cargas: los nudos de
// pilar van a la planta de su cota; los de viga, a su planta DECLARADA. TODO nudo de
// `nodes` debe mapear. Lo consume F2 (centro de rigidez) para el diafragma por planta.
// =============================================================================

// Fixture de CONFLICTO de snap: dos GRUPOS con una planta a la MISMA cota (3) y un
// pilar por grupo, ambos en (0,0). Sus cabezas snapean al MISMO nudo FEM (mismo X,Z y
// misma cota) pero lo reclaman dos plantas (pa1 de g1, pa2 de g2). El desempate
// determinista (primera planta por id) debe elegir SIEMPRE la de id menor, sin NaN ni
// no-determinismo. Estructura estable: cada pilar empotrado en su base (cota 0).
function fixtureConflictoSnapDosGrupos(): Modelo {
  const seccion = {
    id: SECCION_GOLDEN,
    nombre: "IPE 300",
    tipo: "perfilMetalico" as const,
    perfilId: "IPE300",
  };
  const grupo = (id: string) => ({
    id,
    nombre: id,
    categoriaUso: "A" as const,
    sobrecargaUso: 2,
    cargasMuertas: 1,
  });
  // Pilar de g{n}: sube de su base (cota 0) a su planta de techo (cota 3), en (0,0).
  const pilar = (id: string, plantaInicial: string, plantaFinal: string) => ({
    id,
    nombre: id.toUpperCase(),
    x: 0,
    y: 0,
    plantaInicial,
    plantaFinal,
    seccionId: SECCION_GOLDEN,
    materialId: MATERIAL_GOLDEN,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado" as const,
  });
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [grupo("g1"), grupo("g2")],
    plantas: [
      // Bases (cota 0): distintas por grupo (no colisionan; pilares distintos en x?
      // no: ambos en (0,0) y cota 0 tambien colisionan -> tambien es conflicto, mismo
      // desempate). Techos: AMBOS a cota 3 -> el nudo de cabeza es el conflicto clave.
      { id: "p0a", nombre: "Base g1", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p0b", nombre: "Base g2", cota: 0, altura: 3, grupoId: "g2" },
      { id: "p1a", nombre: "Techo g1", cota: 3, altura: 3, grupoId: "g1" },
      { id: "p1b", nombre: "Techo g2", cota: 3, altura: 3, grupoId: "g2" },
    ],
    secciones: [seccion],
    nudos: [],
    pilares: [pilar("pa1", "p0a", "p1a"), pilar("pa2", "p0b", "p1b")],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [
      { id: "G", nombre: "Permanente", tipo: "permanente" as const, automatica: false },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

describe("golden discretizador · nodoFEMAPlanta (asignacion autoritativa por planta)", () => {
  it("portico de 1 planta: cada nudo FEM mapea a su planta (pies p0, cabezas/viga p1)", () => {
    const modelo = fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 });
    const fem = discretizarOExplotar(modelo);
    const t = trazabilidadDe(modelo);
    // TODO nudo de nodes tiene entrada (invariante del discretizador).
    expect(Object.keys(t.nodoFEMAPlanta).sort()).toEqual(
      fem.nodes.map((n) => n.name).sort(),
    );
    // Pies (Y=0) -> planta de cimentacion p0; cabezas + extremos de viga (Y=3) -> p1.
    for (const n of fem.nodes) {
      const plantaEsperada = n.y === 0 ? "p0" : "p1";
      expect(t.nodoFEMAPlanta[n.name]).toBe(plantaEsperada);
    }
  });

  it("pilar pasante 2 plantas: el nudo de cada cota mapea a la planta de ESA cota", () => {
    // Pilares pasantes p0(0)->p2(6) atravesando p1(3); vigas en p1 y p2.
    const modelo = fixtureNudoCompartidoEntrePlantas();
    const fem = discretizarOExplotar(modelo);
    const t = trazabilidadDe(modelo);
    // Cobertura total: todo nudo mapeado.
    expect(Object.keys(t.nodoFEMAPlanta).sort()).toEqual(
      fem.nodes.map((n) => n.name).sort(),
    );
    // La planta de cada nudo se deduce de su cota (Y): 0->p0, 3->p1 (intermedia del
    // troceo, nudo de viga "v-baja"), 6->p2 (cabezas + nudo de viga "v-alta").
    const plantaPorCota: Record<number, string> = { 0: "p0", 3: "p1", 6: "p2" };
    for (const n of fem.nodes) {
      expect(t.nodoFEMAPlanta[n.name]).toBe(plantaPorCota[n.y]);
    }
  });

  it("nudo de viga -> v.plantaId (planta declarada, no la cota por casualidad)", () => {
    // En el fixture pasante, los extremos de "v-alta" (p2) estan a cota 6; su mapeo es
    // p2 por DECLARACION (coincide con el pilar). Para aislar la regla "planta
    // declarada", basta verificar que el nudo de la viga de p1 (cota 3) -> p1.
    const modelo = fixtureNudoCompartidoEntrePlantas();
    const fem = discretizarOExplotar(modelo);
    const t = trazabilidadDe(modelo);
    const nudoCota3 = fem.nodes.find((n) => n.y === 3 && n.x === 0)!; // extremo de v-baja
    expect(t.nodoFEMAPlanta[nudoCota3.name]).toBe("p1");
  });

  it("conflicto de snap entre grupos: desempate determinista (planta de id menor)", () => {
    const modelo = fixtureConflictoSnapDosGrupos();
    const fem = discretizarOExplotar(modelo);
    const t = trazabilidadDe(modelo);
    // 2 nudos: base comun (0,0,0) y cabeza comun (0,3,0) — ambos compartidos por los
    // dos pilares de grupos distintos (snapping geometrico colapsa a 1 nudo cada uno).
    expect(fem.nodes).toHaveLength(2);
    // Cobertura total + desempate: base -> p0a (< p0b), cabeza -> p1a (< p1b).
    const base = fem.nodes.find((n) => n.y === 0)!;
    const cabeza = fem.nodes.find((n) => n.y === 3)!;
    expect(t.nodoFEMAPlanta[base.name]).toBe("p0a");
    expect(t.nodoFEMAPlanta[cabeza.name]).toBe("p1a");
  });

  it("determinismo: barajar plantas/grupos/pilares NO cambia nodoFEMAPlanta", () => {
    const base = fixtureConflictoSnapDosGrupos();
    const reordenado: Modelo = {
      ...base,
      plantas: [...base.plantas].reverse(),
      grupos: [...base.grupos].reverse(),
      pilares: [...base.pilares].reverse(),
    };
    expect(trazabilidadDe(reordenado).nodoFEMAPlanta).toEqual(
      trazabilidadDe(base).nodoFEMAPlanta,
    );
  });
});
