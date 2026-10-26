/**
 * Mover, copiar, girar, simetría y pinzamientos (V2c-3, `docs/fem3d/dibujo.md` §9):
 * - lo exacto: con los números de la tabla, mover, girar 90° y la simetría por un eje paralelo a X o a
 *   Y dan los números de la tabla; lo transformado es lo que se escribiría en ella (criterio 1);
 * - el giro y el punto fijo de los pilares: la huella transformada es la huella del pilar que sale;
 * - con sus cargas, las vigas unidas a los pilares (V2c-d) y las coacciones de los apoyos;
 * - ida y vuelta (mover y volver, girar cuatro veces 90°, dos simetrías) y deshacer dejan los bytes en
 *   los modelos de referencia (criterio 4);
 * - metamórfica: un modelo entero girado 90° da los mismos desplazamientos y reacciones girados; con
 *   la simetría, la misma estructura reflejada;
 * - los pinzamientos: un vértice, con las estaciones vueltas a medir.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { huellaSeccion } from "../agente/render/modelo.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { CargaFisica, ModeloFisico, Pilar, Vec2 } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { emparejarTodos } from "../pruebas/metamorficasFisicas.ts";
import { reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../../validacion/c4/modelos.ts";
import { deshacer, hacer, historial } from "./historial.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { COLECCIONES, lista } from "./referencias.ts";
import { serializar } from "./serializar.ts";
import { leerEjemplo } from "./serializar.test.ts";
import { asas, moverAsa, transformar, Transformador, type OpcionesTransformar, type Transformacion } from "./transformar.ts";

const RAIZ = join(__dirname, "..", "..");
/** Reacciones del modelo reflejado frente a las reflejadas: la malla de las losas no es la misma (medido: 6,1e-4 con la retícula con núcleo; sin losas, 1,6e-14). */
const TOL_REFLEJADO = 1e-3;
const proyecto = (modelo: ModeloFisico): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo });

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function aplicado(p: Proyecto, o: Operacion): Proyecto {
  const a = aplicar(p, o);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" | "));
  return a.proyecto;
}

function transformado(m: ModeloFisico, ids: readonly string[], t: Transformacion, o: OpcionesTransformar = {}): { modelo: ModeloFisico; avisos: string[]; nuevos: string[] } {
  const r = transformar(m, ids, t, o);
  if (!r.ok) throw new Error(r.mensaje);
  return { modelo: aplicado(proyecto(m), r.operacion).modelo, avisos: r.avisos, nuevos: r.nuevos };
}

/** Todo lo que tiene geometría. */
const todo = (m: ModeloFisico) => COLECCIONES.filter((c) => !["plantas", "materiales", "secciones", "casos"].includes(c)).flatMap((c) => lista(m, c).map((o) => o.id));

const HA = { id: "HA", tipo: "hormigon" as const, fck: 25 };

/** Un pórtico pequeño: dos pilares, una viga entre ellos con una carga en un tramo, una losa y un apoyo. */
function portico(): ModeloFisico {
  return {
    plantas: [{ id: "N1", altura: null }, { id: "N0", altura: 3 }],
    materiales: [HA],
    secciones: [
      { id: "p30x50", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "v30", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "t", material: "HA", forma: "T", bf: 0.6, hf: 0.15, bw: 0.25, h: 0.5 },
    ],
    pilares: [
      { id: "P1", x: 0, y: 0, desde: "N0", hasta: "N1", seccion: "p30x50", fijo: "esquina-superior-derecha" },
      { id: "P2", x: 6, y: 0, desde: "N0", hasta: "N1", seccion: "p30x50" },
    ],
    vigas: [
      { id: "V1", planta: "N1", puntos: [[0, 0], [6, 0]], seccion: "v30" },
      { id: "V2", planta: "N1", puntos: [[6, 0], [6, 4.3]], seccion: "v30" },
    ],
    losas: [{ id: "L1", planta: "N1", contorno: [[0, 0], [6, 0], [6, 4.3], [0, 4.3]], espesor: 0.25, material: "HA" }],
    apoyos: [{ id: "A1", planta: "N1", x: 0, y: 4.3, coartados: [true, false, true, false, false, false] }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "viga", id: "QV", caso: "Q", viga: "V1", ejes: "global", q: [1.5, 0, -5], desde: 1.2, hasta: 4.3 },
      { tipo: "viga", id: "QL", caso: "Q", viga: "V2", ejes: "local", q: [0, 2, -3] },
      { tipo: "superficie", id: "QS", caso: "Q", planta: "N1", losa: "L1", q: [0, 0, -2] },
      { tipo: "puntual", id: "QP", caso: "Q", planta: "N1", x: 4.3, y: 2.7, F: [3, 0, -10], M: [0, 2, 1] },
    ],
  };
}

