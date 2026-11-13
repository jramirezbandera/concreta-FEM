/**
 * Fase BN (`docs/fem3d/barras.md`): las barras entre dos niveles.
 * - Oráculo a mano: pórtico de dos pilares de hormigón arriostrado con una diagonal de acero, con la
 *   zona rígida de CB-f en los dos extremos y una carga repartida en la barra, frente a su modelo
 *   analítico escrito a mano a ≤ 1e-10.
 * - Extremos (criterio 2): en un pilar, en un nudo, en una viga (que se parte), en una losa, en el
 *   ancho de una viga y en un muro, con el peso propio y el equilibrio del motor; y los errores.
 * - Ejes locales (criterio 3): una carga local frente a la misma en globales, en una barra inclinada
 *   y en una vertical; un giro de 90° es la sección con b y h cambiados.
 * - Zona rígida (criterio 4): hasta la cara de un pilar de hormigón, y ninguna en uno de acero.
 * - Metamórficas (criterio 5): trasladar y girar el modelo, invertir las barras y reordenar las listas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OPCIONES_MANO } from "../../validacion/c1/mano.ts";
import { calcular } from "../motor/calcular.ts";
import { compararModelos, uniformeANudo } from "../pruebas/compilador.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO } from "../pruebas/constructor.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { barajar, emparejar, errorBarras, errorNudos, planos, relacionPlano, relacionPlanoC2 } from "../pruebas/metamorficasFisicas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { acero, circular, hormigon, rectangular } from "../secciones/seccion3D.ts";
import type { Vec3 } from "../motor/modelo.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import type { Barra, CargaFisica, ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type Valido = Extract<ResultadoCompilacion, { valido: true }>;
const valido = (r: ResultadoCompilacion): Valido => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
};

const PLANTAS: ModeloFisico["plantas"] = [
  { id: "P1", altura: null, diafragma: "ninguno" },
  { id: "C", altura: 3, diafragma: "ninguno" },
];
const MATERIALES: ModeloFisico["materiales"] = [
  { id: "HA", tipo: "hormigon", fck: 25 },
  { id: "S", tipo: "acero" },
];
const SECCIONES: ModeloFisico["secciones"] = [
  { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "d", material: "S", forma: "circular", D: 0.05 },
];
const OPCIONES: OpcionesCompilacion = { ...OPCIONES_MANO, empotramientoCabeza: 1 };

describe("BN: oráculo a mano, pórtico arriostrado", () => {
  // Pilares de 30 × 30 en (0, 0) y (4, 0), de C (cota 0) a P1 (cota 3); diagonal de acero de la base
  // del primero a la cabeza del segundo: 5 m, con la horizontal 4/5. Dentro de cada huella, 0,15 m en
  // planta: 0,1875 m de eje rígido en cada extremo (CB-f).
  const fisico: ModeloFisico = {
    plantas: PLANTAS,
    materiales: MATERIALES,
    secciones: SECCIONES,
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "B", x: 4, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    barras: [{ id: "D", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 4, y: 0 }, seccion: "d" }],
    casos: [{ id: "Q" }],
    cargas: [
      { tipo: "puntual", id: "H", caso: "Q", planta: "P1", x: 0, y: 0, F: [50, 0, 0] },
      { tipo: "barra", id: "q", caso: "Q", barra: "D", ejes: "global", q: [0, 0, -2] },
    ],
  };
  const r = valido(compilar(fisico, OPCIONES));

  it("el modelo analítico es el escrito a mano", () => {
    const HA = hormigon(25);
    const m = new Constructor();
    const n0 = m.nudo(0, 0, 0);
    const n1 = m.nudo(0, 0, 3);
    const n2 = m.nudo(4, 0, 0);
    const n3 = m.nudo(4, 0, 3);
    m.barra(n0, n1, rectangular(0.3, 0.3, HA), [1, 0, 0]);
    m.barra(n2, n3, rectangular(0.3, 0.3, HA), [1, 0, 0]);
    const e: Vec3 = [0.8, 0, 0.6];
    const z = 0.1875;
    const Ip: Vec3 = [e[0] * z, 0, e[2] * z];
    const Jp: Vec3 = [4 - e[0] * z, 0, 3 - e[2] * z];
    const d = m.barra(n0, n3, circular(0.05, acero(210000)), [0, 0, 1], { offsets: { i: Ip, j: [Jp[0] - 4, 0, Jp[2] - 3] } });
    m.apoyo(n0, EMPOTRADO);
    m.apoyo(n2, EMPOTRADO);
    const q: Vec3 = [0, 0, -2];
    m.caso("Q", [carga(n1, { fx: 50 }), uniformeANudo(n0, [0, 0, 0], [0, 0, 0], Ip, q), uniformeANudo(n3, [4, 0, 3], Jp, [4, 0, 3], q)], [], [{ tipo: "distribuida", barra: d, ejes: "global", qa: q }]);
    const c = compararModelos(r.modelo, m.modelo());
    expect(c.nBarras).toBe(3);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });

  it("el mapeo da la barra como pieza, con sus estaciones desde el inicio", () => {
    const i = r.mapeo.piezas.D!;
    expect(i).toHaveLength(1);
    const b = r.mapeo.barras[i[0]!]!;
    expect(b.tipo).toBe("barra");
    expect(b.s[0]).toBe(0);
    expect(b.s[1]).toBeCloseTo(0.1875, 14);
    expect(b.s[2]).toBeCloseTo(5 - 0.1875, 14);
    expect(b.s[3]).toBeCloseTo(5, 14);
  });

  it("la hipótesis nombra la barra y su zona rígida", () => {
    expect(r.hipotesis.some((h) => h.includes("Barras entre dos niveles (D)") && h.includes("CB-f): D"))).toBe(true);
  });
});

/** Nudo del extremo de una barra en el modelo analítico. */
const nudoDe = (r: Valido, barra: string, lado: "inicio" | "fin") => {
  const k = r.mapeo.piezas[barra]![0]!;
  return r.modelo.nudos[r.modelo.barras![k]!.nudos[lado === "inicio" ? 0 : 1]]!;
};
const codigos = (r: ResultadoCompilacion) => r.diagnosticos.map((d) => d.codigo);
/** Suma de las reacciones verticales del primer caso. */
const reaccionZ = (r: Valido) => {
  const c = casosValidos(calcular(r.modelo, { solver: "perfil" }))[0]!;
  let Rz = 0;
  for (let n = 0; n < r.modelo.nudos.length; n++) Rz += c.reacciones[6 * n + 2]!;
  return Rz;
};

