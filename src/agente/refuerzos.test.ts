/**
 * Criterios 1, 2, 3 y 4 de la fase AB (`docs/fem3d/armado.md` §4), sin la app: zonas de refuerzo,
 * picos rotulados, la consulta `refuerzos` (bit a bit con `fem consultar franja`) y la leyenda con su
 * unidad, sobre el reticular de H25 con acciones (el de la app de F).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { conAcciones, reticularH25 } from "../../validacion/c5/modelos.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { ARMADURAS, type ArmadoProyecto, type Armadura } from "./armaduraBase.ts";
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones } from "./combinaciones.ts";
import { consultar, franja as consultaFranja, type FilaRefuerzo } from "./consultas.ts";
import { franjasTramos, losasDe, picos, zonasRefuerzo, type FranjaTramos, type TramoArmado } from "./refuerzos.ts";
import { escenaASvg, ResultadosRender, vistaArmado } from "./render/index.ts";

let q: Consultas;
let rr: ResultadosRender;
let conj: ConjuntoCombinaciones;
const MODELO = conAcciones(reticularH25());

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  const c = compilar(MODELO);
  if (!c.valido) throw new Error("no compila");
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no calcula");
  q = new Consultas(MODELO, c, r.casos);
  rr = new ResultadosRender(q, c);
  const s = conjuntoCombinaciones(q, seleccionPorDefecto(MODELO.casos, "esfuerzos"));
  if (!s.valido) throw new Error("sin combinaciones");
  conj = s.valor;
}, 120_000);

const tramos = (a: Armadura): FranjaTramos[] => {
  const r = franjasTramos(q, losasDe(q, {}), a, conj);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
  return r.valor;
};

/** ¿Están unidos dos tramos por la regla de las zonas (AB-b)? */
const unidos = (x: TramoArmado, y: TramoArmado) =>
  (x.franja === y.franja && (Math.abs(x.b - y.a) <= 1e-9 || Math.abs(y.b - x.a) <= 1e-9 || Math.abs(x.estacion - y.estacion) === 1)) || ((Math.abs(x.t1 - y.t0) <= 1e-9 || Math.abs(y.t1 - x.t0) <= 1e-9) && Math.min(x.b, y.b) - Math.max(x.a, y.a) > 1e-3);

describe("zonas de refuerzo (criterio 3)", () => {
  for (const a of ARMADURAS)
    it(`${a}: partición, conexas, sin depender del orden, área`, () => {
      const fs = tramos(a);
      const losa = fs[0]!.franja.losa;
      const todos = fs.flatMap((f) => f.tramos);
      const vmax = Math.max(...todos.map((t) => t.v));
      for (const base of [0, 0.3 * vmax, 0.6 * vmax]) {
        const zs = zonasRefuerzo(losa, a, base, fs);
        // Cada tramo que supera la base, en exactamente una zona; ninguno que no
        const cuenta = new Map<TramoArmado, number>();
        for (const z of zs) for (const t of z.tramos) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
        for (const t of todos) expect(cuenta.get(t) ?? 0).toBe(t.v > base ? 1 : 0);
        for (const z of zs) {
          // Conexa: desde su primer tramo se llega a todos
          const visto = new Set([z.tramos[0]!]);
          const pila = [z.tramos[0]!];
          while (pila.length) {
            const x = pila.pop()!;
            for (const y of z.tramos) if (!visto.has(y) && unidos(x, y)) visto.add(y), pila.push(y);
          }
          expect(visto.size).toBe(z.tramos.length);
          // Y no se une a ninguna otra
          for (const o of zs) if (o !== z) for (const x of z.tramos.slice(0, 50)) for (const y of o.tramos) expect(unidos(x, y)).toBe(false);
          expect(z.area).toBeCloseTo(z.tramos.reduce((s, t) => s + (t.b - t.a) * (t.t1 - t.t0), 0), 9);
          expect(z.maximo.v).toBe(Math.max(...z.tramos.map((t) => t.v)));
          expect(z.maximo.exceso).toBe(z.maximo.v - base);
          expect(z.longitud).toBe(z.s[1] - z.s[0]);
        }
        // Sin depender del orden de las franjas
        const al = zonasRefuerzo(losa, a, base, [...fs].reverse());
        expect(al.map((z) => [z.id, z.franjas, z.s, z.maximo])).toEqual(zs.map((z) => [z.id, z.franjas, z.s, z.maximo]));
      }
      // Con la base en el máximo, ninguna
      expect(zonasRefuerzo(losa, a, vmax, fs)).toEqual([]);
    });

  it("el contorno de una L es su perímetro", () => {
    const d: Vec2 = [1, 0];
    const n: Vec2 = [0, 1];
    const T = (franja: string, a: number, b: number, t0: number, v: number): TramoArmado => ({ franja, losa: "L", estacion: 0, s: (a + b) / 2, a, b, t0, t1: t0 + 1, v, comb: "", rectangulo: [] });
    const f = (id: string, t0: number, ts: TramoArmado[]): FranjaTramos => ({ franja: { id, losa: "L", planta: "P", direccion: 1, d, n, t0, t1: t0 + 1, ancho: 1, s0: 0, s1: 10, intereje: null }, tramos: ts });
    // Franja 1: de 0 a 3 (dos tramos); franja 2: de 0 a 1
    const fs = [f("L:X1", 0, [T("L:X1", 0, 1, 0, 5), T("L:X1", 1, 3, 0, 6), T("L:X1", 3, 4, 0, 1)]), f("L:X2", 1, [T("L:X2", 0, 1, 1, 7), T("L:X2", 1, 4, 1, 1)])];
    const [z, ...otras] = zonasRefuerzo("L", "x-inf", 2, fs);
    expect(otras).toEqual([]);
    expect(z!.franjas).toEqual(["L:X1", "L:X2"]);
    expect(z!.area).toBe(4);
    expect(z!.maximo).toEqual({ v: 7, franja: "L:X2", s: 0.5, comb: "", exceso: 5 });
    const largo = z!.contorno.reduce((s, [p, r]) => s + Math.hypot(r[0] - p[0], r[1] - p[1]), 0);
    expect(largo).toBe(10);
  });
});

