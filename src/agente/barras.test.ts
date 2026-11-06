/**
 * Fase BN2 (`docs/fem3d/barras.md` §5): las barras entre dos niveles en la capa de agente.
 * - Peso propio de A3: el esperado (γ·A por la longitud real, en la planta del extremo alto salvo la
 *   zona rígida del bajo) es el del cálculo, planta a planta, a precisión de máquina.
 * - Bajada tributaria: el peso y las cargas verticales de una barra, a sus dos extremos como una
 *   biapoyada; con una barra en un pórtico sin losas, la suma de las bajadas es la de las cargas.
 * - `barra/compresion`: la diagonal «sólo tracción» comprimida con la gravedad, y sólo si hay alguna.
 * - `fem consultar pieza` de una barra: sus extremos a lo largo de ella.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { porticoAcero, porticoArriostrado } from "../pruebas/barras.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { conjuntoCombinaciones } from "./combinaciones.ts";
import { pieza, resumen } from "./consultas.ts";
import { VERSION_ESQUEMA } from "./proyecto.ts";
import { pesoPropioCalculado, pesoPropioEsperado, Plantas, sensatezPrevia } from "./sensatez.ts";
import { sensatezResultados } from "./sensatezResultados.ts";
import { bajadaTributaria } from "./tributaria.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function preparar(f: ModeloFisico) {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(c.modelo));
  const q = new Consultas(f, c, casos);
  const res = resumen({ esquema: VERSION_ESQUEMA, modelo: f }, c);
  if (!res.valido) throw new Error("sin resumen");
  return { c, q, res: res.valor };
}

describe("BN2: peso propio esperado de A3", () => {
  for (const [nombre, f] of [["arriostrado", porticoArriostrado()], ["acero", porticoAcero()]] as [string, ModeloFisico][]) {
    it(`${nombre}: el esperado es el del cálculo en cada planta`, () => {
      const esperado = pesoPropioEsperado(f, new Plantas(f));
      const calculado = pesoPropioCalculado(f, undefined)!;
      for (const x of esperado) {
        const c = calculado.get(x.planta) ?? 0;
        expect(Math.abs(c - x.esperado) / Math.max(1, Math.abs(c)), x.planta).toBeLessThan(1e-9);
      }
      expect(esperado.some((x) => (x.barras ?? 0) > 0)).toBe(true);
    });
  }
  it("sin barras, no hay campo de barras", () => {
    const f = { ...porticoArriostrado(), barras: undefined, cargas: porticoArriostrado().cargas!.filter((c) => c.tipo !== "barra") };
    expect(pesoPropioEsperado(f, new Plantas(f)).every((x) => !("barras" in x))).toBe(true);
  });
});

describe("BN2: bajada tributaria", () => {
  it("sin losas, la suma de las bajadas en la base es el peso y las cargas verticales (barras incluidas)", () => {
    const f = porticoAcero();
    const casos = new Set(["G", "Q"]);
    const bajadas = bajadaTributaria(f, casos);
    // Lo que llega a la cabeza de los tramos de la planta más baja, más el peso de esos tramos
    const { q } = preparar(f);
    let reaccion = 0;
    const k = f.casos.findIndex((c) => c.id === "G");
    const kq = f.casos.findIndex((c) => c.id === "Q");
    for (const p of f.pilares!) {
      const n = q.mapeo.nudosPilar[`${p.id}@C`]!;
      reaccion += q.casos[k]!.reacciones[6 * n + 2]! + q.casos[kq]!.reacciones[6 * n + 2]!;
    }
    // El peso de los tramos de abajo (de C a P1), que la bajada no lleva a la cabeza
    const A = (f.secciones.find((s) => s.id === "HEB") as Extract<ModeloFisico["secciones"][number], { forma: "general" }>).A;
    const abajo = f.pilares!.length * 78.5 * A * 4;
    const enCabeza = bajadas.filter((b) => b.planta === "P1").reduce((s, b) => s + b.bajada, 0);
    // Las barras que arrancan en C (X1, X2, T4) dejan parte de lo suyo en la base, fuera de los pilares
    expect(enCabeza + abajo).toBeLessThan(reaccion);
    expect((enCabeza + abajo) / reaccion).toBeGreaterThan(0.97);
  });
});

describe("BN2: barra/compresion y la consulta de una barra", () => {
  let M: ReturnType<typeof preparar>;
  beforeAll(() => {
    M = preparar(porticoArriostrado());
  });
  it("la diagonal sólo a tracción comprimida con la gravedad lleva el aviso", () => {
    const s = sensatezResultados(M.q, M.res);
    const c = s.comprobaciones.find((x) => x.codigo === "barra/compresion")!;
    expect(c.estado).toBe("avisos");
    expect(c.avisos.map((a) => a.ids)).toEqual([["X1"]]);
  });
  it("sin barras sólo a tracción, no hay comprobación", () => {
    const f = porticoArriostrado();
    const g = { ...f, barras: f.barras!.map(({ soloTraccion: _s, ...b }) => b) };
    const x = preparar(g);
    expect(sensatezResultados(x.q, x.res).comprobaciones.some((c) => c.codigo === "barra/compresion")).toBe(false);
  });
  it("fem consultar pieza: los extremos a lo largo de la barra", () => {
    const cj = conjuntoCombinaciones(M.q, { tipo: "casos" });
    if (!cj.valido) throw new Error("sin conjunto");
    const r = pieza(M.q, cj.valor, "X1");
    if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
    const v = r.valor as { tipo: string; extremos: Record<string, { v: number; comb: string }> };
    expect(v.tipo).toBe("barra");
    expect(v.extremos["N+"]!.comb).toBe("W");
    expect(v.extremos["N+"]!.v).toBeCloseTo(3.706, 3);
    expect(v.extremos["N-"]!.v).toBeLessThan(0);
  });
});

describe("el umbral de las secciones de barras (`dimensionBarra`, de 0,01 a 1 m)", () => {
  const aviso = (D: number) => {
    const f = porticoArriostrado();
    const ids = new Set(f.barras!.map((b) => b.seccion));
    f.secciones = f.secciones.map((s) => (ids.has(s.id) ? { id: s.id, material: s.material, forma: "circular" as const, D } : s));
    return sensatezPrevia(f).find((c) => c.codigo === "sensatez/seccion")!.avisos.length > 0;
  };
  it("un redondo de Ø10 a Ø60 no avisa; uno en cm (Ø20 como «2») o en mm, sí", () => {
    expect(aviso(0.01)).toBe(false);
    expect(aviso(0.02)).toBe(false);
    expect(aviso(0.6)).toBe(false);
    expect(aviso(2)).toBe(true);
    expect(aviso(0.008)).toBe(true);
  });
});
