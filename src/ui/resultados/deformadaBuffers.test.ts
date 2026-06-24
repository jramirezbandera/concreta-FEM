// Tests de deformadaBuffers (feature-14, eng-review D2 + Fase 2): la derivacion PURA de
// base/delta/color que antes vivia inline en DeformadaOverlay y no tenia red. Cubre
// la matematica que decide el color (normalizacion de rampa, rango 0), el delta de
// animacion, la POLILINEA flectada (n puntos -> 2*(n-1) vertices al expandir a pares
// para lineSegments) y la ruta de "resultados obsoletos" (vigente=false). Sin R3F.
import { describe, it, expect } from "vitest";
import { construirBuffers, COLOR_OBSOLETO } from "./deformadaBuffers";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";

// ModeloFEM minimo: una barra M1 entre dos nodos. Solo importan name/x/y/z e i/j;
// el resto del contrato se rellena vacio (construirBuffers no lo lee).
function modeloUnaBarra(): ModeloFEM {
  return {
    units: "kN-m",
    nodes: [
      { name: "N1", x: 0, y: 0, z: 0 },
      { name: "N2", x: 4, y: 0, z: 0 },
    ],
    materials: [],
    sections: [],
    members: [
      {
        name: "M1",
        i: "N1",
        j: "N2",
        material: "m",
        section: "s",
        rotation: 0,
        tension_only: false,
        comp_only: false,
        releases: null,
      },
    ],
    supports: [],
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [{ name: "ELU", factors: {} }],
    analysis: { type: "linear", check_statics: false },
  };
}

// Diagrama (2,n) de relleno: posiciones x uniformes, valores 0. Solo importa la FORMA.
function diagramaRelleno(n: number): number[][] {
  const xs = Array.from({ length: n }, (_, k) => k / (n - 1));
  return [xs, Array.from({ length: n }, () => 0)];
}

// Resultados con desplazamiento conocido en N2 (DX) y nulo en N1, para un combo
// (ruta de FALLBACK: sin deformada_global, la barra se dibuja con disp de los nudos).
function resultadosCon(dispN2: [number, number, number]): ResultadosCalculo {
  const cero = [0, 0, 0, 0, 0, 0];
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {
      N1: { ELU: { disp: cero, rxn: cero } },
      N2: { ELU: { disp: [...dispN2, 0, 0, 0], rxn: cero } },
    },
    barras: {},
    check_statics: null,
  };
}

// Resultados con deformada_global de n estaciones para M1 (ruta principal Fase 2).
function resultadosConDeformada(
  def: [number[], number[], number[]],
): ResultadosCalculo {
  const n = def[0].length;
  const cero = [0, 0, 0, 0, 0, 0];
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: n },
    combos: ["ELU"],
    nodos: { N1: { ELU: { disp: cero, rxn: cero } }, N2: { ELU: { disp: cero, rxn: cero } } },
    barras: {
      M1: {
        ELU: {
          axial: diagramaRelleno(n),
          shear_y: diagramaRelleno(n),
          moment_z: diagramaRelleno(n),
          defl_y: diagramaRelleno(n),
          deformada_global: def,
          max_moment_z: 0,
          min_moment_z: 0,
          max_shear_y: 0,
        },
      },
    },
    check_statics: null,
  };
}

describe("construirBuffers · bordes", () => {
  it("devuelve null si no hay geometria (modeloFEM/resultados/combo null)", () => {
    expect(
      construirBuffers({ modeloFEM: null, resultados: null, combo: null, vigente: true }),
    ).toBeNull();
  });
});

describe("construirBuffers · base y delta (fallback, barra recta de 2 nudos)", () => {
  it("base = posicion del nodo en escena; delta = desplazamiento (escala 1) en escena", () => {
    // N2 con DX=0.02 (eje X global FEM). Escena Z-up: [FEM.x, FEM.z, FEM.y].
    const buffers = construirBuffers({
      modeloFEM: modeloUnaBarra(),
      resultados: resultadosCon([0.02, 0, 0]),
      combo: "ELU",
      vigente: true,
    });
    expect(buffers).not.toBeNull();
    const { base, delta, color, vertices } = buffers!;
    expect(vertices).toBe(2); // polilinea de 2 puntos = 1 segmento = 2 vertices
    // Longitudes coherentes con el contrato (3 floats por vertice).
    expect(base.length).toBe(vertices * 3);
    expect(delta.length).toBe(vertices * 3);
    expect(color.length).toBe(vertices * 3);

    // Vertice A = N1 en el origen, sin desplazamiento.
    expect([base[0], base[1], base[2]]).toEqual([0, 0, 0]);
    expect([delta[0], delta[1], delta[2]]).toEqual([0, 0, 0]);
    // Vertice B = N2 en escena [x=4, z=0, y=0] = [4,0,0]; delta = [DX,DZ,DY]=[0.02,0,0].
    expect([base[3], base[4], base[5]]).toEqual([4, 0, 0]);
    expect(delta[3]).toBeCloseTo(0.02, 6);
    expect(delta[4]).toBeCloseTo(0, 6);
    expect(delta[5]).toBeCloseTo(0, 6);
  });
});