describe("zonas a través de un pilar ancho", () => {
  it("las dos caras de un pilar, sin estaciones entre ellas, son una zona; a través de una estación que no vale, no", () => {
    const d: Vec2 = [1, 0];
    const n: Vec2 = [0, 1];
    // Caras en s = 2,7 y 3,3 (pilar de 0,6): con el tope de un paso, sus tramos dejan un hueco de 2,95 a 3,05
    const T = (estacion: number, a: number, b: number, v: number): TramoArmado => ({ franja: "L:X1", losa: "L", estacion, s: (a + b) / 2, a, b, t0: 0, t1: 1, v, comb: "", rectangulo: [] });
    const f = (ts: TramoArmado[]): FranjaTramos[] => [{ franja: { id: "L:X1", losa: "L", planta: "P", direccion: 1, d, n, t0: 0, t1: 1, ancho: 1, s0: 0, s1: 10, intereje: null }, tramos: ts }];
    const caras = [T(10, 2.45, 2.7, 25), T(11, 2.7, 2.95, 30), T(12, 3.05, 3.3, 28), T(13, 3.3, 3.55, 24)];
    expect(zonasRefuerzo("L", "x-sup", 20, f(caras)).map((z) => [z.s, z.tramos.length])).toEqual([[[2.45, 3.55], 4]]);
    // Con una estación entre ellas que no vale (índice 12 sin tramo), dos zonas
    const hueco = [T(10, 2.45, 2.7, 25), T(11, 2.7, 2.95, 30), T(13, 3.05, 3.3, 28), T(14, 3.3, 3.55, 24)];
    expect(zonasRefuerzo("L", "x-sup", 20, f(hueco)).length).toBe(2);
  });
});

describe("picos (criterio 4, AB-a)", () => {
  const T = (vs: number[]): TramoArmado[] => vs.map((v, i) => ({ franja: "F", losa: "L", estacion: i, s: i, a: i - 0.5, b: i + 0.5, t0: 0, t1: 1, v, comb: "", rectangulo: [] }));
  const vs = (ts: TramoArmado[]) => ts.map((t) => t.estacion);
  it("máximos locales con su prominencia", () => {
    expect(vs(picos(T([0, 1, 2, 1, 0, 3, 0]), 0.5))).toEqual([2, 5]);
    // El segundo sólo baja 0,05 hasta uno más alto: no es un pico
    expect(vs(picos(T([0, 5, 4.9, 4.95, 0]), 0.5))).toEqual([1]);
    // Una meseta, una vez; los extremos cuentan (bajan a 0 fuera de la franja)
    expect(vs(picos(T([4, 4, 1, 3]), 0.5))).toEqual([0, 3]);
    expect(vs(picos(T([0, 0, 0]), 0.5))).toEqual([]);
  });
});

