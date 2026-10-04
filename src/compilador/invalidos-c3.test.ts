/**
 * Criterio 6 de C3: catálogo de entradas no válidas de los muros, sus huecos y los empujes. Cada una
 * es una mutación de un modelo válido y tiene que acabar en un error con su código y el id físico
 * del culpable, sin lanzar nunca.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Sótano con muro perimetral en y = 0 (con ventana y empuje), un núcleo con puerta y una losa en P1. */
function base(): ModeloFisico {
  const esquinas: Vec2[] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ];
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [
      { id: "HA", tipo: "hormigon", fck: 25 },
      { id: "S", tipo: "acero" },
      { id: "Gm", tipo: "general", E: 3e7, G: 1.25e7, peso: 25 },
    ],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.4 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
    ],
    pilares: esquinas.map(([x, y], i) => ({ id: `A${i}`, x, y, desde: "C", hasta: "P2", seccion: "p" })),
    vigas: esquinas.map((a, i) => ({ id: `V${i}`, planta: "P1", puntos: [a, esquinas[(i + 1) % 4]!], seccion: "v" })),
    losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 8, 6), espesor: 0.25, material: "HA" }],
    muros: [
      { id: "MS", puntos: [[0, 0], [8, 0]], desde: "C", hasta: "P1", espesor: 0.3, material: "HA", huecos: [{ desde: 3, hasta: 4.2, z0: 1, z1: 2 }] },
      { id: "NUC", puntos: [[2.0173, 2.0173], [4.0173, 2.0173], [4.0173, 4.0173], [2.0173, 4.0173], [2.0173, 2.0173]], desde: "C", hasta: "P2", espesor: 0.25, material: "HA", huecos: [{ desde: 0.4, hasta: 1.3, z0: 3, z1: 5.1 }] },
    ],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "T" }],
    cargas: [
      { tipo: "superficie", id: "s", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -2] },
      { tipo: "empuje", id: "E", caso: "T", muro: "MS", lado: "derecho", z0: 0, z1: 2.5, p0: 30, p1: 0 },
    ],
  };
}

type Caso = [nombre: string, mutar: (f: Record<string, unknown> & ModeloFisico) => void, codigo: string, id?: string];
const m = (o: unknown) => o as never;
const muro = (f: ModeloFisico, id = "MS") => f.muros!.find((w) => w.id === id) as unknown as Record<string, unknown>;
const carga = (f: ModeloFisico, id: string) => f.cargas!.find((c) => c.id === id) as unknown as Record<string, unknown>;

