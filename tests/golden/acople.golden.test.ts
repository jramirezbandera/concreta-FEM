// GOLDEN Capa A del ACOPLE paño<->portico (F3.2, Fase 4). Node PURO, sin motor:
// asevera la ESTRUCTURA de la Capa 2 que emite discretizar() para una losa acoplada
// (subdivision de vigas, remap de nudos de borde a N*, apoyos, estabilizacion,
// trazabilidad) y sus invariantes de regresion (paño flotante = corte 1; modelos
// reordenados = deep-equal). La FISICA (Navier, equilibrio, reparto) se asevera en
// la Capa B con el motor real (placa-acoplada.golden.test.ts, Fase 6).
import { describe, it, expect } from "vitest";
import { discretizar } from "../../src/discretizador";
import type { ResultadoDiscretizacion } from "../../src/discretizador";
import type { Modelo, Pano } from "../../src/dominio";
import { SCHEMA_VERSION } from "../../src/dominio";

const MATERIAL_BARRA = "HA-25";
const MATERIAL_LOSA = "HA-25";
const SECCION = "sec-viga";

// Crujia canonica 4x3 m: 4 pilares en esquinas (p0->p1, empotrados, vinculados),
// 4 vigas de contorno en p1 y una losa 4x3 entre ellas. tamMalla 1 -> rejilla 4x3
// (20 nudos: 14 de borde + 6 interiores; 12 quads).
function crujia(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      { id: "g1", nombre: "Grupo 1", categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" },
    ],
    secciones: [
      { id: SECCION, nombre: "Viga 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 4, y: 0 },
      { id: "n3", x: 4, y: 3 },
      { id: "n4", x: 0, y: 3 },
    ],
    pilares: ["n1|0|0", "n2|4|0", "n3|4|3", "n4|0|3"].map((spec, k) => {
      const [, x, y] = spec.split("|");
      return {
        id: `pil${k + 1}`, nombre: `P${k + 1}`, x: Number(x), y: Number(y),
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado" as const,
      };
    }),
    vigas: [
      ["v1", "n1", "n2"],
      ["v2", "n2", "n3"],
      ["v3", "n3", "n4"],
      ["v4", "n4", "n1"],
    ].map(([id, ni, nj]) => ({
      id, nombre: id.toUpperCase(), plantaId: "p1", nudoI: ni, nudoJ: nj,
      seccionId: SECCION, materialId: MATERIAL_BARRA,
      extremoI: "empotrado" as const, extremoJ: "empotrado" as const, tirante: false,
    })),
    panos: [pano("f1")],
    muros: [],
    cargas: [{ id: "c1", tipo: "superficial", ambito: "f1", valor: 5, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// Losa 4x3 con bordeApoyo LIBRE: ejercita la relajacion de PANO_SIN_APOYO [OV-2]
// (con las 4 vigas debajo hay bordes completos; sin ellas debe BLOQUEAR).
function pano(id: string, extra?: Partial<Pano>): Pano {
  return {
    id, nombre: id.toUpperCase(), tipo: "losa", plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    espesor: 0.2, materialId: MATERIAL_LOSA, tamMalla: 1, bordeApoyo: "libre",
    ...extra,
  };
}

function ok(res: ResultadoDiscretizacion) {
  if (!res.ok) {
    throw new Error(`discretizar fallo: ${JSON.stringify(res.errores, null, 2)}`);
  }
  return res;
}

describe("golden A · losa acoplada a la crujia (4 vigas + 4 pilares)", () => {
  it("subdivide las vigas de contorno en los nudos de la malla (union por nudo compartido)", () => {
    const res = ok(discretizar(crujia()));
    const t = res.trazabilidad;
    // Vigas horizontales (4 m, malla 1): 3 interiores -> 4 tramos. Verticales (3 m):
    // 2 interiores -> 3 tramos. Total members: 4 pilares + 4+3+4+3 = 18.
    expect(t.vigaAMembers["v1"]).toHaveLength(4);
    expect(t.vigaAMembers["v2"]).toHaveLength(3);
    expect(t.vigaAMembers["v3"]).toHaveLength(4);
    expect(t.vigaAMembers["v4"]).toHaveLength(3);
    expect(res.modeloFEM.members).toHaveLength(18);
    // Los tramos de cada viga ENCADENAN (j del tramo k = i del k+1): sin huecos.
    const porNombre = new Map(res.modeloFEM.members.map((m) => [m.name, m]));
    for (const vigaId of ["v1", "v2", "v3", "v4"]) {
      const tramos = t.vigaAMembers[vigaId];
      for (let k = 0; k + 1 < tramos.length; k++) {
        expect(porNombre.get(tramos[k])!.j).toBe(porNombre.get(tramos[k + 1])!.i);
      }
    }
  });

  it("los quads del borde referencian nudos ESTRUCTURALES N*; solo los interiores son PQ*", () => {
    const res = ok(discretizar(crujia()));
    const t = res.trazabilidad;
    // 20 nudos de malla: 14 de borde (TODOS acoplados: contorno completo) remapean a
    // N*; los 6 interiores conservan su nombre propio.
    expect(t.nodosDeMalla).toHaveLength(6);
    for (const n of t.nodosDeMalla) expect(n.startsWith("PQ0-")).toBe(true);
    // Ningun quad referencia un PQ* de BORDE: todo nombre PQ* usado por los quads
    // esta en nodosDeMalla (interiores).
    const interiores = new Set(t.nodosDeMalla);
    const referenciados = new Set<string>();
    for (const nudos of Object.values(t.quadANodos)) {
      for (const n of nudos) referenciados.add(n);
    }
    for (const n of referenciados) {
      if (n.startsWith("PQ")) expect(interiores.has(n)).toBe(true);
      else expect(/^N\d+$/.test(n)).toBe(true); // estructural
    }
    // Y los 14 nudos estructurales del contorno de la losa estan referenciados.
    const estructurales = [...referenciados].filter((n) => !n.startsWith("PQ"));
    expect(estructurales).toHaveLength(14);
  });

  it("apoyos: SOLO los arranques de pilar (sin apoyos de malla ni estabilizacion)", () => {
    const res = ok(discretizar(crujia()));
    // 4 supports (pies de pilar, cota 0), ni uno mas: el borde acoplado descarga en
    // el portico y la estabilizacion DX/DZ se omite (el portico ya sujeta la losa).
    expect(res.modeloFEM.supports).toHaveLength(4);
    const porNombre = new Map(res.modeloFEM.nodes.map((n) => [n.name, n]));
    for (const s of res.modeloFEM.supports) {
      expect(porNombre.get(s.node)!.y).toBe(0); // todos en cimentacion
    }
    expect(res.trazabilidad.apoyosDeMalla).toEqual([]);
  });

  it("la carga superficial baja a los quads y la relajacion de PANO_SIN_APOYO permite bordeApoyo libre", () => {
    const res = ok(discretizar(crujia()));
    // 12 quads x 1 carga = 12 quad_loads (presion -(-5)=5... signo: valor>0 hacia
    // abajo -> presion POSITIVA +5 en la convencion del quad).
    expect(res.modeloFEM.quads).toHaveLength(12);
    expect(res.modeloFEM.quad_loads).toHaveLength(12);
    for (const ql of res.modeloFEM.quad_loads ?? []) {
      expect(ql.presion).toBe(5);
      expect(ql.case).toBe("h1");
    }
  });

  it("GAP-B: la carga LINEAL sobre una viga subdividida llega a TODOS sus tramos con la misma w", () => {
    const m = crujia();
    m.cargas.push({ id: "c2", tipo: "lineal", ambito: "v1", valor: 10, hipotesisId: "h1" });
    const res = ok(discretizar(m));
    const tramos = new Set(res.trazabilidad.vigaAMembers["v1"]);
    expect(tramos.size).toBe(4);
    const cargasV1 = res.modeloFEM.dist_loads.filter(
      (d) => tramos.has(d.member) && d.case === "h1",
    );
    // Un dist_load por tramo, todos con la MISMA w (la carga es del elemento entero:
    // PyNite integra w sobre la longitud de cada tramo -> total conservado).
    expect(cargasV1).toHaveLength(4);
    for (const d of cargasV1) {
      expect(d.w1).toBe(-10); // gravedad: FY negativa (signoGravitatorio)
      expect(d.w2).toBe(-10);
    }
  });

  it("determinismo: reordenar paños/vigas/pilares/nudos de entrada produce la MISMA Capa 2", () => {
    const a = ok(discretizar(crujia()));
    const m = crujia();
    m.vigas.reverse();
    m.pilares.reverse();
    m.nudos.reverse();
    const b = ok(discretizar(m));
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.trazabilidad)).toBe(JSON.stringify(a.trazabilidad));
  });
});

describe("golden A · GAP-A: dos paños compartiendo viga (crujias contiguas)", () => {
  // Crujia doble: paño A (0..4, 0..3) y paño B (0..4, -3..0) comparten la viga
  // v-comp en y=0. A con malla 1 (interiores x=1,2,3), B con malla 2 (interior x=2):
  // la viga compartida se subdivide en la UNION {1,2,3}.
  function crujiaDoble(): Modelo {
    const m = crujia();
    m.nudos.push({ id: "n5", x: 0, y: -3 }, { id: "n6", x: 4, y: -3 });
    // Renombrar la viga inferior como compartida y añadir el contorno del paño B.
    m.vigas = [
      ...m.vigas.filter((v) => v.id !== "v1"),
      { ...m.vigas.find((v) => v.id === "v1")!, id: "v-comp", nombre: "VC" },
      {
        id: "v-infB", nombre: "VB1", plantaId: "p1", nudoI: "n5", nudoJ: "n6",
        seccionId: SECCION, materialId: MATERIAL_BARRA,
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
      {
        id: "v-izqB", nombre: "VB2", plantaId: "p1", nudoI: "n1", nudoJ: "n5",
        seccionId: SECCION, materialId: MATERIAL_BARRA,
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
      {
        id: "v-derB", nombre: "VB3", plantaId: "p1", nudoI: "n2", nudoJ: "n6",
        seccionId: SECCION, materialId: MATERIAL_BARRA,
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
    ];
    m.pilares.push(
      {
        id: "pil5", nombre: "P5", x: 0, y: -3, plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil6", nombre: "P6", x: 4, y: -3, plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    );
    m.panos = [
      pano("fA"),
      pano("fB", { perimetro: ["n5", "n6", "n2", "n1"], tamMalla: 2 }),
    ];
    m.cargas = [{ id: "c1", tipo: "superficial", ambito: "fA", valor: 5, hipotesisId: "h1" }];
    return m;
  }

  it("la viga compartida se subdivide en la UNION de las mallas y AMBOS paños referencian los MISMOS N*", () => {
    const res = ok(discretizar(crujiaDoble()));
    const t = res.trazabilidad;
    // Union {1,2,3} de subdivisiones (malla 1 de fA aporta 1,2,3; malla 2 de fB
    // aporta 2, deduplicado) -> 4 tramos.
    expect(t.vigaAMembers["v-comp"]).toHaveLength(4);
    // Nudos referenciados por los quads de cada paño.
    const nudosDe = (panoId: string): Set<string> => {
      const s = new Set<string>();
      for (const q of t.panoAQuads[panoId]) {
        for (const n of t.quadANodos[q]) s.add(n);
      }
      return s;
    };
    const deA = nudosDe("fA");
    const deB = nudosDe("fB");
    // Los nudos COMPARTIDOS entre ambos paños son exactamente los estructurales de
    // la viga comun: N* (jamas un PQ*). fA (malla 1) toca los 5 (x=0..4); fB
    // (malla 2) toca 3 de ellos (x=0,2,4): la interseccion son esos 3.
    const compartidos = [...deA].filter((n) => deB.has(n));
    expect(compartidos).toHaveLength(3);
    for (const n of compartidos) expect(/^N\d+$/.test(n)).toBe(true);
  });

  it("cada paño conserva su prefijo PQ<indice> (fA=PQ0, fB=PQ1) para sus nudos interiores", () => {
    const res = ok(discretizar(crujiaDoble()));
    const t = res.trazabilidad;
    const prefijos = new Set(t.nodosDeMalla.map((n) => n.split("-")[0]));
    expect(prefijos).toEqual(new Set(["PQ0", "PQ1"]));
  });
});

describe("golden A · regresion: paño FLOTANTE (sin vigas debajo) = corte 1 intacto", () => {
  function crujiaFlotante(): Modelo {
    const m = crujia();
    // La losa se aleja del portico: nudos propios en x=10.. (ninguna viga debajo).
    m.nudos.push(
      { id: "m1", x: 10, y: 0 },
      { id: "m2", x: 14, y: 0 },
      { id: "m3", x: 14, y: 3 },
      { id: "m4", x: 10, y: 3 },
    );
    m.panos = [pano("f1", { perimetro: ["m1", "m2", "m3", "m4"], bordeApoyo: "simple" })];
    return m;
  }

  it("malla aislada: nudos PROPIOS, apoyos de borde + estabilizacion, sin subdividir vigas", () => {
    const res = ok(discretizar(crujiaFlotante()));
    const t = res.trazabilidad;
    // Ninguna viga subdividida (todas 1 tramo).
    for (const tramos of Object.values(t.vigaAMembers)) expect(tramos).toHaveLength(1);
    // Todos los nudos de la malla son propios (20 = 5x4) y hay apoyos de malla
    // (14 de borde con DY + las 2 esquinas de estabilizacion ya contadas ahi).
    expect(t.nodosDeMalla).toHaveLength(20);
    expect(t.apoyosDeMalla.length).toBeGreaterThan(0);
    // La estabilizacion DX existe en algun apoyo de malla (paño aislado).
    const apoyosMalla = res.modeloFEM.supports.filter((s) => s.node.startsWith("PQ"));
    expect(apoyosMalla.some((s) => s.DX)).toBe(true);
  });

  it("con bordeApoyo LIBRE y sin vigas debajo sigue BLOQUEANDO (PANO_SIN_APOYO, OV-2)", () => {
    const m = crujiaFlotante();
    m.panos = [{ ...m.panos[0], bordeApoyo: "libre" }];
    const res = discretizar(m);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errores.some((e) => e.codigo === "PANO_SIN_APOYO")).toBe(true);
    }
  });
});