const b = (id: string, desde: [number, number], hasta: [number, number], extra: Partial<Barra> = {}): Barra => ({ id, inicio: { planta: "C", x: desde[0], y: desde[1] }, fin: { planta: "P1", x: hasta[0], y: hasta[1] }, seccion: "d", ...extra });
const BARRAS_EXTREMOS: Barra[] = [
  b("b1", [0, 0], [3, 0]), // de la base de A a la viga V1, que se parte
  b("b2", [6, 0], [3, 3]), // de la base de B a la losa
  b("b3", [0, 6], [3, 6]), // de la base de C1 al muro M1
  b("b4", [6, 6], [2, 0.1]), // de la base de D al ancho de V1: va a su eje
  b("b5", [6, 6], [3.03, 0]), // de la base de D al nudo de b1 en V1, a 3 cm
  { id: "b6", inicio: { planta: "P1", x: 0, y: 0 }, fin: { planta: "P1", x: 6, y: 6 }, seccion: "d" }, // en el plano de P1, de A a D
];

/**
 * Losa de 6 × 6 en P1 sobre cuatro pilares, con la viga V1 por y = 0 y un muro por y = 6, y barras
 * desde las bases de los pilares en C a cada destino de P1.
 */
function extremos(barras: Barra[] = BARRAS_EXTREMOS, cargas: CargaFisica[] = []): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: MATERIALES,
    secciones: [...SECCIONES, { id: "v30", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 }],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "B", x: 6, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "C1", x: 0, y: 6, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "D", x: 6, y: 6, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    vigas: [{ id: "V1", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v30" }],
    losas: [{ id: "L1", planta: "P1", contorno: [[0, 0], [6, 0], [6, 6], [0, 6]], espesor: 0.25, material: "HA" }],
    muros: [{ id: "M1", puntos: [[1.5, 6], [4.5, 6]], desde: "C", hasta: "P1", espesor: 0.2, material: "HA" }],
    barras,
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L1", q: [0, 0, -3] }, { tipo: "puntual", id: "H", caso: "Q", planta: "P1", x: 6, y: 6, F: [20, 10, 0] }, ...cargas],
  };
}