/** Los puntos de una huella, para comparar sin el orden. */
function anillo(p: Pilar, m: ModeloFisico): Vec2[] {
  const h = huellaSeccion(p, m.secciones.find((s) => s.id === p.seccion));
  if (!h || !("anillo" in h)) throw new Error("sin huella");
  return h.anillo;
}
function mismosPuntos(a: readonly Vec2[], b: readonly Vec2[], tol = 1e-12): boolean {
  return a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol));
}

describe("Transformador: exacto con los números de la tabla", () => {
  it("mover: la coordenada del punto base va a la del destino; las demás, sin el ruido de la suma", () => {
    const tr = new Transformador({ tipo: "mover", de: [6, 0], a: [12.3, 0] });
    expect(tr.punto([4.3, 2.7])).toEqual([10.6, 2.7]);
    expect(tr.punto([6, 5])).toEqual([12.3, 5]);
    expect(tr.punto([1.1, 0])).toEqual([7.4, 0]);
    const p: Vec2 = [1, 1];
    expect(new Transformador({ tipo: "mover", de: [2, 2], a: [2, 2] }).punto(p)).toBe(p);
  });

  it("girar 90°, 180° y 270° sin senos; a otro ángulo, con ellos", () => {
    expect(new Transformador({ tipo: "girar", centro: [6, 4], angulo: 90 }).punto([10.3, 4])).toEqual([6, 8.3]);
    expect(new Transformador({ tipo: "girar", centro: [6, 4], angulo: 180 }).punto([10.3, 4.1])).toEqual([1.7, 3.9]);
    expect(new Transformador({ tipo: "girar", centro: [0, 0], angulo: -90 }).punto([2.5, 1.2])).toEqual([1.2, -2.5]);
    const q = new Transformador({ tipo: "girar", centro: [0, 0], angulo: 30 }).punto([2, 0]);
    expect(q[0]).toBeCloseTo(Math.sqrt(3), 12);
    expect(q[1]).toBeCloseTo(1, 12);
  });

  it("simetría por un eje paralelo a Y, a X o a 45°", () => {
    expect(new Transformador({ tipo: "simetria", a: [6, 0], b: [6, 10] }).punto([4.3, 2])).toEqual([7.7, 2]);
    expect(new Transformador({ tipo: "simetria", a: [0, 2.5], b: [8, 2.5] }).punto([1, 4.3])).toEqual([1, 0.7]);
    expect(new Transformador({ tipo: "simetria", a: [0, 0], b: [2, 2] }).punto([3, 1.5])).toEqual([1.5, 3]);
  });

  it("las direcciones y los vectores", () => {
    const g = new Transformador({ tipo: "girar", centro: [0, 0], angulo: 90 });
    expect(g.direccion(30)).toBe(120);
    expect(g.vector3([3, 0, -10])).toEqual([0, 3, -10]);
    const s = new Transformador({ tipo: "simetria", a: [0, 0], b: [1, 0] });
    expect(s.direccion(30)).toBe(-30);
    expect(s.vector3([3, 2, -10])).toEqual([3, -2, -10]);
    // Un momento es un pseudovector: reflejado y con el signo cambiado
    expect(s.momento([1, 2, 3])).toEqual([-1, 2, -3]);
  });
});

