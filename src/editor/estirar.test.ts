/**
 * Estirar desde la cadena de cotas (CT2, `docs/fem3d/cotas.md` §2.2 y §4):
 * - criterio 2: una retícula generada con las luces L₁…Lₙ y estirada en un vano hasta L′ es, byte a
 *   byte, la generada con L′ (en planta ortogonal); en una girada, la misma geometría a 1e-9 y los
 *   mismos nudos al compilar;
 * - criterio 3: en los modelos de referencia, estirar y deshacer devuelve los bytes; estirado,
 *   compila sin avisos nuevos de ε_snap, ajustes ni fusiones, y la carga de cada caso cambia lineal
 *   con Δ (sólo por el área nueva) y nada en las puntuales;
 * - el límite al acortar, el hueco de muro que cruza el corte y los ejes propuestos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cadenasDe, cotasCadena } from "../agente/render/ejes.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { resultanteAnalitica } from "../compilador/cargas.ts";
import { compilar } from "../compilador/compilar.ts";
import { ejesDe } from "../compilador/ejes.ts";
import type { CargaFisica, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { canonico } from "../compilador/huella.ts";
import { reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../../validacion/c4/modelos.ts";
import { limpio } from "./dibujo/cotas.ts";
import { afectados, corte, estirar, type Estiramiento } from "./estirar.ts";
import { deshacer, hacer, historial } from "./historial.ts";
import { aplicar } from "./operaciones.ts";
import { serializar } from "./serializar.ts";
import { leerEjemplo } from "./serializar.test.ts";

const RAIZ = join(__dirname, "..", "..");
const sumas = (ls: readonly number[]) => ls.reduce<number[]>((r, l) => [...r, limpio(r[r.length - 1]! + l)], [0]);
const L = (x: number) => limpio(x);

/**
 * Una retícula de 2 plantas y un sótano con luces lx × ly: pilares en los cruces, vigas por los ejes y
 * una alineada a la cara de una fila, losa con un hueco junto a un pilar, reticular con ábacos en la
 * de arriba, un muro con un hueco en la fachada x = 0, ejes guardados y cargas de todos los tipos.
 * Todo lo que no está en un eje se sitúa a ≤ 0,45 m de uno, así que va con él al estirar un vano de
 * más de 1,8 m. Girada `giro` grados alrededor del origen.
 */