const CATALOGO: Caso[] = [
  // Esquema y referencias
  ["muros que no son una lista", (f) => (f.muros = m({})), "fisico/no-valido"],
  ["muro sin id", (f) => (muro(f).id = m(7)), "fisico/sin-id"],
  ["muro con el id de una losa", (f) => (muro(f).id = "L"), "fisico/id-duplicado", "L"],
  ["muro en una planta que no existe", (f) => (muro(f).desde = "X"), "fisico/referencia", "MS"],
  ["muro con la cabeza en una planta que no existe", (f) => (muro(f).hasta = "X"), "fisico/referencia", "MS"],
  ["muro con la base por encima de la cabeza", (f) => Object.assign(muro(f), { desde: "P1", hasta: "C" }), "fisico/valor-no-valido", "MS"],
  ["muro con la base y la cabeza en la misma planta", (f) => Object.assign(muro(f), { desde: "P1", hasta: "P1" }), "fisico/valor-no-valido", "MS"],
  ["muro con un material que no existe", (f) => (muro(f).material = "X"), "fisico/referencia", "MS"],
  ["muro de acero", (f) => (muro(f).material = "S"), "fisico/valor-no-valido", "MS"],
  ["muro sin espesor", (f) => (muro(f).espesor = 0), "fisico/valor-no-valido", "MS"],
  ["muro con un espesor que no es un número", (f) => (muro(f).espesor = m("30")), "fisico/valor-no-valido", "MS"],
  ["muro con una base desconocida", (f) => (muro(f).base = m("pilotes")), "fisico/valor-no-valido", "MS"],
  // Geometría
  ["muro de un solo punto", (f) => (muro(f).puntos = [[0, 0]]), "fisico/valor-no-valido", "MS"],
  ["muro con puntos que no son pares", (f) => (muro(f).puntos = m([[0, 0, 0], [8, 0, 0]])), "fisico/valor-no-valido", "MS"],
  ["muro con dos puntos iguales seguidos", (f) => (muro(f).puntos = [[0, 0], [0, 0], [8, 0]]), "fisico/valor-no-valido", "MS"],
  ["muro con un tramo más corto que 2·ε_snap", (f) => (muro(f).puntos = [[0, 0], [8, 0], [8, 0.08]]), "fisico/valor-no-valido", "MS"],
  ["muro que vuelve sobre sí mismo", (f) => (muro(f).puntos = [[0, 0], [8, 0], [4, 0]]), "fisico/valor-no-valido", "MS"],
  ["muro que se solapa con otro en las mismas plantas", (f) => (f.muros as unknown as object[]).push({ id: "M2", puntos: [[2, 0], [6, 0]], desde: "C", hasta: "P1", espesor: 0.2, material: "HA" }), "muro/solapados", "M2"],
  ["muro que se solapa consigo mismo", (f) => (muro(f, "NUC").puntos = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2], [3, 2]]), "muro/solapados", "NUC"],
  ["borde de losa dentro del espesor de un muro sin ir por su eje (C3-b)", (f) => Object.assign(muro(f), { puntos: [[0, 0.12], [8, 0.12]], espesor: 0.4 }), "losa/borde-en-muro", "L"],
  ["muro apeado («ninguno») sin nada debajo (fuera de la losa)", (f) => (f.muros as unknown as object[]).push({ id: "MA", puntos: [[9, 2], [11, 2]], desde: "P1", hasta: "P2", espesor: 0.2, material: "HA", base: "ninguno" }), "muro/arranque-sin-apoyo", "MA"],
  ["muro empotrado en una planta con diafragma rígido", (f) => (f.muros as unknown as object[]).push({ id: "MA", puntos: [[5.5, 4.5], [7, 4.5]], desde: "P1", hasta: "P2", espesor: 0.2, material: "HA" }), "apoyo/en-diafragma", "MA"],
  // Huecos
  ["huecos que no son una lista", (f) => (muro(f).huecos = m({})), "fisico/valor-no-valido", "MS"],
  ["hueco sin números", (f) => (muro(f).huecos = m([{ desde: "1", hasta: 2, z0: 0, z1: 1 }])), "fisico/valor-no-valido", "MS"],
  ["hueco más estrecho que ε_snap", (f) => (muro(f).huecos = [{ desde: 3, hasta: 3.02, z0: 1, z1: 2 }]), "fisico/valor-no-valido", "MS"],
  ["hueco más bajo que ε_snap", (f) => (muro(f).huecos = [{ desde: 3, hasta: 4, z0: 1, z1: 1.03 }]), "fisico/valor-no-valido", "MS"],
  ["hueco al revés", (f) => (muro(f).huecos = [{ desde: 4, hasta: 3, z0: 1, z1: 2 }]), "fisico/valor-no-valido", "MS"],
  ["hueco fuera del muro", (f) => (muro(f).huecos = [{ desde: 7.5, hasta: 9, z0: 1, z1: 2 }]), "fisico/valor-no-valido", "MS"],
  ["hueco que pasa de un tramo a otro", (f) => (muro(f, "NUC").huecos = [{ desde: 1.5, hasta: 2.5, z0: 1, z1: 2 }]), "fisico/valor-no-valido", "NUC"],
  ["hueco por debajo de la base", (f) => (muro(f).huecos = [{ desde: 3, hasta: 4, z0: -1, z1: 1 }]), "fisico/valor-no-valido", "MS"],
  ["hueco por encima de la cabeza", (f) => (muro(f).huecos = [{ desde: 3, hasta: 4, z0: 2, z1: 3.5 }]), "fisico/valor-no-valido", "MS"],
  ["huecos que se solapan", (f) => (muro(f).huecos = [{ desde: 3, hasta: 4, z0: 1, z1: 2 }, { desde: 3.5, hasta: 5, z0: 1.5, z1: 2.5 }]), "fisico/valor-no-valido", "MS"],
  // Empujes
  ["empuje sobre un muro que no existe", (f) => (carga(f, "E").muro = "X"), "fisico/referencia", "E"],
  ["empuje con un lado desconocido", (f) => (carga(f, "E").lado = "arriba"), "fisico/valor-no-valido", "E"],
  ["empuje sin números", (f) => (carga(f, "E").p0 = m("30")), "fisico/valor-no-valido", "E"],
  ["empuje con z1 por debajo de z0", (f) => Object.assign(carga(f, "E"), { z0: 2, z1: 1 }), "fisico/valor-no-valido", "E"],
  ["empuje en un caso que no existe", (f) => (carga(f, "E").caso = "X"), "fisico/referencia", "E"],
  // Cargas y apoyos sobre muros
  ["carga lineal que se sale del eje del muro en una planta sin losa", (f) => (f.cargas as unknown as object[]).push({ tipo: "lineal", id: "t", caso: "Q", planta: "C", puntos: [[1, 0], [1, 2]], q: [0, 0, -5] }), "carga/fuera-de-losa", "t"],
  ["carga puntual que no cae en el muro de una planta sin losa", (f) => (f.cargas as unknown as object[]).push({ tipo: "puntual", id: "pp", caso: "Q", planta: "C", x: 5, y: 3, F: [0, 0, -5] }), "carga/sin-destino", "pp"],
  ["apoyo lineal que se sale del eje del muro en una planta sin losa", (f) => (f.apoyosLineales = [{ id: "AL", planta: "C", puntos: [[1, 0], [1, 2]], coartados: [false, false, true, false, false, false] }]), "apoyo/fuera-de-losa", "AL"],
];

describe("criterio 6 de C3: entradas no válidas", () => {
  it("el modelo base es válido", () => {
    const r = compilar(base());
    expect(r.valido, JSON.stringify(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje))).toBe(true);
  });

  it.each(CATALOGO)("%s → %s", (_n, mutar, codigo, id) => {
    const f = structuredClone(base()) as Record<string, unknown> & ModeloFisico;
    mutar(f);
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(f))).not.toThrow();
    expect(r!.valido).toBe(false);
    const d = r!.diagnosticos.filter((x) => x.codigo === codigo);
    expect(d.length, `${codigo} no está en ${r!.diagnosticos.map((x) => `${x.codigo} (${x.mensaje})`).join("; ")}`).toBeGreaterThan(0);
    for (const x of r!.diagnosticos) expect(x.codigo).not.toBe("compilador/error-interno");
    if (id) expect(d.some((x) => x.ids?.includes(id)), `${codigo} sin el id ${id}: ${JSON.stringify(d.map((x) => x.ids))}`).toBe(true);
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(40);
  });
});