describe("lo transformado es lo que se escribiría en la tabla (criterio 1)", () => {
  it("copiar un pilar es crear otro con su punto desplazado", () => {
    const m = portico();
    const { modelo, nuevos } = transformado(m, ["P1"], { tipo: "mover", de: [6, 0], a: [12.3, 2] }, { copiar: true });
    expect(nuevos).toEqual(["P3"]);
    expect(modelo.pilares!.at(-1)).toEqual({ id: "P3", x: 6.3, y: 2, desde: "N0", hasta: "N1", seccion: "p30x50", fijo: "esquina-superior-derecha" });
    expect(modelo.pilares!.slice(0, 2)).toEqual(m.pilares);
  });

  it("el giro y el punto fijo de un pilar: la huella que sale es la huella girada o reflejada", () => {
    const m = portico();
    const P1 = m.pilares![0]!;
    const casos: [Transformacion, Partial<Pilar>][] = [
      [{ tipo: "girar", centro: [0, 0], angulo: 90 }, { giro: 90, fijo: "esquina-superior-derecha" }],
      [{ tipo: "girar", centro: [1, 1], angulo: 180 }, { fijo: "esquina-inferior-izquierda" }],
      [{ tipo: "girar", centro: [0, 0], angulo: 270 }, { giro: 90, fijo: "esquina-inferior-izquierda" }],
      [{ tipo: "simetria", a: [3, 0], b: [3, 1] }, { fijo: "esquina-superior-izquierda" }],
      [{ tipo: "simetria", a: [0, 2], b: [1, 2] }, { fijo: "esquina-inferior-derecha" }],
      [{ tipo: "simetria", a: [0, 0], b: [1, 1] }, { giro: 90, fijo: "esquina-inferior-derecha" }],
    ];
    for (const [t, esperado] of casos) {
      const n = transformado(m, ["P1"], t, { conVigas: false }).modelo.pilares![0]!;
      const tr = new Transformador(t);
      expect(n, JSON.stringify(t)).toMatchObject({ x: tr.punto([0, 0])[0], y: tr.punto([0, 0])[1], ...esperado });
      if (!esperado.giro) expect(n.giro).toBeUndefined();
      expect(mismosPuntos(anillo(n, m), anillo(P1, m).map((p) => tr.punto(p))), JSON.stringify(t)).toBe(true);
    }
  });

  it("una T no es simétrica respecto a su centro: girada 180° conserva el giro", () => {
    const m = portico();
    const conT: ModeloFisico = { ...m, pilares: [{ ...m.pilares![1]!, seccion: "t", giro: 30 }] };
    const n = transformado(conT, ["P2"], { tipo: "girar", centro: [0, 0], angulo: 180 }).modelo.pilares![0]!;
    expect(n.giro).toBe(210);
    expect(n.fijo).toBeUndefined();
  });

  it("copiar una viga a otra planta lleva sus cargas, que apuntan a la copia", () => {
    const m: ModeloFisico = { ...portico(), plantas: [{ id: "N2", altura: null }, { id: "N1", altura: 3 }, { id: "N0", altura: 3 }] };
    const { modelo, nuevos } = transformado(m, ["V1"], { tipo: "mover", de: [0, 0], a: [0, 4.3] }, { copiar: true, plantas: ["N1", "N2"] });
    expect(nuevos).toEqual(["V3", "V4", "Q1", "Q2"]);
    expect(modelo.vigas!.slice(2)).toEqual([
      { id: "V3", planta: "N1", puntos: [[0, 4.3], [6, 4.3]], seccion: "v30" },
      { id: "V4", planta: "N2", puntos: [[0, 4.3], [6, 4.3]], seccion: "v30" },
    ]);
    expect(modelo.cargas!.slice(4)).toEqual([
      { tipo: "viga", id: "Q1", caso: "Q", viga: "V3", ejes: "global", q: [1.5, 0, -5], desde: 1.2, hasta: 4.3 },
      { tipo: "viga", id: "Q2", caso: "Q", viga: "V4", ejes: "global", q: [1.5, 0, -5], desde: 1.2, hasta: 4.3 },
    ]);
  });

  it("copiar en su sitio a otra planta (desplazamiento nulo) es copiar a plantas; en la suya, no se copia", () => {
    const m: ModeloFisico = { ...portico(), plantas: [{ id: "N2", altura: null }, { id: "N1", altura: 3 }, { id: "N0", altura: 3 }] };
    const t: Transformacion = { tipo: "mover", de: [1, 1], a: [1, 1] };
    const r = transformado(m, ["L1"], t, { copiar: true, plantas: ["N2"] });
    expect(r.modelo.losas!.at(-1)).toEqual({ ...m.losas![0], id: "L2", planta: "N2" });
    expect(r.modelo.cargas!.at(-1)).toEqual({ ...m.cargas![2], id: "Q1", losa: "L2", planta: "N2" });
    expect(transformar(m, ["L1"], t, { copiar: true })).toEqual({ ok: false, mensaje: "El destino es el punto base: la copia caería encima de lo copiado." });
  });

  it("girar lleva las cargas: las fuerzas horizontales globales giran, las locales no; la losa gira su eje 1", () => {
    const m = portico();
    const { modelo } = transformado(m, ["V1", "V2", "L1", "QP", "A1"], { tipo: "girar", centro: [0, 0], angulo: 90 }, { conVigas: false });
    const c = (id: string) => modelo.cargas!.find((x) => x.id === id)!;
    expect(c("QV")).toMatchObject({ q: [0, 1.5, -5], desde: 1.2, hasta: 4.3 });
    expect(c("QL")).toEqual(m.cargas![1]);
    expect(c("QP")).toEqual({ tipo: "puntual", id: "QP", caso: "Q", planta: "N1", x: -2.7, y: 4.3, F: [0, 3, -10], M: [-2, 0, 1] });
    expect(modelo.losas![0]).toEqual({ ...m.losas![0], contorno: [[0, 0], [0, 6], [-4.3, 6], [-4.3, 0]], eje1: 90 });
    // El apoyo coacciona ux: girado 90°, uy
    expect(modelo.apoyos![0]).toEqual({ id: "A1", planta: "N1", x: -4.3, y: 0, coartados: [false, true, true, false, false, false] });
  });

  it("la simetría cambia el signo de la componente y local, refleja los momentos y cambia el lado de los empujes", () => {
    const m = portico();
    const { modelo } = transformado(m, ["V2", "QP"], { tipo: "simetria", a: [3, 0], b: [3, 1] }, { conVigas: false });
    expect(modelo.cargas!.find((x) => x.id === "QL")).toMatchObject({ q: [0, -2, -3] });
    expect(modelo.cargas!.find((x) => x.id === "QP")).toMatchObject({ x: 1.7, y: 2.7, F: [-3, 0, -10], M: [0, -2, -1] });
    const nucleo = reticulaConNucleo();
    const conEmpuje: ModeloFisico = { ...nucleo, cargas: [...(nucleo.cargas ?? []), { tipo: "empuje", id: "E1", caso: nucleo.casos[0]!.id, muro: "NUCLEO", lado: "izquierdo", z0: 0, z1: 3, p0: 10, p1: 0 }] };
    const r = transformado(conEmpuje, ["NUCLEO"], { tipo: "simetria", a: [9, 0], b: [9, 1] });
    expect(r.modelo.cargas!.find((x) => x.id === "E1")).toMatchObject({ lado: "derecho" });
  });

  it("un apoyo que coacciona ux sin uy no se puede girar 30°: se queda y se avisa", () => {
    const r = transformar(portico(), ["A1"], { tipo: "girar", centro: [0, 0], angulo: 30 });
    expect(r.ok && r.avisos).toEqual(["A1 coacciona ux y uy (o rx y ry) de forma distinta, en ejes globales: sus coacciones no se pueden girar 30° y se quedan como estaban."]);
  });
});