function reticula(lx: readonly number[], ly: readonly number[], giro = 0): ModeloFisico {
  const xs = sumas(lx);
  const ys = sumas(ly);
  const [X, Y] = [xs[xs.length - 1]!, ys[ys.length - 1]!];
  const a = (giro * Math.PI) / 180;
  const R = (p: Vec2): Vec2 => (giro ? [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)] : p);
  const P = (x: number, y: number): Vec2 => R([L(x), L(y)]);
  const r = 0.15;
  const plantas = ["N2", "N1"];
  const vigas = plantas.flatMap((p) => [
    ...ys.map((y, j) => ({ id: `VX${j}-${p}`, planta: p, puntos: [P(-r, y), P(X + r, y)], seccion: "v30" })),
    ...xs.map((x, i) => ({ id: `VY${i}-${p}`, planta: p, puntos: [P(x, -r), P(x, Y + r)], seccion: "v30" })),
    // Alineada a la cara inferior de la fila 1 (V2c-b)
    { id: `VC-${p}`, planta: p, puntos: [P(xs[0]!, ys[1]! - 0.1), P(xs[1]!, ys[1]! - 0.1)], seccion: "v30" },
  ]);
  const abaco = (x: number, y: number) => [P(x - 0.45, y - 0.45), P(x + 0.45, y - 0.45), P(x + 0.45, y + 0.45), P(x - 0.45, y + 0.45)];
  const contorno = [P(-r, -r), P(X + r, -r), P(X + r, Y + r), P(-r, Y + r)];
  const cargas: CargaFisica[] = [
    { tipo: "superficie", id: "Q-N1", caso: "Q", planta: "N1", losa: "L-N1", q: [0, 0, -3] },
    { tipo: "superficie", id: "Z-N2", caso: "Q", planta: "N2", zona: [P(-r, -r), P(xs[1]! + 0.3, -r), P(xs[1]! + 0.3, Y + r), P(-r, Y + r)], q: [0, 0, -2] },
    { tipo: "lineal", id: "PET", caso: "G2", planta: "N2", puntos: [P(-r + 0.05, Y), P(X + r - 0.05, Y)], q: [0, 0, -4] },
    { tipo: "puntual", id: "PU", caso: "P", planta: "N1", x: R([L(xs[1]! + 0.2), L(ys[1]!)])[0], y: R([L(xs[1]! + 0.2), L(ys[1]!)])[1], F: [0, 0, -20] },
    // Parcial en la viga de y = 0 de N1: de 0,3 antes del eje 2 a 0,2 después del 3 (estaciones desde x = −0,15)
    { tipo: "viga", id: "QV", caso: "Q", viga: "VX0-N1", ejes: "global", q: [0, 0, -5], desde: L(xs[1]! - 0.3 + r), hasta: L(xs[Math.min(2, xs.length - 1)]! + 0.2 + r) },
  ];
  return {
    plantas: [{ id: "N2", altura: null }, { id: "N1", altura: 3 }, { id: "C", tipo: "sotano", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "v30", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: xs.flatMap((x, i) => ys.map((y, j) => ({ id: `P${i}-${j}`, x: P(x, y)[0], y: P(x, y)[1], desde: "C", hasta: "N2", seccion: "p40", giro }))),
    vigas,
    losas: [
      { id: "L-N1", planta: "N1", contorno, huecos: [[P(xs[1]! + 0.25, ys[1]! + 0.25), P(xs[1]! + 0.45, ys[1]! + 0.25), P(xs[1]! + 0.45, ys[1]! + 0.45), P(xs[1]! + 0.25, ys[1]! + 0.45)]], espesor: 0.25, material: "HA", eje1: giro },
      { id: "L-N2", planta: "N2", contorno, espesor: 0.3, material: "HA", pp: 4, eje1: giro, reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacos: xs.flatMap((x) => ys.map((y) => abaco(x, y))) } },
    ],
    muros: [{ id: "M", puntos: [P(0, 0), P(0, Y)], desde: "C", hasta: "N1", espesor: 0.25, material: "HA", huecos: [{ desde: L(ys[1]! + 0.1), hasta: L(ys[1]! + 0.4), z0: 0, z1: 2 }] }],
    casos: [{ id: "G", pesoPropio: true }, { id: "G2" }, { id: "Q" }, { id: "P" }],
    cargas,
    ejes: [
      ...xs.map((x, i) => ({ id: String(i + 1), desde: P(x, -2), hasta: P(x, Y + 2) })),
      ...ys.map((y, j) => ({ id: "ABCDEFG"[j]!, desde: P(-2, y), hasta: P(X + 2, y) })),
    ],
  };
}

const proyecto = (modelo: ModeloFisico): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo });

/** El estiramiento de la cota entre los ejes `a` y `b` (ids), con `b` el que se mueve. */
function entreEjes(m: ModeloFisico, a: string, b: string): Estiramiento {
  for (const c of cadenasDe(m)) {
    const [i, j] = [c.ejes.findIndex((x) => x.includes(a)), c.ejes.findIndex((x) => x.includes(b))];
    if (i >= 0 && j >= 0) return { n: c.n, fijo: c.ts[i]!, movil: c.ts[j]! };
  }
  throw new Error(`No hay ninguna cota entre ${a} y ${b}`);
}

function estirado(m: ModeloFisico, e: Estiramiento, valor: number): ModeloFisico {
  const r = estirar(m, e, valor);
  if (!r.ok) throw new Error(r.mensaje);
  const a = aplicar(proyecto(m), r.operacion);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" | "));
  return a.proyecto.modelo;
}

