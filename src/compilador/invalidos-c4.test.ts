/**
 * Criterio 6 de C4: catálogo de entradas no válidas de los paños unidireccionales, los reticulares y
 * las cargas sobre paños. Cada una es una mutación de un modelo válido y tiene que acabar en un error
 * con su código y el id físico del culpable, sin lanzar nunca.
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

/** Dos vanos de 5 × 6 m: en P1, dos paños unidireccionales (uno con un hueco); en P2, un reticular con ábacos. */
function base(): ModeloFisico {
  const ejes = [0, 5, 10];
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "P0", altura: 3 },
    ],
    materiales: [
      { id: "HA", tipo: "hormigon", fck: 25 },
      { id: "S", tipo: "acero" },
    ],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "T", material: "HA", forma: "T", bf: 0.75, hf: 0.05, bw: 0.12, h: 0.3 },
    ],
    pilares: ejes.flatMap((x) => [0, 6].map((y) => ({ id: `C${x}-${y}`, x, y, desde: "P0", hasta: "P2", seccion: "p" }))),
    vigas: ["P1", "P2"].flatMap((p) => [
      ...ejes.map((x) => ({ id: `VY${x}-${p}`, planta: p, puntos: [[x, 0], [x, 6]] as Vec2[], seccion: "v" })),
      ...[0, 6].map((y) => ({ id: `VX${y}-${p}`, planta: p, puntos: [[0, y], [10, y]] as Vec2[], seccion: "v" })),
    ]),
    panos: [
      { id: "F1", planta: "P1", contorno: rect(0, 0, 5, 6), direccion: 0, intereje: 0.75, seccion: "T", pp: 3 },
      { id: "F2", planta: "P1", contorno: rect(5, 0, 10, 6), huecos: [rect(7.0123, 2.4123, 8.0123, 3.6123)], direccion: 0, intereje: 0.75, seccion: "T", pp: 3 },
    ],
    losas: [
      {
        id: "L2",
        planta: "P2",
        contorno: rect(0, 0, 10, 6),
        espesor: 0.35,
        material: "HA",
        reticular: { intereje: 0.82, nervio: 0.12, capa: 0.05, abacos: [rect(3.8, -1.2, 6.2, 1.2), rect(3.8, 4.8, 6.2, 7.2)] },
      },
    ],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "s1", caso: "Q", planta: "P1", pano: "F1", q: [0, 0, -2] },
      { tipo: "superficie", id: "z2", caso: "Q", planta: "P1", zona: rect(5.5123, 0.5123, 9.5123, 2.0123), q: [0, 0, -3] },
      { tipo: "lineal", id: "t1", caso: "G", planta: "P1", puntos: [[0.5123, 4.0123], [4.5123, 4.5123]], q: [0, 0, -5] },
      { tipo: "puntual", id: "p2", caso: "Q", planta: "P1", x: 6.0123, y: 4.5123, F: [0, 0, -10] },
      { tipo: "superficie", id: "s2", caso: "Q", planta: "P2", losa: "L2", q: [0, 0, -2] },
    ],
  };
}

type Caso = [nombre: string, mutar: (f: Record<string, unknown> & ModeloFisico) => void, codigo: string, id?: string];
const m = (o: unknown) => o as never;
const pano = (f: ModeloFisico, id = "F1") => f.panos!.find((p) => p.id === id) as unknown as Record<string, unknown>;
const ret = (f: ModeloFisico) => (f.losas![0] as unknown as Record<string, unknown>).reticular as Record<string, unknown>;
const carga = (f: ModeloFisico, id: string) => f.cargas!.find((c) => c.id === id) as unknown as Record<string, unknown>;
const anadir = (f: ModeloFisico, clave: "panos" | "cargas" | "losas" | "vigas", o: object) => (f[clave] as unknown as object[]).push(o);

