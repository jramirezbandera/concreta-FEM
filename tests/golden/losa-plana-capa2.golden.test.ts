// GOLDEN Capa A de la LOSA PLANA sobre pilares INTERIORES (F2.3 / T-f3-losa-plana,
// corte 3). Node PURO, sin motor: asevera la ESTRUCTURA de la Capa 2 que emite
// discretizar() cuando una losa maciza se apoya ADEMAS en >=1 pilar INTERIOR acoplado.
//
// El acople de cabeza (F2.0/F2.1/F2.2 ya en main) hace que la cabeza de cada pilar
// interior caiga en un nudo de malla que se REMAPEA a su nodo estructural N* (comparte
// nudo = descarga axil al pilar). Aqui blindamos ese remap y sus invariantes SIN
// Pyodide (la FISICA -axil de pilar, SigmaV = carga total- es Capa B, T3.2).
//
// MONTAJE: crujia canonica (4 vigas de contorno + 4 pilares de esquina, como el golden
// de acople por viga) que da a la losa un contorno valido (bordesCompletos=4, no dispara
// PANO_SIN_APOYO), MAS 2 pilares INTERIORES estrictos en (2,1) y (4,3). El corte 1/2 solo
// acoplaba por el BORDE (vigas); aqui la NOVEDAD -y unico delta- es el acople de la CABEZA
// de los pilares interiores. Ver "HALLAZGO" al final: la losa apoyada SOLO en pilares
// interiores (sin vigas, bordeApoyo libre) HOY la bloquea PANO_SIN_APOYO.
//
// Que asevera cada test:
//   5. discretizar ok:true (los pilares interiores acoplados NO disparan PANO_PILAR_INTERIOR).
//   4. Linea de control efectiva: hay un nodo de Capa 2 EXACTO en cada cabeza interior.
//   1. Remap cabeza -> N*: los quads referencian el N* del pilar, no un PQ*-N* de malla.
//   2. Sin muleta: con acople activo NO hay estabilizacion DX/DZ de malla.
//   3. Sin bordeApoyo artificial en nudos remapeados (la cabeza descarga en el pilar).
//   6. Regresion: gemelo SIN pilares interiores = las mismas celdas NO son N* (corte 1/2);
//      anadir el pilar interior es la UNICA diferencia (esos nudos pasan de PQ* a N*).
//   7. Determinismo: reordenar la entrada da Capa 2 deep-equal.
//
// Fixtures/builders LOCALES a este fichero (no se tocan tests/golden/_arnes/*).
import { describe, it, expect } from "vitest";
import { discretizar, clavePosicion, TOL_NODO } from "../../src/discretizador";
import type { ResultadoDiscretizacion } from "../../src/discretizador";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import type { Modelo, Pano, PanoLosa, Pilar, Viga } from "../../src/dominio";
import { SCHEMA_VERSION } from "../../src/dominio";

const MATERIAL = "HA-25";
const SECCION = "sec-viga";

// mapearEjes(x,y,cota) = [x, cota, y]: la vertical es Y. La cabeza de un pilar interior
// en obra (px,py) a la cota del paño vive en el nodo FEM (x=px, y=cota, z=py).
function coordFEMCabeza(px: number, py: number, cota: number): [number, number, number] {
  return [px, cota, py];
}
const COTA_LOSA = 3;