describe("estirar: el oráculo de la retícula (criterio 2)", () => {
  const lx = [6, 5.4, 6.25];
  const ly = [5, 4.6];
  const casos: { eje: "x" | "y"; i: number; mueve: "despues" | "antes"; valor: number }[] = [];
  for (const [eje, ls] of [
    ["x", lx],
    ["y", ly],
  ] as const)
    ls.forEach((l, i) => {
      for (const mueve of ["despues", "antes"] as const) for (const valor of [L(l + 0.35), L(l - 0.8), L(l + 1.2)]) casos.push({ eje, i, mueve, valor });
    });

  it.each(casos)("ortogonal: vano $eje$i a $valor moviendo el eje de $mueve, byte a byte", ({ eje, i, mueve, valor }) => {
    const m = reticula(lx, ly);
    const ids = eje === "x" ? ["1", "2", "3", "4"] : ["A", "B", "C"];
    const [a, b] = mueve === "despues" ? [ids[i]!, ids[i + 1]!] : [ids[i + 1]!, ids[i]!];
    const nuevo = estirado(m, entreEjes(m, a, b), valor);
    const ls = (eje === "x" ? lx : ly).map((l, k) => (k === i ? valor : l));
    const esperado = eje === "x" ? reticula(ls, ly) : reticula(lx, ls);
    if (mueve === "despues") expect(canonico(nuevo)).toBe(canonico(esperado));
    else {
      // Moviendo el de antes, todo lo anterior se desplaza −Δ: es la esperada trasladada
      const d = valor - (eje === "x" ? lx : ly)[i]!;
      const t = eje === "x" ? ([-d, 0] as const) : ([0, -d] as const);
      expect(canonico(nuevo)).toBe(canonico(trasladar(esperado, t)));
    }
  });

  it("girada 30°: la misma geometría a 1e-9 y los mismos nudos al compilar", () => {
    for (const [i, valor] of [
      [1, 6.1],
      [2, 5],
    ] as const) {
      const m = reticula(lx, ly, 30);
      const nuevo = estirado(m, entreEjes(m, String(i + 1), String(i + 2)), valor);
      const esperado = reticula(lx.map((l, k) => (k === i ? valor : l)), ly, 30);
      expect(numerosCerca(nuevo, esperado, 1e-9)).toBe(true);
      const [c1, c2] = [compilar(nuevo), compilar(esperado)];
      if (!c1.valido || !c2.valido) throw new Error("no compila");
      // Cada nudo, con el más cercano del otro (por celdas de 1 cm y sus vecinas)
      expect(c1.modelo.nudos.length).toBe(c2.modelo.nudos.length);
      const celda = (x: number) => Math.floor(x * 100);
      const otros = new Map<string, { x: number; y: number; z: number }[]>();
      for (const y of c2.modelo.nudos) {
        const k = `${celda(y.x)} ${celda(y.y)} ${celda(y.z)}`;
        otros.set(k, [...(otros.get(k) ?? []), y]);
      }
      let peor = 0;
      for (const x of c1.modelo.nudos) {
        let d = Infinity;
        for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) for (const y of otros.get(`${celda(x.x) + i} ${celda(x.y) + j} ${celda(x.z) + k}`) ?? []) d = Math.min(d, Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z));
        peor = Math.max(peor, d);
      }
      expect(peor).toBeLessThan(1e-9);
    }
  });
});