describe("las vigas unidas a los pilares (V2c-d)", () => {
  it("al mover un pilar, el extremo de sus vigas lo sigue; con conVigas false, no y se avisa", () => {
    const m = portico();
    const t: Transformacion = { tipo: "mover", de: [6, 0], a: [6.5, 0.25] };
    const con = transformado(m, ["P2"], t).modelo;
    expect(con.vigas!.map((v) => v.puntos)).toEqual([
      [[0, 0], [6.5, 0.25]],
      [[6.5, 0.25], [6, 4.3]],
    ]);
    const sin = transformado(m, ["P2"], t, { conVigas: false });
    expect(sin.modelo.vigas).toEqual(m.vigas);
    expect(sin.avisos).toEqual(["Las vigas V1 y V2 acaban en un pilar que se mueve y se quedan donde estaban."]);
  });

  it("girar dos pilares alrededor de uno arrastra la viga entera aunque no esté elegida", () => {
    const m = portico();
    const { modelo } = transformado(m, ["P1", "P2"], { tipo: "girar", centro: [0, 0], angulo: 90 });
    expect(modelo.vigas![0]!.puntos).toEqual([[0, 0], [0, 6]]);
    expect(modelo.vigas![1]!.puntos).toEqual([[0, 6], [6, 4.3]]);
  });

  it("una carga en barra elegida sin su viga se mueve con la viga: se avisa", () => {
    const r = transformar(portico(), ["QV", "QP"], { tipo: "mover", de: [0, 0], a: [1, 0] });
    expect(r.ok && r.avisos).toEqual(["QV va sobre una pieza que no está elegida: se mueve con ella."]);
  });
});

