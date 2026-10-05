/**
 * Criterio 6 de C2: catálogo de entradas no válidas de las losas, apoyos lineales, bandas y cargas
 * de superficie y lineales. Cada una es una mutación de un modelo válido y tiene que acabar en un
 * error con su código y el id físico del culpable, sin lanzar nunca.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function base(): ModeloFisico {
  const esquinas: Vec2[] = [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ];
  return {
    plantas: [
      { id: "P1", altura: null },
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
    pilares: esquinas.map(([x, y], i) => ({ id: `A${i}`, x, y, desde: "C", hasta: "P1", seccion: "p" })),
    vigas: esquinas.map((a, i) => ({ id: `V${i}`, planta: "P1", puntos: [a, esquinas[(i + 1) % 4]!], seccion: "v" })),
    losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 6, 5), huecos: [rect(3.6, 3.1, 4.6, 4.1)], espesor: 0.25, material: "HA" }],
    apoyosLineales: [{ id: "AL", planta: "P1", puntos: [[2.0123, 1.0123], [2.0123, 3.5123]], coartados: [false, false, true, false, false, false] }],
    bandas: [{ id: "B", planta: "P1", desde: [0.2123, 2.5], hasta: [5.7877, 2.5], ancho: 1.5123 }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "s", caso: "G", planta: "P1", losa: "L", q: [0, 0, -2] },
      { tipo: "superficie", id: "z", caso: "Q", planta: "P1", zona: rect(0.8123, 0.8123, 2.9123, 2.4123), q: [0, 0, -3] },
      { tipo: "lineal", id: "t", caso: "G", planta: "P1", puntos: [[4.2123, 0.6123], [4.2123, 2.7123]], q: [0, 0, -6] },
      { tipo: "puntual", id: "f", caso: "Q", planta: "P1", x: 1.4123, y: 3.6123, F: [0, 0, -10] },
    ],
  };
}

type Caso = [nombre: string, mutar: (f: Record<string, unknown> & ModeloFisico) => void, codigo: string, id?: string, opciones?: OpcionesCompilacion];
const m = (o: unknown) => o as never;
const losa = (f: ModeloFisico) => f.losas![0] as unknown as Record<string, unknown>;
const carga = (f: ModeloFisico, id: string) => f.cargas!.find((c) => c.id === id) as unknown as Record<string, unknown>;

const CATALOGO: Caso[] = [
  // Losas
  ["losa en una planta que no existe", (f) => (losa(f).planta = "X"), "fisico/referencia", "L"],
  ["contorno de 2 puntos", (f) => (losa(f).contorno = [[0, 0], [6, 0]]), "fisico/valor-no-valido", "L"],
  ["contorno que no es una lista", (f) => (losa(f).contorno = m({ a: 1 })), "fisico/valor-no-valido", "L"],
  ["contorno en pajarita", (f) => (losa(f).contorno = [[0, 0], [6, 5], [6, 0], [0, 4]]), "fisico/valor-no-valido", "L"],
  ["contorno con un punto repetido", (f) => (losa(f).contorno = [[0, 0], [6, 0], [6, 0], [6, 5], [0, 5]]), "fisico/valor-no-valido", "L"],
  ["contorno con un número no finito", (f) => (losa(f).contorno = [[0, 0], [6, Number.NaN], [6, 5], [0, 5]]), "fisico/valor-no-valido", "L"],
  ["hueco fuera del contorno", (f) => (losa(f).huecos = [rect(7, 1, 8, 2)]), "fisico/valor-no-valido", "L"],
  ["hueco que toca el contorno", (f) => (losa(f).huecos = [rect(0, 1, 1, 2)]), "fisico/valor-no-valido", "L"],
  ["huecos solapados", (f) => (losa(f).huecos = [rect(1, 1, 2, 2), rect(1.5, 1.5, 2.5, 2.5)]), "fisico/valor-no-valido", "L"],
  ["huecos que no son una lista", (f) => (losa(f).huecos = m(3)), "fisico/valor-no-valido", "L"],
  ["espesor nulo", (f) => (losa(f).espesor = 0), "fisico/valor-no-valido", "L"],
  ["espesor negativo", (f) => (losa(f).espesor = -0.2), "fisico/valor-no-valido", "L"],
  ["material que no existe", (f) => (losa(f).material = "X"), "fisico/referencia", "L"],
  ["material de acero", (f) => (losa(f).material = "S"), "fisico/valor-no-valido", "L"],
  ["material general con ν fuera de rango", (f) => ((f.materiales as unknown as Record<string, unknown>[])[2]!.G = 1e6) && (losa(f).material = "Gm"), "fisico/valor-no-valido", "L"],
  ["pp negativo", (f) => (losa(f).pp = -1), "fisico/valor-no-valido", "L"],
  ["eje 1 que no es un número", (f) => (losa(f).eje1 = m("x")), "fisico/valor-no-valido", "L"],
  ["losas solapadas en la misma planta", (f) => (f.losas = [...f.losas!, { id: "L2", planta: "P1", contorno: rect(4, 3, 9, 7), espesor: 0.2, material: "HA" }]), "losa/solapadas", "L2"],
  ["borde de losa dentro del ancho de una viga (C2-c)", (f) => (losa(f).contorno = rect(0, 0.12, 6, 5)), "losa/borde-en-viga", "L"],
  ["planta sin cota", (f) => (f.plantas = [{ id: "P1", altura: null }, { id: "C", tipo: "sotano", altura: null }]), "planta/sin-cota"],
  ["hueco más pequeño que ε_snap", (f) => (losa(f).huecos = [rect(3, 2, 3.03, 2.03)]), "losa/degenerada", "L"],
  ["huellas de dos pilares solapadas", (f) => (f.pilares = [...f.pilares!, { id: "A8", x: 3, y: 2.5, desde: "C", hasta: "P1", seccion: "p" }, { id: "A9", x: 3.3, y: 2.5, desde: "C", hasta: "P1", seccion: "p" }]), "losa/huellas-solapadas"],
  // Apoyos lineales
  ["apoyo lineal de un punto", (f) => ((f.apoyosLineales![0] as unknown as Record<string, unknown>).puntos = [[1, 1]]), "fisico/valor-no-valido", "AL"],
  ["apoyo lineal sin coacciones", (f) => ((f.apoyosLineales![0] as unknown as Record<string, unknown>).coartados = [false, false, false, false, false, false]), "fisico/valor-no-valido", "AL"],
  ["apoyo lineal en una planta que no existe", (f) => ((f.apoyosLineales![0] as unknown as Record<string, unknown>).planta = "X"), "fisico/referencia", "AL"],
  ["apoyo lineal fuera de la losa", (f) => ((f.apoyosLineales![0] as unknown as Record<string, unknown>).puntos = [[2, 1], [2, 8]]), "apoyo/fuera-de-losa", "AL"],
  ["apoyo lineal en la huella de un pilar", (f) => ((f.apoyosLineales![0] as unknown as Record<string, unknown>).puntos = [[0.0123, 0.0623], [0.0123, 1.5123]]), "apoyo/en-huella", "AL"],
  ["apoyo lineal en ux con diafragma rígido", (f) => ((f.apoyosLineales![0] as unknown as Record<string, unknown>).coartados = [true, false, true, false, false, false]), "apoyo/en-diafragma"],
  ["apoyo puntual fuera de todo", (f) => (f.apoyos = [{ id: "AP", planta: "P1", x: 9, y: 9, coartados: [false, false, true, false, false, false] }]), "apoyo/sin-destino", "AP"],
  // Bandas
  ["banda de ancho nulo", (f) => ((f.bandas![0] as unknown as Record<string, unknown>).ancho = 0), "fisico/valor-no-valido", "B"],
  ["banda de longitud nula", (f) => ((f.bandas![0] as unknown as Record<string, unknown>).hasta = [0.2123, 2.5]), "fisico/valor-no-valido", "B"],
  ["banda en una planta que no existe", (f) => ((f.bandas![0] as unknown as Record<string, unknown>).planta = "X"), "fisico/referencia", "B"],
  ["banda con puntos que no son pares", (f) => ((f.bandas![0] as unknown as Record<string, unknown>).desde = [1]), "fisico/valor-no-valido", "B"],
  // Cargas de superficie
  ["superficie sin losa ni zona", (f) => delete carga(f, "z").zona, "fisico/valor-no-valido", "z"],
  ["superficie sobre una losa que no existe", (f) => (carga(f, "s").losa = "X"), "fisico/referencia", "s"],
  ["superficie sobre una losa de otra planta", (f) => (carga(f, "s").planta = "C"), "fisico/valor-no-valido", "s"],
  ["superficie con una zona que no es simple", (f) => (carga(f, "z").zona = [[1, 1], [2, 2], [2, 1], [1, 2]]), "fisico/valor-no-valido", "z"],
  ["superficie con q que no es un vector", (f) => (carga(f, "z").q = m([0, -3])), "fisico/valor-no-valido", "z"],
  ["superficie con una zona fuera de las losas", (f) => (carga(f, "z").zona = rect(8, 8, 9, 9)), "carga/fuera-de-losa", "z"],
  ["superficie en un caso que no existe", (f) => (carga(f, "z").caso = "X"), "fisico/referencia", "z"],
  // Cargas lineales
  ["lineal de un punto", (f) => (carga(f, "t").puntos = [[1, 1]]), "fisico/valor-no-valido", "t"],
  ["lineal con dos puntos iguales", (f) => (carga(f, "t").puntos = [[1, 1], [1, 1], [2, 2]]), "fisico/valor-no-valido", "t"],
  ["lineal con q que no es un vector", (f) => (carga(f, "t").q = m(5)), "fisico/valor-no-valido", "t"],
  ["lineal que se sale de la losa", (f) => (carga(f, "t").puntos = [[4.2123, 0.6123], [4.2123, 7.1]]), "carga/fuera-de-losa", "t"],
  ["lineal que cruza el hueco", (f) => (carga(f, "t").puntos = [[4.1123, 2.6123], [4.1123, 4.6123]]), "carga/fuera-de-losa", "t"],
  ["lineal en una planta que no existe", (f) => (carga(f, "t").planta = "X"), "fisico/referencia", "t"],
  // Cargas puntuales
  ["puntual fuera de todo", (f) => (carga(f, "f").x = 9), "carga/sin-destino", "f"],
  ["puntual en el hueco", (f) => Object.assign(carga(f, "f"), { x: 4.1, y: 3.6 }), "carga/sin-destino", "f"],
  // Opciones
  ["tamaño de malla menor que 2·ε_snap", () => undefined, "opciones/no-validas", undefined, { tamanoMalla: 0.05 }],
  ["tamaño de malla no finito", () => undefined, "opciones/no-validas", undefined, { tamanoMalla: Number.POSITIVE_INFINITY }],
  ["rejilla que no es un booleano", () => undefined, "opciones/no-validas", undefined, { rejilla: "sí" as unknown as boolean }],
];

describe("criterio 6 de C2: entradas no válidas", () => {
  it("el modelo base es válido", () => {
    const r = compilar(base());
    expect(r.valido, JSON.stringify(r.diagnosticos.map((d) => d.mensaje))).toBe(true);
  });

  it.each(CATALOGO)("%s → %s", (_n, mutar, codigo, id, opciones) => {
    const f = structuredClone(base()) as Record<string, unknown> & ModeloFisico;
    mutar(f);
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(f, opciones))).not.toThrow();
    expect(r!.valido).toBe(false);
    const d = r!.diagnosticos.filter((x) => x.codigo === codigo);
    expect(d.length, `${codigo} no está en ${r!.diagnosticos.map((x) => `${x.codigo} (${x.mensaje})`).join("; ")}`).toBeGreaterThan(0);
    for (const x of r!.diagnosticos) expect(x.codigo).not.toBe("compilador/error-interno");
    if (id) expect(d.some((x) => x.ids?.includes(id)), `${codigo} sin el id ${id}: ${JSON.stringify(d.map((x) => x.ids))}`).toBe(true);
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(45);
  });
});
