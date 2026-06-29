// Tests de modeloCalculoGeometria (PURA): proyeccion del ModeloFEM al overlay.
// Solo lee nodes/members/supports, asi que los fixtures son ModeloFEM parciales.
import { describe, it, expect } from "vitest";
import { modeloCalculoGeometria } from "./modeloCalculoGeometria";
import type { ModeloFEM } from "../../discretizador";

// Helper: arma un ModeloFEM parcial (solo lo que la geometria lee).
function fem(parts: {
  nodes?: { name: string; x: number; y: number; z: number }[];
  members?: {
    name: string;
    i: string;
    j: string;
    releases: boolean[] | null;
  }[];
  supports?: {
    node: string;
    DX: boolean;
    DY: boolean;
    DZ: boolean;
    RX: boolean;
    RY: boolean;
    RZ: boolean;
  }[];
}): ModeloFEM {
  return {
    nodes: parts.nodes ?? [],
    members: parts.members ?? [],
    supports: parts.supports ?? [],
  } as unknown as ModeloFEM;
}

const sup = (node: string, ...flags: boolean[]) => {
  const [DX, DY, DZ, RX, RY, RZ] = flags;
  return { node, DX, DY, DZ, RX, RY, RZ };
};

describe("modeloCalculoGeometria", () => {
  it("modeloFEM null -> todo vacio, sin lanzar", () => {
    const g = modeloCalculoGeometria(null);
    expect(g.barras).toEqual([]);
    expect(g.nudos).toEqual([]);
    expect(g.apoyos).toEqual([]);
    expect(g.releases).toEqual([]);
    expect(g.conteos).toEqual({ nudos: 0, barras: 0, apoyos: 0 });
  });

  it("proyecta nudos FEM (Y-up) a escena (Z-up): [x,y,z] -> [x,z,y]", () => {
    const g = modeloCalculoGeometria(fem({ nodes: [{ name: "N1", x: 1, y: 2, z: 3 }] }));
    expect(g.nudos).toEqual([[1, 3, 2]]);
    expect(g.conteos.nudos).toBe(1);
  });

  it("barra sin releases: conRelease false, sin marcas de release", () => {
    const g = modeloCalculoGeometria(
      fem({
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 1, y: 0, z: 0 },
        ],
        members: [{ name: "M1", i: "N1", j: "N2", releases: null }],
      }),
    );
    expect(g.barras).toHaveLength(1);
    expect(g.barras[0].conRelease).toBe(false);
    expect(g.releases).toEqual([]);
  });

  it("release en el extremo J: marca SOLO en J (no en I)", () => {
    // releases [Dxi..Rzi (0-5)=false, Dxj..Rzj (6-11): Rzj=true] -> liberado extremo J.
    const releases = [
      false, false, false, false, false, false,
      false, false, false, false, false, true,
    ];
    const g = modeloCalculoGeometria(
      fem({
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 4, y: 0, z: 0 }, // escena: [4,0,0]
        ],
        members: [{ name: "M1", i: "N1", j: "N2", releases }],
      }),
    );
    expect(g.barras[0].conRelease).toBe(true);
    expect(g.releases).toEqual([[4, 0, 0]]); // posicion de N2 en escena
  });

  it("clasifica apoyos por GDL: empotrado / articulado / otro", () => {
    const g = modeloCalculoGeometria(
      fem({
        nodes: [
          { name: "E", x: 0, y: 0, z: 0 },
          { name: "A", x: 1, y: 0, z: 0 },
          { name: "O", x: 2, y: 0, z: 0 },
        ],
        supports: [
          sup("E", true, true, true, true, true, true), // empotrado
          sup("A", true, true, true, false, false, false), // articulado
          sup("O", true, false, false, false, false, false), // rodillo -> otro
        ],
      }),
    );
    const tipos = Object.fromEntries(
      g.apoyos.map((a, i) => [["E", "A", "O"][i], a.tipo]),
    );
    expect(tipos).toEqual({ E: "empotrado", A: "articulado", O: "otro" });
    expect(g.conteos.apoyos).toBe(3);
  });

  it("omite barras/apoyos con referencias a nudos inexistentes", () => {
    const g = modeloCalculoGeometria(
      fem({
        nodes: [{ name: "N1", x: 0, y: 0, z: 0 }],
        members: [{ name: "M1", i: "N1", j: "NX", releases: null }],
        supports: [sup("NX", true, true, true, true, true, true)],
      }),
    );
    expect(g.barras).toEqual([]);
    expect(g.apoyos).toEqual([]);
  });
});