// ─── Ida y vuelta en los modelos de referencia (criterio 4) ─────────────────────────────────────

function referencias(): [string, Proyecto][] {
  const vivienda = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!vivienda.valido) throw new Error("vivienda");
  return [
    ["1-022", leerEjemplo("1022").proyecto],
    ["reticula enrasada (C2)", proyecto(reticulaEnrasada())],
    ["reticula con nucleo (C3)", proyecto(reticulaConNucleo())],
    ["reticular (C4)", proyecto(edificioReticular(2, 3, 2))],
    ["unidireccional (C4)", proyecto(edificioUnidireccional(2, 3, 2))],
    ["vivienda", vivienda.proyecto],
  ];
}

/**
 * Sin el giro 0 de los pilares ni el eje1 0 de las losas escritos: un giro que vuelve a 0 no lo
 * escribe (como la tabla con la celda vacía, V2c2-3), así que la ida y vuelta sólo deja los bytes
 * de lo que no los escribe.
 */
function sinDefectos(p: Proyecto): Proyecto {
  const m = p.modelo;
  return {
    ...p,
    modelo: {
      ...m,
      ...(m.pilares ? { pilares: m.pilares.map(({ giro, ...x }) => (giro ? { ...x, giro } : x)) } : {}),
      ...(m.losas ? { losas: m.losas.map(({ eje1, ...x }) => (eje1 ? { ...x, eje1 } : x)) } : {}),
    },
  };
}

function encadenar(p: Proyecto, ts: readonly Transformacion[]): Proyecto {
  let q = p;
  for (const t of ts) {
    const r = transformar(q.modelo, todo(q.modelo), t);
    // Una simetría por un eje en el que está todo (un pórtico plano por y = 0) no cambia nada
    if (!r.ok && r.mensaje === "La transformación no cambia nada.") continue;
    if (!r.ok) throw new Error(r.mensaje);
    q = aplicado(q, r.operacion);
  }
  return q;
}