/** El modelo trasladado t (exacto en los decimales de la tabla). */
function trasladar(m: ModeloFisico, t: readonly [number, number]): ModeloFisico {
  const p = (q: Vec2): Vec2 => [L(q[0] + t[0]), L(q[1] + t[1])];
  const ps = (qs: readonly Vec2[]) => qs.map(p);
  return {
    ...m,
    pilares: m.pilares?.map((x) => ({ ...x, x: L(x.x + t[0]), y: L(x.y + t[1]) })),
    vigas: m.vigas?.map((x) => ({ ...x, puntos: ps(x.puntos) })),
    muros: m.muros?.map((x) => ({ ...x, puntos: ps(x.puntos) })),
    losas: m.losas?.map((x) => ({ ...x, contorno: ps(x.contorno), ...(x.huecos ? { huecos: x.huecos.map(ps) } : {}), ...(x.reticular ? { reticular: { ...x.reticular, ...(x.reticular.abacos ? { abacos: x.reticular.abacos.map(ps) } : {}) } } : {}) })),
    cargas: m.cargas?.map((c) => (c.tipo === "puntual" ? { ...c, x: L(c.x + t[0]), y: L(c.y + t[1]) } : c.tipo === "lineal" ? { ...c, puntos: ps(c.puntos) } : c.tipo === "superficie" && c.zona ? { ...c, zona: ps(c.zona) } : c)),
    ejes: m.ejes?.map((e) => ({ ...e, desde: p(e.desde), hasta: p(e.hasta) })),
  };
}

/** Los dos valores tienen la misma forma y los números a ≤ tol. */
function numerosCerca(a: unknown, b: unknown, tol: number): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tol;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => numerosCerca(x, b[i], tol));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const [ka, kb] = [Object.keys(a).sort(), Object.keys(b).sort()];
    return ka.join() === kb.join() && ka.every((k) => numerosCerca((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol));
  }
  return a === b;
}

// ─── Criterio 3: los modelos de referencia ──────────────────────────────────────────────────────

const VIGILADOS = new Set(["losa/ajuste", "muro/ajuste", "pano/ajuste", "losa/casi-juntas", "topologia/casi-encuentro", "topologia/fusion"]);

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

/** Lo vigilado de un compilado y ΣFz por caso. */
function medir(p: Proyecto): { vigilados: string[]; fz: number[] } {
  const c = compilar(p.modelo, p.opciones);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join(" | "));
  return {
    vigilados: c.diagnosticos.filter((d) => VIGILADOS.has(d.codigo)).map((d) => `${d.codigo} ${(d.ids ?? []).join(",")}`).sort(),
    fz: c.modelo.casos.map((_, k) => resultanteAnalitica(c.modelo, k, [0, 0, 0]).F[2]),
  };
}