describe("construirBuffers · polilinea flectada (Fase 2)", () => {
  it("una barra de n puntos da vertices = 2*(n-1) (pares para lineSegments)", () => {
    const n = 5;
    const def: [number[], number[], number[]] = [
      [0, 0, 0, 0, 0],
      [0, -0.01, -0.02, -0.01, 0],
      [0, 0, 0, 0, 0],
    ];
    const buffers = construirBuffers({
      modeloFEM: modeloUnaBarra(),
      resultados: resultadosConDeformada(def),
      combo: "ELU",
      vigente: true,
    })!;
    expect(buffers.vertices).toBe(2 * (n - 1)); // 8
    expect(buffers.base.length).toBe(buffers.vertices * 3);
    expect(buffers.delta.length).toBe(buffers.vertices * 3);
    expect(buffers.color.length).toBe(buffers.vertices * 3);
  });

  it("el color varia a lo largo del vano (gradiente, no monocromo)", () => {
    // Magnitud creciente del centro hacia un extremo -> distintos puntos de la rampa.
    const def: [number[], number[], number[]] = [
      [0, 0, 0, 0, 0],
      [0, -0.005, -0.01, -0.02, -0.03],
      [0, 0, 0, 0, 0],
    ];
    const buffers = construirBuffers({
      modeloFEM: modeloUnaBarra(),
      resultados: resultadosConDeformada(def),
      combo: "ELU",
      vigente: true,
    })!;
    const { color, vertices } = buffers;
    // Primer vertice (mag 0) vs ultimo vertice (mag maxima): colores distintos.
    const primero = [color[0], color[1], color[2]];
    const o = (vertices - 1) * 3;
    const ultimo = [color[o], color[o + 1], color[o + 2]];
    expect(primero).not.toEqual(ultimo);
  });
});

describe("construirBuffers · color", () => {
  it("vigente=true colorea con la rampa (extremos distintos cuando hay rango)", () => {
    const buffers = construirBuffers({
      modeloFEM: modeloUnaBarra(),
      resultados: resultadosCon([0.02, 0, 0]), // N1 mag 0, N2 mag 0.02 -> rango>0
      combo: "ELU",
      vigente: true,
    })!;
    const { color } = buffers;
    const colA = [color[0], color[1], color[2]];
    const colB = [color[3], color[4], color[5]];
    // Con rango>0 los extremos caen en puntos distintos de la rampa: colores distintos.
    expect(colA).not.toEqual(colB);
    // No es el gris de obsoleto.
    expect(colA).not.toEqual([COLOR_OBSOLETO.r, COLOR_OBSOLETO.g, COLOR_OBSOLETO.b]);
  });

  it("vigente=false pinta TODOS los vertices con el gris de obsoleto", () => {
    const def: [number[], number[], number[]] = [
      [0, 0, 0],
      [0, -0.02, 0],
      [0, 0, 0],
    ];
    const buffers = construirBuffers({
      modeloFEM: modeloUnaBarra(),
      resultados: resultadosConDeformada(def),
      combo: "ELU",
      vigente: false,
    })!;
    const { color, vertices } = buffers;
    // Float32Array vs componentes float64 de Color: comparamos con tolerancia.
    const gris = [COLOR_OBSOLETO.r, COLOR_OBSOLETO.g, COLOR_OBSOLETO.b];
    for (let v = 0; v < vertices; v++) {
      for (let k = 0; k < 3; k++) {
        expect(color[v * 3 + k]).toBeCloseTo(gris[k]!, 5);
      }
    }
  });

  it("rango 0 (desplazamiento uniforme) no divide por cero: color estable", () => {
    // Ambos nodos con el mismo desplazamiento -> magA==magB -> rango 0.
    const r = resultadosCon([0.01, 0, 0]);
    r.nodos.N1 = { ELU: { disp: [0.01, 0, 0, 0, 0, 0], rxn: [0, 0, 0, 0, 0, 0] } };
    const buffers = construirBuffers({
      modeloFEM: modeloUnaBarra(),
      resultados: r,
      combo: "ELU",
      vigente: true,
    })!;
    const { color } = buffers;
    // Todos los componentes son numeros finitos (no NaN por 0/0).
    for (const c of color) expect(Number.isFinite(c)).toBe(true);
  });
});