describe("ida y vuelta dejan los bytes (criterio 4)", () => {
  it.each(referencias())("%s: mover y volver, girar 4 × 90°, dos simetrías y deshacer", (_n, original) => {
    const p = sinDefectos(original);
    const ida: Transformacion = { tipo: "mover", de: [0, 0], a: [3.25, -1.4] };
    const vuelta: Transformacion = { tipo: "mover", de: [3.25, -1.4], a: [0, 0] };
    expect(serializar(encadenar(p, [ida, vuelta]))).toBe(serializar(p));
    const g: Transformacion = { tipo: "girar", centro: [0, 0], angulo: 90 };
    const girado = encadenar(p, [g]);
    expect(serializar(girado)).not.toBe(serializar(p));
    expect(serializar(encadenar(girado, [g, g, g]))).toBe(serializar(p));
    for (const s of [
      { tipo: "simetria", a: [0, 0], b: [0, 1] },
      { tipo: "simetria", a: [0, 0], b: [1, 0] },
      { tipo: "simetria", a: [0, 0], b: [1, 1] },
    ] as Transformacion[])
      expect(serializar(encadenar(p, [s, s])), JSON.stringify(s)).toBe(serializar(p));
    // Una acción, un paso de deshacer
    expect(serializar(deshacer(hacer(historial(p), girado, "girar")).actual)).toBe(serializar(p));
  });
});

// ─── Metamórfica: el modelo entero girado o reflejado ───────────────────────────────────────────

type Resultados = ReturnType<typeof resultados>;

/** Compilado y calculado. */
function resultados(m: ModeloFisico) {
  const c = compilar(m);
  if (!c.valido) throw new Error(c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join(" | "));
  return { c, casos: casosValidos(calcular(c.modelo)) };
}

/**
 * Peor error relativo de lo transformado de A frente a B en los nudos emparejados, por caso y por
 * grupo (traslaciones como vectores, giros como pseudovectores), como `errorU` de las metamórficas
 * del compilador.
 */
function errorTransformado(a: Resultados, b: Resultados, pares: Map<number, number>, tr: Transformador, campo: "u" | "reacciones"): number {
  let peor = 0;
  for (const g of [0, 3]) {
    a.casos.forEach((ca, k) => {
      let [dif, ref] = [0, 0];
      for (const [i, j] of pares) {
        const v = Array.from(ca[campo].subarray(6 * i + g, 6 * i + g + 3)) as [number, number, number];
        const t = g ? tr.momento(v, false) : tr.vector3(v, false);
        for (let x = 0; x < 3; x++) {
          dif = Math.max(dif, Math.abs(t[x]! - b.casos[k]![campo][6 * j + g + x]!));
          ref = Math.max(ref, Math.abs(b.casos[k]![campo][6 * j + g + x]!));
        }
      }
      peor = Math.max(peor, ref > 0 ? dif / ref : dif);
    });
  }
  return peor;
}

/** Las reacciones de los apoyos sumadas por punto (en un punto puede haber varios nudos: el pie de un pilar y el de un muro), con el punto llevado por `f`. */
function reaccionesPorPunto(x: Resultados, f: (q: Vec2) => Vec2): Map<string, number[][]> {
  const r = new Map<string, number[][]>();
  for (const { nudo } of x.c.modelo.apoyos ?? []) {
    const n = x.c.modelo.nudos[nudo]!;
    const q = f([n.x, n.y]);
    const k = `${Math.round(q[0] * 1e6)} ${Math.round(q[1] * 1e6)} ${n.z}`;
    const v = r.get(k) ?? x.casos.map(() => [0, 0, 0, 0, 0, 0]);
    x.casos.forEach((c, kk) => {
      for (let g = 0; g < 6; g++) v[kk]![g]! += c.reacciones[6 * nudo + g]!;
    });
    r.set(k, v);
  }
  return r;
}