describe("BN: extremos (criterio 2)", () => {
  const r = valido(compilar(extremos()));
  const zP1 = 3;

  it("cada extremo va a su destino", () => {
    // Los inicios, a los nudos de las bases de los pilares
    for (const [id, x, y] of [["b1", 0, 0], ["b2", 6, 0], ["b3", 0, 6], ["b4", 6, 6], ["b5", 6, 6]] as const) {
      const n = nudoDe(r, id, "inicio");
      expect([n.x, n.y, n.z], id).toEqual([x, y, 0]);
    }
    // A la viga, partida en su punto; al nudo de b1, a 3 cm; al ancho de la viga, a su eje
    expect(nudoDe(r, "b1", "fin")).toMatchObject({ x: 3, y: 0, z: zP1 });
    expect(nudoDe(r, "b5", "fin")).toBe(nudoDe(r, "b1", "fin"));
    const n4 = nudoDe(r, "b4", "fin");
    expect([n4.y, n4.z]).toEqual([0, zP1]);
    expect(n4.x).toBeCloseTo(2, 9);
    // A la losa y al muro, en su punto
    expect(nudoDe(r, "b2", "fin")).toMatchObject({ x: 3, y: 3, z: zP1 });
    expect(nudoDe(r, "b3", "fin")).toMatchObject({ x: 3, y: 6, z: zP1 });
    const nm = r.modelo.nudos.indexOf(nudoDe(r, "b3", "fin"));
    expect(r.mapeo.nudos[nm]!.fisicos).toContain("M1");
    // b6, de pilar a pilar en P1
    expect(nudoDe(r, "b6", "inicio")).toMatchObject({ x: 0, y: 0, z: zP1 });
    expect(nudoDe(r, "b6", "fin")).toMatchObject({ x: 6, y: 6, z: zP1 });
  });

  it("los avisos: la fusión de b5 y b6 en el diafragma de P1", () => {
    const avisos = r.diagnosticos.filter((d) => d.severidad === "aviso");
    expect(avisos.some((d) => d.codigo === "topologia/fusion" && d.ids?.includes("b5"))).toBe(true);
    expect(avisos.filter((d) => d.codigo === "barra/en-diafragma").map((d) => d.ids?.[0])).toEqual(["b6"]);
  });

  it("calcula con el equilibrio del motor, y las barras pesan γ·A por su longitud real", () => {
    expect(casosValidos(calcular(r.modelo, { solver: "perfil" }))).toHaveLength(2);
    const A = (Math.PI * 0.05 ** 2) / 4;
    const L = (x: number, y: number) => Math.hypot(x, y, 3);
    const largo = L(3, 0) + L(3, 3) + L(3, 0) + L(4, 5.9) + L(2.97, 6) + Math.hypot(6, 6);
    expect((reaccionZ(r) - reaccionZ(valido(compilar(extremos([]))))) / (78.5 * A * largo)).toBeCloseTo(1, 10);
  });

  it("los errores: sin destino, dz, longitud nula, carga fuera de la barra o de una barra que no existe", () => {
    expect(codigos(compilar(extremos([b("x", [0, 0], [10, 10])])))).toContain("barra/extremo-sin-apoyo");
    expect(codigos(compilar(extremos([{ ...b("x", [0, 0], [3, 0]), fin: { planta: "P1", x: 3, y: 0, dz: 0.5 } }])))).toContain("barra/dz-no-admitido");
    expect(codigos(compilar(extremos([{ id: "x", inicio: { planta: "P1", x: 3, y: 3 }, fin: { planta: "P1", x: 3, y: 3 }, seccion: "d" }])))).toContain("barra/longitud-nula");
    expect(codigos(compilar(extremos([{ id: "x", inicio: { planta: "P1", x: 0, y: 0 }, fin: { planta: "P1", x: 0.04, y: 0.02 }, seccion: "d" }])))).toContain("barra/longitud-nula");
    expect(codigos(compilar(extremos(BARRAS_EXTREMOS, [{ tipo: "barra", id: "qb", caso: "Q", barra: "b1", ejes: "global", q: [0, 0, -1], desde: 1, hasta: 9 }])))).toContain("carga/fuera-de-pieza");
    expect(codigos(compilar(extremos(BARRAS_EXTREMOS, [{ tipo: "barra", id: "qb", caso: "Q", barra: "zz", ejes: "global", q: [0, 0, -1] }])))).toContain("fisico/referencia");
    expect(codigos(compilar(extremos([b("x", [0, 0], [3, 0], { seccion: "nada" })])))).toContain("fisico/referencia");
  });
});

