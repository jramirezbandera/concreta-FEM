// Tests de isovaloresBuffers (F3): la derivacion PURA de la malla coloreada de la losa
// (posiciones FEM->escena, indices de triangulos, color por vertice, promediado de Mx/My
// a nudos). Sin R3F. Espejo de deformadaBuffers.test.ts. Cubre: bordes (null sin malla),
// flecha nodal (DY), promediado Mx/My (2 quads que comparten arista), gotcha de ejes
// (FEM Y-up -> escena Z-up) e indices de triangulos (2 por quad).
import { describe, it, expect } from "vitest";
import { construirBuffersIsovalores } from "./isovaloresBuffers";
import { COLOR_OBSOLETO } from "./deformadaBuffers";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import { trazabilidadVacia } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

// --- Fixtures ----------------------------------------------------------------

// Modelo de UN quad (losa 1x1 en el plano de la planta, a cota z). Nudos en FEM: la planta
// (x,y) va a (X, Z=cota, ... ) via mapearEjes; aqui ponemos las coords FEM directas (lo que
// el discretizador escribe): X=planta.x, Y=cota, Z=planta.y. Para una losa en cota 3:
//   i=(0,3,0) j=(1,3,0) m=(1,3,1) n=(0,3,1)  (Y=cota constante; X,Z = planta)
function modeloUnQuad(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "Q0", x: 0, y: 3, z: 0 },
      { name: "Q1", x: 1, y: 3, z: 0 },
      { name: "Q2", x: 1, y: 3, z: 1 },
      { name: "Q3", x: 0, y: 3, z: 1 },
    ],
    materials: [],
    sections: [],
    members: [],
    quads: [{ name: "PQ0", i: "Q0", j: "Q1", m: "Q2", n: "Q3", t: 0.2, material: "h" }],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    quad_loads: [],
    combos: [{ name: "ELS", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

function trazaUnQuad(): Trazabilidad {
  return {
    ...trazabilidadVacia(),
    panoAQuads: { pano1: ["PQ0"] },
    quadAPano: { PQ0: "pano1" },
    quadANodos: { PQ0: ["Q0", "Q1", "Q2", "Q3"] },
    nodosDeMalla: ["Q0", "Q1", "Q2", "Q3"],
    apoyosDeMalla: [],
  };
}

const cero6 = [0, 0, 0, 0, 0, 0];

// Resultados de placa con DY nodal y momentos de esquina dados por quad.
function resultadosUnQuad(opts: {
  dy: Record<string, number>;
  moments: [number, number, number][]; // 4 esquinas [Mx,My,Mxy]
}): ResultadosCalculo {
  const nodos: ResultadosCalculo["nodos"] = {};
  for (const [nombre, dy] of Object.entries(opts.dy)) {
    nodos[nombre] = { ELS: { disp: [0, dy, 0, 0, 0, 0], rxn: cero6 } };
  }
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELS"],
    nodos,
    barras: {},
    quads: {
      PQ0: {
        ELS: {
          moments: opts.moments,
          shears: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        },
      },
    },
    check_statics: null,
  };
}

// --- Bordes ------------------------------------------------------------------

describe("construirBuffersIsovalores · bordes", () => {
  it("null sin malla/resultados/combo", () => {
    expect(
      construirBuffersIsovalores({
        modeloFEM: null,
        trazabilidad: null,
        resultados: null,
        combo: null,
        magnitud: "flecha",
      }),
    ).toBeNull();
  });

  it("null si el modelo no tiene quads (un portico sin losa)", () => {
    const m = modeloUnQuad();
    m.quads = [];
    expect(
      construirBuffersIsovalores({
        modeloFEM: m,
        trazabilidad: trazaUnQuad(),
        resultados: resultadosUnQuad({
          dy: { Q0: 0, Q1: 0, Q2: 0, Q3: 0 },
          moments: [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        }),
        combo: "ELS",
        magnitud: "flecha",
      }),
    ).toBeNull();
  });
});

// --- Flecha (DY nodal) -------------------------------------------------------

describe("construirBuffersIsovalores · flecha", () => {
  it("toma |DY| nodal (magnitud, D10) y mapea ejes FEM->escena (Y<->Z)", () => {
    const buffers = construirBuffersIsovalores({
      modeloFEM: modeloUnQuad(),
      trazabilidad: trazaUnQuad(),
      resultados: resultadosUnQuad({
        dy: { Q0: 0, Q1: -0.01, Q2: -0.02, Q3: -0.01 },
        moments: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
      combo: "ELS",
      magnitud: "flecha",
    })!;
    expect(buffers).not.toBeNull();
    expect(buffers.vertices).toBe(4); // 4 nudos de malla
    // 1 quad -> 2 triangulos -> 6 indices.
    expect(buffers.indices.length).toBe(6);
    // [D10] Rango del valor = [min |DY|, max |DY|] = [0, 0.02]: rojo = maximo movimiento
    // (antes con signo era [-0.02, 0] y el rojo caia en la ausencia de flecha).
    expect(buffers.valorMin).toBeCloseTo(0, 6);
    expect(buffers.valorMax).toBeCloseTo(0.02, 6);
    // Gotcha de ejes: Q0 FEM (x=0,y=3,z=0) -> escena femAEscena = [x, z, y] = [0,0,3].
    // El primer vertice corresponde al primer nudo con valor (orden de insercion = Q0..Q3).
    expect([buffers.posiciones[0], buffers.posiciones[1], buffers.posiciones[2]]).toEqual([
      0, 0, 3,
    ]);
  });

  it("[D10] el valor de flecha es SIEMPRE >= 0 (magnitud), tambien con DY positivo", () => {
    // Mezcla de flechas hacia abajo (negativas) y una hacia arriba (positiva): todas se
    // toman en valor absoluto, asi que el rango es [0, max|DY|].
    const buffers = construirBuffersIsovalores({
      modeloFEM: modeloUnQuad(),
      trazabilidad: trazaUnQuad(),
      resultados: resultadosUnQuad({
        dy: { Q0: 0.03, Q1: -0.01, Q2: -0.05, Q3: 0.02 },
        moments: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
      combo: "ELS",
      magnitud: "flecha",
    })!;
    for (const v of buffers.valores) expect(v).toBeGreaterThanOrEqual(0);
    expect(buffers.valorMin).toBeCloseTo(0.01, 6); // min |DY| = |−0.01|
    expect(buffers.valorMax).toBeCloseTo(0.05, 6); // max |DY| = |−0.05|
  });

  it("vigente=false pinta TODOS los vertices con el gris de obsoleto (UX-H4)", () => {
    const buffers = construirBuffersIsovalores({
      modeloFEM: modeloUnQuad(),
      trazabilidad: trazaUnQuad(),
      resultados: resultadosUnQuad({
        dy: { Q0: 0, Q1: -0.01, Q2: -0.02, Q3: -0.01 },
        moments: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
      combo: "ELS",
      magnitud: "flecha",
      vigente: false,
    })!;
    const gris = [COLOR_OBSOLETO.r, COLOR_OBSOLETO.g, COLOR_OBSOLETO.b];
    for (let v = 0; v < buffers.vertices; v++) {
      for (let k = 0; k < 3; k++) {
        expect(buffers.color[v * 3 + k]).toBeCloseTo(gris[k]!, 5);
      }
    }
    // El rango/valores NO se agrisan: la leyenda los sigue usando. [D10] flecha = |DY| ->
    // rango [0, 0.02] (antes con signo era [-0.02, 0]).
    expect(buffers.valorMin).toBeCloseTo(0, 6);
    expect(buffers.valorMax).toBeCloseTo(0.02, 6);
  });
});

// --- Mx/My promediado a nudos (2 quads comparten arista) ---------------------

describe("construirBuffersIsovalores · promediado de Mx/My a nudos", () => {
  // Dos quads en fila que COMPARTEN la arista Q1-Q2: PQ0=[Q0,Q1,Q2,Q3], PQ1=[Q1,Q4,Q5,Q2].
  // Los nudos compartidos (Q1, Q2) reciben la MEDIA de las esquinas de ambos quads.
  function modeloDosQuads(): ModeloFEM {
    const base = modeloUnQuad();
    return {
      ...base,
      nodes: [
        { name: "Q0", x: 0, y: 3, z: 0 },
        { name: "Q1", x: 1, y: 3, z: 0 },
        { name: "Q2", x: 1, y: 3, z: 1 },
        { name: "Q3", x: 0, y: 3, z: 1 },
        { name: "Q4", x: 2, y: 3, z: 0 },
        { name: "Q5", x: 2, y: 3, z: 1 },
      ],
      quads: [
        { name: "PQ0", i: "Q0", j: "Q1", m: "Q2", n: "Q3", t: 0.2, material: "h" },
        { name: "PQ1", i: "Q1", j: "Q4", m: "Q5", n: "Q2", t: 0.2, material: "h" },
      ],
    };
  }
  function trazaDosQuads(): Trazabilidad {
    return {
      ...trazabilidadVacia(),
      panoAQuads: { pano1: ["PQ0", "PQ1"] },
      quadAPano: { PQ0: "pano1", PQ1: "pano1" },
      quadANodos: {
        PQ0: ["Q0", "Q1", "Q2", "Q3"],
        PQ1: ["Q1", "Q4", "Q5", "Q2"],
      },
      nodosDeMalla: ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5"],
      apoyosDeMalla: [],
    };
  }
  // PQ0: Mx en esquinas i,j,m,n = 10,20,20,10 (Q1 esquina j=20, Q2 esquina m=20).
  // PQ1: Mx en esquinas i,j,m,n = 30,40,40,30 (Q1 esquina i=30, Q2 esquina n=30).
  // => Q1 recibe media(20,30)=25 ; Q2 media(20,30)=25.
  function resultadosDosQuads(): ResultadosCalculo {
    const nodos: ResultadosCalculo["nodos"] = {};
    for (const n of ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5"]) {
      nodos[n] = { ELS: { disp: cero6, rxn: cero6 } };
    }
    const mx = (v: number): [number, number, number] => [v, 0, 0];
    return {
      units: "kN-m",
      analysis: { type: "linear", n_points: 2 },
      combos: ["ELS"],
      nodos,
      barras: {},
      quads: {
        PQ0: {
          ELS: {
            moments: [mx(10), mx(20), mx(20), mx(10)],
            shears: [[0, 0], [0, 0], [0, 0], [0, 0]],
          },
        },
        PQ1: {
          ELS: {
            moments: [mx(30), mx(40), mx(40), mx(30)],
            shears: [[0, 0], [0, 0], [0, 0], [0, 0]],
          },
        },
      },
      check_statics: null,
    };
  }

  it("Mx en un nudo compartido es la MEDIA de las esquinas de los quads que lo tocan", () => {
    const buffers = construirBuffersIsovalores({
      modeloFEM: modeloDosQuads(),
      trazabilidad: trazaDosQuads(),
      resultados: resultadosDosQuads(),
      combo: "ELS",
      magnitud: "momentoX",
    })!;
    expect(buffers.vertices).toBe(6); // 6 nudos de malla
    // 2 quads -> 4 triangulos -> 12 indices.
    expect(buffers.indices.length).toBe(12);
    // El rango incluye los nudos esquina (10 y 40) y los compartidos (25).
    expect(buffers.valorMin).toBeCloseTo(10, 6);
    expect(buffers.valorMax).toBeCloseTo(40, 6);
    // El valor maximo (40) y minimo (10) existen entre los `valores`; los compartidos (25)
    // tambien. Verificamos que 25 aparece (promediado real, no un valor de esquina suelto).
    const valores = Array.from(buffers.valores);
    expect(valores.some((v) => Math.abs(v - 25) < 1e-6)).toBe(true);
  });

  it("My usa la componente 1 de moments (no Mx)", () => {
    // Mismos quads pero con My distinto de Mx: si leyera Mx, el rango seria el de Mx.
    const r = resultadosDosQuads();
    // Sobrescribe My (componente 1) con valores grandes; Mx (componente 0) queda como antes.
    const setMy = (q: "PQ0" | "PQ1", vals: number[]) => {
      r.quads![q]!.ELS!.moments = vals.map((v, k) => [
        r.quads![q]!.ELS!.moments[k]![0]!,
        v,
        0,
      ]);
    };
    setMy("PQ0", [100, 200, 200, 100]);
    setMy("PQ1", [300, 400, 400, 300]);
    const buffers = construirBuffersIsovalores({
      modeloFEM: modeloDosQuads(),
      trazabilidad: trazaDosQuads(),
      resultados: r,
      combo: "ELS",
      magnitud: "momentoY",
    })!;
    expect(buffers.valorMin).toBeCloseTo(100, 6);
    expect(buffers.valorMax).toBeCloseTo(400, 6);
  });
});

// --- F3.2: losa ACOPLADA (nudos de borde estructurales N*) ---------------------
// Con el acople paño<->portico los nudos de BORDE remapean a N* y ya NO figuran en
// trazabilidad.nodosDeMalla. La rama "flecha" debe iterar la UNION de nudos de
// quadANodos (los vertices reales de la malla), no nodosDeMalla: si no, el anillo
// de borde queda sin valor y sus quads se omiten (AGUJEROS en el mapa).
describe("construirBuffersIsovalores · losa acoplada (F3.2, sin agujeros de borde)", () => {
  it("pinta el quad aunque sus nudos de borde sean estructurales (fuera de nodosDeMalla)", () => {
    const m = modeloUnQuad();
    // El quad referencia dos nudos ESTRUCTURALES (N5, N6: borde acoplado a una viga)
    // y dos de malla (Q2, Q3: interiores).
    m.nodes = [
      { name: "N5", x: 0, y: 3, z: 0 },
      { name: "N6", x: 1, y: 3, z: 0 },
      { name: "Q2", x: 1, y: 3, z: 1 },
      { name: "Q3", x: 0, y: 3, z: 1 },
    ];
    m.quads = [{ name: "PQ0", i: "N5", j: "N6", m: "Q2", n: "Q3", t: 0.2, material: "h" }];
    const traza: Trazabilidad = {
      ...trazabilidadVacia(),
      panoAQuads: { pano1: ["PQ0"] },
      quadAPano: { PQ0: "pano1" },
      quadANodos: { PQ0: ["N5", "N6", "Q2", "Q3"] },
      nodosDeMalla: ["Q2", "Q3"], // los N* acoplados NO estan aqui (son del portico)
      apoyosDeMalla: [],
    };
    const r = resultadosUnQuad({
      dy: { N5: -0.001, N6: -0.001, Q2: -0.004, Q3: -0.004 },
      moments: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
    const buffers = construirBuffersIsovalores({
      modeloFEM: m,
      trazabilidad: traza,
      resultados: r,
      combo: "ELS",
      magnitud: "flecha",
    });
    // Sin el fix: N5/N6 sin valor -> quad omitido -> null (agujero). Con el fix: los
    // 4 vertices se pintan y el quad emite sus 2 triangulos.
    expect(buffers).not.toBeNull();
    expect(buffers!.vertices).toBe(4);
    expect(buffers!.indices).toHaveLength(6);
    expect(buffers!.valorMin).toBeCloseTo(0.001, 9);
    expect(buffers!.valorMax).toBeCloseTo(0.004, 9);
  });
});
