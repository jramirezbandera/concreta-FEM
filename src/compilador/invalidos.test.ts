/**
 * Criterio 5 de C1: catálogo de modelos físicos no válidos. Cada uno es una mutación de un modelo
 * válido y tiene que acabar en un error con su código y con el id físico del objeto culpable,
 * sin lanzar nunca (la entrada puede venir de un fichero).
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

function base(): ModeloFisico {
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "C", altura: 3, tipo: "sotano" },
    ],
    materiales: [
      { id: "HA", tipo: "hormigon", fck: 25 },
      { id: "S", tipo: "acero" },
      { id: "Gm", tipo: "general", E: 3e7, G: 1.2e7, peso: 25 },
    ],
    secciones: [
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "c40", material: "HA", forma: "circular", D: 0.4 },
      { id: "ipe", material: "S", forma: "I", perfil: { A: 53.8, Iy: 8360, Iz: 604, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 } },
      { id: "t", material: "HA", forma: "T", bf: 0.8, hf: 0.05, bw: 0.12, h: 0.35 },
      { id: "gen", material: "Gm", forma: "general", A: 0.1, Iy: 1e-3, Iz: 1e-3, J: 1e-3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P2", seccion: "p30", tramos: [{ planta: "P2", seccion: "c40" }] },
      { id: "B", x: 6, y: 0, desde: "C", hasta: "P2", seccion: "p30", giro: 30 },
      { id: "D", x: 0, y: 5, desde: "C", hasta: "P2", seccion: "p30" },
      { id: "E", x: 6, y: 5, desde: "C", hasta: "P2", seccion: "p30", base: "articulado" },
    ],
    vigas: ["P1", "P2"].flatMap((p) => [
      { id: `X0${p}`, planta: p, puntos: [[0, 0], [6, 0]] as const, seccion: "v" },
      { id: `X5${p}`, planta: p, puntos: [[0, 5], [6, 5]] as const, seccion: "ipe" },
      { id: `Y0${p}`, planta: p, puntos: [[0, 0], [0, 5]] as const, seccion: "t" },
      { id: `Y6${p}`, planta: p, puntos: [[6, 0], [6, 5]] as const, seccion: "gen", liberaciones: { fin: [false, false, false, false, true, true] as const } },
    ]),
    apoyos: [],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "viga", id: "q1", caso: "Q", viga: "X0P1", ejes: "global", q: [0, 0, -10] },
      { tipo: "pilar", id: "w1", caso: "Q", pilar: "A", ejes: "local", q: [0, 0, 1], desde: 0, hasta: 6 },
      { tipo: "puntual", id: "f1", caso: "Q", planta: "P2", x: 3, y: 0, F: [0, 0, -5] },
    ],
  };
}

type Mutable = { -readonly [K in keyof ModeloFisico]: ModeloFisico[K] extends readonly (infer T)[] | undefined ? T[] : ModeloFisico[K] };
type Caso = [nombre: string, mutar: (m: Mutable) => unknown, codigo: string, id?: string, opciones?: OpcionesCompilacion];

const m = (o: unknown) => o as never;
const CATALOGO: Caso[] = [
  // Forma del modelo
  ["el modelo no es un objeto", () => null, "fisico/no-valido"],
  ["falta la lista de plantas", (f) => delete (f as Partial<Mutable>).plantas, "fisico/no-valido"],
  ["las secciones no son una lista", (f) => ((f as Record<string, unknown>).secciones = {}), "fisico/no-valido"],
  ["una planta sin id", (f) => f.plantas.push(m({ altura: 3 })), "fisico/sin-id"],
  ["un objeto nulo entre los pilares", (f) => f.pilares!.push(m(null)), "fisico/sin-id"],
  ["id repetido entre una viga y un pilar", (f) => f.vigas!.push({ ...f.vigas![0]!, id: "A" }), "fisico/id-duplicado", "A"],
  ["sin plantas", (f) => (f.plantas = []), "fisico/sin-plantas"],
  ["sin casos", (f) => ((f.casos = []), (f.cargas = [])), "fisico/sin-casos"],
  // Plantas
  ["tipo de planta desconocido", (f) => (f.plantas[1] = m({ ...f.plantas[1], tipo: "garaje" })), "fisico/valor-no-valido", "P1"],
  ["altura negativa", (f) => (f.plantas[1] = { ...f.plantas[1]!, altura: -3 }), "fisico/valor-no-valido", "P1"],
  ["altura NaN", (f) => (f.plantas[1] = { ...f.plantas[1]!, altura: Number.NaN }), "fisico/valor-no-valido", "P1"],
  ["diafragma desconocido", (f) => (f.plantas[0] = m({ ...f.plantas[0], diafragma: "flexible" })), "fisico/valor-no-valido", "P2"],
  ["falta la altura de una planta intermedia", (f) => (f.plantas[1] = { ...f.plantas[1]!, altura: null }), "planta/sin-cota", "P2"],
  ["una planta de altura nula entre dos tramos", (f) => (f.plantas[1] = { ...f.plantas[1]!, altura: 0 }), "fisico/valor-no-valido", "A"],
  // Materiales y secciones
  ["material de tipo desconocido", (f) => f.materiales.push(m({ id: "X", tipo: "madera" })), "fisico/valor-no-valido", "X"],
  ["fck nula", (f) => (f.materiales[0] = { id: "HA", tipo: "hormigon", fck: 0 }), "fisico/valor-no-valido", "HA"],
  ["ν fuera de rango", (f) => (f.materiales[0] = { id: "HA", tipo: "hormigon", fck: 25, nu: 0.5 }), "fisico/valor-no-valido", "HA"],
  ["peso específico negativo", (f) => (f.materiales[1] = { id: "S", tipo: "acero", peso: -1 }), "fisico/valor-no-valido", "S"],
  ["material general sin G", (f) => (f.materiales[2] = m({ id: "Gm", tipo: "general", E: 3e7, peso: 25 })), "fisico/valor-no-valido", "Gm"],
  ["sección con un material que no existe", (f) => (f.secciones[0] = { ...f.secciones[0]!, material: "HB" }), "fisico/referencia", "p30"],
  ["rectángulo de canto nulo", (f) => (f.secciones[0] = { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0 }), "fisico/valor-no-valido", "p30"],
  ["círculo sin diámetro", (f) => (f.secciones[1] = m({ id: "c40", material: "HA", forma: "circular" })), "fisico/valor-no-valido", "c40"],
  ["perfil sin It", (f) => (f.secciones[2] = m({ id: "ipe", material: "S", forma: "I", perfil: { A: 53.8, Iy: 8360, Iz: 604, h: 300, b: 150, tf: 10.7, tw: 7.1 } })), "fisico/valor-no-valido", "ipe"],
  ["T con el ala más gruesa que el canto", (f) => (f.secciones[3] = { id: "t", material: "HA", forma: "T", bf: 0.8, hf: 0.4, bw: 0.12, h: 0.35 }), "fisico/valor-no-valido", "t"],
  ["sección general con Iy negativa", (f) => (f.secciones[4] = { id: "gen", material: "Gm", forma: "general", A: 0.1, Iy: -1e-3, Iz: 1e-3, J: 1e-3 }), "fisico/valor-no-valido", "gen"],
  ["forma desconocida", (f) => f.secciones.push(m({ id: "z", material: "HA", forma: "Z" })), "fisico/valor-no-valido", "z"],
  // Pilares
  ["pilar con x no numérica", (f) => (f.pilares![0] = m({ ...f.pilares![0], x: "0" })), "fisico/valor-no-valido", "A"],
  ["pilar con una planta que no existe", (f) => (f.pilares![0] = { ...f.pilares![0]!, desde: "Z" }), "fisico/referencia", "A"],
  ["pilar que arranca por encima de su cabeza", (f) => (f.pilares![0] = { ...f.pilares![0]!, desde: "P2", hasta: "C" }), "fisico/valor-no-valido", "A"],
  ["pilar con una sección que no existe", (f) => (f.pilares![1] = { ...f.pilares![1]!, seccion: "q" }), "fisico/referencia", "B"],
  ["tramo de pilar fuera de su altura", (f) => (f.pilares![0] = { ...f.pilares![0]!, tramos: [{ planta: "C", seccion: "c40" }] }), "fisico/valor-no-valido", "A"],
  ["tramo de pilar repetido", (f) => (f.pilares![0] = { ...f.pilares![0]!, tramos: [{ planta: "P2", seccion: "c40" }, { planta: "P2", seccion: "p30" }] }), "fisico/valor-no-valido", "A"],
  ["giro no numérico", (f) => (f.pilares![1] = m({ ...f.pilares![1], giro: "30" })), "fisico/valor-no-valido", "B"],
  ["vínculo de base desconocido", (f) => (f.pilares![3] = m({ ...f.pilares![3], base: "deslizante" })), "fisico/valor-no-valido", "E"],
  ["liberaciones con 5 valores", (f) => (f.pilares![0] = m({ ...f.pilares![0], liberaciones: { base: [true, false, false, false, false] } })), "fisico/valor-no-valido", "A"],
  ["liberaciones con una clave desconocida", (f) => (f.pilares![0] = m({ ...f.pilares![0], liberaciones: { medio: [true, false, false, false, false, false] } })), "fisico/valor-no-valido", "A"],
  ["pilares solapados", (f) => f.pilares!.push({ id: "A2", x: 0.02, y: 0, desde: "C", hasta: "P1", seccion: "p30" }), "topologia/pilares-solapados", "A2"],
  ["pilar apeado sin nada que le llegue", (f) => f.pilares!.push({ id: "Ap", x: 3, y: 2.5, desde: "P1", hasta: "P2", seccion: "p30", base: "ninguno" }), "pilar/arranque-sin-apoyo", "Ap"],
  ["cabeza de pilar entera dentro del canto de la viga", (f) => (f.plantas[0] = { ...f.plantas[0]! }) && (f.plantas[1] = { ...f.plantas[1]!, altura: 0.4 }), "pilar/tramo-flexible-nulo", "A"],
  // Vigas
  ["viga con una planta que no existe", (f) => (f.vigas![0] = { ...f.vigas![0]!, planta: "Z" }), "fisico/referencia", "X0P1"],
  ["viga con un solo punto", (f) => (f.vigas![0] = { ...f.vigas![0]!, puntos: [[0, 0]] }), "fisico/valor-no-valido", "X0P1"],
  ["viga con dos puntos iguales", (f) => (f.vigas![0] = { ...f.vigas![0]!, puntos: [[0, 0], [3, 0], [3, 0], [6, 0]] }), "fisico/valor-no-valido", "X0P1"],
  ["viga que vuelve sobre sí misma", (f) => (f.vigas![0] = { ...f.vigas![0]!, puntos: [[0, 0], [6, 0], [3, 0]] }), "fisico/valor-no-valido", "X0P1"],
  ["punto de viga no numérico", (f) => (f.vigas![0] = m({ ...f.vigas![0], puntos: [[0, 0], [6, null]] })), "fisico/valor-no-valido", "X0P1"],
  ["inserción desconocida", (f) => (f.vigas![0] = m({ ...f.vigas![0], insercion: "inferior" })), "fisico/valor-no-valido", "X0P1"],
  ["vigas solapadas", (f) => f.vigas!.push({ id: "S1", planta: "P1", puntos: [[1, 0], [4, 0]], seccion: "v" }), "topologia/vigas-solapadas", "S1"],
  ["viga entera dentro de un pilar", (f) => f.vigas!.push({ id: "Z", planta: "P1", puntos: [[-0.1, 0.05], [0.1, 0.05]], seccion: "v" }), "viga/sin-tramo-flexible", "Z"],
  ["vigas que se tocan dentro de sus zonas rígidas", (f) => f.pilares!.push({ id: "Pz", x: 0.3, y: 0, desde: "C", hasta: "P1", seccion: "c40" }), "viga/tramo-flexible-nulo", "X0P1"],
  ["dos extremos que caen a 4 cm sobre la misma viga", (f) => f.vigas!.push({ id: "Ya", planta: "P1", puntos: [[3, 5], [3, 0.03]], seccion: "v" }, { id: "Yb", planta: "P1", puntos: [[3.04, -2], [3.04, -0.03]], seccion: "v" }), "topologia/nudos-proximos", "Ya"],
  // Apoyos
  ["apoyo sin ninguna coacción", (f) => f.apoyos!.push({ id: "Ap", planta: "P1", x: 3, y: 0, coartados: [false, false, false, false, false, false] }), "fisico/valor-no-valido", "Ap"],
  ["apoyo en una planta que no existe", (f) => f.apoyos!.push({ id: "Ap", planta: "Z", x: 3, y: 0, coartados: [false, false, true, false, false, false] }), "fisico/referencia", "Ap"],
  ["apoyo que no cae en nada", (f) => f.apoyos!.push({ id: "Ap", planta: "P1", x: 3, y: 2.5, coartados: [false, false, true, false, false, false] }), "apoyo/sin-destino", "Ap"],
  ["apoyo en ux de una planta con diafragma", (f) => f.apoyos!.push({ id: "Ap", planta: "P1", x: 3, y: 0, coartados: [true, false, false, false, false, false] }), "apoyo/en-diafragma", "Ap"],
  ["empotramiento en una planta con diafragma", (f) => (f.plantas[2] = { ...f.plantas[2]!, diafragma: "rigido" }), "apoyo/en-diafragma", "A"],
  // Casos y cargas
  ["dos casos con el peso propio", (f) => (f.casos[1] = { id: "Q", pesoPropio: true }), "caso/peso-propio-repetido", "Q"],
  ["carga de un caso que no existe", (f) => (f.cargas![0] = { ...f.cargas![0]!, caso: "W" } as never), "fisico/referencia", "q1"],
  ["carga de tipo desconocido", (f) => f.cargas!.push(m({ id: "x", tipo: "superficie", caso: "Q" })), "fisico/valor-no-valido", "x"],
  ["puntual sin fuerza ni momento", (f) => f.cargas!.push({ tipo: "puntual", id: "x", caso: "Q", planta: "P1", x: 3, y: 0 }), "fisico/valor-no-valido", "x"],
  ["puntual con F de 2 componentes", (f) => f.cargas!.push(m({ tipo: "puntual", id: "x", caso: "Q", planta: "P1", x: 3, y: 0, F: [0, 1] })), "fisico/valor-no-valido", "x"],
  ["carga sobre una viga que no existe", (f) => f.cargas!.push({ tipo: "viga", id: "x", caso: "Q", viga: "Z", ejes: "global", q: [0, 0, -1] }), "fisico/referencia", "x"],
  ["carga sobre un pilar que no existe", (f) => f.cargas!.push({ tipo: "pilar", id: "x", caso: "Q", pilar: "Z", ejes: "global", q: [1, 0, 0] }), "fisico/referencia", "x"],
  ["ejes desconocidos", (f) => f.cargas!.push(m({ tipo: "viga", id: "x", caso: "Q", viga: "X0P1", ejes: "polar", q: [0, 0, -1] })), "fisico/valor-no-valido", "x"],
  ["tramo de carga invertido", (f) => f.cargas!.push({ tipo: "viga", id: "x", caso: "Q", viga: "X0P1", ejes: "global", q: [0, 0, -1], desde: 4, hasta: 2 }), "fisico/valor-no-valido", "x"],
  ["carga más allá del final de la viga", (f) => f.cargas!.push({ tipo: "viga", id: "x", caso: "Q", viga: "X0P1", ejes: "global", q: [0, 0, -1], desde: 2, hasta: 7 }), "carga/fuera-de-pieza", "x"],
  ["puntual que no cae en nada", (f) => f.cargas!.push({ tipo: "puntual", id: "x", caso: "Q", planta: "P1", x: 3, y: 2.5, F: [0, 0, -1] }), "carga/sin-destino", "x"],
  // Opciones
  ["ε_snap menor que ε_geom", () => undefined, "opciones/no-validas", undefined, { epsGeom: 1e-3, epsSnap: 1e-4 }],
  ["factor de zona rígida mayor que 1", () => undefined, "opciones/no-validas", undefined, { factorZonaRigida: 1.5 }],
];

describe("criterio 5 de C1: entradas físicas no válidas", () => {
  it("el modelo base es válido y no tiene avisos", () => {
    const r = compilar(base());
    expect(r.diagnosticos).toEqual([]);
    expect(r.valido).toBe(true);
  });

  it.each(CATALOGO)("%s → %s", (_n, mutar, codigo, id, opciones) => {
    const f = base() as Mutable;
    const otro = mutar(f);
    const entrada = otro === null ? (null as unknown as ModeloFisico) : (f as ModeloFisico);
    let r: ReturnType<typeof compilar> | undefined;
    expect(() => (r = compilar(entrada, opciones))).not.toThrow();
    expect(r!.valido).toBe(false);
    const d = r!.diagnosticos.filter((x) => x.codigo === codigo);
    expect(d.length, `${codigo} no está en ${r!.diagnosticos.map((x) => `${x.codigo} (${x.mensaje})`).join("; ")}`).toBeGreaterThan(0);
    for (const x of r!.diagnosticos) expect(x.codigo).not.toBe("compilador/error-interno");
    if (id) expect(d.some((x) => x.ids?.includes(id)), `${codigo} sin el id ${id}: ${JSON.stringify(d.map((x) => x.ids))}`).toBe(true);
  });

  it(`son ${CATALOGO.length} entradas`, () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(60);
  });
});
