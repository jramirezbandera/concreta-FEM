/**
 * «Vigas de borde»: en la vivienda sin zunchos (`vigasBorde.vivienda.json`, la de antes de ponerlos a
 * mano), la orden da las mismas vigas que los zunchos hechos a mano con la regla de la skill; la losa
 * y las cargas no se tocan (fase TB: la tira entre la cara de la viga y el borde va con la viga en el
 * compilador); el modelo compila con sus tiras y ya no tiene bordes sin viga. Y en una losa hecha a
 * mano: el lado libre sólo en parte, el hueco, el error si un lado es más corto que la distancia de su
 * borde al eje y la sección que ya hay.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bordesSinViga, Plantas } from "../agente/sensatez.ts";
import { leerProyecto, type Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { Losa, ModeloFisico } from "../compilador/fisico.ts";
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
describe("Vigas de borde en la vivienda", () => {
  const antes = leer("src/editor/vigasBorde.vivienda.json");
  const ahora = leer("ejemplos/vivienda/proyecto.json");

  it.each(["L-CUB", "L-CUB-S"])("%s: las vigas de los zunchos hechos a mano", (id) => {
    const r = propuesta(antes.modelo, id);
    const aMano = ahora.modelo.vigas!.filter((v) => v.id.startsWith(`Z-${id.slice(2)}-`) && !v.id.slice(id.length).includes("-", 1));
    expect(r.vigas.map((v) => v.puntos)).toEqual(aMano.map((v) => v.puntos));
    expect(r.vigas.map((v) => v.id)).toEqual(aMano.map((v) => v.id));
    // La de las vigas que ya había
    expect(r.seccion.id).toBe("V30x30");
    expect(r.nueva).toBe(false);
    expect(r.avisos).toEqual([]);
  });

  it("la losa y las cargas no se tocan: sólo se crean las vigas", () => {
    const m = antes.modelo;
    const op = operacionVigasBorde(m, propuesta(m, "L-CUB"))!;
    expect(op.op === "lote" && op.operaciones.every((o) => o.op === "crear" && o.coleccion === "vigas")).toBe(true);
    const a = aplicar(antes, op);
    if (!a.ok) throw new Error(a.errores.map((e) => e.mensaje).join(" "));
    expect(a.proyecto.modelo.losas).toEqual(m.losas);
    expect(a.proyecto.modelo.cargas).toEqual(m.cargas);
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
    if (!c.valido) return;
    // La franja entre la cara de los zunchos y el borde (0,12 m), con ellos; los petos del borde, también
    expect(c.hipotesis.some((h) => h.includes("fase TB;"))).toBe(true);
    expect(c.diagnosticos.filter((d) => d.codigo === "carga/fuera-de-losa" || d.codigo === "carga/zona-fuera-de-losa")).toEqual([]);
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

  it("sur, este y oeste por los pilares de las esquinas, el norte sigue la viga que hay y el hueco lleva las suyas", () => {
    const m = modelo();
    const r = propuesta(m, "L", 0.25, 0.25);
    expect(r.seccion.id).toBe("Z25");
    expect(r.nueva).toBe(false);
    const v = r.vigas.map((x) => [x.regla, x.puntos]);
    expect(v).toContainEqual(["pilares", [[0.15, 0.15], [7.85, 0.15]]]);
    expect(v).toContainEqual(["pilares", [[7.85, 0.15], [7.85, 6]]]);
    expect(v).toContainEqual(["pilares", [[0.15, 6], [0.15, 0.15]]]);
    expect(v).toContainEqual(["continua", [[7.85, 6], [4, 6]]]);
    // El hueco, enrasado por sus cuatro lados
    expect(r.vigas.filter((x) => x.regla === "enrasada")).toHaveLength(4);
    expect(r.vigas.filter((x) => x.regla === "pilares").map((x) => x.retranqueo)).toEqual([0.15, 0.15, 0.15]);
    const a = aplicar({ esquema: "concreta-fem/proyecto@1", modelo: m } as Proyecto, operacionVigasBorde(m, r)!);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.proyecto.modelo.losas).toEqual(m.losas);
    expect(bordesSinViga(a.proyecto.modelo, new Plantas(a.proyecto.modelo), 0.05)).toEqual([]);
    // La puntual en el borde este cae en la tira del zunchos (0,025 m más allá de su cara): va a la viga
    const c = compilar(a.proyecto.modelo);
    expect(c.valido, c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join(" ")).toBe(true);
  });

  it("un lado más corto que el retranqueo es un error", () => {
    const m = modelo();
    // Una pestaña de 0,2 m hacia fuera: sus dos lados se cruzan al retranquearlos
    (m.losas![0] as Losa & { contorno: unknown; huecos?: unknown }).contorno = [[0, 0], [8, 0], [8, 6], [4.1, 6], [4.1, 6.5], [3.9, 6.5], [3.9, 6], [0, 6]];
    delete (m.losas![0] as { huecos?: unknown }).huecos;
    const r = proponerVigasBorde(m, "L", 0.3, 0.3);
    expect("error" in r && r.error).toContain("algún lado es más corto que la distancia de su borde al eje");
    expect(proponerVigasBorde(m, "L", 30, 30)).toEqual({ error: "Una viga de borde de 30 × 30 m no es razonable: las medidas van en metros." });
    expect(proponerVigasBorde(m, "X", 0.3, 0.3)).toEqual({ error: "No hay ninguna losa «X»." });
  });
});