// Crujia 6x4: 4 pilares de esquina (empotrados/vinculados) + 4 vigas de contorno + losa
// 6x4 entre ellas (tamMalla 1 -> rejilla 6x4). `interiores` = coords (x,y) de pilares
// INTERIORES estrictos (0<x<6, 0<y<4) que ACOPLAN la losa por su cabeza. Con [] es el
// gemelo del corte 1/2 (solo acople por borde). Todos los pilares suben de p0 (cota 0)
// a p1 (cota 3 = cota de la losa).
function crujia(interiores: Array<[number, number]>): Modelo {
  const esquinas: Array<[number, number]> = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ];
  const todos = [...esquinas, ...interiores];
  const pilares: Pilar[] = todos.map(([x, y], k) => ({
    id: `pil${k + 1}`,
    nombre: `P${k + 1}`,
    x,
    y,
    plantaInicial: "p0",
    plantaFinal: "p1",
    seccionId: SECCION,
    materialId: MATERIAL,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  }));
  const vigas: Viga[] = (
    [
      ["v1", "n1", "n2"],
      ["v2", "n2", "n3"],
      ["v3", "n3", "n4"],
      ["v4", "n4", "n1"],
    ] as const
  ).map(([id, ni, nj]) => ({
    id,
    nombre: id.toUpperCase(),
    plantaId: "p1",
    nudoI: ni,
    nudoJ: nj,
    seccionId: SECCION,
    materialId: MATERIAL,
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  }));
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    // v4 (plantas sin grupos): la losa recibe SU/CM de SU planta. Aqui valen 0 (como el
    // grupo original), asi que la Capa 2 no cambia.
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: SECCION, nombre: "Seccion 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 6, y: 0 },
      { id: "n3", x: 6, y: 4 },
      { id: "n4", x: 0, y: 4 },
    ],
    pilares,
    vigas,
    panos: [losa("f1")],
    muros: [],
    cargas: [{ id: "c1", tipo: "superficial", ambito: "f1", valor: 5, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

function losa(id: string, extra?: Partial<PanoLosa>): Pano {
  return {
    id,
    nombre: id.toUpperCase(),
    tipo: "losa",
    plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    espesor: 0.2,
    materialId: MATERIAL,
    tamMalla: 1,
    bordeApoyo: "libre", // sostenida por las 4 vigas de contorno (bordesCompletos=4)
    ...extra,
  };
}

type ResOK = Extract<ResultadoDiscretizacion, { ok: true }>;

function ok(res: ResultadoDiscretizacion): ResOK {
  if (!res.ok) {
    throw new Error(`discretizar fallo: ${JSON.stringify(res.errores, null, 2)}`);
  }
  return res;
}

// Nombre del nodo FEM en una coordenada exacta, o undefined si no existe.
function nombreEn(fem: ModeloFEM, [x, y, z]: [number, number, number]): string | undefined {
  return fem.nodes.find((nd) => nd.x === x && nd.y === y && nd.z === z)?.name;
}

// Nudos referenciados por los quads de un paño (via panoAQuads + quadANodos).
function nudosDeQuadsDe(res: ResOK, panoId: string): Set<string> {
  const t = res.trazabilidad;
  const s = new Set<string>();
  for (const q of t.panoAQuads[panoId] ?? []) {
    for (const n of t.quadANodos[q]) s.add(n);
  }
  return s;
}

// Pilares interiores estrictos de referencia: (2,1) y (4,3). Con tamMalla 1 caen en un
// nudo de la rejilla 6x4; su cabeza a cota 3 se remapea al N* del pilar.
const INTERIORES: Array<[number, number]> = [
  [2, 1],
  [4, 3],
];

describe("golden A · losa plana sobre pilares interiores (acople de cabeza)", () => {
  it("5) discretizar ok:true (los pilares interiores acoplados NO disparan PANO_PILAR_INTERIOR)", () => {
    const res = discretizar(crujia(INTERIORES));
    if (!res.ok) {
      // Diagnostico explicito: si bloqueara por PANO_PILAR_INTERIOR es fallo de acople.
      const codigos = res.errores.map((e) => e.codigo);
      expect(codigos).not.toContain("PANO_PILAR_INTERIOR");
      throw new Error(`discretizar deberia ser ok; errores: ${JSON.stringify(res.errores)}`);
    }
    expect(res.ok).toBe(true);
  });

  it("4) linea de control efectiva: existe un nodo de Capa 2 EXACTO en cada cabeza de pilar interior", () => {
    const res = ok(discretizar(crujia(INTERIORES)));
    for (const [px, py] of INTERIORES) {
      const nombre = nombreEn(res.modeloFEM, coordFEMCabeza(px, py, COTA_LOSA));
      // La linea de control derivada del pilar puso un nudo EXACTO en la celda de la
      // cabeza. Sin ese nudo no habria acople posible.
      expect(nombre).toBeDefined();
    }
  });

  it("1) remap cabeza -> N*: los quads referencian el N* estructural del pilar (nudo COMPARTIDO)", () => {
    const res = ok(discretizar(crujia(INTERIORES)));
    const fem = res.modeloFEM;
    const t = res.trazabilidad;
    const nudosQuads = nudosDeQuadsDe(res, "f1");
    const porMember = new Map(fem.members.map((m) => [m.name, m]));
    // Pilares interiores por posicion (para casar cada cabeza con SU pilar via
    // pilarAMembers). El id lo asigna crujia() en orden esquinas(4) + interiores.
    const pilarEnPos = new Map(
      crujia(INTERIORES).pilares.map((p) => [`${p.x}|${p.y}`, p.id]),
    );

    for (const [px, py] of INTERIORES) {
      const coord = coordFEMCabeza(px, py, COTA_LOSA);
      // (a) El nodo de la cabeza es un N* ESTRUCTURAL (no un PQ*-N* de malla): su nombre
      //     casa "N\d+" y NO aparece en nodosDeMalla (que solo lista nudos de malla).
      const nombreCabeza = nombreEn(fem, coord);
      expect(nombreCabeza).toBeDefined();
      expect(/^N\d+$/.test(nombreCabeza!)).toBe(true);
      expect(t.nodosDeMalla).not.toContain(nombreCabeza);

      // (b) Ese MISMO N* es el nodo del pilar en esa cota: se localiza por CLAVE DE
      //     POSICION (mapearEjes -> [x,cota,y]), el mismo criterio que usa el remap del
      //     Paso 6c. UN solo nodo reclama esa celda (cabeza-de-malla y pilar-FEM
      //     colapsan al MISMO nodo = comparten nudo = acople).
      const clave = clavePosicion(coord, TOL_NODO);
      const nodosEnClave = fem.nodes.filter(
        (nd) => clavePosicion([nd.x, nd.y, nd.z], TOL_NODO) === clave,
      );
      expect(nodosEnClave).toHaveLength(1);
      expect(nodosEnClave[0].name).toBe(nombreCabeza);

      // (c) Un quad de la losa referencia ese N*: la cabeza esta en la huella del paño,
      //     luego el nudo de malla de esa celda se remapeo al N* del pilar.
      expect(nudosQuads.has(nombreCabeza!)).toBe(true);

      // (d) Ese N* es LITERALMENTE la cabeza del PILAR (no una coincidencia de posicion):
      //     el ultimo member del pilar (orden pie->cabeza) tiene su nudo j = ese N*. Asi
      //     el mismo nodo es a la vez esquina de quad Y cabeza de pilar = comparten nudo.
      const pilarId = pilarEnPos.get(`${px}|${py}`)!;
      const membersPilar = t.pilarAMembers[pilarId];
      expect(membersPilar).toBeDefined();
      const memberCabeza = porMember.get(membersPilar[membersPilar.length - 1])!;
      expect(memberCabeza.j).toBe(nombreCabeza); // cabeza del pilar == N* del quad
    }

    // Cross-check global: todo nudo referenciado por un quad o es un N* que existe en
    // `nodes`, o es un PQ* listado en nodosDeMalla (interior). (Espejo del golden de
    // acople por viga; aqui los N* provienen de CABEZAS de pilar, ademas del borde.)
    for (const n of nudosQuads) {
      if (n.startsWith("PQ")) {
        expect(t.nodosDeMalla).toContain(n);
      } else {
        expect(/^N\d+$/.test(n)).toBe(true);
        expect(fem.nodes.some((nd) => nd.name === n)).toBe(true);
      }
    }
  });

  it("2) sin muleta de estabilizacion: con acople activo NO hay apoyo DX/DZ de malla", () => {
    const res = ok(discretizar(crujia(INTERIORES)));
    const fem = res.modeloFEM;
    // Ningun support de malla (nombre PQ*) fija DX o DZ (la estabilizacion se OMITE bajo
    // acople; el plano lo sujeta el portico via los nudos compartidos).
    const apoyosMalla = fem.supports.filter((s) => s.node.startsWith("PQ"));
    for (const s of apoyosMalla) {
      expect(s.DX).toBe(false);
      expect(s.DZ).toBe(false);
    }
    // Con las 4 vigas de contorno acoplando el borde + bordeApoyo libre, no debe haber
    // NINGUN apoyo de malla: la losa descarga integramente en el portico.
    expect(res.trazabilidad.apoyosDeMalla).toEqual([]);
    // Los unicos apoyos son los arranques de pilar (pies, cota 0).
    const porNombre = new Map(fem.nodes.map((n) => [n.name, n]));
    for (const s of fem.supports) {
      expect(porNombre.get(s.node)!.y).toBe(0);
    }
  });

  it("3) sin bordeApoyo artificial en nudos remapeados: ninguna cabeza N* recibe apoyo de malla", () => {
    const res = ok(discretizar(crujia(INTERIORES)));
    const apoyosDeMalla = new Set(res.trazabilidad.apoyosDeMalla);
    for (const [px, py] of INTERIORES) {
      const nombreCabeza = nombreEn(res.modeloFEM, coordFEMCabeza(px, py, COTA_LOSA));
      // El nudo remapeado de la cabeza descarga en el pilar; JAMAS lleva apoyo de malla
      // (robaria la reaccion que debe bajar por el pilar).
      expect(apoyosDeMalla.has(nombreCabeza!)).toBe(false);
    }
  });

  it("7) determinismo: reordenar pilares/paños/nudos de entrada produce la MISMA Capa 2 y trazabilidad", () => {
    const a = ok(discretizar(crujia(INTERIORES)));
    const m = crujia(INTERIORES);
    m.pilares.reverse();
    m.vigas.reverse();
    m.nudos.reverse();
    m.panos.reverse();
    m.cargas.reverse();
    const b = ok(discretizar(m));
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.trazabilidad)).toBe(JSON.stringify(a.trazabilidad));
  });
});