/** Pórtico de A (0, 0) y B (4, 0), de C a P1, con vigas en las dos plantas, sin diafragmas; las barras y las cargas, dadas. */
function portico(barras: Barra[], cargas: CargaFisica[], secciones: ModeloFisico["secciones"] = []): ModeloFisico {
  return {
    plantas: PLANTAS,
    materiales: MATERIALES,
    secciones: [...SECCIONES, { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.4 }, { id: "r", material: "S", forma: "rectangular", b: 0.1, h: 0.2 }, ...secciones],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "B", x: 4, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    vigas: [
      { id: "W", planta: "C", puntos: [[0, 0], [4, 0]], seccion: "v" },
      { id: "V", planta: "P1", puntos: [[0, 0], [4, 0]], seccion: "v" },
    ],
    barras,
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "puntual", id: "H", caso: "Q", planta: "P1", x: 0, y: 0, F: [30, 12, 0] }, ...cargas],
  };
}
const puntal: Barra = { id: "P", inicio: { planta: "C", x: 2, y: 0 }, fin: { planta: "P1", x: 2, y: 0 }, seccion: "r" };
const diagonal: Barra = { id: "D", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 4, y: 0 }, seccion: "r" };
const enBarra = (barra: string, ejes: "global" | "local", q: [number, number, number]): CargaFisica => ({ tipo: "barra", id: `q${barra}`, caso: "Q", barra, ejes, q });

describe("BN: ejes locales (criterio 3)", () => {
  const igual = (a: ModeloFisico, b: ModeloFisico) => {
    const c = compararModelos(valido(compilar(a)).modelo, valido(compilar(b)).modelo);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-12);
    expect(c.reacciones, c.porCaso.join("; ")).toBeLessThan(1e-12);
  };
  it("vertical: y local es −Y; con giro 90°, +X; x, hacia arriba", () => {
    igual(portico([puntal], [enBarra("P", "local", [0, 1, 0])]), portico([puntal], [enBarra("P", "global", [0, -1, 0])]));
    igual(portico([{ ...puntal, giro: 90 }], [enBarra("P", "local", [0, 1, 0])]), portico([{ ...puntal, giro: 90 }], [enBarra("P", "global", [1, 0, 0])]));
    igual(portico([puntal], [enBarra("P", "local", [2, 0, 0])]), portico([puntal], [enBarra("P", "global", [0, 0, 2])]));
  });
  it("inclinada: z en el plano vertical y hacia arriba", () => {
    // x = (0,8; 0; 0,6) y z = (−0,6; 0; 0,8)
    igual(portico([diagonal], [enBarra("D", "local", [0, 0, -2])]), portico([diagonal], [enBarra("D", "global", [1.2, 0, -1.6])]));
    igual(portico([diagonal], [enBarra("D", "local", [1, 0, 0])]), portico([diagonal], [enBarra("D", "global", [0.8, 0, 0.6])]));
    igual(portico([diagonal], [enBarra("D", "local", [0, 1, 0])]), portico([diagonal], [enBarra("D", "global", [0, 1, 0])]));
  });
  it("un giro de 90° es la sección con b y h cambiados", () => {
    const r2: ModeloFisico["secciones"] = [{ id: "r2", material: "S", forma: "rectangular", b: 0.2, h: 0.1 }];
    igual(portico([{ ...diagonal, giro: 90 }], []), portico([{ ...diagonal, seccion: "r2" }], [], r2));
    igual(portico([{ ...puntal, giro: 90 }], []), portico([{ ...puntal, seccion: "r2" }], [], r2));
  });
});

