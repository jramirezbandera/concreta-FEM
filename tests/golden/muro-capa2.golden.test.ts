// GOLDEN Capa A de MUROS/pantallas (F3, muros). Node PURO, sin motor: asevera la
// ESTRUCTURA de la Capa 2 que emite discretizar() con un muro en el modelo.
//
// El muro se malla en quads MQ<idx>-Q<k> en su plano vertical (Paso 6e). Aqui se
// blindan las invariantes de la emision SIN Pyodide (la FISICA — voladizo vs
// Timoshenko, membrana — es Capa B: muro-voladizo/muro-discretizado):
//   1. Remap por celda: la fila de CORONACION bajo una viga colineal referencia los
//      N* del portico (la viga subdividida), no nudos MQ; el pie/cabeza de un pilar
//      en el extremo del eje tambien se fusiona.
//   2. Apoyos de fila BASE (vinculacionExterior): 6 GDL por nudo FINAL, sin entradas
//      duplicadas de supports (def_support ASIGNA: dos entradas se pisarian).
//   3. Peso propio NODAL: node_loads FY en el case automatico con SumaP = -rho*t*L*H
//      exacta (NUNCA presion de superficie: la normal del muro es horizontal).
//   4. Trazabilidad: muroAQuads/quadAMuro/quadANodos/nodosDeMalla/apoyosDeMalla.
//   5. Fusion MURO<->MURO (nucleo en L): la columna compartida tiene UN nudo por celda.
//   6. Regresion: el mismo modelo sin muros no emite ni un nudo MQ ni la clave quads.
//   7. Determinismo: discretizar dos veces = deep-equal.
import { describe, it, expect } from "vitest";
import { discretizar } from "../../src/discretizador";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import type { Trazabilidad } from "../../src/discretizador/contratoFEM";
import type { Modelo, Muro } from "../../src/dominio";
import { SCHEMA_VERSION, ID_HIP_PESO_PROPIO } from "../../src/dominio";

const MATERIAL_MURO = "HA-25";
const MATERIAL_BARRA = "S275";
const SECCION = "sec-ipe";

const RHO_HA = 25.0; // kN/m3 (peso especifico HA, biblioteca)
const ESPESOR = 0.3; // m
const L_MURO = 4.0; // m
const H_MURO = 3.0; // m (p0 cota 0 -> p1 cota 3)