describe("metamórfica: el modelo entero transformado", () => {
  const modelos: [string, () => ModeloFisico][] = [
    ["reticula con nucleo (C3)", reticulaConNucleo],
    ["unidireccional (C4)", () => edificioUnidireccional(2, 3, 2)],
  ];
  const exactas: [string, Transformacion][] = [
    ["movido", { tipo: "mover", de: [0, 0], a: [123.4, -56.7] }],
    ["girado 90°", { tipo: "girar", centro: [3, 2], angulo: 90 }],
    ["girado 180°", { tipo: "girar", centro: [0, 0], angulo: 180 }],
  ];
  for (const [nombre, f] of modelos)
    for (const [tn, t] of exactas)
      it(`${nombre}, ${tn}: la misma malla, y los desplazamientos y las reacciones transformados a 1e-9`, () => {
        const m = f();
        const tr = new Transformador(t);
        const [a, b] = [resultados(m), resultados(transformado(m, todo(m), t).modelo)];
        expect(b.c.modelo.nudos.length).toBe(a.c.modelo.nudos.length);
        expect((b.c.modelo.laminas ?? []).length).toBe((a.c.modelo.laminas ?? []).length);
        expect((b.c.modelo.barras ?? []).length).toBe((a.c.modelo.barras ?? []).length);
        const pares = emparejarTodos(a.c.modelo, b.c.modelo, (q) => tr.punto(q), 1e-6);
        expect(errorTransformado(a, b, pares, tr, "u")).toBeLessThan(1e-9);
        expect(errorTransformado(a, b, pares, tr, "reacciones")).toBeLessThan(1e-9);
      });

  for (const [nombre, f] of modelos)
    it(`${nombre}, reflejado: las reacciones de los apoyos, las reflejadas a la tolerancia de la malla`, () => {
      const m = f();
      const t: Transformacion = { tipo: "simetria", a: [0, 0], b: [0, 1] };
      const tr = new Transformador(t);
      const [a, b] = [resultados(m), resultados(transformado(m, todo(m), t).modelo)];
      // La malla de un forjado no es simétrica (los empates de Delaunay se deshacen en los ejes de la
      // losa, C2-3): se comparan las reacciones de los apoyos, que están en los pilares y los muros
      const [ra, rb] = [reaccionesPorPunto(a, (q) => tr.punto(q)), reaccionesPorPunto(b, (q) => q)];
      expect([...ra.keys()].sort()).toEqual([...rb.keys()].sort());
      let peor = 0;
      a.casos.forEach((_, k) => {
        for (const g of [0, 3]) {
          let [dif, ref] = [0, 0];
          for (const [p, v] of ra) {
            const x = v[k]!.slice(g, g + 3) as [number, number, number];
            const e = g ? tr.momento(x, false) : tr.vector3(x, false);
            for (let i = 0; i < 3; i++) {
              dif = Math.max(dif, Math.abs(e[i]! - rb.get(p)![k]![g + i]!));
              ref = Math.max(ref, Math.abs(rb.get(p)![k]![g + i]!));
            }
          }
          peor = Math.max(peor, dif / ref);
        }
      });
      expect(peor).toBeLessThan(TOL_REFLEJADO);
    });
});

// ─── Pinzamientos ───────────────────────────────────────────────────────────────────────────────

