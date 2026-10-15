/**
 * «Vigas de borde»: en la vivienda sin zunchos (`vigasBorde.vivienda.json`, la de antes de ponerlos a
 * mano), la orden da los mismos contornos y las mismas vigas que los zunchos hechos a mano con la
 * regla de la skill; la carga de la banda pasa a las vigas sin perder nada; el modelo compila y
 * ya no tiene bordes sin viga. Y en una losa hecha a mano: el lado libre sólo en parte, el hueco,
 * el error si un lado es más corto que el retranqueo y la sección que ya hay.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areaRegion, bordesSinViga, longitud, Plantas } from "../agente/sensatez.ts";
import { leerProyecto, type Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { CargaFisica, Losa, ModeloFisico } from "../compilador/fisico.ts";
import { aplicar } from "./operaciones.ts";
import { operacionVigasBorde, proponerVigasBorde, type PropuestaVigasBorde } from "./vigasBorde.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = (r: string): Proyecto => {
  const l = leerProyecto(readFileSync(join(RAIZ, r), "utf8"));
  if (!l.valido) throw new Error(r);
  return l.proyecto;
};
const propuesta = (m: ModeloFisico, losa: string, b = 0.3, h = 0.3): PropuestaVigasBorde => {
  const r = proponerVigasBorde(m, losa, b, h);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const largoViga = (v: { puntos: readonly (readonly number[])[] }) => Math.hypot(v.puntos[1]![0]! - v.puntos[0]![0]!, v.puntos[1]![1]! - v.puntos[0]![1]!);
/** Σ qz·largo de las cargas de viga de un caso. */
const totalViga = (cs: readonly CargaFisica[], vigas: readonly { id: string; puntos: readonly (readonly number[])[] }[], caso: string) =>
  cs.reduce((t, c) => (c.tipo === "viga" && c.caso === caso ? t + c.q[2] * ((c.hasta ?? largoViga(vigas.find((v) => v.id === c.viga)!)) - (c.desde ?? 0)) : t), 0);

describe("Vigas de borde en la vivienda", () => {
  const antes = leer("src/editor/vigasBorde.vivienda.json");
  const ahora = leer("ejemplos/vivienda/proyecto.json");

  it.each(["L-CUB", "L-CUB-S"])("%s: los contornos y las vigas de los zunchos hechos a mano", (id) => {
    const r = propuesta(antes.modelo, id);
    const l = ahora.modelo.losas!.find((x) => x.id === id)!;
    expect(r.contorno).toEqual(l.contorno);
    const aMano = ahora.modelo.vigas!.filter((v) => v.id.startsWith(`Z-${id.slice(2)}-`) && !v.id.slice(id.length).includes("-", 1));
    expect(r.vigas.map((v) => v.puntos)).toEqual(aMano.map((v) => v.puntos));
    expect(r.vigas.map((v) => v.id)).toEqual(aMano.map((v) => v.id));
    // La de las vigas que ya había
    expect(r.seccion.id).toBe("V30x30");
    expect(r.nueva).toBe(false);
    expect(r.avisos).toEqual([]);
  });

  it.each(["L-CUB", "L-CUB-S"])("%s: la banda pasa a las vigas sin perder carga", (id) => {
    const m = antes.modelo;
    const l = m.losas!.find((x) => x.id === id)!;
    const r = propuesta(m, id);
    const dA = areaRegion(l) - areaRegion({ contorno: r.contorno, huecos: r.huecos });
    expect(dA).toBeGreaterThan(5);
    const sup = (caso: string) => m.cargas!.filter((c) => c.tipo === "superficie" && c.losa === id && c.caso === caso).reduce((t, c) => t + (c as unknown as { q: number[] }).q[2]! * dA, 0);
    // Q y N: sólo superficie (los q, redondeados a 1e-6)
    for (const caso of ["Q", "N"]) expect(Math.abs(totalViga(r.cargas, r.vigas, caso) - sup(caso))).toBeLessThan(1e-4);
    // Los petos enteros, sin perder ni un trozo
    const petos = m.cargas!.filter((c) => c.tipo === "lineal" && c.planta === l.planta);
    expect(r.quitadas).toEqual(petos.map((c) => c.id));
    expect(r.cargas.filter((c) => c.tipo === "lineal")).toEqual([]);
    const petoViga = r.cargas.filter((c) => c.tipo === "viga" && petos.some((p) => c.id.startsWith(`${p.id}-`)));
    const petoTotal = petos.reduce((t, c) => t + (c as unknown as { q: number[] }).q[2]! * longitud((c as unknown as { puntos: [number, number][] }).puntos), 0);
    expect(Math.abs(totalViga(petoViga, r.vigas, "G") - petoTotal)).toBeLessThan(1e-4);
  });

  it("aplicada en las dos losas, el modelo compila y no le queda ningún borde sin viga", () => {
    let p = antes;
    for (const id of ["L-CUB", "L-CUB-S"]) {
      const a = aplicar(p, operacionVigasBorde(p.modelo, propuesta(p.modelo, id))!);
      if (!a.ok) throw new Error(a.errores.map((e) => e.mensaje).join(" "));
      p = a.proyecto;
    }
    expect(bordesSinViga(p.modelo, new Plantas(p.modelo), 0.05)).toEqual([]);
    expect(p.modelo.secciones.filter((s) => s.id === "V30x30")).toHaveLength(1);
    const c = compilar(p.modelo);
    expect(c.valido, c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join(" ")).toBe(true);
    // Y otra vez, nada que hacer
    expect(proponerVigasBorde(p.modelo, "L-CUB", 0.3, 0.3)).toEqual({ error: "L-CUB ya tiene todos sus bordes sobre una viga, un muro, un apoyo lineal u otro forjado." });
  });
});