// Modelo canonico: 2 plantas, 2 pilares en los extremos del eje del muro (0,0) y
// (4,0), viga de coronacion colineal en p1, y el muro (0,0)-(4,0) de p0 a p1 con
// base vinculada. tamMalla 1 -> rejilla 4x3 (12 quads, filas en cotas 0..3).
// El peso propio esta ACTIVADO (hipotesis automatica sembrada).
function modeloConMuro(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: SECCION, nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: L_MURO, y: 0 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil2", nombre: "P2", x: L_MURO, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    ],
    vigas: [
      {
        id: "v-cor", nombre: "VCOR", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: SECCION, materialId: MATERIAL_BARRA,
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
    ],
    panos: [],
    muros: [
      {
        id: "mu1", nombre: "M1",
        x1: 0, y1: 0, x2: L_MURO, y2: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        espesor: ESPESOR, materialId: MATERIAL_MURO, tamMalla: 1,
        vinculacionExterior: true,
      },
    ],
    cargas: [],
    hipotesis: [
      { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

function discretizarOk(m: Modelo): { fem: ModeloFEM; traza: Trazabilidad } {
  const r = discretizar(m);
  if (!r.ok) throw new Error("discretizar fallo: " + JSON.stringify(r.errores));
  return { fem: r.modeloFEM, traza: r.trazabilidad };
}

// Nudo FEM en la posicion exacta (x=obra x, y=cota, z=obra y), o undefined.
function nodoEn(fem: ModeloFEM, x: number, y: number, z: number) {
  return fem.nodes.filter((n) => n.x === x && n.y === y && n.z === z);
}

describe("golden Capa 2 · muro/pantalla (Paso 6e)", () => {
  it("1. remap por celda: coronacion -> N* de la viga subdividida; extremos -> N* de pilar", () => {
    const { fem } = discretizarOk(modeloConMuro());
    // En cada columna de la coronacion (cota 3) hay UN solo nudo y NO es MQ: es el
    // N* del portico (extremos = cabezas de pilar; interiores = subdivision de v-cor).
    for (const s of [0, 1, 2, 3, 4]) {
      const enPos = nodoEn(fem, s, H_MURO, 0);
      expect(enPos, `nudo unico en (${s},3,0)`).toHaveLength(1);
      expect(enPos[0].name.startsWith("MQ")).toBe(false);
    }
    // La fila base: extremos (s=0,4) son pies de pilar (N*); interiores (s=1..3) son MQ.
    for (const s of [0, L_MURO]) {
      const enPos = nodoEn(fem, s, 0, 0);
      expect(enPos).toHaveLength(1);
      expect(enPos[0].name.startsWith("MQ")).toBe(false);
    }
    for (const s of [1, 2, 3]) {
      const enPos = nodoEn(fem, s, 0, 0);
      expect(enPos).toHaveLength(1);
      expect(enPos[0].name.startsWith("MQ0-")).toBe(true);
    }
    // Los quads de la fila superior referencian nudos del portico en m/n (fila+1).
    const quads = fem.quads ?? [];
    expect(quads).toHaveLength(12);
    const filaSup = quads.slice(8); // fila-major: los ultimos 4 son la fila superior
    for (const q of filaSup) {
      expect(q.m.startsWith("MQ")).toBe(false);
      expect(q.n.startsWith("MQ")).toBe(false);
    }
    // Todos los quads llevan el espesor y material del muro.
    for (const q of quads) {
      expect(q.t).toBe(ESPESOR);
      expect(q.material).toBe(MATERIAL_MURO);
    }
  });

  it("2. apoyos de fila base: 6 GDL por nudo FINAL, sin entradas duplicadas de supports", () => {
    const { fem } = discretizarOk(modeloConMuro());
    // Sin duplicados: def_support ASIGNA, dos entradas por nudo se pisarian.
    const nombres = fem.supports.map((s) => s.node);
    expect(new Set(nombres).size).toBe(nombres.length);
    // Cada nudo de la fila base (5 columnas) tiene apoyo 6 GDL (los extremos son los
    // arranques de pilar, ya empotrados; los interiores los aporta el muro).
    const porNodo = new Map(fem.supports.map((s) => [s.node, s]));
    for (const s of [0, 1, 2, 3, 4]) {
      const [nd] = nodoEn(fem, s, 0, 0);
      const apoyo = porNodo.get(nd.name);
      expect(apoyo, `apoyo en fila base s=${s}`).toBeDefined();
      expect(apoyo).toMatchObject({ DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true });
    }
  });

  it("3. peso propio NODAL: SumaP del case automatico (parte muro) = -rho*t*L*H exacta", () => {
    const { fem } = discretizarOk(modeloConMuro());
    // El muro NO aporta quad_loads (su peso es nodal); las barras aportan dist_loads.
    expect(fem.quad_loads).toBeUndefined();
    // Cargas nodales del case automatico: solo las emite el muro (no hay cargas de
    // usuario). Su suma debe cerrar el peso exacto del muro.
    const pp = fem.node_loads.filter((nl) => nl.case === ID_HIP_PESO_PROPIO);
    expect(pp.length).toBe(12 * 4); // 12 quads x 4 nudos
    const suma = pp.reduce((acc, nl) => acc + nl.P, 0);
    expect(suma).toBeCloseTo(-RHO_HA * ESPESOR * L_MURO * H_MURO, 10); // -90 kN
    for (const nl of pp) expect(nl.direction).toBe("FY");
  });

  it("4. trazabilidad: muroAQuads/quadAMuro/quadANodos/nodosDeMalla/apoyosDeMalla", () => {
    const { fem, traza } = discretizarOk(modeloConMuro());
    expect(traza.muroAQuads?.["mu1"]).toHaveLength(12);
    for (const q of fem.quads ?? []) {
      expect(traza.quadAMuro?.[q.name]).toBe("mu1");
      expect(traza.quadANodos[q.name]).toEqual([q.i, q.j, q.m, q.n]);
    }
    // Nudos de malla = solo los MQ propios (los remapeados N* no son de malla).
    for (const nm of traza.nodosDeMalla) expect(nm.startsWith("MQ0-")).toBe(true);
    // Apoyos de malla = solo los de fila base PROPIOS (s=1..3); los N* de pilar
    // conservan su presentacion estructural (su reaccion no se oculta en la tabla).
    expect(traza.apoyosDeMalla).toHaveLength(3);
    for (const nm of traza.apoyosDeMalla) expect(nm.startsWith("MQ0-")).toBe(true);
  });

  it("5. nucleo en L: dos muros que comparten arista vertical comparten nudos (un nudo por celda)", () => {
    const m = modeloConMuro();
    // Segundo muro segun obra-Y arrancando en el extremo (0,0) del primero: la
    // columna vertical en (0, y) es comun a ambos.
    const muroB: Muro = {
      id: "mu2", nombre: "M2",
      x1: 0, y1: 0, x2: 0, y2: 4,
      plantaInicial: "p0", plantaFinal: "p1",
      espesor: ESPESOR, materialId: MATERIAL_MURO, tamMalla: 1,
      vinculacionExterior: true,
    };
    m.muros.push(muroB);
    const { fem } = discretizarOk(m);
    // En la esquina compartida no hay nudos duplicados a ninguna cota.
    for (const cota of [0, 1, 2, 3]) {
      expect(nodoEn(fem, 0, cota, 0), `celda (0,${cota},0)`).toHaveLength(1);
    }
    // Y los quads de mu2 (MQ1-*) referencian en su columna s=0 los nudos ya emitidos
    // (del portico o de mu1), nunca un MQ1 duplicado en la misma celda.
    const nombresPorPos = new Map<string, string>();
    for (const n of fem.nodes) nombresPorPos.set(`${n.x}|${n.y}|${n.z}`, n.name);
    const quadsB = (fem.quads ?? []).filter((q) => q.name.startsWith("MQ1-"));
    expect(quadsB).toHaveLength(12); // 4x3 tambien
    // La columna compartida de mu2 es la de x=0, z=0 (su s=0). Sus quads de esa
    // columna usan el nombre del nudo canonico de la celda.
    for (const q of quadsB) {
      for (const nombre of [q.i, q.j, q.m, q.n]) {
        const nd = fem.nodes.find((n) => n.name === nombre);
        expect(nd, `nudo ${nombre} existe`).toBeDefined();
        expect(nombresPorPos.get(`${nd!.x}|${nd!.y}|${nd!.z}`)).toBe(nombre);
      }
    }
  });

  it("6. regresion: el mismo modelo sin muros no emite MQ ni quads", () => {
    const m = modeloConMuro();
    m.muros = [];
    const { fem, traza } = discretizarOk(m);
    expect(fem.quads).toBeUndefined();
    expect(fem.nodes.some((n) => n.name.startsWith("MQ"))).toBe(false);
    expect(fem.node_loads.filter((nl) => nl.case === ID_HIP_PESO_PROPIO)).toEqual([]);
    expect(traza.muroAQuads).toEqual({});
    expect(traza.quadAMuro).toEqual({});
  });

  it("7. determinismo: discretizar dos veces produce Capa 2 deep-equal", () => {
    const a = discretizarOk(modeloConMuro());
    const b = discretizarOk(modeloConMuro());
    expect(b.fem).toEqual(a.fem);
    expect(b.traza).toEqual(a.traza);
  });
});