// ============================================================================
// 6) REGRESION: gemelo SIN pilares interiores. Misma crujia (4 vigas + 4 pilares
//    de esquina, misma losa), pero sin los pilares INTERIORES. La UNICA diferencia
//    esperada es que las celdas (2,1) y (4,3) dejan de ser N* estructurales (pasan
//    a ser nudos de malla PQ*): anadir el pilar interior es el unico delta.
// ============================================================================
describe("golden A · regresion: anadir el pilar interior es la UNICA diferencia (corte 1/2 intacto)", () => {
  it("gemelo sin interiores: esas celdas son PQ* (malla), NO N*; con interiores son N* estructurales", () => {
    const rc = ok(discretizar(crujia(INTERIORES)));
    const rs = ok(discretizar(crujia([])));

    for (const [px, py] of INTERIORES) {
      const coord = coordFEMCabeza(px, py, COTA_LOSA);
      // CON pilar interior: la celda es un N* estructural (cabeza de pilar remapeada).
      const nCon = nombreEn(rc.modeloFEM, coord);
      expect(nCon).toBeDefined();
      expect(/^N\d+$/.test(nCon!)).toBe(true);

      // SIN pilar interior: la malla uniforme puede poner un nudo en esa celda entera,
      // pero NUNCA es un N* estructural (no hay pilar): es un PQ* de malla.
      const nSin = nombreEn(rs.modeloFEM, coord);
      if (nSin !== undefined) {
        expect(/^N\d+$/.test(nSin)).toBe(false);
        expect(nSin.startsWith("PQ")).toBe(true);
        expect(rs.trazabilidad.nodosDeMalla).toContain(nSin);
      }
    }
  });

  it("gemelo sin interiores: ningun quad toca un N* en las celdas interiores (no hay acople de cabeza)", () => {
    const rs = ok(discretizar(crujia([])));
    const nudosQuads = nudosDeQuadsDe(rs, "f1");
    for (const [px, py] of INTERIORES) {
      const nombre = nombreEn(rs.modeloFEM, coordFEMCabeza(px, py, COTA_LOSA));
      if (nombre !== undefined && nudosQuads.has(nombre)) {
        // Sin pilar interior, el nudo de esa celda referenciado por un quad es PQ*.
        expect(nombre.startsWith("PQ")).toBe(true);
      }
    }
  });

  it("el gemelo sin interiores es determinista (estable al reordenar, sin depender del acople de cabeza)", () => {
    const a = ok(discretizar(crujia([])));
    const m = crujia([]);
    m.nudos.reverse();
    m.pilares.reverse();
    m.vigas.reverse();
    const b = ok(discretizar(m));
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.trazabilidad)).toBe(JSON.stringify(a.trazabilidad));
  });
});