describe("estirar: los modelos de referencia (criterio 3)", () => {
  it.each(referencias())("%s: deshacer da los bytes; estirado, sin avisos nuevos y la carga lineal con Δ", (_n, p) => {
    const cotas = cadenasDe(p.modelo).flatMap(cotasCadena);
    expect(cotas.length).toBeGreaterThan(0);
    // La cota central de la primera cadena con un vano de más de 2 m
    const k = cotas.find((x) => x.valor > 2)!;
    const c = k.cadena;
    const e: Estiramiento = { n: c.n, fijo: c.ts[k.i - 1]!, movil: c.ts[k.i]! };
    const base = medir(p);
    const sumas: number[][] = [];
    for (const d of [0.4, 0.8]) {
      const r = estirar(p.modelo, e, L(k.valor + d));
      if (!r.ok) throw new Error(r.mensaje);
      const a = aplicar(p, r.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" | "));
      const h = hacer(historial(p), a.proyecto, "estirar");
      expect(serializar(deshacer(h).actual)).toBe(serializar(p));
      const s = medir(h.actual);
      expect(s.vigilados).toEqual(base.vigilados);
      sumas.push(s.fz);
    }
    base.fz.forEach((f0, i) => {
      const [d1, d2] = [sumas[0]![i]! - f0, sumas[1]![i]! - f0];
      expect(Math.abs(d2 - 2 * d1), `caso ${i}: ${f0} → +${d1}, +${d2}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(f0)));
    });
    // Un caso sólo con puntuales no cambia
    const puntuales = p.modelo.casos.map((x) => p.modelo.cargas?.filter((c) => c.caso === x.id) ?? []).map((cs, i) => (cs.length && cs.every((c) => c.tipo === "puntual") && !p.modelo.casos[i]!.pesoPropio ? i : -1)).filter((i) => i >= 0);
    for (const i of puntuales) expect(sumas[0]![i]).toBe(base.fz[i]);
  });
});

// ─── Lo demás ───────────────────────────────────────────────────────────────────────────────────

describe("estirar: límites, avisos y ejes propuestos", () => {
  it("el corte va a min(L/4; 0,5) del eje que se mueve, y lo pegado a él lo sigue", () => {
    const m = reticula([6, 1.6], [5]);
    const e = entreEjes(m, "2", "3");
    // Con los ejes paralelos a Y, n = (−1, 0): t = −x
    expect(-corte(e)).toBeCloseTo(6 + 1.6 - 0.4, 12);
    expect(-corte(entreEjes(m, "1", "2"))).toBe(6 - 0.5);
    const a = afectados(m, entreEjes(m, "1", "2"));
    // Los pilares del eje 2 y su hueco se mueven; la losa, las vigas por y = cte y el muro se alargan
    expect(a.mueven).toEqual(expect.arrayContaining(["P1-0", "P1-1", "P2-0", "VY1-N1", "VY2-N2", "2", "3", "PU"]));
    expect(a.alargan).toEqual(expect.arrayContaining(["L-N1", "VX0-N1", "VC-N1", "A", "B", "Z-N2"]));
    expect(a.mueven).not.toContain("M");
    expect(a.alargan).not.toContain("M");
  });

  it("acortar tiene un límite: lo que se mueve no pasa por encima de lo que se queda", () => {
    const m = reticula([6, 5], [5]);
    // Moviendo el 2 hacia el 1: lo que se mueve más cerca del corte (a 5,5) es el ábaco de los pilares del eje 2 (5,55), y lo
    // que se queda, el de los del eje 1 (0,45): la cota tiene que medir más de 6 − (0,05 + 5,05) = 0,9
    const e = entreEjes(m, "1", "2");
    const r = estirar(m, e, 0.2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/tiene que medir más de 0,90 m: con menos, L-N2 pasaría por encima de L-N2/);
    expect(estirar(m, e, 0.95).ok).toBe(true);
    expect(estirar(m, e, 6).ok).toBe(false);
    expect(estirar(m, e, 0).ok).toBe(false);
    expect(estirar(m, e, Number.NaN).ok).toBe(false);
  });

  it("un hueco de muro que cruza el corte cambia de ancho y se avisa", () => {
    const m = reticula([6], [5, 5]);
    const muro = m.muros![0]!;
    // De 4,3 a 5,2: cruza el corte de la cota A–B moviendo el B (a 4,5)
    const conHueco = { ...m, muros: [{ ...muro, huecos: [{ desde: 4.3, hasta: 5.2, z0: 0, z1: 2 }] }] };
    const r = estirar(conHueco, entreEjes(conHueco, "A", "B"), 5.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisos).toEqual([expect.stringMatching(/hueco de M .* cruza el corte: pasa de 0,90 a 1,40 m/)]);
    const a = aplicar(proyecto(conHueco), r.operacion);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" | "));
    expect(a.proyecto.modelo.muros![0]!.huecos![0]).toEqual({ desde: 4.3, hasta: 5.7, z0: 0, z1: 2 });
  });

  it("con los ejes propuestos se mueven los pilares y los ejes salen de ellos otra vez", () => {
    const { ejes: _e, ...sinEjes } = reticula([6, 5.4], [5]);
    const m = sinEjes as ModeloFisico;
    expect(ejesDe(m).propuestos).toBe(true);
    const nuevo = estirado(m, entreEjes(m, "1", "2"), 6.35);
    expect(nuevo.ejes).toBeUndefined();
    const k = cadenasDe(nuevo).flatMap(cotasCadena).map((x) => x.texto);
    expect(k).toEqual(expect.arrayContaining(["6,35", "5,40", "5,00"]));
    expect(nuevo.pilares!.filter((p) => p.id.startsWith("P1-")).map((p) => p.x)).toEqual([6.35, 6.35]);
    expect(nuevo.pilares!.filter((p) => p.id.startsWith("P2-")).map((p) => p.x)).toEqual([11.75, 11.75]);
  });
});