describe("consulta refuerzos y vista (criterios 1, 2 y 4)", () => {
  const a: Armadura = "x-sup";
  let armado: ArmadoProyecto;
  beforeAll(() => {
    const vmax = Math.max(...tramos(a).flatMap((f) => f.tramos.map((t) => t.v)));
    armado = { base: { [a]: Math.round(0.5 * vmax) } };
  });

  it("las zonas de la consulta tienen los valores de «fem consultar franja»", () => {
    const r = consultar(q, "refuerzos", { armadura: a, armado, combinaciones: () => ({ valido: true, valor: conj, diagnosticos: [] }) });
    expect(r.valido).toBe(true);
    const v = (r as { valor: { zonas: FilaRefuerzo[]; sinBase: string[] } }).valor;
    expect(v.zonas.length).toBeGreaterThan(0);
    expect(v.sinBase).toEqual([]);
    for (const z of v.zonas) {
      const f = consultaFranja(q, conj, z.maximo.franja);
      if (!f.valido) throw new Error();
      const e = f.valor.estaciones.find((x) => x.s === z.maximo.s && x.superior[0] === z.maximo.v);
      expect(e?.superior[1]).toBe(z.maximo.comb);
      expect("tramos" in z).toBe(false);
    }
    // Sin armadura, o con una que no existe, error
    expect(consultar(q, "refuerzos", { armado, combinaciones: () => ({ valido: true, valor: conj, diagnosticos: [] }) }).valido).toBe(false);
    expect(consultar(q, "refuerzos", { armadura: "z", armado, combinaciones: () => ({ valido: true, valor: conj, diagnosticos: [] }) }).valido).toBe(false);
    // Sin base, ninguna zona y la losa dicha
    const s = consultar(q, "refuerzos", { armadura: a, combinaciones: () => ({ valido: true, valor: conj, diagnosticos: [] }) });
    expect(s.valido && (s.valor as { zonas: unknown[]; sinBase: string[] })).toEqual(expect.objectContaining({ zonas: [], sinBase: losasDe(q, {}) }));
  });

  it("la vista: título con la unidad, un rótulo por zona con el exceso y lo cubierto en gris", () => {
    const planta = MODELO.losas![0]!.planta;
    const d = { huella: "x" };
    const sin = vistaArmado(rr, planta, a, conj, d);
    expect(sin.tituloLeyenda).toBe("X superior · M_Ed (Wood–Armer) · kN·m/m");
    expect(escenaASvg(sin).svg).toContain("X superior · M_Ed (Wood–Armer) · kN·m/m");
    // Sin base: un rótulo por pico, todos en los extremos
    const nPicos = tramos(a).reduce((s, f) => s + picos(f.tramos, 0.05 * Math.max(...tramos(a).flatMap((g) => g.tramos.map((t) => t.v)))).length, 0);
    expect(sin.primitivas.filter((p) => p.tipo === "texto" && p.color === "#1d4ed8").length).toBe(nPicos);
    expect(sin.extremos.length).toBe(nPicos);
    const con = vistaArmado(rr, planta, a, conj, d, { armado });
    const zonas = (consultar(q, "refuerzos", { armadura: a, armado, combinaciones: () => ({ valido: true, valor: conj, diagnosticos: [] }) }) as { valor: { zonas: FilaRefuerzo[] } }).valor.zonas;
    const rotulos = con.primitivas.filter((p): p is Extract<typeof p, { tipo: "texto" }> => p.tipo === "texto" && p.color === "#1d4ed8");
    expect(rotulos.length).toBe(zonas.length);
    expect(rotulos.every((t) => / \(\+[\d,]+\)$/.test(t.texto))).toBe(true);
    expect(con.primitivas.some((p) => p.tipo === "poligono" && p.estilo === "armado-cubierto")).toBe(true);
    expect(con.leyenda.some((l) => l.estilo === "armado-cubierto" && l.texto.startsWith("cubierto por la base (≤ "))).toBe(true);
    // Lo coloreado empieza en la base
    expect(con.mapa!.minimo).toBeGreaterThan(armado.base![a]!);
    // «Todo»: el mapa entero, con los picos y el contorno de las zonas
    const todo = vistaArmado(rr, planta, a, conj, d, { armado, soloExceso: false });
    expect(todo.primitivas.some((p) => p.tipo === "poligono" && p.estilo === "armado-cubierto")).toBe(false);
    expect(todo.primitivas.some((p) => p.tipo === "linea" && p.estilo === "zona-refuerzo")).toBe(true);
    expect(todo.extremos.length).toBe(nPicos);
  });
});