describe("BN: zona rígida (criterio 4)", () => {
  // Pilar A de 40 × 40 en (0, 0) y diagonal a 45° hasta B (3, 0) en P1: 0,2 m en planta dentro de A y 0,15 en B
  const modelo = (material: string): ModeloFisico => ({
    plantas: PLANTAS,
    materiales: MATERIALES,
    secciones: [
      { id: "p40", material, forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "d", material: "S", forma: "circular", D: 0.05 },
    ],
    pilares: [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
      { id: "B", x: 3, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    barras: [{ id: "D", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 3, y: 0 }, seccion: "d" }],
    casos: [{ id: "Q" }],
  });
  it("en hormigón, hasta la cara", () => {
    const r = valido(compilar(modelo("HA")));
    const s = r.mapeo.barras[r.mapeo.piezas.D![0]!]!.s;
    expect(s[1]).toBeCloseTo(0.2 * Math.SQRT2, 14);
    expect(s[3] - s[2]).toBeCloseTo(0.15 * Math.SQRT2, 14);
  });
  it("en acero, ninguna", () => {
    const r = valido(compilar(modelo("S")));
    const s = r.mapeo.barras[r.mapeo.piezas.D![0]!]!.s;
    expect(s[1]).toBe(0);
    expect(s[3] - s[2]).toBeCloseTo(0.15 * Math.SQRT2, 14);
  });

  // A2-9: la huella del tramo de pilar del lado por el que sale la barra
  const tres: ModeloFisico["plantas"] = [{ id: "P2", altura: null }, { id: "P1", altura: 3 }, { id: "C", tipo: "sotano", altura: 3 }];
  const secciones: ModeloFisico["secciones"] = [
    { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
    { id: "heb", material: "S", forma: "rectangular", b: 0.2, h: 0.2 },
    { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    { id: "d", material: "S", forma: "circular", D: 0.05 },
  ];
  it("una barra que sube desde la cabeza de un pilar que acaba ahí no tiene zona rígida (no hay pilar encima)", () => {
    // Antes, 1,22 m rígidos de 3,04: la huella del nudo se tomaba como un prisma sin fin
    const r = valido(
      compilar({
        plantas: tres,
        materiales: MATERIALES,
        secciones,
        pilares: [
          { id: "A", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
          { id: "B", x: 4, y: 0, desde: "C", hasta: "P2", seccion: "p40" },
          { id: "E", x: -4, y: 0, desde: "C", hasta: "P2", seccion: "p40" },
        ],
        vigas: [{ id: "V2", planta: "P2", puntos: [[-4, 0], [4, 0]], seccion: "v" }],
        barras: [{ id: "T", inicio: { planta: "P1", x: 0, y: 0 }, fin: { planta: "P2", x: 0.5, y: 0 }, seccion: "d" }],
        casos: [{ id: "Q" }],
      }),
    );
    expect(r.mapeo.barras[r.mapeo.piezas.T![0]!]!.s[1]).toBe(0);
  });
  it("con un pilar de hormigón abajo y uno de acero arriba en el mismo nudo, cuenta el del lado de la barra, con cualquier id", () => {
    const con = (abajo: string, arriba: string) =>
      valido(
        compilar({
          plantas: tres,
          materiales: MATERIALES,
          secciones,
          pilares: [
            { id: abajo, x: 4, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
            { id: arriba, x: 4, y: 0, desde: "P1", hasta: "P2", seccion: "heb", base: "ninguno" },
            { id: "O", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "p40" },
          ],
          barras: [{ id: "D", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 4, y: 0 }, seccion: "d" }],
          casos: [{ id: "Q" }],
        }),
      ).mapeo.barras;
    // La diagonal llega a P1 desde abajo: la zona rígida del pilar de hormigón de 40 (0,2 m en planta)
    for (const ids of [["A", "Z"], ["Z", "A"]] as const) {
      const bs = con(...ids);
      const s = bs.find((x) => x.tipo === "barra")!.s;
      expect(s[3] - s[2], ids.join("/")).toBeCloseTo(0.2 * Math.hypot(4, 3) / 4, 12);
    }
  });
});

describe("BN: metamórficas (criterio 5)", () => {
  const cruz: Barra[] = [diagonal, { id: "E", inicio: { planta: "C", x: 4, y: 0 }, fin: { planta: "P1", x: 0, y: 0 }, seccion: "r" }, puntal];
  const cargas: CargaFisica[] = [enBarra("D", "local", [0.5, 0.3, -2]), { ...enBarra("E", "global", [1, -2, 0.5]), desde: 0.5, hasta: 2 } as CargaFisica, enBarra("P", "global", [0.4, 0.2, 0])];
  it("trasladar y girar el pórtico", () => {
    for (const { nombre, t } of planos()) {
      const e = relacionPlano(portico(cruz, cargas), t);
      expect(e.u, nombre).toBeLessThan(1e-12);
      expect(e.reacciones, nombre).toBeLessThan(1e-12);
      expect(e.barras, nombre).toBeLessThan(1e-12);
    }
  });
  it("trasladar y girar el modelo con losa, viga y muro", () => {
    for (const { nombre, t } of planos()) {
      const e = relacionPlanoC2(extremos(), t);
      expect(e.mismaMalla, nombre).toBe(true);
      expect(e.u, nombre).toBeLessThan(1e-9);
      expect(e.reacciones, nombre).toBeLessThan(1e-9);
    }
  });
  it("invertir las barras inclinadas: los mismos desplazamientos y los esfuerzos de extremo cruzados", () => {
    const inclinadas = cruz.filter((x) => x.id !== "P");
    const deInclinadas = cargas.filter((c) => c.tipo !== "barra" || c.barra !== "P");
    const invertida = (x: Barra): Barra => ({ ...x, inicio: x.fin, fin: x.inicio, ...(x.liberaciones ? { liberaciones: { inicio: x.liberaciones.fin, fin: x.liberaciones.inicio } } : {}) });
    // Invertida, x cambia de sentido, z sigue en el plano vertical hacia arriba e y cambia de signo
    const invertidas = deInclinadas.map((c): CargaFisica => {
      if (c.tipo !== "barra") return c;
      const flip = (q: readonly number[]): [number, number, number] => (c.ejes === "local" ? [-q[0]!, -q[1]!, q[2]!] : [q[0]!, q[1]!, q[2]!]);
      return { ...c, q: flip(c.qb ?? c.q), ...(c.qb ? { qb: flip(c.q) } : {}), ...(c.hasta !== undefined ? { desde: 5 - c.hasta } : {}), ...(c.desde !== undefined ? { hasta: 5 - c.desde } : {}) };
    });
    const a = valido(compilar(portico(inclinadas, deInclinadas)));
    const bb = valido(compilar(portico(inclinadas.map(invertida), invertidas)));
    const [ra, rb] = [casosValidos(calcular(a.modelo, { solver: "perfil" })), casosValidos(calcular(bb.modelo, { solver: "perfil" }))];
    const pares = emparejar(a.modelo, bb.modelo, (q) => q, 1e-9);
    const id = (q: readonly number[]): [number, number, number] => [q[0]!, q[1]!, q[2]!];
    expect(errorNudos(ra, rb, pares, id, "u")).toBeLessThan(1e-12);
    expect(errorBarras(a, bb, ra, rb, pares, true, ["barra"])).toBeLessThan(1e-12);
  });
  it("reordenar las listas da el mismo modelo, mapeo y diagnósticos, bit a bit", () => {
    const f = extremos();
    const a = valido(compilar(f));
    for (let semilla = 1; semilla <= 3; semilla++) {
      const r = azar(semilla);
      const x = valido(compilar({ ...f, barras: barajar(f.barras!, r), cargas: barajar(f.cargas!, r), pilares: barajar(f.pilares!, r) }));
      expect(JSON.stringify(x.modelo)).toBe(JSON.stringify(a.modelo));
      expect(JSON.stringify(x.mapeo)).toBe(JSON.stringify(a.mapeo));
      expect(JSON.stringify(x.diagnosticos)).toBe(JSON.stringify(a.diagnosticos));
    }
  });
});