describe("pinzamientos", () => {
  it("los vértices de lo elegido en la planta", () => {
    const m = portico();
    const a = asas(m, ["P1", "V1", "L1", "A1", "QP", "G"], "N1");
    expect(a.map((x) => `${x.id} ${x.ruta.join(".")}`)).toEqual(["P1 x", "V1 puntos.0", "V1 puntos.1", "L1 contorno.0", "L1 contorno.1", "L1 contorno.2", "L1 contorno.3", "A1 x", "QP x"]);
    expect(asas(m, ["V1"], "N0")).toEqual([]);
    // Un muro cerrado: un asa para el primero y el último
    expect(asas(reticulaConNucleo(), ["NUCLEO"], "N1").length).toBe(4);
  });

  it("mover el vértice de una viga vuelve a medir sus cargas en un tramo", () => {
    const m = portico();
    const a = asas(m, ["V1"], "N1")[1]!;
    const r = moverAsa(m, a, [9, 0]);
    if (!r.ok) throw new Error(r.mensaje);
    const n = aplicado(proyecto(m), r.operacion).modelo;
    expect(n.vigas![0]!.puntos).toEqual([[0, 0], [9, 0]]);
    expect(n.cargas!.find((c) => c.id === "QV")).toMatchObject({ desde: 1.8, hasta: 6.45 });
  });

  it("el primer vértice de un muro cerrado lleva el último; sus huecos se vuelven a medir", () => {
    const m = reticulaConNucleo();
    const a = asas(m, ["NUCLEO"], "N1")[0]!;
    const r = moverAsa(m, a, [6, 4]);
    if (!r.ok) throw new Error(r.mensaje);
    const n = aplicado(proyecto(m), r.operacion).modelo.muros!.find((x) => x.id === "NUCLEO")!;
    expect(n.puntos[0]).toEqual([6, 4]);
    expect(n.puntos.at(-1)).toEqual([6, 4]);
    expect(n.huecos![0]!.desde).toBeCloseTo((2.4 / 6) * Math.hypot(6, 1), 8);
  });

  it("el punto de un pilar lo mueve con sus vigas (como CT3); los errores", () => {
    const m = portico();
    const a = asas(m, ["P2"], "N1")[0]!;
    const r = moverAsa(m, a, [6.5, 0]);
    expect(r.ok && aplicado(proyecto(m), r.operacion).modelo.vigas![1]!.puntos[0]).toEqual([6.5, 0]);
    expect(moverAsa(m, a, [6, 0])).toEqual({ ok: false, mensaje: "El punto no se ha movido." });
    const v = asas(m, ["V1"], "N1")[1]!;
    expect(moverAsa(m, v, [0, 0])).toEqual({ ok: false, mensaje: "El punto cae encima de otro vértice de V1." });
    const l = asas(m, ["L1"], "N1")[0]!;
    expect(moverAsa(m, l, [6, 4.3])).toEqual({ ok: false, mensaje: "El punto cae encima de otro vértice de L1." });
  });
});

describe("los errores", () => {
  it("nada elegido, nada con geometría, un desplazamiento nulo o una planta que no hay", () => {
    const m = portico();
    const t: Transformacion = { tipo: "mover", de: [0, 0], a: [1, 0] };
    expect(transformar(m, [], t)).toEqual({ ok: false, mensaje: "No hay nada elegido." });
    expect(transformar(m, ["HA", "N1"], t)).toEqual({ ok: false, mensaje: "Lo elegido no tiene geometría que mover (elija pilares, vigas, forjados, muros, apoyos, cargas o ejes)." });
    expect(transformar(m, ["P1"], { tipo: "mover", de: [1, 1], a: [1, 1] })).toEqual({ ok: false, mensaje: "El destino es el punto base: no se mueve nada." });
    expect(transformar(m, ["P1"], { tipo: "girar", centro: [0, 0], angulo: 360 })).toEqual({ ok: false, mensaje: "Un giro de 0° no mueve nada." });
    expect(transformar(m, ["V1"], t, { copiar: true, plantas: ["N9"] })).toEqual({ ok: false, mensaje: "No hay ninguna planta «N9»." });
    const c = m.cargas as CargaFisica[];
    expect(c.length).toBe(4);
  });
});