const CATALOGO: Caso[] = [
  // Esquema y referencias de los paños
  ["paños que no son una lista", (f) => (f.panos = m({})), "fisico/no-valido"],
  ["paño sin id", (f) => (pano(f).id = m(3)), "fisico/sin-id"],
  ["paño con el id de una viga", (f) => (pano(f).id = "VY0-P1"), "fisico/id-duplicado", "VY0-P1"],
  ["paño en una planta que no existe", (f) => (pano(f).planta = "X"), "fisico/referencia", "F1"],
  ["paño con una sección que no existe", (f) => (pano(f).seccion = "X"), "fisico/referencia", "F1"],
  ["paño con una dirección que no es un número", (f) => (pano(f).direccion = m("0")), "fisico/valor-no-valido", "F1"],
  ["paño con una dirección infinita", (f) => (pano(f).direccion = Infinity), "fisico/valor-no-valido", "F1"],
  ["paño con un intereje menor que 2·ε_snap", (f) => (pano(f).intereje = 0.08), "fisico/valor-no-valido", "F1"],
  ["paño con un intereje negativo", (f) => (pano(f).intereje = -0.7), "fisico/valor-no-valido", "F1"],
  ["paño sin pp", (f) => delete pano(f).pp, "fisico/valor-no-valido", "F1"],
  ["paño con un pp negativo", (f) => (pano(f).pp = -1), "fisico/valor-no-valido", "F1"],
  // Geometría de los paños
  ["paño con un contorno de dos puntos", (f) => (pano(f).contorno = [[0, 0], [5, 0]]), "fisico/valor-no-valido", "F1"],
  ["paño con un contorno que se corta", (f) => (pano(f).contorno = [[0, 0], [5, 6], [5, 0], [0, 6]]), "fisico/valor-no-valido", "F1"],
  ["paño con huecos que no son una lista", (f) => (pano(f, "F2").huecos = m({})), "fisico/valor-no-valido", "F2"],
  ["paño con un hueco fuera del contorno", (f) => (pano(f, "F2").huecos = [rect(11, 1, 12, 2)]), "fisico/valor-no-valido", "F2"],
  ["paño con dos huecos que se solapan", (f) => (pano(f, "F2").huecos = [rect(6, 1, 8, 3), rect(7, 2, 9, 4)]), "fisico/valor-no-valido", "F2"],
  ["paños que se solapan", (f) => (pano(f, "F2").contorno = rect(4, 0, 10, 6)), "pano/solapados", "F2"],
  ["paño que se solapa con una losa de su planta", (f) => anadir(f, "losas", { id: "L1", planta: "P1", contorno: rect(4, 1, 6, 3), espesor: 0.2, material: "HA" }), "pano/solapado-con-losa", "L1"],
  ["paño que se queda sin área al unirse a lo cercano", (f) => anadir(f, "panos", { id: "F3", planta: "P1", contorno: [[10, 6], [10.03, 6], [10, 6.03]], direccion: 0, intereje: 0.75, seccion: "T", pp: 3 }), "pano/degenerado", "F3"],
  // Apoyos de las viguetas (C4-b)
  [
    "dos paños de la misma dirección sin viga entre ellos",
    (f) => (f.vigas = f.vigas!.filter((v) => v.id !== "VY5-P1").map((v) => (v.id.startsWith("VX") && v.planta === "P1" ? v : v))),
    "pano/contiguo-sin-apoyo",
    "F1",
  ],
  ["paño sin ningún apoyo", (f) => anadir(f, "panos", { id: "F3", planta: "P1", contorno: rect(20, 0, 25, 6), direccion: 0, intereje: 0.75, seccion: "T", pp: 3 }), "pano/vigueta-sin-apoyo", "F3"],
  [
    "paño sin viguetas (su única recta va por el eje de una viga)",
    (f) => {
      anadir(f, "vigas", { id: "VS", planta: "P1", puntos: [[12, 3], [17, 3]], seccion: "v" });
      anadir(f, "panos", { id: "F3", planta: "P1", contorno: rect(12, 2.9, 17, 3.1), direccion: 0, intereje: 0.75, seccion: "T", pp: 3 });
    },
    "pano/sin-viguetas",
    "F3",
  ],
  // Cargas sobre paños
  ["carga de superficie sobre un paño que no existe", (f) => (carga(f, "s1").pano = "X"), "fisico/referencia", "s1"],
  ["carga de superficie sobre un paño de otra planta", (f) => Object.assign(carga(f, "s2"), { losa: undefined, pano: "F1" }), "fisico/valor-no-valido", "s2"],
  ["carga de superficie sobre una losa y un paño a la vez", (f) => (carga(f, "s1").losa = "L2"), "fisico/valor-no-valido", "s1"],
  ["carga lineal que cruza el hueco de un paño", (f) => anadir(f, "cargas", { tipo: "lineal", id: "t2", caso: "G", planta: "P1", puntos: [[6.0123, 3.0123], [9.0123, 3.0123]], q: [0, 0, -5] }), "carga/fuera-de-losa", "t2"],
  ["carga lineal que se sale de los paños", (f) => (carga(f, "t1").puntos = [[0.5123, 4.0123], [-2.0123, 4.5123]]), "carga/fuera-de-losa", "t1"],
  ["carga puntual en el hueco de un paño", (f) => Object.assign(carga(f, "p2"), { x: 7.5, y: 3 }), "carga/sin-destino", "p2"],
  ["carga lineal en una planta sin losas, muros ni paños (se perdía en silencio)", (f) => anadir(f, "cargas", { tipo: "lineal", id: "t3", caso: "G", planta: "P0", puntos: [[1, 1], [3, 1]], q: [0, 0, -5] }), "carga/fuera-de-losa", "t3"],
  // Reticular
  ["reticular que no es un objeto", (f) => ((f.losas![0] as unknown as Record<string, unknown>).reticular = m(7)), "fisico/valor-no-valido", "L2"],
  ["reticular sin nervio", (f) => delete ret(f).nervio, "fisico/valor-no-valido", "L2"],
  ["reticular con el nervio más ancho que el intereje", (f) => (ret(f).nervio = 0.9), "fisico/valor-no-valido", "L2"],
  ["reticular con la capa más gruesa que el canto", (f) => (ret(f).capa = 0.4), "fisico/valor-no-valido", "L2"],
  ["reticular con un intereje que no es un número", (f) => (ret(f).intereje = m("0.82")), "fisico/valor-no-valido", "L2"],
  ["reticular con un multiplicador desconocido", (f) => (ret(f).multiplicadores = { k11: 0.5 }), "fisico/valor-no-valido", "L2"],
  ["reticular con un multiplicador nulo", (f) => (ret(f).multiplicadores = { m11: 0 }), "fisico/valor-no-valido", "L2"],
  ["reticular con un multiplicador mayor que 100 (una penalización)", (f) => (ret(f).multiplicadores = { m11: 1000 }), "fisico/valor-no-valido", "L2"],
  ["reticular con multiplicadores que no son un objeto", (f) => (ret(f).multiplicadores = m([0.3])), "fisico/valor-no-valido", "L2"],
  ["ábacos que no son una lista", (f) => (ret(f).abacos = m({})), "fisico/valor-no-valido", "L2"],
  ["ábaco que no es un polígono simple", (f) => (ret(f).abacos = [[[4, 1], [6, 2], [6, 1], [4, 2]]]), "fisico/valor-no-valido", "L2"],
  ["ábaco fuera de la losa", (f) => (ret(f).abacos = [rect(20, 0, 22, 2)]), "fisico/valor-no-valido", "L2"],
  ["ábacos que se solapan", (f) => (ret(f).abacos = [rect(3.8, -1.2, 6.2, 1.2), rect(5, 0.5, 7, 2)]), "fisico/valor-no-valido", "L2"],
];

describe("criterio 6 de C4: entradas no válidas", () => {
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

  it("modificadores de las viguetas no válidos: error de opciones, sin lanzar", () => {
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(base(), { modificadores: { viguetas: { todos: { K: 2 } as never } } }))).not.toThrow();
    expect(r!.valido).toBe(false);
    expect(r!.diagnosticos.map((d) => d.codigo)).toContain("opciones/no-validas");
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(40);
  });
});