describe("Vigas de borde en una losa hecha a mano", () => {
  /** Losa de 8 × 6 con un hueco de 2 × 2, pilares de 30 × 30 en (0,15; 0,15) y (7,85; 0,15), y una viga en la mitad oeste del lado norte. */
  const modelo = (): ModeloFisico => ({
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "Z25", material: "HA", forma: "rectangular", b: 0.25, h: 0.25 },
    ],
    pilares: [
      { id: "P1", x: 0.15, y: 0.15, desde: "N0", hasta: "N1", seccion: "P30" },
      { id: "P2", x: 7.85, y: 0.15, desde: "N0", hasta: "N1", seccion: "P30" },
    ],
    vigas: [{ id: "V1", planta: "N1", puntos: [[0, 6], [4, 6]], seccion: "Z25" }],
    losas: [{ id: "L", planta: "N1", contorno: [[0, 0], [8, 0], [8, 6], [0, 6]], huecos: [[[3, 2], [5, 2], [5, 4], [3, 4]]], espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "q", caso: "Q", planta: "N1", losa: "L", q: [0, 0, -2] },
      { tipo: "puntual", id: "F", caso: "Q", planta: "N1", x: 8, y: 3, F: [0, 0, -10] },
    ],
  });

  it("sur, este y oeste por los pilares de las esquinas, el norte sigue la viga que hay y el hueco se agranda", () => {
    const m = modelo();
    const r = propuesta(m, "L", 0.25, 0.25);
    expect(r.seccion.id).toBe("Z25");
    expect(r.nueva).toBe(false);
    // Sur, este y oeste, al eje de los pilares de las esquinas (0,15); el norte no se mueve
    expect(r.contorno).toEqual([[0.15, 0.15], [7.85, 0.15], [7.85, 6], [0.15, 6]]);
    expect(r.huecos).toEqual([[[2.875, 1.875], [5.125, 1.875], [5.125, 4.125], [2.875, 4.125]]]);
    const v = r.vigas.map((x) => [x.regla, x.puntos]);
    expect(v).toContainEqual(["pilares", [[0.15, 0.15], [7.85, 0.15]]]);
    expect(v).toContainEqual(["pilares", [[7.85, 0.15], [7.85, 6]]]);
    expect(v).toContainEqual(["pilares", [[0.15, 6], [0.15, 0.15]]]);
    expect(v).toContainEqual(["continua", [[7.85, 6], [4, 6]]]);
    // El hueco, enrasado por sus cuatro lados
    expect(r.vigas.filter((x) => x.regla === "enrasada")).toHaveLength(4);
    // La puntual en el borde este queda fuera y se dice
    expect(r.sueltas).toEqual(["F"]);
    // La Q de la banda, entera en las vigas
    const dA = areaRegion(m.losas![0]!) - areaRegion({ contorno: r.contorno, huecos: r.huecos });
    expect(Math.abs(totalViga(r.cargas, r.vigas, "Q") - -2 * dA)).toBeLessThan(1e-4);
    // El peso de la losa sólo donde no está la viga: retranqueo 0,15 > 0,125, una tira de 0,025 en
    // el sur (8 m), el este y el oeste (6 m menos la esquina del sur)
    const pp = r.cargas.filter((c) => c.tipo === "viga" && c.caso === "G");
    expect(pp.map((c) => (c as { viga: string }).viga).sort()).toEqual(r.vigas.filter((x) => x.regla === "pilares").map((x) => x.id).sort());
    expect(Math.abs(totalViga(pp, r.vigas, "G") - -25 * 0.25 * 0.025 * (8 + 2 * 6 - 2 * 0.025))).toBeLessThan(1e-4);
    const a = aplicar({ esquema: "concreta-fem/proyecto@1", modelo: m } as Proyecto, operacionVigasBorde(m, r)!);
    expect(a.ok).toBe(true);
    if (a.ok) expect(bordesSinViga(a.proyecto.modelo, new Plantas(a.proyecto.modelo), 0.05)).toEqual([]);
  });

  it("un lado más corto que el retranqueo es un error", () => {
    const m = modelo();
    // Una pestaña de 0,2 m hacia fuera: sus dos lados se cruzan al retranquearlos
    (m.losas![0] as Losa & { contorno: unknown; huecos?: unknown }).contorno = [[0, 0], [8, 0], [8, 6], [4.1, 6], [4.1, 6.5], [3.9, 6.5], [3.9, 6], [0, 6]];
    delete (m.losas![0] as { huecos?: unknown }).huecos;
    const r = proponerVigasBorde(m, "L", 0.3, 0.3);
    expect("error" in r && r.error).toContain("algún lado es más corto que el retranqueo");
    expect(proponerVigasBorde(m, "L", 30, 30)).toEqual({ error: "Una viga de borde de 30 × 30 m no es razonable: las medidas van en metros." });
    expect(proponerVigasBorde(m, "X", 0.3, 0.3)).toEqual({ error: "No hay ninguna losa «X»." });
  });
});