// ============================================================================
// [F2.3/T-f3-losa-plana] FORJADO PLANO PURO: losa de BORDES LIBRES sostenida SOLO
// por pilares interiores acoplados, SIN vigas de contorno (la tipologia estrella).
// F2.2 relajo PANO_PILAR_INTERIOR pero olvido PANO_SIN_APOYO: la losa "libre" sin
// borde completo abortaba aunque tuviera pilares. Aqui se blinda que:
//   (+) con >=3 pilares NO colineales -> discretizar ok:true, toda la sujecion viene
//       de los pilares (sin muleta de estabilizacion, sin apoyo de borde artificial).
//   (-) con 2 pilares colineales (2 puntos = 1 recta) -> ok:false: el plano bascula y
//       el motor devolveria basura silenciosa bajo sparse, asi que validaciones guarda.
// Node PURO (la FISICA -flecha, axil- es Capa B, motor real, T3.2).
// ============================================================================

// Losa 6x4 de BORDES LIBRES (sin vigas de contorno) sobre `interiores` pilares
// estrictamente interiores, todos de p0 (cota 0) a p1 (cota 3 = cota de la losa).
// A diferencia de crujia(): NO hay 4 vigas ni 4 pilares de esquina -> bordesCompletos=0.
function losaSoloPilares(interiores: Array<[number, number]>): Modelo {
  const pilares: Pilar[] = interiores.map(([x, y], k) => ({
    id: `pil${k + 1}`,
    nombre: `P${k + 1}`,
    x,
    y,
    plantaInicial: "p0",
    plantaFinal: "p1",
    seccionId: SECCION,
    materialId: MATERIAL,
    angulo: 0,
    vinculacionExterior: true, // su arranque sujeta la obra al terreno
    arranque: "empotrado",
  }));
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    // v4 (plantas sin grupos): SU/CM en la planta (0, como el grupo original -> Capa 2 igual).
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: SECCION, nombre: "Seccion 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 6, y: 0 },
      { id: "n3", x: 6, y: 4 },
      { id: "n4", x: 0, y: 4 },
    ],
    pilares,
    vigas: [],
    panos: [losa("f1")], // bordeApoyo "libre" (heredado de losa())
    muros: [],
    cargas: [{ id: "c1", tipo: "superficial", ambito: "f1", valor: 5, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// Tres pilares interiores NO colineales (triangulo): (2,1),(4,1),(3,3). Con tamMalla 1
// cada cabeza cae en un nudo de la rejilla 6x4 -> se remapea al N* de su pilar.
const TRES_NO_COLINEALES: Array<[number, number]> = [
  [2, 1],
  [4, 1],
  [3, 3],
];
// Dos pilares (siempre colineales): (2,2),(4,2). Bordes libres -> el plano bascula.
const DOS_COLINEALES: Array<[number, number]> = [
  [2, 2],
  [4, 2],
];

describe("golden A · forjado plano de bordes libres SOLO sobre pilares [F2.3]", () => {
  it("(+) losa libre sobre >=3 pilares NO colineales -> discretizar ok:true", () => {
    const res = discretizar(losaSoloPilares(TRES_NO_COLINEALES));
    if (!res.ok) {
      throw new Error(
        `deberia ser ok (>=3 no colineales); errores: ${JSON.stringify(res.errores)}`,
      );
    }
    expect(res.ok).toBe(true);
  });

  it("(+) las 3 cabezas se remapean a N* (comparten nudo con el pilar), sin muleta ni apoyo de borde", () => {
    const res = ok(discretizar(losaSoloPilares(TRES_NO_COLINEALES)));
    const fem = res.modeloFEM;
    const nudosQuads = nudosDeQuadsDe(res, "f1");

    for (const [px, py] of TRES_NO_COLINEALES) {
      const coord = coordFEMCabeza(px, py, COTA_LOSA);
      const nombreCabeza = nombreEn(fem, coord);
      // (a) La cabeza es un N* estructural (no un PQ* de malla): comparte nudo con el pilar.
      expect(nombreCabeza).toBeDefined();
      expect(/^N\d+$/.test(nombreCabeza!)).toBe(true);
      expect(res.trazabilidad.nodosDeMalla).not.toContain(nombreCabeza);
      // (b) Un quad de la losa lo referencia: la cabeza esta en la huella y se remapeo.
      expect(nudosQuads.has(nombreCabeza!)).toBe(true);
      // (c) NO recibe apoyo de borde artificial: descarga en el pilar via N*.
      expect(res.trazabilidad.apoyosDeMalla).not.toContain(nombreCabeza);
    }

    // Sin muleta: acople activo (>=2 nudos acoplados) -> ninguna estabilizacion DX/DZ de
    // malla. Y sin vigas ni bordeApoyo, NINGUN apoyo de malla: toda la sujecion es de pilar.
    for (const s of fem.supports.filter((x) => x.node.startsWith("PQ"))) {
      expect(s.DX).toBe(false);
      expect(s.DZ).toBe(false);
    }
    expect(res.trazabilidad.apoyosDeMalla).toEqual([]);
    // Los unicos apoyos son los arranques de pilar (pies, cota 0).
    const porNombre = new Map(fem.nodes.map((n) => [n.name, n]));
    for (const s of fem.supports) {
      expect(porNombre.get(s.node)!.y).toBe(0);
    }
  });

  it("(-) losa libre sobre 2 pilares COLINEALES -> discretizar ok:false (no calcula basura)", () => {
    const res = discretizar(losaSoloPilares(DOS_COLINEALES));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("no deberia ser ok: 2 pilares alineados bascularian");
    // El bloqueo es de SUJECION del paño (mensaje de obra), no de referencia/geometria.
    const cods = res.errores.map((e) => e.codigo);
    expect(cods).toContain("PANO_PILARES_INSUFICIENTES");
  });
});
